# OGP Master Context
**Open Governance Protocol — "The infrastructure for honest government."**
Use this document as the opening context in every new OGP conversation.

---

## Project overview

Open Governance Protocol (OGP) is an open-source blockchain-based civic governance system designed to replace the structural conditions that enable corruption in representative democracy. It is designed to scale to planetary populations.

- **GitHub:** `Psycho-Drifter/ogp` (public, main branch)
- **Local path:** `/Users/[name]/Desktop/Blockchain Governance Tool/ogp/`
- **Matt** is the project creator — a systems thinker and blogger (blossumnow.com), not a trained developer. All technical work requires step-by-step guidance with explanations before each command.

---

## Architecture — all four backend layers complete and tested

### civic-id (Layer 1)
- Soulbound NFT identity on XRPL, standard XLS-20, TypeScript/xrpl.js v3
- Each citizen receives a non-transferable on-chain identity token
- NFTokenID extraction must check `ModifiedNode` entries in addition to `CreatedNode`

### civic-qv (Layer 2)
- Quadratic voting on Polygon, Solidity 0.8.24, Hardhat, OpenZeppelin v5, Circom ZK-PLONK
- Depth-64 sparse Merkle trees (planetary scale — 2⁶⁴ capacity per shard)
- Local Hardhat node forking Polygon is the standard dev/test approach
- Public testnet faucets were unreliable — do not use

### civic-ai (Layer 3)
- AI advisory pipeline: Anthropic API (dev), Ollama (production), IPFS/Pinata
- **Scenario engine** fully built and tested (34/34 Vitest tests passing)
  - 9-step pipeline: Monte Carlo (1,000-run adaptive) → Bayesian update → Holt time series → Random Forest classifier
  - Confidence scoring: ≥60% published, 40–59% LOW flag, <40% INSUFFICIENT_DATA (not published)
  - Confidence weights: MC convergence 35% + Bayesian precedents 35% + time series fit 15% + RF classifier 15%
  - Black-box models (neural networks) constitutionally prohibited — all modelling must be interpretable
  - Vote type rules: constitutional/treaty/budget/referendum always trigger; policy conditional; minor never
  - Classification: proposer sets type → LLM audits → expert panel makes binding decision → committed on-chain
  - CCP tiers: Tier 1 Anthropic API → Tier 2 local Ollama → Tier 3 IPFS-cached pre-generated briefings
  - OGP Policy Database seeded from World Bank / OECD / academic / FTSG Convergence 2026 (20 precedents in seed.json)
- Revision clause: scenario engine model stack revisitable after 3 years / 50 evaluated briefings

### civic-oracle (Layer 4)
- XRPL→Polygon identity bridge: SQLite, MerkleTree.js, Poseidon sparse Merkle trees
- Bridges civic-id identities into the Polygon voting layer via on-chain Merkle roots
- Proof server runs at `http://localhost:3002`

---

## Locked architectural decisions — do not revisit

| Decision | Detail |
|---|---|
| Identity contract | `HierarchicalIdentityVerifier.sol` — canonical, not `CivicIdentityVerifier` |
| Merkle leaf encoding | `bytes32` via `keccak256(utf8Bytes(xrplAddress))` |
| Oracle submission | `publishShardRoot()` — not `publishIdentityRoot()` |
| Dev/test approach | Local Hardhat node forking Polygon |
| Wallet generation | Node.js/ethers.js — MetaMask declined (browser permission concerns) |
| Black-box models | Prohibited constitutionally — interpretability is non-negotiable |
| Merkle depth | 64 — planetary scale |
| Live vote tallies | Default on. Commit-reveal activatable per-proposal by expert panel only |
| Key recovery model | Government-backed reissuance (KYC authority burns old NFT, mints new one after fresh liveness check) |
| Burn authority | Multi-sig between accredited KYC authorities — OGP never holds unilateral burn power |

---

## Constitutional architecture

- Scandinavian democratic socialist model
- Progressive taxation
- Four-tier governance structure with expert governance model
- Constitutional lobbying ban
- Five-level court hierarchy with independently protected public prosecutor
- Norway GPF model for Citizen Prosperity Fund

---

## Key milestone history

1. Real identity minted on XRPL testnet
2. Oracle picked up identity, committed to Merkle tree, submitted root on-chain
3. Scenario engine built — 34/34 tests passing — pushed to GitHub
4. Citizen-facing portal UI designed (v4 prototype — responsive, accessible, plain-language AI briefings, inline proposal briefing previews, text zoom)

---

## Security architecture decisions

- **Session auth:** Cryptographic challenge-signature (server issues random string → wallet signs with XRPL private key → verified). No NFC or Bluetooth for session transfer.
- **Local device unlock:** WebAuthn/FIDO2 — biometric (Face ID/fingerprint) on mobile, hardware key on desktop. Private key lives in secure enclave, never transmitted.
- **Constitutional votes:** Fresh ZK proof generation required as additional friction step.
- **Application security:** CSP headers, jailbreak/root detection, no clipboard key exposure, no sensitive caching outside secure enclave.
- **Commit-reveal:** Off by default. Expert panel can activate per-proposal to counter late strategic voting.
- **Coercion resistance:** Noted in threat model. ZK voting prevents post-hoc proof of vote choice. Physical coercion is out of scope for software. Mitigated by open voting windows (citizens vote alone, at any time).

---

## Key recovery — government-backed reissuance

**Flow:**
1. Citizen reports lost/compromised device to accredited KYC authority
2. KYC authority performs fresh liveness verification and identity re-check
3. Multi-sig burn transaction signed by quorum of KYC authority keyholders
4. Old NFT burned on XRPL — token ID written to `RevocationRegistry` on Polygon
5. New NFT minted to new key pair — new identity committed to Merkle tree
6. Citizen receives new credentials

**Critical principle:** OGP itself never holds burn authority. Multi-sig governance rule prevents any single actor burning a citizen's identity unilaterally. `RevocationRegistry` contract must exist before any frontend onboarding code is written.

---

## Planned features (backlog)

- **Kiosk mode:** Stripped UI, no local key storage, session QR code that polling official scans — vote submitted without official seeing ballot. Addresses digital divide and legitimacy concerns.
- **Commit-reveal per-proposal:** Contract flag settable by expert panel — UI indicator when active.
- **Cost-benefit analysis:** OGP infrastructure cost vs. current democracy cost (elections, parliament operations, lobbying economic leakage, corruption losses). Separate document/conversation — not directly tied to infrastructure.
- **Legal implementation roadmap:** Advisory → binding referendum → legislative trigger, one jurisdiction at a time, incremental.
- **Incremental KYC integration:** PoC uses manual admin minting. Automated KYC (Jumio/Onfido/national eID) slots in later without changing core token architecture.

---

## Repo structure

```
ogp/
├── civic-id/           # XRPL identity layer
├── civic-qv/           # Quadratic voting (Polygon)
│   └── contracts/
│       └── HierarchicalIdentityVerifier.sol
├── civic-ai/           # AI advisory + scenario engine
│   └── src/
│       ├── scenario-engine.ts
│       ├── monte-carlo.ts
│       ├── bayesian.ts
│       ├── time-series.ts
│       ├── random-forest.ts
│       ├── confidence.ts
│       ├── policy-database/
│       │   ├── schema.ts
│       │   └── seed.json
│       ├── server.ts
│       ├── pipeline.ts
│       └── ai-analyzer.ts
├── civic-oracle/       # XRPL→Polygon bridge
├── civic-app/          # Citizen-facing frontend (not yet built)
├── config/             # Env flags — USE_MOCK_DATA lives here (not yet created)
└── docs/               # Architecture diagrams, specs, runbooks
```

**Do not reorganise the repo structure. Respect established file layout exactly.**

---

## Dev environment

- Mac, VS Code, zsh, Node v18.20.4
- Hardhat (local fork of Polygon)
- TypeScript, Solidity 0.8.24, Circom
- xrpl.js v3, ethers.js, OpenZeppelin v5
- `@zk-kit/sparse-merkle-tree ^0.2.0`, `poseidon-lite` (use `poseidon2` — no generic `poseidon` export)
- SQLite, IPFS/Pinata
- Anthropic API (dev), Ollama (prod)

---

## Phase checklist (master tracker)

| Phase | Description | Status |
|---|---|---|
| Phase 1 | Key recovery architecture — RevocationRegistry, burn authority, reissuance flow | 🔲 Not started |
| Phase 2 | PoC data layer — mock flag, test NFTs, seed oracle, test proposals | 🔲 Not started |
| Phase 3 | React Native / Expo scaffold | 🔲 Not started |
| Phase 4 | Onboarding and identity screens | 🔲 Not started |
| Phase 5 | Proposals, voting, and briefings screens | 🔲 Not started |
| Phase 6 | Test community deployment | 🔲 Not started |
| Phase 7 | Security audit, legal framework, cost-benefit, threat model | 🔲 Not started |
