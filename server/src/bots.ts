import type { Server } from 'socket.io';
import type { BotPlayer, RoomState } from '../../shared/types';
import { gameSessions, type GameSession, broadcastTurn } from './sessions';
import { rooms } from './rooms';
import { checkWin, advanceTurn } from './game';
import { calcBotMove } from './botLogic';

export const BOT_DELAY_MS = 1200;

export function scheduleBotTurn(io: Server, roomId: string): void {
  const session = gameSessions.get(roomId);
  const room    = rooms.get(roomId);
  if (!session || !room?.gamePlayers) return;

  const currentPlayer = room.gamePlayers.find(p => p.userId === session.currentTurn);
  if (!currentPlayer || currentPlayer.type !== 'bot') return;

  if (session.botTimeout) clearTimeout(session.botTimeout);

  session.botTimeout = setTimeout(() => {
    const s = gameSessions.get(roomId);
    const r = rooms.get(roomId);
    if (!s || !r?.gamePlayers) return;
    if (s.currentTurn !== currentPlayer.userId) return;

    const hand       = s.hands.get(currentPlayer.userId) ?? [];
    const isFreeTurn = s.freeTurn || s.lastPlayedBy === currentPlayer.userId;
    const lastPlayed = isFreeTurn || s.centerPile.length === 0
      ? null
      : s.centerPile.at(-1)!.cards;

    // Build opponent counts (all players, bot will filter self if needed)
    const opponentCounts = s.turnOrder.map(uid => ({
      userId: uid,
      count:  s.hands.get(uid)?.length ?? 0,
    }));

    const move = calcBotMove({
      hand,
      lastPlayed,
      isFirstTurn: s.isFirstTurn,
      level:       (currentPlayer as BotPlayer).level ?? 'easy',
      opponentCounts,
      centerPile:  s.centerPile,
    });

    if (move.action === 'pass') {
      executeBotPass(io, roomId, currentPlayer.userId, s);
    } else {
      executeBotPlay(io, roomId, currentPlayer.userId, move.cards, s);
    }
  }, BOT_DELAY_MS);
}

export function executeBotPlay(
  io: Server,
  roomId: string,
  userId: string,
  cards: import('../../shared/types').Card[],
  session: GameSession,
): void {
  const hand      = session.hands.get(userId)!;
  const remaining = hand.filter(
    c => !cards.some(pc => pc.rank === c.rank && pc.suit === c.suit),
  );

  session.hands.set(userId, remaining);
  session.centerPile.push({ userId, cards });
  session.isFirstTurn  = false;
  session.freeTurn     = false;
  session.passCount    = 0;
  session.lastPlayedBy = userId;

  advanceTurn(session, userId);
  if (checkWin(io, roomId, userId)) return;
  broadcastTurn(io, roomId, session);
  scheduleBotTurn(io, roomId);
}

export function executeBotPass(
  io: Server,
  roomId: string,
  userId: string,
  session: GameSession,
): void {
  session.passCount += 1;
  if (session.passCount >= session.turnOrder.length - 1) {
    session.freeTurn  = true;
    session.passCount = 0;
  }

  advanceTurn(session, userId);
  broadcastTurn(io, roomId, session);
  scheduleBotTurn(io, roomId);
}

export function clearBotTimeout(roomId: string): void {
  const session = gameSessions.get(roomId);
  if (session?.botTimeout) {
    clearTimeout(session.botTimeout);
    session.botTimeout = null;
  }
}
