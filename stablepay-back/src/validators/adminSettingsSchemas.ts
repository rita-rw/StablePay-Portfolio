import { z } from "zod";
import { getAddress } from "viem";

function zodAddress(message: string) {
  return z
    .string(message)
    .regex(/^0x[a-fA-F0-9]{40}$/, message)
    .transform((v) => getAddress(v));
}

export const SetFeeBpsBody = z.object({
  feeBps: z.number().int().min(0).max(1000),
});

export const SetAutoApprovalDaysBody = z.object({
  days: z.number().int().min(1),
});

export const SetDisputeTimeoutDaysBody = z.object({
  days: z.number().int().min(1),
});

export const SetCorrectionWindowDaysBody = z.object({
  days: z.number().int().min(0),
});

export const ApproveTokenBody = z.object({
  tokenAddress: zodAddress("Invalid tokenAddress"),
});

export const RemoveTokenBody = z.object({
  tokenAddress: zodAddress("Invalid tokenAddress"),
});
