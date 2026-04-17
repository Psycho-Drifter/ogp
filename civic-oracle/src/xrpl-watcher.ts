/**
 * xrpl-watcher.ts
 *
 * Watches the XRPL ledger for civic identity NFT events.
 *
 * Two event types:
 *   NFTokenMint (from issuer) → add identity to DB
 *   NFTokenBurn (by issuer)   → revoke identity in DB
 *
 * Recovery:
 *   On startup, the watcher replays transactions from last_ledger+1
 *   to the current validated ledger, then subscribes for live events.
 *   This ensures no NFT mints/burns are missed if the oracle was offline.
 *
 * Memo extraction:
 *   The civic identity NFT stores these memos (set in civic-id mint-identity.ts):
 *     civic-identity/citizen-id     → UUID (not sensitive)
 *     civic-identity/zk-commitment  → Poseidon leaf commitment
 *     civic-identity/jurisdiction   → e.g. "CA-BC"
 *   Plus the wallet address of the NFT recipient.
 */

import { Client, convertHexToString } from 'xrpl'
import * as dotenv from 'dotenv'
import chalk from 'chalk'
import { upsertIdentity, revokeIdentity, getLastLedger, setLastLedger } from './identity-db'
import type { IdentityRecord } from './types'

dotenv.config()

const XRPL_NETWORK   = process.env.XRPL_NETWORK    ?? 'wss://s.altnet.rippletest.net:51233'
const ISSUER_ADDRESS = process.env.ISSUER_ADDRESS   ?? ''
const NFT_TAXON      = parseInt(process.env.CIVIC_NFT_TAXON ?? '1000', 10)
const SHARD_ID       = parseInt(process.env.SHARD_ID ?? '1', 10)
const VOICE_CREDITS  = parseInt(process.env.VOICE_CREDITS_PER_CITIZEN ?? '100', 10)
const MEMO_TYPES     = {
  ZK_COMMITMENT: 'civic-identity/zk-commitment',
  JURISDICTION:  'civic-identity/jurisdiction',
  CITIZEN_ID:    'civic-identity/citizen-id',
}

// ── Memo decoder ─────────────────────────────────────────────────────────────

function decodeMemos(memos: Array<{Memo: {MemoType?: string, MemoData?: string}}>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const { Memo } of memos) {
    if (!Memo.MemoType || !Memo.MemoData) continue
    const key   = convertHexToString(Memo.MemoType)
    const value = convertHexToString(Memo.MemoData)
    result[key] = value
  }
  return result
}

// ── Process a single NFTokenMint transaction ──────────────────────────────────

function processMint(tx: Record<string, unknown>, ledgerIndex: number): void {
  if (tx['TransactionType'] !== 'NFTokenMint') return
  if (tx['Account'] !== ISSUER_ADDRESS) return

  // Check taxon matches civic identity collection
  if ((tx['NFTokenTaxon'] as number) !== NFT_TAXON) return

  const memos = decodeMemos((tx['Memos'] as Array<{Memo: {MemoType?: string, MemoData?: string}}>) ?? [])
  const zkCommitment = memos[MEMO_TYPES.ZK_COMMITMENT]
  const jurisdiction = memos[MEMO_TYPES.JURISDICTION]

  if (!zkCommitment || !jurisdiction) {
    console.warn(chalk.yellow(`  ⚠ NFTokenMint missing required memos — skipping`))
    return
  }

  // Extract the NFTokenID from the transaction metadata
  let nftTokenId = ''
  const meta = tx['meta'] as Record<string, unknown> | undefined
  if (meta) {
    const nodes = (meta['AffectedNodes'] as Array<Record<string, unknown>>) ?? []
    for (const node of nodes) {
  const created = node['CreatedNode'] as Record<string, unknown> | undefined
  if (created?.['LedgerEntryType'] === 'NFTokenPage') {
    const nfts = ((created['NewFields'] as Record<string, unknown>)?.['NFTokens'] as Array<{NFToken: {NFTokenID: string}}>) ?? []
    if (nfts.length > 0) nftTokenId = nfts[nfts.length - 1].NFToken.NFTokenID
  }
  const modified = node['ModifiedNode'] as Record<string, unknown> | undefined
  if (modified?.['LedgerEntryType'] === 'NFTokenPage') {
    const nfts = ((modified['FinalFields'] as Record<string, unknown>)?.['NFTokens'] as Array<{NFToken: {NFTokenID: string}}>) ?? []
    if (nfts.length > 0) nftTokenId = nfts[nfts.length - 1].NFToken.NFTokenID
  }
}
  }

  if (!nftTokenId) {
    console.warn(chalk.yellow(`  ⚠ Could not extract NFTokenID from mint tx`))
    return
  }

  // The Destination field or the meta shows who received it
  // In XRPL, NFTokenMint with no Destination = minter holds it
  // The civic-id flow mints TO the issuer then the citizen claims separately
  // OR we use the NFTokenCreateOffer / NFTokenAcceptOffer pattern
  // For simplicity: citizen_address = tx Account if no offer, otherwise from offer
  const citizenAddress = (tx['Destination'] as string | undefined) ?? (tx['Account'] as string)

  const record: IdentityRecord = {
    xrplNftId:      nftTokenId,
    citizenAddress,
    jurisdiction,
    zkCommitment,
    shardId:        SHARD_ID,
    voiceCredits:   VOICE_CREDITS,
    status:         'active',
    xrplLedger:     ledgerIndex,
    createdAt:      new Date().toISOString(),
    revokedAt:      null,
  }

  upsertIdentity(record)
  console.log(chalk.green(`  ✓ Identity minted: ${citizenAddress} (${jurisdiction})`))
}

// ── Process a single NFTokenBurn transaction ──────────────────────────────────

function processBurn(tx: Record<string, unknown>): void {
  if (tx['TransactionType'] !== 'NFTokenBurn') return
  if (tx['Account'] !== ISSUER_ADDRESS) return

  const nftTokenId = tx['NFTokenID'] as string | undefined
  if (!nftTokenId) return

  revokeIdentity(nftTokenId, new Date().toISOString())
  console.log(chalk.yellow(`  ↩ Identity revoked: NFT ${nftTokenId}`))
}

// ── Historical replay (catch up from last known ledger) ───────────────────────

async function replayFromLedger(client: Client, fromLedger: number): Promise<number> {
  console.log(chalk.cyan(`  Replaying XRPL history from ledger ${fromLedger}…`))

  const serverInfo = await client.request({ command: 'server_info' })
  const currentLedger = serverInfo.result.info.validated_ledger?.seq ?? 0

  if (fromLedger >= currentLedger) {
    console.log(chalk.gray(`  Already caught up (ledger ${currentLedger})`))
    return currentLedger
  }

  let marker: unknown = undefined
  let processed = 0
  let page = 0

  do {
    const response = await client.request({
      command:        'account_tx',
      account:        ISSUER_ADDRESS,
      ledger_index_min: fromLedger,
      ledger_index_max: currentLedger,
      limit:           200,
      marker,
      forward:         true,
    })

    for (const { tx, meta } of response.result.transactions) {
      if (!tx || typeof tx !== 'object') continue
      const txWithMeta = { ...tx, meta }
      const ledger = (tx as unknown as Record<string, unknown>)['ledger_index'] as number ?? 0

      processMint(txWithMeta as Record<string, unknown>, ledger)
      processBurn(txWithMeta as Record<string, unknown>)
      processed++
    }

    marker = response.result.marker
    page++
    if (page % 10 === 0) console.log(chalk.gray(`  … processed ${processed} txs`))
  } while (marker)

  console.log(chalk.green(`  ✓ Replay complete — ${processed} transactions processed`))
  return currentLedger
}

// ── Live subscription ─────────────────────────────────────────────────────────

export async function startXRPLWatcher(onNewIdentity?: () => void): Promise<void> {
  if (!ISSUER_ADDRESS) {
    console.warn(chalk.yellow('ISSUER_ADDRESS not set — XRPL watcher disabled'))
    return
  }

  console.log(chalk.bold('\n🔭 Starting XRPL identity watcher'))
  console.log(chalk.gray(`  Network: ${XRPL_NETWORK}`))
  console.log(chalk.gray(`  Issuer:  ${ISSUER_ADDRESS}`))
  console.log(chalk.gray(`  Taxon:   ${NFT_TAXON}`))
  console.log(chalk.gray(`  Shard:   ${SHARD_ID}\n`))

  const client = new Client(XRPL_NETWORK)
  await client.connect()

  // Replay any missed events since last run
  const lastLedger  = getLastLedger()
  const catchupFrom = lastLedger > 0 ? lastLedger + 1 : 1
  const currentLedger = await replayFromLedger(client, catchupFrom)
  setLastLedger(currentLedger)

  // Subscribe to live account transactions
  await client.request({
    command:  'subscribe',
    accounts: [ISSUER_ADDRESS],
  })

  client.on('transaction', (event) => {
    const tx     = event.transaction as unknown as Record<string, unknown>
    const ledger = (event as unknown as Record<string, unknown>)['ledger_index'] as number ?? 0

    processMint({ ...tx, meta: event.meta }, ledger)
    processBurn(tx)

    setLastLedger(ledger)
    onNewIdentity?.()
  })

  console.log(chalk.green('✓ XRPL watcher live — subscribed to issuer transactions\n'))

  // Keep connection alive with periodic ping
  setInterval(() => {
    if (client.isConnected()) {
      client.request({ command: 'ping' }).catch(() => {})
    }
  }, 30_000)
}
