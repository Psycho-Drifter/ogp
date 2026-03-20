[README.md](https://github.com/user-attachments/files/26152326/README.md)
# Open Governance Protocol (OGP)

> **The infrastructure for honest government.**

OGP is an open-source governance protocol that makes verified direct democracy possible at planetary scale. It uses cryptographic identity, AI-informed deliberation, and blockchain-enforced voting to remove the structural conditions that make corruption possible — not by passing new rules, but by replacing the architecture.

This is not a white paper. The code in this repository is a working proof of concept. Every design decision is documented. All of it is open for review, audit, and improvement.

---

## The problem in one paragraph

Representative democracy was invented to solve a scaling problem: you can't have millions of people vote on every decision, so you elect people to decide on your behalf. Three technologies — cryptographic identity at scale, AI-assisted deliberation, and immutable public ledgers — have now solved that scaling problem directly. OGP is what becomes possible when you apply all three together.

---

## What's in this repository

```
ogp/
├── civic-id/          Identity layer — soulbound NFTs on the XRP Ledger
├── civic-qv/          Voting layer — quadratic voting smart contracts on Polygon
├── civic-ai/          Advisory layer — AI briefing pipeline (open-source LLM)
└── civic-oracle/      Bridge layer — XRPL identity → Polygon Merkle root oracle
```

### `civic-id` — Verified identity
Every citizen receives one soulbound (non-transferable) NFT on the XRP Ledger. Transferring or selling it is architecturally impossible — not just prohibited. Identity is anchored to a biometric zero-knowledge commitment, so your raw data never touches the chain. The identity tree supports up to 18.4 quintillion identities per shard, with a hierarchical structure that extends to multiple jurisdictions without protocol changes.

**Key files:** `src/mint-identity.ts` · `src/setup-issuer.ts` · `src/test-soulbound.ts`

---

### `civic-qv` — Quadratic voting
Smart contracts on Polygon that enforce the voting rules at the protocol level. Each citizen gets 100 voice credits per proposal. Casting more votes on a single issue costs quadratically more credits — making it economically irrational for any actor, regardless of wealth, to dominate a vote. Ballots are cryptographically private via ZK-PLONK proofs: no one can see how you voted, but anyone can verify your vote was valid. The AI briefing hash is anchored on-chain before any vote can open — citizens can always verify what analysis they were shown.

**Key files:** `contracts/QuadraticVoting.sol` · `contracts/HierarchicalIdentityVerifier.sol` · `circuits/vote.circom`

---

### `civic-ai` — AI advisory pipeline
Every proposal triggers a structured analysis pipeline. An open-source language model produces a plain-language briefing: risk scoring, predicted outcomes, historical precedents, and a mandatory analysis of minority and vulnerable group impacts. A citizen oversight panel reviews every briefing before it is published. The AI informs. It never decides. The briefing is pinned to IPFS and its content hash is committed on-chain — immutable proof of exactly what citizens saw before they voted.

**Key files:** `src/pipeline.ts` · `src/ai-analyzer.ts` · `src/oversight-store.ts`

---

### `civic-oracle` — Identity bridge
The oracle watches the XRP Ledger for civic identity NFT events, maintains a local identity database, builds two Merkle trees from the same identity set (one for on-chain Polygon verification, one for ZK proof generation), submits roots to Polygon at each governance cycle, and serves proof bundles to citizens via a REST API. Citizens call one endpoint to get everything they need to cast a private, verified ballot.

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
git clone https://github.com/YOUR_USERNAME/ogp.git
cd ogp

# Layer 1: Identity (requires Node.js 20+)
cd civic-id && npm install && cp .env.example .env
npm run setup:issuer   # generates your issuer wallet on XRPL testnet
npm run test:soulbound # proves non-transferability at the protocol level

# Layer 2: Voting contracts (requires Node.js 20+)
cd ../civic-qv && npm install
npx hardhat node       # local blockchain (terminal 1)
npx hardhat test       # full test suite (terminal 2)

# Layer 3: AI advisory (requires ANTHROPIC_API_KEY for dev)
cd ../civic-ai && npm install && cp .env.example .env
npm run pipeline:run   # full demo with simulated panel approval

# Layer 4: Oracle bridge
cd ../civic-oracle && npm install && cp .env.example .env
npm run dev            # starts watcher + proof server on port 3002
```

> **Note on `.ts` files on Mac:** macOS registers `.ts` as a video format. Your files are fine. Right-click any `.ts` file → Get Info → Open With → select VS Code → click "Change All".

---

## Technical stack

| Layer | Chain / Runtime | Key tech |
|---|---|---|
| Identity | XRP Ledger (XLS-20) | xrpl.js, soulbound NFT, ZK commitments |
| Voting | Polygon PoS | Solidity, Hardhat, OpenZeppelin, Circom ZK-PLONK |
| AI advisory | Node.js service | Anthropic / Ollama, IPFS / Pinata, ethers.js |
| Oracle | Node.js service | SQLite, MerkleTree.js, Poseidon SMT, ethers.js |

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

## Articles

- **Part 1 — The concept:** [Corruption-Resistant Government: Revolutionising Democracy](https://blossumnow.com/corruption-resistant-government/)
- **Part 2 — The architecture:** *(link to be added after publication)*

---

## Licence

All code in this repository is released under the [MIT Licence](LICENSE). The OGP protocol design is released into the public domain. No entity owns this. That is the point.

---

## Contributing

OGP improves through collective scrutiny. If you find a flaw in the constitutional tier structure, a vulnerability in the ZK circuit, a gap in the economic model, or a way the system could inadvertently replicate existing power imbalances under new branding — please open an issue. That kind of feedback is exactly what the diversity mandate and the open-source model exist to surface.

Pull requests, issue reports, and architectural critiques are all welcome.

---

*Built with systems thinking. Designed to make corruption harder than honesty.*
