import { HardhatUserConfig } from 'hardhat/config'
import '@nomicfoundation/hardhat-toolbox'
import * as dotenv from 'dotenv'
dotenv.config()

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? '0x' + '0'.repeat(64)
const POLYGONSCAN_API_KEY  = process.env.POLYGONSCAN_API_KEY  ?? ''
const ALCHEMY_MUMBAI_URL   = process.env.ALCHEMY_MUMBAI_URL   ?? ''
const ALCHEMY_POLYGON_URL  = process.env.ALCHEMY_POLYGON_URL  ?? ''
const POLYGON_RPC_URL      = process.env.POLYGON_RPC_URL      ?? ALCHEMY_POLYGON_URL
const POLYGON_FORK_BLOCK_NUMBER = process.env.POLYGON_FORK_BLOCK_NUMBER
  ? Number(process.env.POLYGON_FORK_BLOCK_NUMBER)
  : undefined

const hardhatForking =
  POLYGON_RPC_URL
    ? {
        url: POLYGON_RPC_URL,
        ...(POLYGON_FORK_BLOCK_NUMBER !== undefined ? { blockNumber: POLYGON_FORK_BLOCK_NUMBER } : {}),
      }
    : undefined

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      forking: hardhatForking,
    },
    localhost: {
      url: 'http://127.0.0.1:8545',
      chainId: 31337,
    },
    mumbai: {
      url: ALCHEMY_MUMBAI_URL,
      accounts: [DEPLOYER_PRIVATE_KEY],
      chainId: 80001,
    },
    polygon: {
      url: ALCHEMY_POLYGON_URL,
      accounts: [DEPLOYER_PRIVATE_KEY],
      chainId: 137,
    },
  },
  etherscan: {
    apiKey: { polygon: POLYGONSCAN_API_KEY, polygonMumbai: POLYGONSCAN_API_KEY },
  },
  gasReporter: {
    enabled: true,
    currency: 'USD',
  },
  paths: {
    sources:   './contracts',
    tests:     './test',
    cache:     './cache',
    artifacts: './artifacts',
  },
}

export default config
