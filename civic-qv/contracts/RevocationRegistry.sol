// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./AuthorityRegistry.sol";

/**
 * @title RevocationRegistry
 * @notice Permanent, append-only record of all revoked XRPL identity tokens
 *         in the Open Governance Protocol.
 *
 * @dev This contract has two responsibilities:
 *      1. Accept revocation records from authorised KYC authorities and store
 *         them permanently. Burns are irreversible — there is no un-revoke.
 *      2. Answer isRevoked() queries from HierarchicalIdentityVerifier before
 *         any ZK identity proof is accepted.
 *
 * Trust anchor:
 *   The AuthorityRegistry address is set once in the constructor and stored
 *   as an immutable. It can never be changed. This means the contract's trust
 *   relationship with the authority registry is fixed at deployment — no admin
 *   function can redirect it to a different registry.
 *
 * Multi-sig enforcement:
 *   The requiredSignatures value is stored on-chain for transparency and audit.
 *   Threshold enforcement happens at the WALLET level — each registered KYC
 *   authority address in production must be a multi-sig wallet (e.g. Gnosis
 *   Safe) configured with the correct threshold:
 *     PoC / development : 2-of-3
 *     Production        : 3-of-5
 *   The contract trusts that if msg.sender is an authorised authority address,
 *   the required quorum of keyholders has already signed. This is the standard
 *   pattern for multi-sig → smart contract interactions.
 *
 *   In PoC / development deployments, registered authority addresses may be
 *   EOAs. This is acceptable for testing; it must not occur in production.
 *
 * Emergency deauthorisation:
 *   If a KYC authority's keys are compromised, two actions must occur in
 *   parallel:
 *     a) GOVERNANCE_ROLE calls AuthorityRegistry.deregisterAuthority() —
 *        formal removal from the authority registry.
 *     b) GOVERNANCE_ROLE calls this contract's emergencyDeauthorise() —
 *        belt-and-suspenders block within RevocationRegistry itself.
 *   Historical burns executed by the compromised authority remain in the
 *   registry and are NOT invalidated. See /docs/key-recovery.md §3.2.
 */
contract RevocationRegistry is AccessControl {

    // -------------------------------------------------------------------------
    // Roles
    // -------------------------------------------------------------------------

    /**
     * @notice Grants emergency deauthorisation capability and any future
     *         governance actions on this contract.
     *         Must be held by OGP's constitutional governance multi-sig
     *         in production. Can be a deployer EOA in PoC / development.
     */
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    /**
     * @notice Declared intent for every burn. Required — an undeclared burn
     *         cannot be recorded. This forces intent to exist on-chain as part
     *         of the permanent audit trail.
     */
    enum BurnReason {
        LOST_DEVICE,       // Citizen reported lost or inaccessible device
        COMPROMISED_KEY,   // Citizen reported key compromise or theft
        DEATH,             // Verified death — no reissuance follows
        FRAUD_INVESTIGATION, // Active fraud or identity abuse investigation
        REISSUANCE         // Normal reissuance flow replacing an existing token
    }

    /**
     * @notice Full metadata record stored for every revoked identity.
     * @param revoked             Always true when this record exists.
     * @param authority           KYC authority address that submitted the burn.
     * @param reason              Declared burn intent.
     * @param xrplNftokenId       The raw 32-byte XRPL NFTokenID — stored for
     *                            audit and XRPL-side cross-referencing. This is
     *                            NOT the mapping key; the identity commitment is.
     * @param caseReferenceHash   keccak256 hash of the KYC authority's off-chain
     *                            case file (liveness re-check documentation). The
     *                            document stays off-chain for citizen privacy; the
     *                            hash proves it existed at burn time.
     * @param blockNumber         Block number at time of revocation.
     * @param timestamp           Block timestamp at time of revocation.
     */
    struct RevocationRecord {
        bool       revoked;
        address    authority;
        BurnReason reason;
        bytes32    xrplNftokenId;
        bytes32    caseReferenceHash;
        uint256    blockNumber;
        uint256    timestamp;
    }

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /**
     * @notice Immutable reference to the AuthorityRegistry.
     *         Set once in the constructor. Cannot be changed.
     *         This is the permanent trust anchor for authority lookups.
     */
    AuthorityRegistry public immutable authorityRegistry;

    /**
     * @notice The multi-sig signing threshold this registry was deployed with.
     *         Stored on-chain for audit and transparency.
     *         Actual threshold enforcement is at the wallet layer — see notes above.
     *
     *         Minimum value: 2 (enforced in constructor).
     *         PoC recommended: 2
     *         Production recommended: 3
     */
    uint256 public immutable requiredSignatures;

    /**
     * @dev identityCommitment → full revocation record.
     *      Key = keccak256(utf8Bytes(xrplAddress)) — the Merkle leaf value
     *      used throughout civic-oracle. This is what HierarchicalIdentityVerifier
     *      holds from the ZK proof, so it can call isRevoked() directly.
     *      The raw XRPL NFTokenID is stored inside RevocationRecord for audit.
     */
    mapping(bytes32 => RevocationRecord) private _revocations;

    /**
     * @dev Emergency deauthorisation list. An authority appearing here is
     *      blocked from calling revokeToken() on this contract even if they
     *      remain active in AuthorityRegistry (belt-and-suspenders safety).
     *      Only GOVERNANCE_ROLE can add entries here.
     */
    mapping(address => bool) private _emergencyDeauthorised;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /**
     * @notice Emitted on every successful token revocation.
     *         This event contains the complete audit trail for a burn.
     *         Off-chain indexers should watch this event to keep derived
     *         state in sync (e.g. civic-oracle Merkle tree pruning).
     */
    event TokenRevoked(
        bytes32 indexed tokenId,
        address indexed authority,
        BurnReason      reason,
        bytes32         caseReferenceHash,
        uint256         blockNumber,
        uint256         timestamp
    );

    /**
     * @notice Emitted when GOVERNANCE_ROLE emergency-deauthorises an authority
     *         on this contract (belt-and-suspenders — parallel to
     *         AuthorityRegistry.deregisterAuthority()).
     */
    event AuthorityEmergencyDeauthorised(
        address indexed authority,
        address indexed by,
        uint256         timestamp
    );

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    /**
     * @dev Reverts if the caller is not currently an active, accredited KYC
     *      authority, or if they have been emergency-deauthorised on this
     *      contract.
     */
    modifier onlyAuthorisedAuthority() {
        require(
            authorityRegistry.isAuthorised(msg.sender),
            "RevocationRegistry: caller is not an authorised KYC authority"
        );
        require(
            !_emergencyDeauthorised[msg.sender],
            "RevocationRegistry: caller has been emergency-deauthorised"
        );
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /**
     * @param _authorityRegistry  Address of the deployed AuthorityRegistry.
     *                            Stored as immutable — cannot be changed after
     *                            deployment.
     * @param _requiredSignatures Multi-sig threshold. Minimum 2.
     *                            Use 2 for PoC, 3 for production.
     *                            Stored for audit transparency; enforcement is
     *                            at the wallet layer.
     * @param _governanceAddr     Address granted GOVERNANCE_ROLE. Must be OGP's
     *                            constitutional governance multi-sig in production.
     */
    constructor(
        address _authorityRegistry,
        uint256 _requiredSignatures,
        address _governanceAddr
    ) {
        require(_authorityRegistry != address(0), "RevocationRegistry: zero authority registry address");
        require(_governanceAddr    != address(0), "RevocationRegistry: zero governance address");
        require(
            _requiredSignatures >= 2,
            "RevocationRegistry: minimum required signatures is 2"
        );

        authorityRegistry  = AuthorityRegistry(_authorityRegistry);
        requiredSignatures = _requiredSignatures;

        _grantRole(DEFAULT_ADMIN_ROLE, _governanceAddr);
        _grantRole(GOVERNANCE_ROLE,    _governanceAddr);
    }

    // -------------------------------------------------------------------------
    // Core revocation — authorised KYC authorities only
    // -------------------------------------------------------------------------

    /**
     * @notice Record the permanent revocation of an XRPL identity.
     *         Callable only by an active, accredited KYC authority that has
     *         not been emergency-deauthorised.
     *
     *         In production, msg.sender must be a multi-sig wallet configured
     *         with the requiredSignatures threshold. The wallet enforces that
     *         the quorum of keyholders has signed before this transaction is
     *         submitted.
     *
     *         Burns are permanent. There is no un-revoke function.
     *
     * @param identityCommitment keccak256(utf8Bytes(xrplAddress)) — the Merkle
     *                           leaf value for this citizen in civic-oracle.
     *                           This is the mapping key and the value that
     *                           HierarchicalIdentityVerifier will pass to
     *                           isRevoked() when checking ZK proofs.
     * @param xrplNftokenId      The raw 32-byte XRPL NFTokenID of the burned
     *                           token. Stored as audit metadata alongside the
     *                           record — not used as the lookup key.
     * @param reason             Declared burn intent. Cannot be omitted.
     * @param caseReferenceHash  keccak256 hash of the KYC authority's off-chain
     *                           case file. Cannot be zero — every burn must have
     *                           a reference to supporting documentation.
     */
    function revokeToken(
        bytes32    identityCommitment,
        bytes32    xrplNftokenId,
        BurnReason reason,
        bytes32    caseReferenceHash
    ) external onlyAuthorisedAuthority {
        require(identityCommitment != bytes32(0), "RevocationRegistry: identity commitment cannot be zero");
        require(xrplNftokenId      != bytes32(0), "RevocationRegistry: NFTokenID cannot be zero");
        require(caseReferenceHash  != bytes32(0), "RevocationRegistry: case reference hash required");
        require(
            !_revocations[identityCommitment].revoked,
            "RevocationRegistry: identity already revoked"
        );

        _revocations[identityCommitment] = RevocationRecord({
            revoked:           true,
            authority:         msg.sender,
            reason:            reason,
            xrplNftokenId:     xrplNftokenId,
            caseReferenceHash: caseReferenceHash,
            blockNumber:       block.number,
            timestamp:         block.timestamp
        });

        emit TokenRevoked(
            identityCommitment,
            msg.sender,
            reason,
            caseReferenceHash,
            block.number,
            block.timestamp
        );
    }

    // -------------------------------------------------------------------------
    // Emergency deauthorisation — GOVERNANCE_ROLE only
    // -------------------------------------------------------------------------

    /**
     * @notice Emergency belt-and-suspenders deauthorisation of a compromised
     *         KYC authority within this contract.
     *
     *         This should be called in parallel with
     *         AuthorityRegistry.deregisterAuthority() when a KYC authority's
     *         keys are known to be compromised.
     *
     *         See /docs/key-recovery.md §3 for the full response protocol.
     *         Note: this does NOT retroactively invalidate previous burns by
     *         this authority. Historical records remain valid.
     *
     * @param authority The compromised authority address to block.
     */
    function emergencyDeauthorise(address authority) external onlyRole(GOVERNANCE_ROLE) {
        require(authority != address(0), "RevocationRegistry: zero address");
        require(
            !_emergencyDeauthorised[authority],
            "RevocationRegistry: already emergency-deauthorised"
        );

        _emergencyDeauthorised[authority] = true;

        emit AuthorityEmergencyDeauthorised(authority, msg.sender, block.timestamp);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /**
     * @notice Returns true if the given identity commitment has been revoked.
     *         This is the function called by HierarchicalIdentityVerifier
     *         before accepting any ZK identity proof.
     *
     * @param identityCommitment keccak256(utf8Bytes(xrplAddress)) — the value
     *                           extracted from the ZK proof's public inputs.
     */
    function isRevoked(bytes32 identityCommitment) external view returns (bool) {
        return _revocations[identityCommitment].revoked;
    }

    /**
     * @notice Returns the full revocation record for a given identity commitment.
     *         Reverts if the identity has not been revoked.
     *         Use isRevoked() for lightweight existence checks.
     *
     * @param identityCommitment keccak256(utf8Bytes(xrplAddress)) to look up.
     */
    function getRevocationRecord(bytes32 identityCommitment) external view returns (RevocationRecord memory) {
        require(
            _revocations[identityCommitment].revoked,
            "RevocationRegistry: identity has not been revoked"
        );
        return _revocations[identityCommitment];
    }

    /**
     * @notice Returns true if the given authority has been emergency-deauthorised
     *         on this contract (independent of their status in AuthorityRegistry).
     *
     * @param authority The authority address to check.
     */
    function isEmergencyDeauthorised(address authority) external view returns (bool) {
        return _emergencyDeauthorised[authority];
    }
}
