# OrendaBox Hotspot release notes

## 0.1.1

- Add a **Disconnect Wi-Fi & start hotspot** action for Boxes whose only free radio is the WiFi uplink. The Box releases WiFi only when Ethernet or mobile broadband keeps it reachable, then starts the access point.
- Show the Box uplink state so the action appears exactly when WiFi is blocking the hotspot.
- Requires Edge Manager `0.2.48` or later for the uplink-release route; the rest of the app keeps working on `0.2.45+`.
- Fixes in Edge Manager `0.2.48` also pin the access point to a permitted channel and clean stale profiles, which is what made starts time out on the Tinkerboard 2S RTL8852BE radio.

## 0.1.0

- First release of the managed OrendaBox WiFi hotspot.
- Configure the WiFi name and password from Edge Console; the password stays write-only.
- Choose Box-hosted apps only or share the Box internet connection.
- Show connected devices and the Box address nearby devices should open.
- Requires SDK contract 1.2, Edge Manager 0.2.45 and platform 0.2.53 or later.
