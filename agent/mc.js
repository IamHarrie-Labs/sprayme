// The MC agent.
//
// Watches one SpraySession on-chain, decides when a spray is worth reacting
// to, and writes a hype line back on-chain through `hype()`. It never speaks
// on every event — the restraint is the point, the same way a real MC does
// not narrate every single spray, only the ones that move the room.
//
// BOT Chain's node does not support eth_subscribe ("notifications not
// supported" — checked directly against the mainnet RPC), so this polls
// eth_getLogs on a short interval instead of holding a WebSocket open. At a
// measured ~0.77s block time, a 400ms poll still reacts inside about a
// second, which is fast enough that the gap is never visible next to the LLM
// call itself.
require("dotenv").config();
const { ethers } = require("ethers");
const abi = require("./abi");

const POLL_MS = 400;
const RPC_URL = process.env.RPC_URL || "https://rpc.botchain.ai";
const SPRAY_ADDRESS = process.env.SPRAY_ADDRESS;
const SESSION_ID = process.env.SESSION_ID;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

if (!SPRAY_ADDRESS || !SESSION_ID) {
  console.error("set SPRAY_ADDRESS and SESSION_ID in the environment before running");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const contract = new ethers.Contract(SPRAY_ADDRESS, abi, wallet);

// ---- party state, kept in memory for the duration of the session ----------
const state = {
  sessionId: SESSION_ID,
  total: 0n,
  sprayCount: 0,
  leader: null,        // { addr, name, total }
  lastSprayAt: 0,       // ms epoch of the last spray seen
  lastHypeAt: 0,        // ms epoch of the last time the agent spoke
  names: new Map(),     // address -> display name, filled from Joined events
};

const MIN_GAP_MS = 4000; // never speak more often than this, however busy the room gets

async function decideAndMaybeSpeak(ev) {
  const { guest, amount, guestTotal, sessionTotal } = ev;
  const name = state.names.get(guest.toLowerCase()) || short(guest);
  const now = Date.now();

  const previousLeaderTotal = state.leader ? state.leader.total : 0n;
  const tookLead = guestTotal > previousLeaderTotal && guest.toLowerCase() !== (state.leader?.addr || "");
  const bigSpray = amount >= ethers.parseEther("0.01"); // tune per event's currency-to-BOT rate
  const speakingTooSoon = now - state.lastHypeAt < MIN_GAP_MS;

  if (tookLead) {
    state.leader = { addr: guest.toLowerCase(), name, total: guestTotal };
  }

  const worthSpeaking = (tookLead || bigSpray) && !speakingTooSoon;
  if (!worthSpeaking) return;

  const line = await composeLine({ name, amount, guestTotal, sessionTotal, tookLead });
  state.lastHypeAt = now;

  try {
    const tx = await contract.hype(state.sessionId, line);
    console.log(`[hype] ${line}  (tx ${tx.hash})`);
    await tx.wait();
  } catch (err) {
    console.error("failed to write hype line:", err.shortMessage || err.message);
  }
}

async function composeLine({ name, amount, guestTotal, sessionTotal, tookLead }) {
  const amountBot = ethers.formatEther(amount);
  const totalBot = ethers.formatEther(sessionTotal);

  const prompt = tookLead
    ? `${name} just sprayed ${amountBot} BOT and is now leading the party with ${ethers.formatEther(guestTotal)} BOT total. Party total so far: ${totalBot} BOT.`
    : `${name} just sprayed a big one: ${amountBot} BOT. Party total so far: ${totalBot} BOT.`;

  if (!GROQ_API_KEY) return fallbackLine(name, amountBot, tookLead);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.9,
        max_tokens: 40,
        messages: [
          {
            role: "system",
            content:
              "You are the MC at a Nigerian owambe, hyping up the spray leaderboard on a projector wall. " +
              "Speak in energetic Naija Pidgin, one short punchy line, no more than 15 words. " +
              "No quotation marks, no emoji, no hashtags. React to the specific event you're given.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    return text || fallbackLine(name, amountBot, tookLead);
  } catch (err) {
    console.error("groq call failed, falling back:", err.message);
    return fallbackLine(name, amountBot, tookLead);
  }
}

function fallbackLine(name, amountBot, tookLead) {
  return tookLead
    ? `${name} don spray ${amountBot} BOT o! Who go beat am?!`
    : `Ehen! ${name} just blow ${amountBot} BOT! Make we hear una noise!`;
}

function short(addr) {
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

// ---- polling loop -----------------------------------------------------

let fromBlock = null;

async function pollOnce() {
  const head = await provider.getBlockNumber();
  if (fromBlock === null) fromBlock = head; // start from now, ignore history on boot
  if (head < fromBlock) return; // nothing new since our last successful read

  // Snapshot the range and advance the cursor before awaiting anything else,
  // so a slow-running poll can never overlap the next tick's range.
  const rangeFrom = fromBlock;
  const rangeTo = head;
  fromBlock = head + 1;

  const joined = await contract.queryFilter(contract.filters.Joined(state.sessionId), rangeFrom, rangeTo);
  for (const ev of joined) {
    state.names.set(ev.args.guest.toLowerCase(), ev.args.name);
  }

  const sprays = await contract.queryFilter(contract.filters.Sprayed(state.sessionId), rangeFrom, rangeTo);
  for (const ev of sprays) {
    const { guest, amount, guestTotal, sessionTotal } = ev.args;
    state.total = sessionTotal;
    state.sprayCount += 1;
    state.lastSprayAt = Date.now();
    await decideAndMaybeSpeak({ guest, amount, guestTotal, sessionTotal });
  }
}

async function backfillNames() {
  // Guests who joined before the agent booted would otherwise show up as a
  // bare address the first time they spray. Sweep all Joined events for this
  // session once at startup — cheap, one-time, and unbounded block range is
  // fine here since it only ever runs once per process.
  const events = await contract.queryFilter(contract.filters.Joined(state.sessionId));
  for (const ev of events) {
    state.names.set(ev.args.guest.toLowerCase(), ev.args.name);
  }
  if (events.length) console.log(`backfilled ${events.length} guest name(s)`);
}

async function main() {
  console.log(`MC agent watching session ${SESSION_ID} at ${SPRAY_ADDRESS}`);
  console.log(`wallet: ${wallet.address}`);

  await backfillNames();

  // Self-scheduling loop rather than setInterval: guarantees at most one
  // pollOnce in flight, so a slow RPC round-trip can never overlap the next
  // tick and race the fromBlock cursor (exactly what caused an inverted
  // eth_getLogs range during testing).
  while (true) {
    try {
      await pollOnce();
    } catch (err) {
      console.error("poll error:", err.message);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main();
