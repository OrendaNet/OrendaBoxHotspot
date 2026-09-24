const appId = 'orenda-box-hotspot';

function requireEnv(name, fallback = '', env = process.env) {
  const value = String(env[name] || fallback).trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function request(baseUrl, path, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(`${options.method || 'GET'} ${path} failed: ${response.status} ${JSON.stringify(payload)}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function upsert(baseUrl, path, token, body, fetchImpl) {
  const key = body.version || body.id;
  try {
    return await request(baseUrl, path, { method: 'POST', token, body: JSON.stringify(body) }, fetchImpl);
  } catch (error) {
    if (error.status !== 409) throw error;
    return request(baseUrl, `${path}/${encodeURIComponent(key)}`, { method: 'PUT', token, body: JSON.stringify(body) }, fetchImpl);
  }
}

async function main({
  env = process.env,
  fetchImpl = fetch,
  manifest = require('../orenda-app.json'),
  releaseManifest = require('../dist/orenda-app.json'),
  output = console.log
} = {}) {
  const baseUrl = requireEnv('ORENDA_REPO_SERVER_URL', 'https://apps.orendanet.com', env).replace(/\/+$/, '');
  const adminPrefix = requireEnv('ORENDA_REPO_ADMIN_PREFIX', '/admin/v1', env).replace(/\/+$/, '');
  const tenantId = requireEnv('ORENDA_REPO_TENANT_ID', 'official', env);
  const username = requireEnv('ORENDA_REPO_ADMIN_USERNAME', '', env);
  const password = requireEnv('ORENDA_REPO_ADMIN_PASSWORD', '', env);
  const version = require('../package.json').version;
  const digest = requireEnv('IMAGE_DIGEST', '', env);
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('IMAGE_DIGEST must be a sha256 digest');
  const image = `ghcr.io/orendanet/${appId}@${digest}`;
  const releaseVersion = releaseManifest.id === appId && releaseManifest.versions?.find((entry) => entry.version === version);
  if (!releaseVersion || releaseVersion.image !== image || releaseVersion.digest !== digest || !releaseVersion.minPlatformVersion) {
    throw new Error('Generate and verify the release manifest for this version and image digest before catalog publication');
  }

  const login = await request(baseUrl, `${adminPrefix}/auth/login`, { method: 'POST', body: JSON.stringify({ username, password }) }, fetchImpl);
  const token = login.token;
  if (!token) throw new Error('Admin login did not return a token');

  const root = `${adminPrefix}/tenants/${encodeURIComponent(tenantId)}/apps`;
  await upsert(baseUrl, root, token, {
    id: appId,
    name: manifest.name,
    description: manifest.description,
    category: manifest.category,
    runtime: 'compose',
    port: manifest.metadata.orenda.containerPort,
    metadata: manifest.metadata
  }, fetchImpl);
  const appRoot = `${root}/${encodeURIComponent(appId)}`;

  await request(baseUrl, `${appRoot}/storefront`, {
    method: 'PUT',
    token,
    body: JSON.stringify({
      slug: appId,
      headline: manifest.name,
      shortDescription: 'Start a managed WiFi hotspot automatically after reboot, with secure local Orenda Home access.',
      longDescription: 'OrendaBox Hotspot lets an Edge Console administrator name and password-protect a WiFi network for nearby devices. Devices discover the Box-specific HTTPS Orenda Home portal through a locally served first-use setup address, so Box-hosted apps remain available without internet access. Internet sharing and automatic startup are separate controls. Edge Manager owns the access point, DHCP and forwarding policy; it releases an active WiFi uplink only when Ethernet or mobile data has an active default route.',
      categories: ['utilities', 'networking'],
      tags: ['wifi', 'hotspot', 'network'],
      documentationUrl: 'https://github.com/OrendaNet/OrendaBoxHotspot#readme',
      supportUrl: 'https://github.com/OrendaNet/OrendaBoxHotspot/issues'
    })
  }, fetchImpl);

  await upsert(baseUrl, `${appRoot}/versions`, token, {
    version,
    image,
    digest,
    architectures: ['arm64'],
    minPlatformVersion: releaseVersion.minPlatformVersion,
    releaseNotes: releaseVersion.releaseNotes
  }, fetchImpl);

  const tenantPath = `${adminPrefix}/tenants/${encodeURIComponent(tenantId)}`;
  const tenant = await request(baseUrl, tenantPath, { token }, fetchImpl);
  const baseReleaseId = tenant.tenant?.currentReleaseId;
  if (!baseReleaseId) throw new Error('A current catalog release is required for a Hotspot-only publication');

  const release = await request(baseUrl, `${tenantPath}/publish`, {
    method: 'POST',
    token,
    body: JSON.stringify({
      label: `hotspot-${version}`,
      notes: `Published OrendaBox Hotspot ${version} (${digest}).`,
      appIds: [appId],
      baseReleaseId
    })
  }, fetchImpl);
  output(`Published ${appId} ${version} to ${baseUrl}; release=${release.release?.id || 'unknown'}`);
  return release;
}

if (require.main === module) main().catch((err) => {
  console.error(err);
  process.exit(1);
});

module.exports = { main };
