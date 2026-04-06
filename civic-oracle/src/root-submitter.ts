/**
 * root-submitter.ts
 *
 * Submits the keccak256 Merkle root to HierarchicalIdentityVerifier.publishShardRoot()
 * on Polygon at the start of each governance cycle.
 *
 * Security notes:
 *   - The oracle wallet should be a multi-sig in production (e.g. Gnosis Safe)
 *   - Each root submission should be audited: citizen count + XRPL ledger hash
 *     are stored on-chain as provenance — anyone can verify the snapshot
 *   - Root validity window matches the governance cycle duration
 */

import { ethers } from 'ethers'
import * as dotenv from 'dotenv'
import chalk from 'chalk'
import { saveSnapshot } from './identity-db'
import type { CycleSnapshot } from './types'

dotenv.config()

const IDENTITY_VERIFIER_ABI = [
  `function publishShardRoot(
    uint256 shardId,
    uint256 cycleId,
    bytes32 merkleRoot,
    uint256 validFrom,
    uint256 validUntil,
    uint256 identityCount,
    string calldata xrplLedgerHash
  ) external`,
  `function getShardRoot(uint256 shardId, uint256 cycleId) external view returns (
    tuple(bytes32 merkleRoot, uint256 validFrom, uint256 validUntil, uint256 identityCount, uint256 treeDepth, bool active)
  )`,
]

function getContract() {
  const rpc     = process.env.RPC_URL!
  const key     = process.env.ORACLE_PRIVATE_KEY!
  const addr    = process.env.IDENTITY_VERIFIER_ADDRESS!
  if (!rpc || !key || !addr) throw new Error('RPC_URL, ORACLE_PRIVATE_KEY, IDENTITY_VERIFIER_ADDRESS required')

  const provider = new ethers.JsonRpcProvider(rpc)
  const wallet   = new ethers.Wallet(key, provider)
  return new ethers.Contract(addr, IDENTITY_VERIFIER_ABI, wallet)
}

export async function submitShardRoot(
  cycleId:       number,
  shardId:       number,
  keccakRoot:    string,
  poseidonRoot:  string,
  citizenCount:  number,
  xrplLedgerHash:string,
  cycleDurationSeconds: number = parseInt(process.env.CYCLE_DURATION_SECONDS ?? '2592000', 10),
): Promise<string> {
  console.log(chalk.bold(`\n⛓  Submitting shard root to Polygon`))
  console.log(chalk.gray(`   Shard:   ${shardId}`))
  console.log(chalk.gray(`   Cycle:   ${cycleId}`))
  console.log(chalk.gray(`   Root:    ${keccakRoot}`))
  console.log(chalk.gray(`   Citizens:${citizenCount}`))

  const contract   = getContract()
  const validFrom  = Math.floor(Date.now() / 1000)
  const validUntil = validFrom + cycleDurationSeconds

  const tx = await contract.publishShardRoot(
    BigInt(shardId),
    BigInt(cycleId),
    keccakRoot,           // bytes32 — the keccak Merkle root
    BigInt(validFrom),
    BigInt(validUntil),
    BigInt(citizenCount),
    xrplLedgerHash,
  )

  console.log(chalk.gray(`   TX:      ${tx.hash}`))
  const receipt = await tx.wait(1)
  console.log(chalk.green(`   ✓ Root committed at block ${receipt.blockNumber}`))

  // Persist snapshot locally
  const snap: CycleSnapshot = {
    cycleId,
    shardId,
    citizenCount,
    keccakRoot,
    poseidonRoot,
    snapshotAt:     new Date().toISOString(),
    xrplLedgerHash,
  }
  saveSnapshot(snap)

  return tx.hash
}

export async function verifySubmission(cycleId: number, shardId: number, expectedRoot: string): Promise<boolean> {
  const contract = getContract()
  const stored   = await contract.getShardRoot(BigInt(shardId), BigInt(cycleId))
  return stored.merkleRoot.toLowerCase() === expectedRoot.toLowerCase()
}
