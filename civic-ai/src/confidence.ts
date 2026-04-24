/**
 * Confidence Assessment Module
 * Computes the overall confidence score for a scenario briefing,
 * combining contributions from all three modelling layers.
 *
 * Confidence is defined as: the proportion of simulation variance
 * explained by available evidence, combining:
 *   - Monte Carlo convergence quality
 *   - Bayesian precedent contribution
 *   - Time series data availability
 *
 * Thresholds per spec:
 *   >= 0.60 → normal
 *   0.40–0.59 → LOW_CONFIDENCE (panel must approve with written justification)
 *   < 0.40 → INSUFFICIENT_DATA (briefing not published)
 */

import type { SimulationResult } from './monte-carlo.js';
import type { BayesianUpdateResult } from './bayesian.js';
import type { TimeSeriesProjection } from './time-series.js';
import type { ClassificationResult } from './random-forest.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConfidenceFlag = 'normal' | 'LOW_CONFIDENCE' | 'INSUFFICIENT_DATA';

export interface ConfidenceBreakdown {
  monteCarloContribution: number;       // 0.0–1.0
  bayesianContribution: number;         // 0.0–1.0
  timeSeriesContribution: number;       // 0.0–1.0
  classifierContribution: number;       // 0.0–1.0
  overallScore: number;                 // 0.0–1.0 weighted combination
  flag: ConfidenceFlag;
  explanation: string;                  // Plain-language explanation for citizens
  warnings: string[];                   // Any specific data quality issues
}

// ─── Component confidence calculators ────────────────────────────────────────

/**
 * Monte Carlo contribution: based on convergence and CI width.
 * A simulation that converged early with a narrow CI contributes more.
 */
function monteCarloConfidence(sim: SimulationResult): number {
  // Convergence bonus: converged simulations are more trustworthy
  const convergenceScore = sim.converged ? 0.8 : 0.5;

  // CI width penalty: narrower CI = more certainty
  const [low, high] = sim.confidenceInterval95;
  const ciWidth = high - low;
  // A CI width of 0.1 (10%) or less is excellent; 0.5 (50%) is poor
  const ciScore = Math.max(0, 1 - ciWidth / 0.5);

  // Run count: more runs up to 1000 increases confidence
  const runScore = Math.min(1, sim.runs / 1000);

  return convergenceScore * 0.4 + ciScore * 0.4 + runScore * 0.2;
}

/**
 * Bayesian contribution: based on number and quality of precedents.
 * More matching precedents with higher proximity = more confident update.
 */
function bayesianConfidence(bayesian: BayesianUpdateResult): number {
  return bayesian.confidenceContribution;
}

/**
 * Time series contribution: based on data availability and model fit.
 * Good historical data with strong trend = more confident projection.
 */
function timeSeriesConfidence(projections: TimeSeriesProjection[]): number {
  if (projections.length === 0) return 0;

  const scores = projections.map(p => {
    const dataScore = Math.min(1, p.dataPoints / 20); // 20+ points = full score
    const fitScore = p.confidence;
    const warningPenalty = p.warnings.length * 0.1;
    return Math.max(0, (dataScore * 0.5 + fitScore * 0.5) - warningPenalty);
  });

  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/**
 * Random Forest contribution: based on training data size and prediction confidence.
 */
function classifierConfidence(classification: ClassificationResult): number {
  if (classification.modelVersion === 'insufficient-data') return 0;
  const trainingScore = Math.min(1, classification.trainingExamples / 50);
  return trainingScore * 0.5 + classification.confidence * 0.5;
}

// ─── Plain-language explanation ───────────────────────────────────────────────

function buildExplanation(
  score: number,
  flag: ConfidenceFlag,
  precedentsUsed: number,
  simulationRuns: number
): string {
  const pct = Math.round(score * 100);

  if (flag === 'INSUFFICIENT_DATA') {
    return (
      `Confidence score: ${pct}%. The scenario engine does not have sufficient historical ` +
      `data to produce a reliable prediction for this proposal type. Only ${precedentsUsed} ` +
      `comparable precedent(s) were found. The oversight panel must decide whether to proceed ` +
      `with a manual expert analysis or delay the vote pending data enrichment.`
    );
  }

  if (flag === 'LOW_CONFIDENCE') {
    return (
      `Confidence score: ${pct}% (low). This briefing is based on ${simulationRuns} simulations ` +
      `and ${precedentsUsed} historical precedent(s). The confidence level is below the standard ` +
      `threshold. The oversight panel has reviewed and approved this briefing with written ` +
      `justification. Treat probability estimates with additional caution.`
    );
  }

  return (
    `Confidence score: ${pct}%. Based on ${simulationRuns} simulations and ` +
    `${precedentsUsed} historical precedent(s). The model has sufficient data to ` +
    `produce a reliable probability distribution for this proposal type.`
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function assessConfidence(
  simulation: SimulationResult,
  bayesian: BayesianUpdateResult,
  projections: TimeSeriesProjection[],
  classification: ClassificationResult
): ConfidenceBreakdown {
  const warnings: string[] = [];

  const mcScore = monteCarloConfidence(simulation);
  const bayScore = bayesianConfidence(bayesian);
  const tsScore = timeSeriesConfidence(projections);
  const rfScore = classifierConfidence(classification);

  // Weighted combination — Bayesian and Monte Carlo carry most weight
  // as they are the primary evidence sources
  const overall =
    mcScore * 0.35 +
    bayScore * 0.35 +
    tsScore * 0.15 +
    rfScore * 0.15;

  // Apply flag thresholds per spec
  let flag: ConfidenceFlag;
  if (overall >= 0.60) flag = 'normal';
  else if (overall >= 0.40) flag = 'LOW_CONFIDENCE';
  else flag = 'INSUFFICIENT_DATA';

  // Collect warnings
  if (!simulation.converged) {
    warnings.push(`Monte Carlo simulation did not converge within ${simulation.maxRuns} runs.`);
  }
  if (bayesian.precedentsUsed === 0) {
    warnings.push('No historical precedents found — Bayesian update not applied.');
  }
  if (bayesian.precedentsUsed > 0 && bayesian.precedentsUsed < 5) {
    warnings.push(`Only ${bayesian.precedentsUsed} historical precedent(s) found — Bayesian update has limited reliability.`);
  }
  if (projections.length > 0) {
    projections.forEach(p => warnings.push(...p.warnings));
  }
  if (classification.modelVersion === 'insufficient-data') {
    warnings.push('Random Forest classifier not trained — insufficient precedent data.');
  }

  return {
    monteCarloContribution: mcScore,
    bayesianContribution: bayScore,
    timeSeriesContribution: tsScore,
    classifierContribution: rfScore,
    overallScore: overall,
    flag,
    explanation: buildExplanation(
      overall,
      flag,
      bayesian.precedentsUsed,
      simulation.runs
    ),
    warnings,
  };
}
