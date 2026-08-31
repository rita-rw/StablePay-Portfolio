export const MILESTONE_STATUS_MAP: Record<number, string> = {
  0: "PENDING",
  1: "SUBMITTED",
  2: "DISPUTED",
  3: "PAID",
  4: "REFUNDED",
  5: "RESOLVED",
};

export const PLATFORM_ADDRESS = process.env.NEXT_PUBLIC_PLATFORM_ADDRESS as string;
export const API_URL = process.env.NEXT_PUBLIC_API_URL as string;
export const FACTORY_ADDRESS = process.env.NEXT_PUBLIC_FACTORY_ADDRESS as `0x${string}`;
export const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_ADDRESS as `0x${string}`;
export const BASESCAN_URL = process.env.NEXT_PUBLIC_BASESCAN_URL ?? "https://sepolia.basescan.org";
