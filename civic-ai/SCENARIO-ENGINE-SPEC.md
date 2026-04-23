# Civic AI — Scenario Engine Specification

**Location:** `civic-ai/SCENARIO-ENGINE-SPEC.md`  
**Status:** Specification — implementation target  
**Related:** `docs/CCP-SPEC.md`, `src/scenario-engine.ts` (to be built)

---

## Purpose

The scenario engine generates statistically grounded predictive briefings for governance proposals before any vote opens. It runs 1,000 Monte Carlo simulations per proposal, producing a probability distribution of outcomes from which three citizen-facing scenarios — best, base, and worst — are derived. Citizens are told the probability of each scenario based on the simulation results, not an AI narrative invented without evidential basis.

The LLM's role in the scenario engine is constrained to two tasks: eliciting parameters from proposal text, and interpreting statistical output into plain language. The LLM does not generate predictions. The modelling stack generates predictions.

This is core civic-ai infrastructure. It runs in all operational states, including CCP mode. It is not an emergency feature.

The AI informs. It never recommends a vote direction.

---

## Modelling stack

The scenario engine uses four interpretable, auditable methods. Black-box models are explicitly prohibited (see below).

### Monte Carlo simulation
The core engine. Input parameters (compliance rate, economic conditions, implementation quality, institutional capacity, political friction, etc.) are expressed as probability distributions elicited from the proposal text by the LLM. The engine runs 1,000 simulations varying those inputs stochastically, producing a full probability distribution of outcomes.

**Adaptive stopping criterion:** Runs continue until the 95% confidence interval on the outcome distribution stops narrowing meaningfully (convergence threshold: <0.5% change over 50 consecutive runs). In practice this stabilises near 1,000 runs for most policy problems. The actual run count is recorded in the briefing metadata.

### Bayesian inference
Updates the Monte Carlo prior with historical precedent. When matching historical cases exist in the OGP policy database, the outcome distribution is updated using Bayesian weighting. This anchors predictions in evidence rather than parameter assumptions alone.

### Time series analysis (ARIMA / Prophet)
Applied where proposals have quantitative projections — economic, demographic, fiscal, environmental. ARIMA for stable, lower-frequency series; Prophet for series with seasonal patterns or known structural breaks. Outputs feed as constrained parameters into the Monte Carlo runs.

### Random Forest classification
Classifies whether a given policy type has historically tended to succeed or fail under similar conditions. Produces feature importance scores — the model can show citizens which factors drove the classification most heavily. This interpretability is constitutionally required (see below).

---

## Black-box model prohibition

**Neural networks and any model that cannot produce human-interpretable explanations of individual predictions are explicitly prohibited from the scenario engine.**

The constitutional transparency requirement is not satisfied by open-source code alone. A citizen must be able to ask "why did the model weight this outcome at 73% probability?" and receive a meaningful, plain-language answer. Random Forest feature importance and Bayesian posterior distributions satisfy this. Neural network activations do not.

**Revision clause:** Citizens may vote to revisit this prohibition if interpretable models demonstrably fail accuracy thresholds after a defined operational period (minimum 3 years, minimum 50 major-vote briefings evaluated against observed outcomes). Any such revision requires a `policy`-level vote and full scenario modelling of the proposed change.

---

## Scenario derivation

The three citizen-facing scenarios are derived from the probability distribution produced by the simulation runs. They are not invented narratives.

| Scenario | Distribution position | Meaning |
|----------|-----------------------|---------|
| `best`   | ~85th percentile      | A good outcome is this probable or better |
| `base`   | Median (50th)         | The most likely single outcome |
| `worst`  | ~15th percentile      | A poor outcome is this probable or worse |

The probability of each scenario is reported directly to citizens. For example: *"Based on 1,000 simulations weighted against 34 historical precedents, there is a 22% probability of the best-case outcome, a 51% probability of the base outcome, and a 27% probability of the worst-case outcome."*

The LLM interprets these distributions into plain-language narratives after the simulations complete. It does not alter the probabilities.

---

## Scenario structure

```typescript
interface Scenario {
  type: 'best' | 'base' | 'worst';
  distributionPercentile: number;       // e.g. 85, 50, 15
  probability: number;                  // 0.0–1.0 from simulation output
  label: string;                        // Human-readable title
  narrative: string;                    // LLM-generated plain-language summary, 200–300 words
  keyAssumptions: string[];             // Parameter values that produce this outcome
  timeHorizons: {
    oneYear: ScenarioOutcome;
    fiveYear: ScenarioOutcome;
    twentyYear: ScenarioOutcome;
  };
  impactScore: number;                  // 0–100 magnitude of change (not direction)
  minorityImpact: MinorityImpact;       // Mandatory — cannot be null
  secondOrderEffects: string[];         // Downstream consequences
  reversibility: 'easily reversible' | 'difficult to reverse' | 'irreversible';
  drivingFeatures: FeatureImportance[]; // From Random Forest — why this classification
}

interface ScenarioOutcome {
  description: string;
  affectedPopulation: string;
  economicIndicator?: string;
}

interface MinorityImpact {
  summary: string;
  groupsAnalysed: string[];
  disproportionateRisk: boolean;
  detail: string;
}

interface FeatureImportance {
  feature: string;         // e.g. "institutional compliance rate"
  importance: number;      // 0.0–1.0 relative weight
  direction: 'positive' | 'negative';
}
```

---

## Data sources

The modelling stack depends on historical policy outcome data. Prediction quality is directly proportional to data quality and coverage.

### OGP Policy Database
The authoritative data source. An OGP-maintained, curated database seeded from public datasets and expanded over time as OGP-governed proposals produce observed outcomes.

**Seed sources:**
- World Bank development and governance indicators
- OECD policy effectiveness datasets
- Academic repositories (political science, public policy, economics)
- FTSG Convergence 2026 and equivalent futures/convergence research reports
- Historical records of world power shifts and geopolitical transition outcomes

**Data governance:**
- All entries carry provenance metadata (source, date, methodology)
- Entries are versioned — the exact database version used for each briefing is recorded in the briefing metadata
- Citizens and auditors can inspect which historical cases informed a given prediction
- Data additions and revisions go through the oversight panel process

### Data quality flags
Each simulation run records:
- Number of matching historical precedents found
- Geographic and cultural proximity of precedents to the jurisdiction
- Recency weight (recent precedents weighted more heavily by default, configurable)
- Whether time series data was available for quantitative projections

These flags feed directly into the confidence score.

---

## Confidence threshold

A minimum confidence floor of **60%** applies before the scenario engine produces a publishable briefing.

**Confidence is defined as:** the proportion of simulation variance explained by the available evidence, combining Monte Carlo convergence quality, number of historical precedents matched, and Bayesian posterior certainty.

| Confidence level | Engine behaviour |
|------------------|-----------------|
| ≥ 60%            | Briefing produced normally; confidence score reported to citizens |
| 40–59%           | `LOW_CONFIDENCE` flag — briefing produced but panel must explicitly approve with written justification recorded on-chain |
| < 40%            | `INSUFFICIENT_DATA` flag — briefing not published; panel decides whether to proceed with manual expert analysis or delay the vote pending data enrichment |

In all cases the confidence score and flag are visible to citizens in the published briefing. Citizens are never shown a confident-looking briefing produced on thin evidence.

---

## Trigger classification

### Vote types

Every proposal carries a `voteType` field set by the proposing authority at submission:

| `voteType`        | Description                                               | Scenario engine |
|-------------------|-----------------------------------------------------------|-----------------|
| `constitutional`  | Amendment to any constitutional tier                      | Always runs     |
| `treaty`          | International or inter-jurisdictional treaty ratification  | Always runs     |
| `budget`          | National or regional budget                               | Always runs     |
| `referendum`      | Citizen-initiated or constitutionally mandated referendum  | Always runs     |
| `policy`          | Significant policy change — scope determined by proposer  | Conditional     |
| `minor`           | Procedural, administrative, low-consequence changes       | Never runs      |

### Hybrid classification (Option C)

Classification integrity requires that no actor can quietly route a high-consequence proposal through as `minor` or `policy` to avoid scenario scrutiny.

**Process:**

1. **Proposer sets `voteType`** at submission.
2. **LLM audits the proposal text** during the analysis phase, producing a `classificationConfidence` score and, where its assessment differs, a `classificationUpgradeRecommendation` with plain-language justification.
3. **Oversight panel receives both** — the proposer's declared type and the engine's recommendation — and makes the binding classification decision before the briefing is finalised.
4. **Panel decision is recorded** in the briefing metadata and committed on-chain with the briefing hash.

**Protocol-level rules:**
- `constitutional`, `treaty`, `budget`, `referendum` are locked types — scenario engine always runs; panel cannot waive it.
- `policy` → upgrade to scenario-eligible is panel-discretionary.
- `minor` → upgrade requires panel majority vote with written justification, recorded on-chain.
- Repeated misclassification by a proposing authority is flagged to the Independent Public Prosecutor.

---

## Processing pipeline

```
Proposal text
     │
     ▼
[1] LLM: parameter elicitation
    — Identify key variables and plausible ranges
    — Classification audit (compare declared vs recommended voteType)
     │
     ▼
[2] Time series module (ARIMA / Prophet)
    — Quantitative projections for applicable parameters
    — Outputs fed as constrained inputs to Monte Carlo
     │
     ▼
[3] Monte Carlo engine: 1,000 runs (adaptive stopping)
    — Vary input parameters across probability distributions
    — Produce full outcome probability distribution
     │
     ▼
[4] Bayesian layer
    — Query OGP Policy Database for historical precedents
    — Update distribution with Bayesian weighting
    — Record precedent count and confidence contribution
     │
     ▼
[5] Random Forest classifier
    — Classify policy success/failure likelihood
    — Produce feature importance scores
     │
     ▼
[6] Confidence assessment
    — Compute confidence score
    — Apply threshold rules (≥60% / 40–59% / <40%)
     │
     ▼
[7] LLM: narrative interpretation
    — Derive best/base/worst from distribution percentiles
    — Write plain-language scenario narratives
    — Feed to translate.ts for multilingual output
     │
     ▼
[8] Briefing assembly
    — Bundle scenarios into ProposalBriefing JSON
    — IPFS pin via ipfs-publisher.ts
    — On-chain hash commit via chain-submitter.ts
     │
     ▼
[9] Oversight panel review
    — Panel approves classification and briefing
    — Panel decision recorded on-chain
     │
     ▼
Voting opens
```

---

## Briefing integration

Scenario output is bundled into the same briefing JSON produced by `ai-analyzer.ts`. It extends the standard briefing — it does not replace it.

```typescript
interface ProposalBriefing {
  // ... existing fields (summary, keyPoints, risks, minorityImpact, etc.)

  scenarioEngine: {
    triggered: boolean;
    triggerReason: string;
    simulationRuns: number;                 // Actual runs to convergence
    modelStack: string[];                   // e.g. ["monte-carlo", "bayesian", "arima", "random-forest"]
    modelVersions: Record<string, string>;  // Version of each model component
    databaseVersion: string;               // OGP Policy Database version used
    historicalPrecedentsMatched: number;
    confidenceScore: number;               // 0.0–1.0
    confidenceFlag: 'normal' | 'LOW_CONFIDENCE' | 'INSUFFICIENT_DATA';
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
    } | null;
    generatedAt: string;                   // ISO timestamp
    generationMode: 'live' | 'pre-generated';
  };
}
```

---

## CCP operational behaviour

| CCP tier | Connectivity state             | Scenario engine behaviour |
|----------|-------------------------------|---------------------------|
| Normal   | Full                           | Anthropic API + full modelling stack |
| Tier 1   | Routine outage <72 hrs         | Anthropic API continues |
| Tier 2   | Extended outage 72 hrs–30 days | Switches to local Ollama; modelling stack runs locally |
| Tier 3   | Catastrophic >30 days          | Ollama if hardware available; pre-generated briefings as fallback |

**Pre-generated briefings:** For scheduled major votes where a connectivity outage is anticipated, the full pipeline including simulations can be run ahead of time during a connected window. Pre-generated briefings are signed, timestamped, and stored on quorum nodes. On-chain anchoring completes within the 72-hour settlement window post-restoration. `generationMode: 'pre-generated'` is always visible to citizens.

See `docs/CCP-SPEC.md` for the full resilience specification.

---

## Audit and transparency requirements

- All simulation inputs, run counts, and raw output distributions are logged for every scenario run
- Full model stack and database version are recorded in every briefing — the analysis is reproducible
- Feature importance scores from Random Forest are published in the briefing so citizens can see what drove the classification
- Classification audit decisions and panel overrides are committed on-chain
- Repeated proposer misclassification is publicly auditable and IPP-reportable
- Scenario engine logs are retained for the full constitutional audit period

---

## Implementation notes

- **Primary file:** `civic-ai/src/scenario-engine.ts`
- **Supporting files:** `civic-ai/src/monte-carlo.ts`, `civic-ai/src/bayesian.ts`, `civic-ai/src/time-series.ts`, `civic-ai/src/random-forest.ts`
- **Data:** `civic-ai/data/policy-database/` (seed data and schema)
- **Dependencies:** `ai-client.ts` (LLM abstraction), `ai-analyzer.ts` (standard briefing — scenarios extend it)
- **Called by:** `pipeline.ts` after `voteType` classification is resolved and before IPFS publishing
- **Tests:** `test/scenario-engine.test.ts` — cover all voteType paths, classification upgrade path, confidence threshold rules (all three bands), CCP mode switching, null output for `minor` votes, and Monte Carlo convergence behaviour

---

## Open questions (Protocol Administration — not implementation blockers)

1. **`policy` vote threshold:** What quantitative or qualitative criteria should guide panel decisions on whether a `policy` vote warrants scenario modelling? A future protocol amendment should codify this to reduce panel subjectivity.
2. **Accuracy review period:** The black-box model revision clause requires a defined operational period and accuracy threshold. Protocol Administration should set these before the first 50 major-vote briefings are evaluated against observed outcomes.
3. **Database expansion governance:** Who has write access to the OGP Policy Database, and what peer-review standard applies to new entries? This affects long-term prediction quality and should be constitutionally specified.
