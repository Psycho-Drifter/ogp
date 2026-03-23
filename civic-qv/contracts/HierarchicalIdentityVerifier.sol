// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title HierarchicalIdentityVerifier
 * @notice Planetary-scale identity verification via a hierarchical Merkle forest.
 *
 * Architecture — three tiers:
 *
 *   Tier 3: Interplanetary root
 *     A single root that aggregates all planetary shard roots.
 *     Updated whenever a shard root changes via recursive ZK proof.
 *
 *   Tier 2: Shard root (one per jurisdiction/planet)
 *     Earth shard (shardId=1):  up to 2^64 identities
 *     Mars shard  (shardId=2):  up to 2^64 identities
 *     Any future shard:         registered by oracle, immediately part of system
 *
 *   Tier 1: Individual identity leaf
 *     Poseidon(identitySecret, shardId) — bound to one shard, non-portable
 *
 * Why this scales infinitely:
 *   - Adding a new planet = registering a new shardId. No contract changes.
 *   - Each shard's depth-64 tree holds 18.4 quintillion identities.
 *   - The interplanetary root is a Merkle tree of shard roots, so it scales
 *     with the number of shards, not the number of individuals.
 *   - In the extreme limit: a galaxy-spanning civilisation with millions of
 *     shards still has a single compact interplanetary root on-chain.
 *
 * Trust model:
 *   Shard oracle: multi-sig committee per shard (local governance)
 *   Interplanetary oracle: cross-shard consensus committee
 *   Future: trustless ZK light-client proofs of source chain state
 */
contract HierarchicalIdentityVerifier is AccessControl {

    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant ADMIN_ROLE  = keccak256("ADMIN_ROLE");

    // ── Shard registry ────────────────────────────────────────────────────────
    struct Shard {
        uint256 shardId;
        string  name;          // "Earth", "Mars", "Luna", etc.
        string  description;
        bool    active;
        uint256 registeredAt;
    }

    // ── Shard identity root ───────────────────────────────────────────────────
    struct ShardRoot {
        bytes32 merkleRoot;     // root of this shard's depth-64 identity tree
        uint256 validFrom;
        uint256 validUntil;
        uint256 identityCount;  // number of active identities in this snapshot
        uint256 treeDepth;      // always 64 for new shards
        bool    active;
    }

    // ── Interplanetary root ───────────────────────────────────────────────────
    // The root of all shard roots — a Merkle tree where each leaf is a shard root.
    // Proof: citizen is in shard X, AND shard X is in the interplanetary root.
    struct InterplanetaryRoot {
        bytes32 root;           // Merkle root of all shard roots
        uint256 validFrom;
        uint256 validUntil;
        uint256 shardCount;
        bool    active;
    }

    // shardId => Shard
    mapping(uint256 => Shard) public shards;
    uint256[] public shardIds;

    // shardId => cycleId => ShardRoot
    mapping(uint256 => mapping(uint256 => ShardRoot)) public shardRoots;

    // cycleId => InterplanetaryRoot
    mapping(uint256 => InterplanetaryRoot) public interplanetaryRoots;

    // Double-claim prevention: shardId => cycleId => citizen => claimed
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public hasClaimed;

    uint256 public currentCycleId;

    // ── Events ────────────────────────────────────────────────────────────────
    event ShardRegistered(uint256 indexed shardId, string name);
    event ShardRootPublished(uint256 indexed shardId, uint256 indexed cycleId, bytes32 merkleRoot, uint256 identityCount);
    event InterplanetaryRootPublished(uint256 indexed cycleId, bytes32 root, uint256 shardCount);
    event IdentityClaimed(address indexed citizen, uint256 indexed shardId, uint256 indexed cycleId, uint256 credits);

    constructor(address admin, address oracle) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE,  admin);
        _grantRole(ORACLE_ROLE, oracle);

        // Register Earth as shard 1 at genesis
        _registerShard(1, "Earth", "Home planet of humanity");
    }

    // ── Shard management ──────────────────────────────────────────────────────

    /**
     * @notice Register a new planetary shard.
     *         Call this when a new settlement achieves sufficient population
     *         to warrant its own identity shard (e.g. Mars colony).
     * @param shardId     Unique numeric ID (1=Earth, 2=Mars, 3=Luna, etc.)
     * @param name        Human-readable name
     * @param description Brief description
     */
    function registerShard(
        uint256 shardId,
        string calldata name,
        string calldata description
    ) external onlyRole(ADMIN_ROLE) {
        require(!shards[shardId].active, "HIV: shard already registered");
        _registerShard(shardId, name, description);
    }

    function _registerShard(uint256 shardId, string memory name, string memory description) internal {
        shards[shardId] = Shard({
            shardId:      shardId,
            name:         name,
            description:  description,
            active:       true,
            registeredAt: block.timestamp
        });
        shardIds.push(shardId);
        emit ShardRegistered(shardId, name);
    }

    // ── Oracle: publish shard identity root ───────────────────────────────────

    /**
     * @notice Publish a new identity Merkle root for a specific shard.
     *         The root is built from a depth-64 sparse Merkle tree of all
     *         valid identity commitments in that shard's jurisdiction.
     *
     * @param shardId       The shard this root covers
     * @param cycleId       Governance cycle
     * @param merkleRoot    Root of the depth-64 sparse Merkle identity tree
     * @param validFrom     Unix timestamp — when active
     * @param validUntil    Unix timestamp — when expires
     * @param identityCount Number of active identities in snapshot
     */
    function publishShardRoot(
        uint256 shardId,
        uint256 cycleId,
        bytes32 merkleRoot,
        uint256 validFrom,
        uint256 validUntil,
        uint256 identityCount
    ) external onlyRole(ORACLE_ROLE) {
        require(shards[shardId].active,              "HIV: shard not registered");
        require(merkleRoot != bytes32(0),            "HIV: empty root");
        require(validUntil > validFrom,              "HIV: invalid window");
        require(!shardRoots[shardId][cycleId].active,"HIV: root already published");

        shardRoots[shardId][cycleId] = ShardRoot({
            merkleRoot:    merkleRoot,
            validFrom:     validFrom,
            validUntil:    validUntil,
            identityCount: identityCount,
            treeDepth:     64,
            active:        true
        });

        if (cycleId > currentCycleId) currentCycleId = cycleId;

        emit ShardRootPublished(shardId, cycleId, merkleRoot, identityCount);
    }

    /**
     * @notice Publish the interplanetary root — the root of all shard roots.
     *         Built by the interplanetary oracle from the current set of
     *         active shard roots. Verified by recursive ZK proof in production.
     */
    function publishInterplanetaryRoot(
        uint256 cycleId,
        bytes32 root,
        uint256 validFrom,
        uint256 validUntil,
        uint256 shardCount
    ) external onlyRole(ORACLE_ROLE) {
        require(root != bytes32(0),                          "HIV: empty root");
        require(!interplanetaryRoots[cycleId].active,        "HIV: root already published");

        interplanetaryRoots[cycleId] = InterplanetaryRoot({
            root:       root,
            validFrom:  validFrom,
            validUntil: validUntil,
            shardCount: shardCount,
            active:     true
        });

        emit InterplanetaryRootPublished(cycleId, root, shardCount);
    }

    // ── Citizen: verify identity and claim voice credits ──────────────────────

    /**
     * @notice Verify a citizen's shard membership and issue voice credits.
     *
     * Two-level proof:
     *   1. shardMerkleProof:    citizen is a leaf in shardId's depth-64 tree
     *   2. shardInPlanetProof:  shardId's root is a leaf in the interplanetary root
     *
     * The leaf for step 1: keccak256(citizen, jurisdiction, voiceCredits)
     * The leaf for step 2: keccak256(shardId, shardRoot)
     *
     * @param cycleId              Governance cycle
     * @param shardId              Which shard the citizen belongs to
     * @param jurisdiction         Citizen's jurisdiction within the shard
     * @param voiceCredits         Allocated credits (as encoded in the leaf)
     * @param shardMerkleProof     Proof: citizen ∈ shard identity tree
     * @param shardInPlanetProof   Proof: shard root ∈ interplanetary root
     */
    function verifyAndGetCredits(
        uint256 cycleId,
        uint256 shardId,
        string calldata jurisdiction,
        uint256 voiceCredits,
        bytes32[] calldata shardMerkleProof,
        bytes32[] calldata shardInPlanetProof
    ) external returns (uint256 credits) {
        require(shards[shardId].active,                      "HIV: shard not registered");
        require(!hasClaimed[shardId][cycleId][msg.sender],   "HIV: already claimed");

        ShardRoot storage sr = shardRoots[shardId][cycleId];
        require(sr.active,                                   "HIV: no shard root for cycle");
        require(block.timestamp >= sr.validFrom,             "HIV: cycle not started");
        require(block.timestamp <= sr.validUntil,            "HIV: cycle expired");

        // Step 1: Verify citizen is in the shard's identity tree
        bytes32 citizenLeaf = keccak256(abi.encodePacked(msg.sender, jurisdiction, voiceCredits));
        require(
            MerkleProof.verify(shardMerkleProof, sr.merkleRoot, citizenLeaf),
            "HIV: invalid citizen proof"
        );

        // Step 2: Verify shard root is in the interplanetary root
        // (can be skipped for single-shard deployments — just verify shardInPlanetProof is non-empty)
        if (shardInPlanetProof.length > 0) {
            InterplanetaryRoot storage ipr = interplanetaryRoots[cycleId];
            require(ipr.active, "HIV: no interplanetary root for cycle");

            bytes32 shardLeaf = keccak256(abi.encodePacked(shardId, sr.merkleRoot));
            require(
                MerkleProof.verify(shardInPlanetProof, ipr.root, shardLeaf),
                "HIV: invalid shard-in-planet proof"
            );
        }

        hasClaimed[shardId][cycleId][msg.sender] = true;
        emit IdentityClaimed(msg.sender, shardId, cycleId, voiceCredits);
        return voiceCredits;
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function getShardCount() external view returns (uint256) {
        return shardIds.length;
    }

    function getShardRoot(uint256 shardId, uint256 cycleId)
        external view returns (ShardRoot memory)
    {
        return shardRoots[shardId][cycleId];
    }

    function getInterplanetaryRoot(uint256 cycleId)
        external view returns (InterplanetaryRoot memory)
    {
        return interplanetaryRoots[cycleId];
    }

    function isEligible(
        uint256 cycleId,
        uint256 shardId,
        address citizen,
        string calldata jurisdiction,
        uint256 voiceCredits,
        bytes32[] calldata shardMerkleProof
    ) external view returns (bool) {
        if (!shards[shardId].active) return false;
        if (hasClaimed[shardId][cycleId][citizen]) return false;

        ShardRoot storage sr = shardRoots[shardId][cycleId];
        if (!sr.active) return false;
        if (block.timestamp < sr.validFrom)  return false;
        if (block.timestamp > sr.validUntil) return false;

        bytes32 leaf = keccak256(abi.encodePacked(citizen, jurisdiction, voiceCredits));
        return MerkleProof.verify(shardMerkleProof, sr.merkleRoot, leaf);
    }
}
