import type { Abi } from "viem";

export const factoryReadAbi = [
  { type: "function", name: "getAllEscrows", inputs: [], outputs: [{ type: "address[]" }], stateMutability: "view" },
  { type: "function", name: "isValidEscrow", inputs: [{ name: "escrow", type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view" },
] as const satisfies Abi;
