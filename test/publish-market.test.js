const test = require('node:test');
const assert = require('node:assert/strict');
const { main } = require('../scripts/publish-market');

const appId = 'orenda-box-hotspot';
const version = require('../package.json').version;
const manifest = require('../orenda-app.json');
const digest = `sha256:${'a'.repeat(64)}`;
const releaseVersion = {
  version,
  image: `ghcr.io/orendanet/${appId}@${digest}`,
  digest,
  minPlatformVersion: '0.2.60',
  releaseNotes: 'Automatic hotspot startup.'
};

function fixture({ currentReleaseId = 'rel-current', publishStatus = 201 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    const method = options.method || 'GET';
    calls.push({ path, method, body: options.body ? JSON.parse(options.body) : null });
    let body = {};
    let status = 200;
    if (path.endsWith('/auth/login')) body = { token: 'fixture-token' };
    else if (path.endsWith('/tenants/official') && method === 'GET') body = { tenant: { currentReleaseId } };
    else if (path.endsWith('/tenants/official/publish')) {
      status = publishStatus;
      body = status === 201 ? { release: { id: 'rel-new' } } : { error: 'The active release changed' };
    }
    return new Response(JSON.stringify(body), { status });
  };
  const args = {
    env: {
      ORENDA_REPO_SERVER_URL: 'https://example.invalid',
      ORENDA_REPO_ADMIN_USERNAME: 'fixture-user',
      ORENDA_REPO_ADMIN_PASSWORD: 'fixture-password',
      IMAGE_DIGEST: digest
    },
    fetchImpl,
    manifest,
    releaseManifest: { id: appId, versions: [releaseVersion] },
    output() {}
  };
  return { args, calls };
}

test('market publication updates only Hotspot and guards against a changed active release', async () => {
  const { args, calls } = fixture();
  await main(args);
  const published = calls.filter(({ path }) => path.endsWith('/publish'));
  assert.equal(published.length, 1);
  assert.deepEqual(published[0].body.appIds, [appId]);
  assert.equal(published[0].body.baseReleaseId, 'rel-current');
  const versionWrite = calls.find(({ path, method }) => path.endsWith(`/${appId}/versions`) && method === 'POST');
  assert.equal(versionWrite.body.minPlatformVersion, releaseVersion.minPlatformVersion);
  assert.equal(versionWrite.body.releaseNotes, releaseVersion.releaseNotes);
});

test('market publication refuses to publish without a known active release', async () => {
  const { args, calls } = fixture({ currentReleaseId: null });
  await assert.rejects(main(args), /current catalog release is required/);
  assert.equal(calls.filter(({ path }) => path.endsWith('/publish')).length, 0);
});

test('market publication fails closed on a stale base release instead of retrying broadly', async () => {
  const { args, calls } = fixture({ publishStatus: 409 });
  await assert.rejects(main(args), { status: 409 });
  assert.equal(calls.filter(({ path }) => path.endsWith('/publish')).length, 1);
});

test('market publication rejects a mismatched release manifest before login', async () => {
  const { args, calls } = fixture();
  args.releaseManifest.versions[0].minPlatformVersion = '';
  await assert.rejects(main(args), /Generate and verify/);
  assert.equal(calls.length, 0);
});
