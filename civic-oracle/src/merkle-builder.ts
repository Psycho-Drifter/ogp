/**
 * merkle-builder.ts
 *
 * Builds two Merkle trees from the same identity dataset:
 *
 *   1. keccak256 Merkle tree (MerkleTree.js)
 *      Used by: HierarchicalIdentityVerifier.verifyAndGetCredits() on Polygon
 *      Leaf:    keccak256(abi.encodePacked(address, jurisdiction, voiceCredits))
 *      Root:    submitted on-chain each governance cycle
 *
 *   2. Poseidon Sparse Merkle Tree (zk-kit SMT)
 *      Used by: Citizens generating ZK ballot proofs (vote.circom)
 *      Leaf:    Poseidon(identitySecret, shardId) stored at leafIndex = citizenIndex
 *      Root:    served to citizens via proof server; included in ZK public inputs
 *
 * Why two trees?
 *   The keccak256 tree is verified by Solidity (cheap, well-supported).
 *   The Poseidon SMT is verified inside the ZK circuit (required for proof privacy).
 *   Both are built from the same dataset — same citizens, different hash functions.
 */

import { MerkleTree } from 'merkletreejs'
import keccak256 from 'keccak256'
import { ethers } from 'ethers'
import chalk from 'chalk'
import { getActiveIdentities } from './identity-db'
import type { IdentityRecord, CycleSnapshot } from './types'

// ── keccak256 Merkle tree ────────────────────────────────────────────────────

export interface KeccakTree {
  tree:     MerkleTree
  root:     string            // hex string, ready for on-chain submission
  leaves:   Map<string, Buffer>  // citizenAddress → leaf Buffer
}

function buildKeccakTree(identities: IdentityRecord[]): KeccakTree {
  const leaves = new Map<string, Buffer>()

  const leafBuffers = identities.map(id => {
    // Must match HierarchicalIdentityVerifier:
    //   keccak256(abi.encodePacked(citizen, jurisdiction, voiceCredits))
    const packed = ethers.solidityPacked(
      ['address', 'string', 'uint256'],
      [id.citizenAddress, id.jurisdiction, id.voiceCredits]
    )
    const leaf = Buffer.from(keccak256(Buffer.from(packed.slice(2), 'hex')))
    leaves.set(id.citizenAddress.toLowerCase(), leaf)
    return leaf
  })

  const tree = new MerkleTree(leafBuffers, keccak256, { sortPairs: true })
  const root = '0x' + tree.getRoot().toString('hex')

  return { tree, root, leaves }
}

export function getKeccakProof(keccakTree: KeccakTree, citizenAddress: string): string[] {
  const leaf = keccakTree.leaves.get(citizenAddress.toLowerCase())
  if (!leaf) throw new Error(`No leaf for address ${citizenAddress}`)
  return keccakTree.tree.getHexProof(leaf)
}

// ── Poseidon Sparse Merkle Tree ───────────────────────────────────────────────
// Uses poseidon-lite for hashing — matches the Circom circuit exactly.
// The SMT is keyed by leafIndex (BigInt) with value = zkCommitment (BigInt).

interface SMTProof {
  root:          bigint
  pathElements:  bigint[]
  pathIndices:   number[]
  leafIndex:     bigint
}

// Simple in-memory SMT using poseidon-lite
// For production with 100M+ identities, use a database-backed SMT
export interface PoseidonSMT {
  root:    bigint
  entries: Map<bigint, bigint>   // leafIndex → zkCommitment
  depth:   number
}

async function buildPoseidonSMT(identities: IdentityRecord[]): Promise<PoseidonSMT> {
  const { poseidon } = await import('poseidon-lite')

  const entries = new Map<bigint, bigint>()

  identities.forEach((id, index) => {
    const leafIndex    = BigInt(index)
    const zkCommitment = BigInt(id.zkCommitment)
    entries.set(leafIndex, zkCommitment)
  })

  // Compute root by building the tree bottom-up
  // For depth=64 with sparse population, we compute only the populated paths
  const root = computeSMTRoot(entries, 64n, poseidon)

  return { root, entries, depth: 64 }
}

function computeSMTRoot(
  entries: Map<bigint, bigint>,
  depth: bigint,
  poseidon: (inputs: bigint[]) => bigint
): bigint {
  if (entries.size === 0) return 0n

  // Build level-by-level
  // This is a simplified root computation — production uses @zk-kit/sparse-merkle-tree
  let level = new Map<bigint, bigint>(entries)

  for (let d = 0n; d < depth; d++) {
    const nextLevel = new Map<bigint, bigint>()
    const processed = new Set<bigint>()

    for (const [index, value] of level) {
      const parent = index >> 1n
      if (processed.has(parent)) continue
      processed.add(parent)

      const siblingIndex = index % 2n === 0n ? index + 1n : index - 1n
      const sibling = level.get(siblingIndex) ?? 0n

      const left  = index % 2n === 0n ? value   : sibling
      const right = index % 2n === 0n ? sibling : value

      if (left === 0n && right === 0n) continue
      nextLevel.set(parent, poseidon([left, right]))
    }

    level = nextLevel
  }

  return level.get(0n) ?? 0n
}

async function getSMTProof(
  smt: PoseidonSMT,
  leafIndex: bigint,
  depth: number
): Promise<SMTProof> {
  const { poseidon } = await import('poseidon-lite')

  const pathElements: bigint[] = []
  const pathIndices:  number[]  = []

  // Rebuild levels to trace the path
  let level = new Map<bigint, bigint>(smt.entries)

  let currentIndex = leafIndex

  for (let d = 0; d < depth; d++) {
    const siblingIndex = currentIndex % 2n === 0n ? currentIndex + 1n : currentIndex - 1n
    const sibling = level.get(siblingIndex) ?? 0n
    const direction = Number(currentIndex % 2n)

    pathElements.push(sibling)
    pathIndices.push(direction)

    // Move up
    const nextLevel = new Map<bigint, bigint>()
    const processed = new Set<bigint>()
    for (const [index, value] of level) {
      const parent = index >> 1n
      if (processed.has(parent)) continue
      processed.add(parent)
      const sib = level.get(index % 2n === 0n ? index + 1n : index - 1n) ?? 0n
      const left  = index % 2n === 0n ? value : sib
      const right = index % 2n === 0n ? sib : value
      if (left !== 0n || right !== 0n) {
        nextLevel.set(parent, poseidon([left, right]))
      }
    }
    level = nextLevel
    currentIndex = currentIndex >> 1n
  }

  return {
    root:         smt.root,
    pathElements,
    pathIndices,
    leafIndex,
  }
}

// ── Public interface ──────────────────────────────────────────────────────────

export interface BuiltTrees {
  keccak:   KeccakTree
  poseidon: PoseidonSMT
  identities: IdentityRecord[]
}

let cachedTrees: BuiltTrees | null = null

export async function buildTrees(shardId: number): Promise<BuiltTrees> {
  console.log(chalk.cyan(`\n🌳 Building Merkle trees for shard ${shardId}…`))

  const identities = getActiveIdentities(shardId)
  console.log(chalk.gray(`   Active identities: ${identities.length}`))

  const keccak   = buildKeccakTree(identities)
  const poseidon = await buildPoseidonSMT(identities)

  console.log(chalk.green(`   ✓ keccak256 root:  ${keccak.root}`))
  console.log(chalk.green(`   ✓ Poseidon root:   0x${poseidon.root.toString(16)}`))

  cachedTrees = { keccak, poseidon, identities }
  return cachedTrees
}

export function getCachedTrees(): BuiltTrees | null {
  return cachedTrees
}

export async function getProofForCitizen(
  trees: BuiltTrees,
  citizenAddress: string,
): Promise<{ keccakProof: string[], poseidonProof: SMTProof, record: IdentityRecord }> {
  const record = trees.identities.find(
    id => id.citizenAddress.toLowerCase() === citizenAddress.toLowerCase()
  )
  if (!record) throw new Error(`Citizen ${citizenAddress} not found in active identity set`)

  const keccakProof   = getKeccakProof(trees.keccak, citizenAddress)
  const leafIndex     = BigInt(trees.identities.indexOf(record))
  const poseidonProof = await getSMTProof(trees.poseidon, leafIndex, trees.poseidon.depth)

  return { keccakProof, poseidonProof, record }
}
