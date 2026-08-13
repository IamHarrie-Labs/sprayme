require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x" + "1".repeat(64);

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      // BOT Chain reports Cancun-era block fields, so the Shanghai default that
      // 0.8.24 emits (PUSH0 included) deploys cleanly. Pinned rather than left
      // implicit so a future compiler bump cannot silently change the target.
      evmVersion: "shanghai",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    botTestnet: {
      url: "https://rpc.bohr.life",
      chainId: 968,
      accounts: [PRIVATE_KEY],
    },
    botMainnet: {
      url: "https://rpc.botchain.ai",
      chainId: 677,
      accounts: [PRIVATE_KEY],
    },
  },
  etherscan: {
    // Blockscout ignores the key but Hardhat requires a non-empty string.
    apiKey: {
      botTestnet: "blockscout",
      botMainnet: "blockscout",
    },
    customChains: [
      {
        network: "botTestnet",
        chainId: 968,
        urls: {
          apiURL: "https://scan.bohr.life/api",
          browserURL: "https://scan.bohr.life",
        },
      },
      {
        network: "botMainnet",
        chainId: 677,
        urls: {
          apiURL: "https://scan.botchain.ai/api",
          browserURL: "https://scan.botchain.ai",
        },
      },
    ],
  },
};
