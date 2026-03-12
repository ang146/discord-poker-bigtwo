import express from "express";
import dotenv from "dotenv";
import http from "http";
import { Server, Socket } from "socket.io";
import type {
  GameId,
  Player,
  HumanPlayer,
  BotPlayer,
  RoomState,
  Card,
  GameHandPayload,
  GameTurnState,
  PlayCardsPayload,
  PlayedTurn,
  VoteChoice,
  GameOverPayload,
  PlayerVote,
  VoteUpdatePayload,
} from "../../shared/types";
import { GAME_MAX_PLAYERS, SUITS, RANKS } from "../../shared/types";
import { validatePlay, calcBotMove } from "../../shared/cardLogic";

dotenv.config({ path: "../.env" });

const PORT = process.env.PORT ?? 3001;
const CLIENT_ID = process.env.VITE_DISCORD_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET ?? "";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.warn(
    "[server] WARNING: VITE_DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET not set",
  );
}

// ─── Server-only game session ─────────────────────────────────────────────────

type GameSession = {
  hands: Map<string, Card[]>;
  currentTurn: string;
  centerPile: PlayedTurn[];
  turnOrder: string[];
  isFirstTurn: boolean;
  freeTurn: boolean;
  passCount: number;
  botTimeout: ReturnType<typeof setTimeout> | null;
  lastPlayedBy: string | null;
  phase: "playing" | "voting";
  votes: Map<string, VoteChoice | null>;
  voteTimeout: ReturnType<typeof setTimeout> | null;
  voteDeadline: number;
};

const gameSessions = new Map<string, GameSession>();

// ─── Card dealing ─────────────────────────────────────────────────────────────

function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ suit, rank });
  return deck;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function deal(players: Player[]): Map<string, Card[]> {
  const deck = shuffle(createDeck());
  const hands = new Map<string, Card[]>();
  players.forEach((p, i) => {
    hands.set(p.userId, deck.slice(i * 13, (i + 1) * 13));
  });
  return hands;
}

// ─── Turn state broadcast ─────────────────────────────────────────────────────

function broadcastTurn(roomId: string, session: GameSession): void {
  const state: GameTurnState = {
    currentTurn: session.currentTurn,
    centerPile: session.centerPile,
    playerCardCounts: session.turnOrder.map((uid) => ({
      userId: uid,
      count: session.hands.get(uid)?.length ?? 0,
    })),
  };
  io.to(roomId).emit("game:turn", state);
}

// ─── Express ─────────────────────────────────────────────────────────────────

type TokenResponse = { access_token: string; token_type: string };

const app = express();
app.use(express.json());

app.post("/api/token", async (req, res) => {
  const code = req.body?.code as string | undefined;
  if (!code) return res.status(400).json({ error: "missing_code" });
  try {
    const response = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      return res
        .status(400)
        .json({ error: "token_exchange_failed", details: text });
    }
    const data = (await response.json()) as TokenResponse;
    res.json({ access_token: data.access_token });
  } catch {
    res.status(500).json({ error: "internal_server_error" });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

// ─── HTTP + Socket.IO ─────────────────────────────────────────────────────────

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ─── Room helpers ─────────────────────────────────────────────────────────────

const rooms = new Map<string, RoomState>();

function getOrCreateRoom(roomId: string, firstUserId: string): RoomState {
  const existing = rooms.get(roomId);
  if (existing) return existing;
  const room: RoomState = {
    roomId,
    spectators: [],
    players: [],
    gamePlayers: null,
    selectedGame: "big-two",
    hostUserId: firstUserId,
    botsEnabled: true,
    phase: "lobby",
    lastWinnerUserId: null,
  };
  rooms.set(roomId, room);
  return room;
}

function findPlayer(room: RoomState, userId: string): Player | undefined {
  return (
    room.spectators.find((p) => p.userId === userId) ??
    room.players.find((p) => p.userId === userId)
  );
}

function removeFromAll(room: RoomState, userId: string): void {
  room.spectators = room.spectators.filter((p) => p.userId !== userId);
  room.players = room.players.filter((p) => p.userId !== userId);
}

function broadcast(roomId: string): void {
  const room = rooms.get(roomId);
  if (room) io.to(roomId).emit("room:state", room);
}

function sendHandToSocket(
  sock: Socket,
  session: GameSession,
  gamePlayers: Player[],
): void {
  const uid = sock.data.userId as string | undefined;
  if (!uid) return;
  const hand = session.hands.get(uid) ?? [];
  const playerCardCounts = gamePlayers.map((p) => ({
    userId: p.userId,
    count: session.hands.get(p.userId)?.length ?? 0,
  }));
  const payload: GameHandPayload = { hand, playerCardCounts };
  sock.emit("game:hand", payload);
}

function broadcastHands(
  roomId: string,
  session: GameSession,
  gamePlayers: Player[],
): void {
  io.sockets.sockets.forEach((sock) => {
    if (sock.rooms.has(roomId)) sendHandToSocket(sock, session, gamePlayers);
  });
}

// Rematch voting system
function checkWin(roomId: string, userId: string): boolean {
  const session = gameSessions.get(roomId);
  const room = rooms.get(roomId);
  if (!session || !room?.gamePlayers) return false;

  const hand = session.hands.get(userId) ?? [];
  if (hand.length > 0) return false;

  // This player won — transition to voting phase
  session.phase = "voting";
  if (session.botTimeout) {
    clearTimeout(session.botTimeout);
    session.botTimeout = null;
  }

  // Initialise votes — bots auto-vote rematch, humans get null
  session.votes = new Map(
    room.gamePlayers.map((p) => [
      p.userId,
      p.type === "bot" ? "rematch" : null,
    ]),
  );

  room.lastWinnerUserId = userId;

  const payload: GameOverPayload = {
    winnerUserId: userId,
    votes: buildVoteList(session),
    timeoutSeconds: 15,
  };
  io.to(roomId).emit("game:over", payload);

  // 15s timeout — default unvoted humans to 'leave'
  session.voteDeadline = Date.now() + 15000;
  session.voteTimeout = setTimeout(() => {
    resolveVotes(roomId, /* timedOut */ true);
  }, 15000);

  return true;
}

function buildVoteList(session: GameSession): PlayerVote[] {
  return [...session.votes.entries()].map(([userId, choice]) => ({
    userId,
    choice,
  }));
}

function resolveVotes(roomId: string, timedOut: boolean): void {
  const session = gameSessions.get(roomId);
  const room = rooms.get(roomId);
  if (!session || !room?.gamePlayers) return;

  if (session.voteTimeout) {
    clearTimeout(session.voteTimeout);
    session.voteTimeout = null;
  }

  // Timed out humans default to leave
  if (timedOut) {
    for (const [uid, choice] of session.votes) {
      if (choice === null) session.votes.set(uid, "leave");
    }
  }

  const allVotes = [...session.votes.values()];
  const anyLeave = allVotes.some((v) => v === "leave" || v === null);

  if (anyLeave) {
    // Return everyone to lobby
    room.phase = "lobby";
    room.gamePlayers = null;
    room.lastWinnerUserId = null;
    // Reset player ready states
    room.players.forEach((p) => {
      p.isReady = false;
    });
    gameSessions.delete(roomId);
    broadcast(roomId);
    io.to(roomId).emit("game:return-lobby");
  } else {
    // All voted rematch — start new game immediately
    startRematch(roomId);
  }
}

function startRematch(roomId: string): void {
  const room = rooms.get(roomId);
  if (!room?.gamePlayers) return;

  // Clear old session
  const oldSession = gameSessions.get(roomId);
  if (oldSession?.botTimeout) clearTimeout(oldSession.botTimeout);
  if (oldSession?.voteTimeout) clearTimeout(oldSession.voteTimeout);

  const gamePlayers = room.gamePlayers;
  const hands = deal(gamePlayers);

  // Winner of last game goes first (not 3♦ holder)
  const starterUserId =
    room.lastWinnerUserId ??
    gamePlayers.find((p) =>
      hands.get(p.userId)?.some((c) => c.rank === "3" && c.suit === "♦"),
    )?.userId ??
    gamePlayers[0].userId;

  const session: GameSession = {
    hands,
    currentTurn: starterUserId,
    centerPile: [],
    turnOrder: gamePlayers.map((p) => p.userId),
    isFirstTurn: false, // ← winner plays freely, no 3♦ requirement
    freeTurn: true, // ← free first turn for winner
    passCount: 0,
    lastPlayedBy: null,
    botTimeout: null,
    phase: "playing",
    votes: new Map(),
    voteTimeout: null,
    voteDeadline: 0,
  };

  gameSessions.set(roomId, session);
  broadcast(roomId);
  broadcastHands(roomId, session, gamePlayers);
  io.to(roomId).emit('game:rematch');   // tells clients to clear game-over state
  broadcastTurn(roomId, session);
  scheduleBotTurn(roomId);
}

// ─── Bot Calculation ────────────────────────────────────────────────────────────
const BOT_DELAY_MS = 1200;

function scheduleBotTurn(roomId: string): void {
  const session = gameSessions.get(roomId);
  const room = rooms.get(roomId);
  if (!session || !room?.gamePlayers) return;

  const currentPlayer = room.gamePlayers.find(
    (p) => p.userId === session.currentTurn,
  );
  if (!currentPlayer || currentPlayer.type !== "bot") return;

  // Cancel any existing pending bot action for this room
  if (session.botTimeout) clearTimeout(session.botTimeout);

  session.botTimeout = setTimeout(() => {
    // Re-fetch in case state changed during the delay
    const s = gameSessions.get(roomId);
    const r = rooms.get(roomId);
    if (!s || !r?.gamePlayers) return;
    if (s.currentTurn !== currentPlayer.userId) return; // turn moved on

    const hand = s.hands.get(currentPlayer.userId) ?? [];
    const isFreeTurn = s.freeTurn || s.lastPlayedBy === currentPlayer.userId;
    const lastPlayed =
      isFreeTurn || s.centerPile.length === 0
        ? null
        : s.centerPile.at(-1)!.cards;

    const move = calcBotMove(
      hand,
      lastPlayed,
      s.isFirstTurn,
      (currentPlayer as BotPlayer).level ?? "easy",
    );

    if (move.action === "pass") {
      executeBotPass(roomId, currentPlayer.userId, s, r);
    } else {
      executeBotPlay(roomId, currentPlayer.userId, move.cards, s, r);
    }
  }, BOT_DELAY_MS);
}

function executeBotPlay(
  roomId: string,
  userId: string,
  cards: Card[],
  session: GameSession,
  room: RoomState,
): void {
  const hand = session.hands.get(userId)!;
  const remaining = hand.filter(
    (c) => !cards.some((pc) => pc.rank === c.rank && pc.suit === c.suit),
  );

  session.hands.set(userId, remaining);
  session.centerPile.push({ userId, cards });
  session.isFirstTurn = false;
  session.freeTurn = false;
  session.passCount = 0;
  session.lastPlayedBy = userId;

  advanceTurn(roomId, userId, session);
  if (checkWin(roomId, userId)) return;
  broadcastTurn(roomId, session);
  scheduleBotTurn(roomId); // chain to next bot if needed
}

function executeBotPass(
  roomId: string,
  userId: string,
  session: GameSession,
  room: RoomState,
): void {
  session.passCount += 1;

  if (session.passCount >= session.turnOrder.length - 1) {
    session.freeTurn = true;
    session.passCount = 0;
  }

  advanceTurn(roomId, userId, session);
  broadcastTurn(roomId, session);
  scheduleBotTurn(roomId);
}

/** Shared turn advancement logic */
function advanceTurn(
  roomId: string,
  userId: string,
  session: GameSession,
): void {
  const myIdx = session.turnOrder.indexOf(userId);
  session.currentTurn =
    session.turnOrder[(myIdx + 1) % session.turnOrder.length];
}

function clearBotTimeout(roomId: string): void {
  const session = gameSessions.get(roomId);
  if (session?.botTimeout) {
    clearTimeout(session.botTimeout);
    session.botTimeout = null;
  }
}

// ─── Socket events ────────────────────────────────────────────────────────────

io.on("connection", (socket) => {
  console.log("[socket] Connected:", socket.id);

  socket.on("room:join", (payload: { roomId: string; player: HumanPlayer }) => {
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
    broadcast(roomId);
    const session = gameSessions.get(roomId);
    if (session && room.phase === "inGame" && room.gamePlayers) {
      sendHandToSocket(socket, session, room.gamePlayers);
      broadcastTurn(roomId, session);
    }
  });

  socket.on("player:sit", (payload: { roomId: string; userId: string }) => {
    const { roomId, userId } = payload;
    const room = rooms.get(roomId);
    if (!room || room.phase !== "lobby") return;
    if (room.players.length >= GAME_MAX_PLAYERS[room.selectedGame]) return;
    const idx = room.spectators.findIndex((p) => p.userId === userId);
    if (idx === -1) return;
    const [player] = room.spectators.splice(idx, 1);
    player.isReady = false;
    room.players.push(player);
    broadcast(roomId);
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
    broadcast(roomId);
  });

  socket.on(
    "player:ready",
    (payload: { roomId: string; userId: string; ready: boolean }) => {
      const { roomId, userId, ready } = payload;
      const room = rooms.get(roomId);
      if (!room || room.phase !== "lobby") return;
      const player = room.players.find((p) => p.userId === userId);
      if (!player) return;
      player.isReady = ready;
      broadcast(roomId);
    },
  );

  socket.on("room:set-game", (payload: { roomId: string; game: GameId }) => {
    const { roomId, game } = payload;
    const room = rooms.get(roomId);
    if (!room || room.hostUserId !== socket.data.userId) return;
    room.selectedGame = game;
    const max = GAME_MAX_PLAYERS[game];
    room.players.forEach((p) => (p.isReady = false));
    while (room.players.length > max)
      room.spectators.unshift(room.players.pop()!);
    broadcast(roomId);
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
      broadcast(roomId);
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
      broadcast(roomId);
    },
  );

  socket.on("room:start-game", (payload: { roomId: string }) => {
    const { roomId } = payload;
    const room = rooms.get(roomId);
    if (!room || room.hostUserId !== socket.data.userId) return;

    const max = GAME_MAX_PLAYERS[room.selectedGame];
    const humanPlayers = room.players.filter((p) => p.type === "human");

    if (room.botsEnabled) {
      if (humanPlayers.length === 0 || !humanPlayers.every((p) => p.isReady))
        return;
    } else {
      if (room.players.length !== max || !room.players.every((p) => p.isReady))
        return;
    }
    const BOT_NAMES = ["Bot Alice", "Bot Bob", "Bot Carol", "Bot Dave"];
    const gamePlayers: Player[] = [...room.players];

    if (room.botsEnabled) {
      for (let i = room.players.length; i < max; i++) {
        const n = i - room.players.length;
        const bot: BotPlayer = {
          type: "bot",
          botId: "placeholder",
          userId: `bot-${n}`,
          displayName: BOT_NAMES[n] ?? `Bot ${n + 1}`,
          isReady: true,
          avatarUrl: undefined,
          level: "easy",
        };
        gamePlayers.push(bot);
      }
    }
    const hands = deal(gamePlayers);
    // First turn: player who holds 3♦
    const starterUserId = (() => {
      for (const [uid, hand] of hands) {
        if (hand.some((c) => c.rank === "3" && c.suit === "♦")) return uid;
      }
      return gamePlayers[0].userId;
    })();
    const session: GameSession = {
      hands,
      currentTurn: starterUserId,
      centerPile: [],
      turnOrder: gamePlayers.map((p) => p.userId),
      isFirstTurn: true,
      freeTurn: false,
      passCount: 0,
      botTimeout: null,
      lastPlayedBy: null,
      phase: "playing",
      votes: new Map(),
      voteTimeout: null,
      voteDeadline: 0,
    };
    gameSessions.set(roomId, session);

    room.gamePlayers = gamePlayers;
    room.phase = "inGame";
    broadcast(roomId);
    broadcastHands(roomId, session, gamePlayers);
    broadcastTurn(roomId, session);
    scheduleBotTurn(roomId);
  });

  // ── Play cards ────────────────────────────────────────────────────────────
  socket.on("game:play", (payload: PlayCardsPayload) => {
    const { roomId, cards } = payload;
    const userId = socket.data.userId as string | undefined;
    if (!userId || !roomId || !cards?.length) return;

    const session = gameSessions.get(roomId);
    if (!session || session.currentTurn !== userId) return;

    const hand = session.hands.get(userId);
    if (!hand) return;

    // Clear the initial error message
    socket.emit("game:error", { reason: null });

    // Verify every played card is actually in the player's hand
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

    const isFirstTurn = session.isFirstTurn;
    // Free turn = center pile is empty (all others passed, or start of round)
    const lastPlayed =
      session.freeTurn || session.centerPile.length === 0
        ? null
        : session.centerPile.at(-1)!.cards;

    const validation = validatePlay(cards, lastPlayed, isFirstTurn);
    if (!validation.valid) {
      socket.emit("game:play:error", { reason: validation.reason });
      return;
    }

    // Commit
    session.hands.set(userId, remaining);
    session.centerPile.push({ userId, cards });
    session.isFirstTurn = false;
    session.freeTurn = false;
    session.passCount = 0;
    session.lastPlayedBy = userId;

    const myIdx = session.turnOrder.indexOf(userId);
    session.currentTurn =
      session.turnOrder[(myIdx + 1) % session.turnOrder.length];

    // Tell the player their new hand (server truth)
    const room = rooms.get(roomId);
    if (room?.gamePlayers) {
      const playerCardCounts = room.gamePlayers.map((p) => ({
        userId: p.userId,
        count: session.hands.get(p.userId)?.length ?? 0,
      }));
      socket.emit("game:play:ok", {
        hand: remaining,
        playerCardCounts,
      });
    }
    if (checkWin(roomId, userId)) return;
    broadcastTurn(roomId, session);
    scheduleBotTurn(roomId);
  });

  // ── Pass ──────────────────────────────────────────────────────────────────
  socket.on("game:pass", (payload: { roomId: string }) => {
    const { roomId } = payload;
    const userId = socket.data.userId as string | undefined;
    if (!userId || !roomId) return;
    const session = gameSessions.get(roomId);
    if (!session || session.currentTurn !== userId) return;
    const myIdx = session.turnOrder.indexOf(userId);
    session.currentTurn =
      session.turnOrder[(myIdx + 1) % session.turnOrder.length];
    session.passCount += 1;
    const otherPlayersCount = session.turnOrder.length - 1;
    if (session.passCount >= otherPlayersCount) {
      session.freeTurn = true;
      session.passCount = 0;
    }

    broadcastTurn(roomId, session);
    scheduleBotTurn(roomId);
  });

  socket.on("game:vote", (payload: { roomId: string; choice: VoteChoice }) => {
    const { roomId, choice } = payload;
    const userId = socket.data.userId as string | undefined;
    if (!userId || !roomId) return;

    const session = gameSessions.get(roomId);
    if (!session || session.phase !== "voting") return;
    if (!session.votes.has(userId)) return;

    session.votes.set(userId, choice);

    const remaining = Math.max(
      0,
      Math.ceil((session.voteDeadline - Date.now()) / 1000),
    );
    const update: VoteUpdatePayload = {
      votes: buildVoteList(session),
      timeoutSeconds: remaining,
    };
    io.to(roomId).emit("game:vote:update", update);

    // Check if all human players have voted
    const allVoted = [...session.votes.entries()].every(([uid, v]) => {
      const room = rooms.get(roomId);
      const player = room?.gamePlayers?.find((p) => p.userId === uid);
      return player?.type === "bot" || v !== null;
    });

    if (allVoted) setTimeout(() => resolveVotes(roomId, false), 800);
  });

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
      if (next) {
        room.hostUserId = next.userId;
      }
    }

    broadcast(roomId);
  });
});

server.listen(PORT, () => {
  console.log(`\n[server] Running at http://localhost:${PORT}\n`);
});
