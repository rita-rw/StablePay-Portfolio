// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {StablePayEscrow} from "./StablePayEscrow.sol";

/**
 * @title EscrowFactory
 * @notice This contract creates new escrow contracts for projects.
 *         Think of it as a "escrow machine" — buyers call createEscrow()
 *         and get back a fresh escrow contract ready to use.
 * @dev Also manages which payment tokens are allowed and tracks all created escrows.
 */
contract EscrowFactory {
    // ============ Events ============
    // Events are logs written to the blockchain.
    // They cost very little gas and let the frontend/backend know something happened.

    /// @notice Emitted when a token is added or removed from the approved list
    event TokenApprovalChanged(address indexed token, bool approved);

    /// @notice Emitted when the platform fee changes
    event PlatformFeeChanged(uint256 oldFeeBps, uint256 newFeeBps);

    /// @notice Emitted when the default auto-approval period changes
    event DefaultAutoApprovalDaysChanged(uint256 oldDays, uint256 newDays);

    /// @notice Emitted when the default dispute timeout period changes
    event DefaultDisputeTimeoutDaysChanged(uint256 oldDays, uint256 newDays);

    /// @notice Emitted when the default correction window period changes
    event DefaultCorrectionWindowDaysChanged(uint256 oldDays, uint256 newDays);

    /// @notice Emitted every time a new escrow contract is deployed
    event EscrowCreated(
        address indexed escrow,
        address indexed buyer,
        address indexed seller,
        address token,
        uint256 totalAmount,
        uint256 milestoneCount,
        bytes32 metadataHash
    );

    // ============ Errors ============
    // Custom errors are cheaper than require() strings and easier to read in logs.

    // Access control
    error OnlyPlatform(); // Caller is not the platform address

    // Token whitelist
    error InvalidTokenAddress(); // Token address is zero (invalid)
    error TokenNotApproved(); // This token is not on the approved whitelist

    // Escrow creation — input validation
    error BuyerSellerSame(); // Buyer and seller cannot be the same person
    error InvalidSeller(); // seller = address(0) would send payments to a burn address
    error NoMilestones(); // Must have at least one milestone
    error InvalidMilestoneAmount(); // A milestone amount cannot be zero
    error TooManyMilestones(); // Prevents gas attacks on loops (e.g. cancelEscrow)
    error FeeTooHigh(); // Current fee is higher than the buyer agreed to accept

    // Admin settings — boundary checks
    error AutoApprovalDaysTooLow(); // Auto-approval period is below the minimum
    error AutoApprovalDaysTooHigh(); // Auto-approval period is above the maximum
    error DisputeTimeoutDaysTooLow(); // Dispute timeout is below the minimum
    error DisputeTimeoutDaysTooHigh(); // Dispute timeout is above the maximum
    error CorrectionWindowDaysTooHigh(); // Correction window is above the maximum

    // ============ Constants ============
    // Constants are fixed values that never change. They are cheaper to use than regular variables.

    /// @notice Maximum platform fee allowed: 10% (1000 basis points)
    /// @dev 1 basis point = 0.01%, so 1000 bps = 10%
    uint256 public constant MAX_FEE_BPS = 1000;

    /// @notice Auto-approval period must be between 1 and 90 days
    uint256 public constant MIN_AUTO_APPROVAL_DAYS = 1;
    uint256 public constant MAX_AUTO_APPROVAL_DAYS = 90;

    /// @notice Dispute timeout must be between 14 and 180 days
    uint256 public constant MIN_DISPUTE_TIMEOUT_DAYS = 14;
    uint256 public constant MAX_DISPUTE_TIMEOUT_DAYS = 180;

    /// @notice Correction window can be 0 (disabled, admin resolves immediately) up to 30 days
    uint256 public constant MAX_CORRECTION_WINDOW_DAYS = 30;

    /// @notice Maximum number of milestones per escrow
    /// @dev Prevents gas attacks where someone creates an escrow with thousands of milestones,
    ///      making loops like cancelEscrow() too expensive to run.
    uint256 public constant MAX_MILESTONES = 50;

    // ============ State Variables ============
    // These are stored on the blockchain and cost gas to update.

    /// @notice The platform address — can manage tokens, change fees, and receive fees
    /// @dev immutable = set once in constructor, can never be changed after that
    address public immutable PLATFORM;

    /// @notice Current platform fee in basis points (250 = 2.5%)
    uint256 public platformFeeBps;

    /// @notice How many days before a submitted milestone is auto-approved (default: 14)
    uint256 public defaultAutoApprovalDays;

    /// @notice How many days before a dispute can be claimed as timed out (default: 30)
    uint256 public defaultDisputeTimeoutDays;

    /// @notice How many days the seller has to resubmit after a buyer-opened dispute (default: 0)
    uint256 public defaultCorrectionWindowDays;

    /// @notice Which tokens buyers are allowed to pay with (e.g. USDC)
    mapping(address => bool) public approvedTokens;

    /// @notice Quick lookup: is this address a real escrow created by this factory?
    mapping(address => bool) public isValidEscrow;

    /// @notice List of every escrow contract ever created
    address[] internal _allEscrows;

    /// @notice All escrows created by a specific buyer
    mapping(address => address[]) internal _escrowsByBuyer;

    /// @notice All escrows a specific seller is part of
    mapping(address => address[]) internal _escrowsBySeller;

    // ============ Constructor ============
    // The constructor runs once when this contract is deployed.

    /**
     * @notice Sets up the factory with the platform address and default settings
     * @param _platform The address that will manage the factory and receive fees
     */
    constructor(address _platform) {
        require(_platform != address(0), "Invalid platform address");
        PLATFORM = _platform;

        // Start with a 2.5% platform fee
        platformFeeBps = 250;

        // Buyers have 14 days to approve a submission before the seller can auto-claim
        defaultAutoApprovalDays = 14;

        // If a dispute sits unresolved for 30 days, either party can trigger a timeout
        defaultDisputeTimeoutDays = 30;

        // Seller correction window after a buyer-opened dispute — set to 0 for testing
        defaultCorrectionWindowDays = 0;
    }

    // ============ Modifiers ============
    // A modifier is reusable "guard" code that runs before a function.

    /// @notice Only the platform address can call functions with this modifier
    modifier onlyPlatform() {
        if (msg.sender != PLATFORM) revert OnlyPlatform();
        _;
    }

    // ============ Token Whitelist ============
    // Only approved tokens can be used for payments.
    // This protects against scam tokens or tokens with weird behavior (e.g. fee-on-transfer).

    /**
     * @notice Adds a token to the approved payment whitelist
     * @param token Address of the ERC20 token to approve (e.g. USDC)
     */
    function approveToken(address token) external onlyPlatform {
        if (token == address(0)) revert InvalidTokenAddress();
        approvedTokens[token] = true;
        emit TokenApprovalChanged(token, true);
    }

    /**
     * @notice Removes a token from the approved payment whitelist
     * @param token Address of the ERC20 token to remove
     */
    function removeToken(address token) external onlyPlatform {
        if (token == address(0)) revert InvalidTokenAddress();
        approvedTokens[token] = false;
        emit TokenApprovalChanged(token, false);
    }

    // ============ Admin Settings ============
    // Only the platform can update these settings.
    // Changes only affect future escrows — existing ones keep their original settings.

    /**
     * @notice Updates the platform service fee
     * @param newFeeBps New fee in basis points — max 1000 (= 10%)
     */
    function setPlatformFeeBps(uint256 newFeeBps) external onlyPlatform {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        uint256 oldFee = platformFeeBps;
        platformFeeBps = newFeeBps;
        emit PlatformFeeChanged(oldFee, newFeeBps);
    }

    /**
     * @notice Updates how many days before a submitted milestone is auto-approved
     * @param newDays Must be between MIN_AUTO_APPROVAL_DAYS and MAX_AUTO_APPROVAL_DAYS
     */
    function setDefaultAutoApprovalDays(uint256 newDays) external onlyPlatform {
        if (newDays < MIN_AUTO_APPROVAL_DAYS) revert AutoApprovalDaysTooLow();
        if (newDays > MAX_AUTO_APPROVAL_DAYS) revert AutoApprovalDaysTooHigh();
        uint256 oldDays = defaultAutoApprovalDays;
        defaultAutoApprovalDays = newDays;
        emit DefaultAutoApprovalDaysChanged(oldDays, newDays);
    }

    /**
     * @notice Updates how many days before a dispute can be claimed as timed out
     * @param newDays Must be between MIN_DISPUTE_TIMEOUT_DAYS and MAX_DISPUTE_TIMEOUT_DAYS
     */
    function setDefaultDisputeTimeoutDays(uint256 newDays) external onlyPlatform {
        if (newDays < MIN_DISPUTE_TIMEOUT_DAYS) revert DisputeTimeoutDaysTooLow();
        if (newDays > MAX_DISPUTE_TIMEOUT_DAYS) revert DisputeTimeoutDaysTooHigh();
        uint256 oldDays = defaultDisputeTimeoutDays;
        defaultDisputeTimeoutDays = newDays;
        emit DefaultDisputeTimeoutDaysChanged(oldDays, newDays);
    }

    /**
     * @notice Updates how many days the seller has to resubmit after a buyer-opened dispute
     * @param newDays Must be between 0 and MAX_CORRECTION_WINDOW_DAYS (0 = admin resolves immediately)
     */
    function setDefaultCorrectionWindowDays(uint256 newDays) external onlyPlatform {
        if (newDays > MAX_CORRECTION_WINDOW_DAYS) revert CorrectionWindowDaysTooHigh();
        uint256 oldDays = defaultCorrectionWindowDays;
        defaultCorrectionWindowDays = newDays;
        emit DefaultCorrectionWindowDaysChanged(oldDays, newDays);
    }

    // ============ Escrow Creation ============

    /**
     * @notice Creates a new escrow contract for a project
     *
     * @param seller     Who will receive payment (the service provider)
     * @param token      Which token to pay with — must be on the approved whitelist
     * @param milestoneAmounts  Array of payment amounts, one per milestone
     * @param metadataHash      Hash of off-chain project details (stored cheaply on-chain)
     * @param maxFeeBps  The highest fee the buyer is willing to accept, in basis points.
     *                   This protects against frontrunning: if the platform raises the fee
     *                   between when the buyer loaded the page and when the transaction is
     *                   mined, the transaction reverts instead of silently charging more.
     *
     * @return escrow    Address of the newly deployed escrow contract
     */
    function createEscrow(
        address seller,
        address token,
        uint256[] calldata milestoneAmounts,
        bytes32 metadataHash,
        uint256 maxFeeBps
    ) external returns (address escrow) {
        // --- Input validation ---

        // Seller must be a real address (not zero), otherwise payments would be lost
        if (seller == address(0)) revert InvalidSeller();

        // Buyer and seller cannot be the same person
        if (msg.sender == seller) revert BuyerSellerSame();

        // Only whitelisted tokens are allowed
        if (!approvedTokens[token]) revert TokenNotApproved();

        // Must have at least one milestone
        if (milestoneAmounts.length == 0) revert NoMilestones();

        // Cap milestones to prevent gas attacks on loops elsewhere in the contract
        if (milestoneAmounts.length > MAX_MILESTONES) revert TooManyMilestones();

        // Read current settings into local variables (slightly cheaper than reading storage twice)
        uint256 feeBps = platformFeeBps;
        uint256 autoApprovalDays = defaultAutoApprovalDays;
        uint256 disputeTimeoutDays = defaultDisputeTimeoutDays;
        uint256 correctionWindowDays = defaultCorrectionWindowDays;

        // Frontrunning protection: revert if the current fee is higher than the buyer accepted
        if (feeBps > maxFeeBps) revert FeeTooHigh();

        // Validate that no milestone has a zero amount, and calculate the total
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < milestoneAmounts.length; i++) {
            if (milestoneAmounts[i] == 0) revert InvalidMilestoneAmount();
            totalAmount += milestoneAmounts[i];
        }

        // --- Deploy the escrow contract ---
        StablePayEscrow newEscrow = new StablePayEscrow(
            msg.sender, // buyer = whoever is calling this function
            seller,
            PLATFORM,
            token,
            feeBps,
            milestoneAmounts,
            metadataHash,
            autoApprovalDays,
            disputeTimeoutDays,
            correctionWindowDays
        );
        escrow = address(newEscrow);

        // --- Track the new escrow ---
        isValidEscrow[escrow] = true;
        _allEscrows.push(escrow);
        _escrowsByBuyer[msg.sender].push(escrow);
        _escrowsBySeller[seller].push(escrow);

        emit EscrowCreated(escrow, msg.sender, seller, token, totalAmount, milestoneAmounts.length, metadataHash);
    }

    // ============ View Functions ============
    // "view" means these functions only READ data — they never change anything.
    // Calling them from a backend/frontend costs zero gas.
    // No access control needed — anyone is allowed to read this data.

    /// @notice Returns all escrows created by a specific buyer
    /// @dev Returns an empty array if the buyer has never created an escrow (no revert)
    function getEscrowsByBuyer(address buyer) external view returns (address[] memory) {
        return _escrowsByBuyer[buyer];
    }

    /// @notice Returns all escrows a specific seller is part of
    /// @dev Returns an empty array if the seller has never been part of an escrow
    function getEscrowsBySeller(address seller) external view returns (address[] memory) {
        return _escrowsBySeller[seller];
    }

    /// @notice Returns every escrow contract ever created by this factory
    /// @dev Useful for admin dashboards. Note: the list only grows — escrows are never removed,
    ///      even if they are cancelled or completed.
    function getAllEscrows() external view returns (address[] memory) {
        return _allEscrows;
    }

    /// @notice Returns the total number of escrows ever created
    /// @dev Cheaper than getAllEscrows() if you only need the count, not the full list
    function getEscrowCount() external view returns (uint256) {
        return _allEscrows.length;
    }
}
