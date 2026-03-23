/**
 * oversight-store.ts
 *
 * In-memory + file-backed store for oversight panel reviews.
 *
 * The oversight panel is a rotating body of citizens who review
 * AI briefings before they go on-chain. Their job:
 *   - Approve: briefing is accurate, fair, and plain-language
 *   - Flag: briefing has errors, bias, or missing information
 *
 * Flagged briefings are returned to the AI with the panel's specific
 * feedback. The AI re-runs and produces a revised briefing.
 * This loop continues until approval threshold is met or the proposal
 * is manually escalated to a full panel hearing.
 *
 * In production: replace the in-memory store with a database
 * (Postgres or similar). The JSON file is a dev convenience.
 */

import * as fs   from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import type { PanelReview, OversightStatus } from './types'

dotenv.config()

const THRESHOLD = parseInt(process.env.OVERSIGHT_APPROVAL_THRESHOLD ?? '3', 10)
const STORE_PATH = path.join(__dirname, '../.oversight-store.json')

type Store = Record<string, OversightStatus>

function loadStore(): Store {
  try {
    if (fs.existsSync(STORE_PATH)) {
      return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'))
    }
  } catch { /* start fresh */ }
  return {}
}

function saveStore(store: Store): void {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2))
}

export function createReviewSession(proposalId: string, ipfsCid: string): OversightStatus {
  const store = loadStore()
  const status: OversightStatus = {
    proposalId,
    ipfsCid,
    reviews:       [],
    approvalCount: 0,
    flagCount:     0,
    threshold:     THRESHOLD,
    status:        'pending',
    feedbackForAI: [],
  }
  store[`${proposalId}:${ipfsCid}`] = status
  saveStore(store)
  return status
}

export function submitReview(review: PanelReview): OversightStatus {
  const store  = loadStore()
  const key    = `${review.proposalId}:${review.ipfsCid}`
  const status = store[key]
  if (!status) throw new Error(`No review session for ${key}`)

  // Prevent duplicate reviews from same panel member
  const existing = status.reviews.find(r => r.reviewedBy === review.reviewedBy)
  if (existing) {
    existing.decision  = review.decision
    existing.notes     = review.notes
    existing.reviewedAt = review.reviewedAt
  } else {
    status.reviews.push(review)
  }

  // Recalculate counts
  status.approvalCount = status.reviews.filter(r => r.decision === 'approve').length
  status.flagCount     = status.reviews.filter(r => r.decision === 'flag').length

  // Collect feedback from flags
  status.feedbackForAI = status.reviews
    .filter(r => r.decision === 'flag' && r.notes.trim())
    .map(r => `[${r.reviewedBy}]: ${r.notes}`)

  // Determine status
  if (status.approvalCount >= THRESHOLD) {
    status.status = 'approved'
  } else if (status.flagCount > status.reviews.length / 2) {
    // Majority flagged — send back to AI
    status.status = 'flagged'
  } else {
    status.status = 'pending'
  }

  store[key] = status
  saveStore(store)
  return status
}

export function getStatus(proposalId: string, ipfsCid: string): OversightStatus | null {
  const store = loadStore()
  return store[`${proposalId}:${ipfsCid}`] ?? null
}

export function listPendingReviews(): OversightStatus[] {
  const store = loadStore()
  return Object.values(store).filter(s => s.status === 'pending')
}
