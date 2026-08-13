const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const net = hre.network.name;
  const balance = await hre.ethers.provider.getBalance(deployer.address);

  console.log(`network   ${net}`);
  console.log(`deployer  ${deployer.address}`);
  console.log(`balance   ${hre.ethers.formatEther(balance)} BOT`);

  if (balance === 0n) {
    throw new Error("deployer has no balance — fund it before deploying");
  }

  const factory = await hre.ethers.getContractFactory("GiftDrop");
  const giftDrop = await factory.deploy();
  await giftDrop.waitForDeployment();

  const address = await giftDrop.getAddress();
  const tx = giftDrop.deploymentTransaction();
  console.log(`\nGiftDrop deployed to ${address}`);
  console.log(`deploy tx ${tx.hash}`);

  const out = path.join(__dirname, "..", "deployments", `${net}.json`);
  const existing = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : {};
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        ...existing,
        network: net,
        chainId: Number((await hre.ethers.provider.getNetwork()).chainId),
        giftDrop: address,
        giftDropDeployTx: tx.hash,
        giftDropDeployedAt: new Date().toISOString(),
      },
      null,
      2
    ) + "\n"
  );
  console.log(`wrote ${out}`);

  console.log(`\nverify with:\n  npx hardhat verify --network ${net} ${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
