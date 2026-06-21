# OGP Phase 1 — Key Recovery Architecture
**Paste OGP-master-context.md first, then this document.**

---

## What this conversation must accomplish

Phase 1 has one non-negotiable gate: the `RevocationRegistry` contract skeleton must exist in the repo before any frontend onboarding code is written. This conversation builds that contract, locks the burn authority governance rule in writing, designs the reissuance sequence, and documents everything in `/docs`.

---

## Phase 1 tasks (in order)

### Task 1a — Burn authority governance rule
**Decision already made:** Multi-sig between accredited KYC authorities. OGP never holds unilateral burn power.

**What needs to be written down and committed to `/docs`:**
- Minimum number of KYC authority keyholders required to sign a burn transaction (recommend: 2-of-3 minimum, 3-of-5 for production)
- What constitutes an "accredited KYC authority" in OGP's governance model
- What on-chain record proves a burn was legitimately authorised (not just executed)
- What happens if a KYC authority's own keys are compromised

### Task 1b — Government-backed reissuance flow design
**Agreed flow:**
1. Citizen reports lost/compromised device to accredited KYC authority
2. KYC authority performs fresh liveness verification and identity re-check
3. Multi-sig burn transaction signed by quorum of KYC authority keyholders
4. Old NFT burned on XRPL — token ID written to `RevocationRegistry` on Polygon
5. New NFT minted to new key pair on XRPL
6. New identity committed to Merkle tree in civic-oracle
7. Citizen receives new credentials via onboarding flow

**What this conversation needs to produce:**
- Sequence diagram for the above flow (for `/docs`)
- Decision on how long between burn and new mint (to prevent race conditions)
- Decision on what the citizen does during the gap (temporary token? no voting? grace period?)

### Task 1c — Document reissuance spec in `/docs`
Create `/docs/key-recovery.md` containing:
- The full reissuance sequence
- The burn authority governance rule
- The multi-sig configuration
- Edge cases: what if the KYC authority is unavailable? What if the citizen is in a jurisdiction without a KYC authority?

### Task 1d — RevocationRegistry contract skeleton
**File location:** `civic-qv/contracts/RevocationRegistry.sol`

**What it must do:**
- Store burned XRPL NFToken IDs (as `bytes32` — consistent with existing leaf encoding)
- Store the Polygon epoch and block number at the time of burn (for audit trail)
- Store which KYC authority multi-sig authorised the burn
- Expose a `isRevoked(bytes32 tokenId)` view function — this is what `HierarchicalIdentityVerifier` will call before accepting an identity proof
- Emit a `TokenRevoked` event with full burn metadata
- Access control: only authorised KYC authority multi-sig addresses can call `revokeToken()`
- Immutable: no function to un-revoke a token (burns are permanent)

**Relationship to existing contracts:**
- `HierarchicalIdentityVerifier.sol` will need a small update: before accepting a ZK identity proof, it calls `RevocationRegistry.isRevoked()` and reverts if true
- This is a one-function addition to the existing verifier — minimal change to working code

### Task 1e — Citizen-facing "lost device" UI design (spec only — not built yet)
Produce a written spec for `/docs/ux-lost-device.md`:
- What the citizen sees when they select "I lost my device / need to recover my identity"
- Plain-language explanation of the reissuance process
- How the citizen finds their KYC authority (directory lookup)
- What the citizen does during the gap between burn and new mint
- What confirmation they receive when the new token is issued

---

## Contracts context

### Existing relevant contracts
```
civic-qv/contracts/
└── HierarchicalIdentityVerifier.sol   ← canonical identity contract
```

### New contract to create
```
civic-qv/contracts/
└── RevocationRegistry.sol             ← Phase 1 deliverable
```

### Existing deployment script
```
civic-qv/scripts/
└── deploy-hierarchical-local.ts       ← will need updating to deploy RevocationRegistry too
```

---

## Technical constraints to respect

- Solidity 0.8.24
- OpenZeppelin v5 (access control, ownable patterns)
- Do not change any existing tested contract logic — only add `isRevoked()` call to `HierarchicalIdentityVerifier`
- All XRPL token IDs stored as `bytes32` (consistent with `keccak256(utf8Bytes(xrplAddress))` encoding)
- Local Hardhat node is the test environment — no public testnet

---

## Definition of "Phase 1 complete"

- [ ] Burn authority governance rule written and committed to `/docs/key-recovery.md`
- [ ] Reissuance sequence diagram in `/docs/key-recovery.md`
- [ ] `RevocationRegistry.sol` created and compiles without errors
- [ ] `HierarchicalIdentityVerifier.sol` updated to call `isRevoked()` before accepting proofs
- [ ] `deploy-hierarchical-local.ts` updated to deploy `RevocationRegistry`
- [ ] Basic Hardhat test: mint identity → revoke → confirm proof rejected → reissue → confirm proof accepted
- [ ] `/docs/ux-lost-device.md` written (spec only, no frontend code)

---

## What Phase 1 does NOT include

- No frontend code of any kind
- No KYC provider integration
- No XRPL burn transaction implementation (civic-id layer — Phase 1 only handles the Polygon-side registry)
- No multi-sig wallet deployment (governance rule is documented; actual multi-sig wallet is a Phase 6 / production concern)

---

## Handoff to Phase 2

Once Phase 1 is complete, the Phase 2 conversation can begin using `OGP-phase2-context.md`. Phase 2 does not depend on Phase 1 contracts being deployed — it depends only on them existing and compiling, so the mock data layer can reference the right contract interfaces.
