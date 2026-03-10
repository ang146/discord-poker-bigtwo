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
  Suit,
  Rank,
  GameHandPayload,
} from "../../shared/types";
import { GAME_MAX_PLAYERS } from "../../shared/types";

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
};

const gameSessions = new Map<string, GameSession>();

// ─── Card dealing ─────────────────────────────────────────────────────────────

const SUITS: Suit[] = ["♦", "♣", "♥", "♠"];
const RANKS: Rank[] = [
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
  "2",
];

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
    console.log(`[socket] ${player.displayName} joined ${roomId}`);
    broadcast(roomId);

    // Re-send hand if reconnecting during an active game
    const session = gameSessions.get(roomId);
    if (session && room.phase === "inGame" && room.gamePlayers) {
      sendHandToSocket(socket, session, room.gamePlayers);
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

    // Build final seat list — bots injected here only, never stored in room.players
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
        };
        gamePlayers.push(bot);
      }
    }

    const session: GameSession = { hands: deal(gamePlayers) };
    gameSessions.set(roomId, session);

    room.gamePlayers = gamePlayers;
    room.phase = "inGame";

    console.log(
      `[socket] Game started in ${roomId} — ${gamePlayers.length} players`,
    );
    broadcast(roomId);
    broadcastHands(roomId, session, gamePlayers);
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
        console.log(`[socket] Host → ${next.displayName}`);
      }
    }

    broadcast(roomId);
  });
});

server.listen(PORT, () => {
  console.log(`\n[server] Running at http://localhost:${PORT}\n`);
});
