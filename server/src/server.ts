import express from "express";
import dotenv from "dotenv";
import http from "http";
import { Server } from "socket.io";
import type {
  GameId,
  Player,
  HumanPlayer,
  BotPlayer,
  RoomState,
} from "../../shared/types";
import { GAME_MAX_PLAYERS } from "../../shared/types";

dotenv.config({ path: "../.env" });

const PORT = process.env.PORT ?? 3001;
const CLIENT_ID = process.env.VITE_DISCORD_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET ?? "";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.warn(
    "[server] WARNING: VITE_DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET not set in .env",
  );
}

type TokenResponse = { access_token: string; token_type: string };

// ─── Express ─────────────────────────────────────────────────────────────────

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
  } catch (err) {
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
    botsEnabled: false,
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

// ─── Socket events ────────────────────────────────────────────────────────────

io.on("connection", (socket) => {
  console.log("[socket] Connected:", socket.id);

  // Join room as spectator first
  socket.on("room:join", (payload: { roomId: string; player: HumanPlayer }) => {
    const { roomId, player } = payload;
    if (!roomId || !player?.userId) return;

    const room = getOrCreateRoom(roomId, player.userId);

    // If already present (e.g. reconnect), update display info but preserve state
    const existing = findPlayer(room, player.userId);
    if (existing) {
      existing.displayName = player.displayName;
      existing.avatarUrl = player.avatarUrl;
    } else {
      // New join — always enters as spectator
      room.spectators.push({ ...player, isReady: false, type: "human" });
    }

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.userId = player.userId;

    console.log(`[socket] ${player.displayName} joined ${roomId} as spectator`);
    broadcast(roomId);
  });

  // Sit down at the table (spectator → player)
  socket.on("player:sit", (payload: { roomId: string; userId: string }) => {
    const { roomId, userId } = payload;
    const room = rooms.get(roomId);
    if (!room) return;

    const maxPlayers = GAME_MAX_PLAYERS[room.selectedGame];
    if (room.players.length >= maxPlayers) return; // table full

    const specIdx = room.spectators.findIndex((p) => p.userId === userId);
    if (specIdx === -1) return; // not a spectator

    const [player] = room.spectators.splice(specIdx, 1);
    player.isReady = false;
    room.players.push(player);
    console.log(`[socket] ${player.displayName} sat down in ${roomId}`);
    broadcast(roomId);
  });

  // Stand up (player → spectator)
  socket.on("player:stand", (payload: { roomId: string; userId: string }) => {
    const { roomId, userId } = payload;
    const room = rooms.get(roomId);
    if (!room) return;

    const pIdx = room.players.findIndex((p) => p.userId === userId);
    if (pIdx === -1) return;

    const [player] = room.players.splice(pIdx, 1);
    player.isReady = false;
    room.spectators.push(player);
    console.log(`[socket] ${player.displayName} stood up in ${roomId}`);
    broadcast(roomId);
  });

  // Toggle ready (only seated players)
  socket.on(
    "player:ready",
    (payload: { roomId: string; userId: string; ready: boolean }) => {
      const { roomId, userId, ready } = payload;
      const room = rooms.get(roomId);
      if (!room) return;

      const player = room.players.find((p) => p.userId === userId);
      if (!player) return;
      player.isReady = ready;
      broadcast(roomId);
    },
  );

  // Change game (host only)
  socket.on("room:set-game", (payload: { roomId: string; game: GameId }) => {
    const { roomId, game } = payload;
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.hostUserId !== socket.data.userId) return; // guard

    room.selectedGame = game;
    // Reset ready + move excess players back to spectators if new max is smaller
    const max = GAME_MAX_PLAYERS[game];
    room.players.forEach((p) => (p.isReady = false));
    while (room.players.length > max) {
      const evicted = room.players.pop()!;
      room.spectators.unshift(evicted);
    }
    broadcast(roomId);
  });

  // Set bot enabled (host only)
  socket.on(
    "room:set-bots",
    (payload: { roomId: string; enabled: boolean }) => {
      const { roomId, enabled } = payload;
      const room = rooms.get(roomId);
      if (!room || room.hostUserId !== socket.data.userId) return;

      room.botsEnabled = enabled;
      // Reset human players' ready state so they re-confirm with new bot config
      room.players.forEach((p) => {
        p.isReady = false;
      });
      console.log(`[socket] Room ${roomId} botsEnabled=${enabled}`);
      broadcast(roomId);
    },
  );

  // Transfer host (host only)
  socket.on(
    "room:transfer-host",
    (payload: { roomId: string; toUserId: string }) => {
      const { roomId, toUserId } = payload;
      const room = rooms.get(roomId);
      if (!room) return;
      if (room.hostUserId !== socket.data.userId) return; // guard

      const target = findPlayer(room, toUserId);
      if (!target) return;

      room.hostUserId = toUserId;
      console.log(`[socket] Host transferred to ${toUserId} in ${roomId}`);
      broadcast(roomId);
    },
  );

  // Start game (host only, all players ready)
  socket.on("room:start-game", (payload: { roomId: string }) => {
    const { roomId } = payload;
    const room = rooms.get(roomId);
    if (!room || room.hostUserId !== socket.data.userId) return;

    const max = GAME_MAX_PLAYERS[room.selectedGame];
    const humanPlayers = room.players.filter((p) => p.type === "human");

    // Validate readiness based on bot mode
    if (room.botsEnabled) {
      // Bots fill empty seats — only require all humans to be ready
      if (humanPlayers.length === 0 || !humanPlayers.every((p) => p.isReady))
        return;
    } else {
      // No bots — all seats must be filled and everyone ready
      if (room.players.length !== max || !room.players.every((p) => p.isReady))
        return;
    }

    // Inject bots into empty seats (only in gamePlayers, never in room.players)
    const BOT_NAMES = ["Bot Alice", "Bot Bob", "Bot Carol", "Bot Dave"];
    const gamePlayers: Player[] = [...room.players];

    if (room.botsEnabled) {
      for (let i = room.players.length; i < max; i++) {
        const n = i - room.players.length;
        gamePlayers.push({
          type: "bot",
          botId: "placeholder",
          userId: `bot-${n}`,
          displayName: BOT_NAMES[n] ?? `Bot ${n + 1}`,
          isReady: true,
          avatarUrl: undefined,
        } satisfies BotPlayer);
      }
    }

    room.gamePlayers = gamePlayers;
    room.phase = "inGame";

    console.log(
      `[socket] Game starting in ${roomId} with ${gamePlayers.length} players`,
    );
    broadcast(roomId); // room:state carries everything
    io.to(roomId).emit("game:starting", { roomId }); // lightweight signal for animations etc.
  });

  // Disconnect
  socket.on("disconnecting", () => {
    const roomId = socket.data.roomId as string | undefined;
    const userId = socket.data.userId as string | undefined;
    if (!roomId || !userId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    removeFromAll(room, userId);
    console.log(`[socket] ${userId} left ${roomId}`);

    if (room.spectators.length === 0 && room.players.length === 0) {
      rooms.delete(roomId);
      return;
    }

    // Re-assign host if host left
    if (room.hostUserId === userId) {
      const next = room.players[0] ?? room.spectators[0];
      if (next) {
        room.hostUserId = next.userId;
        console.log(`[socket] Host reassigned to ${next.displayName}`);
      }
    }

    broadcast(roomId);
  });
});

server.listen(PORT, () => {
  console.log(`\n[server] Running at http://localhost:${PORT}\n`);
});
