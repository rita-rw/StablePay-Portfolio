// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {EscrowFactory} from "../src/EscrowFactory.sol";

/**
 * @title DeployStablePayEscrow
 * @notice Deploy script for the StablePay factory.
 *         Blocks mainnet deploys, deploys the factory, approves USDC if the
 *         address is set in .env, and logs a summary.
 */
contract DeployStablePayEscrow is Script {
    function run() external {
        // Safety guard: prevent deploying to Ethereum mainnet (1) or Base mainnet (8453)
        uint256 chainId = block.chainid;
        require(chainId != 1 && chainId != 8453, "Mainnet deploy blocked - use a testnet");

        address platform = vm.envAddress("PLATFORM_ADDRESS");

        vm.startBroadcast();

        EscrowFactory factory = new EscrowFactory(platform);

        // If USDC_ADDRESS is set in .env, approve it right at deploy time
        address usdc = vm.envOr("USDC_ADDRESS", address(0));
        if (usdc != address(0)) {
            factory.approveToken(usdc);
        }

        vm.stopBroadcast();

        // Deployment summary
        console.log("=== StablePay Deployment Summary ===");
        console.log("Chain ID:          ", chainId);
        console.log("Platform:          ", platform);
        console.log("Factory:           ", address(factory));
        console.log("Platform Fee (bps):", factory.platformFeeBps());
        console.log("Auto-Approval Days:", factory.defaultAutoApprovalDays());
        if (usdc != address(0)) {
            console.log("USDC approved:     ", usdc);
        }
    }
}
