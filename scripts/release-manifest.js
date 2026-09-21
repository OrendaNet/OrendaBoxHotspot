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
  minPlatformVersion: '0.2.53',
  releaseNotes: 'Adds a Disconnect Wi-Fi & start hotspot action for Boxes whose WiFi radio is the uplink: the Box releases WiFi only when Ethernet or mobile broadband keeps it reachable, then starts the access point. Releasing a WiFi uplink requires Edge Manager 0.2.48 or later; other hotspot operations keep working on Edge Manager 0.2.45 and platform 0.2.53 or later.'
}];
const errors = validateManifest(manifest, { release: true });
if (errors.length) throw new Error(errors.join('\n'));
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/orenda-app.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Validated ${manifest.id} ${version} for ARM64`);
