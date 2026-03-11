import type { Card, Suit, Rank, BotLevel } from "./types";
import { SUITS, RANKS } from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function suitIndex(s: Suit): number {
  return SUITS.indexOf(s);
}
export function rankIndex(r: Rank): number {
  return RANKS.indexOf(r);
}

/** Sort cards by rank ascending, then suit ascending as tiebreak */
export function sortCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const rd = rankIndex(a.rank) - rankIndex(b.rank);
    return rd !== 0 ? rd : suitIndex(a.suit) - suitIndex(b.suit);
  });
}

/** Highest card in a set (by rank, then suit) */
function highest(cards: Card[]): Card {
  return sortCards(cards).at(-1)!;
}

/** Compare two cards: positive if a > b */
function compareCards(a: Card, b: Card): number {
  const rd = rankIndex(a.rank) - rankIndex(b.rank);
  return rd !== 0 ? rd : suitIndex(a.suit) - suitIndex(b.suit);
}

// ─── Combination types ────────────────────────────────────────────────────────

export type ComboRank =
  | "single"
  | "pair"
  | "triple"
  | "straight" // rank 1
  | "flush" // rank 2
  | "fullHouse" // rank 3
  | "fourOfAKind" // rank 4
  | "straightFlush"; // rank 5

// Numeric rank for ordering 5-card combos
const COMBO_RANK_ORDER: ComboRank[] = [
  "straight",
  "flush",
  "fullHouse",
  "fourOfAKind",
  "straightFlush",
];

export type ParsedCombo =
  | { type: "single"; card: Card }
  | { type: "pair"; high: Card }
  | { type: "triple"; rank: Rank }
  | { type: "straight"; high: Card }
  | { type: "flush"; high: Card }
  | { type: "fullHouse"; tripleRank: Rank }
  | { type: "fourOfAKind"; quadRank: Rank }
  | { type: "straightFlush"; high: Card };

export type ParseError = { error: string };
export type ParseResult = ParsedCombo | ParseError;

export function isError(r: ParseResult): r is ParseError {
  return "error" in r;
}

// ─── 5-card straight detection ────────────────────────────────────────────────

/**
 * Returns the high card of a straight, or null if not a straight.
 * Valid straights: any 5 consecutive ranks — EXCEPT any hand that
 * simultaneously contains K, A, and 2 (wrap-around is banned in Big Two).
 *
 * Special cases handled:
 *   A-2-3-4-5  (indices 12,0,1,2,3  → sorted: 3,4,5,A,2 → gaps won't be [1,1,1,1])
 *   2-3-4-5-6  (indices 0,1,2,3,13 — 2 is rank 13)
 * The cleanest approach: check all valid 5-rank windows in RANKS order,
 * treating the deck as circular only for the wrap cases above.
 */
const STRAIGHT_WINDOWS: Rank[][] = (() => {
  const windows: Rank[][] = [];
  // Standard consecutive windows within RANKS (index 0..12)
  for (let i = 0; i <= RANKS.length - 5; i++) {
    windows.push(RANKS.slice(i, i + 5));
  }
  // Wrap-around: A-2-3-4-5 and 2-3-4-5-6 already covered above
  // because 2 is at index 12, so window [8..12] = 10,J,Q,K,A and [9..13] would be 10-J-Q-K-A-2
  // Actually 2 is last, so A-2-3-4-5 needs special treatment:
  windows.push(["A", "2", "3", "4", "5"]); // wrap: A(idx12→treated as before 3)
  return windows;
})();

function isBannedStraight(ranks: Set<Rank>): boolean {
  // K + A + 2 together = invalid (prevents Q-K-A-2-3 type wraps)
  return ranks.has("K") && ranks.has("A") && ranks.has("2");
}

function detectStraight(sorted: Card[]): Card | null {
  const rankSet = new Set(sorted.map((c) => c.rank));
  if (isBannedStraight(rankSet)) return null;

  for (const window of STRAIGHT_WINDOWS) {
    if (window.every((r) => rankSet.has(r))) {
      // High card = highest rank in the window, then highest suit among tied ranks
      const windowSet = new Set(window);
      const inWindow = sorted.filter((c) => windowSet.has(c.rank));
      return highest(inWindow);
    }
  }
  return null;
}

// ─── Parse a played hand into a typed combo ───────────────────────────────────

export function parseCombo(cards: Card[]): ParseResult {
  if (cards.length === 0) return { error: "No cards played" };
  if (cards.length === 4 || cards.length > 5) {
    return { error: "Must play 1, 2, 3, or 5 cards" };
  }

  const sorted = sortCards(cards);

  // ── 1 card ──
  if (sorted.length === 1) {
    return { type: "single", card: sorted[0] };
  }

  // ── 2 cards ──
  if (sorted.length === 2) {
    if (sorted[0].rank !== sorted[1].rank)
      return { error: "A pair must be two cards of the same rank" };
    return { type: "pair", high: sorted[1] }; // sorted by suit, so [1] is higher suit
  }

  // ── 3 cards ──
  if (sorted.length === 3) {
    if (
      !(sorted[0].rank === sorted[1].rank && sorted[1].rank === sorted[2].rank)
    )
      return { error: "Three of a kind must be three cards of the same rank" };
    return { type: "triple", rank: sorted[0].rank };
  }

  // ── 5 cards ──
  const rankCounts = new Map<Rank, number>();
  for (const c of sorted)
    rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);
  const counts = [...rankCounts.values()].sort((a, b) => b - a); // descending
  const allSameSuit = sorted.every((c) => c.suit === sorted[0].suit);
  const straightHigh = detectStraight(sorted);

  // Straight flush / straight (check first — flush check would also catch it)
  if (straightHigh !== null) {
    if (allSameSuit) return { type: "straightFlush", high: straightHigh };
    return { type: "straight", high: straightHigh };
  }

  // Flush
  if (allSameSuit) {
    return { type: "flush", high: highest(sorted) };
  }

  // Full house: counts = [3, 2]
  if (counts[0] === 3 && counts[1] === 2) {
    // Triple rank = the rank that appears 3 times
    const tripleRank = [...rankCounts.entries()].find(([, v]) => v === 3)![0];
    return { type: "fullHouse", tripleRank };
  }

  // Four of a kind: counts = [4, 1]
  if (counts[0] === 4) {
    const quadRank = [...rankCounts.entries()].find(([, v]) => v === 4)![0];
    return { type: "fourOfAKind", quadRank };
  }

  return { error: "Not a valid combination" };
}

// ─── Compare two parsed combos ────────────────────────────────────────────────
//
// Returns positive if `current` beats `previous`, negative if not.
// Assumes both are valid and same type (or current is a higher-ranked 5-card combo).
// Returns null if the types are incompatible (caller should reject).

export function compareCombo(
  current: ParsedCombo,
  previous: ParsedCombo,
): number | null {
  // Different combo sizes are never compatible, except 5-card combos can beat each other
  // regardless of specific type (straight < flush < fullHouse < fourOfAKind < straightFlush)
  const fiveCardTypes = new Set<ComboRank>([
    "straight",
    "flush",
    "fullHouse",
    "fourOfAKind",
    "straightFlush",
  ]);
  const curIs5 = fiveCardTypes.has(current.type);
  const preIs5 = fiveCardTypes.has(previous.type);

  if (current.type !== previous.type) {
    // Both must be 5-card combos to compare across types
    if (!curIs5 || !preIs5) return null;
    // Higher combo rank always wins regardless of card values
    return (
      COMBO_RANK_ORDER.indexOf(current.type) -
      COMBO_RANK_ORDER.indexOf(previous.type)
    );
  }

  // Same combo type comparison:
  switch (current.type) {
    case "single":
      return compareCards(
        current.card,
        (previous as Extract<ParsedCombo, { type: "single" }>).card,
      );

    case "pair":
      // Pair comparison: high card decides (rank first, then suit)
      return compareCards(
        current.high,
        (previous as Extract<ParsedCombo, { type: "pair" }>).high,
      );

    case "triple":
      // Only rank matters for triples (all 4 suits must be accounted for, no suit tiebreak)
      return (
        rankIndex(current.rank) -
        rankIndex((previous as Extract<ParsedCombo, { type: "triple" }>).rank)
      );

    case "straight":
    case "straightFlush": {
      // Compare high card (rank then suit)
      const prev = previous as Extract<
        ParsedCombo,
        { type: "straight" | "straightFlush" }
      >;
      return compareCards(current.high, prev.high);
    }

    case "flush": {
      // Flush: compare high card rank first, then suit of that high card
      const prev = previous as Extract<ParsedCombo, { type: "flush" }>;
      return compareCards(current.high, prev.high);
    }

    case "fullHouse": {
      // Full house: compare the triple rank only
      const prev = previous as Extract<ParsedCombo, { type: "fullHouse" }>;
      return rankIndex(current.tripleRank) - rankIndex(prev.tripleRank);
    }

    case "fourOfAKind": {
      // Four of a kind: compare the quad rank only
      const prev = previous as Extract<ParsedCombo, { type: "fourOfAKind" }>;
      return rankIndex(current.quadRank) - rankIndex(prev.quadRank);
    }

    default:
      return null;
  }
}

// ─── Top-level play validator ─────────────────────────────────────────────────

export type PlayValidation =
  | { valid: true; combo: ParsedCombo }
  | { valid: false; reason: string };

export function validatePlay(
  cards: Card[],
  lastPlayed: Card[] | null, // null = no restriction (free turn)
  isFirstTurn: boolean, // round 0: must contain 3♦
): PlayValidation {
  // First turn: must include 3♦
  if (isFirstTurn) {
    const has3D = cards.some((c) => c.rank === "3" && c.suit === "♦");
    if (!has3D) return { valid: false, reason: "First play must include 3♦" };
  }

  const currentCombo = parseCombo(cards);
  if (isError(currentCombo))
    return { valid: false, reason: currentCombo.error };

  // Free turn — no previous play to beat
  if (!lastPlayed || lastPlayed.length === 0) {
    return { valid: true, combo: currentCombo };
  }

  const previousCombo = parseCombo(lastPlayed);
  if (isError(previousCombo)) {
    // Previous was invalid somehow — shouldn't happen, but allow play
    return { valid: true, combo: currentCombo };
  }

  // Card count must match, unless both are 5-card combos
  const fiveCardTypes = new Set([
    "straight",
    "flush",
    "fullHouse",
    "fourOfAKind",
    "straightFlush",
  ]);
  const bothFive =
    fiveCardTypes.has(currentCombo.type) &&
    fiveCardTypes.has(previousCombo.type);
  if (!bothFive && currentCombo.type !== previousCombo.type) {
    return {
      valid: false,
      reason: `Must play the same combination type as the previous player`,
    };
  }

  const result = compareCombo(currentCombo, previousCombo);
  if (result === null)
    return { valid: false, reason: "Incompatible combination types" };
  if (result <= 0)
    return { valid: false, reason: "Your play does not beat the previous one" };

  return { valid: true, combo: currentCombo };
}

// ─── Bot move calculation ─────────────────────────────────────────────────────

export type BotMove = { action: "play"; cards: Card[] } | { action: "pass" };

/**
 * Easy bot: always plays the smallest valid combination.
 * Priority: single < pair < triple < 5-card combos (never voluntarily plays
 * a higher combo type when a lower one would suffice).
 */
export function calcBotMove(
  hand: Card[],
  lastPlayed: Card[] | null,
  isFirstTurn: boolean,
  _level: BotLevel = "easy",
): BotMove {
  const sorted = sortCards(hand);

  // ── Free turn (start of game or everyone passed) ──────────────────────────
  if (!lastPlayed || lastPlayed.length === 0) {
    if (isFirstTurn) {
      const threeDiamonds = sorted.find(
        (c) => c.rank === "3" && c.suit === "♦",
      );
      if (threeDiamonds) return { action: "play", cards: [threeDiamonds] };
    }

    return { action: "play", cards: [sorted[0]] };
  }

  const prevCombo = parseCombo(lastPlayed);
  if (isError(prevCombo)) return { action: "pass" };

  switch (prevCombo.type) {
    case "single": {
      const candidate = sorted.find((c) => compareCards(c, prevCombo.card) > 0);
      if (candidate) return { action: "play", cards: [candidate] };
      return { action: "pass" };
    }
    case "pair": {
      // Find all pairs, pick the smallest that beats the previous pair
      const pairs = findSmallestBeatingCombo(sorted, 2, prevCombo);
      if (pairs) return { action: "play", cards: pairs };
      return { action: "pass" };
    }

    case "triple": {
      const triple = findSmallestBeatingCombo(sorted, 3, prevCombo);
      if (triple) return { action: "play", cards: triple };
      return { action: "pass" };
    }

    case "straight":
    case "flush":
    case "fullHouse":
    case "fourOfAKind":
    case "straightFlush": {
      const fiveCard = findSmallestBeating5Card(sorted, prevCombo);
      if (fiveCard) return { action: "play", cards: fiveCard };
      return { action: "pass" };
    }
  }
}

// ─── Helpers for bot move finding ────────────────────────────────────────────
function combinations(cards: Card[], size: number): Card[][] {
  if (size === 0) return [[]];
  if (cards.length < size) return [];
  const [first, ...rest] = cards;
  const withFirst = combinations(rest, size - 1).map((c) => [first, ...c]);
  const withoutFirst = combinations(rest, size);
  return [...withFirst, ...withoutFirst];
}

/**
 * For pairs and triples: find the smallest valid combo of the right size
 * that beats `previous`. Returns the cards or null.
 */
function findSmallestBeatingCombo(
  sorted: Card[],
  size: 2 | 3,
  previous: ParsedCombo,
): Card[] | null {
  const candidates = combinations(sorted, size)
    .map((cards) => ({ cards, parsed: parseCombo(cards) }))
    .filter(({ parsed }) => !isError(parsed))
    .filter(({ parsed }) => {
      const cmp = compareCombo(parsed as ParsedCombo, previous);
      return cmp !== null && cmp > 0;
    })
    .sort((a, b) => {
      const cmp = compareCombo(
        a.parsed as ParsedCombo,
        b.parsed as ParsedCombo,
      );
      return cmp ?? 0;
    });
  return candidates[0]?.cards ?? null;
}

/**
 * For 5-card combos: find the smallest valid 5-card hand that beats `previous`.
 */
function findSmallestBeating5Card(
  sorted: Card[],
  previous: ParsedCombo,
): Card[] | null {
  const candidates = combinations(sorted, 5)
    .map((cards) => ({ cards, parsed: parseCombo(cards) }))
    .filter(({ parsed }) => !isError(parsed))
    .filter(({ parsed }) => {
      const cmp = compareCombo(parsed as ParsedCombo, previous);
      return cmp !== null && cmp > 0;
    })
    .sort((a, b) => {
      const cmp = compareCombo(
        a.parsed as ParsedCombo,
        b.parsed as ParsedCombo,
      );
      return cmp ?? 0;
    });

  return candidates[0]?.cards ?? null;
}
