// Identity as stored in the oracle database
export interface IdentityRecord {
  xrplNftId:     string   // NFTokenID on XRPL
  citizenAddress:string   // Polygon-compatible wallet address (from NFT memo)
  jurisdiction:  string   // "CA-BC", "US-CA", etc.
  zkCommitment:  string   // Poseidon(identitySecret, shardId) — from NFT memo
  shardId:       number   // always matches this oracle's SHARD_ID
  voiceCredits:  number   // credits per governance cycle
  status:        'active' | 'revoked'
  xrplLedger:    number   // ledger index at mint
  createdAt:     string
  revokedAt:     string | null
}

// A leaf in the keccak256 Merkle tree (for on-chain verification)
export interface KeccakLeaf {
  citizenAddress: string
  jurisdiction:   string
  voiceCredits:   number
  leaf:           Buffer   // keccak256(packed(address, jurisdiction, voiceCredits))
}

// A leaf in the Poseidon SMT (for ZK proof generation)
export interface PoseidonLeaf {
  leafIndex:     bigint    // position in the sparse tree
  zkCommitment:  bigint    // Poseidon(identitySecret, shardId)
}

// A snapshot of the identity set at cycle start
export interface CycleSnapshot {
  cycleId:       number
  shardId:       number
  citizenCount:  number
  keccakRoot:    string   // hex — submitted to HierarchicalIdentityVerifier
  poseidonRoot:  string   // hex — used for ZK proof generation
  snapshotAt:    string   // ISO 8601
  xrplLedgerHash:string  // XRPL ledger hash at snapshot time
}

// Proof bundle returned to a citizen
export interface CitizenProofBundle {
  citizenAddress: string
  shardId:        number
  cycleId:        number
  jurisdiction:   string
  voiceCredits:   number
  // For claimVoiceCredits() on Polygon
  keccakMerkleProof: string[]
  // For ZK ballot generation (used by vote.circom)
  poseidonPathElements: string[]
  poseidonPathIndices:  number[]
  leafIndex:            string
}
