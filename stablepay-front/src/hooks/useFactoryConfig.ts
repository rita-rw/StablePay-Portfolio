"use client";

import { useReadContract } from "wagmi";
import EscrowFactoryABI from "@/abi/EscrowFactory.json";
import { computeMaxFeeBps } from "@/lib/escrow-validation";
import { FACTORY_ADDRESS } from "@/lib/constants";

export function useFactoryConfig() {
  const { data: platformFeeBps } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: EscrowFactoryABI.abi,
    functionName: "platformFeeBps",
  });

  const { data: contractMaxFeeBps } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: EscrowFactoryABI.abi,
    functionName: "MAX_FEE_BPS",
  });

  const safeMaxFeeBps =
    typeof platformFeeBps === "bigint" && typeof contractMaxFeeBps === "bigint"
      ? computeMaxFeeBps(platformFeeBps, contractMaxFeeBps)
      : undefined;

  return {
    platformFeeBps: platformFeeBps as bigint | undefined,
    contractMaxFeeBps: contractMaxFeeBps as bigint | undefined,
    safeMaxFeeBps,
  };
}
