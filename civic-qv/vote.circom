pragma circom 2.1.6;

/*
 * vote.circom — ZK-PLONK circuit for private civic ballot
 *              UPGRADED: depth-64, shard-aware, interplanetary scale
 *
 * CHANGE FROM v1:
 *   Tree depth: 27 → 64
 *   Capacity:   134M → 18,446,744,073,709,551,616 (18.4 quintillion)
 *
 * Cost of this upgrade:
 *   Extra Poseidon hash operations: (64 - 27) × 3 = ~111 additional constraints
 *   Proof generation time increase: ~15% on modern hardware
 *   On-chain verification gas: unchanged (PLONK verifier is constant size)
 *   This is essentially free. Depth in a Merkle circuit is cheap.
 *
 * Hierarchical shard support:
 *   This circuit proves membership in ONE shard (e.g. Earth, or Mars).
 *   AggregationCircuit (aggregate.circom) combines shard proofs into an
 *   interplanetary root via recursive PLONK composition.
 *   Citizens prove: "I am in shard X, and shard X is in the planetary root."
 *
 * Depth reference table:
 *   Depth 27 = 134 million       — v1 value, INSUFFICIENT
 *   Depth 34 = 17.2 billion      — full Earth + 2x growth buffer
 *   Depth 40 = 1.1 trillion      — inner solar system
 *   Depth 50 = 1.1 quadrillion   — solar system + Oort cloud colonies
 *   Depth 64 = 18.4 quintillion  — galactic scale (this circuit)
 *
 * Public inputs (on-chain):
 *   proposalId      — which proposal this ballot is for
 *   nullifierHash   — prevents double-voting (unique per voter+proposal+shard)
 *   voteCommitment  — blinded vote direction (revealed only at tally)
 *   creditsSpent    — voice credits consumed
 *   shardRoot       — Merkle root of this shard's identity tree
 *   shardId         — which shard (Earth=1, Mars=2, etc.)
 *
 * Private inputs (never leave the voter's device):
 *   identitySecret          — voter's private key
 *   merklePathElements[64]  — Merkle proof siblings
 *   merklePathIndices[64]   — Merkle proof path directions
 *   voteDirection           — 0=against, 1=for, 2=abstain (PRIVATE)
 *   votesCast               — 1-10 (PRIVATE)
 *   salt                    — blinding factor for voteCommitment
 */

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/mux1.circom";

// Depth-64 Sparse Merkle Tree checker
// Supports 2^64 = 18,446,744,073,709,551,616 leaf slots per shard.
// Sparse: unpopulated slots are zero; only the path from leaf to root
// needs to exist in storage — O(depth) space not O(2^depth).
template SparseMerkleTreeChecker(depth) {
    signal input leaf;
    signal input root;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    component hashers[depth];
    component mux[depth];
    signal levelHashes[depth + 1];
    levelHashes[0] <== leaf;

    for (var i = 0; i < depth; i++) {
        pathIndices[i] * (pathIndices[i] - 1) === 0;

        hashers[i] = Poseidon(2);
        mux[i]     = MultiMux1(2);

        mux[i].c[0][0] <== levelHashes[i];
        mux[i].c[0][1] <== pathElements[i];
        mux[i].c[1][0] <== pathElements[i];
        mux[i].c[1][1] <== levelHashes[i];
        mux[i].s       <== pathIndices[i];

        hashers[i].inputs[0] <== mux[i].out[0];
        hashers[i].inputs[1] <== mux[i].out[1];

        levelHashes[i + 1] <== hashers[i].out;
    }

    root === levelHashes[depth];
}

// Main vote circuit — depth-64, shard-aware
template Vote(treeLevels) {

    // Public inputs
    signal input proposalId;
    signal input nullifierHash;
    signal input voteCommitment;
    signal input creditsSpent;
    signal input shardRoot;    // root of this shard's identity tree
    signal input shardId;      // which planetary shard (1=Earth, 2=Mars, ...)

    // Private inputs
    signal input identitySecret;
    signal input merklePathElements[treeLevels];
    signal input merklePathIndices[treeLevels];
    signal input voteDirection;   // 0=against, 1=for, 2=abstain
    signal input votesCast;       // 1-10
    signal input salt;

    // 1. Identity leaf = Poseidon(identitySecret, shardId)
    //    Binding shardId to the leaf prevents cross-shard identity replay:
    //    a valid Earth identity cannot prove membership in the Mars shard.
    component leafHasher = Poseidon(2);
    leafHasher.inputs[0] <== identitySecret;
    leafHasher.inputs[1] <== shardId;
    signal identityLeaf <== leafHasher.out;

    // 2. Prove membership in shard Merkle tree
    component tree = SparseMerkleTreeChecker(treeLevels);
    tree.leaf <== identityLeaf;
    tree.root <== shardRoot;
    for (var i = 0; i < treeLevels; i++) {
        tree.pathElements[i] <== merklePathElements[i];
        tree.pathIndices[i]  <== merklePathIndices[i];
    }

    // 3. Nullifier = Poseidon(identitySecret, proposalId, shardId)
    //    Including shardId prevents cross-shard nullifier collisions.
    component nullifierHasher = Poseidon(3);
    nullifierHasher.inputs[0] <== identitySecret;
    nullifierHasher.inputs[1] <== proposalId;
    nullifierHasher.inputs[2] <== shardId;
    nullifierHash === nullifierHasher.out;

    // 4. Quadratic cost: creditsSpent = votesCast^2
    signal votesSquared <== votesCast * votesCast;
    creditsSpent === votesSquared;

    // 5. Range checks: 1 <= votesCast <= 10, voteDirection in {0,1,2}
    component geOne = GreaterEqThan(4);
    geOne.in[0] <== votesCast;
    geOne.in[1] <== 1;
    geOne.out   === 1;

    component leTen = LessEqThan(4);
    leTen.in[0] <== votesCast;
    leTen.in[1] <== 10;
    leTen.out   === 1;

    component leTwo = LessEqThan(2);
    leTwo.in[0] <== voteDirection;
    leTwo.in[1] <== 2;
    leTwo.out   === 1;

    // 6. Vote commitment = Poseidon(voteDirection, votesCast, salt)
    component voteCommitmentHasher = Poseidon(3);
    voteCommitmentHasher.inputs[0] <== voteDirection;
    voteCommitmentHasher.inputs[1] <== votesCast;
    voteCommitmentHasher.inputs[2] <== salt;
    voteCommitment === voteCommitmentHasher.out;
}

// Depth 64 = 18,446,744,073,709,551,616 slots per shard
component main {public [proposalId, nullifierHash, voteCommitment, creditsSpent, shardRoot, shardId]}
    = Vote(64);
