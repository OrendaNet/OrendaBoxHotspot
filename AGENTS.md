# OrendaBox Hotspot

Read `../OrendaDocs/AGENTS.md` and the OrendaBoxSDK hotspot, networking and auth contracts before changing integration.

- Keep the app as UI only: Edge Manager owns the access point, DHCP, NAT and firewall. Never mount host devices, add a privileged container or bypass install-time grants.
- Keep browser URLs relative and runtime credentials server-side.
- Use `apply_patch` for manual edits. Preserve unrelated local changes.
- Run `npm test` and `npm run check`; validate release manifests with the vendored SDK.
- Releases use native ARM64 builds and immutable image digests. Confirm anonymous image pulls before activating the market listing.
- Hotspot behavior depends on the WiFi radio and driver; distinguish local and CI checks from physical Tinkerboard 2S and CP3B verification.
