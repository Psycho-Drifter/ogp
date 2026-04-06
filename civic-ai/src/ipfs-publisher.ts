/**
 * ipfs-publisher.ts
 *
 * Publishes AI briefings to IPFS via Pinata.
 *
 * Why IPFS for briefings:
 *   - Content-addressed: the CID is a hash of the content.
 *     If anyone tampers with the briefing, the CID changes.
 *   - Permanent: pinned content cannot be deleted or altered.
 *   - The on-chain keccak256 hash is a second anchor —
 *     citizens can verify the IPFS content matches the on-chain commitment.
 *
 * In production: run your own IPFS nodes in addition to Pinata
 * for redundancy. Citizens and auditors can pin independently.
 */

import axios from 'axios'
import { createHash } from 'crypto'
import * as dotenv from 'dotenv'
import chalk from 'chalk'
import { ethers } from 'ethers'
import type { AIBriefing, PublishedBriefing } from './types'

dotenv.config()

const PINATA_JWT     = process.env.PINATA_JWT      ?? ''
const PINATA_GATEWAY = process.env.PINATA_GATEWAY  ?? 'https://gateway.pinata.cloud'

const PINATA_PIN_URL = 'https://api.pinata.cloud/pinning/pinJSONToIPFS'

export async function publishToIPFS(briefing: AIBriefing): Promise<PublishedBriefing> {
  console.log(chalk.cyan('\n📌 Publishing briefing to IPFS…'))

  const briefingJson = JSON.stringify(briefing, null, 2)

  // Compute content hash — this goes on-chain as the tamper-proof anchor
  // keccak256 matches what Solidity's keccak256(abi.encodePacked(...)) produces
  const contentHash = ethers.keccak256(ethers.toUtf8Bytes(briefingJson))

  let ipfsCid: string

  if (!PINATA_JWT) {
    // Dev mode: return a deterministic mock CID based on the content hash
    console.log(chalk.yellow('   No PINATA_JWT — using mock CID for development'))
    ipfsCid = `QmMock${contentHash.slice(2, 46)}`
  } else {
    // Production: pin to IPFS via Pinata
    const response = await axios.post(
      PINATA_PIN_URL,
      {
        pinataContent: briefing,
        pinataMetadata: {
          name:    `civic-briefing-${briefing.proposalId}`,
          keyvalues: {
            proposalId:  briefing.proposalId,
            generatedAt: briefing.generatedAt,
            modelId:     briefing.modelId,
            riskScore:   String(briefing.overallRiskScore),
          },
        },
        pinataOptions: { cidVersion: 1 },
      },
      {
        headers: {
          Authorization: `Bearer ${PINATA_JWT}`,
          'Content-Type': 'application/json',
        },
      }
    )
    ipfsCid = response.data.IpfsHash
  }

  const published: PublishedBriefing = {
    briefing,
    ipfsCid,
    contentHash,
    ipfsUrl:  `${PINATA_GATEWAY}/ipfs/${ipfsCid}`,
    pinnedAt: new Date().toISOString(),
  }

  console.log(chalk.green('   ✓ Published to IPFS'))
  console.log(chalk.gray(`     CID:          ${ipfsCid}`))
  console.log(chalk.gray(`     Content hash: ${contentHash}`))
  console.log(chalk.gray(`     URL:          ${published.ipfsUrl}`))

  return published
}

export async function fetchFromIPFS(cid: string): Promise<AIBriefing> {
  const url      = `${PINATA_GATEWAY}/ipfs/${cid}`
  const response = await axios.get(url, { timeout: 15_000 })
  return response.data as AIBriefing
}

export function verifyContentHash(briefing: AIBriefing, expectedHash: string): boolean {
  const actualHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(briefing, null, 2)))
  return actualHash.toLowerCase() === expectedHash.toLowerCase()
}
