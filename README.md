[README.md](https://github.com/user-attachments/files/26152326/README.md)
# Open Governance Protocol (OGP)

> **The infrastructure for honest government.**

OGP is an open-source governance protocol that makes verified direct democracy possible at planetary scale. It uses cryptographic identity, AI-informed deliberation, and blockchain-enforced voting to remove the structural conditions that make corruption possible — not by passing new rules, but by replacing the architecture.

This is not a white paper. The code in this repository is a working proof of concept. Every design decision is documented. All of it is open for review, audit, and improvement.

---

## The problem in one paragraph

Representative democracy was invented to solve a scaling problem: you can't have millions of people vote on every decision, so you elect people to decide on your behalf. Three technologies — cryptographic identity at scale, AI-assisted deliberation, and immutable public ledgers — have now solved that scaling problem directly. OGP is what becomes possible when you apply all three together.

---

## Build status

| Layer | Description | Status |
|---|---|---|
| `civic-id` | Soulbound NFT identity on XRPL (XLS-20) | ✅ Complete |
| `civic-qv` | Quadratic voting on Polygon with ZK-PLONK proofs | ✅ Complete |
| `civic-ai` | AI advisory pipeline + scenario engine | ✅ Complete — 34/34 tests passing |
| `civic-oracle` | XRPL→Polygon identity bridge (Poseidon SMT) | ✅ Complete |
| `civic-app` | Citizen-facing web + mobile application | 🔲 In active development |

---

## What's in this repository

```
ogp/
├── civic-id/          Identity layer — soulbound NFTs on the XRP Ledger
├── civic-qv/          Voting layer — quadratic voting smart contracts on Polygon
├── civic-ai/          Advisory layer — AI briefing pipeline and scenario engine
├── civic-oracle/      Bridge layer — XRPL identity → Polygon Merkle root oracle
├── civic-app/         Citizen portal — web + mobile application (in development)
└── docs/              Architecture diagrams, specifications, and context files
```

### `civic-id` — Verified identity
Every citizen receives one soulbound (non-transferable) NFT on the XRP Ledger. Transferring or selling it is architecturally impossible — not just prohibited. Identity is anchored to a biometric zero-knowledge commitment, so your raw data never touches the chain. The identity tree supports up to 18.4 quintillion identities per shard, with a hierarchical structure that extends to multiple jurisdictions without protocol changes.

Key recovery uses government-backed reissuance: the accredited KYC authority that issued the original token burns it under a multi-sig governance rule and mints a new one to a new key pair after fresh liveness verification. OGP's governance council holds no burn authority — this is a constitutional design constraint, not an implementation choice.

**Key files:** `src/mint-identity.ts` · `src/setup-issuer.ts` · `src/test-soulbound.ts`

---

### `civic-qv` — Quadratic voting
Smart contracts on Polygon that enforce the voting rules at the protocol level. Each citizen gets 100 voice credits per proposal. Casting more votes on a single issue costs quadratically more credits — making it economically irrational for any actor, regardless of wealth, to dominate a vote. Ballots are cryptographically private via ZK-PLONK proofs: no one can see how you voted, but anyone can verify your vote was valid. The AI briefing hash is anchored on-chain before any vote can open — citizens can always verify what analysis they were shown.

`HierarchicalIdentityVerifier.sol` is the canonical identity contract. `RevocationRegistry.sol` maintains a permanent on-chain record of burned or invalidated identity tokens — queried before any identity proof is accepted. Vote tallies are live by default; commit-reveal is activatable per-proposal by the expert panel for proposals identified as susceptible to late strategic voting.

**Key files:** `contracts/HierarchicalIdentityVerifier.sol` · `contracts/RevocationRegistry.sol` · `contracts/QuadraticVoting.sol` · `circuits/vote.circom`

---

### `civic-ai` — AI advisory pipeline and scenario engine
Every proposal triggers a structured 9-step analysis pipeline. The pipeline produces three probabilistic scenarios (best-case, most likely, worst-case), a confidence score, a classification decision, and a full audit trail — all without any black-box models. Neural networks are constitutionally prohibited; all modelling must be interpretable and auditable.

**Pipeline stages (in order):**
1. **Monte Carlo** — 1,000 adaptive simulation runs (convergence threshold: <0.5% change over 50 consecutive runs). Best = 85th percentile, Base = 50th, Worst = 15th.
2. **Bayesian update** — posterior shift from matched historical precedents in the OGP Policy Database
3. **Holt double-exponential smoothing** — time series projections
4. **Random Forest classifier** — interpretable policy success/failure classification

**Confidence scoring:** ≥60% published, 40–59% flagged as LOW confidence, <40% not published (INSUFFICIENT_DATA).

**Civic Continuity Protocol (CCP):** Tier 1 — Anthropic API (full live analysis) → Tier 2 — local Ollama (activated if Tier 1 unavailable) → Tier 3 — IPFS-cached pre-generated briefings (last resort). Briefings are always available regardless of upstream service state.

**OGP Policy Database:** Seeded from World Bank, OECD, academic sources, and FTSG Convergence 2026 (20 initial precedents in `src/policy-database/seed.json`). Briefings are pinned to IPFS and their content hashes committed on-chain — immutable proof of exactly what citizens saw before they voted.

**Test suite:** 34/34 tests passing (Vitest 2.x). Full coverage: Monte Carlo, Bayesian, time series, Random Forest, confidence scoring, and full pipeline.

**Revision clause:** The model stack may be revisited after 3 years and 50 evaluated briefings, subject to a citizen vote.

**Key files:** `src/scenario-engine.ts` · `src/pipeline.ts` · `src/ai-analyzer.ts` · `src/monte-carlo.ts` · `src/bayesian.ts` · `src/time-series.ts` · `src/random-forest.ts` · `src/confidence.ts`

---

### `civic-oracle` — Identity bridge
The oracle watches the XRP Ledger for civic identity NFT events, maintains a local identity database, builds a Poseidon sparse Merkle tree (depth 64) from the identity set, submits roots to Polygon at each governance cycle via `publishShardRoot()`, and serves ZK inclusion proof bundles to citizens via a REST API. Citizens call one endpoint to get everything they need to cast a private, verified ballot without revealing their identity.

Merkle leaf encoding: `bytes32` via `keccak256(utf8Bytes(xrplAddress))` — consistent across both layers.

**Key files:** `src/oracle.ts` · `src/xrpl-watcher.ts` · `src/merkle-builder.ts`

---

## Getting started

> **Free to run:** Everything below uses free testnets and free service tiers.
> No real money is required to explore or trial the proof of concept.
> See each layer's `.env.example` file for setup instructions and the
> double-safety rule: never upload any file named `.env` — only `.env.example`.
> Real credentials are only needed when deploying to production mainnet.

Each layer has its own README with full setup instructions. Start here:

```bash
git clone https://github.com/MatthewJanega/ogp.git
cd ogp

# Layer 1: Identity
cd civic-id && npm install && cp .env.example .env
npm run setup:issuer   # generates your issuer wallet on XRPL testnet
npm run test:soulbound # proves non-transferability at the protocol level

# Layer 2: Voting contracts
cd ../civic-qv && npm install
npx hardhat node       # local blockchain (terminal 1)
npx hardhat test       # full test suite (terminal 2)

# Layer 3: AI advisory and scenario engine
cd ../civic-ai && npm install && cp .env.example .env
npm run pipeline:run   # full demo with simulated panel approval
npm test               # 34/34 tests expected

# Layer 4: Oracle bridge
cd ../civic-oracle && npm install && cp .env.example .env
npm run dev            # starts watcher + proof server on port 3002
```

> **Note on `.ts` files on Mac:** macOS registers `.ts` as a video format. Your files are fine. Right-click any `.ts` file → Get Info → Open With → select VS Code → click "Change All".

---

## Technical stack

| Layer | Chain / Runtime | Key tech |
|---|---|---|
| Identity | XRP Ledger (XLS-20) | xrpl.js v3, soulbound NFT, ZK commitments |
| Voting | Polygon PoS | Solidity 0.8.24, Hardhat, OpenZeppelin v5, Circom ZK-PLONK |
| AI advisory | Node.js service | Anthropic API / Ollama, IPFS / Pinata, Monte Carlo, Bayesian, Random Forest |
| Oracle | Node.js service | SQLite, MerkleTree.js, Poseidon sparse Merkle tree, ethers.js |

**Planetary scale:** The ZK circuit supports a depth-64 sparse Merkle tree (2⁶⁴ = 18.4 quintillion identity slots per shard). A hierarchical shard architecture allows additional jurisdictions — including future off-Earth settlements — to be added as new shards without any protocol change.

---

## Constitutional design

OGP is not only a technical system. The governance architecture it implements draws from 2,500 years of democratic theory and 70 years of Scandinavian democratic socialist evidence. The constitutional framework has four tiers:

- **Tier 1 (unamendable):** Free speech, assembly, privacy, right to life, social floor (healthcare, education, shelter, food, water), right to vote. No majority can remove these — ever.
- **Tier 2 (80% supermajority + 2-year deliberation):** Economic rights, property rights, environmental rights.
- **Tier 3 (60% supermajority + 6-month deliberation):** Protocol rules, court structure, lobbying ban, natural monopoly definitions.
- **Tier 4 (simple majority):** Ordinary policy — budget, regulations, programmes.

Full constitutional architecture, economic framework, expert governance model, and court hierarchy are documented in the articles below.

---

## Frontend development roadmap

The citizen portal (`civic-app`) is in active development. It targets web (Progressive Web App), iOS, and Android from a single React Native + Expo codebase. Design decisions are fully documented in `docs/OGP-ux-architecture.md`. The interactive task tracker is at `docs/OGP-task-tracker.html`.

| Phase | Description |
|---|---|
| 1 | Key recovery architecture — RevocationRegistry, burn authority, reissuance flow |
| 2 | PoC data layer — `USE_MOCK_DATA` flag, test identities, test proposals end-to-end |
| 3 | React Native / Expo scaffold — WebAuthn, session auth, PWA, CSP headers |
| 4 | Onboarding and identity screens |
| 5 | Proposals, QV voting, and AI briefing screens |
| 6 | Test community deployment |
| 7 | Independent security audit, legal framework, cost-benefit analysis |

---

## AI-assisted development

This project uses Claude (Anthropic) for architecture design, code review, and documentation. All context files in `docs/` are structured for handover to AI coding agents. The full project context, phase-by-phase task specs, and UI/UX architecture decisions are maintained there.

**Handover instruction for AI agents starting a new session:**
```
Read docs/OGP-master-context.md, then the relevant phase context file,
then ogp-task-progress-current.json. The JSON shows which tasks are
complete. Continue from the first incomplete task. After completing
each task, update the JSON to mark it done before proceeding to the next.
```

---

## Articles

- **Part 1 — The concept:** [Corruption-Resistant Government: Revolutionising Democracy](https://blossumnow.com/corruption-resistant-government/)
- **Part 2 — The architecture:** *([Open Governance Protocol: Building the Architecture](https://blossumnow.com/open-governance-protocol-architecture/)*

---

## Licence

All code in this repository is released under the [MIT Licence](LICENSE). The OGP protocol design is released into the public domain. No entity owns this. That is the point.

---

## Contributing

OGP improves through collective scrutiny. If you find a flaw in the constitutional tier structure, a vulnerability in the ZK circuit, a gap in the economic model, or a way the system could inadvertently replicate existing power imbalances under new branding — please open an issue. That kind of feedback is exactly what the diversity mandate and the open-source model exist to surface.

Before contributing code, read `docs/OGP-master-context.md` for full architectural context and the list of locked decisions that require a governance process before they can change.

Pull requests, issue reports, and architectural critiques are all welcome.

---

*Built with systems thinking. Designed to make corruption harder than honesty.*
