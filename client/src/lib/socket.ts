import { io, type Socket } from 'socket.io-client';

let _socket: Socket | null = null;

/**
 * Returns a singleton Socket.IO client.
 * The socket connects to the same origin so it routes through the
 * Vite proxy (/socket.io → localhost:3001) in dev and through
 * Cloudflare Tunnel in production.
 */
export function getSocket(): Socket {
  if (!_socket) {
    _socket = io('/', {
      path: '/socket.io',
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 10,
      transports: ['websocket'],
    });
  }
  return _socket;
}
