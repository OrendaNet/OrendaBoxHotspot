# OrendaBox Hotspot

Start a managed WiFi hotspot on an OrendaBox so nearby phones, tablets and laptops can open Box-hosted web apps. The operator chooses the WiFi name and password and decides whether the hotspot also shares the Box internet connection.

The app is only the interface. Edge Manager owns the access point through NetworkManager: it selects a WiFi adapter that is not the active uplink, runs DHCP and DNS, applies the forwarding policy, and restores the hotspot after reboot. The app never receives interface names, host paths, firewall rules or permission to run host commands.

## Requirements

- OrendaBox platform `0.2.52` or later with an Orenda-managed Edge Manager `0.2.45` or later.
- SDK contract `1.2` with the `hotspot:manage` capability approved by a Box administrator at installation or update.
- A WiFi adapter that supports access point mode and is not currently the Box uplink. Use Ethernet for the uplink in hotspot deployments.
- Edge Console access for the operator. The app uses the standard Edge identity proxy; there is no separate login.

## Operation

1. Open the app from Edge Console and approve `hotspot:manage` when asked.
2. Set the WiFi name and password, then choose whether to share the Box internet connection.
3. Start the hotspot and tell nearby users to join the WiFi network and open the Box address shown in the app, for example `http://10.42.0.1/`.
4. Without internet sharing, devices still reach Box-hosted web apps. With sharing, the Box forwards traffic through its active uplink.
5. Stop the hotspot when it is no longer needed. Settings are retained for the next start.

The stored WiFi password is write-only: `GET /api/v1/runtime/hotspot` never returns it, and leaving the password field blank keeps the current passphrase.

## Development

Requires Node.js 20.3 or newer. There are no npm runtime dependencies.

```sh
npm run check
npm test
npm run dev
```

`npm run dev` starts the SDK development proxy on `http://127.0.0.1:3100`. The proxy is localhost-only and pretends to be an Edge administrator; the Box runtime API still requires an installed app, so hotspot operations report that the app must run on a Box.

## Release

1. Bump `package.json`.
2. Run the **Release hotspot image** workflow.

The workflow builds the ARM64 image on a native ARM64 runner, signs it with cosign, writes the digest-pinned release manifest, creates the GitHub release, and publishes the app to [Orenda Apps](https://apps.orendanet.com) when the organization `ORENDA_REPO_ADMIN_USERNAME` and `ORENDA_REPO_ADMIN_PASSWORD` secrets are available. Verify anonymous pulls of the GHCR package before expecting Boxes to install it.

## Security

- The app container stays unprivileged: read-only root, dropped capabilities, no host network and no host mounts.
- All browser requests require the Edge proxy identity; mutations require an Edge administrator role.
- The Box retains access-point, DHCP, NAT and firewall ownership. The app can only read hotspot status and set the WiFi name, password and internet toggle.

## License

MIT. See [LICENSE](LICENSE).
