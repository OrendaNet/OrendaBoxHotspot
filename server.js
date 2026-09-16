const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { authenticateEdgeRequest, createRuntimeClient } = require('./sdk');

const MAX_BODY = 4096;
const assets = new Map([
  ['/', ['text/html; charset=utf-8', 'index.html']],
  ['/app.js', ['text/javascript; charset=utf-8', 'app.js']],
  ['/style.css', ['text/css; charset=utf-8', 'style.css']],
  ['/icon.svg', ['image/svg+xml', 'icon.svg']]
].map(([route, [type, file]]) => [route, { type, body: fs.readFileSync(path.join(__dirname, 'public', file)) }]));

function canManage(user) {
  return user.source === 'sdk-development' || user.roles.includes('admin') || user.roles.includes('owner');
}

function hotspotFailure(error) {
  const status = [400, 401, 403, 404, 409].includes(error.status) ? error.status : 502;
  const messages = {
    400: error.message,
    401: 'The app connection has expired. Reopen the app from Edge Console.',
    403: 'Hotspot management is not approved. Ask a Box administrator to grant it for this app.',
    404: 'Hotspot support is unavailable. Update Edge Manager on this Box.',
    409: error.message,
    502: 'The hotspot service is unavailable. Check that the Box has a WiFi adapter and try again.'
  };
  return { status, message: messages[status] };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const finish = (error, value) => {
      clearTimeout(timer);
      req.removeListener('data', data);
      req.removeListener('end', end);
      req.removeListener('error', aborted);
      req.removeListener('aborted', aborted);
      if (error) { req.resume(); reject(error); } else resolve(value);
    };
    const data = (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) return finish(Object.assign(new Error('Settings request is too large.'), { status: 413 }));
      chunks.push(chunk);
    };
    const end = () => {
      if (!chunks.length) return finish(Object.assign(new Error('Send hotspot settings as JSON.'), { status: 400 }));
      try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (_) { finish(Object.assign(new Error('Send hotspot settings as JSON.'), { status: 400 })); }
    };
    const aborted = () => finish(Object.assign(new Error('Settings request interrupted.'), { status: 400 }));
    const timer = setTimeout(() => finish(Object.assign(new Error('Settings request timed out.'), { status: 408 })), 5000);
    req.on('data', data).once('end', end).once('error', aborted).once('aborted', aborted);
  });
}

function createApp({ runtime = createRuntimeClient(), secret = process.env.ORENDA_EDGE_APP_PROXY_SECRET } = {}) {
  const json = (res, status, body) => {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(body));
  };
  async function snapshot() {
    const [context, hotspot] = await Promise.all([
      Promise.resolve().then(() => runtime.context()).catch((error) => ({ error: error.message })),
      Promise.resolve().then(() => runtime.hotspot.status()).catch((error) => ({ error: error.message, available: false }))
    ]);
    return { context, hotspot };
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });
      const user = authenticateEdgeRequest(req.headers, secret);
      if (!user) return json(res, 401, { error: 'Open this app from Edge Console to continue.' });
      if (url.pathname === '/api/session') return json(res, 200, { user });
      if (url.pathname === '/api/state') return json(res, 200, { user, manageable: canManage(user), ...(await snapshot()) });
      const mutation = url.pathname === '/api/hotspot' ? 'configure'
        : url.pathname === '/api/hotspot/start' ? 'start'
          : url.pathname === '/api/hotspot/stop' ? 'stop' : null;
      if (mutation) {
        if (!canManage(user)) return json(res, 403, { error: 'Ask a Box administrator to manage the hotspot.' });
        if (mutation === 'configure') {
          if (req.method !== 'PUT') return json(res, 405, { error: 'Method not allowed.' });
          if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'Send hotspot settings as JSON.' });
          let body;
          try { body = await readJsonBody(req); }
          catch (error) { return json(res, error.status || 400, { error: error.message }); }
          try { await runtime.hotspot.configure(body); }
          catch (error) { const failure = hotspotFailure(error); return json(res, failure.status, { error: failure.message }); }
        } else {
          if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
          req.resume();
          try { await (mutation === 'start' ? runtime.hotspot.start() : runtime.hotspot.stop()); }
          catch (error) { const failure = hotspotFailure(error); return json(res, failure.status, { error: failure.message }); }
        }
        return json(res, 200, await snapshot());
      }
      if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
      const asset = assets.get(url.pathname);
      if (!asset) return json(res, 404, { error: 'Not found.' });
      res.writeHead(200, { 'Content-Type': asset.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      res.end(asset.body);
    } catch (_) {
      if (res.headersSent) res.destroy();
      else json(res, 500, { error: 'The hotspot app could not complete this request.' });
    }
  });
  return server;
}

if (require.main === module) {
  const server = createApp();
  server.listen(Number(process.env.PORT || 3105), process.env.HOST || '127.0.0.1');
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    server.closeIdleConnections();
    server.close();
  });
}
module.exports = { createApp, canManage };
