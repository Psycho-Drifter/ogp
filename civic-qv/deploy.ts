/**
 * deploy.ts — Deploy all civic governance contracts in the correct order.
 *
 * Deployment order matters:
 *   1. CivicIdentityVerifier  (no dependencies)
 *   2. QuadraticVoting        (depends on CivicIdentityVerifier + ZK verifier)
 *   3. QuadraticFunding       (depends on CivicIdentityVerifier)
 *
 * On first deploy to a new network, VoteVerifier.sol must be generated
 * from the Circom circuit first (see README for circuit compilation steps).
 * For local testing, a MockVoteVerifier is used instead.
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network localhost   # local dev
 *   npx hardhat run scripts/deploy.ts --network mumbai      # testnet
 *   npx hardhat run scripts/deploy.ts --network polygon     # mainnet
 */

import { ethers, network } from 'hardhat'

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log(`\nDeploying to: ${network.name}`)
  console.log(`Deployer:     ${deployer.address}`)
  console.log(`Balance:      ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} MATIC\n`)

  // ── 1. Deploy CivicIdentityVerifier ────────────────────────────────────────
  console.log('1/4  Deploying CivicIdentityVerifier…')
  const CivicIdentityVerifier = await ethers.getContractFactory('CivicIdentityVerifier')
  const identityVerifier = await CivicIdentityVerifier.deploy(
    deployer.address,  // admin
    deployer.address,  // oracle (replace with multi-sig in production)
  )
  await identityVerifier.waitForDeployment()
  console.log(`     ✓ CivicIdentityVerifier: ${await identityVerifier.getAddress()}`)

  // ── 2. Deploy ZK Verifier ──────────────────────────────────────────────────
  // On local network: deploy MockVoteVerifier (always returns true)
  // On testnet/mainnet: deploy the real Circom-generated VoteVerifier
  console.log('\n2/4  Deploying VoteVerifier…')
  let zkVerifierAddress: string

  if (network.name === 'localhost' || network.name === 'hardhat') {
    const MockVerifier = await ethers.getContractFactory('MockVoteVerifier')
    const mockVerifier = await MockVerifier.deploy()
    await mockVerifier.waitForDeployment()
    zkVerifierAddress = await mockVerifier.getAddress()
    console.log(`     ✓ MockVoteVerifier (local only): ${zkVerifierAddress}`)
  } else {
    // Production: use the snarkjs-generated Solidity verifier
    // Run: snarkjs zkey export solidityverifier circuits/build/vote.zkey contracts/VoteVerifier.sol
    const VoteVerifier = await ethers.getContractFactory('Groth16Verifier') // generated name
    const voteVerifier = await VoteVerifier.deploy()
    await voteVerifier.waitForDeployment()
    zkVerifierAddress = await voteVerifier.getAddress()
    console.log(`     ✓ VoteVerifier (ZK-PLONK): ${zkVerifierAddress}`)
  }

  // ── 3. Deploy QuadraticVoting ──────────────────────────────────────────────
  console.log('\n3/4  Deploying QuadraticVoting…')
  const QuadraticVoting = await ethers.getContractFactory('QuadraticVoting')
  const qvContract = await QuadraticVoting.deploy(
    deployer.address,
    await identityVerifier.getAddress(),
    zkVerifierAddress,
  )
  await qvContract.waitForDeployment()
  console.log(`     ✓ QuadraticVoting: ${await qvContract.getAddress()}`)

  // ── 4. Deploy QuadraticFunding ─────────────────────────────────────────────
  // Uses MATIC (native token wrapper) as funding token on local; configure for prod
  console.log('\n4/4  Deploying QuadraticFunding…')

  // On local, deploy a mock ERC20 for testing
  let fundingTokenAddress: string
  if (network.name === 'localhost' || network.name === 'hardhat') {
    const MockToken = await ethers.getContractFactory('MockERC20')
    const mockToken = await MockToken.deploy('Civic Token', 'CVC', ethers.parseEther('1000000'))
    await mockToken.waitForDeployment()
    fundingTokenAddress = await mockToken.getAddress()
    console.log(`     (MockERC20 deployed for local testing: ${fundingTokenAddress})`)
  } else {
    // Production: use USDC or governance token address
    fundingTokenAddress = process.env.FUNDING_TOKEN_ADDRESS!
    if (!fundingTokenAddress) throw new Error('Set FUNDING_TOKEN_ADDRESS in .env for production deploy')
  }

  const QuadraticFunding = await ethers.getContractFactory('QuadraticFunding')
  const qfContract = await QuadraticFunding.deploy(
    deployer.address,
    await identityVerifier.getAddress(),
    fundingTokenAddress,
  )
  await qfContract.waitForDeployment()
  console.log(`     ✓ QuadraticFunding: ${await qfContract.getAddress()}`)

  // ── Grant roles ─────────────────────────────────────────────────────────────
  console.log('\nConfiguring roles…')

  // Grant QuadraticVoting proposer role to deployer (replace with DAO governance in prod)
  const PROPOSER_ROLE  = ethers.keccak256(ethers.toUtf8Bytes('PROPOSER_ROLE'))
  const OVERSIGHT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('OVERSIGHT_ROLE'))
  const AI_ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes('AI_ORACLE_ROLE'))

  await (await qvContract.grantRole(PROPOSER_ROLE,  deployer.address)).wait()
  await (await qvContract.grantRole(OVERSIGHT_ROLE, deployer.address)).wait()
  await (await qvContract.grantRole(AI_ORACLE_ROLE, deployer.address)).wait()
  console.log('  ✓ Roles granted to deployer')

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60))
  console.log('Deployment complete. Add these to your .env:\n')
  console.log(`IDENTITY_VERIFIER_ADDRESS=${await identityVerifier.getAddress()}`)
  console.log(`QV_CONTRACT_ADDRESS=${await qvContract.getAddress()}`)
  console.log(`QF_CONTRACT_ADDRESS=${await qfContract.getAddress()}`)
  console.log(`ZK_VERIFIER_ADDRESS=${zkVerifierAddress}`)
  console.log('─'.repeat(60) + '\n')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
