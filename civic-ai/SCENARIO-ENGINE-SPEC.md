# Civic AI — Scenario Engine Specification

**Location:** `civic-ai/SCENARIO-ENGINE-SPEC.md`  
**Status:** Specification — implementation target  
**Related:** `docs/CCP-SPEC.md`, `src/scenario-engine.ts` (to be built)

---

## Purpose

The scenario engine generates structured predictive briefings for governance proposals before any vote opens. It models three futures — best, base, and worst — so citizens make decisions with a clear view of the full consequence space, not just the intended outcome.

This is core civic-ai infrastructure. It runs in all operational states, including CCP mode. It is not an emergency feature.

The AI models consequences. It never recommends a vote direction. The scenario output is part of the citizen briefing — reviewed by the oversight panel, pinned to IPFS, and anchored on-chain before voting opens.

---

## Trigger classification

### Vote types

Every proposal carries a `voteType` field set by the proposing authority at submission:

| `voteType`        | Description                                              | Scenario engine |
|-------------------|----------------------------------------------------------|-----------------|
| `constitutional`  | Amendment to any constitutional tier                     | Always runs     |
| `treaty`          | International or inter-jurisdictional treaty ratification | Always runs     |
| `budget`          | National or regional budget                              | Always runs     |
| `referendum`      | Citizen-initiated or constitutionally mandated referendum | Always runs     |
| `policy`          | Significant policy change — scope determined by proposer | Conditional     |
| `minor`           | Procedural, administrative, low-consequence changes      | Never runs      |

### Hybrid classification (Option C)

Classification integrity requires that no actor can quietly route a high-consequence proposal through as `minor` or `policy` to avoid scenario scrutiny.

**How it works:**

1. **Proposer sets `voteType`** at submission. This is the initial classification.
2. **Scenario engine audits the proposal text** during the analysis phase. It produces a `classificationConfidence` score and, where its assessment differs from the proposer's, a `classificationUpgradeRecommendation` with a plain-language justification.
3. **Oversight panel receives both** — the proposer's declared type and the engine's recommendation — and makes the binding classification decision before the briefing is finalised.
4. **Panel decision is recorded** in the briefing metadata and committed on-chain with the briefing hash.

If the panel upgrades a `minor` or `policy` vote to a scenario-triggering type, the engine runs before the briefing is approved. The panel cannot downgrade a constitutionally-mandated type (e.g. cannot classify a budget proposal as `minor`).

**Classification rules enforced at the protocol level:**

- `constitutional`, `treaty`, `budget`, `referendum` are locked types — the scenario engine always runs, the panel cannot waive it.
- `policy` → upgrade to scenario-eligible is panel-discretionary.
- `minor` → upgrade to `policy` or above requires panel majority vote with written justification, recorded on-chain.
- Repeated misclassification by a proposing authority is flagged to the Independent Public Prosecutor.

---

## Scenario structure

Each scenario-eligible proposal receives three scenario objects bundled into the briefing JSON.

### Scenario fields

```typescript
interface Scenario {
  type: 'best' | 'base' | 'worst';
  label: string;                    // Human-readable title
  narrative: string;                // Plain-language 200–300 word summary
  keyAssumptions: string[];         // What must be true for this scenario to occur
  timeHorizons: {
    oneYear: ScenarioOutcome;
    fiveYear: ScenarioOutcome;
    twentyYear: ScenarioOutcome;
  };
  impactScore: number;              // 0–100 magnitude of change (not direction)
  confidenceLevel: number;          // 0.0–1.0 AI self-assessed certainty
  minorityImpact: MinorityImpact;   // Mandatory — cannot be null
  secondOrderEffects: string[];     // Downstream consequences not in primary outcome
  reversibility: 'easily reversible' | 'difficult to reverse' | 'irreversible';
}

interface ScenarioOutcome {
  description: string;
  affectedPopulation: string;       // Qualitative estimate of scope
  economicIndicator?: string;       // Where applicable
}

interface MinorityImpact {
  summary: string;
  groupsAnalysed: string[];
  disproportionateRisk: boolean;
  detail: string;
}
```

### Scenario definitions

**`best`** — Optimistic outcome. Favourable implementation conditions, high institutional compliance, intended effects realised, positive second-order effects materialise.

**`base`** — Most probable outcome. Realistic assumptions about friction, partial compliance, mixed second-order effects, and the gap between policy intent and policy result.

**`worst`** — Pessimistic outcome. Adverse conditions, implementation failure modes, unintended consequences, and stress-case impacts on vulnerable populations.

The base scenario is not the average of best and worst. It is the AI's most honest assessment of what is likely, given available evidence and historical precedent.

---

## Briefing integration

Scenario output is bundled into the same briefing JSON produced by `ai-analyzer.ts`. It does not replace the standard briefing — it extends it.

```typescript
interface ProposalBriefing {
  // ... existing fields (summary, keyPoints, risks, etc.)
  
  scenarioEngine: {
    triggered: boolean;
    triggerReason: string;           // e.g. "voteType: constitutional"
    classificationAudit: {
      proposerDeclaredType: VoteType;
      engineRecommendedType: VoteType | null;
      engineConfidence: number;
      engineJustification: string | null;
      panelFinalClassification: VoteType;
      panelClassificationNotes: string;
    };
    scenarios: {
      best: Scenario;
      base: Scenario;
      worst: Scenario;
    } | null;                        // null if triggered: false
    modelUsed: string;               // e.g. "claude-sonnet-4-20250514" or "llama3:70b"
    generatedAt: string;             // ISO timestamp
  };
}
```

The full briefing (including scenarios) is:
1. Pinned to IPFS via `ipfs-publisher.ts`
2. The IPFS CID and `keccak256` content hash submitted on-chain via `chain-submitter.ts`
3. The on-chain hash is the tamper-proof anchor — citizens can always verify what was shown

---

## CCP operational behaviour

The scenario engine follows the Civic Continuity Protocol tier rules. See `docs/CCP-SPEC.md` for the full CCP specification.

| CCP tier | Connectivity state | Scenario engine behaviour |
|----------|--------------------|---------------------------|
| Normal   | Full               | Anthropic API (dev and Tier 1 production) |
| Tier 1   | Routine outage <72 hrs | Anthropic API continues |
| Tier 2   | Extended outage 72 hrs–30 days | Switches to local Ollama model |
| Tier 3   | Catastrophic >30 days | Ollama if hardware available; pre-generated briefings as fallback |

**Pre-generated briefing fallback:** For scheduled major votes where a connectivity outage is anticipated, the scenario engine can be run ahead of time during a connected window. Pre-generated briefings are signed with the pipeline's key, timestamped, and stored locally on quorum nodes. The panel approval and on-chain anchoring steps complete when connectivity is restored, within the 72-hour settlement window.

Pre-generated briefings must be flagged as `generationMode: 'pre-generated'` in the briefing metadata. Citizens are informed that the briefing was prepared before the outage, with the generation timestamp visible.

---

## AI prompting strategy

The scenario engine uses a structured chain of prompts, not a single generation call. This improves consistency and makes each reasoning step independently auditable.

### Prompt chain

1. **Classification audit prompt** — Given the proposal text and declared `voteType`, assess whether the classification is appropriate. Return `recommendedType`, `confidence`, and `justification`.

2. **Context extraction prompt** — Extract the core policy mechanism, affected populations, and relevant historical precedents. This output feeds into all three scenario prompts.

3. **Scenario generation prompts (×3)** — Run independently for best, base, and worst. Each prompt receives: proposal text, extracted context, scenario type, and an explicit instruction to assess `minorityImpact` as a required field.

4. **Consistency check prompt** — Review all three scenarios together. Flag internal contradictions (e.g. worst scenario less severe than base) and confirm that `base` reflects the most probable outcome rather than a midpoint average.

5. **Briefing assembly** — Combine scenario objects with the standard briefing output from `ai-analyzer.ts`.

Running scenarios independently before a consistency check prevents the model from anchoring on an early scenario and producing artificially symmetrical outputs.

---

## Audit and transparency requirements

- All prompt inputs and raw AI outputs are logged for every scenario run
- The `modelUsed` field is mandatory — citizens and auditors must be able to identify exactly which model produced the analysis
- Classification audit decisions are recorded on-chain as part of the briefing hash
- Panel overrides of engine classification recommendations are recorded with the panel member's identifier and written justification
- Scenario engine logs are retained for the full constitutional audit period

---

## Implementation notes

- **File:** `civic-ai/src/scenario-engine.ts`
- **Dependencies:** `ai-client.ts` (shared provider abstraction — handles Anthropic ↔ Ollama), `ai-analyzer.ts` (standard briefing — scenario engine extends, not replaces)
- **Called by:** `pipeline.ts` after `voteType` classification is resolved and before IPFS publishing
- **Tests:** `test/scenario-engine.test.ts` — mock AI client, cover all voteType paths, classification upgrade path, CCP mode switching, and null output for `minor` votes

---

## Open questions (for Protocol Administration, not implementation blockers)

1. **`policy` vote threshold** — What quantitative or qualitative criteria should guide panel decisions on whether a `policy` vote warrants scenario modelling? A future protocol amendment should codify this.
2. **Scenario language** — Scenarios are generated in the proposal's primary language. The translation pipeline applies afterwards. Confirm this order is acceptable or whether scenarios should be generated per-language.
3. **Historical precedent sourcing** — The engine currently relies on the model's training data for precedents. A future enhancement could integrate a curated precedent database. This is not a blocker for the initial implementation.
