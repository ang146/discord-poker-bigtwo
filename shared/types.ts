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

// ─── Player types ─────────────────────────────────────────────────────────────

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
  spectators: Player[];
  /** Human players seated at the table */
  players: Player[];
  /**
   * Set when the game starts — includes bots injected into empty seats.
   * Null in lobby phase. Clients use this (not players[]) for in-game rendering.
   */
  gamePlayers: Player[] | null;
  selectedGame: GameId;
  hostUserId: string;
  botsEnabled: boolean;
  phase: RoomPhase;
};
