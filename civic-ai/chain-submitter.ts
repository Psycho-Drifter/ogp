/**
 * chain-submitter.ts
 *
 * Submits the approved AI briefing on-chain by calling
 * QuadraticVoting.attachAIBriefing(proposalId, ipfsCid, contentHash).
 *
 * This is the final, tamper-proof step. Once the briefing is on-chain:
 *   - The IPFS CID is immutable (content-addressed)
 *   - The keccak256 hash is immutable (stored in the contract)
 *   - Citizens can verify the IPFS content matches the hash at any time
 *   - No one — not even the issuer — can change what analysis citizens saw
 *
 * The AI oracle wallet (AI_ORACLE_PRIVATE_KEY) must have the AI_ORACLE_ROLE
 * on the QuadraticVoting contract (granted during deployment).
 */

import { ethers } from 'ethers'
import * as dotenv from 'dotenv'
import chalk from 'chalk'
import type { PublishedBriefing, ChainSubmissionResult } from './types'

dotenv.config()

// Minimal ABI — only the functions we need
const QV_ABI = [
  'function attachAIBriefing(uint256 proposalId, string calldata briefingIpfsCid, bytes32 briefingHash) external',
  'function getProposal(uint256 proposalId) external view returns (tuple(uint256 id, address proposer, string title, string descriptionIpfsCid, string aiBriefingIpfsCid, bytes32 aiBriefingHash, uint8 state, uint256 cycleId, uint256 votingStart, uint256 votingEnd, uint256 totalVotesFor, uint256 totalVotesAgainst, uint256 totalVotersParticipated, uint256 quorumRequired, uint256 thresholdBps, bool isEmergency))',
  'event AIBriefingAttached(uint256 indexed proposalId, string aiBriefingIpfsCid, bytes32 aiBriefingHash)',
]

function getProvider(): ethers.JsonRpcProvider {
  const rpc = process.env.RPC_URL
  if (!rpc) throw new Error('RPC_URL not set in .env')
  return new ethers.JsonRpcProvider(rpc)
}

function getOracleWallet(): ethers.Wallet {
  const key = process.env.AI_ORACLE_PRIVATE_KEY
  if (!key) throw new Error('AI_ORACLE_PRIVATE_KEY not set in .env')
  return new ethers.Wallet(key, getProvider())
}

function getQVContract(wallet: ethers.Wallet): ethers.Contract {
  const addr = process.env.QV_CONTRACT_ADDRESS
  if (!addr) throw new Error('QV_CONTRACT_ADDRESS not set in .env')
  return new ethers.Contract(addr, QV_ABI, wallet)
}

export async function submitBriefingOnChain(
  published: PublishedBriefing,
  proposalId: string,
): Promise<ChainSubmissionResult> {
  console.log(chalk.bold('\n⛓  Submitting briefing on-chain…'))
  console.log(chalk.gray(`   Proposal: ${proposalId}`))
  console.log(chalk.gray(`   IPFS CID: ${published.ipfsCid}`))

  const wallet   = getOracleWallet()
  const contract = getQVContract(wallet)

  console.log(chalk.gray(`   Oracle:   ${wallet.address}`))
  console.log(chalk.cyan('   Sending transaction…'))

  const tx = await contract.attachAIBriefing(
    BigInt(proposalId),
    published.ipfsCid,
    published.contentHash,
  )

  console.log(chalk.gray(`   TX hash:  ${tx.hash}`))
  console.log(chalk.cyan('   Waiting for confirmation…'))

  const receipt = await tx.wait(1)  // wait for 1 block confirmation

  const result: ChainSubmissionResult = {
    proposalId,
    txHash:      tx.hash,
    ipfsCid:     published.ipfsCid,
    contentHash: published.contentHash,
    blockNumber: receipt.blockNumber,
    submittedAt: new Date().toISOString(),
  }

  console.log(chalk.green('\n   ✅ Briefing committed on-chain'))
  console.log(chalk.gray(`      Block:  ${result.blockNumber}`))
  console.log(chalk.gray(`      TX:     https://polygonscan.com/tx/${result.txHash}`))

  return result
}

export async function verifyOnChain(proposalId: string, expectedCid: string): Promise<boolean> {
  const provider = getProvider()
  const addr     = process.env.QV_CONTRACT_ADDRESS!
  const contract = new ethers.Contract(addr, QV_ABI, provider)

  const proposal = await contract.getProposal(BigInt(proposalId))
  return proposal.aiBriefingIpfsCid === expectedCid
}
