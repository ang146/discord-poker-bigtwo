import type { Card, Rank, PlayedTurn, BotLevel } from "../../shared/types";
import { RANKS, SUITS } from "../../shared/types";
import {
  sortCards,
  parseCombo,
  compareCombo,
  isError,
  combinations,
  findSmallestBeatingCombo,
  findSmallestBeating5Card,
} from "../../shared/cardLogic";
import type { ParsedCombo } from "../../shared/cardLogic";

// ─── Public types ─────────────────────────────────────────────────────────────

export type BotMove = { action: "play"; cards: Card[] } | { action: "pass" };

export type BotContext = {
  hand: Card[];
  lastPlayed: Card[] | null;
  isFirstTurn: boolean;
  level: BotLevel;
  opponentCounts: { userId: string; count: number }[]; // all players incl self
  centerPile: PlayedTurn[];
};

// ─── Entry point ──────────────────────────────────────────────────────────────

export function calcBotMove(ctx: BotContext): BotMove {
  switch (ctx.level) {
    case "easy":
      return easyMove(ctx);
    case "normal":
      return normalMove(ctx);
    case "hard":
      return hardMove(ctx);
    default:
      return easyMove(ctx);
  }
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function rankIndex(r: Rank): number {
  return RANKS.indexOf(r);
}

function compareCards(a: Card, b: Card): number {
  const rd = rankIndex(a.rank) - rankIndex(b.rank);
  return rd !== 0 ? rd : SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
}

/** Minimum opponent card count (excluding self) */
function minOpponentCount(ctx: BotContext, selfUserId?: string): number {
  const opponents = selfUserId
    ? ctx.opponentCounts.filter((o) => o.userId !== selfUserId)
    : ctx.opponentCounts;
  if (opponents.length === 0) return 99;
  return Math.min(...opponents.map((o) => o.count));
}

/** Cards already seen in the pile */
function playedCards(ctx: BotContext): Set<string> {
  const seen = new Set<string>();
  for (const turn of ctx.centerPile) {
    for (const c of turn.cards) seen.add(`${c.rank}${c.suit}`);
  }
  return seen;
}

/** Is this card a "power card" (2 of any suit) */
function isPower(c: Card): boolean {
  return c.rank === "2";
}

/** Score a hand by how many combos it contains (higher = better composition) */
type HandProfile = {
  pairs: Card[][];
  triples: Card[][];
  fiveCards: Card[][];
  singles: Card[];
  hasPower: boolean;
};

function analyseHand(hand: Card[]): HandProfile {
  const sorted = sortCards(hand);
  const byRank = new Map<Rank, Card[]>();
  for (const c of sorted) {
    const group = byRank.get(c.rank) ?? [];
    group.push(c);
    byRank.set(c.rank, group);
  }

  const pairs: Card[][] = [];
  const triples: Card[][] = [];
  const singles: Card[] = [];

  for (const [, group] of byRank) {
    if (group.length >= 4) {
      triples.push(group.slice(0, 3));
    }
    if (group.length >= 3) {
      triples.push(group.slice(0, 3));
    }
    if (group.length >= 2) {
      pairs.push(group.slice(0, 2));
    }
    if (group.length === 1) singles.push(group[0]);
  }

  // Deduplicate triples (we might have pushed twice for 4-of-a-kind)
  const uniqueTriples = triples.filter(
    (t, i) => triples.findIndex((u) => u[0].rank === t[0].rank) === i,
  );

  // Find valid 5-card combos
  const fiveCards = combinations(sorted, 5).filter((cards) => {
    const parsed = parseCombo(cards);
    return !isError(parsed);
  });

  return {
    pairs,
    triples: uniqueTriples,
    fiveCards,
    singles,
    hasPower: sorted.some(isPower),
  };
}

/** Preferred play mode based on hand composition */
type Strategy = "pair" | "combo" | "single";

function chooseStrategy(profile: HandProfile, handSize: number): Strategy {
  if (handSize <= 3) return "single"; // endgame — clear fast
  const pairCoverage = profile.pairs.length * 2;
  const singleCount = profile.singles.length;
  // If most cards are in pairs/triples, prefer pair strategy
  if (pairCoverage >= handSize - singleCount && singleCount <= 2) return "pair";
  if (profile.fiveCards.length >= 2) return "combo";
  return "single";
}

// ─── Easy bot ─────────────────────────────────────────────────────────────────
// Always plays the smallest valid move. No strategic awareness.

function easyMove(ctx: BotContext): BotMove {
  const { hand, lastPlayed, isFirstTurn } = ctx;
  const sorted = sortCards(hand);

  if (!lastPlayed || lastPlayed.length === 0) {
    if (isFirstTurn) {
      const seed = sorted.find((c) => c.rank === "3" && c.suit === "♦");
      if (seed) return { action: "play", cards: [seed] };
    }
    return { action: "play", cards: [sorted[0]] };
  }

  const prev = parseCombo(lastPlayed);
  if (isError(prev)) return { action: "pass" };

  return smallestBeating(sorted, prev) ?? { action: "pass" };
}

// ─── Normal bot ───────────────────────────────────────────────────────────────
// Analyses hand composition, plays combos strategically, considers opponent counts.

function normalMove(ctx: BotContext): BotMove {
  const { hand, lastPlayed, isFirstTurn } = ctx;
  const sorted = sortCards(hand);
  const profile = analyseHand(hand);
  const minOpp = minOpponentCount(ctx);

  // ── Free turn ──────────────────────────────────────────────────────────────
  if (!lastPlayed || lastPlayed.length === 0) {
    if (isFirstTurn) {
      const seed = sorted.find((c) => c.rank === "3" && c.suit === "♦");
      if (seed) return playWithContext(sorted, profile, seed);
    }

    // Endgame: just clear the hand fast
    if (hand.length <= 3) return { action: "play", cards: [sorted[0]] };

    const strategy = chooseStrategy(profile, hand.length);
    return freeTurnPlay(sorted, profile, strategy);
  }

  // ── Must beat previous ─────────────────────────────────────────────────────
  const prev = parseCombo(lastPlayed);
  if (isError(prev)) return { action: "pass" };

  // If opponent is about to win (1 card), beat aggressively
  if (minOpp <= 1 && prev.type === "single") {
    const biggest = [...sorted]
      .reverse()
      .find(
        (c) =>
          compareCards(
            c,
            (prev as Extract<ParsedCombo, { type: "single" }>).card,
          ) > 0,
      );
    if (biggest) return { action: "play", cards: [biggest] };
  }

  // Safe plays: if opponent has ≤4 cards, prefer 5-card combos (they can't match)
  if (
    minOpp <= 4 &&
    prev.type !== "single" &&
    prev.type !== "pair" &&
    prev.type !== "triple"
  ) {
    const fiveCard = findSmallestBeating5Card(sorted, prev);
    if (fiveCard) return { action: "play", cards: fiveCard };
  }

  return smallestBeating(sorted, prev) ?? { action: "pass" };
}

// ─── Hard bot ─────────────────────────────────────────────────────────────────
// All normal logic + card history tracking, power card hoarding, blocking.

function hardMove(ctx: BotContext): BotMove {
  const { hand, lastPlayed, isFirstTurn, centerPile } = ctx;
  const sorted = sortCards(hand);
  const profile = analyseHand(hand);
  const minOpp = minOpponentCount(ctx);
  const seen = playedCards(ctx);

  // Track which 2s are still out (unseen = someone might hold them)
  const unseenTwos = (["♦", "♣", "♥", "♠"] as const)
    .map((s) => ({ rank: "2" as Rank, suit: s }))
    .filter((c) => !seen.has(`2${c.suit}`));
  const iHoldTwos = hand.filter(isPower);
  // If I hold the only remaining 2, it's safe to play it freely
  const twoScarce = unseenTwos.length <= iHoldTwos.length;

  // ── Free turn ──────────────────────────────────────────────────────────────
  if (!lastPlayed || lastPlayed.length === 0) {
    if (isFirstTurn) {
      const seed = sorted.find((c) => c.rank === "3" && c.suit === "♦");
      if (seed) return playWithContext(sorted, profile, seed);
    }

    if (hand.length <= 3) return { action: "play", cards: [sorted[0]] };

    const strategy = chooseStrategy(profile, hand.length);

    // Blocking: if next opponent has few cards, don't play lowest — play mid
    // to force them to burn a strong card
    if (minOpp <= 4 && strategy === "single" && sorted.length > 2) {
      const mid = sorted[Math.floor(sorted.length / 3)];
      return { action: "play", cards: [mid] };
    }

    // Combo fishing: on free turn with a good 5-card hand, lead with it
    // to force opponents into a 5-card response (hard to beat)
    if (profile.fiveCards.length >= 1 && minOpp > 3) {
      const best5 = pickBest5Card(profile.fiveCards);
      if (best5) return { action: "play", cards: best5 };
    }

    return freeTurnPlay(sorted, profile, strategy);
  }

  // ── Must beat previous ─────────────────────────────────────────────────────
  const prev = parseCombo(lastPlayed);
  if (isError(prev)) return { action: "pass" };

  // Opponent about to win — beat them at all costs, including burning a 2
  if (minOpp <= 1 && prev.type === "single") {
    const biggest = [...sorted]
      .reverse()
      .find(
        (c) =>
          compareCards(
            c,
            (prev as Extract<ParsedCombo, { type: "single" }>).card,
          ) > 0,
      );
    if (biggest) return { action: "play", cards: [biggest] };
  }

  // Power card hoarding: avoid playing 2s unless necessary or they're not scarce
  if (prev.type === "single") {
    const prevCard = (prev as Extract<ParsedCombo, { type: "single" }>).card;
    // Try to beat without using a 2
    const nonTwoBeater = sorted
      .filter((c) => !isPower(c))
      .find((c) => compareCards(c, prevCard) > 0);

    if (nonTwoBeater) return { action: "play", cards: [nonTwoBeater] };

    // Only use a 2 if opponent is dangerous OR twos are not scarce
    if (minOpp <= 3 || twoScarce) {
      const twoBeater = sorted.find(
        (c) => isPower(c) && compareCards(c, prevCard) > 0,
      );
      if (twoBeater) return { action: "play", cards: [twoBeater] };
    }

    return { action: "pass" }; // hoard the 2 for later
  }

  // Safe 5-card plays when opponent is vulnerable
  if (minOpp <= 4 && profile.fiveCards.length > 0) {
    const fiveCard = findSmallestBeating5Card(sorted, prev);
    if (fiveCard) return { action: "play", cards: fiveCard };
  }

  return smallestBeating(sorted, prev) ?? { action: "pass" };
}

// ─── Shared play helpers ──────────────────────────────────────────────────────

/** Smallest move that beats `prev`, across all combo types */
function smallestBeating(sorted: Card[], prev: ParsedCombo): BotMove | null {
  switch (prev.type) {
    case "single": {
      const c = sorted.find((card) => compareCards(card, prev.card) > 0);
      return c ? { action: "play", cards: [c] } : null;
    }
    case "pair": {
      const cards = findSmallestBeatingCombo(sorted, 2, prev);
      return cards ? { action: "play", cards } : null;
    }
    case "triple": {
      const cards = findSmallestBeatingCombo(sorted, 3, prev);
      return cards ? { action: "play", cards } : null;
    }
    default: {
      const cards = findSmallestBeating5Card(sorted, prev);
      return cards ? { action: "play", cards } : null;
    }
  }
}

/** On a free turn, lead with the best move given strategy */
function freeTurnPlay(
  sorted: Card[],
  profile: HandProfile,
  strategy: Strategy,
): BotMove {
  if (strategy === "pair" && profile.pairs.length > 0) {
    // Play the smallest pair
    const smallestPair = profile.pairs.reduce((best, pair) =>
      compareCards(pair[1], best[1]) < 0 ? pair : best,
    );
    return { action: "play", cards: smallestPair };
  }

  if (strategy === "combo" && profile.fiveCards.length > 0) {
    const best5 = pickBest5Card(profile.fiveCards);
    if (best5) return { action: "play", cards: best5 };
  }

  // Default: play smallest single (avoid power cards if hand is large)
  const nonPower = sorted.filter((c) => !isPower(c));
  return { action: "play", cards: [nonPower[0] ?? sorted[0]] };
}

function playWithContext(
  sorted: Card[],
  profile: HandProfile,
  seed: Card,
): BotMove {
  // Try to include 3♦ in the largest valid combo possible
  // 5-card combo
  const seedFive = profile.fiveCards.find((cards) =>
    cards.some((c) => c.rank === seed.rank && c.suit === seed.suit),
  );
  if (seedFive) return { action: "play", cards: seedFive };

  // Triple
  const seedTriple = profile.triples.find((t) => t[0].rank === seed.rank);
  if (seedTriple) return { action: "play", cards: seedTriple };

  // Pair
  const seedPair = profile.pairs.find((p) => p[0].rank === seed.rank);
  if (seedPair) return { action: "play", cards: seedPair };

  // Single fallback
  return { action: "play", cards: [seed] };
}

/** From a list of valid 5-card combos, pick the lowest-ranked one (conserve strong hands) */
function pickBest5Card(fiveCards: Card[][]): Card[] | null {
  if (fiveCards.length === 0) return null;

  const parsed = fiveCards
    .map((cards) => ({ cards, combo: parseCombo(cards) }))
    .filter(({ combo }) => !isError(combo)) as {
    cards: Card[];
    combo: ParsedCombo;
  }[];

  if (parsed.length === 0) return null;

  // Sort ascending — pick weakest valid 5-card combo to conserve strong ones
  parsed.sort((a, b) => {
    const cmp = compareCombo(a.combo, b.combo);
    return cmp ?? 0;
  });

  return parsed[0].cards;
}
