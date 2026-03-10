import { useEffect, useState } from "react";
import { getSocket } from "../lib/socket";
import type {
  RoomState,
  HumanPlayer,
  GameId,
  Card,
  GameHandPayload,
  GameTurnState,
} from "../types";

type UseRoomOptions = {
  roomId: string;
  player: HumanPlayer;
};

type UseRoomReturn = {
  roomState: RoomState | null;
  hand: Card[];
  turnState: GameTurnState | null;
  connectionError: string | null;
  isConnected: boolean;
  sitDown: () => void;
  standUp: () => void;
  setReady: (ready: boolean) => void;
  setGame: (game: GameId) => void;
  setBots: (enabled: boolean) => void;
  transferHost: (toUserId: string) => void;
  startGame: () => void;
  playCards: (cards: Card[]) => void;
  pass: () => void;
};

export function useRoom({ roomId, player }: UseRoomOptions): UseRoomReturn {
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [hand, setHand] = useState<Card[]>([]);
  const [turnState, setTurnState] = useState<GameTurnState | null>(null);
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
    function onGameHand(payload: GameHandPayload) {
      setHand(payload.hand);
    }
    function onGameTurn(state: GameTurnState) {
      setTurnState(state);
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
    socket.on("game:hand", onGameHand);
    socket.on("game:turn", onGameTurn);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);

    return () => {
      socket.off("connect", join);
      socket.off("room:state", onRoomState);
      socket.off("game:hand", onGameHand);
      socket.off("game:turn", onGameTurn);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
    };
  }, [roomId, player.userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const socket = getSocket();

  return {
    roomState,
    hand,
    turnState,
    connectionError,
    isConnected,
    sitDown() {
      socket.emit("player:sit", { roomId, userId: player.userId });
    },
    standUp() {
      socket.emit("player:stand", { roomId, userId: player.userId });
    },
    setReady(ready) {
      socket.emit("player:ready", { roomId, userId: player.userId, ready });
    },
    setGame(game) {
      socket.emit("room:set-game", { roomId, game });
    },
    setBots(enabled) {
      socket.emit("room:set-bots", { roomId, enabled });
    },
    transferHost(toUserId) {
      socket.emit("room:transfer-host", { roomId, toUserId });
    },
    startGame() {
      socket.emit("room:start-game", { roomId });
    },
    playCards(cards) {
      socket.emit("game:play", { roomId, cards });
    },
    pass() {
      socket.emit("game:pass", { roomId });
    },
  };
}
