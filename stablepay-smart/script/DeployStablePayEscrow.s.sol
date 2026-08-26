// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {EscrowFactory} from "../src/EscrowFactory.sol";

/**
 * @title DeployStablePayEscrow
 * @notice Deploy-script för StablePay-fabriken.
 *         Blockerar mainnet-deploys, deployer fabriken, godkänner USDC om adressen
 *         finns i .env, och loggar en sammanfattning.
 */
contract DeployStablePayEscrow is Script {
    function run() external {
        // Säkerhetsspärr: förhindra deploy till Ethereum mainnet (1) och Base mainnet (8453)
        uint256 chainId = block.chainid;
        require(chainId != 1 && chainId != 8453, "Mainnet deploy blocked - use a testnet");

        address platform = vm.envAddress("PLATFORM_ADDRESS");

        vm.startBroadcast();

        EscrowFactory factory = new EscrowFactory(platform);

        // Om USDC_ADDRESS är satt i .env, godkänn den direkt vid deploy
        address usdc = vm.envOr("USDC_ADDRESS", address(0));
        if (usdc != address(0)) {
            factory.approveToken(usdc);
        }

        vm.stopBroadcast();

        // Deployment-sammanfattning
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
