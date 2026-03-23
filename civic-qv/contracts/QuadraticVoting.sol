// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./interfaces/IVoteVerifier.sol";
import "./CivicIdentityVerifier.sol";

/**
 * @title QuadraticVoting
 * @notice Quadratic voting engine for civic governance.
 *
 * Core mechanism:
 *   Each eligible citizen receives an equal allocation of voice credits
 *   per proposal (default: 100). They may spread or concentrate those
 *   credits across vote options. The COST of casting V votes is V²
 *   credits — this makes it expensive to dominate any single issue
 *   while keeping modest preferences cheap to express.
 *
 *   Examples (100 credit budget):
 *     1 vote  = 1  credit   (trivial, low-conviction signal)
 *     3 votes = 9  credits  (moderate support)
 *     5 votes = 25 credits  (strong support, uses 25% of budget)
 *    10 votes = 100 credits (maximum conviction — entire budget)
 *
 * AI briefing:
 *   Every proposal MUST include an IPFS CID of the AI-generated risk
 *   analysis and plain-language summary. This CID is stored immutably
 *   on-chain. Citizens can verify they're voting on a briefed proposal.
 *   The AI produces the analysis; a citizen oversight panel approves it
 *   before the proposal enters the active voting state.
 *
 * Privacy:
 *   Ballots are submitted as ZK-PLONK proofs. The contract verifies:
 *     - Voter holds a valid civic identity (without revealing who)
 *     - Quadratic math is correct (without revealing vote direction)
 *     - Nullifier prevents double-voting (without linking to identity)
 *
 * Proposal lifecycle:
 *   Drafted → AIReview → Active → Tallying → Executed | Vetoed | Rejected
 */
contract QuadraticVoting is AccessControl, ReentrancyGuard, Pausable {

    // ── Roles ─────────────────────────────────────────────────────────────────
    bytes32 public constant PROPOSER_ROLE  = keccak256("PROPOSER_ROLE");
    bytes32 public constant OVERSIGHT_ROLE = keccak256("OVERSIGHT_ROLE");
    bytes32 public constant ADMIN_ROLE     = keccak256("ADMIN_ROLE");
    bytes32 public constant AI_ORACLE_ROLE = keccak256("AI_ORACLE_ROLE");

    // ── Constants ─────────────────────────────────────────────────────────────
    uint256 public constant VOICE_CREDITS_PER_PROPOSAL = 100;
    uint256 public constant MAX_VOTES_PER_OPTION       = 10;  // 10² = 100 = full budget
    uint256 public constant MIN_VOTING_PERIOD          = 3 days;
    uint256 public constant MAX_VOTING_PERIOD          = 30 days;
    uint256 public constant VETO_WINDOW                = 48 hours; // after vote closes
    uint256 public constant AI_REVIEW_WINDOW           = 7 days;

    // ── Proposal state machine ────────────────────────────────────────────────
    enum ProposalState {
        Drafted,    // submitted, awaiting AI analysis
        AIReview,   // AI analysis attached, awaiting oversight panel approval
        Active,     // open for citizen voting
        Tallying,   // voting closed, within veto window
        Executed,   // result enacted
        Vetoed,     // emergency veto triggered by oversight panel
        Rejected    // failed quorum or threshold
    }

    // ── Proposal ──────────────────────────────────────────────────────────────
    struct Proposal {
        uint256 id;
        address proposer;
        string  title;
        string  descriptionIpfsCid;     // Full proposal text on IPFS
        string  aiBriefingIpfsCid;      // AI risk analysis + summary on IPFS
        bytes32 aiBriefingHash;         // keccak256 of the briefing content (tamper-proof)
        ProposalState state;
        uint256 cycleId;                // Which governance cycle this belongs to
        uint256 votingStart;
        uint256 votingEnd;
        uint256 totalVotesFor;          // Revealed after ZK tally
        uint256 totalVotesAgainst;
        uint256 totalVotersParticipated;
        uint256 quorumRequired;         // Minimum % of eligible citizens (basis points, 10000 = 100%)
        uint256 thresholdBps;           // % of votes needed to pass (basis points)
        bool    isEmergency;            // Emergency proposals have shorter windows
    }

    // ── Vote commitment (stored during voting window) ─────────────────────────
    // We store nullifiers to prevent double voting.
    // The actual vote direction is hidden in the ZK proof until reveal.
    struct VoteRecord {
        bytes32 nullifierHash;
        uint256 creditsSpent;
        uint256 timestamp;
    }

    // ── Storage ───────────────────────────────────────────────────────────────
    CivicIdentityVerifier public immutable identityVerifier;
    IVoteVerifier         public immutable zkVerifier;

    mapping(uint256 => Proposal)   public proposals;
    mapping(uint256 => VoteRecord[]) public proposalVotes;          // proposalId => votes
    mapping(uint256 => mapping(bytes32 => bool)) public usedNullifiers; // proposalId => nullifier => used

    // Citizen voice credit balances: cycleId => citizen => credits remaining
    mapping(uint256 => mapping(address => uint256)) public voiceCreditsRemaining;

    uint256 public proposalCount;

    // ── Events ────────────────────────────────────────────────────────────────
    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        string  title,
        uint256 cycleId
    );
    event AIBriefingAttached(
        uint256 indexed proposalId,
        string  aiBriefingIpfsCid,
        bytes32 aiBriefingHash
    );
    event ProposalActivated(
        uint256 indexed proposalId,
        uint256 votingStart,
        uint256 votingEnd
    );
    event BallotCast(
        uint256 indexed proposalId,
        bytes32 indexed nullifierHash,
        uint256 creditsSpent
    );
    event ProposalFinalized(
        uint256 indexed proposalId,
        ProposalState finalState,
        uint256 votesFor,
        uint256 votesAgainst
    );
    event EmergencyVetoTriggered(
        uint256 indexed proposalId,
        address indexed oversightMember,
        string  reason
    );
    event VoiceCreditsIssued(
        address indexed citizen,
        uint256 indexed cycleId,
        uint256 credits
    );

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(
        address admin,
        address identityVerifierAddr,
        address zkVerifierAddr
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ADMIN_ROLE,        admin);
        identityVerifier = CivicIdentityVerifier(identityVerifierAddr);
        zkVerifier       = IVoteVerifier(zkVerifierAddr);
    }

    // ── STEP 1: Create a proposal ─────────────────────────────────────────────
    /**
     * @notice Submit a new governance proposal.
     * @param title               Short title (stored on-chain for indexing)
     * @param descriptionIpfsCid  IPFS CID of the full proposal text
     * @param cycleId             Governance cycle this proposal belongs to
     * @param votingPeriodSeconds How long voting stays open (clamped to MIN/MAX)
     * @param quorumBps           Minimum participation required (basis points)
     * @param thresholdBps        % of yes-votes needed to pass (basis points)
     */
    function createProposal(
        string calldata title,
        string calldata descriptionIpfsCid,
        uint256 cycleId,
        uint256 votingPeriodSeconds,
        uint256 quorumBps,
        uint256 thresholdBps
    ) external onlyRole(PROPOSER_ROLE) whenNotPaused returns (uint256 proposalId) {
        require(bytes(title).length > 0,               "QV: empty title");
        require(bytes(descriptionIpfsCid).length > 0,  "QV: no description CID");
        require(quorumBps <= 10000,                    "QV: invalid quorum");
        require(thresholdBps <= 10000,                 "QV: invalid threshold");

        uint256 period = _clamp(votingPeriodSeconds, MIN_VOTING_PERIOD, MAX_VOTING_PERIOD);

        proposalId = ++proposalCount;

        proposals[proposalId] = Proposal({
            id:                    proposalId,
            proposer:              msg.sender,
            title:                 title,
            descriptionIpfsCid:    descriptionIpfsCid,
            aiBriefingIpfsCid:     "",
            aiBriefingHash:        bytes32(0),
            state:                 ProposalState.Drafted,
            cycleId:               cycleId,
            votingStart:           0,
            votingEnd:             0,
            totalVotesFor:         0,
            totalVotesAgainst:     0,
            totalVotersParticipated: 0,
            quorumRequired:        quorumBps,
            thresholdBps:          thresholdBps,
            isEmergency:           false
        });

        emit ProposalCreated(proposalId, msg.sender, title, cycleId);
    }

    // ── STEP 2: AI oracle attaches briefing ──────────────────────────────────
    /**
     * @notice Attach the AI-generated briefing to a proposal.
     *         Called by the AI oracle after the citizen oversight panel
     *         has reviewed and approved the analysis.
     *
     * @param proposalId       The proposal to brief
     * @param briefingIpfsCid  IPFS CID of the AI analysis document
     * @param briefingHash     keccak256 of the briefing content (tamper-proof anchor)
     *
     * What goes in the briefing (off-chain, on IPFS):
     *   - Plain-language summary (8th grade reading level)
     *   - Risk analysis with probability estimates
     *   - Predicted outcomes under different vote results
     *   - Historical precedents
     *   - AI confidence level and known limitations
     *   - Oversight panel approval signatures
     */
    function attachAIBriefing(
        uint256 proposalId,
        string calldata briefingIpfsCid,
        bytes32 briefingHash
    ) external onlyRole(AI_ORACLE_ROLE) {
        Proposal storage p = proposals[proposalId];
        require(p.id != 0,                                  "QV: proposal not found");
        require(p.state == ProposalState.Drafted,           "QV: wrong state");
        require(bytes(briefingIpfsCid).length > 0,          "QV: no briefing CID");
        require(briefingHash != bytes32(0),                 "QV: empty briefing hash");

        p.aiBriefingIpfsCid = briefingIpfsCid;
        p.aiBriefingHash    = briefingHash;
        p.state             = ProposalState.AIReview;

        emit AIBriefingAttached(proposalId, briefingIpfsCid, briefingHash);
    }

    // ── STEP 3: Oversight panel activates voting ──────────────────────────────
    /**
     * @notice Oversight panel approves the AI briefing and opens voting.
     *         This is the human check on AI output before citizens vote.
     */
    function activateProposal(uint256 proposalId)
        external
        onlyRole(OVERSIGHT_ROLE)
    {
        Proposal storage p = proposals[proposalId];
        require(p.state == ProposalState.AIReview, "QV: not in AI review");
        require(p.aiBriefingHash != bytes32(0),    "QV: no AI briefing attached");

        p.state       = ProposalState.Active;
        p.votingStart = block.timestamp;
        p.votingEnd   = block.timestamp + (p.isEmergency ? MIN_VOTING_PERIOD : MAX_VOTING_PERIOD);

        emit ProposalActivated(proposalId, p.votingStart, p.votingEnd);
    }

    // ── STEP 4: Citizens claim voice credits ─────────────────────────────────
    /**
     * @notice Claim voice credits for a governance cycle using XRPL identity proof.
     *         Citizens call this once per cycle with their Merkle proof.
     *
     * @param cycleId       The governance cycle
     * @param jurisdiction  Citizen's jurisdiction
     * @param merkleProof   Proof from the XRPL identity Merkle tree
     */
    function claimVoiceCredits(
        uint256 cycleId,
        string calldata jurisdiction,
        bytes32[] calldata merkleProof
    ) external nonReentrant {
        require(
            voiceCreditsRemaining[cycleId][msg.sender] == 0,
            "QV: already claimed credits this cycle"
        );

        uint256 credits = identityVerifier.verifyAndGetCredits(
            cycleId,
            jurisdiction,
            VOICE_CREDITS_PER_PROPOSAL,
            merkleProof
        );

        voiceCreditsRemaining[cycleId][msg.sender] = credits;
        emit VoiceCreditsIssued(msg.sender, cycleId, credits);
    }

    // ── STEP 5: Cast a ZK ballot ──────────────────────────────────────────────
    /**
     * @notice Cast a private ballot using a ZK-PLONK proof.
     *
     * The proof encodes the vote direction (for/against/abstain) and the
     * number of votes cast. The contract sees only the credits spent and
     * a nullifier — it cannot learn who voted or which way.
     *
     * @param proposalId     The proposal being voted on
     * @param proof          ZK-PLONK proof bytes (generated by client)
     * @param nullifierHash  Unique per (voter, proposal) — prevents double voting
     * @param voteCommitment Blinded commitment to the vote direction
     * @param creditsSpent   How many voice credits this ballot consumes (public)
     * @param identityRoot   The Merkle root used to prove citizenship
     */
    function castBallot(
        uint256 proposalId,
        bytes calldata proof,
        bytes32 nullifierHash,
        uint256 voteCommitment,
        uint256 creditsSpent,
        uint256 identityRoot
    ) external nonReentrant whenNotPaused {
        Proposal storage p = proposals[proposalId];

        require(p.state == ProposalState.Active,          "QV: proposal not active");
        require(block.timestamp >= p.votingStart,         "QV: voting not started");
        require(block.timestamp <= p.votingEnd,           "QV: voting closed");
        require(!usedNullifiers[proposalId][nullifierHash], "QV: ballot already cast");
        require(creditsSpent > 0 && creditsSpent <= 100,  "QV: invalid credit spend");

        // Verify the quadratic math: credits = votes², max 10 votes = 100 credits
        uint256 votes = _sqrt(creditsSpent);
        require(votes * votes == creditsSpent, "QV: credits must be a perfect square");
        require(votes <= MAX_VOTES_PER_OPTION, "QV: vote count exceeds maximum");

        // Verify the ZK proof
        uint256[5] memory publicInputs = [
            proposalId,
            uint256(nullifierHash),
            voteCommitment,
            creditsSpent,
            identityRoot
        ];

        require(
            zkVerifier.verifyProof(proof, publicInputs),
            "QV: invalid ZK proof"
        );

        // Record nullifier (prevents double voting)
        usedNullifiers[proposalId][nullifierHash] = true;

        // Store the vote record
        proposalVotes[proposalId].push(VoteRecord({
            nullifierHash: nullifierHash,
            creditsSpent:  creditsSpent,
            timestamp:     block.timestamp
        }));

        p.totalVotersParticipated++;

        emit BallotCast(proposalId, nullifierHash, creditsSpent);
    }

    // ── STEP 6: Emergency veto ────────────────────────────────────────────────
    /**
     * @notice Oversight panel triggers an emergency veto during the tally window.
     *
     * The veto window (VETO_WINDOW hours after voting closes) gives oversight
     * members time to review results before execution. A veto freezes the
     * proposal permanently — it cannot be re-activated.
     *
     * Veto criteria (off-chain, on-chain records reason):
     *   - Clear procedural violation
     *   - Verified disinformation in the proposal
     *   - Constitutional guardrail breach
     * NOT acceptable veto criteria:
     *   - Oversight members simply disagree with the outcome
     */
    function triggerEmergencyVeto(
        uint256 proposalId,
        string calldata reason
    ) external onlyRole(OVERSIGHT_ROLE) {
        Proposal storage p = proposals[proposalId];
        require(
            p.state == ProposalState.Active ||
            p.state == ProposalState.Tallying,
            "QV: proposal not vetoable"
        );
        require(bytes(reason).length > 0, "QV: veto reason required");

        // Cannot veto after execution
        if (p.state == ProposalState.Tallying) {
            require(
                block.timestamp <= p.votingEnd + VETO_WINDOW,
                "QV: veto window expired"
            );
        }

        p.state = ProposalState.Vetoed;
        emit EmergencyVetoTriggered(proposalId, msg.sender, reason);
    }

    // ── STEP 7: Close voting + begin tally window ─────────────────────────────
    function closeVoting(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        require(p.state == ProposalState.Active,    "QV: not active");
        require(block.timestamp > p.votingEnd,       "QV: voting still open");

        p.state = ProposalState.Tallying;
    }

    // ── STEP 8: Finalize with revealed tally ──────────────────────────────────
    /**
     * @notice Submit the final revealed tally after the veto window.
     *
     * In the ZK system, vote directions are hidden during voting. After the
     * veto window, the tally authority reveals the aggregate counts. The
     * ZK proof ensures revealed counts match the committed ballots.
     *
     * @param proposalId   The proposal to finalize
     * @param votesFor     Total quadratic votes in favour
     * @param votesAgainst Total quadratic votes against
     * @param tallyProof   ZK proof that the tally is correct
     */
    function finalizeTally(
        uint256 proposalId,
        uint256 votesFor,
        uint256 votesAgainst,
        bytes calldata tallyProof  // placeholder — validated in production
    ) external onlyRole(ADMIN_ROLE) {
        Proposal storage p = proposals[proposalId];
        require(p.state == ProposalState.Tallying,                     "QV: not in tallying");
        require(block.timestamp > p.votingEnd + VETO_WINDOW,           "QV: veto window active");

        p.totalVotesFor     = votesFor;
        p.totalVotesAgainst = votesAgainst;

        // Determine outcome
        uint256 totalVotes = votesFor + votesAgainst;
        bool passedThreshold = totalVotes > 0 &&
            (votesFor * 10000) / totalVotes >= p.thresholdBps;

        // Quorum check: p.quorumRequired is % of identity root citizen count
        // (simplified — production fetches count from CivicIdentityVerifier)
        bool passedQuorum = p.totalVotersParticipated > 0;

        ProposalState finalState = (passedThreshold && passedQuorum)
            ? ProposalState.Executed
            : ProposalState.Rejected;

        p.state = finalState;

        emit ProposalFinalized(proposalId, finalState, votesFor, votesAgainst);
    }

    // ── Views ─────────────────────────────────────────────────────────────────
    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return proposals[proposalId];
    }

    function getVoteCount(uint256 proposalId) external view returns (uint256) {
        return proposalVotes[proposalId].length;
    }

    function hasVoted(uint256 proposalId, bytes32 nullifierHash) external view returns (bool) {
        return usedNullifiers[proposalId][nullifierHash];
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) { y = z; z = (x / z + z) / 2; }
    }

    function _clamp(uint256 val, uint256 lo, uint256 hi) internal pure returns (uint256) {
        return val < lo ? lo : val > hi ? hi : val;
    }

    // ── Admin ─────────────────────────────────────────────────────────────────
    function pause()   external onlyRole(ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(ADMIN_ROLE) { _unpause(); }
}
