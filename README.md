# OrendaBox Hotspot

Start a managed WiFi hotspot on an OrendaBox so nearby phones, tablets and laptops can open Box-hosted web apps. The operator chooses the WiFi name and password and decides whether the hotspot also shares the Box internet connection.

The app is only the interface. Edge Manager owns the access point through NetworkManager: it selects a WiFi adapter that is not the active uplink, runs DHCP and DNS, applies the forwarding policy, and optionally starts the hotspot after reboot. The app never receives interface names, host paths, firewall rules or permission to run host commands.

## Requirements

- OrendaBox platform `0.2.60` or later with an Orenda-managed Edge Manager `0.2.52` or later. Earlier Hotspot releases remain available for older Boxes. Platform `0.2.57+` supplies the local DNS, Box-specific HTTPS origin and first-use certificate setup used by Orenda Home.
- SDK contract `1.2` with the `hotspot:manage` capability approved by a Box administrator at installation or update.
- A WiFi adapter that supports access point mode. If that adapter is currently the Box uplink, an administrator can release the WiFi uplink from the app once Ethernet or mobile broadband is available.
- Edge Console access for the operator. The app uses the standard Edge identity proxy; there is no separate login.

## Operation

1. Open the app from Edge Console and approve `hotspot:manage` when asked.
2. Set the WiFi name and password, then choose whether to share the Box internet connection.
3. Start the hotspot and tell nearby users to join the WiFi network. On first use, open `http://apps.orenda.home.arpa/` to verify/install that Box's public local CA and discover its unique `https://apps-<20 hex>.orenda.home.arpa/` address; login and PWA installation happen only on that per-Box HTTPS origin.
4. If the hotspot cannot start because WiFi is the Box uplink, the app offers **Disconnect Wi-Fi & start hotspot**. It releases WiFi only when Ethernet or mobile broadband keeps the Box reachable, then starts the access point.
5. Without internet sharing, devices still reach Box-hosted web apps. With sharing, the Box forwards traffic through its active uplink.
6. Enable **Start hotspot automatically** in the app if this Box should prioritize the hotspot after reboot. The preference is saved independently; toggling it does not change the currently running hotspot. If WiFi is the Box uplink at boot, Edge Manager disconnects it only when Ethernet or mobile data has an active default route. Otherwise it waits and retries without disconnecting WiFi.
7. Stop the hotspot when it is no longer needed. Manual start and stop do not change the automatic-start preference.

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
- The Box retains access-point, DHCP, NAT and firewall ownership. The app can read hotspot status, set the WiFi name, password, internet-sharing and automatic-start preferences, and request that the Box release a WiFi uplink — which the Box refuses unless Ethernet or mobile broadband keeps it reachable.

## License

MIT. See [LICENSE](LICENSE).
