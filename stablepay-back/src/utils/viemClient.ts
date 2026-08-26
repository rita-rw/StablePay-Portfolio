import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

/** Shared read-only viem client for on-chain verification (uses primary RPC). */
export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.RPC_URL),
});
