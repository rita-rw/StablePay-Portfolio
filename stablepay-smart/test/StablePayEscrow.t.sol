// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20Mock} from "openzeppelin-contracts/contracts/mocks/token/ERC20Mock.sol";
import {EscrowFactory} from "../src/EscrowFactory.sol";
import {StablePayEscrow} from "../src/StablePayEscrow.sol";

contract EscrowFactoryTest is Test {
    EscrowFactory public factory;
    ERC20Mock public token;

    address public platform = address(1);
    address public buyer = address(2);
    address public seller = address(3);

    function setUp() public {
        factory = new EscrowFactory(platform);
        token = new ERC20Mock();

        // Approve token as platform
        vm.prank(platform);
        factory.approveToken(address(token));
    }

    function test_FactoryDeployment() public view {
        assertEq(factory.PLATFORM(), platform);
    }

    function test_TokenApproval() public view {
        assertTrue(factory.approvedTokens(address(token)));
    }

    // ============ Helper: create funded + disputed escrow ============

    function _createDisputedEscrow(uint256 amount) internal returns (StablePayEscrow) {
        uint256[] memory milestones = new uint256[](1);
        milestones[0] = amount;

        vm.prank(buyer);
        address escrowAddr = factory.createEscrow(seller, address(token), milestones, keccak256("meta"), 1000);
        StablePayEscrow escrow = StablePayEscrow(escrowAddr);

        vm.prank(seller);
        escrow.acceptProject();

        token.mint(buyer, amount);
        vm.startPrank(buyer);
        token.approve(escrowAddr, amount);
        escrow.fund();
        vm.stopPrank();

        vm.prank(seller);
        escrow.submitMilestone(0, keccak256("delivery"));

        vm.prank(buyer);
        escrow.openDispute(0, keccak256("reason"));

        return escrow;
    }

    function test_DisputeFee_SellerGetsAll() public {
        uint256 amount = 1000 ether;
        StablePayEscrow escrow = _createDisputedEscrow(amount);

        // Calculate expected values
        uint256 expectedDisputeFee = (amount * 100) / 10_000; // 1% of total = 10
        uint256 remaining = amount - expectedDisputeFee; // 990
        uint256 sellerAward = remaining; // seller gets all remaining

        uint256 expectedPlatformFee = (sellerAward * 250) / 10_000; // 2.5% of 990
        uint256 expectedSellerNet = sellerAward - expectedPlatformFee;

        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(platform);
        escrow.resolveDispute(0, sellerAward);

        // Dispute fee is 1% of TOTAL (not sellerAward)
        assertEq(token.balanceOf(platform), expectedPlatformFee + expectedDisputeFee);
        assertEq(token.balanceOf(seller), expectedSellerNet);
        assertEq(token.balanceOf(buyer), 0);
    }

    function test_DisputeFee_BuyerGetsAll() public {
        uint256 amount = 1000 ether;
        StablePayEscrow escrow = _createDisputedEscrow(amount);

        uint256 expectedDisputeFee = (amount * 100) / 10_000; // 1% of total = 10
        uint256 remaining = amount - expectedDisputeFee; // 990

        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(platform);
        escrow.resolveDispute(0, 0); // seller gets nothing

        // Platform STILL gets dispute fee even when buyer gets 100%
        assertEq(token.balanceOf(platform), expectedDisputeFee);
        assertEq(token.balanceOf(seller), 0);
        assertEq(token.balanceOf(buyer), remaining);
    }

    function test_DisputeFee_FiftySplit() public {
        uint256 amount = 1000 ether;
        StablePayEscrow escrow = _createDisputedEscrow(amount);

        uint256 expectedDisputeFee = (amount * 100) / 10_000; // 1% of total = 10
        uint256 remaining = amount - expectedDisputeFee; // 990
        uint256 sellerAward = remaining / 2; // 495
        uint256 buyerAward = remaining - sellerAward; // 495

        uint256 expectedPlatformFee = (sellerAward * 250) / 10_000; // 2.5% of 495
        uint256 expectedSellerNet = sellerAward - expectedPlatformFee;

        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(platform);
        escrow.resolveDispute(0, sellerAward);

        // Dispute fee is STILL 1% of total — same as the other two tests!
        assertEq(token.balanceOf(platform), expectedPlatformFee + expectedDisputeFee);
        assertEq(token.balanceOf(seller), expectedSellerNet);
        assertEq(token.balanceOf(buyer), buyerAward);
    }

    // ============ Finding #7: RESOLVED-status efter tvist ============

    /// @dev Om båda parter får pengar → status ska vara RESOLVED (inte PAID/REFUNDED).
    function test_ResolveDispute_SplitAward_StatusIsResolved() public {
        uint256 amount = 1000 ether;
        StablePayEscrow escrow = _createDisputedEscrow(amount);

        uint256 disputeFee = (amount * 100) / 10_000;
        uint256 remaining = amount - disputeFee;
        uint256 sellerAward = remaining / 2;

        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(platform);
        escrow.resolveDispute(0, sellerAward);

        (, StablePayEscrow.MilestoneStatus status,,,,,) = escrow.milestones(0);
        assertEq(uint256(status), uint256(StablePayEscrow.MilestoneStatus.RESOLVED));
    }

    /// @dev Om seller får allt → status ska vara PAID (leverans godkänd via tvist).
    function test_ResolveDispute_SellerGetsAll_StatusIsPaid() public {
        uint256 amount = 1000 ether;
        StablePayEscrow escrow = _createDisputedEscrow(amount);

        uint256 disputeFee = (amount * 100) / 10_000;
        uint256 remaining = amount - disputeFee;

        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(platform);
        escrow.resolveDispute(0, remaining);

        (, StablePayEscrow.MilestoneStatus status,,,,,) = escrow.milestones(0);
        assertEq(uint256(status), uint256(StablePayEscrow.MilestoneStatus.PAID));
    }

    /// @dev Om buyer får allt → status ska vara REFUNDED.
    function test_ResolveDispute_BuyerGetsAll_StatusIsRefunded() public {
        uint256 amount = 1000 ether;
        StablePayEscrow escrow = _createDisputedEscrow(amount);

        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(platform);
        escrow.resolveDispute(0, 0);

        (, StablePayEscrow.MilestoneStatus status,,,,,) = escrow.milestones(0);
        assertEq(uint256(status), uint256(StablePayEscrow.MilestoneStatus.REFUNDED));
    }
}

/**
 * @dev Audit Finding #1 (Critical): "Funds locked forever" (pengar kan bli låsta för alltid)
 *
 * Mål: säkerställ att köparen kan avbryta och få tillbaka kvarvarande pengar när:
 * - escrow aldrig blev finansierad, eller
 * - escrow är finansierad men inget aktivt arbete finns (inga SUBMITTED/DISPUTED-milestones).
 *
 * Regler:
 * - Om NÅGON milestone är SUBMITTED eller DISPUTED måste avbryt revert:a (arbete är aktivt).
 * - Om vissa milestones redan är PAID ska endast återstående PENDING-milestones återbetalas.
 * - Efter avbryt måste fund() och submitMilestone() revert:a för att escrow inte ska kunna "öppnas" igen.
 */
contract CancelEscrowTest is Test {
    EscrowFactory public factory;
    ERC20Mock public token;

    address public platform = address(1);
    address public buyer = address(2);
    address public seller = address(3);

    function setUp() public {
        factory = new EscrowFactory(platform);
        token = new ERC20Mock();

        vm.prank(platform);
        factory.approveToken(address(token));
    }

    function _createEscrow(uint256[] memory amounts) internal returns (StablePayEscrow) {
        // Köparen skapar ett escrow via fabriken (speglar normal användning)
        vm.prank(buyer);
        address escrowAddr = factory.createEscrow(seller, address(token), amounts, keccak256("meta"), 1000);
        return StablePayEscrow(escrowAddr);
    }

    function _fundEscrow(StablePayEscrow escrow, uint256 amount) internal {
        // Hjälpfunktion: mint -> approve -> fund (köparen sätter in totalbeloppet)
        vm.prank(seller);
        escrow.acceptProject();

        token.mint(buyer, amount);
        vm.startPrank(buyer);
        token.approve(address(escrow), amount);
        escrow.fund();
        vm.stopPrank();
    }

    function test_CancelUnfundedEscrow() public {
        // Ofinansierad escrow: avbryt ska lyckas och bara sätta cancelled=true.
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 500 ether;
        amounts[1] = 500 ether;

        StablePayEscrow escrow = _createEscrow(amounts);

        assertFalse(escrow.cancelled());

        vm.prank(buyer);
        escrow.cancelEscrow();

        assertTrue(escrow.cancelled());
    }

    function test_CancelFundedEscrow_AllPending() public {
        // Finansierad escrow + alla milestones fortfarande PENDING → full återbetalning till köparen.
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 500 ether;
        amounts[1] = 500 ether;
        uint256 total = 1000 ether;

        StablePayEscrow escrow = _createEscrow(amounts);
        _fundEscrow(escrow, total);

        assertEq(token.balanceOf(buyer), 0);

        vm.prank(buyer);
        escrow.cancelEscrow();

        assertTrue(escrow.cancelled());
        assertEq(token.balanceOf(buyer), total);

        // Both milestones should be REFUNDED
        (, StablePayEscrow.MilestoneStatus status0,,,,,) = escrow.milestones(0);
        (, StablePayEscrow.MilestoneStatus status1,,,,,) = escrow.milestones(1);
        assertEq(uint256(status0), uint256(StablePayEscrow.MilestoneStatus.REFUNDED));
        assertEq(uint256(status1), uint256(StablePayEscrow.MilestoneStatus.REFUNDED));
    }

    function test_CancelFundedEscrow_OneSubmitted_Reverts() public {
        // Om någon milestone är SUBMITTED måste avbryt revert:a (aktivt arbete finns).
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 500 ether;
        amounts[1] = 500 ether;

        StablePayEscrow escrow = _createEscrow(amounts);
        _fundEscrow(escrow, 1000 ether);

        // Seller submits first milestone
        vm.prank(seller);
        escrow.submitMilestone(0, keccak256("delivery"));

        vm.prank(buyer);
        vm.expectRevert("Active milestone exists");
        escrow.cancelEscrow();
    }

    function test_CancelFundedEscrow_OneDisputed_Reverts() public {
        // Om någon milestone är DISPUTED måste avbryt revert:a (aktivt arbete finns).
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 500 ether;
        amounts[1] = 500 ether;

        StablePayEscrow escrow = _createEscrow(amounts);
        _fundEscrow(escrow, 1000 ether);

        // Seller submits and buyer disputes
        vm.prank(seller);
        escrow.submitMilestone(0, keccak256("delivery"));

        vm.prank(buyer);
        escrow.openDispute(0, keccak256("reason"));

        vm.prank(buyer);
        vm.expectRevert("Active milestone exists");
        escrow.cancelEscrow();
    }

    function test_CancelFundedEscrow_OnePaid_RefundsRemaining() public {
        // Om vissa milestones redan är PAID ska bara återstående PENDING-milestones återbetalas.
        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 300 ether;
        amounts[1] = 400 ether;
        amounts[2] = 300 ether;
        uint256 total = 1000 ether;

        StablePayEscrow escrow = _createEscrow(amounts);
        _fundEscrow(escrow, total);

        // Complete first milestone (seller submits, buyer approves)
        vm.prank(seller);
        escrow.submitMilestone(0, keccak256("delivery"));

        vm.prank(buyer);
        escrow.approveMilestone(0);

        // First milestone paid: seller got 300 - 2.5% = 292.5, platform got 7.5
        uint256 platformFee = (300 ether * 250) / 10_000; // 7.5 ether
        uint256 sellerPayout = 300 ether - platformFee; // 292.5 ether

        assertEq(token.balanceOf(seller), sellerPayout);
        assertEq(token.balanceOf(platform), platformFee);

        // Now cancel - should refund milestones 1 and 2 (700 ether)
        vm.prank(buyer);
        escrow.cancelEscrow();

        assertTrue(escrow.cancelled());
        assertEq(token.balanceOf(buyer), 700 ether);

        // Milestone 0 should be PAID, milestones 1 and 2 should be REFUNDED
        (, StablePayEscrow.MilestoneStatus status0,,,,,) = escrow.milestones(0);
        (, StablePayEscrow.MilestoneStatus status1,,,,,) = escrow.milestones(1);
        (, StablePayEscrow.MilestoneStatus status2,,,,,) = escrow.milestones(2);
        assertEq(uint256(status0), uint256(StablePayEscrow.MilestoneStatus.PAID));
        assertEq(uint256(status1), uint256(StablePayEscrow.MilestoneStatus.REFUNDED));
        assertEq(uint256(status2), uint256(StablePayEscrow.MilestoneStatus.REFUNDED));
    }

    function test_CancelEscrow_NonBuyer_Reverts() public {
        // Endast BUYER får avbryta. Seller/platform ska revert:a.
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1000 ether;

        StablePayEscrow escrow = _createEscrow(amounts);

        vm.prank(seller);
        vm.expectRevert("Only buyer");
        escrow.cancelEscrow();

        vm.prank(platform);
        vm.expectRevert("Only buyer");
        escrow.cancelEscrow();
    }

    function test_CancelEscrow_AlreadyCancelled_Reverts() public {
        // Att avbryta två gånger ska revert:a (ej idempotent i denna design).
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1000 ether;

        StablePayEscrow escrow = _createEscrow(amounts);

        vm.prank(buyer);
        escrow.cancelEscrow();

        vm.prank(buyer);
        vm.expectRevert("Already cancelled");
        escrow.cancelEscrow();
    }

    function test_FundAfterCancel_Reverts() public {
        // Skydd: efter avbryt ska köparen inte kunna finansiera escrow.
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1000 ether;

        StablePayEscrow escrow = _createEscrow(amounts);

        vm.prank(buyer);
        escrow.cancelEscrow();

        token.mint(buyer, 1000 ether);
        vm.startPrank(buyer);
        token.approve(address(escrow), 1000 ether);
        vm.expectRevert("Escrow cancelled");
        escrow.fund();
        vm.stopPrank();
    }

    function test_SubmitMilestoneAfterCancel_Reverts() public {
        // Skydd: efter avbryt ska säljaren inte kunna skicka in milestones.
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1000 ether;

        StablePayEscrow escrow = _createEscrow(amounts);
        _fundEscrow(escrow, 1000 ether);

        // Cancel the escrow
        vm.prank(buyer);
        escrow.cancelEscrow();

        // Seller tries to submit (should fail even though it's already REFUNDED)
        vm.prank(seller);
        vm.expectRevert("Escrow cancelled");
        escrow.submitMilestone(0, keccak256("delivery"));
    }
}

contract AutoApprovalTest is Test {
    EscrowFactory public factory;
    ERC20Mock public token;
    StablePayEscrow public escrow;

    address public platform = address(1);
    address public buyer = address(2);
    address public seller = address(3);

    uint256 constant MILESTONE_AMOUNT = 1000 ether;

    function setUp() public {
        factory = new EscrowFactory(platform);
        token = new ERC20Mock();

        vm.prank(platform);
        factory.approveToken(address(token));

        // Create escrow with 2 milestones
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = MILESTONE_AMOUNT;
        amounts[1] = MILESTONE_AMOUNT;

        vm.prank(buyer);
        address escrowAddr = factory.createEscrow(seller, address(token), amounts, keccak256("meta"), 1000);
        escrow = StablePayEscrow(escrowAddr);

        // Fund
        vm.prank(seller);
        escrow.acceptProject();

        token.mint(buyer, MILESTONE_AMOUNT * 2);
        vm.startPrank(buyer);
        token.approve(escrowAddr, MILESTONE_AMOUNT * 2);
        escrow.fund();
        vm.stopPrank();

        // Submit milestone 0
        vm.prank(seller);
        escrow.submitMilestone(0, keccak256("delivery"));
    }

    // ============ Escrow immutable tests ============

    function test_AutoApprovalDays_SetCorrectly() public view {
        assertEq(escrow.AUTO_APPROVAL_DAYS(), 14);
    }

    // ============ claimAutoApproval tests ============

    function test_ClaimAutoApproval_Success() public {
        vm.warp(block.timestamp + 14 days);

        vm.prank(seller);
        escrow.claimAutoApproval(0);

        (, StablePayEscrow.MilestoneStatus status,,,,,) = escrow.milestones(0);
        assertEq(uint8(status), uint8(StablePayEscrow.MilestoneStatus.PAID));

        uint256 expectedFee = (MILESTONE_AMOUNT * 250) / 10_000; // 2.5%
        assertEq(token.balanceOf(platform), expectedFee);
        assertEq(token.balanceOf(seller), MILESTONE_AMOUNT - expectedFee);
    }

    function test_ClaimAutoApproval_ExactDeadline() public {
        vm.warp(block.timestamp + 14 days); // exactly at boundary

        vm.prank(seller);
        escrow.claimAutoApproval(0); // should succeed with >=

        (, StablePayEscrow.MilestoneStatus status,,,,,) = escrow.milestones(0);
        assertEq(uint8(status), uint8(StablePayEscrow.MilestoneStatus.PAID));
    }

    function test_ClaimAutoApproval_RevertsBeforeDeadline() public {
        vm.warp(block.timestamp + 14 days - 1);

        vm.prank(seller);
        vm.expectRevert("Auto-approval period not elapsed");
        escrow.claimAutoApproval(0);
    }

    function test_ClaimAutoApproval_RevertsIfNotSeller() public {
        vm.warp(block.timestamp + 14 days);

        vm.prank(buyer);
        vm.expectRevert("Only seller");
        escrow.claimAutoApproval(0);
    }

    function test_ClaimAutoApproval_RevertsIfPending() public {
        vm.warp(block.timestamp + 14 days);

        vm.prank(seller);
        vm.expectRevert("Wrong status");
        escrow.claimAutoApproval(1); // milestone 1 never submitted
    }

    function test_ClaimAutoApproval_RevertsIfDisputed() public {
        vm.prank(buyer);
        escrow.openDispute(0, keccak256("reason"));

        vm.warp(block.timestamp + 14 days);

        vm.prank(seller);
        vm.expectRevert("Wrong status");
        escrow.claimAutoApproval(0);
    }

    function test_ClaimAutoApproval_RevertsIfAlreadyPaid() public {
        vm.prank(buyer);
        escrow.approveMilestone(0);

        vm.warp(block.timestamp + 14 days);

        vm.prank(seller);
        vm.expectRevert("Wrong status");
        escrow.claimAutoApproval(0);
    }

    function test_ClaimAutoApproval_FeeCalculation() public {
        vm.warp(block.timestamp + 14 days);

        vm.prank(seller);
        escrow.claimAutoApproval(0);

        // 2.5% platform fee, no dispute fee
        uint256 expectedPlatformFee = (MILESTONE_AMOUNT * 250) / 10_000; // 25 ether
        uint256 expectedSellerNet = MILESTONE_AMOUNT - expectedPlatformFee; // 975 ether

        assertEq(token.balanceOf(platform), expectedPlatformFee);
        assertEq(token.balanceOf(seller), expectedSellerNet);
        assertEq(expectedPlatformFee, 25 ether);
        assertEq(expectedSellerNet, 975 ether);
    }

    function test_BuyerCanStillApproveBeforeDeadline() public {
        vm.warp(block.timestamp + 7 days);

        vm.prank(buyer);
        escrow.approveMilestone(0);

        (, StablePayEscrow.MilestoneStatus status,,,,,) = escrow.milestones(0);
        assertEq(uint8(status), uint8(StablePayEscrow.MilestoneStatus.PAID));

        // Auto-approval now fails
        vm.warp(block.timestamp + 14 days);
        vm.prank(seller);
        vm.expectRevert("Wrong status");
        escrow.claimAutoApproval(0);
    }

    function test_BuyerDisputeBlocksAutoApproval() public {
        vm.warp(block.timestamp + 7 days);

        vm.prank(buyer);
        escrow.openDispute(0, keccak256("reason"));

        vm.warp(block.timestamp + 15 days); // well past original deadline

        vm.prank(seller);
        vm.expectRevert("Wrong status");
        escrow.claimAutoApproval(0);
    }

    function test_ClaimAutoApproval_EmitsEvent() public {
        vm.warp(block.timestamp + 14 days);

        vm.expectEmit(true, false, false, false);
        emit StablePayEscrow.MilestoneAutoApproved(0);

        vm.prank(seller);
        escrow.claimAutoApproval(0);
    }
}

contract AutoApprovalFactoryTest is Test {
    EscrowFactory public factory;
    ERC20Mock public token;

    address public platform = address(1);
    address public buyer = address(2);
    address public seller = address(3);

    function setUp() public {
        factory = new EscrowFactory(platform);
        token = new ERC20Mock();

        vm.prank(platform);
        factory.approveToken(address(token));
    }

    function test_DefaultAutoApprovalDays_InitialValue() public view {
        assertEq(factory.defaultAutoApprovalDays(), 14);
    }

    function test_SetDefaultAutoApprovalDays_Success() public {
        vm.prank(platform);
        factory.setDefaultAutoApprovalDays(30);
        assertEq(factory.defaultAutoApprovalDays(), 30);
    }

    function test_SetDefaultAutoApprovalDays_EmitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit EscrowFactory.DefaultAutoApprovalDaysChanged(14, 30);

        vm.prank(platform);
        factory.setDefaultAutoApprovalDays(30);
    }

    function test_SetDefaultAutoApprovalDays_RevertsIfNotPlatform() public {
        vm.prank(buyer);
        vm.expectRevert(EscrowFactory.OnlyPlatform.selector);
        factory.setDefaultAutoApprovalDays(30);
    }

    function test_SetDefaultAutoApprovalDays_RevertsBelowMin() public {
        vm.prank(platform);
        vm.expectRevert(EscrowFactory.AutoApprovalDaysTooLow.selector);
        factory.setDefaultAutoApprovalDays(0);
    }

    function test_SetDefaultAutoApprovalDays_RevertsAboveMax() public {
        vm.prank(platform);
        vm.expectRevert(EscrowFactory.AutoApprovalDaysTooHigh.selector);
        factory.setDefaultAutoApprovalDays(91);
    }

    function test_SetDefaultAutoApprovalDays_BoundaryMin() public {
        vm.prank(platform);
        factory.setDefaultAutoApprovalDays(1);
        assertEq(factory.defaultAutoApprovalDays(), 1);
    }

    function test_SetDefaultAutoApprovalDays_BoundaryMax() public {
        vm.prank(platform);
        factory.setDefaultAutoApprovalDays(90);
        assertEq(factory.defaultAutoApprovalDays(), 90);
    }

    function test_NewEscrowUsesUpdatedDays() public {
        vm.prank(platform);
        factory.setDefaultAutoApprovalDays(7);

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1000 ether;

        vm.prank(buyer);
        address escrowAddr = factory.createEscrow(seller, address(token), amounts, keccak256("meta"), 1000);
        StablePayEscrow escrow = StablePayEscrow(escrowAddr);

        assertEq(escrow.AUTO_APPROVAL_DAYS(), 7);
    }

    function test_ClaimAutoApproval_WithCustomDays() public {
        vm.prank(platform);
        factory.setDefaultAutoApprovalDays(7);

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1000 ether;

        vm.prank(buyer);
        address escrowAddr = factory.createEscrow(seller, address(token), amounts, keccak256("meta"), 1000);
        StablePayEscrow escrow = StablePayEscrow(escrowAddr);

        // Fund and submit
        vm.prank(seller);
        escrow.acceptProject();

        token.mint(buyer, 1000 ether);
        vm.startPrank(buyer);
        token.approve(escrowAddr, 1000 ether);
        escrow.fund();
        vm.stopPrank();

        vm.prank(seller);
        escrow.submitMilestone(0, keccak256("delivery"));

        // Fails at 6 days
        vm.warp(block.timestamp + 7 days - 1);
        vm.prank(seller);
        vm.expectRevert("Auto-approval period not elapsed");
        escrow.claimAutoApproval(0);

        // Succeeds at 7 days
        vm.warp(block.timestamp + 1);
        vm.prank(seller);
        escrow.claimAutoApproval(0);

        (, StablePayEscrow.MilestoneStatus status,,,,,) = escrow.milestones(0);
        assertEq(uint8(status), uint8(StablePayEscrow.MilestoneStatus.PAID));
    }
}

/**
 * @dev Audit Finding #4 (High): "Factory tracking data inaccessible"
 *      (Fabrikens tracking-data går inte att läsa utifrån)
 *
 * Problemet: fabriken sparar alla escrows i interna variabler (_allEscrows,
 * _escrowsByBuyer, _escrowsBySeller), men utan publika getters kan varken
 * backenden eller frontenden fråga "vilka escrows har den här köparen?"
 *
 * Lösning: 4 nya view-funktioner:
 *   - getEscrowsByBuyer(address)  → address[]
 *   - getEscrowsBySeller(address) → address[]
 *   - getAllEscrows()             → address[]
 *   - getEscrowCount()            → uint256
 */
contract FactoryGettersTest is Test {
    EscrowFactory public factory;
    ERC20Mock public token;

    address public platform = address(1);
    address public buyer = address(2);
    address public seller = address(3);
    // Vi behöver en extra köpare/säljare för att testa att getters
    // returnerar rätt data per address (inte blandar ihop dem).
    address public buyer2 = address(4);
    address public seller2 = address(5);

    function setUp() public {
        factory = new EscrowFactory(platform);
        token = new ERC20Mock();

        vm.prank(platform);
        factory.approveToken(address(token));
    }

    /// @dev Hjälpfunktion: skapa ett escrow med 1 milestone (1000 ether).
    ///      Vi kan ange vilken buyer och seller vi vill — användbart för att
    ///      testa att getters filtrerar rätt per address.
    function _createEscrowAs(address _buyer, address _seller) internal returns (address) {
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1000 ether;

        vm.prank(_buyer);
        return factory.createEscrow(_seller, address(token), amounts, keccak256("meta"), 1000);
    }

    // ============ getEscrowsByBuyer ============

    function test_GetEscrowsByBuyer_ReturnsCorrectEscrows() public {
        // Skapa 2 escrows med samma buyer → getEscrowsByBuyer ska returnera båda.
        address escrow1 = _createEscrowAs(buyer, seller);
        address escrow2 = _createEscrowAs(buyer, seller2);

        address[] memory result = factory.getEscrowsByBuyer(buyer);

        assertEq(result.length, 2);
        assertEq(result[0], escrow1);
        assertEq(result[1], escrow2);
    }

    // ============ getEscrowsBySeller ============

    function test_GetEscrowsBySeller_ReturnsCorrectEscrows() public {
        // Skapa 2 escrows med samma seller → getEscrowsBySeller ska returnera båda.
        address escrow1 = _createEscrowAs(buyer, seller);
        address escrow2 = _createEscrowAs(buyer2, seller);

        address[] memory result = factory.getEscrowsBySeller(seller);

        assertEq(result.length, 2);
        assertEq(result[0], escrow1);
        assertEq(result[1], escrow2);
    }

    // ============ getAllEscrows ============

    function test_GetAllEscrows_ReturnsAll() public {
        // Skapa 3 escrows (olika buyers) → getAllEscrows ska returnera alla 3.
        address escrow1 = _createEscrowAs(buyer, seller);
        address escrow2 = _createEscrowAs(buyer2, seller);
        address escrow3 = _createEscrowAs(buyer, seller2);

        address[] memory result = factory.getAllEscrows();

        assertEq(result.length, 3);
        assertEq(result[0], escrow1);
        assertEq(result[1], escrow2);
        assertEq(result[2], escrow3);
    }

    // ============ getEscrowCount ============

    function test_GetEscrowCount_MatchesCreatedEscrows() public {
        // Skapa 2 escrows → getEscrowCount ska returnera 2.
        assertEq(factory.getEscrowCount(), 0);

        _createEscrowAs(buyer, seller);
        assertEq(factory.getEscrowCount(), 1);

        _createEscrowAs(buyer2, seller);
        assertEq(factory.getEscrowCount(), 2);
    }
}

/**
 * @dev Audit Finding #5 + #6: Factory input-valideringar
 *
 * #5 (Medium): seller kan vara address(0) → pengar bränns.
 * #6 (Medium): inget tak på antal milestones → gas-attack möjlig.
 */
contract FactoryValidationsTest is Test {
    EscrowFactory public factory;
    ERC20Mock public token;

    address public platform = address(1);
    address public buyer = address(2);
    address public seller = address(3);

    function setUp() public {
        factory = new EscrowFactory(platform);
        token = new ERC20Mock();

        vm.prank(platform);
        factory.approveToken(address(token));
    }

    // ============ Finding #5: seller == address(0) ============

    function test_CreateEscrow_SellerZeroAddress_Reverts() public {
        // Seller är address(0) → ska revert:a så att pengar inte bränns.
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1000 ether;

        vm.prank(buyer);
        vm.expectRevert(EscrowFactory.InvalidSeller.selector);
        factory.createEscrow(address(0), address(token), amounts, keccak256("meta"), 1000);
    }

    // ============ Finding #6: för många milestones ============

    function test_CreateEscrow_TooManyMilestones_Reverts() public {
        // 51 milestones (över MAX_MILESTONES = 50) → ska revert:a.
        uint256[] memory amounts = new uint256[](51);
        for (uint256 i = 0; i < 51; i++) {
            amounts[i] = 100 ether;
        }

        vm.prank(buyer);
        vm.expectRevert(EscrowFactory.TooManyMilestones.selector);
        factory.createEscrow(seller, address(token), amounts, keccak256("meta"), 1000);
    }
}

/**
 * @dev Frontrunning-skydd: köparen anger maxFeeBps när de skapar ett escrow.
 *      Om plattformens avgift har höjts sedan köparen laddade sidan ska
 *      createEscrow() reverta istället för att ta en avgift köparen aldrig godkände.
 */
contract FeeProtectionTest is Test {
    EscrowFactory public factory;
    ERC20Mock public token;

    address public platform = address(1);
    address public buyer = address(2);
    address public seller = address(3);

    function setUp() public {
        factory = new EscrowFactory(platform);
        token = new ERC20Mock();

        vm.prank(platform);
        factory.approveToken(address(token));
    }

    /// @dev Plattformen höjer avgiften till 5% (500 bps) men köparen accepterar max 2.5% (250 bps).
    ///      createEscrow ska reverta med FeeTooHigh().
    function test_CreateEscrow_FeeExceedsMax_Reverts() public {
        vm.prank(platform);
        factory.setPlatformFeeBps(500); // 5%

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1000 ether;

        vm.prank(buyer);
        vm.expectRevert(EscrowFactory.FeeTooHigh.selector);
        factory.createEscrow(seller, address(token), amounts, keccak256("meta"), 250);
    }

    /// @dev Avgiften är 2.5% (250 bps) och köparen accepterar max 5% (500 bps).
    ///      createEscrow ska lyckas utan problem.
    function test_CreateEscrow_FeeWithinMax_Succeeds() public {
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1000 ether;

        vm.prank(buyer);
        address escrowAddr = factory.createEscrow(seller, address(token), amounts, keccak256("meta"), 500);

        assertTrue(factory.isValidEscrow(escrowAddr));
    }
}

/**
 * @dev Dispute Timeout: safety net for when platform doesn't resolve a dispute.
 *
 * If a dispute sits unresolved for DISPUTE_TIMEOUT_DAYS (default 30),
 * either party can call claimDisputeTimeout() to refund the buyer.
 * 1% dispute fee still goes to platform.
 */
contract DisputeTimeoutTest is Test {
    EscrowFactory public factory;
    ERC20Mock public token;
    StablePayEscrow public escrow;

    address public platform = address(1);
    address public buyer = address(2);
    address public seller = address(3);

    uint256 constant MILESTONE_AMOUNT = 1000 ether;

    function setUp() public {
        factory = new EscrowFactory(platform);
        token = new ERC20Mock();

        vm.prank(platform);
        factory.approveToken(address(token));

        // Create escrow with 2 milestones
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = MILESTONE_AMOUNT;
        amounts[1] = MILESTONE_AMOUNT;

        vm.prank(buyer);
        address escrowAddr = factory.createEscrow(seller, address(token), amounts, keccak256("meta"), 1000);
        escrow = StablePayEscrow(escrowAddr);

        // Fund
        vm.prank(seller);
        escrow.acceptProject();

        token.mint(buyer, MILESTONE_AMOUNT * 2);
        vm.startPrank(buyer);
        token.approve(escrowAddr, MILESTONE_AMOUNT * 2);
        escrow.fund();
        vm.stopPrank();

        // Submit milestone 0
        vm.prank(seller);
        escrow.submitMilestone(0, keccak256("delivery"));

        // Open dispute on milestone 0
        vm.prank(buyer);
        escrow.openDispute(0, keccak256("reason"));
    }

    // ============ Immutable tests ============

    function test_DisputeTimeoutDays_SetCorrectly() public view {
        assertEq(escrow.DISPUTE_TIMEOUT_DAYS(), 30);
    }

    // ============ claimDisputeTimeout tests ============

    function test_ClaimDisputeTimeout_BuyerClaims() public {
        vm.warp(block.timestamp + 30 days);

        vm.prank(buyer);
        escrow.claimDisputeTimeout(0);

        (, StablePayEscrow.MilestoneStatus status,,,,,) = escrow.milestones(0);
        assertEq(uint8(status), uint8(StablePayEscrow.MilestoneStatus.REFUNDED));

        uint256 expectedDisputeFee = (MILESTONE_AMOUNT * 100) / 10_000; // 1%
        uint256 expectedBuyerRefund = MILESTONE_AMOUNT - expectedDisputeFee;

        assertEq(token.balanceOf(platform), expectedDisputeFee);
        assertEq(token.balanceOf(buyer), expectedBuyerRefund);
        assertEq(token.balanceOf(seller), 0);
    }

    function test_ClaimDisputeTimeout_SellerClaims() public {
        vm.warp(block.timestamp + 30 days);

        // Seller can also trigger — buyer still gets the refund
        vm.prank(seller);
        escrow.claimDisputeTimeout(0);

        (, StablePayEscrow.MilestoneStatus status,,,,,) = escrow.milestones(0);
        assertEq(uint8(status), uint8(StablePayEscrow.MilestoneStatus.REFUNDED));

        uint256 expectedDisputeFee = (MILESTONE_AMOUNT * 100) / 10_000;
        uint256 expectedBuyerRefund = MILESTONE_AMOUNT - expectedDisputeFee;

        assertEq(token.balanceOf(buyer), expectedBuyerRefund);
        assertEq(token.balanceOf(seller), 0);
    }

    function test_ClaimDisputeTimeout_ExactDeadline() public {
        vm.warp(block.timestamp + 30 days); // exactly at boundary

        vm.prank(buyer);
        escrow.claimDisputeTimeout(0); // should succeed with >=

        (, StablePayEscrow.MilestoneStatus status,,,,,) = escrow.milestones(0);
        assertEq(uint8(status), uint8(StablePayEscrow.MilestoneStatus.REFUNDED));
    }

    function test_ClaimDisputeTimeout_RevertsBeforeDeadline() public {
        vm.warp(block.timestamp + 30 days - 1);

        vm.prank(buyer);
        vm.expectRevert("Dispute timeout not elapsed");
        escrow.claimDisputeTimeout(0);
    }

    function test_ClaimDisputeTimeout_RevertsIfNotParty() public {
        vm.warp(block.timestamp + 30 days);

        vm.prank(platform);
        vm.expectRevert("Not party");
        escrow.claimDisputeTimeout(0);

        vm.prank(address(99));
        vm.expectRevert("Not party");
        escrow.claimDisputeTimeout(0);
    }

    function test_ClaimDisputeTimeout_RevertsIfPending() public {
        vm.warp(block.timestamp + 30 days);

        vm.prank(buyer);
        vm.expectRevert("Wrong status");
        escrow.claimDisputeTimeout(1); // milestone 1 is PENDING
    }

    function test_ClaimDisputeTimeout_RevertsIfSubmitted() public {
        // Submit milestone 1 (don't dispute it)
        vm.prank(seller);
        escrow.submitMilestone(1, keccak256("delivery2"));

        vm.warp(block.timestamp + 30 days);

        vm.prank(buyer);
        vm.expectRevert("Wrong status");
        escrow.claimDisputeTimeout(1); // SUBMITTED, not DISPUTED
    }

    function test_ClaimDisputeTimeout_PlatformCanStillResolveBefore() public {
        vm.warp(block.timestamp + 15 days); // before timeout

        uint256 disputeFee = (MILESTONE_AMOUNT * 100) / 10_000;
        uint256 remaining = MILESTONE_AMOUNT - disputeFee;

        vm.prank(platform);
        escrow.resolveDispute(0, remaining); // platform resolves — seller gets all remaining

        (, StablePayEscrow.MilestoneStatus status,,,,,) = escrow.milestones(0);
        assertEq(uint8(status), uint8(StablePayEscrow.MilestoneStatus.PAID));
    }

    function test_ClaimDisputeTimeout_EmitsEvent() public {
        vm.warp(block.timestamp + 30 days);

        uint256 expectedDisputeFee = (MILESTONE_AMOUNT * 100) / 10_000;
        uint256 expectedBuyerRefund = MILESTONE_AMOUNT - expectedDisputeFee;

        vm.expectEmit(true, false, false, true);
        emit StablePayEscrow.DisputeTimeoutClaimed(0, expectedBuyerRefund, expectedDisputeFee);

        vm.prank(buyer);
        escrow.claimDisputeTimeout(0);
    }
}

contract DisputeTimeoutFactoryTest is Test {
    EscrowFactory public factory;
    ERC20Mock public token;

    address public platform = address(1);
    address public buyer = address(2);
    address public seller = address(3);

    function setUp() public {
        factory = new EscrowFactory(platform);
        token = new ERC20Mock();

        vm.prank(platform);
        factory.approveToken(address(token));
    }

    function test_DefaultDisputeTimeoutDays_InitialValue() public view {
        assertEq(factory.defaultDisputeTimeoutDays(), 30);
    }

    function test_SetDefaultDisputeTimeoutDays_Success() public {
        vm.prank(platform);
        factory.setDefaultDisputeTimeoutDays(60);
        assertEq(factory.defaultDisputeTimeoutDays(), 60);
    }

    function test_SetDefaultDisputeTimeoutDays_EmitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit EscrowFactory.DefaultDisputeTimeoutDaysChanged(30, 60);

        vm.prank(platform);
        factory.setDefaultDisputeTimeoutDays(60);
    }

    function test_SetDefaultDisputeTimeoutDays_RevertsIfNotPlatform() public {
        vm.prank(buyer);
        vm.expectRevert(EscrowFactory.OnlyPlatform.selector);
        factory.setDefaultDisputeTimeoutDays(60);
    }

    function test_SetDefaultDisputeTimeoutDays_RevertsBelowMin() public {
        vm.prank(platform);
        vm.expectRevert(EscrowFactory.DisputeTimeoutDaysTooLow.selector);
        factory.setDefaultDisputeTimeoutDays(13);
    }

    function test_SetDefaultDisputeTimeoutDays_RevertsAboveMax() public {
        vm.prank(platform);
        vm.expectRevert(EscrowFactory.DisputeTimeoutDaysTooHigh.selector);
        factory.setDefaultDisputeTimeoutDays(181);
    }

    function test_SetDefaultDisputeTimeoutDays_BoundaryMin() public {
        vm.prank(platform);
        factory.setDefaultDisputeTimeoutDays(14);
        assertEq(factory.defaultDisputeTimeoutDays(), 14);
    }

    function test_SetDefaultDisputeTimeoutDays_BoundaryMax() public {
        vm.prank(platform);
        factory.setDefaultDisputeTimeoutDays(180);
        assertEq(factory.defaultDisputeTimeoutDays(), 180);
    }

    function test_NewEscrowUsesUpdatedDisputeTimeoutDays() public {
        vm.prank(platform);
        factory.setDefaultDisputeTimeoutDays(45);

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1000 ether;

        vm.prank(buyer);
        address escrowAddr = factory.createEscrow(seller, address(token), amounts, keccak256("meta"), 1000);
        StablePayEscrow escrow = StablePayEscrow(escrowAddr);

        assertEq(escrow.DISPUTE_TIMEOUT_DAYS(), 45);
    }

    function test_ClaimDisputeTimeout_WithCustomDays() public {
        vm.prank(platform);
        factory.setDefaultDisputeTimeoutDays(14);

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1000 ether;

        vm.prank(buyer);
        address escrowAddr = factory.createEscrow(seller, address(token), amounts, keccak256("meta"), 1000);
        StablePayEscrow escrow = StablePayEscrow(escrowAddr);

        // Fund, submit, dispute
        vm.prank(seller);
        escrow.acceptProject();

        token.mint(buyer, 1000 ether);
        vm.startPrank(buyer);
        token.approve(escrowAddr, 1000 ether);
        escrow.fund();
        vm.stopPrank();

        vm.prank(seller);
        escrow.submitMilestone(0, keccak256("delivery"));

        vm.prank(buyer);
        escrow.openDispute(0, keccak256("reason"));

        // Fails at 13 days
        vm.warp(block.timestamp + 14 days - 1);
        vm.prank(buyer);
        vm.expectRevert("Dispute timeout not elapsed");
        escrow.claimDisputeTimeout(0);

        // Succeeds at 14 days
        vm.warp(block.timestamp + 1);
        vm.prank(buyer);
        escrow.claimDisputeTimeout(0);

        (, StablePayEscrow.MilestoneStatus status,,,,,) = escrow.milestones(0);
        assertEq(uint8(status), uint8(StablePayEscrow.MilestoneStatus.REFUNDED));
    }
}

/**
 * @dev Person B: Resubmit during dispute + correction window
 *
 * När köparen öppnar en dispute får säljaren 7 dagar att leverera korrigerat arbete.
 * Plattformen kan inte resolva förrän fönstret gått ut.
 */
contract ResubmitDuringDisputeTest is Test {
    EscrowFactory public factory;
    ERC20Mock public token;

    address public platform = address(1);
    address public buyer = address(2);
    address public seller = address(3);

    uint256 constant MILESTONE_AMOUNT = 1000 ether;

    function setUp() public {
        factory = new EscrowFactory(platform);
        token = new ERC20Mock();

        vm.startPrank(platform);
        factory.approveToken(address(token));
        factory.setDefaultCorrectionWindowDays(7);
        vm.stopPrank();
    }

    /// @dev Hjälp: skapa escrow där köparen öppnat dispute
    function _createBuyerDisputedEscrow() internal returns (StablePayEscrow) {
        uint256[] memory milestones = new uint256[](1);
        milestones[0] = MILESTONE_AMOUNT;

        vm.prank(buyer);
        address escrowAddr = factory.createEscrow(seller, address(token), milestones, keccak256("meta"), 1000);
        StablePayEscrow escrow = StablePayEscrow(escrowAddr);

        vm.prank(seller);
        escrow.acceptProject();

        token.mint(buyer, MILESTONE_AMOUNT);
        vm.startPrank(buyer);
        token.approve(escrowAddr, MILESTONE_AMOUNT);
        escrow.fund();
        vm.stopPrank();

        vm.prank(seller);
        escrow.submitMilestone(0, keccak256("delivery"));

        vm.prank(buyer);
        escrow.openDispute(0, keccak256("reason"));

        return escrow;
    }

    /// @dev Hjälp: skapa escrow där säljaren öppnat dispute
    function _createSellerDisputedEscrow() internal returns (StablePayEscrow) {
        uint256[] memory milestones = new uint256[](1);
        milestones[0] = MILESTONE_AMOUNT;

        vm.prank(buyer);
        address escrowAddr = factory.createEscrow(seller, address(token), milestones, keccak256("meta"), 1000);
        StablePayEscrow escrow = StablePayEscrow(escrowAddr);

        vm.prank(seller);
        escrow.acceptProject();

        token.mint(buyer, MILESTONE_AMOUNT);
        vm.startPrank(buyer);
        token.approve(escrowAddr, MILESTONE_AMOUNT);
        escrow.fund();
        vm.stopPrank();

        vm.prank(seller);
        escrow.submitMilestone(0, keccak256("delivery"));

        vm.prank(seller);
        escrow.openDispute(0, keccak256("reason"));

        return escrow;
    }

    // ============ resubmitDuringDispute happy path ============

    function test_ResubmitDuringDispute_HappyPath() public {
        StablePayEscrow escrow = _createBuyerDisputedEscrow();

        vm.warp(block.timestamp + 3 days);

        vm.prank(seller);
        escrow.resubmitDuringDispute(0, keccak256("corrected-delivery"));

        (, StablePayEscrow.MilestoneStatus status, bytes32 deliveryHash,,,,) = escrow.milestones(0);
        assertEq(uint256(status), uint256(StablePayEscrow.MilestoneStatus.SUBMITTED));
        assertEq(deliveryHash, keccak256("corrected-delivery"));
    }

    function test_ResubmitDuringDispute_ThenBuyerApproves() public {
        StablePayEscrow escrow = _createBuyerDisputedEscrow();

        vm.warp(block.timestamp + 3 days);
        vm.prank(seller);
        escrow.resubmitDuringDispute(0, keccak256("corrected-delivery"));

        vm.prank(buyer);
        escrow.approveMilestone(0);

        (, StablePayEscrow.MilestoneStatus status,,,,,) = escrow.milestones(0);
        assertEq(uint256(status), uint256(StablePayEscrow.MilestoneStatus.PAID));

        uint256 expectedFee = (MILESTONE_AMOUNT * 250) / 10_000; // 2.5%, no dispute fee
        assertEq(token.balanceOf(platform), expectedFee);
        assertEq(token.balanceOf(seller), MILESTONE_AMOUNT - expectedFee);
        assertEq(token.balanceOf(buyer), 0);
    }

    function test_ResubmitDuringDispute_WindowExpired_Reverts() public {
        StablePayEscrow escrow = _createBuyerDisputedEscrow();

        vm.warp(block.timestamp + 7 days + 1);

        vm.prank(seller);
        vm.expectRevert("Correction window expired");
        escrow.resubmitDuringDispute(0, keccak256("corrected-delivery"));
    }

    function test_ResubmitDuringDispute_ExactDeadline_Succeeds() public {
        StablePayEscrow escrow = _createBuyerDisputedEscrow();

        vm.warp(block.timestamp + 7 days); // exactly at boundary (<=)

        vm.prank(seller);
        escrow.resubmitDuringDispute(0, keccak256("corrected-delivery"));

        (, StablePayEscrow.MilestoneStatus status,,,,,) = escrow.milestones(0);
        assertEq(uint256(status), uint256(StablePayEscrow.MilestoneStatus.SUBMITTED));
    }

    function test_ResubmitDuringDispute_OnlySeller_BuyerReverts() public {
        StablePayEscrow escrow = _createBuyerDisputedEscrow();

        vm.prank(buyer);
        vm.expectRevert("Only seller");
        escrow.resubmitDuringDispute(0, keccak256("corrected-delivery"));
    }

    function test_ResubmitDuringDispute_OnlySeller_PlatformReverts() public {
        StablePayEscrow escrow = _createBuyerDisputedEscrow();

        vm.prank(platform);
        vm.expectRevert("Only seller");
        escrow.resubmitDuringDispute(0, keccak256("corrected-delivery"));
    }

    function test_ResubmitDuringDispute_OnlyWhenBuyerOpened_Reverts() public {
        StablePayEscrow escrow = _createSellerDisputedEscrow();

        vm.prank(seller);
        vm.expectRevert("No correction window");
        escrow.resubmitDuringDispute(0, keccak256("corrected-delivery"));
    }

    function test_ResubmitDuringDispute_WrongStatus_Reverts() public {
        uint256[] memory milestones = new uint256[](1);
        milestones[0] = MILESTONE_AMOUNT;

        vm.prank(buyer);
        address escrowAddr = factory.createEscrow(seller, address(token), milestones, keccak256("meta"), 1000);
        StablePayEscrow escrow = StablePayEscrow(escrowAddr);

        vm.prank(seller);
        escrow.acceptProject();

        token.mint(buyer, MILESTONE_AMOUNT);
        vm.startPrank(buyer);
        token.approve(escrowAddr, MILESTONE_AMOUNT);
        escrow.fund();
        vm.stopPrank();

        // Milestone 0 is PENDING (never submitted)
        vm.prank(seller);
        vm.expectRevert("Wrong status");
        escrow.resubmitDuringDispute(0, keccak256("delivery"));
    }

    function test_ResubmitDuringDispute_ResetsAutoApprovalTimer() public {
        vm.prank(platform);
        factory.setDefaultAutoApprovalDays(7);

        StablePayEscrow escrow = _createBuyerDisputedEscrow();
        uint256 disputeOpenedAt = block.timestamp;

        vm.warp(disputeOpenedAt + 3 days);
        vm.prank(seller);
        escrow.resubmitDuringDispute(0, keccak256("corrected-delivery"));
        uint256 resubmitTime = block.timestamp;

        // Auto-approval is 7 days from NEW submittedAt (resubmit time)
        // At 6 days from resubmit: should fail
        vm.warp(resubmitTime + 6 days);
        vm.prank(seller);
        vm.expectRevert("Auto-approval period not elapsed");
        escrow.claimAutoApproval(0);

        // At 7 days from resubmit: should succeed
        vm.warp(resubmitTime + 7 days);
        vm.prank(seller);
        escrow.claimAutoApproval(0);

        (, StablePayEscrow.MilestoneStatus status,,,,,) = escrow.milestones(0);
        assertEq(uint256(status), uint256(StablePayEscrow.MilestoneStatus.PAID));
    }

    // ============ resolveDispute correction window ============

    function test_ResolveDispute_PlatformBlockedDuringWindow() public {
        StablePayEscrow escrow = _createBuyerDisputedEscrow();

        vm.warp(block.timestamp + 3 days);

        vm.prank(platform);
        vm.expectRevert("Correction window not expired");
        escrow.resolveDispute(0, MILESTONE_AMOUNT / 2);
    }

    function test_ResolveDispute_PlatformAllowedAfterWindow() public {
        StablePayEscrow escrow = _createBuyerDisputedEscrow();

        vm.warp(block.timestamp + 7 days + 1);

        uint256 disputeFee = (MILESTONE_AMOUNT * 100) / 10_000;
        uint256 remaining = MILESTONE_AMOUNT - disputeFee;
        uint256 sellerAward = remaining / 2;

        vm.prank(platform);
        escrow.resolveDispute(0, sellerAward);

        (, StablePayEscrow.MilestoneStatus status,,,,,) = escrow.milestones(0);
        assertEq(uint256(status), uint256(StablePayEscrow.MilestoneStatus.RESOLVED));
    }

    function test_ResolveDispute_NoWindowWhenSellerOpened_Succeeds() public {
        StablePayEscrow escrow = _createSellerDisputedEscrow();

        // Resolve immediately - no correction window when seller opened
        vm.prank(platform);
        escrow.resolveDispute(0, 0);

        (, StablePayEscrow.MilestoneStatus status,,,,,) = escrow.milestones(0);
        assertEq(uint256(status), uint256(StablePayEscrow.MilestoneStatus.REFUNDED));
    }

    function test_ResubmitDuringDispute_ThenDisputeAgain_CycleWorks() public {
        StablePayEscrow escrow = _createBuyerDisputedEscrow();

        vm.warp(block.timestamp + 2 days);
        vm.prank(seller);
        escrow.resubmitDuringDispute(0, keccak256("corrected-v1"));

        vm.prank(buyer);
        escrow.openDispute(0, keccak256("still not happy"));

        vm.warp(block.timestamp + 3 days);
        vm.prank(seller);
        escrow.resubmitDuringDispute(0, keccak256("corrected-v2"));

        (, StablePayEscrow.MilestoneStatus status, bytes32 deliveryHash,,,,) = escrow.milestones(0);
        assertEq(uint256(status), uint256(StablePayEscrow.MilestoneStatus.SUBMITTED));
        assertEq(deliveryHash, keccak256("corrected-v2"));
    }

    function test_ResubmitDuringDispute_EmitsEvent() public {
        StablePayEscrow escrow = _createBuyerDisputedEscrow();

        vm.expectEmit(true, false, false, false);
        emit StablePayEscrow.MilestoneResubmitted(0, keccak256("corrected-delivery"));

        vm.prank(seller);
        escrow.resubmitDuringDispute(0, keccak256("corrected-delivery"));
    }
}

// ============================================================
// SellerAcceptanceTest — acceptProject / rejectProject / fund
// ============================================================

contract SellerAcceptanceTest is Test {
    EscrowFactory public factory;
    ERC20Mock public token;

    address public platform = address(1);
    address public buyer   = address(2);
    address public seller  = address(3);
    address public other   = address(4);

    uint256 constant AMOUNT = 1000 ether;

    function setUp() public {
        factory = new EscrowFactory(platform);
        token   = new ERC20Mock();

        vm.prank(platform);
        factory.approveToken(address(token));
    }

    function _createEscrow() internal returns (StablePayEscrow) {
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = AMOUNT;
        vm.prank(buyer);
        address addr = factory.createEscrow(seller, address(token), amounts, keccak256("meta"), 1000);
        return StablePayEscrow(addr);
    }

    // --- acceptProject ---

    function test_AcceptProject_HappyPath() public {
        StablePayEscrow escrow = _createEscrow();
        assertFalse(escrow.sellerAccepted());

        vm.prank(seller);
        escrow.acceptProject();

        assertTrue(escrow.sellerAccepted());
    }

    function test_AcceptProject_EmitsEvent() public {
        StablePayEscrow escrow = _createEscrow();

        vm.expectEmit(true, false, false, false);
        emit StablePayEscrow.ProjectAccepted(seller);

        vm.prank(seller);
        escrow.acceptProject();
    }

    function test_AcceptProject_OnlySeller_Reverts() public {
        StablePayEscrow escrow = _createEscrow();

        vm.prank(buyer);
        vm.expectRevert("Only seller");
        escrow.acceptProject();

        vm.prank(other);
        vm.expectRevert("Only seller");
        escrow.acceptProject();
    }

    function test_AcceptProject_AlreadyAccepted_Reverts() public {
        StablePayEscrow escrow = _createEscrow();

        vm.prank(seller);
        escrow.acceptProject();

        vm.prank(seller);
        vm.expectRevert("Already accepted");
        escrow.acceptProject();
    }

    function test_AcceptProject_AfterCancel_Reverts() public {
        StablePayEscrow escrow = _createEscrow();

        vm.prank(buyer);
        escrow.cancelEscrow();

        vm.prank(seller);
        vm.expectRevert("Escrow cancelled");
        escrow.acceptProject();
    }

    // --- rejectProject ---

    function test_RejectProject_HappyPath() public {
        StablePayEscrow escrow = _createEscrow();

        vm.prank(seller);
        escrow.rejectProject();

        assertTrue(escrow.cancelled());
    }

    function test_RejectProject_EmitsEvent() public {
        StablePayEscrow escrow = _createEscrow();

        vm.expectEmit(true, false, false, false);
        emit StablePayEscrow.ProjectRejected(seller);

        vm.prank(seller);
        escrow.rejectProject();
    }

    function test_RejectProject_OnlySeller_Reverts() public {
        StablePayEscrow escrow = _createEscrow();

        vm.prank(buyer);
        vm.expectRevert("Only seller");
        escrow.rejectProject();
    }

    function test_RejectProject_AfterAccept_Reverts() public {
        StablePayEscrow escrow = _createEscrow();

        vm.prank(seller);
        escrow.acceptProject();

        vm.prank(seller);
        vm.expectRevert("Already accepted");
        escrow.rejectProject();
    }

    function test_RejectProject_AlreadyCancelled_Reverts() public {
        StablePayEscrow escrow = _createEscrow();

        vm.prank(buyer);
        escrow.cancelEscrow();

        vm.prank(seller);
        vm.expectRevert("Escrow cancelled");
        escrow.rejectProject();
    }

    // --- fund gated on acceptance ---

    function test_Fund_BeforeAcceptance_Reverts() public {
        StablePayEscrow escrow = _createEscrow();

        token.mint(buyer, AMOUNT);
        vm.startPrank(buyer);
        token.approve(address(escrow), AMOUNT);
        vm.expectRevert("Seller has not accepted");
        escrow.fund();
        vm.stopPrank();
    }

    function test_Fund_AfterAcceptance_Succeeds() public {
        StablePayEscrow escrow = _createEscrow();

        vm.prank(seller);
        escrow.acceptProject();

        token.mint(buyer, AMOUNT);
        vm.startPrank(buyer);
        token.approve(address(escrow), AMOUNT);
        escrow.fund();
        vm.stopPrank();

        assertTrue(escrow.funded());
    }

    function test_Fund_AfterRejection_Reverts() public {
        StablePayEscrow escrow = _createEscrow();

        vm.prank(seller);
        escrow.rejectProject();

        token.mint(buyer, AMOUNT);
        vm.startPrank(buyer);
        token.approve(address(escrow), AMOUNT);
        vm.expectRevert("Escrow cancelled");
        escrow.fund();
        vm.stopPrank();
    }
}

// ============================================================
// SellerEscalateTest — sellerEscalate
// ============================================================

contract SellerEscalateTest is Test {
    EscrowFactory public factory;
    ERC20Mock public token;

    address public platform = address(1);
    address public buyer    = address(2);
    address public seller   = address(3);

    uint256 constant AMOUNT = 1000 ether;

    function setUp() public {
        factory = new EscrowFactory(platform);
        token   = new ERC20Mock();

        vm.startPrank(platform);
        factory.approveToken(address(token));
        factory.setDefaultCorrectionWindowDays(7);
        vm.stopPrank();
    }

    function _createBuyerDisputedEscrow() internal returns (StablePayEscrow) {
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = AMOUNT;

        vm.prank(buyer);
        address addr = factory.createEscrow(seller, address(token), amounts, keccak256("meta"), 1000);
        StablePayEscrow escrow = StablePayEscrow(addr);

        vm.prank(seller);
        escrow.acceptProject();

        token.mint(buyer, AMOUNT);
        vm.startPrank(buyer);
        token.approve(addr, AMOUNT);
        escrow.fund();
        vm.stopPrank();

        vm.prank(seller);
        escrow.submitMilestone(0, keccak256("delivery"));

        vm.prank(buyer);
        escrow.openDispute(0, keccak256("reason"));

        return escrow;
    }

    function test_SellerEscalate_HappyPath() public {
        StablePayEscrow escrow = _createBuyerDisputedEscrow();

        vm.prank(seller);
        escrow.sellerEscalate(0, keccak256("my work is correct"));

        (,,,,,, address openedBy) = escrow.milestones(0);
        assertEq(openedBy, seller);
    }

    function test_SellerEscalate_EmitsEvent() public {
        StablePayEscrow escrow = _createBuyerDisputedEscrow();

        vm.expectEmit(true, false, false, false);
        emit StablePayEscrow.DisputeEscalated(0, keccak256("my work is correct"));

        vm.prank(seller);
        escrow.sellerEscalate(0, keccak256("my work is correct"));
    }

    function test_SellerEscalate_AdminCanResolveImmediately() public {
        StablePayEscrow escrow = _createBuyerDisputedEscrow();

        vm.prank(seller);
        escrow.sellerEscalate(0, keccak256("my work is correct"));

        // Platform resolves immediately — no correction window since disputeOpenedBy == SELLER
        vm.prank(platform);
        escrow.resolveDispute(0, AMOUNT - (AMOUNT * 100 / 10000)); // seller gets all minus dispute fee
    }

    function test_SellerEscalate_OnlySeller_Reverts() public {
        StablePayEscrow escrow = _createBuyerDisputedEscrow();

        vm.prank(buyer);
        vm.expectRevert("Only seller");
        escrow.sellerEscalate(0, keccak256("reason"));

        vm.prank(platform);
        vm.expectRevert("Only seller");
        escrow.sellerEscalate(0, keccak256("reason"));
    }

    function test_SellerEscalate_WrongStatus_Reverts() public {
        // Cannot escalate if not disputed
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = AMOUNT;

        vm.prank(buyer);
        address addr = factory.createEscrow(seller, address(token), amounts, keccak256("meta"), 1000);
        StablePayEscrow escrow = StablePayEscrow(addr);

        vm.prank(seller);
        escrow.acceptProject();

        token.mint(buyer, AMOUNT);
        vm.startPrank(buyer);
        token.approve(addr, AMOUNT);
        escrow.fund();
        vm.stopPrank();

        vm.prank(seller);
        escrow.submitMilestone(0, keccak256("delivery"));

        // Status is SUBMITTED, not DISPUTED
        vm.prank(seller);
        vm.expectRevert("Wrong status");
        escrow.sellerEscalate(0, keccak256("reason"));
    }

    function test_SellerEscalate_RequiresBuyerOpenedDispute_Reverts() public {
        // Seller-opened dispute cannot be escalated again
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = AMOUNT;

        vm.prank(buyer);
        address addr = factory.createEscrow(seller, address(token), amounts, keccak256("meta"), 1000);
        StablePayEscrow escrow = StablePayEscrow(addr);

        vm.prank(seller);
        escrow.acceptProject();

        token.mint(buyer, AMOUNT);
        vm.startPrank(buyer);
        token.approve(addr, AMOUNT);
        escrow.fund();
        vm.stopPrank();

        vm.prank(seller);
        escrow.submitMilestone(0, keccak256("delivery"));

        vm.prank(seller);
        escrow.openDispute(0, keccak256("seller opened"));

        vm.prank(seller);
        vm.expectRevert("Only when buyer disputed");
        escrow.sellerEscalate(0, keccak256("reason"));
    }

    function test_SellerEscalate_BlocksResubmit() public {
        StablePayEscrow escrow = _createBuyerDisputedEscrow();

        vm.prank(seller);
        escrow.sellerEscalate(0, keccak256("my work is correct"));

        // After escalation, resubmit should fail (disputeOpenedBy is now SELLER)
        vm.prank(seller);
        vm.expectRevert("No correction window");
        escrow.resubmitDuringDispute(0, keccak256("new delivery"));
    }
}

// ============================================================
// CorrectionWindowFactoryTest — setDefaultCorrectionWindowDays
// ============================================================

contract CorrectionWindowFactoryTest is Test {
    EscrowFactory public factory;
    ERC20Mock public token;

    address public platform = address(1);
    address public buyer    = address(2);
    address public seller   = address(3);

    function setUp() public {
        factory = new EscrowFactory(platform);
        token   = new ERC20Mock();

        vm.prank(platform);
        factory.approveToken(address(token));
    }

    function test_DefaultCorrectionWindowDays_InitialValue() public view {
        assertEq(factory.defaultCorrectionWindowDays(), 0);
    }

    function test_SetDefaultCorrectionWindowDays_Success() public {
        vm.prank(platform);
        factory.setDefaultCorrectionWindowDays(7);
        assertEq(factory.defaultCorrectionWindowDays(), 7);
    }

    function test_SetDefaultCorrectionWindowDays_Zero_Succeeds() public {
        vm.prank(platform);
        factory.setDefaultCorrectionWindowDays(7);

        vm.prank(platform);
        factory.setDefaultCorrectionWindowDays(0);
        assertEq(factory.defaultCorrectionWindowDays(), 0);
    }

    function test_SetDefaultCorrectionWindowDays_BoundaryMax() public {
        vm.prank(platform);
        factory.setDefaultCorrectionWindowDays(30);
        assertEq(factory.defaultCorrectionWindowDays(), 30);
    }

    function test_SetDefaultCorrectionWindowDays_RevertsAboveMax() public {
        vm.prank(platform);
        vm.expectRevert();
        factory.setDefaultCorrectionWindowDays(31);
    }

    function test_SetDefaultCorrectionWindowDays_RevertsIfNotPlatform() public {
        vm.prank(buyer);
        vm.expectRevert();
        factory.setDefaultCorrectionWindowDays(7);
    }

    function test_SetDefaultCorrectionWindowDays_EmitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit EscrowFactory.DefaultCorrectionWindowDaysChanged(0, 7);

        vm.prank(platform);
        factory.setDefaultCorrectionWindowDays(7);
    }

    function test_NewEscrowUsesUpdatedCorrectionWindowDays() public {
        vm.prank(platform);
        factory.setDefaultCorrectionWindowDays(14);

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1000 ether;

        vm.prank(buyer);
        address addr = factory.createEscrow(seller, address(token), amounts, keccak256("meta"), 1000);
        StablePayEscrow escrow = StablePayEscrow(addr);

        assertEq(escrow.CORRECTION_WINDOW_DAYS(), 14);
    }
}
