const fs = require('node:fs');
const { validateManifest } = require('../sdk/manifest');
const manifest = require('../orenda-app.json');
const version = require('../package.json').version;
const digest = process.env.IMAGE_DIGEST;
if (!/^sha256:[a-f0-9]{64}$/.test(digest || '')) throw new Error('Provide the published ARM64 image digest');
manifest.versions = [{
  version,
  image: `ghcr.io/orendanet/orenda-box-hotspot@${digest}`,
  digest,
  architectures: ['arm64'],
  minPlatformVersion: '0.2.60',
  releaseNotes: 'Adds a separate automatic-start switch. Edge Manager stores the boot preference without changing the running hotspot, safely waits for an Ethernet or mobile default route before releasing a WiFi uplink, and retries when needed. Requires Edge Manager 0.2.52 and Platform 0.2.60. The Box-specific HTTPS Orenda Home setup remains available offline.'
}];
const errors = validateManifest(manifest, { release: true });
if (errors.length) throw new Error(errors.join('\n'));
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/orenda-app.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Validated ${manifest.id} ${version} for ARM64`);
