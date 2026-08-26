import type { Abi } from "viem";

export const escrowReadAbi = [
  { type: "function", name: "BUYER", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "SELLER", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "TOKEN", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "totalAmount", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "sellerAccepted", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "funded", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "cancelled", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "milestoneCount", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "CORRECTION_WINDOW_DAYS", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "AUTO_APPROVAL_DAYS", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "DISPUTE_TIMEOUT_DAYS", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    type: "function", name: "milestones", inputs: [{ type: "uint256" }],
    outputs: [
      { name: "amount", type: "uint256" },
      { name: "status", type: "uint8" },
      { name: "deliveryHash", type: "bytes32" },
      { name: "submittedAt", type: "uint256" },
      { name: "disputeReason", type: "bytes32" },
      { name: "disputeOpenedAt", type: "uint256" },
      { name: "disputeOpenedBy", type: "address" },
    ],
    stateMutability: "view",
  },
] as const satisfies Abi;
