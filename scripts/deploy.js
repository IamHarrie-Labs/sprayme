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

  const factory = await hre.ethers.getContractFactory("SpraySession");
  const spray = await factory.deploy();
  await spray.waitForDeployment();

  const address = await spray.getAddress();
  const tx = spray.deploymentTransaction();
  console.log(`\nSpraySession deployed to ${address}`);
  console.log(`deploy tx ${tx.hash}`);

  const out = path.join(__dirname, "..", "deployments", `${net}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        network: net,
        chainId: Number((await hre.ethers.provider.getNetwork()).chainId),
        spraySession: address,
        deployTx: tx.hash,
        deployedAt: new Date().toISOString(),
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
