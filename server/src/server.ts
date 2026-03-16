import express from 'express';
import dotenv from 'dotenv';
import http from 'http';
import { Server } from 'socket.io';
import { createAuthRouter } from './auth';
import { registerSocketHandlers } from './socketHandlers';

dotenv.config({ path: '../.env' });

const PORT          = process.env.PORT ?? 3001;
const CLIENT_ID     = process.env.VITE_DISCORD_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET ?? '';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.warn('[server] WARNING: VITE_DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET not set');
}

const app    = express();
app.use(express.json());
app.use(createAuthRouter(CLIENT_ID, CLIENT_SECRET));

const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

registerSocketHandlers(io);

server.listen(PORT, () => {
  console.log(`\n[server] Running at http://localhost:${PORT}\n`);
});
