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
  minPlatformVersion: '0.2.57',
  releaseNotes: 'Shows hotspot users the shared first-use setup address and the Box-specific HTTPS Orenda Home address instead of relying on a numeric gateway. The locally served setup flow lets devices trust the Box CA and use the translated, offline-capable Home PWA without internet access; login and app traffic stay on the unique per-Box HTTPS origin. Requires Edge Manager 0.2.48 and platform 0.2.57 or later.'
}];
const errors = validateManifest(manifest, { release: true });
if (errors.length) throw new Error(errors.join('\n'));
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/orenda-app.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Validated ${manifest.id} ${version} for ARM64`);
