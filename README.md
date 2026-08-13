# Spray

Digital owambe spraying, on-chain, on [BOT Chain](https://www.botchain.ai/).

Spraying naira at Nigerian ceremonies is culturally non-negotiable and
technically illegal — the Central Bank's naira-abuse rules make it a
prosecutable offence, and the EFCC has jailed people for it. Spray keeps the
ritual and removes the crime: guests spray with real value, in public, on a
live wall, in a currency that isn't naira in the first place.

This only works on a chain where a single spray — often 100–500 naira's
worth — isn't dwarfed by its own gas fee, and where twenty rapid-fire sprays
in ten seconds actually confirm fast enough to feel like spraying. Measured
directly against BOT Chain mainnet: **0.77s average block time**, spray cost
≈0.001 BOT (~20 gwei gas price). Nothing about this product survives on a
chain with 12-second blocks.

## How it works

1. A host opens a session and gets a short, announceable code (`TUNDE24`).
2. Guests join with that code and a display name — printed on the
   programme, shown on the wall, called out by the MC.
3. Guests spray: tap a denomination, or hold the button for continuous
   rapid-fire sprays, one transaction per spray.
4. An **AI MC agent** watches the session on-chain and reacts live, in Naija
   Pidgin, on the projector wall — the same role a human hype man plays at
   every real owambe: watch who sprays, call their name, drive the next
   person to outdo them.
5. Money is split automatically on-chain — celebrant, DJ, caterer — and
   settled at session close. Nobody chases anyone for money the next
   morning.

## Why the agent is an agent, not a chatbot

It is never prompted by a human. It polls the chain for `Sprayed` events,
maintains a running picture of the party (leaderboard, pace, who just got
overtaken), and *decides* whether a given spray is worth reacting to — most
aren't. When it decides yes, it composes a line and writes it back on-chain
through `hype()`, from its own wallet. Perceive, decide, act, all
autonomous.

BOT Chain's node does not expose `eth_subscribe`
(`"notifications not supported"`, confirmed directly against the mainnet
RPC) — so the agent polls `eth_getLogs` on a 400ms interval instead of
holding a WebSocket open. At a measured 0.77s block time that still reacts
within about a second, which the LLM call itself already costs.

## Contracts

- [`contracts/SpraySession.sol`](contracts/SpraySession.sol) — session
  lifecycle (open/join/spray/gift/close), on-chain revenue splits via pull
  payments, and the `Hyped` event the MC agent writes to. Spraying and
  gifting are deliberately different events: spraying is the public,
  performative leaderboard entry; gifting is the same money without the
  theatre, for the envelope-gift half of Nigerian ceremony culture.

## Network

| | Testnet | Mainnet |
|---|---|---|
| Chain ID | 968 | **677** |
| RPC | https://rpc.bohr.life | https://rpc.botchain.ai |
| Explorer | https://scan.bohr.life | https://scan.botchain.ai |
| Measured block time | — | **0.77s** (100-block sample) |

## Setup

```
npm install
cp .env.example .env   # fill in PRIVATE_KEY, GROQ_API_KEY
npx hardhat compile
npm run deploy:testnet   # or deploy:mainnet once funded
```

Deployment writes `deployments/<network>.json` with the contract address,
then copy it into `web/config.js` (see `web/config.example.js`) alongside
the ABI.

Run the MC agent against a live session:

```
SPRAY_ADDRESS=0x... SESSION_ID=1 npm run mc
```

Open `web/spray.html` for the guest spray screen and `web/wall.html` for
the projector display — both are static files, no build step, just needs
`web/config.js` filled in first.

## Pages

- `web/index.html` — landing page, routes to host or join.
- `web/host.html` — sign in, then create either a full party session
  (title, minimum spray, multi-recipient splits) or a personal request
  (single-recipient session, no leaderboard framing needed) — same contract
  call either way, `openSession`, just different split arrays. Ends on a
  code + QR + join link + wall link.
- `web/spray.html` — sign in, join by code (or a `?code=` deep link from a
  scanned QR), then spray or gift.
- `web/wall.html` — public, read-only projector display. No wallet needed.
- `web/wallet.js` — shared sign-in module used by host.html and
  spray.html. Two paths behind one interface: `signInWithEmail()`
  (Web3Auth embedded wallet) and `connectInjected()` (MetaMask-style
  fallback, useful for testing before a Client ID exists).

## Known gaps (being worked on)

- **Web3Auth Client ID.** `web/config.js` ships with
  `WEB3AUTH_CLIENT_ID: ""`. Get a free one at dashboard.web3auth.io and
  paste it in — until then, email sign-in fails with a clear inline error
  and the "connect a wallet instead" fallback still works for testing.
  Note for anyone extending this: the `@web3auth/modal` UMD bundle exports
  its global as `window.Modal`, with the class at `Modal.Web3Auth` — not
  `window.Web3Auth` as the package name suggests. Confirmed by inspecting
  `window.Modal` at runtime; cost an hour before it was caught.
- **Nonce management for hold-to-spray.** Resolved — `spray.html`'s hold
  loop awaits each transaction's submission before starting the next, so
  two unconfirmed transactions never race for the same nonce. A plain
  `setInterval` firing every N ms was tried first and does race under any
  RPC latency (this is also what bit the MC agent's own polling loop
  during testing — see `agent/mc.js`, fixed the same way: snapshot state,
  advance the cursor, then await).

## License

MIT
