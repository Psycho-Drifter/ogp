/**
 * server.ts
 *
 * REST API for the AI advisory service.
 *
 * Endpoints:
 *   POST /proposals/analyze      — trigger analysis pipeline for a proposal
 *   GET  /proposals/:id/briefing — get current briefing status
 *   POST /oversight/review       — panel member submits a review
 *   GET  /oversight/pending      — list proposals awaiting panel review
 *   GET  /health                 — service health check
 *
 * In production: add JWT auth for panel member endpoints,
 * rate limiting, and request logging.
 */

import express, { Request, Response } from 'express'
import * as dotenv from 'dotenv'
import chalk from 'chalk'
import { z } from 'zod'
import { runAdvisoryPipeline }       from './pipeline'
import { submitReview, listPendingReviews, getStatus } from './oversight-store'
import { RawProposalSchema, PanelReviewSchema } from './types'
import { randomUUID } from 'crypto'

dotenv.config()

const app  = express()
const PORT = parseInt(process.env.PORT ?? '3001', 10)

app.use(express.json())

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status:   'ok',
    service:  'civic-ai-advisory',
    version:  '0.1.0',
    provider: process.env.AI_PROVIDER ?? 'anthropic',
    model:    process.env.AI_MODEL    ?? 'claude-sonnet-4-20250514',
    time:     new Date().toISOString(),
  })
})

// ── Trigger analysis pipeline ─────────────────────────────────────────────────
app.post('/proposals/analyze', async (req: Request, res: Response) => {
  const parsed = RawProposalSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid proposal', details: parsed.error.issues })
  }

  const proposal = parsed.data

  // Run pipeline in background — don't block the HTTP response
  res.status(202).json({
    message:    'Analysis pipeline started',
    proposalId: proposal.proposalId,
    statusUrl:  `/proposals/${proposal.proposalId}/briefing`,
  })

  // Fire and forget — status tracked in oversight store
  runAdvisoryPipeline(proposal, {
    simulatePanelApproval: process.env.NODE_ENV === 'development',
  }).catch(err => {
    console.error(chalk.red(`Pipeline error for ${proposal.proposalId}:`), err)
  })
})

// ── Get briefing status ───────────────────────────────────────────────────────
app.get('/proposals/:id/briefing', (req: Request, res: Response) => {
  const { id }    = req.params
  const { cycle } = req.query

  // In production: look up the IPFS CID from a database by proposalId
  // For now: client must pass the CID as a query param for lookup
  const cid = req.query.cid as string | undefined
  if (!cid) {
    return res.status(400).json({ error: 'Pass ?cid=<ipfs-cid> to look up review status' })
  }

  const status = getStatus(id, cid)
  if (!status) {
    return res.status(404).json({ error: 'No review session found for this proposal+CID' })
  }

  res.json(status)
})

// ── Submit oversight review ───────────────────────────────────────────────────
app.post('/oversight/review', (req: Request, res: Response) => {
  const reviewInput = {
    reviewId:   randomUUID(),
    reviewedAt: new Date().toISOString(),
    ...req.body,
  }

  const parsed = PanelReviewSchema.safeParse(reviewInput)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid review', details: parsed.error.issues })
  }

  try {
    const updatedStatus = submitReview(parsed.data)
    res.json({
      message:      'Review recorded',
      currentStatus: updatedStatus.status,
      approvalCount: updatedStatus.approvalCount,
      flagCount:     updatedStatus.flagCount,
      threshold:     updatedStatus.threshold,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(400).json({ error: message })
  }
})

// ── List pending reviews ──────────────────────────────────────────────────────
app.get('/oversight/pending', (_req: Request, res: Response) => {
  const pending = listPendingReviews()
  res.json({
    count:    pending.length,
    proposals: pending.map(s => ({
      proposalId:   s.proposalId,
      ipfsCid:      s.ipfsCid,
      approvals:    s.approvalCount,
      flags:        s.flagCount,
      threshold:    s.threshold,
      reviewCount:  s.reviews.length,
    })),
  })
})

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(chalk.bold(`\n🏛  Civic AI Advisory Service`))
  console.log(chalk.gray(`   Port:     ${PORT}`))
  console.log(chalk.gray(`   Provider: ${process.env.AI_PROVIDER ?? 'anthropic'}`))
  console.log(chalk.gray(`   Model:    ${process.env.AI_MODEL ?? 'claude-sonnet-4-20250514'}`))
  console.log(chalk.gray(`   Env:      ${process.env.NODE_ENV ?? 'development'}`))
  console.log(chalk.green(`\n   Ready — http://localhost:${PORT}/health\n`))
})

export default app
