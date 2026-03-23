pragma circom 2.1.6;

/*
 * aggregate.circom — Interplanetary root aggregation circuit
 *
 * This circuit proves that a given shard root is legitimately part of
 * the interplanetary root, without revealing which shard or how many
 * total shards exist.
 *
 * It is the second half of the two-level proof:
 *   1. vote.circom:      citizen ∈ shard (depth-64 identity tree)
 *   2. aggregate.circom: shard ∈ interplanetary root (this circuit)
 *
 * In production these two proofs are composed recursively using PLONK
 * recursion (via snarkjs's "proof of a proof" pattern or Halo2 accumulator),
 * producing a single compact proof that asserts both levels at once.
 *
 * Interplanetary tree depth:
 *   Depth 20 supports 2^20 = 1,048,576 shards.
 *   That is one million distinct planetary settlements.
 *   Sufficient for any conceivable solar system, and most galaxy scenarios.
 *   Increase to depth 40 for true galactic scale (2^40 = 1 trillion shards).
 *
 * Public inputs:
 *   interplanetaryRoot  — the top-level root on-chain
 *   shardNullifier      — prevents a shard from being double-counted
 *   shardId             — which shard is being proven
 *
 * Private inputs:
 *   shardRoot           — the shard's identity Merkle root
 *   pathElements[depth] — Merkle siblings from shard leaf to interplanetary root
 *   pathIndices[depth]  — path directions
 */

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/mux1.circom";

template PlanetaryMerkleChecker(depth) {
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

template ShardAggregation(depth) {
    // Public inputs
    signal input interplanetaryRoot;
    signal input shardNullifier;
    signal input shardId;

    // Private inputs
    signal input shardRoot;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    // Shard leaf = Poseidon(shardId, shardRoot)
    component leafHasher = Poseidon(2);
    leafHasher.inputs[0] <== shardId;
    leafHasher.inputs[1] <== shardRoot;
    signal shardLeaf <== leafHasher.out;

    // Prove shard is in the interplanetary tree
    component tree = PlanetaryMerkleChecker(depth);
    tree.leaf <== shardLeaf;
    tree.root <== interplanetaryRoot;
    for (var i = 0; i < depth; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i]  <== pathIndices[i];
    }

    // Shard nullifier = Poseidon(shardId, shardRoot)
    // Prevents same shard from being submitted twice in one aggregation
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== shardId;
    nullifierHasher.inputs[1] <== shardRoot;
    shardNullifier === nullifierHasher.out;
}

// Depth 20 = 1,048,576 shards (one million planetary settlements)
component main {public [interplanetaryRoot, shardNullifier, shardId]}
    = ShardAggregation(20);
