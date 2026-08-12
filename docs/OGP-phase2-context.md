# OGP Phase 2 — Proof of Concept Data Layer
**Paste OGP-master-context.md first, then this document.**
**Phase 1 must be complete before starting Phase 2.**

---

## What this conversation must accomplish

Build the mock data layer that makes all future development safe, demonstrable, and incrementally testable. The keystone is a single feature flag — `USE_MOCK_DATA` — that switches the entire application between test data and live backend with one line change. No code changes, no redeploys, no broken states.

By the end of Phase 2, a complete end-to-end demo must be runnable: real ZK proofs, real Merkle inclusions, real quadratic vote math — with test identities and test proposals standing in for live ones.

---

## Phase 2 tasks (in order)

### Task 2a — Create `ogp/config/env.ts` with USE_MOCK_DATA flag

**File location:** `ogp/config/env.ts`

```typescript
export const USE_MOCK_DATA = true;  // ← flip to false for live

export const CONFIG = {
  useMockData: USE_MOCK_DATA,
  xrpl: {
    server: USE_MOCK_DATA
      ? 'wss://s.altnet.rippletest.net:51233'   // testnet
      : 'wss://xrplcluster.com',                 // mainnet
  },
  polygon: {
    rpc: USE_MOCK_DATA
      ? 'http://127.0.0.1:8545'                  // local Hardhat
      : 'https://polygon-rpc.com',
    contracts: {
      hierarchicalIdentityVerifier: USE_MOCK_DATA
        ? '0x...'   // local Hardhat address (filled after deploy)
        : '0x...',  // mainnet address (filled at production)
      revocationRegistry: USE_MOCK_DATA
        ? '0x...'
        : '0x...',
    },
  },
  civicAi: {
    baseUrl: USE_MOCK_DATA
      ? 'http://localhost:3001'
      : 'https://api.ogp.gov',  // production (TBD)
  },
  civicOracle: {
    proofServer: 'http://localhost:3002',  // same in both modes for PoC
  },
};
```

### Task 2b — Pre-mint 8 test citizen NFTs on XRPL testnet

**Citizen roster to create:**

| ID | Tier | Purpose |
|---|---|---|
| citizen-01 | Tier 1 | Admin / full access — used for all technical tests |
| citizen-02 | Tier 2 | Standard verified citizen — primary demo persona |
| citizen-03 | Tier 2 | Standard verified citizen — secondary demo persona |
| citizen-04 | Tier 2 | Standard verified citizen — votes opposite to citizen-02 |
| citizen-05 | Tier 2 | Standard verified citizen — does not vote (tests abstention) |
| citizen-06 | Tier 3 | Lower-tier citizen — limited voting weight |
| citizen-07 | Tier 3 | Lower-tier citizen |
| citizen-08 | Tier 2 | Revocation test — this citizen's identity will be burned in Phase 1 testing |

**Document all 8 in:** `/docs/test-citizens.md` (XRPL address, NFToken ID, tier, purpose — no private keys in repo)

### Task 2c — Seed civic-oracle with test identities

- Run XRPL watcher against testnet
- Confirm all 8 identities picked up and committed to Merkle tree
- Confirm `publishShardRoot()` called successfully for the test shard
- Document the shard root hash in `/docs/test-citizens.md`

### Task 2d — Deploy QV contracts to local Hardhat node

Run `deploy-hierarchical-local.ts` (updated in Phase 1 to include `RevocationRegistry`).
- Record deployed contract addresses
- Fill them into `ogp/config/env.ts`
- Confirm `HierarchicalIdentityVerifier` accepts ZK proofs from all 8 test citizens
- Confirm `RevocationRegistry.isRevoked()` returns false for all 8

### Task 2e — Generate 4 test proposals with AI briefings

**Proposals to create:**

| ID | Title | Vote type | Confidence | Notes |
|---|---|---|---|---|
| prop-001 | Universal Healthcare Framework | constitutional | 72% (High) | Primary demo proposal |
| prop-002 | Citizen Prosperity Fund Allocation | budget | 81% (High) | Norway GPF model scenario |
| prop-003 | Carbon Tax Reform Amendment | policy | 44% (Low) | Demonstrates LOW confidence flag |
| prop-004 | Infrastructure Maintenance Act | minor | n/a | Demonstrates "minor" type — no briefing triggered |

**For each proposal (except prop-004), generate:**
- Full scenario engine output (best/base/worst, confidence score, model stack)
- Store as JSON in `civic-ai/src/mock-data/proposals/prop-00X.json`
- Store briefing as JSON in `civic-ai/src/mock-data/briefings/brief-00X.json`

**Briefing JSON schema:**
```json
{
  "proposalId": "prop-001",
  "title": "Universal Healthcare Framework",
  "voteType": "constitutional",
  "confidence": 72,
  "confidenceLabel": "High",
  "aiModel": "Anthropic API · Tier 1",
  "studiesReviewed": 47,
  "historicalMatches": 12,
  "dataSource": "World Bank · OECD",
  "ipfsCid": "bafybei...",
  "generatedAt": "2025-01-15T10:00:00Z",
  "scenarios": {
    "best": { "percentile": 85, "label": "Best-case outcome", "summary": "..." },
    "base": { "percentile": 50, "label": "Most likely outcome", "summary": "..." },
    "worst": { "percentile": 15, "label": "Worst-case outcome", "summary": "..." }
  }
}
```

### Task 2f — Write mock API adapters for all four layers

**File locations:**
```
ogp/config/
├── env.ts                         ← Task 2a (already done)
ogp/src/api/
├── adapters/
│   ├── civic-id.adapter.ts        ← returns test citizen identity data
│   ├── civic-qv.adapter.ts        ← returns test proposals, accepts mock votes
│   ├── civic-ai.adapter.ts        ← returns briefings from mock-data/
│   └── civic-oracle.adapter.ts    ← returns mock Merkle proof, shard status
└── index.ts                       ← exports live or mock based on USE_MOCK_DATA
```

**Pattern for each adapter:**
```typescript
// civic-ai.adapter.ts
import { USE_MOCK_DATA } from '../../config/env';
import mockBriefings from '../mock-data/briefings';

export async function getBriefing(proposalId: string) {
  if (USE_MOCK_DATA) {
    return mockBriefings[proposalId] ?? null;
  }
  const res = await fetch(`${CONFIG.civicAi.baseUrl}/briefing/${proposalId}`);
  return res.json();
}
```

The frontend imports only from `ogp/src/api/index.ts` — it never calls backend endpoints directly. This is what makes the one-line flag switch work cleanly.

### Task 2g — Write PoC runbook in `/docs/poc-runbook.md`

Must include:
1. Prerequisites (Node v18.20.4, all deps installed, Hardhat node running)
2. Step-by-step: start all four backend services in the correct order
3. Which terminal windows to have open and what to watch for
4. How to log in as each test citizen (wallet addresses and what each is used for)
5. The full vote-to-tally demo flow (which proposal to use, which citizens to use)
6. How to trigger the LOW confidence briefing path
7. How to flip `USE_MOCK_DATA` to false and what else needs to change (contract addresses, servers running)
8. Known limitations of the PoC vs. production

---

## Definition of "Phase 2 complete"

- [ ] `ogp/config/env.ts` created with `USE_MOCK_DATA` flag and full config
- [ ] 8 test citizens minted on XRPL testnet and documented in `/docs/test-citizens.md`
- [ ] civic-oracle seeded with all 8 test identities, shard root confirmed on-chain
- [ ] QV contracts deployed to local Hardhat, addresses recorded in config
- [ ] 4 test proposals with briefings created in `civic-ai/src/mock-data/`
- [ ] Mock API adapters written for all four layers
- [ ] `USE_MOCK_DATA = true` runs the full demo without any live services except local Hardhat and testnet
- [ ] `/docs/poc-runbook.md` written and verified — someone unfamiliar with the codebase can follow it

---

## Handoff to Phase 3

Once Phase 2 is complete:
- The frontend (Phase 3) can be built entirely against mock adapters
- The v4 portal prototype (already designed) can be ported to React Native
- Any new conversation starting Phase 3 work pastes `OGP-master-context.md` + `OGP-phase3-context.md`
- `USE_MOCK_DATA` stays `true` throughout Phases 3–5
- It is only flipped to `false` in Phase 6 (test community deployment)
