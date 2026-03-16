import type { Server } from 'socket.io';
import type {
  PlayerVote,
  VoteChoice,
  GameOverPayload,
  VoteUpdatePayload,
} from '../../shared/types';
import { gameSessions, type GameSession, deal, broadcastTurn, broadcastHands } from './sessions';
import { rooms, broadcast } from './rooms';
import { scheduleBotTurn } from './bots';

// ─── Turn advancement ─────────────────────────────────────────────────────────

export function advanceTurn(session: GameSession, userId: string): void {
  const myIdx = session.turnOrder.indexOf(userId);
  session.currentTurn = session.turnOrder[(myIdx + 1) % session.turnOrder.length];
}

// ─── Vote helpers ─────────────────────────────────────────────────────────────

export function buildVoteList(session: GameSession): PlayerVote[] {
  return [...session.votes.entries()].map(([userId, choice]) => ({ userId, choice }));
}

// ─── Win detection ────────────────────────────────────────────────────────────

export function checkWin(io: Server, roomId: string, userId: string): boolean {
  const session = gameSessions.get(roomId);
  const room    = rooms.get(roomId);
  if (!session || !room?.gamePlayers) return false;

  const hand = session.hands.get(userId) ?? [];
  if (hand.length > 0) return false;

  session.phase = 'voting';
  if (session.botTimeout) {
    clearTimeout(session.botTimeout);
    session.botTimeout = null;
  }

  session.votes = new Map(
    room.gamePlayers.map(p => [p.userId, p.type === 'bot' ? 'rematch' : null]),
  );

  room.lastWinnerUserId = userId;

  const payload: GameOverPayload = {
    winnerUserId:   userId,
    votes:          buildVoteList(session),
    timeoutSeconds: 15,
  };
  io.to(roomId).emit('game:over', payload);

  session.voteDeadline = Date.now() + 15_000;
  session.voteTimeout  = setTimeout(() => resolveVotes(io, roomId, true), 15_000);

  return true;
}

// ─── Vote resolution ──────────────────────────────────────────────────────────

export function resolveVotes(io: Server, roomId: string, timedOut: boolean): void {
  const session = gameSessions.get(roomId);
  const room    = rooms.get(roomId);
  if (!session || !room?.gamePlayers) return;

  if (session.voteTimeout) {
    clearTimeout(session.voteTimeout);
    session.voteTimeout = null;
  }

  if (timedOut) {
    for (const [uid, choice] of session.votes) {
      if (choice === null) session.votes.set(uid, 'leave');
    }
  }

  const allVotes = [...session.votes.values()];
  const anyLeave = allVotes.some(v => v === 'leave' || v === null);

  if (anyLeave) {
    room.phase           = 'lobby';
    room.gamePlayers     = null;
    room.lastWinnerUserId = null;
    room.players.forEach(p => { p.isReady = false; });
    gameSessions.delete(roomId);
    broadcast(io, roomId);
    io.to(roomId).emit('game:return-lobby');
  } else {
    startRematch(io, roomId);
  }
}

// ─── Rematch ──────────────────────────────────────────────────────────────────

export function startRematch(io: Server, roomId: string): void {
  const room = rooms.get(roomId);
  if (!room?.gamePlayers) return;

  const oldSession = gameSessions.get(roomId);
  if (oldSession?.botTimeout)  clearTimeout(oldSession.botTimeout);
  if (oldSession?.voteTimeout) clearTimeout(oldSession.voteTimeout);

  const gamePlayers    = room.gamePlayers;
  const hands          = deal(gamePlayers);
  const starterUserId  =
    room.lastWinnerUserId ??
    gamePlayers.find(p => hands.get(p.userId)?.some(c => c.rank === '3' && c.suit === '♦'))?.userId ??
    gamePlayers[0].userId;

  const session: GameSession = {
    hands,
    currentTurn:  starterUserId,
    centerPile:   [],
    turnOrder:    gamePlayers.map(p => p.userId),
    isFirstTurn:  false,
    freeTurn:     true,
    passCount:    0,
    lastPlayedBy: null,
    botTimeout:   null,
    phase:        'playing',
    votes:        new Map(),
    voteTimeout:  null,
    voteDeadline: 0,
  };

  gameSessions.set(roomId, session);
  broadcast(io, roomId);
  broadcastHands(io, roomId, session, gamePlayers);
  io.to(roomId).emit('game:rematch');
  broadcastTurn(io, roomId, session);
  scheduleBotTurn(io, roomId);
}

// ─── Handle a human vote ──────────────────────────────────────────────────────

export function handleVote(
  io: Server,
  roomId: string,
  userId: string,
  choice: VoteChoice,
): void {
  const session = gameSessions.get(roomId);
  const room    = rooms.get(roomId);
  if (!session || session.phase !== 'voting') return;
  if (!session.votes.has(userId)) return;

  session.votes.set(userId, choice);

  const remaining = Math.max(0, Math.ceil((session.voteDeadline - Date.now()) / 1000));
  const update: VoteUpdatePayload = {
    votes:          buildVoteList(session),
    timeoutSeconds: remaining,
  };
  io.to(roomId).emit('game:vote:update', update);

  const allVoted = [...session.votes.entries()].every(([uid, v]) => {
    const player = room?.gamePlayers?.find(p => p.userId === uid);
    return player?.type === 'bot' || v !== null;
  });

  if (allVoted) setTimeout(() => resolveVotes(io, roomId, false), 800);
}
