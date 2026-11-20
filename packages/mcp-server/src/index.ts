import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { WebSocketServer } from 'ws';
import { InMemoryWsBridge } from './bridge.ts';
import { createMcpServer } from './tools.ts';

const PORT = Number(process.env.PORT ?? 8787);
const PROD = process.env.NODE_ENV === 'production';
const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://localhost:${PROD ? PORT : 5173}`;
const DIST = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../web/dist');

const bridge = new InMemoryWsBridge({ allowSingleSessionFallback: !PROD });
const app = new Hono();

app.get('/health', (c) => c.json({ ok: true }));

app.all('/mcp', async (c) => {
  const token = c.req.query('session') ?? c.req.header('x-factorymcp-session') ?? null;
  const server = createMcpServer(bridge, token);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

if (PROD && existsSync(DIST)) {
  app.get('*', async (c) => {
    const rel = normalize(decodeURIComponent(new URL(c.req.url).pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(DIST, rel);
    if (!file.startsWith(DIST) || !existsSync(file) || rel === '/' || !extname(file)) file = join(DIST, 'index.html');
    const body = await readFile(file);
    return c.body(body, 200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  });
}

const httpServer = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`FactoryMCP server on http://localhost:${info.port} (mcp: /mcp, ws: /ws)`);
});

const wss = new WebSocketServer({ noServer: true });
httpServer.on('upgrade', (req: IncomingMessage, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const sessionId = url.searchParams.get('session');
  if (url.pathname !== '/ws' || !sessionId || !/^[\w-]{8,64}$/.test(sessionId)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    bridge.attach(sessionId, ws, `${PUBLIC_URL.replace(/\/$/, '')}/mcp?session=${sessionId}`);
  });
});
