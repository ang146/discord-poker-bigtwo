import { useEffect, useState } from "react";
import { getSocket } from "../lib/socket";
import type { RoomState, HumanPlayer, GameId } from "../types";

type UseRoomOptions = {
  roomId: string;
  player: HumanPlayer;
};

type UseRoomReturn = {
  roomState: RoomState | null;
  connectionError: string | null;
  isConnected: boolean;
  // Player seat actions
  sitDown: () => void;
  standUp: () => void;
  setReady: (ready: boolean) => void;
  // Host actions
  setBots: (enabled: boolean) => void;
  setGame: (game: GameId) => void;
  transferHost: (toUserId: string) => void;
  startGame: () => void;
};

export function useRoom({ roomId, player }: UseRoomOptions): UseRoomReturn {
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const socket = getSocket();

    function join() {
      setIsConnected(true);
      setConnectionError(null);
      socket.emit("room:join", { roomId, player });
    }

    function onRoomState(state: RoomState) {
      setRoomState(state);
    }

    function onDisconnect() {
      setIsConnected(false);
    }

    function onConnectError(err: Error) {
      setConnectionError(err.message ?? "Connection error");
    }

    if (socket.connected) join();
    socket.on("connect", join);
    socket.on("room:state", onRoomState);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);

    return () => {
      socket.off("connect", join);
      socket.off("room:state", onRoomState);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
    };
  }, [roomId, player.userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const socket = getSocket();

  return {
    roomState,
    connectionError,
    isConnected,

    sitDown() {
      socket.emit("player:sit", { roomId, userId: player.userId });
    },
    standUp() {
      socket.emit("player:stand", { roomId, userId: player.userId });
    },
    setReady(ready: boolean) {
      socket.emit("player:ready", { roomId, userId: player.userId, ready });
    },
    setBots(enabled: boolean) {
      socket.emit("room:set-bots", { roomId, enabled });
    },
    setGame(game: GameId) {
      socket.emit("room:set-game", { roomId, game });
    },
    transferHost(toUserId: string) {
      socket.emit("room:transfer-host", { roomId, toUserId });
    },
    startGame() {
      socket.emit("room:start-game", { roomId });
    },
  };
}
