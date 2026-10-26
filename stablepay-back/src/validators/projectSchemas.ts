import { z } from "zod";
import { getAddress } from "viem";
import {
  MAX_TITLE,
  MAX_DESCRIPTION,
  MAX_DELIVERY_REF,
  MAX_DISPUTE_REASON,
  MAX_SELLER_RESPONSE,
  MAX_ESCALATION_REASON,
  MIN_RESOLUTION_NOTE,
  MAX_RESOLUTION_NOTE,
} from "../utils/constants";

function zodAddress(message: string) {
  return z
    .string(message)
    .regex(/^0x[a-fA-F0-9]{40}$/, message)
    .transform((v) => getAddress(v));
}

export const SeedProjectBody = z.object({
  escrowAddress: zodAddress("Invalid escrowAddress"),
  metadataHash: z.string().optional(),
  title: z
    .string()
    .max(MAX_TITLE, `title must be at most ${MAX_TITLE} characters`)
    .optional(),
  description: z
    .string()
    .max(MAX_DESCRIPTION, `description must be at most ${MAX_DESCRIPTION} characters`)
    .optional(),
  txHash: z.string().optional(),
});

export const MetadataBody = z.object({
  title: z
    .string("title is required")
    .trim()
    .min(1, "title is required")
    .max(MAX_TITLE, `title must be at most ${MAX_TITLE} characters`),
  description: z
    .string()
    .max(MAX_DESCRIPTION, `description must be at most ${MAX_DESCRIPTION} characters`)
    .optional(),
  metadataHash: z
    .string("Valid metadataHash (bytes32) is required")
    .regex(/^0x[a-fA-F0-9]{64}$/, "Valid metadataHash (bytes32) is required"),
  milestoneLabels: z
    .array(z.string().max(500, "milestone label must be at most 500 characters"))
    .max(50, "at most 50 milestone labels")
    .optional(),
});

export const RenameTitleBody = z.object({
  title: z
    .string("title is required")
    .min(1, "title is required")
    .max(MAX_TITLE, `title must be at most ${MAX_TITLE} characters`),
});

export const DeliveryBody = z.object({
  deliveryReference: z
    .string("deliveryReference is required")
    .min(1, "deliveryReference is required")
    .max(MAX_DELIVERY_REF, `deliveryReference must be at most ${MAX_DELIVERY_REF} characters`),
});

export const DisputeBody = z.object({
  disputeReason: z
    .string("disputeReason is required")
    .min(1, "disputeReason is required")
    .max(MAX_DISPUTE_REASON, `disputeReason must be at most ${MAX_DISPUTE_REASON} characters`),
});

// No .trim() on texts that are hashed on-chain — the backend must hash exactly what the frontend hashed
export const EscalationBody = z.object({
  escalationReason: z
    .string("escalationReason is required")
    .min(1, "escalationReason is required")
    .max(MAX_ESCALATION_REASON, `escalationReason must be at most ${MAX_ESCALATION_REASON} characters`),
});

export const SellerResponseBody = z.object({
  sellerResponse: z
    .string("sellerResponse is required")
    .trim()
    .min(1, "sellerResponse is required")
    .max(MAX_SELLER_RESPONSE, `sellerResponse must be at most ${MAX_SELLER_RESPONSE} characters`),
});

export const ResolutionNoteBody = z.object({
  resolutionNote: z
    .string("resolutionNote is required")
    .trim()
    .min(MIN_RESOLUTION_NOTE, `resolutionNote must be at least ${MIN_RESOLUTION_NOTE} characters`)
    .max(MAX_RESOLUTION_NOTE, `resolutionNote must be at most ${MAX_RESOLUTION_NOTE} characters`),
});
