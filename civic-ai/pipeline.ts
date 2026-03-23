/**
 * pipeline.ts
 *
 * Orchestrates the full AI advisory pipeline:
 *
 *   1. Receive proposal (from chain event or API call)
 *   2. AI analysis (with open-source model)
 *   3. Multilingual translation
 *   4. IPFS publication
 *   5. Oversight panel review (async — waits for threshold)
 *   6. On-chain submission (only after approval)
 *
 * Retry logic:
 *   If the oversight panel flags the briefing, the AI re-runs with
 *   their feedback. Up to MAX_REVISION_ROUNDS attempts before the
 *   proposal is escalated to a full panel hearing.
 */

import chalk from 'chalk'
import * as dotenv from 'dotenv'
import { analyzeProposal }      from './ai-analyzer'
import { translateBriefing }    from './translate'
import { publishToIPFS }        from './ipfs-publisher'
import { createReviewSession, getStatus, submitReview } from './oversight-store'
import { submitBriefingOnChain } from './chain-submitter'
import type { RawProposal, PanelReview, ChainSubmissionResult, OversightStatus } from './types'
import { randomUUID }           from 'crypto'

dotenv.config()

const MAX_REVISION_ROUNDS = 3
const OVERSIGHT_POLL_INTERVAL_MS = 5_000   // poll every 5s in dev; use webhooks in prod
const OVERSIGHT_TIMEOUT_MS       = parseInt(process.env.OVERSIGHT_REVIEW_WINDOW_SECONDS ?? '172800', 10) * 1000

// ── Main pipeline ─────────────────────────────────────────────────────────────
export async function runAdvisoryPipeline(
  proposal: RawProposal,
  options?: {
    skipChainSubmission?: boolean   // useful for testing
    skipTranslation?: boolean       // faster for local dev
    simulatePanelApproval?: boolean // auto-approve for testing
  }
): Promise<ChainSubmissionResult | null> {

  console.log(chalk.bold(`\n${'═'.repeat(56)}`))
  console.log(chalk.bold(`  AI Advisory Pipeline — Proposal ${proposal.proposalId}`))
  console.log(chalk.bold(`${'═'.repeat(56)}`))

  let oversightFeedback: string[] = []
  let approved = false
  let lastPublished = null

  for (let round = 1; round <= MAX_REVISION_ROUNDS; round++) {
    if (round > 1) {
      console.log(chalk.yellow(`\n↻ Revision round ${round}/${MAX_REVISION_ROUNDS} — incorporating panel feedback`))
    }

    // ── Step 1: AI analysis ──────────────────────────────────────────────────
    let briefing = await analyzeProposal(proposal, oversightFeedback.length ? oversightFeedback : undefined)

    // ── Step 2: Translation ──────────────────────────────────────────────────
    if (!options?.skipTranslation) {
      briefing = await translateBriefing(briefing, proposal.jurisdiction)
    }

    // ── Step 3: IPFS publication ─────────────────────────────────────────────
    const published = await publishToIPFS(briefing)
    lastPublished = published

    // ── Step 4: Oversight panel review ───────────────────────────────────────
    console.log(chalk.bold('\n👥 Oversight panel review'))
    createReviewSession(proposal.proposalId, published.ipfsCid)
    console.log(chalk.gray(`   Session created for CID: ${published.ipfsCid}`))
    console.log(chalk.gray(`   Awaiting ${process.env.OVERSIGHT_APPROVAL_THRESHOLD ?? 3} approvals…`))
    console.log(chalk.gray(`   Panel members can review at: ${published.ipfsUrl}`))

    let status: OversightStatus

    if (options?.simulatePanelApproval) {
      // Dev/test: simulate three panel member approvals
      console.log(chalk.yellow('   [DEV] Simulating panel approval…'))
      for (let m = 1; m <= 3; m++) {
        const review: PanelReview = {
          reviewId:   randomUUID(),
          proposalId: proposal.proposalId,
          ipfsCid:    published.ipfsCid,
          reviewedBy: `dev-panel-member-${m}`,
          decision:   'approve',
          notes:      'Approved in simulation mode',
          reviewedAt: new Date().toISOString(),
        }
        submitReview(review)
      }
    }

    // Poll for status (production: use webhooks or event listeners)
    status = await pollForOversightDecision(proposal.proposalId, published.ipfsCid)

    if (status.status === 'approved') {
      approved = true
      console.log(chalk.green(`\n   ✅ Panel approved (${status.approvalCount}/${status.threshold} votes)`))
      break
    }

    if (status.status === 'flagged') {
      oversightFeedback = status.feedbackForAI
      console.log(chalk.yellow(`\n   ⚠ Panel flagged briefing. Feedback:`))
      oversightFeedback.forEach(f => console.log(chalk.gray(`     ${f}`)))

      if (round === MAX_REVISION_ROUNDS) {
        console.log(chalk.red(`\n   ✗ Max revision rounds reached. Escalating to full panel hearing.`))
        console.log(chalk.red(`     Proposal ${proposal.proposalId} requires manual oversight review.`))
        return null
      }
    }
  }

  if (!approved || !lastPublished) {
    console.log(chalk.red('\n   Pipeline did not reach approval. No on-chain submission.'))
    return null
  }

  // ── Step 5: On-chain submission ───────────────────────────────────────────
  if (options?.skipChainSubmission) {
    console.log(chalk.yellow('\n[DEV] Skipping on-chain submission (skipChainSubmission=true)'))
    console.log(chalk.green('\n✅ Pipeline complete (dev mode — no chain tx)'))
    console.log(chalk.gray(`   IPFS CID:     ${lastPublished.ipfsCid}`))
    console.log(chalk.gray(`   Content hash: ${lastPublished.contentHash}`))
    return null
  }

  const chainResult = await submitBriefingOnChain(lastPublished, proposal.proposalId)

  console.log(chalk.bold(`\n${'═'.repeat(56)}`))
  console.log(chalk.bold.green('  Pipeline complete — briefing live on-chain'))
  console.log(chalk.bold(`${'═'.repeat(56)}\n`))

  return chainResult
}

// ── Oversight polling (dev) — replace with webhooks in production ─────────────
async function pollForOversightDecision(
  proposalId: string,
  ipfsCid: string,
): Promise<OversightStatus> {
  const deadline = Date.now() + OVERSIGHT_TIMEOUT_MS

  return new Promise((resolve) => {
    const interval = setInterval(() => {
      const status = getStatus(proposalId, ipfsCid)
      if (!status) return

      if (status.status === 'approved' || status.status === 'flagged') {
        clearInterval(interval)
        resolve(status)
        return
      }

      if (Date.now() > deadline) {
        clearInterval(interval)
        console.log(chalk.red('\n   Oversight timeout — escalating'))
        resolve({ ...status, status: 'flagged', feedbackForAI: ['Review timed out — requires manual escalation'] })
      }
    }, OVERSIGHT_POLL_INTERVAL_MS)
  })
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────
if (require.main === module) {
  const demo: RawProposal = {
    proposalId:         'demo-001',
    title:              'Universal Basic Income pilot — British Columbia',
    descriptionIpfsCid: 'QmDemoHash',
    descriptionText:    `This proposal establishes a 24-month Universal Basic Income pilot program
      in British Columbia, Canada. Every eligible resident aged 18+ receives $1,200 CAD/month,
      funded by a 2% wealth tax on assets exceeding $5 million CAD. The pilot includes rigorous
      academic evaluation of impacts on employment, mental health, poverty, and economic activity.`,
    proposer:    '0xDemoProposerAddress',
    jurisdiction: 'CA-BC',
    cycleId:     1,
    createdAt:   new Date().toISOString(),
  }

  runAdvisoryPipeline(demo, {
    skipChainSubmission:   true,
    skipTranslation:       true,  // set false to test all languages
    simulatePanelApproval: true,
  }).catch(err => {
    console.error(chalk.red('Pipeline failed:'), err)
    process.exit(1)
  })
}
