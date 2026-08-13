// Fires one spray at a given amount, for triggering the MC agent during
// manual testing. Throwaway script.
const hre = require("hardhat");

async function main() {
  const net = hre.network.name;
  const { spraySession } = require(`../deployments/${net}.json`);
  const [signer] = await hre.ethers.getSigners();
  const contract = await hre.ethers.getContractAt("SpraySession", spraySession, signer);
  const sessionId = await contract.sessionByCode(process.env.CODE || "DEMO01");
  const amt = process.env.AMT || "0.02";
  const tx = await contract.spray(sessionId, { value: hre.ethers.parseEther(amt) });
  console.log(`sprayed ${amt} BOT, tx ${tx.hash}`);
  await tx.wait();
  console.log("confirmed");
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
