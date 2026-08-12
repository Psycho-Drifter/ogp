# OGP Citizen Portal — UI/UX Architecture
**Document status:** Design complete, implementation pending (Phase 3–5)
**Location in repo:** `ogp/docs/OGP-ux-architecture.md`

---

## Design philosophy

The citizen portal must feel like **government infrastructure**, not a crypto application. The governing tension is accessibility versus integrity — the system must be trustworthy enough for constitutional votes, legible enough for a first-time user anywhere in the world, and accessible on any personal device a citizen owns.

Design language decisions locked:
- **Civic-modernist aesthetic** — institutional gravity, not Web3 speculation. No blockchain iconography, no token aesthetics.
- **Palette:** Deep navy primary, amber accent (globe mark center point), semantic colour only for status (green/amber/red)
- **Typography:** System sans-serif (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`). Institutional weight headings, legible body text.
- **Plain language throughout** — all technical terms translated. "ZK-PLONK proof" → "secure private ballot". "Soulbound NFT" → "non-transferable digital civic identity". "Smart contract" → "automated governance rule enforced by code".
- **Text zoom:** Three-level scale (Standard / Large / Extra Large) using a CSS `--z` custom property that scales font sizes, padding, and card spacing proportionally. Required for older and low-vision voters.

---

## Platform targets

Single codebase — React Native with Expo. Compiles to:
- **iOS** (native, App Store)
- **Android** (native, Play Store)
- **Web** (Progressive Web App — installable from browser, works on any OS: macOS, Windows, Linux, ChromeOS)

No NFC, no Bluetooth for any session function. All session transfer is cryptographic challenge-signature over HTTPS.

---

## Navigation structure

Four-tab segmented control (pill-style, equal width, full-width grid):

| Tab | Layer | Primary content |
|---|---|---|
| Identity | civic-id | Civic ID card, soulbound NFT details, voting credits gauge |
| Proposals | civic-qv | Active proposals, QV sliders, inline briefing previews |
| AI Briefing | civic-ai | Full scenario engine output, recent briefings (tappable) |
| Oracle | civic-oracle | Bridge status, ZK proof, CCP tiers, shard utilisation |

Active tab: filled `background-info` pill. Inactive: transparent background. No border-bottom strip.

---

## Authentication and session model

### First-time onboarding
1. Citizen taps "Register identity"
2. Redirected to accredited KYC provider (Jumio / Onfido / national eID)
3. KYC provider performs liveness check and document verification
4. Provider returns signed cryptographic attestation to OGP (OGP never sees raw identity document)
5. Attestation triggers soulbound NFT mint on XRPL
6. Citizen receives Civic ID — onboarding complete

### Returning session (any device)
1. App/site generates random challenge string
2. Citizen's XRPL private key signs the challenge (stored in device secure enclave)
3. Signature verified server-side → session token issued
4. No password. No SMS. No seed phrase entry on screen.

### Local device unlock
- Mobile: biometric (Face ID / fingerprint) via `expo-local-authentication`, backed by OS secure enclave
- Desktop web: WebAuthn / FIDO2 hardware security key
- Private key never leaves the secure enclave, never touches clipboard

### High-stakes vote friction
Constitutional vote type: fresh ZK proof generation required as additional step before submission. Adds deliberate friction for the highest-stakes decisions.

---

## Identity tab

**Civic ID card:**
- Citizen number, XRPL address (truncated), verification tier and KYC status
- Soulbound NFT — plain-language explanation that the token is permanent and non-transferable
- Bridge commitment (keccak256 hash), shard assignment

**Voting credits gauge:**
- Current epoch credit balance (100 per epoch)
- Progress bar showing remaining credits (synced live with QV slider interactions)
- Epoch reset countdown
- Plain-language explanation of quadratic cost

**Lost device / recovery entry point:**
- "I lost my device or need to recover my identity" link → reissuance screen
- See: `OGP-ux-lost-device.md` (spec — not yet written, Phase 1 Task 1e)

---

## Proposals tab

**Credit bar:** Live, synced with all sliders. Turns red when over-allocated. Submit button disabled when over-allocated.

**Per-proposal row contains:**
- Proposal title
- Vote type badge: `constitutional` (red), `budget` (amber), `policy` (blue), `minor` (grey)
- Time remaining and participant count
- AI briefing link (inline — does not navigate away):
  - "AI briefing available" (blue, circled-i icon) → expands inline preview
  - "Briefing · low confidence" (amber) → expands preview with amber border and warning
  - No briefing (minor proposals) → no link shown
- QV slider (0–10 votes), credit cost shown live (`votes²`)

**Inline briefing preview (expanded):**
- Reliability score (N/100) with plain-language label (High / Low)
- Progress bar
- "Most likely outcome" — one paragraph, plain language
- "Read full analysis →" button — navigates to AI Briefing tab and loads that proposal's briefing

**Submit button:** "Submit votes securely ↗" — triggers ZK proof generation stub (mock) or live civic-qv call (live)

---

## AI Briefing tab

**Briefing content (data-driven, swappable):**
All briefings are stored in a data object / API response. Tapping any item in the recent list swaps out the full content above — no page navigation.

**Reliability section:**
- Label: "How reliable is this analysis?"
- Score N/100 with colour (green ≥60, amber 40–59)
- Plain-language: "Models ran 1,000 simulations and reviewed N similar historical policies."
- Collapsible "How is this score calculated?" — explains the four component weights

**Low confidence warning (when score 40–59):**
- Amber banner before scenarios: "Not enough historical data to be reliable. Fewer than 5 matched historical policies and simulations did not converge. Read carefully before voting."

**Three scenario cards:**
- Best-case: green background, "1 in 7 chance", plain-language outcome description
- Most likely: neutral background, "Median result"
- Worst-case: red background, "1 in 7 chance"
- Each has collapsible "What does '1 in 7 chance' mean?" explanation tying percentile back to the 1,000 simulation runs

**Sources and audit trail:**
- Studies reviewed, historical matches, data sources (World Bank / OECD), AI model and CCP tier
- IPFS content ID (full CID displayed)
- Plain-language: "This ID permanently identifies this exact briefing. If the analysis is ever changed, the ID changes."

**Recent briefings list (tappable rows):**
- Confidence score, vote type, time ago
- Status pill: Published (green) / Low confidence (amber)
- "· currently viewing" marker on active briefing
- Tap any row → swaps full briefing content above

---

## Oracle tab

**Bridge status panel:**
- Operational status, CCP tier, proof server address, test suite pass count
- `HierarchicalIdentityVerifier` contract reference (not simplified — developers need this)
- SMT depth (64 — planetary scale)

**ZK inclusion proof:**
- Plain-language: "A cryptographic proof that you are a verified citizen, generated without revealing your personal details."
- π₀ and π₁ values (truncated), generation time, validity window

**CCP continuity tiers:**
- Tier 1 Anthropic API — Active / Standby
- Tier 2 Local Ollama — Standby (activates if Tier 1 unavailable)
- Tier 3 IPFS-cached pre-generated briefings — Standby (last resort)
- Plain-language summary: "The system automatically falls back through three tiers if a service goes offline — briefings are always available."

**Shard utilisation bars:**
- Citizen's shard highlighted in blue
- Other shards in secondary colour

---

## Accessibility requirements

- Minimum touch target: 44px height on all interactive elements
- Text zoom: Standard (1×) / Large (1.18×) / Extra Large (1.38×) — persistent toggle in header
- Colour contrast: WCAG AA minimum on all text
- Screen reader labels on all interactive elements
- `flex-wrap` everywhere badges and labels may collide on narrow viewports
- Tab bar: horizontally scrollable on narrow screens with no visible scrollbar

---

## Mock data layer (Phase 2 dependency)

The frontend is built entirely against mock API adapters during Phases 3–5. The single flag `USE_MOCK_DATA` in `ogp/config/env.ts` switches between mock and live. The frontend never calls backend endpoints directly — it imports only from `ogp/src/api/index.ts`.

All four mock briefings (`prop-001` through `prop-004`) must be in `civic-ai/src/mock-data/` before Phase 3 begins.

---

## Kiosk mode (backlog — Phase 5)

Stripped UI — no local key storage, no biometric. A session QR code is generated that a polling official scans on the citizen's behalf. The citizen's vote is submitted without the official having visibility into the ballot choice. Required for digital equity and for challenging legitimacy objections.

---

## Files to be created (Phase 3 onwards)

```
ogp/
└── civic-app/                        ← Expo project root (Phase 3)
    ├── app/                          ← expo-router screens
    │   ├── (tabs)/
    │   │   ├── identity.tsx
    │   │   ├── proposals.tsx
    │   │   ├── briefing.tsx
    │   │   └── oracle.tsx
    │   └── onboarding/
    │       ├── register.tsx
    │       └── lost-device.tsx
    ├── components/
    │   ├── BriefingCard.tsx
    │   ├── ProposalRow.tsx
    │   ├── QVSlider.tsx
    │   └── ZoomToggle.tsx
    └── src/
        └── api/
            ├── index.ts              ← single import point, routes via USE_MOCK_DATA
            └── adapters/
                ├── civic-id.adapter.ts
                ├── civic-qv.adapter.ts
                ├── civic-ai.adapter.ts
                └── civic-oracle.adapter.ts
```

---

## Design prototype reference

A fully interactive HTML prototype (v4) was produced in Claude and captures all tab layouts, QV slider behaviour, inline briefing previews, text zoom, and the data-driven briefing swap system. It is stored in `ogp/docs/OGP-portal-prototype-v4.html` (to be committed — not yet in repo).

The prototype uses only browser-native HTML, CSS, and vanilla JS with no build step — open in any browser to view and interact.
