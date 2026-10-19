# ♠ Lakdi Table

A local-multiplayer web app for the Indian card game **Call Break (Lakdi)**.  
4 players use their phones as hands; a 5th device placed in the middle acts as the shared table.

---

## Tech Stack

| Tool | Purpose |
|------|---------|
| Vite + React + TypeScript | Core framework |
| Tailwind CSS v4 | Styling |
| Framer Motion | Animations |
| PeerJS (WebRTC) | Networking (Phase 3) |
| qrcode.react | QR code for phone join |
| Vitest | Unit tests |

---

## Quick Start

```bash
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

### Testing on phones (same Wi-Fi)

```bash
npm run dev -- --host
```

This exposes the dev server on your local network IP (e.g. `http://192.168.x.x:5173`).  
Phones on the same Wi-Fi can open that URL.

---

## Routes

| URL | Description |
|-----|-------------|
| `/` | Home — Create Table or Join Table |
| `/dev` | **Dev Simulator** — all 5 devices in one tab |
| `/table` | Table (host) screen — *Phase 3, PeerJS* |
| `/player` | Player (phone) screen — *Phase 3, PeerJS* |

---

## Dev Simulator (`/dev`)

The fastest way to test the whole game:

- **Left panel (60%)** — the Table device (lobby → gameplay → scores)
- **Right panel (40%)** — 4 phone-sized frames, one per player (Alice/Bob/Carol/Dave)
- All connected through an in-memory `LocalHub` — no network needed

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
  engine/          Pure TypeScript game logic (zero UI/network)
    types.ts       Card, GameState, GameRules, ScoreResult …
    deck.ts        buildDeck, shuffleDeck (Fisher-Yates), dealCards
    moves.ts       legalMoves, trickWinnerIndex, isLegalPlay
    scoring.ts     computePlayerScore, buildRoundSummary
    engine.ts      createInitialState, startRound, applyBid, applyPlay
    __tests__/     84 Vitest tests (100% pass)

  net/             Transport layer
    transport.ts   Typed message unions + HostTransport/ClientTransport interfaces
    host.ts        HostController — owns GameState, validates all moves
    localTransport.ts  In-memory LocalHub (Phase 2)
    __tests__/     16 Vitest integration tests

  ui/
    components/    Shared — CardDisplay, TrickCardSlot
    table/         TableView, TableLobby, TableGameplay,
                   TableRoundSummary, TableLeaderboard, Scoreboard
    player/        PlayerView, PlayerJoin, BidPicker, PlayerHand
    dev/           DevSimulator
```

### Key design decisions

1. **Engine is pure**: `applyBid` / `applyPlay` take state → return new state. No mutation, no I/O.
2. **Host is the single source of truth**: every client message is validated server-side. Clients can't cheat.
3. **Hands are private**: `PRIVATE_STATE` is sent only to the owning seat. `PUBLIC_STATE` never includes hands.
4. **Transport is swappable**: `LocalHub` (Phase 2) and PeerJS (Phase 3) both implement the same `HostTransport` / `ClientTransport` interfaces.

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
npm run test:coverage     # coverage report
```

**5 test files · 100 tests · 100% passing**

---

## Deploy (Vercel / Netlify)

```bash
npm run build        # outputs to dist/
```

No backend required — it's a pure static site.  
Upload `dist/` to Vercel, Netlify, or any static host.

For Vite's SPA routing, add a catch-all redirect rule:  
- **Netlify**: `_redirects` → `/* /index.html 200`  
- **Vercel**: `vercel.json` → `{ "rewrites": [{ "source": "/(.*)", "destination": "/" }] }`

---

## Phase Roadmap

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | ✅ Done | Pure engine + Vitest tests |
| 2 | ✅ Done | Table + Player UI + LocalTransport dev simulator |
| 3 | 🔜 Next | PeerJS networking (swap LocalHub for PeerJSHub) |
| 4 | 🔜 Next | Polish: animations, vibration, QR join, production deploy |
