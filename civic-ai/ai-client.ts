/**
 * ai-client.ts
 *
 * Single abstraction over AI providers.
 * Swap AI_PROVIDER in .env to switch between Anthropic (dev) and
 * a self-hosted open-source model (production).
 */

import * as dotenv from 'dotenv'
dotenv.config()

const MODEL    = process.env.AI_MODEL    ?? 'claude-sonnet-4-20250514'
const PROVIDER = process.env.AI_PROVIDER ?? 'anthropic'

export async function callAI(systemPrompt: string, userPrompt: string): Promise<string> {
  if (PROVIDER === 'anthropic') {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response  = await client.messages.create({
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
    const axios   = (await import('axios')).default
    const baseUrl = process.env.AI_BASE_URL ?? 'http://localhost:11434'
    const res     = await axios.post(`${baseUrl}/api/generate`, {
      model:   MODEL,
      prompt:  `${systemPrompt}\n\n${userPrompt}`,
      stream:  false,
      options: { temperature: 0.2 },
    })
    return res.data.response
  }

  throw new Error(`Unknown AI_PROVIDER: ${PROVIDER}`)
}
