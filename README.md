# AirMesh

AirMesh is a browser based peer-to-peer file transfer app. The signaling service coordinates short-lived pairing rooms; file bytes are sent over an encrypted WebRTC data channel and are never sent to the signaling service.

## Run locally

Start the signaling service in one terminal:

```powershell
cd airmesh.backend
npm install
npm run dev
```

Start the frontend in another terminal:

```powershell
cd airmesh.ui
npm install
npm run dev
```

Find the Windows PC's LAN IPv4 address with `ipconfig` (for example, `192.168.1.23`). Open AirMesh on both devices using `http://192.168.1.23:5173`, not `localhost`; the Vite dev script binds to the LAN now. If Windows Firewall prompts for Node.js, allow it on the private network. Both devices must be on the same non-guest Wi-Fi network, and the router must allow peer-to-peer traffic.

The browser defaults to signaling at `ws://<page-host>:8787/signal`. If needed, set `VITE_SIGNALING_URL=ws://192.168.1.23:8787/signal` before starting Vite. Use HTTPS and WSS in production. An HTTPS page cannot connect to this development server's plain `ws://` endpoint; the signaling server must be behind TLS termination. The signaling server listens on port 8787 by default; `PORT` overrides it.

## Architecture

- `airmesh.ui/src/components/` contains the application screen and reusable UI (including icons); `src/utils/` contains the WebRTC transfer hook and browser logger; `src/styles/` contains global and screen styles.
- `airmesh.backend/src/config/` contains runtime server limits, `src/routes/` contains HTTP route handlers, and `src/utils/` contains structured event logging. `src/server.ts` composes the HTTP and WebSocket signaling service. Room lifecycle and signaling currently live alongside the WebSocket connection handlers and can be extracted into a service as additional backend domains are added.
- The backend hosts `/signal` and `/health`. Rooms live in memory, use random 72 bit IDs and 192 bit pairing secrets, expire after ten minutes if nobody joins, and close when either peer leaves. It forwards only signaling messages and limits WebSocket messages to 64 KB.
- The peer connection uses STUN for ICE connectivity. WebRTC encrypts the data channel with DTLS. The signaling service never receives file contents.
- Files move as 64 KB chunks. Receivers use the browser file saving picker where available; browsers without a streaming save API buffer transfers up to 100 MB, then reject larger files to avoid unbounded memory use.

## Current limitations

- A TURN server is not configured. Networks that block peer-to-peer connectivity will fail to connect; this build does not relay data through the backend.
- Folder selection and an in-app camera scanner are not implemented. The operating system camera can scan the pairing URL, or users can paste the manual code.
- Files in a selected batch are sent one at a time, with receiver approval for each file. Simultaneous independent transfers and resume after interruption remain future work.
- Browser tabs must remain open and active during transfers. iOS background suspension, local-network browser policies, NAT behavior, and HTTPS requirements still need validation on real devices.
- A production deployment must terminate TLS for both the static site and signaling WebSocket and set `VITE_SIGNALING_URL` to the public WSS endpoint.

## Build

```powershell
cd airmesh.ui; npm run build
cd ..\airmesh.backend; npm run build
```
