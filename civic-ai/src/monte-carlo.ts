/**
 * Monte Carlo Simulation Engine
 * Runs N stochastic simulations over input parameter distributions
 * to produce a full probability distribution of policy outcomes.
 *
 * Pure TypeScript — no external dependencies.
 * Interpretable by design: every parameter, sample, and outcome is logged.
 */

export interface Parameter {
  name: string;
  description: string;
  mean: number;       // Central estimate, normalised 0.0–1.0
  stdDev: number;     // Uncertainty spread
  min: number;        // Hard floor (clamped)
  max: number;        // Hard ceiling (clamped)
  weight: number;     // Contribution weight to outcome score (sum of weights = 1.0)
}

export interface RunRecord {
  run: number;
  sampledValues: Record<string, number>;
  outcomeScore: number;
}

export interface SimulationResult {
  runs: number;                          // Actual runs completed
  maxRuns: number;                       // Configured maximum
  converged: boolean;
  convergenceRun: number;                // Run at which convergence was detected
  outcomes: number[];                    // Raw outcome score per run
  mean: number;
  median: number;
  stdDev: number;
  percentile15: number;                  // Worst-scenario anchor
  percentile50: number;                  // Base-scenario anchor
  percentile85: number;                  // Best-scenario anchor
  confidenceInterval95: [number, number];
  runRecords: RunRecord[];               // Full audit log — every run
}

// ─── Math utilities ──────────────────────────────────────────────────────────

/**
 * Box-Muller transform: generates a standard normal sample from two uniform
 * random values. Deterministic given a seed for reproducibility.
 */
function boxMuller(u1: number, u2: number): number {
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[], m: number): number {
  const variance = values.reduce((acc, v) => acc + Math.pow(v - m, 2), 0) / values.length;
  return Math.sqrt(variance);
}

// ─── Seeded PRNG (Mulberry32) ─────────────────────────────────────────────────
// Reproducible runs for audit and testing.

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Core simulation ──────────────────────────────────────────────────────────

/**
 * Sample a value from a parameter's normal distribution, clamped to [min, max].
 */
function sampleParameter(param: Parameter, rand: () => number): number {
  const u1 = Math.max(1e-10, rand()); // avoid log(0)
  const u2 = rand();
  const z = boxMuller(u1, u2);
  const sampled = param.mean + z * param.stdDev;
  return clamp(sampled, param.min, param.max);
}

/**
 * Compute a weighted linear outcome score from sampled parameter values.
 * Score is normalised to 0.0–1.0.
 * Weights must sum to 1.0 (enforced at call site via normaliseWeights).
 */
function computeOutcome(
  params: Parameter[],
  sampledValues: Record<string, number>
): number {
  let score = 0;
  for (const param of params) {
    score += sampledValues[param.name] * param.weight;
  }
  return clamp(score, 0, 1);
}

/**
 * Normalise parameter weights so they sum to 1.0.
 * This ensures the outcome score stays in [0, 1] regardless of how many
 * parameters are passed in.
 */
export function normaliseWeights(params: Parameter[]): Parameter[] {
  const total = params.reduce((acc, p) => acc + p.weight, 0);
  if (total === 0) throw new Error('Parameter weights sum to zero — cannot normalise.');
  return params.map(p => ({ ...p, weight: p.weight / total }));
}

/**
 * Convergence check: the simulation has stabilised when the 95% CI width
 * stops changing meaningfully over the last `windowSize` runs.
 *
 * Threshold: <0.5% relative change (matching spec).
 */
function hasConverged(
  outcomes: number[],
  windowSize: number = 50,
  threshold: number = 0.005
): boolean {
  if (outcomes.length < windowSize * 2) return false;

  const recent = outcomes.slice(-windowSize);
  const prior = outcomes.slice(-windowSize * 2, -windowSize);

  const recentMean = mean(recent);
  const priorMean = mean(prior);

  if (priorMean === 0) return false;
  return Math.abs(recentMean - priorMean) / priorMean < threshold;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the Monte Carlo simulation.
 *
 * @param parameters  Input parameters with distributions and weights.
 *                    Weights are normalised internally.
 * @param maxRuns     Maximum simulations (default 1,000 per spec).
 * @param seed        Optional seed for reproducible runs (audit use).
 */
export function runMonteCarlo(
  parameters: Parameter[],
  maxRuns: number = 1000,
  seed?: number
): SimulationResult {
  const params = normaliseWeights(parameters);
  const rand = mulberry32(seed ?? Math.floor(Math.random() * 2 ** 32));

  const outcomes: number[] = [];
  const runRecords: RunRecord[] = [];
  let convergenceRun = maxRuns;
  let converged = false;

  for (let i = 0; i < maxRuns; i++) {
    const sampledValues: Record<string, number> = {};
    for (const param of params) {
      sampledValues[param.name] = sampleParameter(param, rand);
    }

    const outcomeScore = computeOutcome(params, sampledValues);
    outcomes.push(outcomeScore);
    runRecords.push({ run: i + 1, sampledValues, outcomeScore });

    // Check convergence after the first 100 runs (need enough data)
    if (i >= 99 && hasConverged(outcomes)) {
      convergenceRun = i + 1;
      converged = true;
      break;
    }
  }

  const sorted = [...outcomes].sort((a, b) => a - b);
  const m = mean(outcomes);
  const sd = stdDev(outcomes, m);

  // 95% confidence interval using normal approximation
  const se = sd / Math.sqrt(outcomes.length);
  const ci95: [number, number] = [
    clamp(m - 1.96 * se, 0, 1),
    clamp(m + 1.96 * se, 0, 1),
  ];

  return {
    runs: outcomes.length,
    maxRuns,
    converged,
    convergenceRun,
    outcomes,
    mean: m,
    median: percentile(sorted, 50),
    stdDev: sd,
    percentile15: percentile(sorted, 15),
    percentile50: percentile(sorted, 50),
    percentile85: percentile(sorted, 85),
    confidenceInterval95: ci95,
    runRecords,
  };
}
