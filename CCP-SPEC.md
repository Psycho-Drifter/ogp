# Civic Continuity Protocol (CCP)
### Open Governance Protocol — Operational Specification v0.1

---

## Overview

The Civic Continuity Protocol (CCP) is a constitutionally embedded operational provision ensuring that OGP governance functions remain accessible and legitimate during connectivity disruptions, natural disasters, armed conflict, and infrastructure failure. CCP is not emergency law — it is resilience infrastructure and a structural guarantee of digital access equity.

CCP addresses four core questions:
1. **When** does it activate and deactivate?
2. **Who** can participate and how?
3. **How** does offline state reconcile with on-chain state?
4. **What** prevents fraud, coercion, and cryptographic abuse during the offline window?

---

## 1. Trigger Conditions & Outage Classification

CCP activates when a civic district loses verifiable connectivity to both the XRPL and Polygon networks. Activation is declared by any **2-of-3 quorum nodes** in the district detecting the same condition independently for **>30 minutes continuously**.

Deactivation requires confirmed connectivity restoration and a successful Merkle root sync from at least 2 quorum nodes.

### Tiered Outage Classification

| Tier | Duration | Cause | Governance Mode |
|------|----------|-------|-----------------|
| **Tier 1 — Routine** | < 72 hours | Localised outage, maintenance, weather | Standard CCP: local quorum voting, settlement on restore |
| **Tier 2 — Extended** | 72 hours – 30 days | Regional disaster, infrastructure attack, conflict | Constitutional suspension of non-essential votes. Only critical governance permitted (emergency resource allocation, disaster response). Quorum threshold increases to **5-of-7**. |
| **Tier 3 — Catastrophic** | > 30 days | Sustained war, grid collapse, civilisational disruption | Full civic reconstitution protocol: physically convened assemblies at pre-designated constitutional assembly points. Cryptographic paper ballots recorded and committed on-chain when connectivity restores. |

> **Constitutional mandate:** Each civic district must designate and maintain at least one physical assembly point for Tier 3 activation. This location is publicly recorded on-chain during normal operation.

---

## 2. Quorum Nodes

### Constitutional Requirements
- **Minimum per district:** 3 (floor, not ceiling — scales with district population and risk profile)
- **Tier 2 minimum:** 7 per district
- Operation of a quorum node is a constitutionally recognised **civic duty**, compensated by a modest operational stipend from the Citizen Prosperity Fund (CPF)

### Hardware Requirements
- Power: Solar, battery, hydro, or other renewable/independent source capable of **72-hour autonomous operation**
- Connectivity: **Minimum two independent connectivity paths** (e.g., terrestrial internet + LEO satellite such as Starlink or Iridium). A true Tier 2/3 outage requires failure of all connectivity paths.
- Storage: Full local civic-oracle stack with last valid Merkle root cached, timestamped, and co-signed by 2-of-3 quorum nodes at cache time
- Compute: Sufficient to run local ZK proof verification and the civic-ai scenario engine in degraded mode (see Section 6)

### Validator Bond
- Quorum nodes stake a bond that is **slashable** for:
  - Provable vote fabrication
  - Co-signing fraudulent settlement batches
  - Inactivity during a declared CCP window (without force majeure justification)

---

## 3. Offline Participation Mode

### Identity Verification
Citizens present their civic-id QR code (generated during connected operation). The quorum node verifies the Sparse Merkle Tree (SMT) inclusion proof against the locally cached root. **No network connection required.**

### Voting (Tier 1 & 2)
The citizen submits their vote to the nearest quorum node. The node:
1. Validates the identity inclusion proof against the cached SMT root
2. Deducts QV credits from the local ledger (see Section 4 for credit deduction policy)
3. Issues a signed **vote acknowledgement** containing: `{ voteCommitment, citizenNullifier, timestamp, nodeSignature }` — this is **not** a vote receipt; it proves a valid vote was cast without revealing vote content (see Section 7 on coercion resistance)
4. Queues the transaction for on-chain settlement

### Paper Ballot Fallback (Tier 3 / All Quorum Nodes Offline)
- Pre-printed ballots containing citizen nullifiers are issued at physical assembly points
- Require **2-of-3 quorum node co-signatures** at settlement
- Valid only for **low-stakes votes** as constitutionally defined
- Not valid for constitutional amendments under any circumstances

### Scope Restrictions
| Vote Type | Tier 1 CCP | Tier 2 CCP | Tier 3 CCP |
|-----------|-----------|-----------|-----------|
| Routine civic decisions | ✅ | ✅ | ✅ (low-stakes only) |
| Emergency resource allocation | ✅ | ✅ | ✅ |
| Major policy (non-constitutional) | ✅ | ✅ | ❌ |
| Constitutional amendments | ❌ | ❌ | ❌ |

---

## 4. QV Credit Deduction During CCP Mode

### Policy: Conservative by Default

During CCP mode, each citizen is limited to spending a **floor allocation of 25% of their current QV credit balance**. This guarantees no conflict with concurrent on-chain spending during the outage window.

- Remaining credits are **locked** until settlement completes
- If a citizen also votes on-chain (e.g., via satellite before the quorum node is aware of restoration), nullifier collision is caught at settlement — both votes are **voided** and the bond is partially slashed

### Optional: Optimistic Mode (Tier 1 Only)
Districts may constitutionally elect to allow **optimistic credit deduction** (full balance available) during Tier 1 outages only, subject to:
- Elevated quorum node bond requirements
- Explicit district-level ratification
- Higher nullifier collision penalty

---

## 5. Settlement Window & On-Chain Reconciliation

- **Settlement window:** 72 hours after connectivity restores (Tier 1); extended proportionally for Tier 2/3
- Quorum nodes broadcast their queued transaction batch, signed with a Merkle proof of the offline ledger state
- The on-chain contract verifies:
  - Nullifiers not already consumed on-chain
  - Timestamps fall within the declared CCP activation window (anchored to the quorum node activation block)
  - 2-of-3 quorum node signatures present on the batch
  - QV credit deductions within permitted bounds
- Transactions outside the window are **invalid** and discarded

---

## 6. Fraud Prevention

| Attack Vector | Mitigation |
|---|---|
| Quorum node fabricates votes | 2-of-3 cross-signature required on all settlement batches |
| Citizen votes offline and online (double-spend) | Nullifier already consumed on-chain; offline vote rejected at settlement; bond partially slashed |
| Backdated votes submitted post-outage | CCP window timestamp anchored to quorum node activation block on-chain |
| Quorum node intentional inactivity | Slashable inactivity condition in bond contract |
| Fraudulent paper ballots (Tier 3) | 2-of-3 quorum node co-signatures required; physically witnessed and logged at assembly point |
| SMT root tampering | Root must be co-signed by 2-of-3 quorum nodes at cache time with timestamp |

---

## 7. Coercion Resistance

### Receipt-Free Voting
The system **never** produces a verifiable receipt linking a citizen to a specific vote choice. The signed acknowledgement proves a valid vote was submitted — it does not reveal vote content. This is enforced via ZK proof of valid submission.

### Re-Vote Window
During any open voting period (online or CCP mode), citizens may re-cast their vote. **Only the last valid submission counts.** The nullifier scheme uses a "last write wins" model within the window, allowing a coerced vote to be silently overridden.

### Duress Signal
A constitutionally protected duress mechanism is available via a separate private channel (e.g., a secondary QR code known only to the citizen). Votes accompanied by a duress flag are:
- Quarantined pending review
- Referred to the Independent Public Prosecutor
- Not revealed to the coercing party

### Physical Privacy (CCP Mode)
Quorum nodes are constitutionally **prohibited** from observing vote content. Any citizen may request to cast their CCP ballot alone in a designated private area. This is a non-waivable right.

---

## 8. CCP Transport Interface

OGP specifies a minimal **CCP Transport Interface** — a signed-packet format any transport layer can implement. OGP does not mandate a specific physical transport.

**Reference implementations:**
- LoRa / Meshtastic (primary off-grid reference)
- LEO satellite (Starlink, Iridium)
- SMS fallback
- Physical courier ("sneakernet") for Tier 3

**Packet format (all transports):**
```
{
  version: uint8,
  type: enum { VOTE | IDENTITY_CHECK | NODE_SYNC | SETTLEMENT_BATCH },
  payload: bytes,         // ZK-proof-wrapped, content-blind
  nodeSignature: bytes64,
  timestamp: uint64,
  ccpWindowId: bytes32    // Hash of activation block
}
```

Districts choose their transport stack. OGP ships a LoRa reference implementation as a civic-oracle plugin.

---

## 9. Civic-AI in CCP Mode

### Degraded Mode (Tier 1 & 2)
In CCP mode the full cloud AI pipeline (Anthropic API) is unavailable. Quorum nodes run a local Ollama instance serving:
- **Cached briefings** from the last successful sync (the most recent scenario engine output for active proposals)
- **Local inference** for emergency queries, using a capable open-weight model (Llama 3 70B or equivalent)

### Scenario Engine (`civic-ai/scenario-engine`)
A dedicated predictive modelling module, integrated into civic-ai, providing structured briefings for each active proposal:

**Inputs:**
- Proposed policy text
- Historical voting patterns (district and aggregate)
- Economic and social indicator feeds (cached at last sync in CCP mode)

**Output per briefing:**
```
{
  summary: string,
  bestCase: { description, probability, keyAssumptions },
  baseCase: { description, probability, keyAssumptions },
  worstCase: { description, probability, keyAssumptions },
  confidenceLevel: float,   // 0–1, lower when operating on stale data
  dataFreshness: timestamp  // When inputs were last updated
}
```

In CCP mode, `confidenceLevel` is automatically discounted and `dataFreshness` is displayed prominently to citizens. This preserves utility while maintaining epistemic honesty about data staleness.

**Rationale:** Predictive convergence framing is a powerful legitimacy mechanism — citizens can see *why* a vote outcome matters, not just what it proposes. The scenario engine makes this structural.

---

## 10. Digital Access Equity

CCP as an **operational provision** (not emergency law) reframes physical fallback infrastructure as a permanent equity guarantee. Key provisions:

- Physical assembly points (Tier 3) double as **permanent civic access points** for citizens without personal devices
- Quorum nodes are required to provide public walk-in identity verification and vote submission services during CCP mode
- The stipend model (CPF-funded) ensures that underserved communities are not disadvantaged by the cost of running civic infrastructure

---

## 11. Cryptographic Provisions

### Known Vulnerability Surface

| Vulnerability | Current Design | Mitigation |
|---|---|---|
| Nullifier linkability | Poseidon hash of identity + vote | Blinded commitment scheme to ensure nullifier does not leak identity |
| SMT root staleness | Quorum node caches last root | Root co-signed by 2-of-3 quorum nodes with timestamp at cache time |
| Proof forgery | Circom ZK-PLONK | Trusted setup ceremony required — constitutionally mandated |
| Quantum threat (long horizon) | PLONK is not post-quantum | Scheduled migration path to post-quantum ZK (STARKs) — see below |
| Private key compromise | Citizen holds key | Social recovery mechanism: constitutionally defined guardian model (TBD) |

### Trusted Setup Ceremony
The ZK-PLONK trusted setup is a constitutional obligation. The initial ceremony must be publicly documented and conducted with verifiable multi-party participation. Results are committed on-chain.

### Cryptographic Audit Provision
The OGP constitution mandates a **cryptographic audit every 5 years**, covering:
- ZK circuit soundness
- Nullifier scheme privacy guarantees
- Merkle tree construction and root integrity
- Emerging cryptographic threats (including quantum computing advances)

### Post-Quantum Transition
The constitution includes a **scheduled review provision** for post-quantum migration. PLONK is not post-quantum secure. The 5-year audit cycle triggers a formal assessment of STARK-based alternatives. Migration is a constitutional upgrade, not an emergency patch.

---

## 12. Open Questions (v0.1)

- [ ] Guardian model for private key social recovery — design TBD
- [ ] Exact constitutional threshold for "low-stakes" vs "high-stakes" vote classification
- [ ] LoRa reference implementation scope and hardware certification process
- [ ] Quorum node count formula relative to district population
- [ ] Tier 3 assembly point physical security requirements
- [ ] civic-ai/scenario-engine: model selection criteria for local Ollama instance in resource-constrained quorum nodes

---

## Appendix: Glossary

| Term | Definition |
|---|---|
| **CCP** | Civic Continuity Protocol — this document |
| **CPF** | Citizen Prosperity Fund — sovereign wealth fund distributing universal baseline to citizens, modelled on Norway's Government Pension Fund |
| **Quorum Node** | Constitutionally mandated local validator running the civic-oracle stack with resilient power and dual connectivity |
| **SMT** | Sparse Merkle Tree — used for ZK-provable identity inclusion (Poseidon hash) |
| **Nullifier** | One-time cryptographic token preventing double-voting |
| **CCP Window** | The declared period of CCP activation, anchored to a specific on-chain block |
| **Settlement** | Post-restoration submission of offline vote batch for on-chain verification |
| **LEO** | Low Earth Orbit satellite network (e.g., Starlink, Iridium) |
| **Scenario Engine** | civic-ai/scenario-engine module providing best/base/worst case predictive briefings |

---

*OGP Civic Continuity Protocol — v0.1 Draft*
*For review and iteration prior to constitutional embedding*
