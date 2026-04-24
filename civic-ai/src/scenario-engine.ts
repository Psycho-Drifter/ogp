/**
 * Scenario Engine — Main Orchestrator
 *
 * Ties together all modelling layers into a single callable pipeline:
 *   1. LLM parameter elicitation + classification audit
 *   2. Time series projections (where applicable)
 *   3. Monte Carlo simulation (1,000 runs adaptive)
 *   4. Bayesian update from historical precedents
 *   5. Random Forest classification
 *   6. Confidence assessment
 *   7. LLM narrative interpretation
 *
 * Called by pipeline.ts after voteType classification is resolved
 * and before IPFS publishing.
 *
 * The LLM does not generate predictions.
 * The modelling stack generates predictions.
 * The LLM interprets them.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  runMonteCarlo,
  normaliseWeights,
  type Parameter,
  type SimulationResult,
} from './monte-carlo.js';
import {
  queryPrecedents,
  bayesianUpdate,
  type HistoricalPrecedent,
  type BayesianUpdateResult,
} from './bayesian.js';
import {
  projectTimeSeries,
  projectionsToParameters,
  type TimeSeriesInput,
  type TimeSeriesProjection,
} from './time-series.js';
import {
  classifyPolicy,
  featuresToVector,
  type PolicyFeatures,
  type ClassificationResult,
} from './random-forest.js';
import { assessConfidence, type ConfidenceBreakdown } from './confidence.js';
import {
  type VoteType,
  type PolicyDatabase,
  LOCKED_TYPES,
  SCENARIO_TRIGGERING_TYPES,
} from './policy-database/schema.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProposalInput {
  id: string;
  title: string;
  body: string;                         // Full proposal text
  voteType: VoteType;                   // Declared by proposing authority
  jurisdiction?: string;                // ISO 3166-1 alpha-3
  timeSeriesInputs?: TimeSeriesInput[]; // Optional quantitative data
}

export interface ClassificationAudit {
  proposerDeclaredType: VoteType;
  engineRecommendedType: VoteType | null;
  engineConfidence: number;
  engineJustification: string | null;
  // panelFinalClassification and panelClassificationNotes are set externally
  // after panel review — not populated by the engine
  panelFinalClassification?: VoteType;
  panelClassificationNotes?: string;
}

export interface Scenario {
  type: 'best' | 'base' | 'worst';
  distributionPercentile: number;
  probability: number;
  label: string;
  narrative: string;
  keyAssumptions: string[];
  timeHorizons: {
    oneYear: { description: string; affectedPopulation: string; economicIndicator?: string };
    fiveYear: { description: string; affectedPopulation: string; economicIndicator?: string };
    twentyYear: { description: string; affectedPopulation: string; economicIndicator?: string };
  };
  impactScore: number;
  minorityImpact: {
    summary: string;
    groupsAnalysed: string[];
    disproportionateRisk: boolean;
    detail: string;
  };
  secondOrderEffects: string[];
  reversibility: 'easily reversible' | 'difficult to reverse' | 'irreversible';
  drivingFeatures: Array<{
    feature: string;
    importance: number;
    direction: 'positive' | 'negative';
    humanReadable: string;
  }>;
}

export interface ScenarioEngineOutput {
  triggered: boolean;
  triggerReason: string;
  simulationRuns: number;
  modelStack: string[];
  modelVersions: Record<string, string>;
  databaseVersion: string;
  historicalPrecedentsMatched: number;
  confidenceScore: number;
  confidenceFlag: 'normal' | 'LOW_CONFIDENCE' | 'INSUFFICIENT_DATA';
  confidenceExplanation: string;
  confidenceWarnings: string[];
  classificationAudit: ClassificationAudit;
  scenarios: { best: Scenario; base: Scenario; worst: Scenario } | null;
  simulationResult?: SimulationResult;     // Full audit record
  bayesianResult?: BayesianUpdateResult;   // Full audit record
  projections?: TimeSeriesProjection[];    // Full audit record
  classificationResult?: ClassificationResult;
  generatedAt: string;
  generationMode: 'live' | 'pre-generated';
}

// ─── LLM prompt helpers ───────────────────────────────────────────────────────

/**
 * Build the prompt for LLM parameter elicitation.
 * The LLM extracts the key policy variables and their probability distributions
 * from the proposal text. Output is structured JSON.
 */
function buildParameterElicitationPrompt(proposal: ProposalInput): string {
  return `You are a policy analysis assistant. Your task is to extract the key input parameters for a Monte Carlo policy simulation from a governance proposal.

PROPOSAL TITLE: ${proposal.title}
VOTE TYPE: ${proposal.voteType}
JURISDICTION: ${proposal.jurisdiction ?? 'unspecified'}

PROPOSAL TEXT:
${proposal.body}

Extract the key variables that will determine whether this policy succeeds or fails.
For each variable, estimate:
- A central (mean) value between 0.0 (worst case) and 1.0 (best case)
- A standard deviation representing uncertainty (0.05 = low uncertainty, 0.25 = high uncertainty)
- A weight representing how important this variable is relative to others

Also identify the key policy features for Random Forest classification:
- institutionalCapacity (0.0–1.0)
- economicConditions (0.0–1.0)
- publicSupport (0.0–1.0)
- implementationComplexity (0.0–1.0, where 1.0 = very simple)
- fiscalSpace (0.0–1.0)
- precedentSuccessRate (0.0–1.0, your estimate based on policy type)
- jurisdictionalAlignment (0.0–1.0)
- stakeholderCoordination (0.0–1.0, where 1.0 = minimal coordination needed)

Also identify search tags for finding historical precedents.

Respond ONLY with valid JSON, no preamble or markdown:
{
  "parameters": [
    {
      "name": "string — snake_case variable name",
      "description": "string — plain English description",
      "mean": number,
      "stdDev": number,
      "min": number,
      "max": number,
      "weight": number
    }
  ],
  "policyFeatures": {
    "institutionalCapacity": number,
    "economicConditions": number,
    "publicSupport": number,
    "implementationComplexity": number,
    "fiscalSpace": number,
    "precedentSuccessRate": number,
    "jurisdictionalAlignment": number,
    "stakeholderCoordination": number
  },
  "tags": ["string"],
  "elicitationNotes": "string — brief explanation of your parameter choices"
}`;
}

/**
 * Build the classification audit prompt.
 * The LLM checks whether the proposer's declared voteType is appropriate.
 */
function buildClassificationAuditPrompt(proposal: ProposalInput): string {
  return `You are a governance classification auditor. Check whether a proposal has been correctly classified by its proposer.

PROPOSAL TITLE: ${proposal.title}
PROPOSER-DECLARED VOTE TYPE: ${proposal.voteType}

PROPOSAL TEXT:
${proposal.body}

Valid vote types and when they apply:
- constitutional: Any amendment to constitutional provisions
- treaty: International or inter-jurisdictional treaty ratification
- budget: National or regional budget proposals
- referendum: Citizen-initiated or constitutionally mandated referendum
- policy: Significant policy change
- minor: Procedural, administrative, or low-consequence changes

Assess whether the declared type is correct. If the proposal appears to be misclassified (e.g. a constitutional amendment filed as "minor"), flag it.

Respond ONLY with valid JSON, no preamble or markdown:
{
  "proposerDeclaredType": "${proposal.voteType}",
  "engineRecommendedType": "string or null if declared type is correct",
  "engineConfidence": number between 0.0 and 1.0,
  "engineJustification": "string explaining your reasoning, or null if no change recommended"
}`;
}

/**
 * Build the narrative interpretation prompt.
 * The LLM converts statistical output into plain-language citizen narratives.
 * It does NOT alter the probabilities — it only writes the words.
 */
function buildNarrativePrompt(
  proposal: ProposalInput,
  simulation: SimulationResult,
  bayesian: BayesianUpdateResult,
  classification: ClassificationResult,
  projections: TimeSeriesProjection[]
): string {
  const posterior = bayesian.posterior;
  const successPct = Math.round(classification.successProbability * 100);

  return `You are a civic briefing writer. Convert statistical modelling results into clear, plain-language scenario narratives for citizens.

PROPOSAL: ${proposal.title}
VOTE TYPE: ${proposal.voteType}
JURISDICTION: ${proposal.jurisdiction ?? 'unspecified'}

STATISTICAL RESULTS (DO NOT ALTER THESE NUMBERS):
- Simulation runs: ${simulation.runs}
- Historical precedents matched: ${bayesian.precedentsUsed}
- Posterior mean outcome: ${posterior.mean.toFixed(3)}
- 15th percentile (worst anchor): ${posterior.percentile15.toFixed(3)}
- 50th percentile (base anchor): ${posterior.percentile50.toFixed(3)}
- 85th percentile (best anchor): ${posterior.percentile85.toFixed(3)}
- Random Forest success probability: ${successPct}%
- Top driving features: ${classification.featureImportance.slice(0, 3).map(f => `${f.feature} (${f.direction})`).join(', ')}

${projections.length > 0 ? `TIME SERIES PROJECTIONS:
${projections.map(p => `- ${p.name}: ${p.trend} trend (1yr: ${p.oneYear.point.toFixed(1)} ${p.unit})`).join('\n')}` : ''}

FULL PROPOSAL TEXT:
${proposal.body}

Write three scenario narratives. Each narrative must:
- Be 200–300 words in plain English (8th-grade reading level)
- Accurately reflect the statistical output above — do not invent probabilities
- Identify the minority groups most affected and whether risk is disproportionate
- Name 2–3 key assumptions that would need to hold for this scenario to occur
- Assess reversibility honestly
- List 2–3 second-order effects citizens may not have considered

The scenarios represent:
- BEST: outcomes around the 85th percentile of the simulation distribution
- BASE: outcomes around the median — the most probable single outcome
- WORST: outcomes around the 15th percentile — the pessimistic stress case

Respond ONLY with valid JSON, no preamble or markdown:
{
  "best": {
    "label": "string — evocative title for this scenario",
    "narrative": "string",
    "keyAssumptions": ["string", "string", "string"],
    "timeHorizons": {
      "oneYear": { "description": "string", "affectedPopulation": "string", "economicIndicator": "string or omit" },
      "fiveYear": { "description": "string", "affectedPopulation": "string", "economicIndicator": "string or omit" },
      "twentyYear": { "description": "string", "affectedPopulation": "string", "economicIndicator": "string or omit" }
    },
    "impactScore": number,
    "minorityImpact": {
      "summary": "string",
      "groupsAnalysed": ["string"],
      "disproportionateRisk": boolean,
      "detail": "string"
    },
    "secondOrderEffects": ["string", "string"],
    "reversibility": "easily reversible | difficult to reverse | irreversible"
  },
  "base": { ...same structure... },
  "worst": { ...same structure... }
}`;
}

// ─── LLM client helper ────────────────────────────────────────────────────────

async function callLLM(
  prompt: string,
  provider: 'anthropic' | 'ollama' = 'anthropic',
  ollamaModel: string = 'llama3:70b'
): Promise<string> {
  if (provider === 'anthropic') {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Unexpected non-text response from Anthropic API');
    return block.text;
  }

  // Ollama (CCP Tier 2+)
  const response = await fetch(`${process.env.AI_BASE_URL ?? 'http://localhost:11434'}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ollamaModel,
      prompt,
      stream: false,
      options: { num_predict: 4096 },
    }),
  });
  if (!response.ok) throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  const data = await response.json() as { response: string };
  return data.response;
}

function parseJSON<T>(raw: string): T {
  const clean = raw.replace(/```json\n?|```\n?/g, '').trim();
  return JSON.parse(clean) as T;
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function runScenarioEngine(
  proposal: ProposalInput,
  database: PolicyDatabase,
  options: {
    provider?: 'anthropic' | 'ollama';
    ollamaModel?: string;
    seed?: number;
    generationMode?: 'live' | 'pre-generated';
  } = {}
): Promise<ScenarioEngineOutput> {
  const provider = options.provider ?? 'anthropic';
  const ollamaModel = options.ollamaModel ?? 'llama3:70b';
  const generationMode = options.generationMode ?? 'live';

  // ── Determine whether to trigger ────────────────────────────────────────────
  const isLockedType = LOCKED_TYPES.includes(proposal.voteType);
  const isTriggeredType = SCENARIO_TRIGGERING_TYPES.includes(proposal.voteType);

  if (proposal.voteType === 'minor') {
    return {
      triggered: false,
      triggerReason: 'Vote type is "minor" — scenario engine does not run for minor votes.',
      simulationRuns: 0,
      modelStack: [],
      modelVersions: {},
      databaseVersion: database.metadata.version,
      historicalPrecedentsMatched: 0,
      confidenceScore: 0,
      confidenceFlag: 'normal',
      confidenceExplanation: 'Scenario engine not triggered.',
      confidenceWarnings: [],
      classificationAudit: {
        proposerDeclaredType: proposal.voteType,
        engineRecommendedType: null,
        engineConfidence: 1,
        engineJustification: null,
      },
      scenarios: null,
      generatedAt: new Date().toISOString(),
      generationMode,
    };
  }

  // ── Step 1: Classification audit ─────────────────────────────────────────────
  const classificationRaw = await callLLM(
    buildClassificationAuditPrompt(proposal),
    provider,
    ollamaModel
  );
  const classificationAuditData = parseJSON<{
    proposerDeclaredType: VoteType;
    engineRecommendedType: VoteType | null;
    engineConfidence: number;
    engineJustification: string | null;
  }>(classificationRaw);

  const classificationAudit: ClassificationAudit = {
    proposerDeclaredType: proposal.voteType,
    engineRecommendedType: classificationAuditData.engineRecommendedType,
    engineConfidence: classificationAuditData.engineConfidence,
    engineJustification: classificationAuditData.engineJustification,
  };

  // For policy votes, if the engine doesn't recommend upgrading to a triggering type,
  // don't run scenarios. The panel can override this.
  if (
    proposal.voteType === 'policy' &&
    !isTriggeredType &&
    classificationAuditData.engineRecommendedType === null
  ) {
    return {
      triggered: false,
      triggerReason:
        'Vote type is "policy" and the classification engine did not recommend scenario modelling. ' +
        'The oversight panel may override this decision.',
      simulationRuns: 0,
      modelStack: [],
      modelVersions: {},
      databaseVersion: database.metadata.version,
      historicalPrecedentsMatched: 0,
      confidenceScore: 0,
      confidenceFlag: 'normal',
      confidenceExplanation: 'Scenario engine not triggered.',
      confidenceWarnings: [],
      classificationAudit,
      scenarios: null,
      generatedAt: new Date().toISOString(),
      generationMode,
    };
  }

  const triggerReason = isLockedType
    ? `Vote type "${proposal.voteType}" is a locked constitutional type — scenario engine always runs.`
    : `Classification engine recommended scenario modelling for this policy vote.`;

  // ── Step 2: LLM parameter elicitation ────────────────────────────────────────
  const elicitationRaw = await callLLM(
    buildParameterElicitationPrompt(proposal),
    provider,
    ollamaModel
  );
  const elicitation = parseJSON<{
    parameters: Parameter[];
    policyFeatures: PolicyFeatures;
    tags: string[];
    elicitationNotes: string;
  }>(elicitationRaw);

  // ── Step 3: Time series projections ──────────────────────────────────────────
  let projections: TimeSeriesProjection[] = [];
  if (proposal.timeSeriesInputs && proposal.timeSeriesInputs.length > 0) {
    projections = proposal.timeSeriesInputs.map(ts => projectTimeSeries(ts));
    // Merge TS-derived parameters into elicited parameters
    const tsParams = projectionsToParameters(projections);
    for (const tsp of tsParams) {
      elicitation.parameters.push({
        ...tsp,
        weight: 0.5, // will be normalised
      });
    }
  }

  // ── Step 4: Monte Carlo simulation ───────────────────────────────────────────
  const simulation = runMonteCarlo(elicitation.parameters, 1000, options.seed);

  // ── Step 5: Bayesian update ───────────────────────────────────────────────────
  const precedents = queryPrecedents(database.entries, {
    policyType: proposal.voteType,
    tags: elicitation.tags,
    jurisdiction: proposal.jurisdiction,
    maxResults: 20,
  });
  const bayesian = bayesianUpdate(simulation, precedents);

  // ── Step 6: Random Forest classification ─────────────────────────────────────
  const rfResult = classifyPolicy(elicitation.policyFeatures, database.entries);

  // ── Step 7: Confidence assessment ────────────────────────────────────────────
  const confidence = assessConfidence(simulation, bayesian, projections, rfResult);

  // If INSUFFICIENT_DATA, return without generating narratives
  if (confidence.flag === 'INSUFFICIENT_DATA') {
    return {
      triggered: true,
      triggerReason,
      simulationRuns: simulation.runs,
      modelStack: ['monte-carlo', 'bayesian', 'random-forest'],
      modelVersions: {
        'monte-carlo': 'mc-v1',
        bayesian: 'bayes-v1',
        'random-forest': rfResult.modelVersion,
      },
      databaseVersion: database.metadata.version,
      historicalPrecedentsMatched: bayesian.precedentsUsed,
      confidenceScore: confidence.overallScore,
      confidenceFlag: 'INSUFFICIENT_DATA',
      confidenceExplanation: confidence.explanation,
      confidenceWarnings: confidence.warnings,
      classificationAudit,
      scenarios: null,
      simulationResult: simulation,
      bayesianResult: bayesian,
      projections,
      classificationResult: rfResult,
      generatedAt: new Date().toISOString(),
      generationMode,
    };
  }

  // ── Step 8: LLM narrative interpretation ─────────────────────────────────────
  const narrativeRaw = await callLLM(
    buildNarrativePrompt(proposal, simulation, bayesian, rfResult, projections),
    provider,
    ollamaModel
  );
  const narrativeData = parseJSON<{
    best: Omit<Scenario, 'type' | 'distributionPercentile' | 'probability' | 'drivingFeatures'>;
    base: Omit<Scenario, 'type' | 'distributionPercentile' | 'probability' | 'drivingFeatures'>;
    worst: Omit<Scenario, 'type' | 'distributionPercentile' | 'probability' | 'drivingFeatures'>;
  }>(narrativeRaw);

  // ── Step 9: Assemble final scenarios ─────────────────────────────────────────
  // Probabilities are derived from the Bayesian posterior distribution,
  // not from the LLM.
  const p = bayesian.posterior;
  const totalRange = p.percentile85 - p.percentile15 || 1;
  const bestProb = (p.percentile85) / (p.percentile85 + p.percentile50 + (1 - p.percentile15));
  const baseProb = (p.percentile50) / (p.percentile85 + p.percentile50 + (1 - p.percentile15));
  const worstProb = 1 - bestProb - baseProb;

  const drivingFeatures = rfResult.featureImportance.slice(0, 5).map(f => ({
    feature: f.feature,
    importance: f.importance,
    direction: f.direction,
    humanReadable: f.humanReadable,
  }));

  const scenarios = {
    best: {
      type: 'best' as const,
      distributionPercentile: 85,
      probability: Math.max(0, Math.min(1, bestProb)),
      drivingFeatures,
      ...narrativeData.best,
    },
    base: {
      type: 'base' as const,
      distributionPercentile: 50,
      probability: Math.max(0, Math.min(1, baseProb)),
      drivingFeatures,
      ...narrativeData.base,
    },
    worst: {
      type: 'worst' as const,
      distributionPercentile: 15,
      probability: Math.max(0, Math.min(1, worstProb)),
      drivingFeatures,
      ...narrativeData.worst,
    },
  };

  return {
    triggered: true,
    triggerReason,
    simulationRuns: simulation.runs,
    modelStack: ['monte-carlo', 'bayesian', 'time-series', 'random-forest'],
    modelVersions: {
      'monte-carlo': 'mc-v1',
      bayesian: 'bayes-v1',
      'time-series': 'ts-holt-v1',
      'random-forest': rfResult.modelVersion,
    },
    databaseVersion: database.metadata.version,
    historicalPrecedentsMatched: bayesian.precedentsUsed,
    confidenceScore: confidence.overallScore,
    confidenceFlag: confidence.flag,
    confidenceExplanation: confidence.explanation,
    confidenceWarnings: confidence.warnings,
    classificationAudit,
    scenarios,
    simulationResult: simulation,
    bayesianResult: bayesian,
    projections,
    classificationResult: rfResult,
    generatedAt: new Date().toISOString(),
    generationMode,
  };
}
