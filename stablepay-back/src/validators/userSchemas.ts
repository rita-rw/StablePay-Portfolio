import { z } from "zod";
import { getAddress } from "viem";
import {
  MAX_COMPANY_NAME,
  MAX_ORG_NUMBER,
  MAX_EMAIL,
} from "../utils/constants";

export const RegisterUserBody = z.object({
  address: z
    .string("Invalid address")
    .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address")
    .transform((v) => getAddress(v)),
  companyName: z
    .string("companyName is required")
    .trim()
    .min(1, "companyName is required")
    .max(MAX_COMPANY_NAME, `companyName must be at most ${MAX_COMPANY_NAME} characters`),
  orgNumber: z
    .string("orgNumber is required")
    .trim()
    .min(1, "orgNumber is required")
    .max(MAX_ORG_NUMBER, `orgNumber must be at most ${MAX_ORG_NUMBER} characters`),
  email: z
    .string("A valid email is required")
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "A valid email is required")
    .max(MAX_EMAIL, `email must be at most ${MAX_EMAIL} characters`),
  termsAccepted: z.unknown().refine((v) => !!v, { message: "Terms must be accepted" }),
  paymentTermsAccepted: z.unknown().refine((v) => !!v, { message: "Payment terms must be accepted" }),
});

export const UpdateUserBody = z.object({
  companyName: z
    .string()
    .trim()
    .min(1, "companyName is required")
    .max(MAX_COMPANY_NAME, `companyName must be at most ${MAX_COMPANY_NAME} characters`),
  orgNumber: z
    .string()
    .trim()
    .min(1, "orgNumber is required")
    .max(MAX_ORG_NUMBER, `orgNumber must be at most ${MAX_ORG_NUMBER} characters`),
  email: z
    .string()
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "A valid email is required")
    .max(MAX_EMAIL, `email must be at most ${MAX_EMAIL} characters`),
});
