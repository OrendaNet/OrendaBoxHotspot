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
  minPlatformVersion: '0.2.52',
  releaseNotes: 'First release: managed WiFi hotspot for OrendaBox. Set the WiFi name and password, optionally share the Box internet connection, and let nearby devices reach Box-hosted web apps. Requires Edge Manager 0.2.45 and platform 0.2.52 or later.'
}];
const errors = validateManifest(manifest, { release: true });
if (errors.length) throw new Error(errors.join('\n'));
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/orenda-app.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Validated ${manifest.id} ${version} for ARM64`);
