import type { Server, Socket } from "socket.io";
import type {
  HumanPlayer,
  BotPlayer,
  Player,
  GameId,
  PlayCardsPayload,
  VoteChoice,
} from "../../shared/types";
import { GAME_MAX_PLAYERS } from "../../shared/types";
import { validatePlay } from "../../shared/cardLogic";
import {
  rooms,
  getOrCreateRoom,
  findPlayer,
  removeFromAll,
  broadcast,
} from "./rooms";
import { gameSessions, deal, broadcastTurn, broadcastHands } from "./sessions";
import { checkWin, handleVote, advanceTurn } from "./game";
import { scheduleBotTurn } from "./bots";

const BOT_NAMES = ["Bot Alice", "Bot Bob", "Bot Carol", "Bot Dave"];

export function registerSocketHandlers(io: Server): void {
  io.on("connection", (socket: Socket) => {
    console.log("[socket] Connected:", socket.id);

    // ── Join room ───────────────────────────────────────────────────────────
    socket.on(
      "room:join",
      (payload: { roomId: string; player: HumanPlayer }) => {
        const { roomId, player } = payload;
        if (!roomId || !player?.userId) return;

        const room = getOrCreateRoom(roomId, player.userId);
        const existing = findPlayer(room, player.userId);

        if (existing) {
          existing.displayName = player.displayName;
          existing.avatarUrl = player.avatarUrl;
        } else {
          room.spectators.push({ ...player, isReady: false, type: "human" });
        }

        socket.join(roomId);
        socket.data.roomId = roomId;
        socket.data.userId = player.userId;
        broadcast(io, roomId);

        // Re-send in-game state to reconnecting player
        const session = gameSessions.get(roomId);
        if (session && room.phase === "inGame" && room.gamePlayers) {
          const uid = player.userId;
          const hand = session.hands.get(uid) ?? [];
          const playerCardCounts = room.gamePlayers.map((p) => ({
            userId: p.userId,
            count: session.hands.get(p.userId)?.length ?? 0,
          }));
          socket.emit("game:hand", { hand, playerCardCounts });
          broadcastTurn(io, roomId, session);
        }
      },
    );

    // ── Sit / stand ─────────────────────────────────────────────────────────
    socket.on("player:sit", (payload: { roomId: string; userId: string }) => {
      const { roomId, userId } = payload;
      const room = rooms.get(roomId);
      if (!room || room.phase !== "lobby") return;
      if (room.players.length >= GAME_MAX_PLAYERS[room.selectedGame as GameId])
        return;

      const idx = room.spectators.findIndex((p) => p.userId === userId);
      if (idx === -1) return;
      const [player] = room.spectators.splice(idx, 1);
      player.isReady = false;
      room.players.push(player);
      broadcast(io, roomId);
    });

    socket.on("player:stand", (payload: { roomId: string; userId: string }) => {
      const { roomId, userId } = payload;
      const room = rooms.get(roomId);
      if (!room || room.phase !== "lobby") return;

      const idx = room.players.findIndex((p) => p.userId === userId);
      if (idx === -1) return;
      const [player] = room.players.splice(idx, 1);
      player.isReady = false;
      room.spectators.push(player);
      broadcast(io, roomId);
    });

    // ── Ready state ─────────────────────────────────────────────────────────
    socket.on(
      "player:ready",
      (payload: { roomId: string; userId: string; ready: boolean }) => {
        const { roomId, userId, ready } = payload;
        const room = rooms.get(roomId);
        if (!room || room.phase !== "lobby") return;
        const player = room.players.find((p) => p.userId === userId);
        if (!player) return;
        player.isReady = ready;
        broadcast(io, roomId);
      },
    );

    // ── Room settings ───────────────────────────────────────────────────────
    socket.on("room:set-game", (payload: { roomId: string; game: GameId }) => {
      const { roomId, game } = payload;
      const room = rooms.get(roomId);
      if (!room || room.hostUserId !== socket.data.userId) return;

      room.selectedGame = game;
      room.players.forEach((p) => (p.isReady = false));
      const max = GAME_MAX_PLAYERS[game];
      while (room.players.length > max)
        room.spectators.unshift(room.players.pop()!);
      broadcast(io, roomId);
    });

    socket.on(
      "room:set-bots",
      (payload: { roomId: string; enabled: boolean }) => {
        const { roomId, enabled } = payload;
        const room = rooms.get(roomId);
        if (!room || room.hostUserId !== socket.data.userId) return;
        room.botsEnabled = enabled;
        room.players.forEach((p) => {
          p.isReady = false;
        });
        broadcast(io, roomId);
      },
    );

    socket.on(
      "room:set-bot-level",
      (payload: {
        roomId: string;
        level: import("../../shared/types").BotLevel;
      }) => {
        const { roomId, level } = payload;
        const room = rooms.get(roomId);
        if (!room || room.hostUserId !== socket.data.userId) return;
        room.botLevel = level;
        broadcast(io, roomId);
      },
    );

    socket.on(
      "room:transfer-host",
      (payload: { roomId: string; toUserId: string }) => {
        const { roomId, toUserId } = payload;
        const room = rooms.get(roomId);
        if (!room || room.hostUserId !== socket.data.userId) return;
        const target = findPlayer(room, toUserId);
        if (!target) return;
        room.hostUserId = toUserId;
        broadcast(io, roomId);
      },
    );

    // ── Start game ──────────────────────────────────────────────────────────
    socket.on("room:start-game", (payload: { roomId: string }) => {
      const { roomId } = payload;
      const room = rooms.get(roomId);
      if (!room || room.hostUserId !== socket.data.userId) return;

      const max = GAME_MAX_PLAYERS[room.selectedGame as GameId];
      const humanPlayers = room.players.filter((p) => p.type === "human");

      if (room.botsEnabled) {
        if (humanPlayers.length === 0 || !humanPlayers.every((p) => p.isReady))
          return;
      } else {
        if (
          room.players.length !== max ||
          !room.players.every((p) => p.isReady)
        )
          return;
      }

      const gamePlayers: Player[] = [...room.players];

      if (room.botsEnabled) {
        for (let i = room.players.length; i < max; i++) {
          const n = i - room.players.length;
          const bot: BotPlayer = {
            type: "bot",
            botId: `bot-${n}`,
            userId: `bot-${n}`,
            displayName: BOT_NAMES[n] ?? `Bot ${n + 1}`,
            isReady: true,
            avatarUrl: undefined,
            level: room.botLevel ?? "easy",
          };
          gamePlayers.push(bot);
        }
      }

      const hands = deal(gamePlayers);
      const starterUserId = (() => {
        for (const [uid, hand] of hands) {
          if (hand.some((c) => c.rank === "3" && c.suit === "♦")) return uid;
        }
        return gamePlayers[0].userId;
      })();

      const session = {
        hands,
        currentTurn: starterUserId,
        centerPile: [],
        turnOrder: gamePlayers.map((p) => p.userId),
        isFirstTurn: true,
        freeTurn: false,
        passCount: 0,
        lastPlayedBy: null,
        botTimeout: null,
        phase: "playing" as const,
        votes: new Map(),
        voteTimeout: null,
        voteDeadline: 0,
      };

      gameSessions.set(roomId, session);
      room.gamePlayers = gamePlayers;
      room.phase = "inGame";

      broadcast(io, roomId);
      broadcastHands(io, roomId, session, gamePlayers);
      broadcastTurn(io, roomId, session);
      scheduleBotTurn(io, roomId);
    });

    // ── Play cards ──────────────────────────────────────────────────────────
    socket.on("game:play", (payload: PlayCardsPayload) => {
      const { roomId, cards } = payload;
      const userId = socket.data.userId as string | undefined;
      if (!userId || !roomId || !cards?.length) return;

      const session = gameSessions.get(roomId);
      if (!session || session.currentTurn !== userId) return;

      const hand = session.hands.get(userId);
      if (!hand) return;

      // Verify all played cards are in hand
      const remaining = [...hand];
      for (const pc of cards) {
        const idx = remaining.findIndex(
          (c) => c.rank === pc.rank && c.suit === pc.suit,
        );
        if (idx === -1) {
          socket.emit("game:play:error", { reason: "Card not in hand" });
          return;
        }
        remaining.splice(idx, 1);
      }

      const lastPlayed =
        session.freeTurn || session.centerPile.length === 0
          ? null
          : session.centerPile.at(-1)!.cards;

      const validation = validatePlay(cards, lastPlayed, session.isFirstTurn);
      if (!validation.valid) {
        socket.emit("game:play:error", { reason: validation.reason });
        return;
      }

      // Commit play
      session.hands.set(userId, remaining);
      session.centerPile.push({ userId, cards });
      session.isFirstTurn = false;
      session.freeTurn = false;
      session.passCount = 0;
      session.lastPlayedBy = userId;
      advanceTurn(session, userId);

      // Confirm to the playing socket
      const room = rooms.get(roomId);
      if (room?.gamePlayers) {
        socket.emit("game:play:ok", {
          hand: remaining,
          playerCardCounts: room.gamePlayers.map((p) => ({
            userId: p.userId,
            count: session.hands.get(p.userId)?.length ?? 0,
          })),
        });
      }

      broadcastTurn(io, roomId, session);
      if (checkWin(io, roomId, userId)) return;
      scheduleBotTurn(io, roomId);
    });

    // ── Pass ────────────────────────────────────────────────────────────────
    socket.on("game:pass", (payload: { roomId: string }) => {
      const { roomId } = payload;
      const userId = socket.data.userId as string | undefined;
      if (!userId || !roomId) return;

      const session = gameSessions.get(roomId);
      if (!session || session.currentTurn !== userId) return;

      session.passCount += 1;
      if (session.passCount >= session.turnOrder.length - 1) {
        session.freeTurn = true;
        session.passCount = 0;
      }

      advanceTurn(session, userId);
      broadcastTurn(io, roomId, session);
      scheduleBotTurn(io, roomId);
    });

    // ── Vote ────────────────────────────────────────────────────────────────
    socket.on(
      "game:vote",
      (payload: { roomId: string; choice: VoteChoice }) => {
        const { roomId, choice } = payload;
        const userId = socket.data.userId as string | undefined;
        if (!userId || !roomId) return;
        handleVote(io, roomId, userId, choice);
      },
    );

    // ── Disconnect ──────────────────────────────────────────────────────────
    socket.on("disconnecting", () => {
      const roomId = socket.data.roomId as string | undefined;
      const userId = socket.data.userId as string | undefined;
      if (!roomId || !userId) return;

      const room = rooms.get(roomId);
      if (!room) return;

      if (room.phase === "lobby") removeFromAll(room, userId);

      const totalUsers = room.spectators.length + room.players.length;
      if (totalUsers === 0 && room.phase === "lobby") {
        rooms.delete(roomId);
        gameSessions.delete(roomId);
        return;
      }

      if (room.hostUserId === userId) {
        const next = room.players[0] ?? room.spectators[0];
        if (next) room.hostUserId = next.userId;
      }

      broadcast(io, roomId);
    });
  });
}
