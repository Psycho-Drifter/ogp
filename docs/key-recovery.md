# Key Recovery Architecture
**Open Governance Protocol — `/docs/key-recovery.md`**
*Last updated: Phase 1*

---

## Overview

Citizen identity in OGP is issued as a soulbound NFT on the XRPL (civic-id layer). Because the token is non-transferable and tied to a specific key pair, loss or compromise of a citizen's private key requires a formal reissuance process — not a simple key rotation. This document defines the governance rules, on-chain mechanics, and reissuance sequence for key recovery in OGP.

**Core principle:** OGP itself never holds burn authority. No single actor — including OGP's own governance council — can unilaterally erase a citizen's identity. Burn authority is held exclusively by accredited KYC authorities, exercised only through a multi-sig quorum.

---

## 1. Burn Authority Governance Rule

### 1.1 Multi-sig threshold

| Environment | Configuration | Rationale |
|---|---|---|
| PoC / development | 2-of-3 | Minimum viable safety — one compromised key cannot act alone |
| Production | 3-of-5 | Collusion resistance — three independent institutions must coordinate |

The threshold is encoded as a configurable constructor parameter in `RevocationRegistry.sol` from day one, so the contract architecture does not change between PoC and production deployment. Only the threshold value changes.

### 1.2 What constitutes an accredited KYC authority

KYC authorities are accredited in three tiers:

**Tier 1 — National government identity agencies (production)**
Passport offices, national ID bureaus, and civil registration authorities. These institutions already hold legal jurisdiction over identity in their territory and have existing liveness verification infrastructure. Tier 1 is the intended permanent operating model.

**Tier 2 — Internationally recognised non-governmental identity organisations (transitional)**
Organisations such as UNHCR, operating under international mandate, providing identity services to stateless persons and refugees who lack access to Tier 1 institutions. Tier 2 prevents OGP from being structurally inaccessible to populations without state-backed identity.

**Tier 3 — Designated test authorities (PoC only)**
Addresses explicitly flagged on-chain as non-production. These are valid only in PoC and development deployments. Tier 3 addresses cannot be registered in a production deployment of `RevocationRegistry.sol`.

**Critical distinction:** Accreditation is granted by OGP's constitutional governance layer — not by OGP's development team, and not by the contract deployer. The smart contract encodes *that* an address has been granted authority through the governance process. It does not encode *who* deserves that authority. The governance process that determines accreditation is separate from, and precedes, any on-chain registration.

### 1.3 OGP governance council and multi-sig participation

OGP's own governance council holds **no seat** in any KYC authority multi-sig. Burn authority belongs entirely to accredited KYC authorities. This is intentional:

- OGP is infrastructure, not an authority. Its constitutional architecture — separation of powers, independent prosecutor, court hierarchy — is the structural guarantee against identity erasure, not OGP's presence in a signing quorum.
- A governance council seat would create a single point of legal and political pressure. A court order or state coercion directed at OGP could compel that seat to sign.
- Placing OGP outside the signing structure makes the protocol's integrity a property of its design, not of OGP's continued trustworthiness.

### 1.4 On-chain proof of authorised burn

Every burn recorded in `RevocationRegistry.sol` must include:

1. **Authorising multi-sig address** — the KYC authority wallet that submitted the quorum-signed transaction
2. **Burn reason code** — declared intent, one of: `LOST_DEVICE`, `COMPROMISED_KEY`, `DEATH`, `FRAUD_INVESTIGATION`, `REISSUANCE`
3. **Case reference hash** — `bytes32` hash of the KYC authority's off-chain case file (liveness re-check record, identity verification documentation). The document remains off-chain for citizen privacy; the hash proves it existed at burn time and allows the authority to produce it if the burn is challenged.
4. **Block number and timestamp** — audit anchor and burn/reissuance gap enforcement

This provides a complete, verifiable audit trail: *which authority authorised this burn, for what declared reason, with a reference to what supporting documentation, at what point in time* — without placing citizen personal data on-chain.

---

## 2. Reissuance Sequence

### 2.1 Full sequence

```
Citizen                KYC Authority              civic-id (XRPL)        civic-oracle (Polygon)
   |                        |                            |                        |
   |-- Report lost/         |                            |                        |
   |   compromised device ->|                            |                        |
   |                        |                            |                        |
   |                        |-- Perform liveness         |                        |
   |                        |   verification &           |                        |
   |                        |   identity re-check        |                        |
   |                        |   (off-chain)              |                        |
   |                        |                            |                        |
   |                        |-- Assemble case file,      |                        |
   |                        |   compute reference hash   |                        |
   |                        |                            |                        |
   |                        |-- Collect quorum           |                        |
   |                        |   signatures (multi-sig)   |                        |
   |                        |                            |                        |
   |                        |-- Submit burn tx --------->|                        |
   |                        |                            |-- NFT burned on XRPL   |
   |                        |                            |                        |
   |                        |-- Call revokeToken() -------------------------------->|
   |                        |                            |   RevocationRegistry   |
   |                        |                            |   records: tokenId,    |
   |                        |                            |   authority, reason,   |
   |                        |                            |   refHash, block       |
   |                        |                            |                        |
   |<-- Notified: identity  |                            |                        |
   |    revoked, gap period |                            |                        |
   |    begins              |                            |                        |
   |                        |                            |                        |
   |    [GAP PERIOD — see 2.2]                           |                        |
   |                        |                            |                        |
   |-- Present at KYC       |                            |                        |
   |   authority (or        |                            |                        |
   |   remote channel) ---->|                            |                        |
   |                        |-- Mint new NFT to          |                        |
   |                        |   new key pair ----------->|                        |
   |                        |                            |-- New NFTokenID        |
   |                        |                            |   returned             |
   |                        |                            |                        |
   |                        |-- Commit new identity -------------------------------->|
   |                        |                            |   New leaf added to    |
   |                        |                            |   Merkle tree          |
   |                        |                            |   New root published   |
   |                        |                            |                        |
   |<-- New credentials     |                            |                        |
   |    delivered           |                            |                        |
```

### 2.2 Gap period between burn and new mint

**Duration: minimum 24 hours, recommended 72 hours.**

Rationale: A gap is required to prevent race conditions where an attacker who has stolen a citizen's credentials attempts to mint a new identity before the legitimate citizen reports the compromise. The gap window is enforced at the application layer — the KYC authority's workflow management system — not in the contract. The contract records the burn block number; the minting workflow checks that sufficient blocks have elapsed before proceeding.

**What the citizen does during the gap:**

- The citizen's old identity is marked revoked in `RevocationRegistry`. Any ZK proof generated from the old token will be rejected by `HierarchicalIdentityVerifier`.
- The citizen **cannot vote** during the gap. This is unavoidable and intentional — a contested identity cannot participate in governance.
- The citizen receives a **non-voting acknowledgement token** (off-chain, issued by the KYC authority) confirming that reissuance is in progress. This is for citizen communication only and has no on-chain status.
- If a vote closes during the gap period and the citizen believes they were disenfranchised by a malicious burn, they have standing to challenge the burn through OGP's court hierarchy.

### 2.3 Reissuance completes the loop

Once the new NFT is minted on XRPL and the new leaf is committed to the Merkle tree by civic-oracle, the citizen is fully restored. The old token ID remains permanently in `RevocationRegistry` — it cannot be reinstated. The new token ID is a fresh credential with no association to the old one on-chain (the KYC authority's off-chain case file is the link between old and new identity for human accountability purposes).

---

## 3. KYC Authority Key Compromise

If a KYC authority's own signing keys are compromised:

### 3.1 Immediate response — deauthorisation

Any other accredited KYC authority can submit a `deauthoriseAuthority(address compromisedAuthority)` transaction to `RevocationRegistry`. This requires the **same multi-sig threshold** as a burn — you cannot have a single authority deauthorise another unilaterally.

The compromised authority's address is added to a `RevokedAuthorities` mapping. From that point, the compromised address cannot participate in burn quorums.

### 3.2 Historical burns are not retroactively invalidated

Burns previously executed with participation from the compromised authority **are not reversed**. Retroactive invalidation would create a window where already-revoked identities briefly appear valid again — a far worse outcome than leaving historical burns in place. Citizens whose identities were burned through a compromised authority still need to initiate reissuance if their burn was illegitimate, but the registry record stands.

The case for challenging a specific burn as illegitimate proceeds through OGP's court hierarchy, not through contract-level invalidation.

### 3.3 Governance escalation

A compromised KYC authority triggers a constitutional-level review of that authority's accreditation. The outcome — suspension, permanent deaccreditation, or restoration — is a governance process. The contract records the deauthorisation; enforcement of the governance outcome is off-chain.

---

## 4. Edge Cases

### 4.1 KYC authority is unavailable

If a citizen's jurisdictional KYC authority is temporarily unavailable (technical outage, administrative disruption):

- The citizen's identity remains valid — unavailability of the KYC authority does not trigger any on-chain action.
- Reissuance is delayed until the authority is restored. This is a known limitation: identity recovery requires a functioning KYC authority. The system does not provide a workaround that would bypass this requirement, as any bypass creates an attack surface.
- Tier 2 authorities (UNHCR and equivalents) may be able to provide interim reissuance for eligible citizens where jurisdictional authority is genuinely non-functional for an extended period, subject to OGP's governance process for cross-tier reissuance.

### 4.2 Citizen is in a jurisdiction without a KYC authority

If no accredited KYC authority operates in a citizen's jurisdiction:

- In the short term, this citizen cannot recover their identity through the standard reissuance flow. This is an honest limitation of the current architecture.
- Tier 2 (UNHCR-equivalent) coverage is the mitigation path for stateless persons and citizens in jurisdictions without state-backed identity infrastructure.
- Expanding KYC authority coverage is a governance and legal implementation concern, not an infrastructure concern. The contract architecture does not change — only the set of accredited authorities grows over time.

### 4.3 Citizen death

Burn reason code `DEATH` is included in the enum. A KYC authority can submit a burn on behalf of a deceased citizen using the standard multi-sig flow. The reference hash points to the off-chain death verification documentation. The burned token ID is permanently recorded as revoked. No reissuance follows.

---

## 5. Contract Reference

| Contract | Location | Role in key recovery |
|---|---|---|
| `RevocationRegistry.sol` | `civic-qv/contracts/` | Stores all burned token IDs, burn metadata, and KYC authority registry |
| `HierarchicalIdentityVerifier.sol` | `civic-qv/contracts/` | Calls `RevocationRegistry.isRevoked()` before accepting any ZK identity proof |

### Key `RevocationRegistry` interface (summary)

```solidity
// Record a burned token — callable only by authorised KYC authority multi-sig
function revokeToken(
    bytes32 tokenId,
    BurnReason reason,
    bytes32 caseReferenceHash
) external;

// Called by HierarchicalIdentityVerifier before accepting a proof
function isRevoked(bytes32 tokenId) external view returns (bool);

// Deauthorise a compromised KYC authority — requires multi-sig quorum
function deauthoriseAuthority(address authority) external;

// Event emitted on every burn
event TokenRevoked(
    bytes32 indexed tokenId,
    address indexed authority,
    BurnReason reason,
    bytes32 caseReferenceHash,
    uint256 blockNumber,
    uint256 timestamp
);
```

---

## 6. What Phase 1 Does Not Cover

- No XRPL-side burn transaction implementation — the XRPL burn is civic-id layer work, handled separately. `RevocationRegistry` records the Polygon-side fact of revocation.
- No multi-sig wallet deployment — the governance rule is documented here; the actual multi-sig wallet infrastructure is a Phase 6 / production concern.
- No KYC provider integration — PoC uses manual admin minting. Automated KYC slots in later without changing the contract architecture.
- No frontend implementation — UX for the lost device flow is specified separately in `/docs/ux-lost-device.md`.
