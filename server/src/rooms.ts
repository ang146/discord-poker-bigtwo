import type { Server } from "socket.io";
import type { RoomState, Player, GameId } from "../../shared/types";
import { GAME_MAX_PLAYERS } from "../../shared/types";

export const rooms = new Map<string, RoomState>();

export function getOrCreateRoom(
  roomId: string,
  firstUserId: string,
): RoomState {
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
    botLevel: "easy",
    phase: "lobby",
    lastWinnerUserId: null,
  };
  rooms.set(roomId, room);
  return room;
}

export function findPlayer(
  room: RoomState,
  userId: string,
): Player | undefined {
  return (
    room.spectators.find((p) => p.userId === userId) ??
    room.players.find((p) => p.userId === userId)
  );
}

export function removeFromAll(room: RoomState, userId: string): void {
  room.spectators = room.spectators.filter((p) => p.userId !== userId);
  room.players = room.players.filter((p) => p.userId !== userId);
}

export function broadcast(io: Server, roomId: string): void {
  const room = rooms.get(roomId);
  if (room) io.to(roomId).emit("room:state", room);
}

export function maxPlayers(room: RoomState): number {
  return GAME_MAX_PLAYERS[room.selectedGame as GameId];
}
