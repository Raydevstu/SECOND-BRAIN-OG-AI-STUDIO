import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { guardHttpRequest, hardenedSocketOptions, listenLocal } from './security';

const PORT = Number(process.env.REALTIME_PORT || process.env.PORT || 3003);

const httpServer = createServer((req, res) => {
  if (!guardHttpRequest(req, res)) return;
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'cortex-realtime' }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

const io = new Server(
  httpServer,
  hardenedSocketOptions({
    path: '/socket.io/',
    pingTimeout: 60000,
    pingInterval: 25000,
  })
);

io.on('connection', (socket) => {
  socket.on('brain:subscribe', (projectId: string) => {
    if (typeof projectId === 'string' && projectId.trim()) {
      socket.join(`project:${projectId.trim()}`);
    }
  });

  socket.on('brain:ping', (cb?: (payload: { ok: boolean; ts: number }) => void) => {
    if (typeof cb === 'function') cb({ ok: true, ts: Date.now() });
  });
});

listenLocal(httpServer, PORT, () => {
  console.log(`realtime service listening on http://127.0.0.1:${PORT}`);
});
