/**
 * OGP Policy Database — Schema and Types
 *
 * The authoritative data source for the scenario engine.
 * Seeded from World Bank, OECD, academic repositories, and convergence reports.
 * Expanded over time as OGP-governed proposals produce observed outcomes.
 *
 * All entries carry provenance metadata. The exact database version used
 * for each briefing is recorded in the briefing metadata for full auditability.
 */

// ─── Vote type enum ───────────────────────────────────────────────────────────

export type VoteType =
  | 'constitutional'
  | 'treaty'
  | 'budget'
  | 'referendum'
  | 'policy'
  | 'minor';

export const SCENARIO_TRIGGERING_TYPES: VoteType[] = [
  'constitutional',
  'treaty',
  'budget',
  'referendum',
];

export const LOCKED_TYPES: VoteType[] = [
  'constitutional',
  'treaty',
  'budget',
  'referendum',
];

// ─── Policy database entry ────────────────────────────────────────────────────

export interface PolicyDatabaseEntry {
  id: string;                     // UUID
  version: number;                // Incremented on edit — immutable history
  policyType: VoteType;
  subCategory: string;            // e.g. "universal-basic-income", "carbon-tax", "electoral-reform"
  title: string;
  description: string;
  jurisdiction: string;           // ISO 3166-1 alpha-3 or 'GLOBAL'
  region: string;                 // e.g. "Northern Europe", "Sub-Saharan Africa"
  year: number;                   // Year of implementation or attempted implementation
  outcomeScore: number;           // 0.0–1.0 normalised outcome (1.0 = fully achieved intended goals)
  outcomeNarrative: string;       // Plain-language description of what happened
  timeHorizonEvaluated: number;   // Years of observation before outcome was assessed
  tags: string[];                 // Searchable feature tags
  keyFactors: {                   // Factors cited in source analysis
    promoting: string[];          // What helped
    hindering: string[];          // What hurt
  };
  source: string;                 // Provenance — URL or citation
  sourceType: 'world_bank' | 'oecd' | 'academic' | 'convergence_report' | 'ogp_observed';
  addedBy: string;                // Curator identifier
  addedAt: string;                // ISO timestamp
  lastUpdated: string;            // ISO timestamp
}

// ─── Database metadata ────────────────────────────────────────────────────────

export interface PolicyDatabaseMetadata {
  version: string;                // Semantic version e.g. "1.0.0"
  lastUpdated: string;
  entryCount: number;
  sources: string[];
  jurisdictionsCovered: string[];
}

// ─── Database interface ───────────────────────────────────────────────────────

export interface PolicyDatabase {
  metadata: PolicyDatabaseMetadata;
  entries: PolicyDatabaseEntry[];
}
