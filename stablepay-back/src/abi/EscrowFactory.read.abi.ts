import type { Abi } from "viem";

export const factoryReadAbi = [
  { type: "function", name: "isValidEscrow", inputs: [{ name: "escrow", type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "platformFeeBps", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "defaultAutoApprovalDays", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "defaultDisputeTimeoutDays", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "defaultCorrectionWindowDays", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "approvedTokens", inputs: [{ name: "token", type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view" },
] as const satisfies Abi;
