// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {EscrowFactory} from "../src/EscrowFactory.sol";

/**
 * @title DeployStablePayEscrow
 * @notice Deploy script for the StablePay factory.
 *         Blocks mainnet deploys, deploys the factory and logs a summary.
 *         USDC is not approved here: approveToken is onlyPlatform, and the
 *         deploy wallet is not PLATFORM. Approve it in Admin Settings instead.
 */
contract DeployStablePayEscrow is Script {
    function run() external {
        // Safety guard: prevent deploying to Ethereum mainnet (1) or Base mainnet (8453)
        uint256 chainId = block.chainid;
        require(chainId != 1 && chainId != 8453, "Mainnet deploy blocked - use a testnet");

        address platform = vm.envAddress("PLATFORM_ADDRESS");

        vm.startBroadcast();

        EscrowFactory factory = new EscrowFactory(platform);

        vm.stopBroadcast();

        // Deployment summary
        console.log("=== StablePay Deployment Summary ===");
        console.log("Chain ID:          ", chainId);
        console.log("Platform:          ", platform);
        console.log("Factory:           ", address(factory));
        console.log("Platform Fee (bps):", factory.platformFeeBps());
        console.log("Auto-Approval Days:", factory.defaultAutoApprovalDays());
        console.log("Dispute Timeout Days:", factory.defaultDisputeTimeoutDays());
        console.log("Correction Window Days:", factory.defaultCorrectionWindowDays());
    }
}
