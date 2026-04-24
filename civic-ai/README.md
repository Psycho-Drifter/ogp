# Civic AI Advisory Layer

The AI advisory module for civic governance. Generates structured, multilingual proposal briefings, runs them through a citizen oversight panel, and commits approved briefings immutably on-chain.

**Core principle: AI informs, never decides.** The AI cannot activate voting. Only after a human oversight panel approves the briefing does it reach citizens — and only then can the proposal enter the active voting state.

---

## Architecture

```
src/
├── ai-client.ts        Shared AI provider abstraction (Anthropic ↔ Ollama)
├── ai-analyzer.ts      Core analysis engine — structured JSON briefings
├── translate.ts        Multilingual translation (6 UN languages + jurisdiction)
├── ipfs-publisher.ts   IPFS pinning via Pinata
├── oversight-store.ts  Panel review tracking + feedback loop
├── chain-submitter.ts  On-chain attachAIBriefing() submission
├── scenario-engine.ts  Best/base/worst scenario modelling for major votes
├── pipeline.ts         Full end-to-end orchestrator with retry logic
└── server.ts           REST API for panel interface + pipeline triggers
```

---

## Quickstart

```bash
cd civic-ai
npm install
cp .env.example .env
# Fill in ANTHROPIC_API_KEY at minimum for dev mode

# Run the full pipeline with a demo proposal (no chain tx, simulated panel)
npm run pipeline:run

# Start the API server
npm run dev
```

---

## What the AI produces

Every briefing is structured JSON with these mandatory fields:

| Field | Purpose |
|---|---|
| `summary` | 2–3 sentence plain-language TL;DR |
| `keyPoints` | 5–7 bullet points for citizens |
| `plainEnglishExplainer` | Full explanation, 8th-grade reading level |
| `overallRiskScore` | 0–100 numeric risk score |
| `risks[]` | Categorized risks with severity + probability |
| `predictedOutcomes[]` | If passes / if rejected × timeframes |
| `historicalPrecedents[]` | Real-world comparisons |
| `minorityImpact` | Mandatory field — cannot be omitted |
| `confidenceLevel` | 0.0–1.0 — AI's self-assessed certainty |
| `limitations[]` | Known gaps in the analysis |
| `translations{}` | All UN languages + jurisdiction languages |

---

### Scenario engine — predictive briefings for major votes

For major votes (constitutional amendments, treaty ratification, national budget, referenda) and
policy votes where consequence modelling is warranted, the scenario engine generates three
structured predictive scenarios before the standard briefing is finalised:

| Scenario | Description |
|----------|-------------|
| `best`   | Optimistic outcome — favourable conditions, high compliance, intended effects realised |
| `base`   | Most probable outcome — realistic assumptions, moderate friction, mixed second-order effects |
| `worst`  | Pessimistic outcome — adverse conditions, unintended consequences, stress-case impacts |

Each scenario includes a `timeHorizon` (1yr / 5yr / 20yr), an `impactScore` (0–100), a
`confidenceLevel`, and a `minorityImpact` sub-analysis. Scenarios are bundled into the same
briefing JSON, pinned to IPFS, and anchored on-chain alongside the standard analysis.

For minor procedural changes where compute cost is disproportionate to consequence probability,
the standard briefing runs without scenario modelling. The trigger classification is a
protocol-level decision managed by Protocol Administration.

**Key file:** `src/scenario-engine.ts`

---

## The oversight review loop

```
AI produces briefing
        ↓
Published to IPFS
        ↓
Panel reviews (REST API or dashboard)
        ↓
  Approved?  ──YES──→  On-chain submission  →  Voting opens
      │
      NO (flagged)
        ↓
AI re-runs with panel's specific feedback
        ↓
  (up to 3 revision rounds)
        ↓
  Still rejected?  →  Escalated to full panel hearing (manual)
```

---

## API reference

```
POST /proposals/analyze        Trigger pipeline for a proposal
GET  /proposals/:id/briefing   Get briefing + review status
POST /oversight/review         Panel member submits approve/flag
GET  /oversight/pending        List proposals awaiting review
GET  /health                   Service health
```

### Submit a review (panel member)

```bash
curl -X POST http://localhost:3001/oversight/review \
  -H 'Content-Type: application/json' \
  -d '{
    "proposalId": "1",
    "ipfsCid":    "QmABC...",
    "reviewedBy": "panel-member-alice",
    "decision":   "approve",
    "notes":      "Analysis is fair, balanced, and plain-language."
  }'
```

### Flag with feedback (sends feedback back to AI)

```bash
curl -X POST http://localhost:3001/oversight/review \
  -H 'Content-Type: application/json' \
  -d '{
    "proposalId": "1",
    "ipfsCid":    "QmABC...",
    "reviewedBy": "panel-member-bob",
    "decision":   "flag",
    "notes":      "The economic risk section understates impact on low-income renters. Please add specific analysis."
  }'
```

---

## Switching to a self-hosted open-source model

For production, replace the Anthropic API with a locally-hosted model so the exact model weights are auditable. The pipeline also switches providers automatically during connectivity outages, following the Civic Continuity Protocol (CCP): Tier 1 outages (<72 hrs) continue on the Anthropic API; Tier 2 (72 hrs–30 days) switches to local Ollama; Tier 3 catastrophic outages fall back to pre-generated briefings if Ollama hardware is unavailable. See docs/CCP-SPEC.md for the full resilience specification.

```bash
# Install Ollama (https://ollama.ai)
ollama pull llama3:70b

# Update .env
AI_PROVIDER=ollama
AI_MODEL=llama3:70b
AI_BASE_URL=http://localhost:11434
```

The rest of the pipeline is identical — the `callAI()` abstraction handles the difference.

---

## Production checklist

1. **Open-source model** — swap to Llama 3 70B or Mistral Large for auditability
2. **Database** — replace `oversight-store.ts` JSON file with Postgres
3. **Auth** — add JWT authentication to panel member endpoints
4. **Webhooks** — replace polling in `pipeline.ts` with event-driven panel notifications
5. **Redundant IPFS** — run your own IPFS nodes alongside Pinata
6. **Rate limiting** — protect the `/proposals/analyze` endpoint
7. **Monitoring** — log all AI outputs, panel decisions, and chain submissions for full audit trail

---

## Connection to civic-qv contracts

This service calls `QuadraticVoting.attachAIBriefing()` which:
- Sets `proposal.aiBriefingIpfsCid` — the IPFS pointer
- Sets `proposal.aiBriefingHash` — the keccak256 tamper-proof anchor
- Transitions the proposal from `Drafted` → `AIReview` state

The oversight panel then calls `activateProposal()` on the contract to open voting. The AI briefing hash ensures citizens always know exactly what analysis was presented to voters.
