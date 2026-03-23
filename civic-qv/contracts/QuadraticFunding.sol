// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./CivicIdentityVerifier.sol";

/**
 * @title QuadraticFunding
 * @notice Democratic budget allocation via the CLR (Constrained Liberal Radicalism) mechanism.
 *
 * What quadratic funding does:
 *   Standard funding lets large donors dominate. QF fixes this by making the
 *   MATCHING from the public treasury proportional to the SQUARE of the sum of
 *   square roots of individual contributions — not the raw total donated.
 *
 *   Result: a project with 100 citizens each donating $1 receives more matching
 *   than a project with 1 donor contributing $100. Breadth of support matters
 *   more than depth of individual donations.
 *
 * How it works:
 *   1. A matching pool is seeded by the treasury (government budget)
 *   2. Citizens contribute directly to projects they support (any amount)
 *   3. At round end, each project's match = (Σ√contribution_i)² - Σcontribution_i
 *   4. If total matches exceed pool, amounts are scaled down proportionally
 *   5. Projects receive their direct contributions + matching
 *
 * Identity gating:
 *   Only verified citizens (via XRPL Merkle proof) can contribute to QF rounds.
 *   This prevents Sybil attacks where one entity creates many wallets to game matching.
 */
contract QuadraticFunding is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE    = keccak256("ADMIN_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");

    CivicIdentityVerifier public immutable identityVerifier;
    IERC20 public immutable fundingToken;  // e.g. a stable governance token or MATIC

    // ── Round ─────────────────────────────────────────────────────────────────
    struct Round {
        uint256 id;
        string  title;
        string  descriptionIpfsCid;
        uint256 cycleId;
        uint256 matchingPool;          // Total treasury funds available for matching
        uint256 startTime;
        uint256 endTime;
        bool    finalized;
        uint256 totalContributions;
    }

    // ── Project ───────────────────────────────────────────────────────────────
    struct Project {
        uint256 id;
        uint256 roundId;
        address payable recipient;
        string  title;
        string  descriptionIpfsCid;
        uint256 totalContributed;       // Sum of all direct contributions
        uint256 sqrtSumSquared;         // (Σ√contribution_i)² — the CLR numerator
        uint256 matchingAmount;         // Calculated at finalization
        uint256 contributorCount;
        bool    paid;
    }

    // ── Storage ───────────────────────────────────────────────────────────────
    mapping(uint256 => Round)   public rounds;
    mapping(uint256 => Project[]) public roundProjects;      // roundId => projects
    // roundId => projectId => citizen => contributed amount
    mapping(uint256 => mapping(uint256 => mapping(address => uint256))) public contributions;
    // Track verified contributors per round to prevent Sybil
    mapping(uint256 => mapping(address => bool)) public hasContributedThisRound;

    uint256 public roundCount;

    // ── Events ────────────────────────────────────────────────────────────────
    event RoundCreated(uint256 indexed roundId, string title, uint256 matchingPool);
    event ProjectAdded(uint256 indexed roundId, uint256 indexed projectId, string title);
    event ContributionMade(
        uint256 indexed roundId,
        uint256 indexed projectId,
        address indexed contributor,
        uint256 amount
    );
    event RoundFinalized(uint256 indexed roundId, uint256 totalDistributed);
    event MatchingPoolFunded(uint256 indexed roundId, uint256 amount);

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(
        address admin,
        address identityVerifierAddr,
        address fundingTokenAddr
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE,    admin);
        _grantRole(TREASURY_ROLE, admin);
        identityVerifier = CivicIdentityVerifier(identityVerifierAddr);
        fundingToken     = IERC20(fundingTokenAddr);
    }

    // ── Create a funding round ────────────────────────────────────────────────
    function createRound(
        string calldata title,
        string calldata descriptionIpfsCid,
        uint256 cycleId,
        uint256 durationSeconds,
        uint256 initialMatchingPool
    ) external onlyRole(ADMIN_ROLE) returns (uint256 roundId) {
        roundId = ++roundCount;

        rounds[roundId] = Round({
            id:                 roundId,
            title:              title,
            descriptionIpfsCid: descriptionIpfsCid,
            cycleId:            cycleId,
            matchingPool:       initialMatchingPool,
            startTime:          block.timestamp,
            endTime:            block.timestamp + durationSeconds,
            finalized:          false,
            totalContributions: 0
        });

        if (initialMatchingPool > 0) {
            fundingToken.safeTransferFrom(msg.sender, address(this), initialMatchingPool);
        }

        emit RoundCreated(roundId, title, initialMatchingPool);
    }

    // ── Add a project to a round ──────────────────────────────────────────────
    function addProject(
        uint256 roundId,
        string calldata title,
        string calldata descriptionIpfsCid,
        address payable recipient
    ) external onlyRole(ADMIN_ROLE) returns (uint256 projectId) {
        Round storage r = rounds[roundId];
        require(!r.finalized,               "QF: round finalized");
        require(block.timestamp < r.endTime, "QF: round ended");
        require(recipient != address(0),     "QF: zero recipient");

        projectId = roundProjects[roundId].length;

        roundProjects[roundId].push(Project({
            id:                projectId,
            roundId:           roundId,
            recipient:         recipient,
            title:             title,
            descriptionIpfsCid: descriptionIpfsCid,
            totalContributed:  0,
            sqrtSumSquared:    0,
            matchingAmount:    0,
            contributorCount:  0,
            paid:              false
        }));

        emit ProjectAdded(roundId, projectId, title);
    }

    // ── Citizen contributes to a project ─────────────────────────────────────
    /**
     * @notice Contribute to a project in the current round.
     *         Only verified citizens can contribute (Sybil resistance).
     *
     * The CLR formula is updated incrementally:
     *   Before: sqrtSum_old = Σ√prev_contributions
     *   After:  sqrtSum_new = sqrtSum_old + √new_contribution
     *   Stored: sqrtSum_new²  (the matching-relevant quantity)
     *
     * @param roundId      The funding round
     * @param projectId    The project to support
     * @param amount       Token amount to contribute
     * @param cycleId      Governance cycle (for identity verification)
     * @param jurisdiction Citizen jurisdiction (for identity verification)
     * @param merkleProof  XRPL identity Merkle proof
     */
    function contribute(
        uint256 roundId,
        uint256 projectId,
        uint256 amount,
        uint256 cycleId,
        string calldata jurisdiction,
        bytes32[] calldata merkleProof
    ) external nonReentrant {
        Round storage r = rounds[roundId];
        require(!r.finalized,                    "QF: round finalized");
        require(block.timestamp >= r.startTime,  "QF: round not started");
        require(block.timestamp <= r.endTime,    "QF: round ended");
        require(amount > 0,                      "QF: zero contribution");
        require(projectId < roundProjects[roundId].length, "QF: project not found");

        // Verify civic identity (once per round per citizen)
        if (!hasContributedThisRound[roundId][msg.sender]) {
            identityVerifier.verifyAndGetCredits(
                cycleId,
                jurisdiction,
                100, // voice credits (not used for funding, just identity check)
                merkleProof
            );
            hasContributedThisRound[roundId][msg.sender] = true;
        }

        // Transfer contribution
        fundingToken.safeTransferFrom(msg.sender, address(this), amount);

        // Update CLR state
        Project storage p = roundProjects[roundId][projectId];
        uint256 prevContrib = contributions[roundId][projectId][msg.sender];

        // Incremental CLR update:
        //   Remove old sqrt contribution, add new total sqrt contribution
        uint256 sqrtPrev = _sqrt(prevContrib);
        uint256 sqrtNew  = _sqrt(prevContrib + amount);

        // sqrtSum = √(sqrtSumSquared) — reconstruct to update
        uint256 sqrtSum = _sqrt(p.sqrtSumSquared);
        sqrtSum = sqrtSum - sqrtPrev + sqrtNew;
        p.sqrtSumSquared = sqrtSum * sqrtSum;

        if (prevContrib == 0) {
            p.contributorCount++;
        }

        contributions[roundId][projectId][msg.sender] += amount;
        p.totalContributed   += amount;
        r.totalContributions += amount;

        emit ContributionMade(roundId, projectId, msg.sender, amount);
    }

    // ── Finalize round and distribute matching ────────────────────────────────
    /**
     * @notice Finalize the round, calculate CLR matching, and distribute funds.
     *
     * CLR matching formula:
     *   match_i = matchingPool × (sqrtSumSquared_i / Σ sqrtSumSquared_j)
     *
     * If total calculated matches > matchingPool, scale down proportionally.
     * Each project receives: totalContributed + matchingAmount
     */
    function finalizeRound(uint256 roundId) external onlyRole(ADMIN_ROLE) nonReentrant {
        Round storage r = rounds[roundId];
        require(!r.finalized,                    "QF: already finalized");
        require(block.timestamp > r.endTime,     "QF: round still active");

        Project[] storage projects = roundProjects[roundId];
        uint256 numProjects = projects.length;

        // Calculate total CLR denominator
        uint256 totalSqrtSumSquared = 0;
        for (uint256 i = 0; i < numProjects; i++) {
            totalSqrtSumSquared += projects[i].sqrtSumSquared;
        }

        uint256 totalMatching = 0;

        if (totalSqrtSumSquared > 0 && r.matchingPool > 0) {
            // Calculate raw matching for each project
            uint256[] memory rawMatching = new uint256[](numProjects);
            for (uint256 i = 0; i < numProjects; i++) {
                rawMatching[i] = (r.matchingPool * projects[i].sqrtSumSquared) / totalSqrtSumSquared;
                totalMatching += rawMatching[i];
            }

            // Scale down if needed (shouldn't happen but guards against rounding)
            for (uint256 i = 0; i < numProjects; i++) {
                projects[i].matchingAmount = totalMatching <= r.matchingPool
                    ? rawMatching[i]
                    : (rawMatching[i] * r.matchingPool) / totalMatching;
            }
        }

        // Distribute: contributions + matching to each project recipient
        uint256 totalDistributed = 0;
        for (uint256 i = 0; i < numProjects; i++) {
            Project storage p = projects[i];
            if (!p.paid) {
                uint256 payout = p.totalContributed + p.matchingAmount;
                p.paid = true;
                totalDistributed += payout;
                if (payout > 0) {
                    fundingToken.safeTransfer(p.recipient, payout);
                }
            }
        }

        r.finalized = true;
        emit RoundFinalized(roundId, totalDistributed);
    }

    // ── Treasury: top up matching pool ───────────────────────────────────────
    function addToMatchingPool(uint256 roundId, uint256 amount)
        external onlyRole(TREASURY_ROLE) nonReentrant
    {
        Round storage r = rounds[roundId];
        require(!r.finalized, "QF: round finalized");
        fundingToken.safeTransferFrom(msg.sender, address(this), amount);
        r.matchingPool += amount;
        emit MatchingPoolFunded(roundId, amount);
    }

    // ── Views ─────────────────────────────────────────────────────────────────
    function getProjects(uint256 roundId) external view returns (Project[] memory) {
        return roundProjects[roundId];
    }

    function getContribution(uint256 roundId, uint256 projectId, address contributor)
        external view returns (uint256)
    {
        return contributions[roundId][projectId][contributor];
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) { y = z; z = (x / z + z) / 2; }
    }
}
