const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApp, canManage } = require('../server');
const { createRuntimeClient } = require('../sdk');
const { validateManifest } = require('../sdk/manifest');

const ADMIN_HEADERS = {
  'x-orenda-edge-proxy-secret': 'fixture-secret',
  'x-orenda-auth-source': 'org-config',
  'x-orenda-user-id': 'user-1',
  'x-orenda-username': 'ada',
  'x-orenda-user-name': 'Ada',
  'x-orenda-user-roles': 'admin'
};

function fakeRuntime() {
  const calls = [];
  const state = { configured: false, active: false, autoStart: false, ssid: null, internetAccess: false, available: true, clients: [] };
  return {
    calls,
    state,
    context: async () => ({ apiVersion: '1', appId: 'orenda-box-hotspot', platformVersion: '0.2.53', capabilities: ['hotspot:manage'], services: { hotspot: { manage: true, available: true } } }),
    hotspot: {
      status: async () => { calls.push(['status']); return { ...state }; },
      configure: async (settings) => { calls.push(['configure', settings]); state.configured = true; state.ssid = settings.ssid || state.ssid; if (settings.internetAccess !== undefined) state.internetAccess = settings.internetAccess; if (settings.autoStart !== undefined) state.autoStart = settings.autoStart; return { ...state }; },
      start: async () => { calls.push(['start']); state.active = true; return { ...state }; },
      stop: async () => { calls.push(['stop']); state.active = false; return { ...state }; },
      disconnectUplink: async () => { calls.push(['disconnectUplink']); return { released: true, releasedDevices: ['wlan0'], alternateUplink: 'wwan0' }; }
    }
  };
}

async function listen(app) {
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${app.address().port}`;
}

test('hotspot manifest requests only the SDK 1.2 hotspot capability', () => {
  const manifest = structuredClone(require('../orenda-app.json'));
  assert.match(manifest.metadata.orenda.sdkVersion, /^1\.2$/);
  assert.deepEqual(manifest.metadata.orenda.capabilities, ['hotspot:manage']);
  const release = { ...manifest, versions: [{ version: '0.1.0', image: `ghcr.io/orendanet/orenda-box-hotspot@sha256:${'a'.repeat(64)}`, architectures: ['arm64'], minPlatformVersion: '0.2.53', releaseNotes: 'First release.' }] };
  assert.deepEqual(validateManifest(release, { release: true }), []);
  assert.ok(validateManifest({ ...release, metadata: { orenda: { ...manifest.metadata.orenda, sdkVersion: '1' } } }, { release: true }).some((error) => error.includes('1.2')));
});

test('the hotspot UI promotes the canonical portal URL over the numeric gateway', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(script, /hotspot\.portalUrl \|\| \(hotspot\.address/);
  assert.match(script, /hotspot\.portalSetupUrl \|\| hotspot\.portalUrl/);
});

test('the vendored SDK accepts only a boolean automatic-start setting', async () => {
  const calls = [];
  const runtime = createRuntimeClient({
    baseUrl: 'http://127.0.0.1:8088/api/v1/runtime',
    token: 'fixture-token',
    fetchImpl: async (url, options) => { calls.push([url, options]); return { ok: true, json: async () => ({ autoStart: true }) }; }
  });
  assert.throws(() => runtime.hotspot.configure({ autoStart: 'true' }), /autoStart/);
  assert.throws(() => runtime.hotspot.configure({ autoStart: true, unexpected: true }), /only ssid/);
  assert.deepEqual(await runtime.hotspot.configure({ autoStart: true }), { autoStart: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'http://127.0.0.1:8088/api/v1/runtime/hotspot');
  assert.equal(calls[0][1].method, 'PUT');
  assert.deepEqual(JSON.parse(calls[0][1].body), { autoStart: true });
});

const readmePath = path.join(__dirname, '..', 'README.md');
test('the source documentation names the canonical portal hostname', {
  skip: fs.existsSync(readmePath) ? false : 'README is intentionally excluded from the runtime image'
}, () => {
  assert.match(fs.readFileSync(readmePath, 'utf8'), /apps\.orenda\.home\.arpa/);
});

test('browser requests require Edge identity and mutations require an administrator', async (t) => {
  const runtime = fakeRuntime();
  const app = createApp({ runtime, secret: 'fixture-secret' });
  const origin = await listen(app);
  t.after(() => { app.closeAllConnections(); app.close(); });
  assert.equal((await fetch(`${origin}/health`)).status, 200);
  assert.equal((await fetch(`${origin}/api/state`)).status, 401);
  assert.equal((await fetch(`${origin}/api/state`, { headers: { ...ADMIN_HEADERS, 'x-orenda-edge-proxy-secret': 'wrong' } })).status, 401);
  const viewer = { ...ADMIN_HEADERS, 'x-orenda-user-roles': 'viewer' };
  const viewerState = await (await fetch(`${origin}/api/state`, { headers: viewer })).json();
  assert.equal(viewerState.manageable, false);
  assert.equal((await fetch(`${origin}/api/hotspot`, { method: 'PUT', headers: { ...viewer, 'Content-Type': 'application/json' }, body: JSON.stringify({ ssid: 'Guest' }) })).status, 403);
  const state = await (await fetch(`${origin}/api/state`, { headers: ADMIN_HEADERS })).json();
  assert.equal(state.manageable, true);
  assert.equal(state.user.username, 'ada');
});

test('settings, start and stop call only the scoped runtime hotspot routes', async (t) => {
  const runtime = fakeRuntime();
  const app = createApp({ runtime, secret: 'fixture-secret' });
  const origin = await listen(app);
  t.after(() => { app.closeAllConnections(); app.close(); });
  const json = { ...ADMIN_HEADERS, 'Content-Type': 'application/json' };
  const configured = await fetch(`${origin}/api/hotspot`, { method: 'PUT', headers: json, body: JSON.stringify({ ssid: 'OrendaBox Line 4', password: 'guest-password', internetAccess: true }) });
  assert.equal(configured.status, 200);
  assert.deepEqual(runtime.calls[0], ['configure', { ssid: 'OrendaBox Line 4', password: 'guest-password', internetAccess: true }]);
  assert.equal((await fetch(`${origin}/api/hotspot/start`, { method: 'POST', headers: ADMIN_HEADERS })).status, 200);
  assert.equal((await fetch(`${origin}/api/hotspot/stop`, { method: 'POST', headers: ADMIN_HEADERS })).status, 200);
  assert.deepEqual(runtime.calls.filter(([name]) => name !== 'status'), [['configure', { ssid: 'OrendaBox Line 4', password: 'guest-password', internetAccess: true }], ['start'], ['stop']]);
  assert.equal((await fetch(`${origin}/api/hotspot`, { method: 'GET', headers: ADMIN_HEADERS })).status, 405);
  assert.equal((await fetch(`${origin}/api/hotspot`, { method: 'PUT', headers: { ...ADMIN_HEADERS, 'Content-Type': 'text/plain' }, body: 'ssid' })).status, 415);
  const huge = await fetch(`${origin}/api/hotspot`, { method: 'PUT', headers: json, body: JSON.stringify({ ssid: 'x'.repeat(5000) }) });
  assert.equal(huge.status, 413);
});

test('automatic startup is a separate administrator-only preference and does not start or stop the AP', async (t) => {
  const runtime = fakeRuntime();
  const app = createApp({ runtime, secret: 'fixture-secret' });
  const origin = await listen(app);
  t.after(() => { app.closeAllConnections(); app.close(); });
  const headers = { ...ADMIN_HEADERS, 'Content-Type': 'application/json' };
  const enabled = await fetch(`${origin}/api/hotspot`, { method: 'PUT', headers, body: JSON.stringify({ autoStart: true }) });
  assert.equal(enabled.status, 200);
  assert.equal((await enabled.json()).hotspot.autoStart, true);
  const status = await (await fetch(`${origin}/api/state`, { headers: ADMIN_HEADERS })).json();
  assert.equal(status.hotspot.autoStart, true);
  const disabled = await fetch(`${origin}/api/hotspot`, { method: 'PUT', headers, body: JSON.stringify({ autoStart: false }) });
  assert.equal(disabled.status, 200);
  assert.equal((await disabled.json()).hotspot.autoStart, false);
  assert.deepEqual(runtime.calls.filter(([name]) => name !== 'status'), [['configure', { autoStart: true }], ['configure', { autoStart: false }]]);
  const viewer = { ...headers, 'x-orenda-user-roles': 'viewer' };
  assert.equal((await fetch(`${origin}/api/hotspot`, { method: 'PUT', headers: viewer, body: JSON.stringify({ autoStart: true }) })).status, 403);
  assert.equal(runtime.state.autoStart, false);
});

test('auto-start switch saves only the boot preference and stays disabled on older Edge Managers', async () => {
  const markup = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(markup, /id="auto-start"/);
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const controls = new Map();
  const document = {
    hidden: false,
    activeElement: null,
    getElementById(id) {
      if (!controls.has(id)) controls.set(id, {
        disabled: false, hidden: false, checked: false, value: '', textContent: '', innerHTML: '',
        listeners: {}, addEventListener(event, callback) { this.listeners[event] = callback; }
      });
      return controls.get(id);
    },
    addEventListener() {}
  };
  const calls = [];
  let autoStart = false;
  let supported = true;
  let configured = true;
  const fetchImpl = async (route, options = {}) => {
    calls.push([route, options]);
    if (route === 'api/hotspot' && options.method === 'PUT') autoStart = JSON.parse(options.body).autoStart;
    return { ok: true, json: async () => ({
      user: { name: 'Ada' }, manageable: true,
      hotspot: { active: false, configured, available: true, ssid: 'Box', clients: [], ...(supported ? { autoStart } : {}) }
    }) };
  };
  vm.runInNewContext(script, { document, fetch: fetchImpl, setInterval() {} });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  await settle();
  const toggle = controls.get('auto-start');
  assert.equal(toggle.disabled, false);
  toggle.checked = true;
  toggle.listeners.change();
  await settle();
  assert.equal(autoStart, true);
  assert.deepEqual(calls.filter(([route]) => route !== 'api/state').map(([route, options]) => [route, options.method, JSON.parse(options.body)]), [['api/hotspot', 'PUT', { autoStart: true }]]);
  assert.equal(toggle.checked, true);
  supported = false;
  controls.get('refresh').listeners.click();
  await settle();
  assert.equal(toggle.disabled, true);
  assert.match(controls.get('auto-start-hint').textContent, /Update Edge Manager/);
  supported = true;
  configured = false;
  controls.get('refresh').listeners.click();
  await settle();
  assert.equal(toggle.disabled, true);
  assert.match(controls.get('auto-start-hint').textContent, /Save a Wi-Fi name and password/);
});

test('the Wi-Fi release action frees the uplink before starting the hotspot', async (t) => {
  const runtime = fakeRuntime();
  const app = createApp({ runtime, secret: 'fixture-secret' });
  const origin = await listen(app);
  t.after(() => { app.closeAllConnections(); app.close(); });
  const released = await fetch(`${origin}/api/hotspot/release-wifi-and-start`, { method: 'POST', headers: ADMIN_HEADERS });
  assert.equal(released.status, 200);
  assert.deepEqual(runtime.calls.filter(([name]) => name !== 'status'), [['disconnectUplink'], ['start']]);
  assert.equal(runtime.state.active, true);
  assert.equal((await fetch(`${origin}/api/hotspot/release-wifi-and-start`, { method: 'GET', headers: ADMIN_HEADERS })).status, 405);
});

test('a missing runtime release route points at the Edge Manager update', async (t) => {
  const runtime = fakeRuntime();
  runtime.hotspot.disconnectUplink = async () => { throw Object.assign(new Error('Not found.'), { status: 404 }); };
  const app = createApp({ runtime, secret: 'fixture-secret' });
  const origin = await listen(app);
  t.after(() => { app.closeAllConnections(); app.close(); });
  const response = await fetch(`${origin}/api/hotspot/release-wifi-and-start`, { method: 'POST', headers: ADMIN_HEADERS });
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /Update Edge Manager/i);
  assert.ok(!runtime.calls.some(([name]) => name === 'start'), 'the hotspot is not started after a failed release');
});

test('actionable runtime failures pass through and unknown failures stay generic', async (t) => {
  const runtime = fakeRuntime();
  runtime.hotspot.start = async () => { throw Object.assign(new Error('nmcli failed: secret internal detail'), { status: 409 }); };
  const app = createApp({ runtime, secret: 'fixture-secret' });
  const origin = await listen(app);
  t.after(() => { app.closeAllConnections(); app.close(); });
  assert.equal((await fetch(`${origin}/`)).status, 401);
  const failed = await fetch(`${origin}/api/hotspot/start`, { method: 'POST', headers: ADMIN_HEADERS });
  assert.equal(failed.status, 409);
  assert.equal((await failed.json()).error, 'nmcli failed: secret internal detail');
  runtime.hotspot.start = async () => { throw new Error('spawn nmcli ENOENT'); };
  const unavailable = await fetch(`${origin}/api/hotspot/start`, { method: 'POST', headers: ADMIN_HEADERS });
  assert.equal(unavailable.status, 502);
  assert.doesNotMatch((await unavailable.json()).error, /ENOENT/);
  const page = await fetch(`${origin}/`, { headers: ADMIN_HEADERS });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /hotspot/i);
});

test('development identity may manage only because it never serves production traffic', () => {
  assert.equal(canManage({ source: 'sdk-development', roles: ['viewer'] }), true);
  assert.equal(canManage({ source: 'org-config', roles: ['viewer'] }), false);
  assert.equal(canManage({ source: 'org-config', roles: ['owner'] }), true);
  assert.equal(canManage({ source: 'local-display', roles: ['viewer'] }), false);
});
