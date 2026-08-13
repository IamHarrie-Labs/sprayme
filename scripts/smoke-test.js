// Joins and sprays a few times against the deployed test session, using the
// deployer key as the only funded account we have. This is throwaway — its
// only job is proving spray() -> Sprayed event -> settle() actually works
// before trusting the browser UI or the MC agent to any of it.
const hre = require("hardhat");

async function main() {
  const net = hre.network.name;
  const { spraySession } = require(`../deployments/${net}.json`);
  const [signer] = await hre.ethers.getSigners();
  const contract = await hre.ethers.getContractAt("SpraySession", spraySession, signer);

  const sessionId = await contract.sessionByCode("DEMO01");
  console.log(`session id ${sessionId}`);

  console.log("joining as 'Harrie'...");
  await (await contract.join(sessionId, "Harrie")).wait();

  for (const amt of ["0.001", "0.002", "0.003"]) {
    const tx = await contract.spray(sessionId, { value: hre.ethers.parseEther(amt) });
    const receipt = await tx.wait();
    const ev = receipt.logs
      .map((l) => { try { return contract.interface.parseLog(l); } catch { return null; } })
      .find((l) => l && l.name === "Sprayed");
    console.log(
      `sprayed ${amt} BOT -> guestTotal=${hre.ethers.formatEther(ev.args.guestTotal)} ` +
      `sessionTotal=${hre.ethers.formatEther(ev.args.sessionTotal)} tx=${tx.hash}`
    );
  }

  const owedBefore = await contract.owed(signer.address);
  console.log(`\nowed to host wallet before settle: ${hre.ethers.formatEther(owedBefore)} BOT`);

  const settleTx = await contract.settleAll(sessionId);
  await settleTx.wait();
  const owedAfter = await contract.owed(signer.address);
  console.log(`owed after settleAll: ${hre.ethers.formatEther(owedAfter)} BOT (should be 0)`);
  console.log(`settle tx: ${settleTx.hash}`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
