/**
 * translate.ts
 *
 * Translates AI briefings into multiple languages.
 *
 * Strategy:
 *   The same AI model used for analysis is used for translation.
 *   This keeps the translation auditable — one open-source model,
 *   one codebase, one audit surface.
 *
 *   Default languages: all 6 UN official languages + jurisdiction-specific.
 *   Additional languages can be added by jurisdiction config.
 *
 * Quality principle:
 *   Translations preserve the plain-language level of the original.
 *   A translation that introduces jargon the original avoided is a failure.
 */

import chalk from 'chalk'
import type { AIBriefing, TranslatedBriefing } from './types'

// Default: all 6 UN official languages
export const UN_LANGUAGES = [
  { code: 'ar', name: 'Arabic' },
  { code: 'zh', name: 'Chinese (Simplified)' },
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'French' },
  { code: 'ru', name: 'Russian' },
  { code: 'es', name: 'Spanish' },
]

// Additional languages by jurisdiction prefix
export const JURISDICTION_LANGUAGES: Record<string, Array<{code: string, name: string}>> = {
  'CA':     [{ code: 'fr', name: 'French' }],
  'IN':     [{ code: 'hi', name: 'Hindi' }, { code: 'te', name: 'Telugu' }, { code: 'bn', name: 'Bengali' }],
  'BR':     [{ code: 'pt', name: 'Portuguese' }],
  'EU':     [{ code: 'de', name: 'German' }, { code: 'it', name: 'Italian' }, { code: 'nl', name: 'Dutch' }],
  'EARTH':  [],  // UN languages cover global scope
}

function buildTranslationPrompt(briefing: AIBriefing, targetLanguage: string): string {
  return `Translate the following governance briefing into ${targetLanguage}.

CRITICAL REQUIREMENTS:
1. Maintain the same plain-language reading level as the original (8th grade).
2. Do not introduce technical jargon that wasn't in the original.
3. Preserve all factual content, risk assessments, and nuance exactly.
4. If a concept has no direct translation, use the closest natural equivalent and add a brief clarification.
5. Return ONLY a JSON object — no preamble.

SOURCE BRIEFING (English):
Summary: ${briefing.summary}

Key points:
${briefing.keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Full explanation:
${briefing.plainEnglishExplainer}

Return JSON:
{
  "summary": "<translated summary>",
  "keyPoints": ["<translated point 1>", "<translated point 2>"],
  "plainEnglishExplainer": "<translated full explanation>"
}`
}

async function translateOnce(
  briefing: AIBriefing,
  targetLang: { code: string, name: string }
): Promise<TranslatedBriefing> {
  if (targetLang.code === 'en') {
    return {
      languageCode:   'en',
      languageName:   'English',
      summary:        briefing.summary,
      keyPoints:      briefing.keyPoints,
      plainEnglishExplainer: briefing.plainEnglishExplainer,
      translatedAt:   new Date().toISOString(),
    }
  }

  // Dynamically import callAI to avoid circular deps
  const { callAI } = await import('./ai-client')
  const systemPrompt = 'You are a professional translator specializing in civic and legal documents. You translate with precision and maintain reading level.'
  const userPrompt   = buildTranslationPrompt(briefing, targetLang.name)

  const raw     = await callAI(systemPrompt, userPrompt)
  const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const parsed  = JSON.parse(cleaned)

  return {
    languageCode:   targetLang.code,
    languageName:   targetLang.name,
    summary:        parsed.summary        ?? briefing.summary,
    keyPoints:      parsed.keyPoints      ?? briefing.keyPoints,
    plainEnglishExplainer: parsed.plainEnglishExplainer ?? briefing.plainEnglishExplainer,
    translatedAt:   new Date().toISOString(),
  }
}

export async function translateBriefing(
  briefing: AIBriefing,
  jurisdiction: string,
  additionalLangCodes: string[] = [],
): Promise<AIBriefing> {
  console.log(chalk.cyan('\n🌐 Translating briefing…'))

  // Build language list: UN + jurisdiction-specific + any extras
  const jurisdictionPrefix = jurisdiction.split('-')[0]
  const jurisdictionLangs  = JURISDICTION_LANGUAGES[jurisdictionPrefix] ?? []

  const allLangs = [
    ...UN_LANGUAGES,
    ...jurisdictionLangs,
    ...additionalLangCodes.map(code => ({ code, name: code })),
  ]

  // Deduplicate by code
  const uniqueLangs = allLangs.filter(
    (lang, i, arr) => arr.findIndex(l => l.code === lang.code) === i
  )

  // Translate in parallel (up to 3 concurrent to avoid rate limits)
  const results = await Promise.allSettled(
    uniqueLangs.map(lang => translateOnce(briefing, lang))
  )

  const translations: Record<string, TranslatedBriefing> = {}
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const lang   = uniqueLangs[i]
    if (result.status === 'fulfilled') {
      translations[lang.code] = result.value
      console.log(chalk.gray(`   ✓ ${lang.name}`))
    } else {
      console.log(chalk.yellow(`   ⚠ ${lang.name} failed: ${result.reason}`))
      // Fallback to English on translation failure — never block the pipeline
      translations[lang.code] = {
        languageCode:   lang.code,
        languageName:   lang.name,
        summary:        briefing.summary,
        keyPoints:      briefing.keyPoints,
        plainEnglishExplainer: briefing.plainEnglishExplainer,
        translatedAt:   new Date().toISOString(),
      }
    }
  }

  console.log(chalk.green(`   ✓ ${Object.keys(translations).length} languages complete`))
  return { ...briefing, translations }
}
