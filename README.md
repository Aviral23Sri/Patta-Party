<p align="center"><img src="public/favicon.svg" width="96" alt="Patta Party logo" /></p>

# Patta Party

[![CI](https://github.com/Aviral23Sri/Patta-Party/actions/workflows/ci.yml/badge.svg)](https://github.com/Aviral23Sri/Patta-Party/actions/workflows/ci.yml)

**Call Break for one table and four phones.**

A local-multiplayer web app for the Indian card game **Call Break** (also called *Lakdi*; failing
your bid is a "lakdi").  
4 players use their phones as hands; a 5th device placed in the middle acts as the shared table.  
Devices talk directly to each other over WebRTC (PeerJS). There is no game server.

---

## Tech Stack

| Tool | Purpose |
|------|---------|
| Vite + React + TypeScript | Core framework |
| Tailwind CSS v4 | Styling |
| Framer Motion | Animations |
| PeerJS (WebRTC data channels) | Table ↔ phone networking |
| qrcode.react | QR code for phone join |
| Vitest | Unit, integration and transport-contract tests |

---

## Run locally

```bash
npm install
npm run dev
```

Open **http://localhost:5173**. On one machine you can:

- open **`/dev`** for the Dev Simulator (table + 4 phones in one tab, no network), or
- open **`/table`** in one tab and **`/play?room=CODE`** in up to 4 more tabs or windows. This uses real
  PeerJS/WebRTC, even inside one browser.

## Test on real phones (same Wi-Fi)

Phones can't open `localhost`: that address means *the phone itself*. Serve the app on your
laptop's LAN address instead:

```bash
npm run dev:lan
```

1. Vite prints a **Network** URL, e.g. `http://192.168.1.23:5173`.
2. On the laptop (or a tablet acting as the table), open **`http://192.168.1.23:5173/table`**.
   Don't use `localhost`: the QR code and join link are built from the page's own origin, so they'd point
   phones at `localhost`. If you do open `/table` on localhost, the lobby shows a warning with
   clickable LAN addresses.
3. Phones scan the QR code, or open the link shown under it. **📋 Copy join link** copies it so
   you can paste it into a chat. They land on the join screen with the room code filled in.
4. Once all 4 seats show a green dot, press **Start Game**.

Troubleshooting:

- **Windows firewall:** allow Node.js on *Private* networks the first time Vite asks.
- **Phones can't load the page:** guest and "client isolation" Wi-Fi networks block
  device-to-device traffic. Use a normal home network or a phone hotspot.
- **The page loads but the phones never connect:** see [TURN](#strict-networks-turn) below.
- On plain `http://` LAN addresses the browser disables the Screen Wake Lock and Clipboard
  APIs, because both need a secure context. The app falls back gracefully: the table shows a
  "keep this screen on manually" hint, and copying falls back to a prompt. Over `https` (any
  deployment) both work.

## Test over a tunnel (HTTPS, any network, before deploying)

A tunnel gives your local dev server a public `https://` URL. Phones don't need to be on your
Wi-Fi, and because it's HTTPS, Wake Lock and the Clipboard API work just as they will in production.
`vite.config.ts` already allows the common tunnel domains (`server.allowedHosts`).

**VS Code port forwarding (Dev Tunnels)**

1. `npm run dev`
2. In VS Code open the **Ports** panel (next to Terminal) → **Forward a Port** → `5173`.
3. Right-click the port → **Port Visibility → Public**. Otherwise every phone has to sign in to
   GitHub/Microsoft first.
4. Open the forwarded URL + `/table` (e.g. `https://abc123-5173.inc1.devtunnels.ms/table`) on the
   table device. The QR code and join link automatically use that tunnel URL.

**Alternatives** (no VS Code needed):

```bash
npx cloudflared tunnel --url http://localhost:5173   # prints https://<random>.trycloudflare.com
ngrok http 5173                                      # needs a free ngrok account
```

To test the production build instead of the dev server: `npm run build && npm run preview`, then
tunnel port `4173`.

Notes: the tunnel only carries the web page. Gameplay traffic is WebRTC, which goes directly
between devices or through STUN/TURN, so a tunnel doesn't remove the TURN requirement on strict
networks. The tunnel URL changes each time unless you make it persistent. Stop forwarding when you're done:
a public port is reachable by anyone who has the link.

---

## Routes

| URL | Description |
|-----|-------------|
| `/` | Home: Create Table / Join Table |
| `/?room=CODE` | QR / join link → goes straight to `/play?room=CODE` |
| `/table` | Table (host) screen. Reserves a room code and hosts the game |
| `/play` | Player (phone) screen. Join with name + room code |
| `/dev` | **Dev Simulator**: all 5 devices in one tab via in-memory `LocalTransport` |

---

## Networking (Phase 3)

```
 Phone ──┐                         ┌── PeerJS signalling server (0.peerjs.com)
 Phone ──┼── WebRTC data channel ──┤   only used to find each other
 Phone ──┤   (direct, peer-to-peer)│
 Phone ──┘            │            └── STUN/TURN for NAT traversal
                 Table (host)
            HostController = single source of truth
```

- **Room code → peer ID.** The table registers `pattaparty-<CODE>` on the PeerJS server. Codes are 4
  characters from an alphabet without `0/O/1/I/L`. If the ID is taken, it retries with a new code.
- **Transports are swappable.** `PeerHostTransport` / `PeerClientTransport` implement the
  same `HostTransport` / `ClientTransport` interfaces as the in-memory `LocalHub`, and contain no
  game logic. The same contract test suite runs against both.
- **Reconnection.** Each phone keeps its seat token in `sessionStorage`, so every tab is its own
  player and a refresh keeps the token. If a phone refreshes, sleeps or drops, it reconnects and
  re-sends `JOIN` with its token. The host gives it back the same seat and its current hand. The
  phone shows a **Reconnecting…** banner meanwhile. *Closing* the tab discards the token, and
  that seat can't be reclaimed mid-game.
- **Disconnected players** show a red dot or "📴 disconnected" on the table. Their turn is **never
  skipped**: the table shows "Waiting for X to reconnect…".
- **Host gone.** When the table closes it broadcasts `HOST_DISCONNECTED`. If the host vanishes
  without a goodbye, phones give up after a few reconnect attempts. Either way the phone shows
  *"Host disconnected: ask the table to restart"*. Game state lives only on the table, so
  refreshing the table ends the game; the table asks for confirmation first.
- **Heartbeat.** The host pings every connection every 5 s and the phone answers. A link silent for
  15 s is treated as dead on both sides: the host marks the seat offline and the phone reconnects.
- **Screen Wake Lock** keeps the table awake, and the phones awake during a game, where supported.
- **Security basics.** Every inbound frame must be a string under a size cap (2 KB phone→host). It
  is JSON-parsed safely and validated by hand-written guards (`src/net/protocol.ts`) that return a
  sanitised copy. The host ignores everything except `JOIN` from a connection that hasn't joined,
  and closes connections that keep sending garbage. Seat tokens are 96-bit random values.

### "Connecting…" never finishes / "couldn't connect directly"

Loading the page and *finding* the table both go through servers (your tunnel or host, and
the PeerJS signalling server). The game link itself is **direct device-to-device WebRTC**. If the
network can't carry a direct link, the phone shows *"Found the table but couldn't connect to it
directly"* after about 45 s, and the table shows a ⚠ banner.

The most common trap is **the laptop using a phone's hotspot while that same phone plays**.
Android doesn't offer the hotspot interface to WebRTC, so the phone can only use mobile data. The
laptop sits behind that same phone and the carrier's NAT, and the two can't reach each other.
Fixes, easiest first:

1. Put the table and all phones on the **same normal Wi-Fi router**.
2. Use a hotspot from a phone (or device) that **isn't** playing. Other phones on that hotspot
   connect fine.
3. Add a **TURN relay** (below). This works on any network, including the hotspot case.

### Strict networks (TURN)

Public STUN servers (Google, Cloudflare) are configured by default. That covers the same Wi-Fi and
most home routers. A phone's own hotspot, corporate Wi-Fi, some mobile carriers and symmetric NATs
need a **TURN relay**, which forwards the (tiny) game traffic when a direct link is impossible.

Free option: create a free account at [Metered](https://www.metered.ca/stun-turn) (free monthly
quota, which is plenty for card games) and open your TURN app's credentials page. It lists the
URLs, username and credential.
Copy `.env.example` to `.env.local` (or set the variables on your host) and fill in:

```bash
VITE_TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:5349
VITE_TURN_USERNAME=...
VITE_TURN_CREDENTIAL=...
```

Include the TCP/443 variants your provider lists (e.g. `turn:…:443?transport=tcp`,
`turns:…:443?transport=tcp`): they get through the strictest firewalls. **Restart `npm run dev`**
after editing `.env.local`, because Vite reads env files only at startup. For a deployed site, add the same
variables in Vercel/Netlify and redeploy.

The config is built in `src/net/peerConfig.ts`. You can also point at your own PeerJS
signalling server with `VITE_PEER_HOST` / `VITE_PEER_PORT` / `VITE_PEER_PATH` / `VITE_PEER_SECURE`.
⚠️ `VITE_*` values are baked into the client bundle and are **public**, so use short-lived or
restricted TURN credentials.

---

## Dev Simulator (`/dev`)

The fastest way to test the whole game:

- **Left panel (60%):** the Table device (lobby → gameplay → scores)
- **Right panel (40%):** 4 phone-sized frames, one per player (Alice/Bob/Carol/Dave). **▲ expand**
  enlarges one.
- All connected through an in-memory `LocalHub`, with no network

### Dev controls (bottom bar)

| Button | Action |
|--------|--------|
| **Auto A / B / C / D** | Auto-play one random legal move for that seat |
| **⏩ Fast-forward round** | Plays all remaining moves in the current round instantly |
| **▶ Next Round** | Advances from round_summary to the next round |

---

## Architecture

```
src/
  engine/              Pure TypeScript game logic (zero UI/network)
    types.ts           Card, GameState, GameRules, ScoreResult …
    deck.ts            buildDeck, shuffleDeck (Fisher-Yates), dealCards
    moves.ts           legalMoves, trickWinnerIndex, isLegalPlay
    scoring.ts         computePlayerScore, buildRoundSummary
    engine.ts          createInitialState, startRound, applyBid, applyPlay

  net/                 Transport layer
    transport.ts       Message unions + HostTransport/ClientTransport interfaces
    protocol.ts        Frame encode/decode, size caps, runtime shape guards
    host.ts            HostController: owns GameState, validates all moves, seats/tokens
    localTransport.ts  In-memory LocalHub (dev simulator, tests)
    peerHostTransport.ts    WebRTC host: room-code reservation, heartbeat, frame validation
    peerClientTransport.ts  WebRTC client: reconnect with backoff, heartbeat watchdog
    peerTypes.ts       Minimal PeerJS interfaces + lazy-loading factory
    peerConfig.ts      ICE servers (STUN + optional TURN) and signalling options from env
    roomCode.ts        Room codes, peer IDs, join URLs

  ui/
    components/        CardDisplay
    hooks/             useWakeLock
    table/             TableHostPage, TableView, TableLobby, TableGameplay,
                       TableRoundSummary, TableLeaderboard, Scoreboard
    player/            PlayerPage, PlayerView, PlayerJoin, BidPicker, PlayerHand
    dev/               DevSimulator
```

### Key design decisions

1. **Engine is pure**: `applyBid` / `applyPlay` take state → return new state. No mutation, no I/O.
2. **Host is the single source of truth**: every client message is validated on the host. Clients can't cheat.
3. **Hands are private**: `PRIVATE_STATE` is sent only to the owning seat. `PUBLIC_STATE` never includes hands.
4. **Transport is swappable**: `LocalHub` and the PeerJS transports implement the same interfaces
   and pass the same contract tests.

---

## Game Rules

| Rule | Default | Configurable |
|------|---------|-------------|
| Rounds | 5 | ✅ 1–10 |
| Min Bid | 2 | ✅ 1–6 |
| Overbid Cap | 2× | ✅ 1–4× |
| Must Beat Highest | Yes | ✅ Toggle |
| Redeal if no ♠ | Yes | ✅ Toggle |
| Play Direction | Anti-clockwise | ✅ |
| Trump Suit | Spades | ❌ (always) |

### Scoring

- **T < B** → Lakdi ❌ · score = −B  
- **B ≤ T ≤ Cap×B** → Success ✅ · score = B + 0.1×(T−B)  
- **T > Cap×B** → Lakdi 🔥 (overbid) · score = −B  

---

## Running Tests

```bash
npm test                  # run all tests once
npm run test:watch        # watch mode
npm run test:coverage     # coverage report (engine + net)
```

| Suite | What it covers |
|-------|----------------|
| `engine/__tests__/*` | Deck, legal moves, scoring, state machine |
| `net/__tests__/host.test.ts` | HostController: joins, validation, privacy, JOIN gating, reconnection |
| `net/__tests__/protocol.test.ts` | Message guards, frame size caps, room codes, ICE config |
| `net/__tests__/transport.contract.test.ts` | One contract suite run against **LocalTransport** and **PeerJS transports** (mocked PeerJS) |
| `net/__tests__/peerTransport.test.ts` | Room-code retry, garbage frames, heartbeat timeouts, reconnect, host-lost |

---

## Deploy

```bash
npm run build        # type-checks, then outputs a static site to dist/
```

There's no backend, so any static host works. The site must be served over **HTTPS**, which
Vercel and Netlify do by default; Wake Lock and Clipboard need it. The routes (`/table`, `/play`,
`/dev`) are client-side, so the host needs an SPA fallback. Both are already configured:

### Vercel

`vercel.json` rewrites every path to `index.html`.

1. Import the repo at <https://vercel.com/new>. The framework preset is **Vite**, the build command is
   `npm run build` and the output directory is `dist`.
2. Optional: add the `VITE_TURN_*` / `VITE_PEER_*` variables under *Settings → Environment
   Variables*, then redeploy.

Or from the CLI: `npx vercel` (preview) and `npx vercel --prod`.

### Netlify

`public/_redirects` (`/* /index.html 200`) is copied into `dist/` at build time.

1. *Add new site → Import an existing project*. Use `npm run build` as the build command and `dist` as the
   publish directory.
2. Optional: add the `VITE_TURN_*` / `VITE_PEER_*` variables under *Site configuration →
   Environment variables*, then redeploy.

Or drag-and-drop the `dist/` folder onto <https://app.netlify.com/drop>.

After deploying, open `https://<your-site>/table` on the table device. The QR code automatically uses
the deployed origin.

---

## Phase Roadmap

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | ✅ Done | Pure engine + Vitest tests |
| 2 | ✅ Done | Table + Player UI + LocalTransport dev simulator |
| 3 | ✅ Done | PeerJS networking, reconnection, heartbeat, wake lock, deploy config |
| 4 | 🔜 Next | Polish: animations, sounds, production hardening |
