/**
 * oracle.ts
 *
 * Main entry point for the civic identity oracle.
 *
 * Startup sequence:
 *   1. Connect to database
 *   2. Start XRPL watcher (replay history + subscribe live)
 *   3. Build initial Merkle trees from current identity set
 *   4. Start proof server
 *   5. Schedule periodic tree rebuilds
 *   6. On cycle start: snapshot + submit root to Polygon
 *
 * The oracle is designed to be stateless-restartable:
 *   - DB persists identity state across restarts
 *   - XRPL watcher replays from last known ledger
 *   - Trees are rebuilt from DB on every start
 */

import * as dotenv from 'dotenv'
import chalk from 'chalk'
import { getDb } from './identity-db'
import { startXRPLWatcher } from './xrpl-watcher'
import { buildTrees } from './merkle-builder'
import { startProofServer } from './proof-server'
import { submitShardRoot } from './root-submitter'
import { getIdentityCount, getSnapshot } from './identity-db'

dotenv.config()

const SHARD_ID    = parseInt(process.env.SHARD_ID    ?? '1', 10)
const REBUILD_MS  = parseInt(process.env.MERKLE_REBUILD_INTERVAL_MS ?? '3600000', 10)
const CYCLE_SECS  = parseInt(process.env.CYCLE_DURATION_SECONDS ?? '2592000', 10)

// ── Determine current cycle ID (simple time-based) ────────────────────────────
function getCurrentCycleId(): number {
  const GENESIS_TIMESTAMP = 1700000000  // Nov 2023 — replace with actual genesis
  const elapsed = Math.floor(Date.now() / 1000) - GENESIS_TIMESTAMP
  return Math.floor(elapsed / CYCLE_SECS) + 1
}

// ── Snapshot + submit if new cycle ────────────────────────────────────────────
async function checkAndSubmitCycle() {
  const cycleId = getCurrentCycleId()
  const existing = getSnapshot(cycleId)

  if (existing) {
    console.log(chalk.gray(`Oracle: cycle ${cycleId} root already submitted`))
    return
  }

  const count = getIdentityCount(SHARD_ID)
  if (count === 0) {
    console.log(chalk.yellow(`Oracle: no active identities in shard ${SHARD_ID} — skipping root submission`))
    return
  }

  console.log(chalk.bold(`\n📋 New governance cycle detected (cycle ${cycleId})`))
  const trees = await buildTrees(SHARD_ID)

  const poseidonRootHex = '0x' + trees.poseidon.root.toString(16)

  if (!process.env.ORACLE_PRIVATE_KEY || !process.env.IDENTITY_VERIFIER_ADDRESS) {
    console.log(chalk.yellow('\n[DEV] Chain credentials not set — skipping on-chain submission'))
    console.log(chalk.gray(`  keccak root:   ${trees.keccak.root}`))
    console.log(chalk.gray(`  Poseidon root: ${poseidonRootHex}`))
    console.log(chalk.gray(`  Citizens:      ${trees.identities.length}`))
    return
  }

  await submitShardRoot(
    cycleId,
    SHARD_ID,
    trees.keccak.root,
    poseidonRootHex,
    trees.identities.length,
    `xrpl-snapshot-cycle-${cycleId}`,
    CYCLE_SECS,
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(chalk.bold('\n╔════════════════════════════════════════╗'))
  console.log(chalk.bold('║       Civic Identity Oracle            ║'))
  console.log(chalk.bold('╚════════════════════════════════════════╝'))
  console.log(chalk.gray(`Shard:    ${SHARD_ID} (${process.env.SHARD_NAME ?? 'Earth'})`))
  console.log(chalk.gray(`Network:  ${process.env.XRPL_NETWORK}`))
  console.log(chalk.gray(`Chain:    ${process.env.RPC_URL ? 'Polygon (configured)' : 'not configured'}\n`))

  // 1. Init database
  getDb()
  console.log(chalk.green('✓ Database ready'))

  // 2. Build initial trees from existing DB state
  const initialCount = getIdentityCount(SHARD_ID)
  console.log(chalk.gray(`  ${initialCount} active identities in DB`))

  if (initialCount > 0) {
    await buildTrees(SHARD_ID)
  }

  // 3. Start XRPL watcher — rebuild trees on new identity events
  let rebuildScheduled = false
  await startXRPLWatcher(() => {
    // Debounce: rebuild trees at most once per 10 seconds on bursts of mints
    if (!rebuildScheduled) {
      rebuildScheduled = true
      setTimeout(async () => {
        await buildTrees(SHARD_ID)
        rebuildScheduled = false
      }, 10_000)
    }
  })

  // 4. Start proof server
  startProofServer()

  // 5. Check if we need to submit a new cycle root
  await checkAndSubmitCycle()

  // 6. Periodic rebuild + cycle check
  setInterval(async () => {
    console.log(chalk.gray('\n[interval] Rebuilding trees…'))
    await buildTrees(SHARD_ID)
    await checkAndSubmitCycle()
  }, REBUILD_MS)

  console.log(chalk.bold.green('\n✅ Oracle fully operational\n'))
}

main().catch(err => {
  console.error(chalk.red('Oracle startup failed:'), err)
  process.exit(1)
})
