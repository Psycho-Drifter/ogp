/**
 * Bayesian Inference Layer
 * Updates the Monte Carlo prior distribution using historical policy precedents.
 * Anchors predictions in evidence rather than parameter assumptions alone.
 *
 * Pure TypeScript — no external dependencies.
 * All posterior calculations are logged for citizen/auditor inspection.
 */

import type { SimulationResult } from './monte-carlo.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HistoricalPrecedent {
  id: string;
  policyType: string;               // Must match VoteType enum or sub-category
  title: string;
  description: string;
  jurisdiction: string;             // ISO 3166-1 alpha-3 country code or 'GLOBAL'
  year: number;
  outcomeScore: number;             // 0.0–1.0 normalised outcome (1.0 = full success)
  outcomeNarrative: string;         // Plain-language description of what happened
  tags: string[];                   // Searchable feature tags
  source: string;                   // Data provenance (e.g. "World Bank WDI 2023")
  proximityScore?: number;          // Computed at query time — not stored
}

export interface PrecedentQuery {
  policyType: string;
  tags: string[];
  jurisdiction?: string;
  yearFrom?: number;                // Recency filter
  maxResults?: number;
}

export interface BayesianUpdateResult {
  prior: {
    mean: number;
    variance: number;
  };
  posterior: {
    mean: number;
    variance: number;
    stdDev: number;
    percentile15: number;
    percentile50: number;
    percentile85: number;
  };
  precedentsUsed: number;
  precedentIds: string[];           // Full audit trail — which precedents influenced this
  posteriorShift: number;           // How much the update moved the mean (0.0–1.0)
  confidenceContribution: number;   // This layer's contribution to overall confidence (0.0–1.0)
}

// ─── Proximity scoring ────────────────────────────────────────────────────────

/**
 * Compute how similar a historical precedent is to the current query.
 * Returns 0.0–1.0 where 1.0 = perfect match.
 *
 * Factors:
 *  - Policy type match (0 or 1)
 *  - Tag overlap (Jaccard similarity)
 *  - Recency (exponential decay, half-life = 20 years)
 *  - Jurisdiction proximity (same country > same region > global)
 */
function computeProximity(
  precedent: HistoricalPrecedent,
  query: PrecedentQuery,
  currentYear: number = new Date().getFullYear()
): number {
  // Policy type match
  const typeMatch = precedent.policyType === query.policyType ? 1.0 : 0.3;

  // Tag overlap — Jaccard similarity
  const qTags = new Set(query.tags.map(t => t.toLowerCase()));
  const pTags = new Set(precedent.tags.map(t => t.toLowerCase()));
  const intersection = [...qTags].filter(t => pTags.has(t)).length;
  const union = new Set([...qTags, ...pTags]).size;
  const tagSimilarity = union > 0 ? intersection / union : 0;

  // Recency — exponential decay with 20-year half-life
  const age = currentYear - precedent.year;
  const recency = Math.exp(-age * Math.LN2 / 20);

  // Jurisdiction proximity
  let jurisdictionScore = 0.5; // default: different country
  if (query.jurisdiction) {
    if (precedent.jurisdiction === query.jurisdiction) {
      jurisdictionScore = 1.0;
    } else if (precedent.jurisdiction === 'GLOBAL') {
      jurisdictionScore = 0.7;
    }
  }

  // Weighted combination
  return (
    typeMatch * 0.35 +
    tagSimilarity * 0.30 +
    recency * 0.20 +
    jurisdictionScore * 0.15
  );
}

// ─── Precedent querying ───────────────────────────────────────────────────────

/**
 * Query the policy database for relevant historical precedents.
 * Returns top N results sorted by proximity score (descending).
 */
export function queryPrecedents(
  database: HistoricalPrecedent[],
  query: PrecedentQuery
): HistoricalPrecedent[] {
  const maxResults = query.maxResults ?? 20;
  const yearFrom = query.yearFrom ?? 0;

  const scored = database
    .filter(p => p.year >= yearFrom)
    .map(p => ({
      ...p,
      proximityScore: computeProximity(p, query),
    }))
    .filter(p => (p.proximityScore ?? 0) > 0.1) // discard very distant matches
    .sort((a, b) => (b.proximityScore ?? 0) - (a.proximityScore ?? 0))
    .slice(0, maxResults);

  return scored;
}

// ─── Bayesian update ──────────────────────────────────────────────────────────

/**
 * Update the Monte Carlo prior distribution using historical precedents.
 *
 * Uses Bayesian conjugate update for a Normal-Normal model:
 *   - Prior: N(μ₀, σ₀²) from Monte Carlo mean and variance
 *   - Likelihood: N(μ_data, σ_data²) from historical outcome scores
 *   - Posterior: N(μ_post, σ_post²) via conjugate formula
 *
 * Precedent weights are proportional to their proximity scores,
 * so closer matches have more influence on the posterior.
 */
export function bayesianUpdate(
  simulation: SimulationResult,
  precedents: HistoricalPrecedent[]
): BayesianUpdateResult {
  const priorMean = simulation.mean;
  const priorVariance = Math.pow(simulation.stdDev, 2);

  if (precedents.length === 0) {
    // No precedents: posterior = prior; confidence contribution is zero
    return {
      prior: { mean: priorMean, variance: priorVariance },
      posterior: {
        mean: priorMean,
        variance: priorVariance,
        stdDev: simulation.stdDev,
        percentile15: simulation.percentile15,
        percentile50: simulation.percentile50,
        percentile85: simulation.percentile85,
      },
      precedentsUsed: 0,
      precedentIds: [],
      posteriorShift: 0,
      confidenceContribution: 0,
    };
  }

  // Weighted data mean and variance from precedents
  const totalWeight = precedents.reduce((acc, p) => acc + (p.proximityScore ?? 1), 0);

  const dataMean = precedents.reduce(
    (acc, p) => acc + p.outcomeScore * (p.proximityScore ?? 1),
    0
  ) / totalWeight;

  const dataVariance = precedents.reduce(
    (acc, p) => acc + Math.pow(p.outcomeScore - dataMean, 2) * (p.proximityScore ?? 1),
    0
  ) / totalWeight;

  // Conjugate Normal-Normal update
  // Posterior precision = prior precision + data precision
  const priorPrecision = 1 / (priorVariance || 1e-6);
  const dataPrecision = precedents.length / (dataVariance || 1e-6);
  const posteriorPrecision = priorPrecision + dataPrecision;
  const posteriorVariance = 1 / posteriorPrecision;

  const posteriorMean =
    posteriorVariance * (priorPrecision * priorMean + dataPrecision * dataMean);

  const posteriorStdDev = Math.sqrt(posteriorVariance);

  // Recompute percentiles from posterior normal distribution
  // Using normal quantile approximation (Beasley-Springer-Moro)
  function normalQuantile(mean: number, sd: number, p: number): number {
    // Simple rational approximation for quantiles
    const a = [2.50662823884, -18.61500062529, 41.39119773534, -25.44106049637];
    const b = [-8.47351093090, 23.08336743743, -21.06224101826, 3.13082909833];
    const c = [0.3374754822726147, 0.9761690190917186, 0.1607979714918209,
               0.0276438810333863, 0.0038405729373609, 0.0003951896511349,
               0.0000321767881768, 0.0000002888167364, 0.0000003960315187];
    const r = p - 0.5;
    let x: number;
    if (Math.abs(r) < 0.42) {
      const r2 = r * r;
      x = r * (((a[3]*r2+a[2])*r2+a[1])*r2+a[0]) /
              ((((b[3]*r2+b[2])*r2+b[1])*r2+b[0])*r2+1);
    } else {
      const rr = r > 0 ? Math.log(-Math.log(1 - p)) : Math.log(-Math.log(p));
      x = c[0]+rr*(c[1]+rr*(c[2]+rr*(c[3]+rr*(c[4]+rr*(c[5]+rr*(c[6]+rr*(c[7]+rr*c[8])))))));
      if (r < 0) x = -x;
    }
    return mean + sd * x;
  }

  const posteriorShift = Math.abs(posteriorMean - priorMean);

  // Confidence contribution: more precedents and higher proximity = higher contribution
  // Saturates toward 1.0 asymptotically with N precedents
  const effectivePrecedents = totalWeight; // weighted count
  const confidenceContribution = Math.min(0.4, effectivePrecedents / (effectivePrecedents + 10) * 0.4);

  return {
    prior: { mean: priorMean, variance: priorVariance },
    posterior: {
      mean: posteriorMean,
      variance: posteriorVariance,
      stdDev: posteriorStdDev,
      percentile15: Math.max(0, normalQuantile(posteriorMean, posteriorStdDev, 0.15)),
      percentile50: Math.max(0, normalQuantile(posteriorMean, posteriorStdDev, 0.50)),
      percentile85: Math.min(1, normalQuantile(posteriorMean, posteriorStdDev, 0.85)),
    },
    precedentsUsed: precedents.length,
    precedentIds: precedents.map(p => p.id),
    posteriorShift,
    confidenceContribution,
  };
}
