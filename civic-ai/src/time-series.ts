/**
 * Time Series Projection Module
 * Generates quantitative projections for economic, demographic, and fiscal parameters.
 *
 * Initial implementation: linear trend with exponential smoothing.
 * Production upgrade path: swap internals to ARIMA or Prophet
 * without changing the public interface.
 *
 * Pure TypeScript — no external dependencies.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TimeSeriesInput {
  name: string;
  description: string;
  unit: string;                     // e.g. "% GDP", "thousands of people", "index 0–100"
  historicalValues: number[];       // Chronological — oldest first
  timestamps: string[];             // ISO date strings, same length as historicalValues
  seasonalPeriod?: number;          // e.g. 4 for quarterly, 12 for monthly (optional)
}

export interface TimeSeriesProjection {
  name: string;
  unit: string;
  trend: 'increasing' | 'decreasing' | 'stable';
  trendStrength: number;            // 0.0–1.0 — how pronounced the trend is
  oneYear: ProjectedValue;
  fiveYear: ProjectedValue;
  twentyYear: ProjectedValue;
  modelUsed: string;                // For audit — what algorithm produced this
  confidence: number;               // 0.0–1.0 — R² of the trend fit
  dataPoints: number;               // How many historical values were available
  warnings: string[];               // e.g. "Only 3 data points — low confidence"
}

export interface ProjectedValue {
  point: number;                    // Point estimate
  low: number;                      // Lower bound (80% prediction interval)
  high: number;                     // Upper bound (80% prediction interval)
}

// ─── Simple linear regression ─────────────────────────────────────────────────

interface LinearModel {
  slope: number;
  intercept: number;
  rSquared: number;
  residualStdDev: number;
}

function fitLinearTrend(values: number[]): LinearModel {
  const n = values.length;
  const xs = values.map((_, i) => i);

  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;

  const ssXX = xs.reduce((acc, x) => acc + Math.pow(x - meanX, 2), 0);
  const ssXY = xs.reduce((acc, x, i) => acc + (x - meanX) * (values[i] - meanY), 0);

  const slope = ssXX > 0 ? ssXY / ssXX : 0;
  const intercept = meanY - slope * meanX;

  // R² — proportion of variance explained by the linear trend
  const predictions = xs.map(x => slope * x + intercept);
  const ssRes = values.reduce((acc, y, i) => acc + Math.pow(y - predictions[i], 2), 0);
  const ssTot = values.reduce((acc, y) => acc + Math.pow(y - meanY, 2), 0);
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  // Residual standard deviation for prediction intervals
  const residuals = values.map((y, i) => y - predictions[i]);
  const residualVariance = residuals.reduce((acc, r) => acc + r * r, 0) / Math.max(n - 2, 1);
  const residualStdDev = Math.sqrt(residualVariance);

  return { slope, intercept, rSquared, residualStdDev };
}

// ─── Exponential smoothing ────────────────────────────────────────────────────

/**
 * Double exponential smoothing (Holt's method) for data with trend but no seasonality.
 * α controls level smoothing, β controls trend smoothing.
 */
function holtSmoothing(
  values: number[],
  alpha: number = 0.3,
  beta: number = 0.1
): { level: number; trend: number } {
  if (values.length < 2) {
    return { level: values[0] ?? 0, trend: 0 };
  }

  let level = values[0];
  let trend = values[1] - values[0];

  for (let i = 1; i < values.length; i++) {
    const prevLevel = level;
    level = alpha * values[i] + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }

  return { level, trend };
}

// ─── Projection ───────────────────────────────────────────────────────────────

/**
 * Project a value N steps (years) forward.
 * Uses Holt's smoothing for the point estimate and linear regression
 * residuals for prediction intervals.
 */
function project(
  holt: { level: number; trend: number },
  model: LinearModel,
  stepsForward: number,
  dataPoints: number,
  z: number = 1.282 // 80% prediction interval
): ProjectedValue {
  const point = holt.level + holt.trend * stepsForward;

  // Wider intervals for longer horizons and fewer data points
  const horizonFactor = Math.sqrt(stepsForward);
  const dataPenalty = Math.sqrt(Math.max(1, 10 - dataPoints)); // penalise thin data
  const intervalWidth = z * model.residualStdDev * horizonFactor * dataPenalty;

  return {
    point,
    low: point - intervalWidth,
    high: point + intervalWidth,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Project a time series 1, 5, and 20 years forward.
 * Returns structured projections with confidence and audit metadata.
 */
export function projectTimeSeries(input: TimeSeriesInput): TimeSeriesProjection {
  const warnings: string[] = [];
  const values = input.historicalValues;

  if (values.length === 0) {
    throw new Error(`Time series "${input.name}" has no historical values.`);
  }

  if (values.length < 5) {
    warnings.push(
      `Only ${values.length} data point(s) available — projections have low confidence.`
    );
  }

  if (values.length < 2) {
    // Cannot project with a single point — return flat line
    const flat: ProjectedValue = { point: values[0], low: values[0] * 0.8, high: values[0] * 1.2 };
    return {
      name: input.name,
      unit: input.unit,
      trend: 'stable',
      trendStrength: 0,
      oneYear: flat,
      fiveYear: flat,
      twentyYear: flat,
      modelUsed: 'flat-fallback',
      confidence: 0,
      dataPoints: values.length,
      warnings,
    };
  }

  const model = fitLinearTrend(values);
  const holt = holtSmoothing(values);

  // Trend classification
  const normalised = holt.trend / (Math.abs(holt.level) || 1);
  let trend: 'increasing' | 'decreasing' | 'stable';
  if (normalised > 0.02) trend = 'increasing';
  else if (normalised < -0.02) trend = 'decreasing';
  else trend = 'stable';

  const trendStrength = Math.min(1, Math.abs(normalised) * 10);

  // Warn on poor fit
  if (model.rSquared < 0.3 && values.length >= 5) {
    warnings.push(
      `Low R² (${model.rSquared.toFixed(2)}) — historical trend is not strongly linear. ` +
      `Projections should be treated with caution.`
    );
  }

  return {
    name: input.name,
    unit: input.unit,
    trend,
    trendStrength,
    oneYear: project(holt, model, 1, values.length),
    fiveYear: project(holt, model, 5, values.length),
    twentyYear: project(holt, model, 20, values.length),
    modelUsed: 'holt-double-exponential-smoothing',
    confidence: Math.max(0, Math.min(1, model.rSquared)),
    dataPoints: values.length,
    warnings,
  };
}

/**
 * Convert time series projections into Monte Carlo parameters.
 * Allows quantitative projections to constrain the simulation inputs.
 */
export function projectionsToParameters(
  projections: TimeSeriesProjection[]
): Array<{ name: string; mean: number; stdDev: number; min: number; max: number }> {
  return projections.map(proj => {
    const base = proj.oneYear; // Use 1-year projection as MC parameter anchor
    const range = base.high - base.low;
    const normalisedMean = Math.max(0, Math.min(1, base.point / 100)); // crude 0–100 → 0–1
    const normalisedStdDev = Math.max(0.01, range / 200);

    return {
      name: proj.name,
      mean: normalisedMean,
      stdDev: normalisedStdDev,
      min: Math.max(0, normalisedMean - normalisedStdDev * 3),
      max: Math.min(1, normalisedMean + normalisedStdDev * 3),
    };
  });
}
