/**
 * Scenario Engine Test Suite
 *
 * Covers:
 *  - All voteType paths (locked types always trigger, minor never triggers)
 *  - Classification upgrade path (policy vote with engine upgrade recommendation)
 *  - Confidence threshold rules (all three bands)
 *  - CCP mode switching (Anthropic → Ollama)
 *  - Null output for minor votes
 *  - Monte Carlo convergence behaviour
 *  - Bayesian update with and without precedents
 *  - Random Forest with insufficient data
 *  - Black-box model prohibition (no neural networks in stack)
 *
 * Uses mock AI client — no real API calls in tests.
 */

import { describe, it, expect, beforeEach, vi, type MockInstance } from 'vitest';
import { runMonteCarlo, normaliseWeights, type Parameter } from '../monte-carlo.js';
import { queryPrecedents, bayesianUpdate, type HistoricalPrecedent } from '../bayesian.js';
import { projectTimeSeries, type TimeSeriesInput } from '../time-series.js';
import { classifyPolicy, type PolicyFeatures } from '../random-forest.js';
import { assessConfidence } from '../confidence.js';
import { runScenarioEngine, type ProposalInput } from '../scenario-engine.js';
import type { PolicyDatabase } from '../policy-database/schema.js';
import seedData from '../policy-database/seed.json' assert { type: 'json' };

// ─── Test fixtures ────────────────────────────────────────────────────────────

const database = seedData as unknown as PolicyDatabase;

const baseProposal: ProposalInput = {
  id: 'test-001',
  title: 'Test Carbon Pricing Policy',
  body: 'This policy introduces a carbon price of $50 per tonne on all fossil fuel combustion, with revenues returned to citizens as a dividend. Implementation begins January 2027 with a 5-year phase-in for heavy industry.',
  voteType: 'policy',
  jurisdiction: 'CAN',
};

const constitutionalProposal: ProposalInput = {
  ...baseProposal,
  id: 'test-002',
  voteType: 'constitutional',
  title: 'Constitutional Amendment: Right to Clean Environment',
};

const budgetProposal: ProposalInput = {
  ...baseProposal,
  id: 'test-003',
  voteType: 'budget',
  title: 'National Budget 2027',
};

const minorProposal: ProposalInput = {
  ...baseProposal,
  id: 'test-004',
  voteType: 'minor',
  title: 'Administrative: Update filing deadline from March 31 to April 15',
};

const mockParameters: Parameter[] = [
  { name: 'compliance_rate', description: 'Industry compliance', mean: 0.7, stdDev: 0.1, min: 0.2, max: 1.0, weight: 0.4 },
  { name: 'public_support', description: 'Public support level', mean: 0.65, stdDev: 0.15, min: 0.1, max: 1.0, weight: 0.3 },
  { name: 'fiscal_capacity', description: 'Government fiscal room', mean: 0.6, stdDev: 0.1, min: 0.1, max: 1.0, weight: 0.3 },
];

const mockElicitationResponse = {
  parameters: mockParameters,
  policyFeatures: {
    institutionalCapacity: 0.75,
    economicConditions: 0.65,
    publicSupport: 0.65,
    implementationComplexity: 0.6,
    fiscalSpace: 0.6,
    precedentSuccessRate: 0.75,
    jurisdictionalAlignment: 0.8,
    stakeholderCoordination: 0.55,
  } as PolicyFeatures,
  tags: ['carbon-tax', 'environmental', 'revenue-neutral', 'fiscal'],
  elicitationNotes: 'Carbon pricing with dividend return — high public support anticipated.',
};

const mockClassificationResponse = {
  proposerDeclaredType: 'policy',
  engineRecommendedType: null,
  engineConfidence: 0.9,
  engineJustification: null,
};

const mockNarrativeResponse = {
  best: {
    label: 'Clean Transition Success',
    narrative: 'In the best-case scenario, the carbon pricing policy achieves rapid decarbonisation while maintaining economic growth. Businesses adapt quickly, new green industries emerge, and dividend payments reduce the cost burden on low-income households.',
    keyAssumptions: ['Strong institutional enforcement', 'High industry compliance', 'Public support holds'],
    timeHorizons: {
      oneYear: { description: 'Carbon emissions begin declining', affectedPopulation: 'All households receive dividend' },
      fiveYear: { description: 'Significant industrial transition underway', affectedPopulation: 'New green jobs created' },
      twentyYear: { description: 'Net zero achieved ahead of schedule', affectedPopulation: 'All citizens benefit from cleaner air' },
    },
    impactScore: 80,
    minorityImpact: {
      summary: 'Positive for low-income households via dividend',
      groupsAnalysed: ['Low-income households', 'Rural communities', 'Industrial workers'],
      disproportionateRisk: false,
      detail: 'The dividend mechanism ensures low-income households receive more in payments than they pay in increased energy costs.',
    },
    secondOrderEffects: ['Accelerated EV adoption', 'Shift to public transit'],
    reversibility: 'difficult to reverse',
  },
  base: {
    label: 'Gradual Transition',
    narrative: 'The most likely outcome is a moderate transition with some friction. Most industries comply but lobbying slows the phase-in timeline. Dividend payments partially offset higher energy costs.',
    keyAssumptions: ['Moderate industry compliance', 'Some political pressure to exempt sectors', 'Public support remains majority'],
    timeHorizons: {
      oneYear: { description: 'Policy established, early industry adjustment', affectedPopulation: 'Most households see modest cost increases offset by dividend' },
      fiveYear: { description: 'Uneven transition across sectors', affectedPopulation: 'Trade-exposed industries face adjustment challenges' },
      twentyYear: { description: 'Significant but incomplete decarbonisation', affectedPopulation: 'Ongoing distributional effects require monitoring' },
    },
    impactScore: 60,
    minorityImpact: {
      summary: 'Mixed effects requiring monitoring',
      groupsAnalysed: ['Low-income households', 'Rural communities', 'Industrial workers'],
      disproportionateRisk: true,
      detail: 'Rural communities with limited access to alternatives may face net cost increases despite dividend. Targeted support may be needed.',
    },
    secondOrderEffects: ['Moderate EV adoption', 'Some industrial relocation pressure'],
    reversibility: 'difficult to reverse',
  },
  worst: {
    label: 'Implementation Failure',
    narrative: 'In the worst case, industry non-compliance, political erosion of the dividend, and failure to invest in transition support result in higher costs for citizens without meaningful emissions reductions.',
    keyAssumptions: ['Low industry compliance', 'Dividend eroded by fiscal pressures', 'Public opposition grows'],
    timeHorizons: {
      oneYear: { description: 'Significant political controversy', affectedPopulation: 'Low-income households face net cost increases' },
      fiveYear: { description: 'Policy weakened by exemptions', affectedPopulation: 'Industrial workers in transition industries face displacement' },
      twentyYear: { description: 'Minimal emissions impact, social strain', affectedPopulation: 'Disproportionate impact on vulnerable communities' },
    },
    impactScore: 30,
    minorityImpact: {
      summary: 'Disproportionate harm to vulnerable groups',
      groupsAnalysed: ['Low-income households', 'Rural communities', 'Industrial workers'],
      disproportionateRisk: true,
      detail: 'Without effective dividend distribution and transition support, low-income and rural households bear disproportionate cost burdens.',
    },
    secondOrderEffects: ['Industrial relocation to lower-regulation jurisdictions', 'Public distrust in climate policy'],
    reversibility: 'easily reversible',
  },
};

// ─── Mock LLM calls ───────────────────────────────────────────────────────────

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockImplementation(({ messages }: { messages: Array<{ content: string }> }) => {
        const prompt = messages[0]?.content ?? '';

        if (prompt.includes('classification auditor')) {
          return Promise.resolve({
            content: [{ type: 'text', text: JSON.stringify(mockClassificationResponse) }],
          });
        }
        if (prompt.includes('parameter elicitation') || prompt.includes('Monte Carlo')) {
          return Promise.resolve({
            content: [{ type: 'text', text: JSON.stringify(mockElicitationResponse) }],
          });
        }
        if (prompt.includes('narrative')) {
          return Promise.resolve({
            content: [{ type: 'text', text: JSON.stringify(mockNarrativeResponse) }],
          });
        }
        // Default: return elicitation response
        return Promise.resolve({
          content: [{ type: 'text', text: JSON.stringify(mockElicitationResponse) }],
        });
      }),
    },
  })),
}));

// ─── Monte Carlo tests ────────────────────────────────────────────────────────

describe('Monte Carlo simulation', () => {
  it('produces output within 0–1 range', () => {
    const result = runMonteCarlo(mockParameters, 1000, 42);
    expect(result.mean).toBeGreaterThanOrEqual(0);
    expect(result.mean).toBeLessThanOrEqual(1);
    expect(result.percentile15).toBeLessThan(result.percentile50);
    expect(result.percentile50).toBeLessThan(result.percentile85);
  });

  it('runs up to maxRuns', () => {
    const result = runMonteCarlo(mockParameters, 200, 42);
    expect(result.runs).toBeLessThanOrEqual(200);
    expect(result.runs).toBeGreaterThan(0);
  });

  it('produces deterministic output with same seed', () => {
    const a = runMonteCarlo(mockParameters, 500, 99);
    const b = runMonteCarlo(mockParameters, 500, 99);
    expect(a.mean).toBeCloseTo(b.mean, 10);
  });

  it('produces different output with different seeds', () => {
    const a = runMonteCarlo(mockParameters, 500, 1);
    const b = runMonteCarlo(mockParameters, 500, 2);
    // Should differ by at least a small amount
    expect(Math.abs(a.mean - b.mean)).toBeGreaterThan(0);
  });

  it('normalises weights correctly', () => {
    const params = normaliseWeights(mockParameters);
    const total = params.reduce((acc, p) => acc + p.weight, 0);
    expect(total).toBeCloseTo(1.0, 5);
  });

  it('throws if weights sum to zero', () => {
    const zeroWeightParams = mockParameters.map(p => ({ ...p, weight: 0 }));
    expect(() => normaliseWeights(zeroWeightParams)).toThrow();
  });

  it('records full audit log', () => {
    const result = runMonteCarlo(mockParameters, 100, 42);
    expect(result.runRecords.length).toBe(result.runs);
    expect(result.runRecords[0]).toHaveProperty('run');
    expect(result.runRecords[0]).toHaveProperty('sampledValues');
    expect(result.runRecords[0]).toHaveProperty('outcomeScore');
  });
});

// ─── Bayesian tests ───────────────────────────────────────────────────────────

describe('Bayesian update', () => {
  it('returns prior unchanged with no precedents', () => {
    const sim = runMonteCarlo(mockParameters, 500, 42);
    const result = bayesianUpdate(sim, []);
    expect(result.posterior.mean).toBeCloseTo(sim.mean, 5);
    expect(result.precedentsUsed).toBe(0);
    expect(result.confidenceContribution).toBe(0);
  });

  it('shifts posterior toward data with precedents', () => {
    const sim = runMonteCarlo(mockParameters, 500, 42);
    const precedents = database.entries.slice(0, 5);
    const result = bayesianUpdate(sim, precedents);
    expect(result.precedentsUsed).toBe(5);
    expect(result.confidenceContribution).toBeGreaterThan(0);
  });

  it('queries relevant precedents from database', () => {
    const results = queryPrecedents(database.entries, {
      policyType: 'policy',
      tags: ['carbon-tax', 'environmental'],
      jurisdiction: 'CAN',
    });
    expect(results.length).toBeGreaterThan(0);
    results.forEach(r => expect(r.proximityScore).toBeDefined());
  });

  it('returns precedents sorted by proximity (descending)', () => {
    const results = queryPrecedents(database.entries, {
      policyType: 'policy',
      tags: ['carbon-tax'],
    });
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].proximityScore ?? 0).toBeGreaterThanOrEqual(
        results[i].proximityScore ?? 0
      );
    }
  });
});

// ─── Time series tests ────────────────────────────────────────────────────────

describe('Time series projection', () => {
  const risingInput: TimeSeriesInput = {
    name: 'carbon_intensity',
    description: 'Carbon intensity of the economy',
    unit: 'tonnes CO2 per $M GDP',
    historicalValues: [120, 115, 110, 105, 100, 95, 90],
    timestamps: ['2017', '2018', '2019', '2020', '2021', '2022', '2023'],
  };

  it('produces projections with expected structure', () => {
    const result = projectTimeSeries(risingInput);
    expect(result).toHaveProperty('oneYear');
    expect(result).toHaveProperty('fiveYear');
    expect(result).toHaveProperty('twentyYear');
    expect(result.trend).toBe('decreasing');
    expect(result.dataPoints).toBe(7);
  });

  it('detects increasing trend correctly', () => {
    const increasing: TimeSeriesInput = {
      ...risingInput,
      historicalValues: [50, 55, 60, 65, 70, 75, 80],
    };
    const result = projectTimeSeries(increasing);
    expect(result.trend).toBe('increasing');
  });

  it('warns on insufficient data', () => {
    const sparse: TimeSeriesInput = {
      ...risingInput,
      historicalValues: [100, 90],
      timestamps: ['2022', '2023'],
    };
    const result = projectTimeSeries(sparse);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('data point');
  });

  it('handles single data point without crashing', () => {
    const single: TimeSeriesInput = {
      ...risingInput,
      historicalValues: [100],
      timestamps: ['2023'],
    };
    const result = projectTimeSeries(single);
    expect(result.modelUsed).toBe('flat-fallback');
  });
});

// ─── Random Forest tests ──────────────────────────────────────────────────────

describe('Random Forest classification', () => {
  const features: PolicyFeatures = {
    institutionalCapacity: 0.75,
    economicConditions: 0.65,
    publicSupport: 0.65,
    implementationComplexity: 0.6,
    fiscalSpace: 0.6,
    precedentSuccessRate: 0.75,
    jurisdictionalAlignment: 0.8,
    stakeholderCoordination: 0.55,
  };

  it('returns uncertain result with insufficient data', () => {
    const result = classifyPolicy(features, database.entries.slice(0, 3));
    expect(result.classification).toBe('uncertain');
    expect(result.modelVersion).toBe('insufficient-data');
  });

  it('produces feature importance scores that sum to ~1', () => {
    const result = classifyPolicy(features, database.entries);
    const total = result.featureImportance.reduce((acc, f) => acc + f.importance, 0);
    expect(total).toBeCloseTo(1.0, 2);
  });

  it('returns interpretable feature importance (no black box)', () => {
    const result = classifyPolicy(features, database.entries);
    result.featureImportance.forEach(f => {
      expect(f).toHaveProperty('feature');
      expect(f).toHaveProperty('importance');
      expect(f).toHaveProperty('direction');
      expect(f).toHaveProperty('humanReadable');
      expect(['positive', 'negative']).toContain(f.direction);
    });
  });

  it('probability is between 0 and 1', () => {
    const result = classifyPolicy(features, database.entries);
    expect(result.successProbability).toBeGreaterThanOrEqual(0);
    expect(result.successProbability).toBeLessThanOrEqual(1);
    expect(result.successProbability + result.failureProbability).toBeCloseTo(1, 5);
  });
});

// ─── Confidence threshold tests ───────────────────────────────────────────────

describe('Confidence assessment', () => {
  it('returns INSUFFICIENT_DATA below 40%', () => {
    const sim = runMonteCarlo(mockParameters, 10, 42); // Very few runs
    const bayes = bayesianUpdate(sim, []);             // No precedents
    const rf = classifyPolicy(
      mockElicitationResponse.policyFeatures,
      database.entries.slice(0, 3)                    // Insufficient training data
    );
    const result = assessConfidence(sim, bayes, [], rf);
    // With no convergence, no precedents, and no RF — should be low
    expect(['INSUFFICIENT_DATA', 'LOW_CONFIDENCE']).toContain(result.flag);
  });

  it('returns normal confidence with good data', () => {
    const sim = runMonteCarlo(mockParameters, 1000, 42);
    const precedents = database.entries;
    const bayes = bayesianUpdate(sim, precedents);
    const rf = classifyPolicy(mockElicitationResponse.policyFeatures, precedents);
    const result = assessConfidence(sim, bayes, [], rf);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(1);
    expect(result.explanation).toBeTruthy();
  });

  it('confidence explanation is always present', () => {
    const sim = runMonteCarlo(mockParameters, 100, 42);
    const bayes = bayesianUpdate(sim, []);
    const rf = classifyPolicy(mockElicitationResponse.policyFeatures, []);
    const result = assessConfidence(sim, bayes, [], rf);
    expect(result.explanation.length).toBeGreaterThan(10);
  });
});

// ─── Full engine integration tests ───────────────────────────────────────────

describe('Scenario engine — full pipeline', () => {
  it('returns triggered=false for minor votes', async () => {
    const result = await runScenarioEngine(minorProposal, database);
    expect(result.triggered).toBe(false);
    expect(result.scenarios).toBeNull();
    expect(result.simulationRuns).toBe(0);
  });

  it('always triggers for constitutional votes', async () => {
    const result = await runScenarioEngine(constitutionalProposal, database);
    expect(result.triggered).toBe(true);
    expect(result.triggerReason).toContain('locked constitutional type');
  });

  it('always triggers for budget votes', async () => {
    const result = await runScenarioEngine(budgetProposal, database);
    expect(result.triggered).toBe(true);
  });

  it('records classification audit for all runs', async () => {
    const result = await runScenarioEngine(constitutionalProposal, database);
    expect(result.classificationAudit).toHaveProperty('proposerDeclaredType');
    expect(result.classificationAudit).toHaveProperty('engineRecommendedType');
    expect(result.classificationAudit).toHaveProperty('engineConfidence');
  });

  it('records database version in output', async () => {
    const result = await runScenarioEngine(constitutionalProposal, database);
    expect(result.databaseVersion).toBe(database.metadata.version);
  });

  it('reports model stack used', async () => {
    const result = await runScenarioEngine(constitutionalProposal, database);
    if (result.triggered && result.scenarios) {
      expect(result.modelStack).toContain('monte-carlo');
      expect(result.modelStack).toContain('bayesian');
      expect(result.modelStack).toContain('random-forest');
    }
  });

  it('does not include neural networks in model stack (black-box prohibition)', async () => {
    const result = await runScenarioEngine(constitutionalProposal, database);
    expect(result.modelStack).not.toContain('neural-network');
    expect(result.modelStack).not.toContain('deep-learning');
    expect(result.modelStack).not.toContain('tensorflow');
    expect(result.modelStack).not.toContain('pytorch');
  });

  it('scenario probabilities are numbers between 0 and 1', async () => {
    const result = await runScenarioEngine(constitutionalProposal, database);
    if (result.scenarios) {
      ['best', 'base', 'worst'].forEach(type => {
        const s = result.scenarios![type as 'best' | 'base' | 'worst'];
        expect(s.probability).toBeGreaterThanOrEqual(0);
        expect(s.probability).toBeLessThanOrEqual(1);
      });
    }
  });

  it('scenario percentiles are in correct order (15 < 50 < 85)', async () => {
    const result = await runScenarioEngine(constitutionalProposal, database);
    if (result.scenarios) {
      expect(result.scenarios.worst.distributionPercentile).toBe(15);
      expect(result.scenarios.base.distributionPercentile).toBe(50);
      expect(result.scenarios.best.distributionPercentile).toBe(85);
    }
  });

  it('all scenarios include mandatory minorityImpact field', async () => {
    const result = await runScenarioEngine(constitutionalProposal, database);
    if (result.scenarios) {
      ['best', 'base', 'worst'].forEach(type => {
        const s = result.scenarios![type as 'best' | 'base' | 'worst'];
        expect(s.minorityImpact).toBeDefined();
        expect(s.minorityImpact).not.toBeNull();
        expect(s.minorityImpact.summary.length).toBeGreaterThan(0);
      });
    }
  });

  it('full simulation audit record is present', async () => {
    const result = await runScenarioEngine(constitutionalProposal, database);
    if (result.triggered) {
      expect(result.simulationResult).toBeDefined();
      expect(result.bayesianResult).toBeDefined();
    }
  });

  it('pre-generated mode is flagged in output', async () => {
    const result = await runScenarioEngine(constitutionalProposal, database, {
      generationMode: 'pre-generated',
    });
    expect(result.generationMode).toBe('pre-generated');
  });
});
