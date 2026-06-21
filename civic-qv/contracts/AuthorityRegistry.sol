// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title AuthorityRegistry
 * @notice Maintains the registry of accredited KYC authorities authorised to
 *         execute identity revocations in the Open Governance Protocol.
 *
 * @dev Accreditation is granted by OGP's constitutional governance layer —
 *      not by OGP's development team. The GOVERNANCE_ROLE address must be
 *      the constitutional governance multi-sig in production deployments.
 *
 *      This contract is read by RevocationRegistry via an immutable reference
 *      set at RevocationRegistry deployment. That reference can never be changed,
 *      which means this contract's address is a permanent trust anchor.
 *
 * Authority tiers (see /docs/key-recovery.md §1.2):
 *   TIER_1 — National government identity agencies (production)
 *   TIER_2 — Internationally recognised NGOs e.g. UNHCR (transitional)
 *   TIER_3 — Designated test authorities (PoC / development only)
 *
 * In production deployments (isProduction = true), registering a TIER_3
 * authority is permanently blocked at the contract level.
 */
contract AuthorityRegistry is AccessControl {

    // -------------------------------------------------------------------------
    // Roles
    // -------------------------------------------------------------------------

    /**
     * @notice Grants the ability to register and deregister KYC authorities.
     *         Must be held by OGP's constitutional governance multi-sig in
     *         production. Held by the deployer address in PoC / development.
     */
    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");

    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    /**
     * @notice Tier classification for accredited KYC authorities.
     *         See /docs/key-recovery.md §1.2 for full definitions.
     */
    enum AuthorityTier {
        TIER_1, // National government identity agencies
        TIER_2, // Internationally recognised NGOs (e.g. UNHCR)
        TIER_3  // PoC / development test authorities — blocked in production
    }

    /**
     * @notice On-chain record for each registered KYC authority.
     * @param active          Whether this authority is currently active.
     * @param tier            Classification tier (see AuthorityTier).
     * @param registeredAt    Block timestamp at time of registration.
     * @param descriptionHash keccak256 hash of the off-chain accreditation
     *                        document. The document stays off-chain; the hash
     *                        proves it existed at registration time and allows
     *                        governance to produce it if challenged.
     */
    struct AuthorityInfo {
        bool         active;
        AuthorityTier tier;
        uint256      registeredAt;
        bytes32      descriptionHash;
    }

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /**
     * @notice True if this is a production deployment.
     *         When true, registering TIER_3 authorities is permanently blocked.
     *         Set once in the constructor; immutable thereafter.
     */
    bool public immutable isProduction;

    /// @dev authority address → registration record
    mapping(address => AuthorityInfo) private _authorities;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /**
     * @notice Emitted when a new KYC authority is registered.
     * @param authority       The registered authority address.
     * @param tier            The authority's classification tier.
     * @param descriptionHash Hash of the off-chain accreditation document.
     */
    event AuthorityRegistered(
        address indexed authority,
        AuthorityTier   tier,
        bytes32         descriptionHash
    );

    /**
     * @notice Emitted when a KYC authority is deregistered.
     *         This is the governance response to a compromised authority.
     *         See /docs/key-recovery.md §3 for the full response protocol.
     * @param authority The deregistered authority address.
     * @param by        The governance address that executed the deregistration.
     */
    event AuthorityDeregistered(
        address indexed authority,
        address indexed by
    );

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /**
     * @param _isProduction    Pass true for mainnet deployments. Permanently
     *                         blocks TIER_3 authority registration.
     * @param _governanceAddr  Address granted GOVERNANCE_ROLE. Must be OGP's
     *                         constitutional governance multi-sig in production.
     *                         Can be a deployer EOA for PoC testing.
     */
    constructor(bool _isProduction, address _governanceAddr) {
        require(_governanceAddr != address(0), "AuthorityRegistry: zero governance address");

        isProduction = _isProduction;

        _grantRole(DEFAULT_ADMIN_ROLE, _governanceAddr);
        _grantRole(GOVERNANCE_ROLE,    _governanceAddr);
    }

    // -------------------------------------------------------------------------
    // Authority management — GOVERNANCE_ROLE only
    // -------------------------------------------------------------------------

    /**
     * @notice Register a new accredited KYC authority.
     *         Callable only by GOVERNANCE_ROLE (OGP constitutional governance).
     *
     * @param authority       The KYC authority's wallet address. In production
     *                        this must be a Gnosis Safe (or equivalent multi-sig)
     *                        configured with the required signing threshold
     *                        (2-of-3 minimum, 3-of-5 recommended for production).
     *                        In PoC / development an EOA is acceptable.
     * @param tier            Accreditation tier. TIER_3 is blocked in production.
     * @param descriptionHash keccak256 hash of the off-chain accreditation document.
     */
    function registerAuthority(
        address       authority,
        AuthorityTier tier,
        bytes32       descriptionHash
    ) external onlyRole(GOVERNANCE_ROLE) {
        require(authority       != address(0),  "AuthorityRegistry: zero address");
        require(descriptionHash != bytes32(0),  "AuthorityRegistry: description hash required");
        require(!_authorities[authority].active, "AuthorityRegistry: already registered");

        if (isProduction) {
            require(
                tier != AuthorityTier.TIER_3,
                "AuthorityRegistry: TIER_3 authorities cannot be registered in production"
            );
        }

        _authorities[authority] = AuthorityInfo({
            active:          true,
            tier:            tier,
            registeredAt:    block.timestamp,
            descriptionHash: descriptionHash
        });

        emit AuthorityRegistered(authority, tier, descriptionHash);
    }

    /**
     * @notice Deregister a KYC authority. Used when an authority is compromised
     *         or loses accreditation. See /docs/key-recovery.md §3.
     *         Callable only by GOVERNANCE_ROLE.
     *
     *         IMPORTANT: Previously executed burns remain valid. Deregistration
     *         only prevents the authority from executing new burns. It does not
     *         retroactively invalidate historical RevocationRegistry records.
     *
     * @param authority The authority address to deregister.
     */
    function deregisterAuthority(address authority) external onlyRole(GOVERNANCE_ROLE) {
        require(_authorities[authority].active, "AuthorityRegistry: authority not active");

        _authorities[authority].active = false;

        emit AuthorityDeregistered(authority, msg.sender);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /**
     * @notice Returns true if the given address is a currently active,
     *         accredited KYC authority. Called by RevocationRegistry on every
     *         revokeToken() invocation.
     * @param authority The address to check.
     */
    function isAuthorised(address authority) external view returns (bool) {
        return _authorities[authority].active;
    }

    /**
     * @notice Returns full registration details for an authority address.
     *         Returns a zeroed struct if the address has never been registered.
     * @param authority The address to look up.
     */
    function getAuthorityInfo(address authority) external view returns (AuthorityInfo memory) {
        return _authorities[authority];
    }
}
