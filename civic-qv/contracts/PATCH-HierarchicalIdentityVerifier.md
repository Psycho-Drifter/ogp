# TASK: Patch HierarchicalIdentityVerifier.sol
# File: civic-qv/contracts/PATCH-HierarchicalIdentityVerifier.md
# Status: PENDING — delete this file after successful compilation

---

## What this task is

Apply a minimal, three-addition patch to `HierarchicalIdentityVerifier.sol`
(located in the same directory as this file). Do not change any existing logic.
The patch wires in a revocation check so that ZK identity proofs from burned
citizen identities are rejected before verification runs.

---

## Architectural context — read before editing

### Why AuthorityRegistry is a separate contract (Option B)

We chose to keep authority management in a dedicated `AuthorityRegistry.sol`
rather than inside `RevocationRegistry.sol`. The reason is immutability.

If authority management lived inside `RevocationRegistry`, the contract would
need an `updateAuthorityRegistry()` function to allow future governance changes.
That function would be a permanent attack surface — whoever could call it could
redirect authority lookups to a contract they control, granting themselves
unilateral burn power over citizen identities.

With the separate contract, `RevocationRegistry` stores the `AuthorityRegistry`
address as an `immutable` — set once in the constructor, never changeable.
`RevocationRegistry`'s trust relationship is fixed at deployment. Authority
accreditation can still evolve (new authorities added, compromised ones removed)
but `RevocationRegistry` will always look in exactly the place it was told to
at birth.

### The mapping key problem and how it was fixed

The original spec said to store burned tokens by their XRPL NFTokenID. But
`HierarchicalIdentityVerifier` processes ZK proofs whose public inputs contain
the IDENTITY COMMITMENT — `keccak256(utf8Bytes(xrplAddress))` — which is the
Merkle leaf value used throughout civic-oracle. This is a different `bytes32`
from the NFTokenID.

If we had keyed `RevocationRegistry` by NFTokenID, the verifier couldn't call
`isRevoked()` because it doesn't have the NFTokenID — only the commitment.

**The fix:** `RevocationRegistry._revocations` is keyed by identity commitment.
The NFTokenID is stored as the `xrplNftokenId` field inside `RevocationRecord`
for audit and XRPL-side cross-referencing. The KYC authority passes both values
when calling `revokeToken()`.

`HierarchicalIdentityVerifier` therefore calls:
```solidity
revocationRegistry.isRevoked(identityCommitment)
```
where `identityCommitment` is `keccak256(utf8Bytes(xrplAddress))` extracted
from the ZK proof's public inputs — exactly what it already has.

### What the identity commitment is

Throughout this codebase, an identity is represented as:
```
identityCommitment = keccak256(utf8Bytes(xrplAddress))
```
This is the Merkle leaf value in civic-oracle's depth-64 sparse Merkle tree.
It is the only identity-related value present in the ZK proof's public inputs
on the Polygon side. The raw XRPL NFTokenID is an XRPL-layer concept that
does not cross into the ZK circuit.

---

## Step 1 — Read HierarchicalIdentityVerifier.sol first

Before making any changes, read the full source of `HierarchicalIdentityVerifier.sol`.
Identify:

1. All existing import statements (you will add one more)
2. All existing state variables (you will add one more)
3. The constructor signature — note every parameter name and type in order
4. The function that verifies a ZK identity proof — the function where:
   - Public inputs from the proof are extracted
   - The Merkle root is checked
   - The ZK proof itself is verified
   Find the line where the identity commitment (`bytes32`) is extracted
   from the public inputs. That is where the revocation check is inserted.

---

## Step 2 — Apply the three additions

### Addition 1: Import

Add after the last existing import line:

```solidity
import "./RevocationRegistry.sol";
```

### Addition 2: State variable

Add in the state variable block, after existing state variables:

```solidity
/**
 * @notice Immutable reference to the RevocationRegistry.
 *         Set once at deployment. Cannot be changed.
 *         Every identity proof is checked against this registry
 *         before being accepted.
 */
RevocationRegistry public immutable revocationRegistry;
```

### Addition 3a: Constructor parameter

Add `address _revocationRegistry` as the LAST parameter in the constructor
signature. All existing parameters stay in place, in their existing order.

### Addition 3b: Constructor body assignment

Add these two lines at the END of the constructor body, after all existing
assignment logic:

```solidity
require(_revocationRegistry != address(0), "HierarchicalIdentityVerifier: zero revocation registry");
revocationRegistry = RevocationRegistry(_revocationRegistry);
```

### Addition 3c: Revocation check in proof verification function

Inside the proof verification function, locate where the identity commitment
is extracted from the ZK proof's public inputs. It will be a `bytes32` value
equal to `keccak256(utf8Bytes(xrplAddress))`.

Insert this block IMMEDIATELY AFTER that extraction, BEFORE the Merkle root
check and BEFORE the ZK proof verification call. Fail fast — no point running
expensive ZK verification on a revoked identity.

```solidity
// Phase 1 — Revocation check.
// Reject proofs from revoked identities before any further verification.
// identityCommitment = keccak256(utf8Bytes(xrplAddress)) from ZK public inputs.
require(
    !revocationRegistry.isRevoked(identityCommitment),
    "HierarchicalIdentityVerifier: identity has been revoked"
);
```

Replace `identityCommitment` with whatever the local variable is actually
named in the existing code.

---

## Step 3 — Verify compilation

Run from the `civic-qv/` directory:

```bash
npx hardhat compile
```

Expected output: compilation succeeds with no errors. Warnings about unused
variables or similar are acceptable. Any error must be resolved before
proceeding.

---

## Step 4 — Report the constructor signature

After reading `HierarchicalIdentityVerifier.sol` and before or after applying
the patch, extract the constructor's complete parameter list (names and types,
in order, including the new `_revocationRegistry` parameter you added).

Report it in this format so the deploy script can be updated:

```
Constructor parameters (post-patch):
  1. <type> <name>   ← existing
  2. <type> <name>   ← existing
  ...
  N. address _revocationRegistry   ← added by this patch
```

The deploy script at `civic-qv/scripts/deploy-hierarchical-local.ts` contains
a placeholder comment:
```
// ← INSERT YOUR EXISTING CONSTRUCTOR ARGUMENTS HERE
```
That placeholder must be replaced with the correct arguments in the correct
order. The final argument is always `revocationRegistryAddress`.

---

## Step 5 — Clean up

Once compilation succeeds and the constructor signature has been reported,
delete this file (`PATCH-HierarchicalIdentityVerifier.md`) from the
`civic-qv/contracts/` directory. It is a task instruction, not a permanent
artifact.

---

## What NOT to do

- Do not modify any existing function logic
- Do not change the Merkle root check
- Do not change access control on any existing function
- Do not add any new public functions beyond what is specified above
- Do not change contract storage layout — `immutable` variables are stored
  in bytecode, not in storage slots, so no layout shift occurs
- Do not reorganise imports or reformat existing code
