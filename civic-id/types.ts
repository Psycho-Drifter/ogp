/**
 * types.ts — shared types for the civic identity system
 */

// ── Identity metadata ─────────────────────────────────────────────────────────
// Stored OFF-chain (your metadata API), referenced by URI in the NFT.
// The on-chain NFT contains only the URI + immutable flags.
// PII (name, DOB) lives in your secure off-chain store — NOT on the ledger.
export interface CivicIdentityMetadata {
  /** Unique citizen identifier — not a government ID number, a random UUID */
  citizenId: string

  /** ISO 3166-1 alpha-2 country code */
  jurisdiction: string

  /** ISO 8601 — when this identity was issued */
  issuedAt: string

  /** ISO 8601 — when this identity expires (election cycle, etc.) */
  expiresAt: string

  /** Schema version for forward compatibility */
  schemaVersion: '1.0'

  /**
   * ZK commitment of the citizen's biometric/ID data.
   * This is a hash — the actual biometric is never stored here.
   * Used to prove uniqueness without revealing identity.
   */
  zkCommitment: string

  /** Which governance system this identity is valid for */
  governanceScope: string[]

  /** Voice credit allocation for the current cycle */
  voiceCredits: number
}

// ── Mint request ──────────────────────────────────────────────────────────────
export interface MintIdentityRequest {
  /** Wallet address of the citizen receiving the identity NFT */
  citizenAddress: string

  /** Pre-generated ZK commitment of their verified identity */
  zkCommitment: string

  /** ISO 3166-1 alpha-2 */
  jurisdiction: string

  /** Governance systems this identity is valid for */
  governanceScope: string[]

  /** Voice credits to allocate for this cycle */
  voiceCredits?: number
}

// ── Mint result ───────────────────────────────────────────────────────────────
export interface MintIdentityResult {
  /** XRPL transaction hash */
  txHash: string

  /** The NFTokenID on the ledger */
  nftTokenId: string

  /** The citizen wallet address */
  citizenAddress: string

  /** The unique citizen ID (UUID, stored in metadata) */
  citizenId: string

  /** Ledger index at time of minting */
  ledgerIndex: number
}
