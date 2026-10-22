import type { WalletClient } from "viem";
import { baseSepolia } from "wagmi/chains";

// Cache signature in memory — backend accepts signatures up to 4 min old,
// so we use 3 min TTL to keep a safety margin.
const CACHE_TTL_MS = 3 * 60 * 1000;

let cachedAuth: {
  address: string;
  signature: string;
  message: string;
  expiresAt: number;
} | null = null;

// Prevent parallel signMessage calls from triggering multiple MetaMask popups
let pendingSign: Promise<void> | null = null;

async function ensureAuth(walletClient: WalletClient): Promise<void> {
  const address = walletClient.account!.address;
  if (cachedAuth && cachedAuth.address === address && Date.now() < cachedAuth.expiresAt) return;

  if (pendingSign) {
    await pendingSign;
    return;
  }

  pendingSign = (async () => {
    const ts = Date.now();
    const message = `StablePay auth | chain:${baseSepolia.id} | address:${address} | ts:${ts}`;
    const signature = await walletClient.signMessage({ account: walletClient.account!, message });
    // expiresAt is based on the message's own ts (what the backend checks against),
    // not on when signing finished — otherwise a slow MetaMask confirm makes the
    // frontend think the cache is fresh while the backend already sees it as expired.
    cachedAuth = { address, signature, message, expiresAt: ts + CACHE_TTL_MS };
  })();

  try {
    await pendingSign;
  } finally {
    pendingSign = null;
  }
}

export async function authFetch(
  url: string,
  walletClient: WalletClient,
  init?: RequestInit,
): Promise<Response> {
  await ensureAuth(walletClient);

  return fetch(url, {
    ...init,
    headers: {
      ...init?.headers,
      "x-wallet-address": cachedAuth!.address,
      "x-signature": cachedAuth!.signature,
      "x-message": cachedAuth!.message,
    },
  });
}
