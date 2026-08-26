import type { Abi } from "viem";

export const factoryWriteAbi = [
  { type: "function", name: "setPlatformFeeBps", inputs: [{ name: "newFeeBps", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "setDefaultAutoApprovalDays", inputs: [{ name: "newDays", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "setDefaultDisputeTimeoutDays", inputs: [{ name: "newDays", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "setDefaultCorrectionWindowDays", inputs: [{ name: "newDays", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "approveToken", inputs: [{ name: "token", type: "address" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "removeToken", inputs: [{ name: "token", type: "address" }], outputs: [], stateMutability: "nonpayable" },
] as const satisfies Abi;
