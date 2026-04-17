/**
 * proof-server.ts
 *
 * Serves Merkle proof bundles to citizens.
 *
 * A citizen needs two things to vote:
 *   1. keccak Merkle proof  → to call claimVoiceCredits() on Polygon
 *   2. Poseidon SMT proof   → to generate their ZK ballot via vote.circom
 *
 * Both are returned in a single API call so the citizen's wallet app
 * only needs one request before generating the proof client-side.
 *
 * Privacy note:
 *   This endpoint reveals that a given XRPL address is a registered citizen —
 *   that is public information (the XRPL NFT is publicly visible anyway).
 *   It does NOT reveal vote direction, which is protected by the ZK circuit.
 */

import express, { Request, Response } from 'express'
import * as dotenv from 'dotenv'
import chalk from 'chalk'
import { getIdentityByAddress, getSnapshot } from './identity-db'
import { getCachedTrees, getIdentityCommitment, getProofForCitizen } from './merkle-builder'
import type { CitizenProofBundle } from './types'

dotenv.config()

const PORT    = parseInt(process.env.PROOF_SERVER_PORT ?? '3002', 10)
const SHARD_ID = parseInt(process.env.SHARD_ID ?? '1', 10)

export function startProofServer() {
  const app = express()
  app.use(express.json())

  // ── Health ────────────────────────────────────────────────────────────────
  app.get('/health', (_req: Request, res: Response) => {
    const trees = getCachedTrees()
    const identityCount = trees?.identities.length ?? 0
    res.json({
      status:        'ok',
      service:       'civic-oracle-proof-server',
      shardId:       SHARD_ID,
      shardName:     process.env.SHARD_NAME ?? 'Earth',
      identityCount,
      treesBuilt:    !!trees,
      time:          new Date().toISOString(),
    })
  })

  // ── Proof bundle for a citizen ────────────────────────────────────────────
  // GET /proof/:address?cycle=<cycleId>
  app.get('/proof/:address', async (req: Request, res: Response) => {
    const { address } = req.params
    const cycleId     = parseInt(req.query['cycle'] as string ?? '0', 10)

    if (!address) {
      return res.status(400).json({ error: 'XRPL address is required' })
    }

    const trees = getCachedTrees()
    if (!trees) {
      return res.status(503).json({ error: 'Merkle trees not yet built — try again shortly' })
    }

    const identity = getIdentityByAddress(address)
    if (!identity) {
      return res.status(404).json({ error: 'Address not found in active identity set' })
    }

    if (identity.status !== 'active') {
      return res.status(403).json({ error: 'Identity has been revoked' })
    }

    try {
      const { keccakProof, poseidonProof, record } = await getProofForCitizen(trees, address)

      const bundle: CitizenProofBundle = {
        citizenAddress:       record.citizenAddress,
        identityCommitment:   getIdentityCommitment(record.citizenAddress),
        shardId:              record.shardId,
        cycleId,
        jurisdiction:         record.jurisdiction,
        voiceCredits:         record.voiceCredits,
        keccakMerkleProof:    keccakProof,
        poseidonPathElements: poseidonProof.pathElements.map(e => e.toString()),
        poseidonPathIndices:  poseidonProof.pathIndices,
        leafIndex:            poseidonProof.leafIndex.toString(),
      }

      res.json(bundle)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: msg })
    }
  })

  // ── Current Merkle roots ──────────────────────────────────────────────────
  app.get('/roots/:cycleId', (req: Request, res: Response) => {
    const cycleId = parseInt(req.params['cycleId'], 10)
    const snap    = getSnapshot(cycleId)
    if (!snap) return res.status(404).json({ error: 'No snapshot for this cycle' })
    res.json(snap)
  })

  // ── Identity count ────────────────────────────────────────────────────────
  app.get('/stats', (_req: Request, res: Response) => {
    const trees = getCachedTrees()
    res.json({
      shardId:       SHARD_ID,
      activeCount:   trees?.identities.length ?? 0,
      keccakRoot:    trees?.keccak.root ?? null,
      poseidonRoot:  trees ? '0x' + trees.poseidon.root.toString(16) : null,
    })
  })

  app.listen(PORT, () => {
    console.log(chalk.green(`✓ Proof server listening on port ${PORT}`))
  })
}
