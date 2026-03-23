/**
 * ai-analyzer.ts
 *
 * Generates a structured AI briefing from a governance proposal.
 *
 * Model strategy:
 *   Development/staging: Anthropic API (fast iteration)
 *   Production:          Self-hosted open-source model (Llama 3 70B, Mistral Large)
 *                        Citizens and auditors can inspect the exact model weights.
 *                        Swap AI_PROVIDER=ollama + AI_BASE_URL in .env.
 *
 * The briefing output is structured JSON — not free-form text. This ensures:
 *   1. Every briefing has the same fields (machine-readable, auditable)
 *   2. Risk scores are numeric (comparable across proposals)
 *   3. Confidence levels are explicit (citizens know what the AI doesn't know)
 *   4. Minority impact has a dedicated field (cannot be omitted)
 */

import Anthropic from '@anthropic-ai/sdk'
import * as dotenv from 'dotenv'
import chalk from 'chalk'
import type { RawProposal, AIBriefing, RiskItem, PredictedOutcome, HistoricalPrecedent } from './types'

dotenv.config()

const MODEL    = process.env.AI_MODEL    ?? 'claude-sonnet-4-20250514'
const PROVIDER = process.env.AI_PROVIDER ?? 'anthropic'

// ── System prompt — defines the AI's role and constraints ────────────────────
const SYSTEM_PROMPT = `You are the AI Advisory System for a decentralized civic governance platform.
Your role is to help citizens make INFORMED decisions — not to make decisions for them.

CORE PRINCIPLES you must follow in every analysis:
1. INFORM, NEVER DECIDE. Present facts, risks, and outcomes. Never recommend a vote direction.
2. PLAIN LANGUAGE. Write at an 8th-grade reading level. Assume no specialist knowledge.
3. BALANCED. Present arguments for and against with equal depth and fairness.
4. TRANSPARENT. Always state your confidence level and the limits of your analysis.
5. MINORITY IMPACT. Explicitly analyze how the proposal affects vulnerable and minority groups.
6. CITE UNCERTAINTY. If you don't know something, say so. Speculation must be labeled.
7. NO POLITICAL BIAS. Analyze economic, social, and legal effects — not political allegiances.

You must return ONLY valid JSON matching the schema provided. No preamble, no explanation outside the JSON.
If you cannot analyze a proposal safely, set confidenceLevel to 0.1 and explain in limitations[].`

// ── Analysis prompt template ──────────────────────────────────────────────────
function buildAnalysisPrompt(proposal: RawProposal): string {
  return `Analyze this governance proposal and return a JSON briefing.

PROPOSAL DETAILS:
Title: ${proposal.title}
Jurisdiction: ${proposal.jurisdiction}
Submitted by: ${proposal.proposer}
Cycle: ${proposal.cycleId}
Full text:
---
${proposal.descriptionText}
---

Return ONLY a JSON object with this exact structure:
{
  "summary": "2-3 sentence plain-language TL;DR. Must be understandable by any adult.",
  "keyPoints": ["array", "of", "5-7", "key", "points", "citizens", "should", "know"],
  "plainEnglishExplainer": "Full 3-5 paragraph plain-language explanation. No jargon.",
  "overallRiskScore": <integer 0-100>,
  "risks": [
    {
      "category": "economic|social|environmental|legal|security|technical",
      "severity": "low|medium|high|critical",
      "probability": <float 0.0-1.0>,
      "description": "Plain language description of the risk",
      "mitigation": "What could reduce this risk"
    }
  ],
  "predictedOutcomes": [
    {
      "scenario": "if_passes|if_rejected",
      "timeframe": "short_term|medium_term|long_term",
      "description": "What is likely to happen",
      "confidence": <float 0.0-1.0>
    }
  ],
  "historicalPrecedents": [
    {
      "jurisdiction": "Country or region",
      "year": <integer>,
      "description": "What happened",
      "outcome": "What resulted",
      "relevance": "Why this is relevant to this proposal"
    }
  ],
  "affectedGroups": ["list", "of", "groups", "most", "affected"],
  "minorityImpact": "Explicit analysis of how this affects minority, vulnerable, or marginalized groups. This field is mandatory and must be substantive.",
  "confidenceLevel": <float 0.0-1.0>,
  "limitations": ["Known gaps or uncertainties in this analysis"],
  "dataSourcesUsed": ["General knowledge about governance", "Economic modeling", "etc."]
}

Remember: you are informing citizens, not deciding for them. Present both sides fairly.`
}

// ── AI client abstraction — supports Anthropic and Ollama ────────────────────
async function callAI(systemPrompt: string, userPrompt: string): Promise<string> {
  if (PROVIDER === 'anthropic') {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await client.messages.create({
      model:      MODEL,
      max_tokens: 4096,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    })
    const block = response.content[0]
    if (block.type !== 'text') throw new Error('Unexpected response type from AI')
    return block.text
  }

  if (PROVIDER === 'ollama') {
    // Open-source self-hosted path (Llama 3, Mistral, etc.)
    const axios = (await import('axios')).default
    const baseUrl = process.env.AI_BASE_URL ?? 'http://localhost:11434'
    const response = await axios.post(`${baseUrl}/api/generate`, {
      model:  MODEL,
      prompt: `${systemPrompt}\n\n${userPrompt}`,
      stream: false,
      options: { temperature: 0.3 },  // low temp for factual analysis
    })
    return response.data.response
  }

  throw new Error(`Unknown AI_PROVIDER: ${PROVIDER}. Use 'anthropic' or 'ollama'.`)
}

// ── Parse and validate the AI response ───────────────────────────────────────
function parseAIResponse(raw: string, proposal: RawProposal): Partial<AIBriefing> {
  // Strip markdown code fences if present
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const parsed = JSON.parse(cleaned)

  // Validate required fields with safe fallbacks
  return {
    summary:               parsed.summary               ?? 'Analysis unavailable.',
    keyPoints:             Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
    plainEnglishExplainer: parsed.plainEnglishExplainer  ?? '',
    overallRiskScore:      Math.min(100, Math.max(0, Number(parsed.overallRiskScore ?? 50))),
    risks:                 Array.isArray(parsed.risks) ? parsed.risks as RiskItem[] : [],
    predictedOutcomes:     Array.isArray(parsed.predictedOutcomes) ? parsed.predictedOutcomes as PredictedOutcome[] : [],
    historicalPrecedents:  Array.isArray(parsed.historicalPrecedents) ? parsed.historicalPrecedents as HistoricalPrecedent[] : [],
    affectedGroups:        Array.isArray(parsed.affectedGroups) ? parsed.affectedGroups : [],
    minorityImpact:        parsed.minorityImpact        ?? 'Minority impact analysis was not completed.',
    confidenceLevel:       Math.min(1, Math.max(0, Number(parsed.confidenceLevel ?? 0.5))),
    limitations:           Array.isArray(parsed.limitations) ? parsed.limitations : [],
    dataSourcesUsed:       Array.isArray(parsed.dataSourcesUsed) ? parsed.dataSourcesUsed : [],
  }
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function analyzeProposal(
  proposal: RawProposal,
  oversightFeedback?: string[],  // panel feedback from a previous rejected run
): Promise<AIBriefing> {
  console.log(chalk.bold(`\n🤖 AI analysis: "${proposal.title}"`))
  console.log(chalk.gray(`   Provider: ${PROVIDER} / ${MODEL}`))
  console.log(chalk.gray(`   Jurisdiction: ${proposal.jurisdiction}`))

  const userPrompt = oversightFeedback?.length
    ? `${buildAnalysisPrompt(proposal)}\n\nOVERSIGHT PANEL FEEDBACK FROM PREVIOUS ATTEMPT:\n${oversightFeedback.map(f => `- ${f}`).join('\n')}\nPlease address all feedback points in this revised analysis.`
    : buildAnalysisPrompt(proposal)

  console.log(chalk.cyan('   Calling AI model…'))
  const rawResponse = await callAI(SYSTEM_PROMPT, userPrompt)

  console.log(chalk.cyan('   Parsing response…'))
  const analysisFields = parseAIResponse(rawResponse, proposal)

  const briefing: AIBriefing = {
    proposalId:            proposal.proposalId,
    generatedAt:           new Date().toISOString(),
    modelId:               MODEL,
    modelProvider:         PROVIDER,
    schemaVersion:         '2.0',
    summary:               analysisFields.summary!,
    keyPoints:             analysisFields.keyPoints!,
    plainEnglishExplainer: analysisFields.plainEnglishExplainer!,
    overallRiskScore:      analysisFields.overallRiskScore!,
    risks:                 analysisFields.risks!,
    predictedOutcomes:     analysisFields.predictedOutcomes!,
    historicalPrecedents:  analysisFields.historicalPrecedents!,
    affectedGroups:        analysisFields.affectedGroups!,
    minorityImpact:        analysisFields.minorityImpact!,
    confidenceLevel:       analysisFields.confidenceLevel!,
    limitations:           analysisFields.limitations!,
    dataSourcesUsed:       analysisFields.dataSourcesUsed!,
    translations:          {},  // populated by translate.ts
  }

  console.log(chalk.green(`   ✓ Analysis complete`))
  console.log(chalk.gray(`     Risk score:   ${briefing.overallRiskScore}/100`))
  console.log(chalk.gray(`     Confidence:   ${(briefing.confidenceLevel * 100).toFixed(0)}%`))
  console.log(chalk.gray(`     Risks found:  ${briefing.risks.length}`))

  return briefing
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────
if (require.main === module) {
  const demo: RawProposal = {
    proposalId:          'demo-001',
    title:               'Universal Basic Income pilot — British Columbia',
    descriptionIpfsCid:  'QmDemoHash',
    descriptionText:     `This proposal establishes a 24-month Universal Basic Income (UBI) pilot program
      in British Columbia, Canada. Every eligible resident aged 18 and older would receive
      $1,200 CAD per month, unconditionally. The program would be funded by a 2% wealth tax
      on assets exceeding $5 million CAD. The pilot would include rigorous academic evaluation
      of impacts on employment, mental health, poverty rates, and economic activity. Results
      would inform a decision on province-wide implementation.`,
    proposer:            '0xDemoProposerAddress',
    jurisdiction:        'CA-BC',
    cycleId:             1,
    createdAt:           new Date().toISOString(),
  }

  analyzeProposal(demo)
    .then(briefing => {
      console.log(chalk.bold('\n── Briefing output ──────────────────────────────'))
      console.log(JSON.stringify(briefing, null, 2))
    })
    .catch(err => {
      console.error(chalk.red('Analysis failed:'), err)
      process.exit(1)
    })
}
