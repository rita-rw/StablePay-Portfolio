export const MILESTONE_STATUS_MAP: Record<number, string> = {
  0: "PENDING",
  1: "SUBMITTED",
  2: "DISPUTED",
  3: "PAID",
  4: "REFUNDED",
  5: "RESOLVED",
};

// Fees in basis points (10 000 bps = 100%). Must match the contracts:
// EscrowFactory starts platformFeeBps at 250, StablePayEscrow.DISPUTE_FEE_BPS = 100.
export const PLATFORM_FEE_BPS = 250n; // 2.5%
export const DISPUTE_FEE_BPS = 100n; // 1%, only when the platform resolves a dispute

export const PLATFORM_ADDRESS = process.env.NEXT_PUBLIC_PLATFORM_ADDRESS as string;
export const API_URL = process.env.NEXT_PUBLIC_API_URL as string;
export const FACTORY_ADDRESS = process.env.NEXT_PUBLIC_FACTORY_ADDRESS as `0x${string}`;
export const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_ADDRESS as `0x${string}`;
export const BASESCAN_URL = process.env.NEXT_PUBLIC_BASESCAN_URL ?? "https://sepolia.basescan.org";
// Optional — falls back to Base Sepolia's shared public RPC (sepolia.base.org) when unset.
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || undefined;
