import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

function getWalletClient() {
  const raw = process.env.PRIVATE_KEY;
  if (!raw) throw new Error("PRIVATE_KEY env var is not set");
  const privateKey = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(process.env.RPC_URL),
  });
}

function getWalletPublicClient() {
  return createPublicClient({
    chain: baseSepolia,
    transport: http(process.env.RPC_URL),
  });
}

/** Signing wallet client for platform write transactions. */
export const walletClient = {
  writeContract: (...args: Parameters<ReturnType<typeof getWalletClient>["writeContract"]>) =>
    getWalletClient().writeContract(...args),
};

/** Public client co-located here for receipt waiting after write txs. */
export const walletPublicClient = {
  waitForTransactionReceipt: (...args: Parameters<ReturnType<typeof getWalletPublicClient>["waitForTransactionReceipt"]>) =>
    getWalletPublicClient().waitForTransactionReceipt(...args),
};
