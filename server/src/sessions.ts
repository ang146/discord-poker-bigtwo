import type { Server, Socket } from "socket.io";
import type {
  Card,
  Player,
  PlayedTurn,
  VoteChoice,
  GameHandPayload,
  GameTurnState,
} from "../../shared/types";
import { SUITS, RANKS } from "../../shared/types";

// ─── GameSession type ─────────────────────────────────────────────────────────

export type GameSession = {
  hands: Map<string, Card[]>;
  currentTurn: string;
  centerPile: PlayedTurn[];
  turnOrder: string[];
  isFirstTurn: boolean;
  freeTurn: boolean;
  passCount: number;
  lastPlayedBy: string | null;
  botTimeout: ReturnType<typeof setTimeout> | null;
  phase: "playing" | "voting";
  votes: Map<string, VoteChoice | null>;
  voteTimeout: ReturnType<typeof setTimeout> | null;
  voteDeadline: number;
};

export const gameSessions = new Map<string, GameSession>();

// ─── Deck helpers ─────────────────────────────────────────────────────────────

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

export function deal(players: Player[]): Map<string, Card[]> {
  let deck = shuffle(createDeck());
  const hands = new Map<string, Card[]>();
  let handsValid = false;
  while (!handsValid) {
    deck = shuffle(deck);
    hands.clear();
    players.forEach((p, i) => {
      const playerHands = deck.slice(i * 13, (i + 1) * 13);
      handsValid =
        (handsValid &&
          playerHands.filter((c) => c.rank === "A" || c.rank === "2").length >
            0) ||
        playerHands.filter(
          (c) => c.rank === "J" || c.rank === "Q" || c.rank === "K",
        ).length > 2;
      hands.set(p.userId, playerHands);
    });
  }
  return hands;
}

// ─── Broadcast helpers ────────────────────────────────────────────────────────

export function broadcastTurn(
  io: Server,
  roomId: string,
  session: GameSession,
): void {
  const state: GameTurnState = {
    currentTurn: session.currentTurn,
    centerPile: session.centerPile,
    playerCardCounts: session.turnOrder.map((uid) => ({
      userId: uid,
      count: session.hands.get(uid)?.length ?? 0,
    })),
    freeTurn: session.freeTurn,
  };
  io.to(roomId).emit("game:turn", state);
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

export function broadcastHands(
  io: Server,
  roomId: string,
  session: GameSession,
  gamePlayers: Player[],
): void {
  io.sockets.sockets.forEach((sock) => {
    if (sock.rooms.has(roomId)) sendHandToSocket(sock, session, gamePlayers);
  });
}
