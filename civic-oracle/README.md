# Civic Identity Oracle

Bridges XRPL soulbound identity NFTs to the Polygon governance contracts. Watches for NFT mints/burns, maintains the identity set, builds Merkle trees, submits roots on-chain, and serves proofs to citizens.

---

## What it does

```
XRPL (identity source)          Polygon (governance target)
────────────────────            ─────────────────────────────
NFT minted → oracle sees it
NFT burned  → oracle revokes
                 │
                 ▼
         Identity DB (SQLite)
                 │
                 ▼
         Merkle builder
         ├── keccak256 tree ──────→ publishShardRoot() on-chain
         └── Poseidon SMT  ──────→ proof server (serves to citizens)
                                          │
                                          ▼
                                   citizen generates ZK ballot
                                   castBallot() on QuadraticVoting
```

---

## Quickstart

```bash
cd civic-oracle
npm install
cp .env.example .env
# Fill in XRPL_NETWORK, ISSUER_ADDRESS at minimum

npm run dev
```

The oracle starts, replays XRPL history, builds Merkle trees, starts the proof server on port 3002, and checks if a cycle root needs submitting.

---

## API

```
GET /health              — service status, identity count, tree state
GET /stats               — current Merkle roots
GET /proof/:address      — full proof bundle for a citizen address
  ?cycle=<cycleId>       — specify which cycle (defaults to 0)
GET /roots/:cycleId      — snapshot for a specific cycle
```

### Example proof request

```bash
curl http://localhost:3002/proof/0xYourWalletAddress?cycle=1
```

Returns:
```json
{
  "citizenAddress":       "0x...",
  "shardId":              1,
  "cycleId":              1,
  "jurisdiction":         "CA-BC",
  "voiceCredits":         100,
  "keccakMerkleProof":    ["0x..."],
  "poseidonPathElements": ["123456..."],
  "poseidonPathIndices":  [0, 1, 0, ...],
  "leafIndex":            "42"
}
```

The citizen app uses:
- `keccakMerkleProof` → call `claimVoiceCredits()` on Polygon
- `poseidonPathElements` + `poseidonPathIndices` → generate ZK ballot with `vote.circom`

---

## Two trees, one dataset

The oracle builds two trees from the same identity records:

| Tree | Hash fn | Used for | Verified by |
|---|---|---|---|
| keccak256 MerkleTree | keccak256 | `claimVoiceCredits()` | Solidity (cheap) |
| Poseidon SMT (depth 64) | Poseidon | ZK ballot generation | vote.circom circuit |

The keccak tree root is submitted on-chain. The Poseidon tree root is a public input to the ZK proof — the circuit verifies the citizen is in the SMT without revealing who they are.

---

## Crash recovery

The oracle is designed to restart safely:
- `sync_state.last_ledger` tracks the last processed XRPL ledger
- On restart, the watcher replays from `last_ledger + 1` to catch up
- Trees are rebuilt from the DB on every start — no in-memory state is lost

---

## Production checklist

1. **Multi-sig oracle wallet** — replace `ORACLE_PRIVATE_KEY` with a Gnosis Safe
2. **Postgres** — replace SQLite (`DB_PATH`) with `DB_URL=postgres://...`
3. **Redundancy** — run 2+ oracle instances; only one submits roots (use a coordinator lock)
4. **XRPL full history node** — for reliable replay, point to a full history node not the public cluster
5. **Monitoring** — alert on: missed cycle submissions, XRPL disconnect, tree build failures
6. **Rate limiting** — add auth/rate limits to the proof server for public deployment

---

## Scaling path

| Citizens | Recommended setup |
|---|---|
| < 100k | This oracle as-is, Polygon PoS |
| 100k – 10M | Add proof batching module, Polygon PoS |
| 10M – 1B | Polygon CDK dedicated appchain |
| 1B+ | Multi-shard appchain, one oracle per shard |
