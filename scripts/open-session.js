// Opens a demo session against whatever network Hardhat is pointed at.
//
// Usage:
//   npx hardhat run scripts/open-session.js --network botTestnet
//
// Reads deployments/<network>.json for the contract address, opens a
// session with a fixed demo code/splits, and prints everything needed to
// fill in web/config.js and the MC agent's env vars.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const net = hre.network.name;
  const deploymentPath = path.join(__dirname, "..", "deployments", `${net}.json`);
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`no deployment found for ${net} — run the deploy script first`);
  }
  const { spraySession } = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  const [host] = await hre.ethers.getSigners();
  const contract = await hre.ethers.getContractAt("SpraySession", spraySession, host);

  const code = process.env.SESSION_CODE || "DEMO01";
  const title = process.env.SESSION_TITLE || "Demo Owambe";
  const minSpray = hre.ethers.parseEther(process.env.MIN_SPRAY || "0.0001");

  // celebrant 70% / DJ 20% / caterer 10% — same host wallet for all three in
  // this demo so we don't need extra funded accounts, but the split logic
  // runs exactly as it would with three real recipients.
  const splits = [
    { recipient: host.address, bps: 7000 },
    { recipient: host.address, bps: 2000 },
    { recipient: host.address, bps: 1000 },
  ];

  console.log(`opening session "${title}" with code ${code} on ${net}...`);
  const tx = await contract.openSession(code, title, minSpray, splits);
  const receipt = await tx.wait();

  const opened = receipt.logs
    .map((l) => { try { return contract.interface.parseLog(l); } catch { return null; } })
    .find((l) => l && l.name === "SessionOpened");
  const sessionId = opened.args.sessionId.toString();

  console.log(`\nsession opened: id=${sessionId}`);
  console.log(`tx: ${tx.hash}`);
  console.log(`\n--- drop these into web/config.js ---`);
  console.log(`SPRAY_ADDRESS: "${spraySession}"`);
  console.log(`SESSION_ID: "${sessionId}"`);
  console.log(`CODE: "${code}"`);
  console.log(`\n--- MC agent ---`);
  console.log(`SPRAY_ADDRESS=${spraySession} SESSION_ID=${sessionId} npm run mc`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
