import { BaseError, UserRejectedRequestError, type WalletClient } from "viem";
import { baseSepolia } from "wagmi/chains";

// Window events so the UI can react without every page handling it itself (see SignatureBanner).
export const AUTH_DECLINED_EVENT = "stablepay:authDeclined";
export const AUTH_SIGNED_EVENT = "stablepay:authSigned";

/** Thrown when the user closes or rejects the signature request in their wallet. */
export class SignatureDeclinedError extends Error {
  constructor() {
    super("Signature request declined in wallet");
    this.name = "SignatureDeclinedError";
  }
}

/** True if the wallet error was the user saying no (EIP-1193 code 4001), not a technical failure. */
function isUserRejection(err: unknown): boolean {
  return err instanceof BaseError && err.walk((e) => e instanceof UserRejectedRequestError) !== null;
}

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

export function hasValidAuth(address: string): boolean {
  return cachedAuth !== null && cachedAuth.address === address && Date.now() < cachedAuth.expiresAt;
}

async function ensureAuth(walletClient: WalletClient): Promise<void> {
  const address = walletClient.account!.address;
  if (hasValidAuth(address)) return;

  if (pendingSign) {
    await pendingSign;
    return;
  }

  pendingSign = (async () => {
    const ts = Date.now();
    const message = `StablePay auth | chain:${baseSepolia.id} | address:${address} | ts:${ts}`;
    let signature: `0x${string}`;
    try {
      signature = await walletClient.signMessage({ account: walletClient.account!, message });
    } catch (err) {
      if (isUserRejection(err)) {
        window.dispatchEvent(new Event(AUTH_DECLINED_EVENT));
        throw new SignatureDeclinedError();
      }
      throw err;
    }
    window.dispatchEvent(new Event(AUTH_SIGNED_EVENT));
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
