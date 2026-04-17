import { ethers } from 'hardhat'
import * as dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../../civic-oracle/.env') })

async function main() {
  const oraclePrivateKey = process.env.ORACLE_PRIVATE_KEY
  if (!oraclePrivateKey) {
    throw new Error('ORACLE_PRIVATE_KEY is required in civic-oracle/.env')
  }

  const [deployer] = await ethers.getSigners()
  const oracleWallet = new ethers.Wallet(oraclePrivateKey)

  console.log(`\nDeploying HierarchicalIdentityVerifier to localhost`)
  console.log(`Deployer: ${deployer.address}`)
  console.log(`Oracle:   ${oracleWallet.address}`)

  const verifierFactory = await ethers.getContractFactory('HierarchicalIdentityVerifier')
  const verifier = await verifierFactory.deploy(deployer.address, oracleWallet.address)
  await verifier.waitForDeployment()

  const verifierAddress = await verifier.getAddress()
  console.log(`Verifier: ${verifierAddress}`)

  const oracleBalance = await ethers.provider.getBalance(oracleWallet.address)
  if (oracleBalance === 0n) {
    const fundTx = await deployer.sendTransaction({
      to: oracleWallet.address,
      value: ethers.parseEther('10'),
    })
    await fundTx.wait()
    console.log(`Funded oracle wallet with 10 ETH-equivalent on localhost`)
  } else {
    console.log(`Oracle wallet already funded: ${ethers.formatEther(oracleBalance)}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
