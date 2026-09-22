const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createApp, canManage } = require('../server');
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
  const state = { configured: false, active: false, ssid: null, internetAccess: false, available: true, clients: [] };
  return {
    calls,
    state,
    context: async () => ({ apiVersion: '1', appId: 'orenda-box-hotspot', platformVersion: '0.2.53', capabilities: ['hotspot:manage'], services: { hotspot: { manage: true, available: true } } }),
    hotspot: {
      status: async () => { calls.push(['status']); return { ...state }; },
      configure: async (settings) => { calls.push(['configure', settings]); state.configured = true; state.ssid = settings.ssid || state.ssid; if (settings.internetAccess !== undefined) state.internetAccess = settings.internetAccess; return { ...state }; },
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
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8'), /apps\.orenda\.home\.arpa/);
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
