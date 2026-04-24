/**
 * Random Forest Classifier
 * Classifies policy proposals as likely to succeed or fail,
 * and produces interpretable feature importance scores.
 *
 * Uses ml-random-forest from the ml.js ecosystem.
 * Explicitly chosen over neural networks for interpretability:
 * every prediction can be explained via feature importance.
 * See SCENARIO-ENGINE-SPEC.md — Black-box model prohibition.
 *
 * Requires: npm install ml-random-forest
 */

import { RandomForestClassifier } from 'ml-random-forest';
import type { HistoricalPrecedent } from './bayesian.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PolicyFeatures {
  // All values normalised 0.0–1.0
  institutionalCapacity: number;      // Strength of implementing institutions
  economicConditions: number;         // Current economic environment
  publicSupport: number;              // Estimated public support for the policy
  implementationComplexity: number;   // Inverse of complexity (1.0 = simple)
  fiscalSpace: number;                // Available fiscal room
  precedentSuccessRate: number;       // From Bayesian layer — historical success rate
  jurisdictionalAlignment: number;    // Constitutional/legal fit
  stakeholderCoordination: number;    // Inter-agency / cross-sector coordination needed
}

export type FeatureKey = keyof PolicyFeatures;

export const FEATURE_NAMES: FeatureKey[] = [
  'institutionalCapacity',
  'economicConditions',
  'publicSupport',
  'implementationComplexity',
  'fiscalSpace',
  'precedentSuccessRate',
  'jurisdictionalAlignment',
  'stakeholderCoordination',
];

export interface FeatureImportance {
  feature: string;
  importance: number;           // 0.0–1.0 relative weight (sum = 1.0)
  direction: 'positive' | 'negative'; // Does higher value help or hurt success?
  humanReadable: string;        // Plain-language explanation for citizens
}

export interface ClassificationResult {
  successProbability: number;   // 0.0–1.0
  failureProbability: number;   // 1 - successProbability
  classification: 'likely_success' | 'uncertain' | 'likely_failure';
  confidence: number;           // 0.0–1.0 — model certainty
  featureImportance: FeatureImportance[];
  modelVersion: string;
  trainingExamples: number;     // How many precedents the model was trained on
}

// ─── Feature importance directions ───────────────────────────────────────────
// Known a priori for interpretability — these are not learned, they are constitutional.

const FEATURE_DIRECTIONS: Record<FeatureKey, 'positive' | 'negative'> = {
  institutionalCapacity: 'positive',
  economicConditions: 'positive',
  publicSupport: 'positive',
  implementationComplexity: 'negative',  // Higher complexity → worse outcomes
  fiscalSpace: 'positive',
  precedentSuccessRate: 'positive',
  jurisdictionalAlignment: 'positive',
  stakeholderCoordination: 'negative',   // Higher coordination need → worse outcomes
};

const FEATURE_DESCRIPTIONS: Record<FeatureKey, string> = {
  institutionalCapacity:
    'Strength of the institutions responsible for implementing this policy.',
  economicConditions:
    'Current economic environment — better conditions improve success probability.',
  publicSupport:
    'Estimated level of public support for this proposal.',
  implementationComplexity:
    'Complexity of implementation — simpler policies tend to succeed at higher rates.',
  fiscalSpace:
    'Available fiscal room to absorb costs without destabilising public finances.',
  precedentSuccessRate:
    'Historical success rate of similar policies in comparable jurisdictions.',
  jurisdictionalAlignment:
    'How well the proposal fits within existing constitutional and legal frameworks.',
  stakeholderCoordination:
    'Degree of cross-sector coordination required — higher need increases failure risk.',
};

// ─── Training data conversion ─────────────────────────────────────────────────

/**
 * Convert historical precedents to Random Forest training format.
 * Each precedent provides a feature vector and a binary success label.
 * Success threshold: outcomeScore >= 0.5.
 */
export function precedentsToTrainingData(
  precedents: HistoricalPrecedent[]
): { features: number[][]; labels: number[] } {
  const features: number[][] = [];
  const labels: number[] = [];

  for (const p of precedents) {
    // Extract features from precedent metadata where available,
    // otherwise use the outcomeScore as a proxy for all features.
    // Production: precedents should carry explicit feature vectors.
    const outcomeProxy = p.outcomeScore;
    const featureVector: number[] = [
      p.outcomeScore,                                    // institutionalCapacity proxy
      outcomeProxy * 0.9 + Math.random() * 0.1,         // economicConditions (with noise)
      outcomeProxy * 0.8 + Math.random() * 0.2,         // publicSupport
      1 - (outcomeProxy * 0.7 + Math.random() * 0.3),   // implementationComplexity (inverted)
      outcomeProxy * 0.85 + Math.random() * 0.15,       // fiscalSpace
      p.outcomeScore,                                    // precedentSuccessRate = outcome
      outcomeProxy * 0.9 + Math.random() * 0.1,         // jurisdictionalAlignment
      1 - (outcomeProxy * 0.6 + Math.random() * 0.4),   // stakeholderCoordination (inverted)
    ];
    features.push(featureVector);
    labels.push(p.outcomeScore >= 0.5 ? 1 : 0);
  }

  return { features, labels };
}

/**
 * Convert a PolicyFeatures object to the numeric feature vector expected by the model.
 */
export function featuresToVector(features: PolicyFeatures): number[] {
  return FEATURE_NAMES.map(key => features[key]);
}

// ─── Model management ─────────────────────────────────────────────────────────

interface TrainedModel {
  classifier: RandomForestClassifier;
  trainingExamples: number;
  version: string;
}

let cachedModel: TrainedModel | null = null;

/**
 * Train the Random Forest classifier on historical precedents.
 * Results are cached in memory — call retrain() when the database updates.
 *
 * ml-random-forest options:
 *   - nEstimators: number of trees (more = more stable, more compute)
 *   - maxDepth: depth limit prevents overfitting on small datasets
 *   - replacement: sampling with replacement (standard bagging)
 */
export function trainClassifier(
  precedents: HistoricalPrecedent[],
  options: { nEstimators?: number; maxDepth?: number } = {}
): TrainedModel {
  if (precedents.length < 10) {
    throw new Error(
      `Insufficient training data: ${precedents.length} precedents. Minimum 10 required.`
    );
  }

  const { features, labels } = precedentsToTrainingData(precedents);

  const classifier = new RandomForestClassifier({
    nEstimators: options.nEstimators ?? 100,
    maxDepth: options.maxDepth ?? 10,
    replacement: true,
    useSampleBagging: true,
  });

  classifier.train(features, labels);

  cachedModel = {
    classifier,
    trainingExamples: precedents.length,
    version: `rf-v1-n${precedents.length}-${Date.now()}`,
  };

  return cachedModel;
}

export function getOrTrainClassifier(precedents: HistoricalPrecedent[]): TrainedModel {
  if (cachedModel) return cachedModel;
  return trainClassifier(precedents);
}

export function retrainClassifier(precedents: HistoricalPrecedent[]): TrainedModel {
  cachedModel = null;
  return trainClassifier(precedents);
}

// ─── Feature importance calculation ──────────────────────────────────────────

/**
 * Compute feature importance via permutation:
 * How much does model accuracy drop when each feature is shuffled?
 * More drop = more important.
 *
 * Falls back to equal-weight importance if training data is insufficient.
 */
function computeFeatureImportance(
  classifier: RandomForestClassifier,
  features: number[][],
  labels: number[]
): number[] {
  if (features.length === 0) {
    // Equal weights fallback
    return FEATURE_NAMES.map(() => 1 / FEATURE_NAMES.length);
  }

  // Baseline accuracy
  const baseline = features.filter((f, i) => classifier.predict([f])[0] === labels[i]).length / features.length;

  const importances: number[] = [];

  for (let fi = 0; fi < FEATURE_NAMES.length; fi++) {
    // Permute feature fi
    const permuted = features.map(row => {
      const copy = [...row];
      copy[fi] = features[Math.floor(Math.random() * features.length)][fi];
      return copy;
    });

    const permutedAccuracy = permuted.filter(
      (f, i) => classifier.predict([f])[0] === labels[i]
    ).length / permuted.length;

    // Importance = accuracy drop when feature is shuffled
    importances.push(Math.max(0, baseline - permutedAccuracy));
  }

  // Normalise to sum = 1.0
  const total = importances.reduce((a, b) => a + b, 0) || 1;
  return importances.map(v => v / total);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify a policy proposal and return success probability
 * with interpretable feature importance scores.
 */
export function classifyPolicy(
  features: PolicyFeatures,
  precedents: HistoricalPrecedent[]
): ClassificationResult {
  if (precedents.length < 10) {
    // Not enough data to train — return uncertain result with equal importances
    const equalImportance = 1 / FEATURE_NAMES.length;
    return {
      successProbability: 0.5,
      failureProbability: 0.5,
      classification: 'uncertain',
      confidence: 0,
      featureImportance: FEATURE_NAMES.map(key => ({
        feature: key,
        importance: equalImportance,
        direction: FEATURE_DIRECTIONS[key],
        humanReadable: FEATURE_DESCRIPTIONS[key],
      })),
      modelVersion: 'insufficient-data',
      trainingExamples: precedents.length,
    };
  }

  const model = getOrTrainClassifier(precedents);
  const featureVector = featuresToVector(features);

  // Get prediction and probability
  const prediction = model.classifier.predict([featureVector])[0];
  const probabilities = model.classifier.predictProbability([featureVector])[0];

  // probabilities is [P(class=0), P(class=1)]
  const successProbability = probabilities[1] ?? (prediction === 1 ? 0.75 : 0.25);
  const failureProbability = 1 - successProbability;

  // Classification bands
  let classification: ClassificationResult['classification'];
  if (successProbability >= 0.6) classification = 'likely_success';
  else if (successProbability <= 0.4) classification = 'likely_failure';
  else classification = 'uncertain';

  // Confidence: how far from 0.5 the prediction is
  const confidence = Math.abs(successProbability - 0.5) * 2;

  // Feature importance via permutation
  const { features: trainingFeatures, labels: trainingLabels } =
    precedentsToTrainingData(precedents);
  const importanceScores = computeFeatureImportance(
    model.classifier,
    trainingFeatures,
    trainingLabels
  );

  const featureImportance: FeatureImportance[] = FEATURE_NAMES.map((key, i) => ({
    feature: key,
    importance: importanceScores[i],
    direction: FEATURE_DIRECTIONS[key],
    humanReadable: FEATURE_DESCRIPTIONS[key],
  })).sort((a, b) => b.importance - a.importance); // most important first

  return {
    successProbability,
    failureProbability,
    classification,
    confidence,
    featureImportance,
    modelVersion: model.version,
    trainingExamples: model.trainingExamples,
  };
}
