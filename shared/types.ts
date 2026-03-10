// ─── Game catalogue ───────────────────────────────────────────────────────────

export type GameId = "big-two";

export type GameInfo = {
  id: GameId;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  description: string;
};

export const GAMES: GameInfo[] = [
  {
    id: "big-two",
    name: "Big Two",
    minPlayers: 2,
    maxPlayers: 4,
    description: "Classic Cantonese climbing card game",
  },
];

export const GAME_MAX_PLAYERS: Record<GameId, number> = {
  "big-two": 4,
};

// ─── Card types ───────────────────────────────────────────────────────────────
// Suit order: ♦ < ♣ < ♥ < ♠ (lowest to highest in Big Two)
// Rank order: 3 < 4 < … < K < A < 2 (lowest to highest in Big Two)

export type Suit = "♦" | "♣" | "♥" | "♠";
export type Rank =
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K"
  | "A"
  | "2";

export type Card = {
  suit: Suit;
  rank: Rank;
};

// ─── Player types (discriminated union) ───────────────────────────────────────

export type PlayerType = "human" | "bot";

interface BasePlayer {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  isReady: boolean;
  type: PlayerType;
}

export interface HumanPlayer extends BasePlayer {
  type: "human";
}

export interface BotPlayer extends BasePlayer {
  type: "bot";
  botId: string;
}

export type Player = HumanPlayer | BotPlayer;

// ─── Room / game state ────────────────────────────────────────────────────────

export type RoomPhase = "lobby" | "inGame";

export type RoomState = {
  roomId: string;
  /** Users present but not seated */
  spectators: Player[];
  /** Human players seated at the table */
  players: Player[];
  /**
   * Final seat order including bots — populated when game starts.
   * Null during lobby. Clients use this for in-game rendering.
   */
  gamePlayers: Player[] | null;
  selectedGame: GameId;
  hostUserId: string;
  botsEnabled: boolean;
  phase: RoomPhase;
};

// ─── Socket payloads ─────────────────────────────────────────────────────────

/** Sent individually to each player when a game starts */
export type GameHandPayload = {
  /** This player's 13 cards */
  hand: Card[];
  /** Card counts for every seat (for rendering face-down hands) */
  playerCardCounts: { userId: string; count: number }[];
};
