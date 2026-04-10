/**
 * identity-db.ts
 *
 * Persists the canonical identity set. Every verified citizen who holds
 * an active soulbound NFT on XRPL has a record here.
 *
 * The database is the oracle's source of truth between XRPL sync cycles.
 * If the oracle restarts, it replays XRPL history from the last seen ledger
 * to catch up before serving proofs.
 *
 * Schema:
 *   identities  — one row per citizen, keyed on xrpl_nft_id
 *   sync_state  — last processed XRPL ledger index (for crash recovery)
 *   snapshots   — cycle snapshots (Merkle roots + metadata)
 */

import Database from 'better-sqlite3'
import * as dotenv from 'dotenv'
import type { IdentityRecord, CycleSnapshot } from './types'

dotenv.config()

const DB_PATH = process.env.DB_PATH ?? './oracle.db'

let db: Database.Database

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')  // safe concurrent reads
    db.pragma('foreign_keys = ON')
    initSchema()
  }
  return db
}

function initSchema() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS identities (
      xrpl_nft_id      TEXT PRIMARY KEY,
      citizen_address  TEXT NOT NULL,
      jurisdiction     TEXT NOT NULL,
      zk_commitment    TEXT NOT NULL,
      shard_id         INTEGER NOT NULL,
      voice_credits    INTEGER NOT NULL DEFAULT 100,
      status           TEXT NOT NULL DEFAULT 'active',
      xrpl_ledger      INTEGER NOT NULL,
      created_at       TEXT NOT NULL,
      revoked_at       TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_identities_address ON identities(citizen_address);
    CREATE INDEX IF NOT EXISTS idx_identities_status  ON identities(status);

    CREATE TABLE IF NOT EXISTS sync_state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      cycle_id         INTEGER PRIMARY KEY,
      shard_id         INTEGER NOT NULL,
      citizen_count    INTEGER NOT NULL,
      keccak_root      TEXT NOT NULL,
      poseidon_root    TEXT NOT NULL,
      snapshot_at      TEXT NOT NULL,
      xrpl_ledger_hash TEXT NOT NULL,
      submitted_tx     TEXT
    );
  `)
}

// ── Identity CRUD ─────────────────────────────────────────────────────────────

export function upsertIdentity(record: IdentityRecord): void {
  getDb().prepare(`
    INSERT INTO identities
      (xrpl_nft_id, citizen_address, jurisdiction, zk_commitment,
       shard_id, voice_credits, status, xrpl_ledger, created_at, revoked_at)
    VALUES
      (@xrplNftId, @citizenAddress, @jurisdiction, @zkCommitment,
       @shardId, @voiceCredits, @status, @xrplLedger, @createdAt, @revokedAt)
    ON CONFLICT(xrpl_nft_id) DO UPDATE SET
      status     = excluded.status,
      revoked_at = excluded.revoked_at
  `).run({
    xrplNftId:      record.xrplNftId,
    citizenAddress: record.citizenAddress,
    jurisdiction:   record.jurisdiction,
    zkCommitment:   record.zkCommitment,
    shardId:        record.shardId,
    voiceCredits:   record.voiceCredits,
    status:         record.status,
    xrplLedger:     record.xrplLedger,
    createdAt:      record.createdAt,
    revokedAt:      record.revokedAt,
  })
}

export function revokeIdentity(xrplNftId: string, revokedAt: string): void {
  getDb().prepare(`
    UPDATE identities SET status = 'revoked', revoked_at = ?
    WHERE xrpl_nft_id = ?
  `).run(revokedAt, xrplNftId)
}

export function getActiveIdentities(shardId: number): IdentityRecord[] {
  return getDb().prepare(`
    SELECT * FROM identities WHERE status = 'active' AND shard_id = ?
    ORDER BY xrpl_ledger ASC
  `).all(shardId).map(rowToRecord)
}

export function getIdentityByAddress(address: string): IdentityRecord | null {
  const row = getDb().prepare(`
    SELECT * FROM identities WHERE citizen_address = ? AND status = 'active'
  `).get(address) as Record<string, unknown> | undefined
  return row ? rowToRecord(row) : null
}

export function getIdentityCount(shardId: number): number {
  const row = getDb().prepare(`
    SELECT COUNT(*) as cnt FROM identities WHERE status = 'active' AND shard_id = ?
  `).get(shardId) as { cnt: number }
  return row.cnt
}

// ── Sync state ────────────────────────────────────────────────────────────────

export function getLastLedger(): number {
  const row = getDb().prepare(`SELECT value FROM sync_state WHERE key = 'last_ledger'`).get() as { value: string } | undefined
  return row ? parseInt(row.value, 10) : 0
}

export function setLastLedger(ledger: number): void {
  getDb().prepare(`
    INSERT INTO sync_state(key, value) VALUES ('last_ledger', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(ledger))
}

// ── Snapshots ─────────────────────────────────────────────────────────────────

export function saveSnapshot(snap: CycleSnapshot): void {
  getDb().prepare(`
    INSERT OR REPLACE INTO snapshots
      (cycle_id, shard_id, citizen_count, keccak_root, poseidon_root, snapshot_at, xrpl_ledger_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(snap.cycleId, snap.shardId, snap.citizenCount, snap.keccakRoot,
         snap.poseidonRoot, snap.snapshotAt, snap.xrplLedgerHash)
}

export function getSnapshot(cycleId: number): CycleSnapshot | null {
  const row = getDb().prepare(`SELECT * FROM snapshots WHERE cycle_id = ?`).get(cycleId) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    cycleId:        row['cycle_id'] as number,
    shardId:        row['shard_id'] as number,
    citizenCount:   row['citizen_count'] as number,
    keccakRoot:     row['keccak_root'] as string,
    poseidonRoot:   row['poseidon_root'] as string,
    snapshotAt:     row['snapshot_at'] as string,
    xrplLedgerHash: row['xrpl_ledger_hash'] as string,
  }
}

// ── Row mapper ────────────────────────────────────────────────────────────────

function rowToRecord(row: unknown): IdentityRecord {
  const r = row as Record<string, unknown>;
  return {
    xrplNftId:      r['xrpl_nft_id'] as string,
    citizenAddress: r['citizen_address'] as string,
    jurisdiction:   r['jurisdiction'] as string,
    zkCommitment:   r['zk_commitment'] as string,
    shardId:        r['shard_id'] as number,
    voiceCredits:   r['voice_credits'] as number,
    status:         r['status'] as 'active' | 'revoked',
    xrplLedger:     r['xrpl_ledger'] as number,
    createdAt:      r['created_at'] as string,
    revokedAt:      r['revoked_at'] as string | null,
  }
}
