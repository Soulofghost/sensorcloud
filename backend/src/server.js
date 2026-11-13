const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { getDatabase } = require('./database');
const { handleApiRequest } = require('./routes/apiRoutes');

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const FRONTEND_DIR = path.resolve(__dirname, '..', '..', 'frontend');

// SSE clients set
const sseClients = new Set();

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve(null);
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        resolve(body);
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(reqPath, res) {
  let filePath = path.join(FRONTEND_DIR, reqPath === '/' ? 'index.html' : reqPath);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(FRONTEND_DIR, 'index.html');
  }

  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml'
  };

  const contentType = mimeTypes[ext] || 'text/plain';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // 1. Health check
  if (pathname === '/api/v1/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      service: 'SensorCloud Telemetry Broker',
      version: '1.0.0',
      uptime: process.uptime()
    }));
    return;
  }

  // 2. Server-Sent Events (SSE) Real-Time Telemetry Stream
  if (pathname === '/api/v1/telemetry/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    res.write('data: {"event": "connected", "message": "SensorCloud Telemetry Stream Active"}\n\n');
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // 3. REST Management & Telemetry API
  if (pathname.startsWith('/api/v1')) {
    try {
      const subPath = pathname.slice('/api/v1'.length);
      const body = await parseBody(req);
      const result = handleApiRequest(subPath, req.method, parsedUrl.searchParams, body);

      // If new telemetry point or simulation tick was processed, broadcast to SSE listeners
      if (pathname === '/api/v1/telemetry' && result.status === 201) {
        broadcastSSE({ type: 'telemetry_point', data: result.data });
      } else if (pathname === '/api/v1/simulator/tick' && result.status === 200) {
        broadcastSSE({ type: 'simulator_batch', data: result.data.points });
      }

      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server Error', message: err.message }));
    }
    return;
  }

  // 4. Frontend Static Files
  serveStatic(pathname, res);
});

function broadcastSSE(payload) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(msg);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

function startServer(port = PORT, host = HOST) {
  getDatabase();
  return new Promise(resolve => {
    server.listen(port, host, () => {
      console.log(`SensorCloud Telemetry Broker listening on http://${host}:${port}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  server,
  startServer,
  broadcastSSE
};
