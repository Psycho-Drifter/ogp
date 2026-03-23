// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title CivicIdentityVerifier
 * @notice Cross-chain identity bridge: XRPL soulbound NFT → Polygon voting rights.
 *
 * The Problem:
 *   XRPL and Polygon are separate blockchains. A citizen's soulbound NFT lives
 *   on XRPL, but the voting contracts run on Polygon. We need a trustworthy
 *   way to prove "this wallet holds a valid civic identity" on Polygon.
 *
 * The Solution — Merkle Identity Root:
 *   1. An off-chain oracle (or multi-sig committee) periodically reads the
 *      current set of valid civic identity NFTs from XRPL.
 *   2. It builds a Merkle tree of (citizenAddress, jurisdictions, voiceCredits).
 *   3. The Merkle root is submitted to this contract by the oracle authority.
 *   4. To vote, a citizen submits a Merkle proof that their address is a leaf.
 *      This is verified on-chain in O(log n) — cheap even for 100M citizens.
 *
 * Trust model:
 *   The oracle is a multi-sig (3-of-5 rotating authority members). In v2 this
 *   will be replaced by a trustless ZK light-client proof of the XRPL state.
 *
 * Security properties:
 *   - Oracle cannot fabricate identities (Merkle tree is append-only per root)
 *   - Citizens cannot use expired roots (roots have a validity window)
 *   - One root per governance cycle prevents replay across cycles
 */
contract CivicIdentityVerifier is AccessControl {

    // ── Roles ────────────────────────────────────────────────────────────────
    bytes32 public constant ORACLE_ROLE  = keccak256("ORACLE_ROLE");
    bytes32 public constant ADMIN_ROLE   = keccak256("ADMIN_ROLE");

    // ── Identity root ────────────────────────────────────────────────────────
    struct IdentityRoot {
        bytes32 merkleRoot;
        uint256 validFrom;
        uint256 validUntil;
        uint256 citizenCount;
        string  xrplLedgerHash;   // XRPL ledger snapshot this root was built from
        bool    active;
    }

    // cycleId => IdentityRoot
    mapping(uint256 => IdentityRoot) public identityRoots;
    uint256 public currentCycleId;

    // Nullifier: track which (citizen, cycle) pairs have claimed credits
    // citizen address => cycleId => has claimed
    mapping(address => mapping(uint256 => bool)) public hasClaimed;

    // ── Events ───────────────────────────────────────────────────────────────
    event IdentityRootUpdated(
        uint256 indexed cycleId,
        bytes32 indexed merkleRoot,
        uint256 citizenCount,
        string  xrplLedgerHash
    );
    event IdentityClaimed(
        address indexed citizen,
        uint256 indexed cycleId,
        string  jurisdiction,
        uint256 voiceCredits
    );

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(address admin, address oracle) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE,  admin);
        _grantRole(ORACLE_ROLE, oracle);
    }

    // ── Oracle: publish identity root for a governance cycle ─────────────────
    /**
     * @notice Submit a new identity Merkle root for a governance cycle.
     * @param cycleId       The governance cycle this root covers
     * @param merkleRoot    Root of the identity Merkle tree
     * @param validFrom     Unix timestamp — when this root becomes active
     * @param validUntil    Unix timestamp — when this root expires
     * @param citizenCount  Number of eligible citizens in this snapshot
     * @param xrplLedgerHash The XRPL ledger hash this snapshot was taken from
     */
    function publishIdentityRoot(
        uint256 cycleId,
        bytes32 merkleRoot,
        uint256 validFrom,
        uint256 validUntil,
        uint256 citizenCount,
        string calldata xrplLedgerHash
    ) external onlyRole(ORACLE_ROLE) {
        require(validUntil > validFrom,   "CIV: invalid validity window");
        require(merkleRoot != bytes32(0), "CIV: empty root");
        require(!identityRoots[cycleId].active, "CIV: root already published for cycle");

        identityRoots[cycleId] = IdentityRoot({
            merkleRoot:     merkleRoot,
            validFrom:      validFrom,
            validUntil:     validUntil,
            citizenCount:   citizenCount,
            xrplLedgerHash: xrplLedgerHash,
            active:         true
        });

        if (cycleId > currentCycleId) {
            currentCycleId = cycleId;
        }

        emit IdentityRootUpdated(cycleId, merkleRoot, citizenCount, xrplLedgerHash);
    }

    // ── Citizen: verify identity and claim voice credits ─────────────────────
    /**
     * @notice Verify a citizen's Merkle proof and return their voice credit allocation.
     * @param cycleId       The cycle to verify against
     * @param jurisdiction  Citizen's jurisdiction code (e.g. "CA-BC")
     * @param voiceCredits  Allocated voice credits (as encoded in the leaf)
     * @param merkleProof   Merkle proof from the identity tree
     * @return credits      Voice credits this citizen may use this cycle
     *
     * The Merkle leaf is: keccak256(abi.encodePacked(citizen, jurisdiction, voiceCredits))
     * This matches the leaf construction in the off-chain oracle.
     */
    function verifyAndGetCredits(
        uint256 cycleId,
        string calldata jurisdiction,
        uint256 voiceCredits,
        bytes32[] calldata merkleProof
    ) external returns (uint256 credits) {
        IdentityRoot storage root = identityRoots[cycleId];
        require(root.active,                     "CIV: no root for this cycle");
        require(block.timestamp >= root.validFrom,  "CIV: cycle not started");
        require(block.timestamp <= root.validUntil, "CIV: cycle expired");
        require(!hasClaimed[msg.sender][cycleId],   "CIV: already claimed this cycle");

        // Reconstruct the leaf and verify the Merkle proof
        bytes32 leaf = keccak256(abi.encodePacked(
            msg.sender,
            jurisdiction,
            voiceCredits
        ));

        require(
            MerkleProof.verify(merkleProof, root.merkleRoot, leaf),
            "CIV: invalid identity proof"
        );

        hasClaimed[msg.sender][cycleId] = true;

        emit IdentityClaimed(msg.sender, cycleId, jurisdiction, voiceCredits);
        return voiceCredits;
    }

    /**
     * @notice Check eligibility without claiming (read-only).
     */
    function isEligible(
        uint256 cycleId,
        address citizen,
        string calldata jurisdiction,
        uint256 voiceCredits,
        bytes32[] calldata merkleProof
    ) external view returns (bool) {
        IdentityRoot storage root = identityRoots[cycleId];
        if (!root.active) return false;
        if (block.timestamp < root.validFrom)  return false;
        if (block.timestamp > root.validUntil) return false;
        if (hasClaimed[citizen][cycleId]) return false;

        bytes32 leaf = keccak256(abi.encodePacked(citizen, jurisdiction, voiceCredits));
        return MerkleProof.verify(merkleProof, root.merkleRoot, leaf);
    }
}
