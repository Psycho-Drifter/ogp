import { z } from 'zod'

// ── Incoming proposal ─────────────────────────────────────────────────────────
export interface RawProposal {
  proposalId:          string
  title:               string
  descriptionIpfsCid:  string   // full text lives on IPFS
  descriptionText:     string   // fetched from IPFS for analysis
  proposer:            string   // wallet address
  jurisdiction:        string   // "CA-BC", "US-CA", "EARTH", etc.
  cycleId:             number
  createdAt:           string   // ISO 8601
}

// ── Risk item ─────────────────────────────────────────────────────────────────
export interface RiskItem {
  category:    'economic' | 'social' | 'environmental' | 'legal' | 'security' | 'technical'
  severity:    'low' | 'medium' | 'high' | 'critical'
  probability: number   // 0.0–1.0
  description: string   // plain language
  mitigation:  string   // what could reduce this risk
}

// ── Predicted outcome ─────────────────────────────────────────────────────────
export interface PredictedOutcome {
  scenario:    'if_passes' | 'if_rejected'
  timeframe:   'short_term' | 'medium_term' | 'long_term'
  description: string
  confidence:  number  // 0.0–1.0
}

// ── Historical precedent ──────────────────────────────────────────────────────
export interface HistoricalPrecedent {
  jurisdiction: string
  year:         number
  description:  string
  outcome:      string
  relevance:    string  // why this is relevant to this proposal
}

// ── Full AI briefing ──────────────────────────────────────────────────────────
export interface AIBriefing {
  // Metadata
  proposalId:        string
  generatedAt:       string   // ISO 8601
  modelId:           string   // which model produced this
  modelProvider:     string   // "anthropic" | "ollama" | etc.
  schemaVersion:     '2.0'

  // The core content — all in plain language
  summary:           string   // 2–3 sentence TL;DR, 8th grade reading level
  keyPoints:         string[] // 5–7 bullet points citizens should know
  plainEnglishExplainer: string  // full plain-language explanation

  // Risk analysis
  overallRiskScore:  number   // 0–100 (0=minimal, 100=extreme)
  risks:             RiskItem[]

  // Outcomes
  predictedOutcomes: PredictedOutcome[]

  // Context
  historicalPrecedents: HistoricalPrecedent[]
  affectedGroups:    string[]  // who is most impacted
  minorityImpact:    string    // explicit analysis of minority/vulnerable group effects

  // AI transparency (required — citizens can assess AI quality)
  confidenceLevel:   number    // 0.0–1.0 — how confident the AI is in this analysis
  limitations:       string[]  // known gaps in the AI's analysis
  dataSourcesUsed:   string[]  // what the AI drew on

  // Translated versions keyed by ISO 639-1 language code
  translations:      Record<string, TranslatedBriefing>
}

export interface TranslatedBriefing {
  languageCode:   string   // ISO 639-1 e.g. "fr", "es", "zh", "ar"
  languageName:   string   // "French", "Spanish", etc.
  summary:        string
  keyPoints:      string[]
  plainEnglishExplainer: string
  translatedAt:   string
}

// ── IPFS published briefing ───────────────────────────────────────────────────
export interface PublishedBriefing {
  briefing:      AIBriefing
  ipfsCid:       string
  contentHash:   string  // keccak256 of JSON — goes on-chain
  ipfsUrl:       string
  pinnedAt:      string
}

// ── Oversight review ──────────────────────────────────────────────────────────
export type ReviewDecision = 'approve' | 'flag' | 'pending'

export interface PanelReview {
  reviewId:     string
  proposalId:   string
  ipfsCid:      string
  reviewedBy:   string   // panel member identifier
  decision:     ReviewDecision
  notes:        string
  reviewedAt:   string
}

export interface OversightStatus {
  proposalId:         string
  ipfsCid:            string
  reviews:            PanelReview[]
  approvalCount:      number
  flagCount:          number
  threshold:          number
  status:             'pending' | 'approved' | 'flagged' | 'rejected'
  feedbackForAI:      string[]  // aggregated flags sent back to AI for revision
}

// ── Chain submission result ───────────────────────────────────────────────────
export interface ChainSubmissionResult {
  proposalId:   string
  txHash:       string
  ipfsCid:      string
  contentHash:  string
  blockNumber:  number
  submittedAt:  string
}

// ── Zod schemas for API validation ───────────────────────────────────────────
export const RawProposalSchema = z.object({
  proposalId:         z.string(),
  title:              z.string().min(1),
  descriptionIpfsCid: z.string(),
  descriptionText:    z.string().min(10),
  proposer:           z.string(),
  jurisdiction:       z.string(),
  cycleId:            z.number(),
  createdAt:          z.string(),
})

export const PanelReviewSchema = z.object({
  reviewId:   z.string(),
  proposalId: z.string(),
  ipfsCid:    z.string(),
  reviewedBy: z.string(),
  decision:   z.enum(['approve', 'flag', 'pending']),
  notes:      z.string(),
  reviewedAt: z.string(),
})
