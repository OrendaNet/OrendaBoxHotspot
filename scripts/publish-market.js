const appId = 'orenda-box-hotspot';

function requireEnv(name, fallback = '') {
  const value = String(process.env[name] || fallback).trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
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

async function upsert(baseUrl, path, token, body) {
  const key = body.version || body.id;
  try {
    return await request(baseUrl, path, { method: 'POST', token, body: JSON.stringify(body) });
  } catch (error) {
    if (error.status !== 409) throw error;
    return request(baseUrl, `${path}/${encodeURIComponent(key)}`, { method: 'PUT', token, body: JSON.stringify(body) });
  }
}

async function main() {
  const baseUrl = requireEnv('ORENDA_REPO_SERVER_URL', 'https://apps.orendanet.com').replace(/\/+$/, '');
  const adminPrefix = requireEnv('ORENDA_REPO_ADMIN_PREFIX', '/admin/v1').replace(/\/+$/, '');
  const tenantId = requireEnv('ORENDA_REPO_TENANT_ID', 'official');
  const username = requireEnv('ORENDA_REPO_ADMIN_USERNAME');
  const password = requireEnv('ORENDA_REPO_ADMIN_PASSWORD');
  const manifest = require('../orenda-app.json');
  const version = require('../package.json').version;
  const digest = requireEnv('IMAGE_DIGEST');
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('IMAGE_DIGEST must be a sha256 digest');
  const image = `ghcr.io/orendanet/${appId}@${digest}`;

  const login = await request(baseUrl, `${adminPrefix}/auth/login`, { method: 'POST', body: JSON.stringify({ username, password }) });
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
  });
  const appRoot = `${root}/${encodeURIComponent(appId)}`;

  await request(baseUrl, `${appRoot}/storefront`, {
    method: 'PUT',
    token,
    body: JSON.stringify({
      slug: appId,
      headline: manifest.name,
      shortDescription: 'Start a managed WiFi hotspot with a secure local Orenda Home portal and optional internet access.',
      longDescription: 'OrendaBox Hotspot lets an Edge Console administrator name and password-protect a WiFi network for nearby devices. Devices discover the Box-specific HTTPS Orenda Home portal through a locally served first-use setup address, so Box-hosted apps remain available without internet access. Internet sharing is a separate toggle. Edge Manager owns the access point, DHCP and forwarding policy, so the app never receives interface names, host paths or firewall control.',
      categories: ['utilities', 'networking'],
      tags: ['wifi', 'hotspot', 'network'],
      documentationUrl: 'https://github.com/OrendaNet/OrendaBoxHotspot#readme',
      supportUrl: 'https://github.com/OrendaNet/OrendaBoxHotspot/issues'
    })
  });

  await upsert(baseUrl, `${appRoot}/versions`, token, {
    version,
    image,
    digest,
    architectures: ['arm64'],
    minPlatformVersion: '0.2.57',
    releaseNotes: manifest.versions?.[0]?.releaseNotes || 'Shows hotspot users the shared first-use setup address and the Box-specific HTTPS Orenda Home address instead of relying on a numeric gateway. The locally served setup flow lets devices trust the Box CA and use the translated, offline-capable Home PWA without internet access; login and app traffic stay on the unique per-Box HTTPS origin. Requires Edge Manager 0.2.48 and platform 0.2.57 or later.'
  });

  const release = await request(baseUrl, `${adminPrefix}/tenants/${encodeURIComponent(tenantId)}/publish`, {
    method: 'POST',
    token,
    body: JSON.stringify({
      label: `hotspot-${version}`,
      notes: `Published OrendaBox Hotspot ${version} (${digest}).`
    })
  });
  console.log(`Published ${appId} ${version} to ${baseUrl}; release=${release.release?.id || 'unknown'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
