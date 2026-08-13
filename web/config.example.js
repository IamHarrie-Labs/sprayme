// Copy to config.js and fill in after deployment.
// This file is intentionally plain JS (not JSON) so it can be dropped straight
// into a <script> tag with no build step — the whole web/ folder is meant to
// run as static files during the demo, no bundler required.
window.SPRAY_CONFIG = {
  RPC_URL: "https://rpc.botchain.ai",       // testnet: https://rpc.bohr.life
  CHAIN_ID_HEX: "0x2a5",                    // testnet: 0x3c8
  EXPLORER_URL: "https://scan.botchain.ai", // testnet: https://scan.bohr.life
  SPRAY_ADDRESS: "0xPASTE_DEPLOYED_ADDRESS",
  SESSION_ID: "1",
  CODE: "TUNDE24",
  // Gift drops: a separate, tiny contract. A drop is funded once, split into
  // a fixed number of parcels, and claimed first-come-first-served by
  // whoever has the code — unrelated to spray sessions, which is the point.
  GIFTDROP_ADDRESS: "0xPASTE_DEPLOYED_GIFTDROP_ADDRESS",
  // Get a free Client ID at https://developer.metamask.io — until this is
  // set, app.html falls back to "Connect a wallet instead".
  WEB3AUTH_CLIENT_ID: "",
  ABI: [
    "event SessionOpened(uint256 indexed sessionId, address indexed host, string code, string title, uint256 minSpray, uint64 timestamp)",
    "event Joined(uint256 indexed sessionId, address indexed guest, string name, uint64 timestamp)",
    "event Sprayed(uint256 indexed sessionId, address indexed guest, uint256 amount, uint256 guestTotal, uint256 sessionTotal, uint64 sprayIndex, uint64 timestamp)",
    "event Hyped(uint256 indexed sessionId, address indexed agent, string line, uint64 timestamp)",
    "event SessionClosed(uint256 indexed sessionId, uint256 total, uint64 timestamp)",
    "event Settled(uint256 indexed sessionId, address indexed recipient, uint256 amount)",
    "function openSession(string sessionCode, string sessionTitle, uint256 minimumSpray, tuple(address recipient, uint16 bps)[] splits) returns (uint256)",
    "function join(uint256 sessionId, string name)",
    "function spray(uint256 sessionId) payable",
    "function hype(uint256 sessionId, string line)",
    "function closeSession(uint256 sessionId)",
    "function settle(uint256 sessionId, address recipient)",
    "function settleAll(uint256 sessionId)",
    "function sessionByCode(string sessionCode) view returns (uint256)",
    "function title(uint256) view returns (string)",
    "function code(uint256) view returns (string)",
    "function minSpray(uint256) view returns (uint256)",
    "function getSession(uint256 sessionId) view returns (tuple(address host, uint64 createdAt, bool open, uint128 total, uint64 sprayCount, uint64 giftCount))",
    "function getSplits(uint256 sessionId) view returns (tuple(address recipient, uint16 bps)[])",
    "function guestName(uint256, address) view returns (string)",
    "function sprayedBy(uint256, address) view returns (uint256)",
  ],
  GIFTDROP_ABI: [
    "event DropCreated(uint256 indexed dropId, address indexed creator, string code, uint256 perClaim, uint32 maxClaims, uint64 timestamp)",
    "event Claimed(uint256 indexed dropId, address indexed claimant, uint256 amount, uint32 claimsRemaining, uint64 timestamp)",
    "function createDrop(string code, uint32 maxClaims) payable returns (uint256)",
    "function claim(string code)",
    "function dropByCode(string code) view returns (uint256)",
    "function getDrop(uint256 dropId) view returns (tuple(address creator, uint128 perClaim, uint32 maxClaims, uint32 claimsUsed, bool exists))",
    "function hasClaimed(uint256, address) view returns (bool)",
  ],
};
