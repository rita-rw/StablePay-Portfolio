import type { WalletClient } from "viem";
import { authFetch } from "@/lib/authFetch";
import { API_URL } from "@/lib/constants";

/** Public fields without auth; pass walletClient to get private profile (org/email/createdAt) when allowed. */
/**
 * The user registered for `address`, or null if there is none (the backend answers 200 + null).
 * Throws on any error, e.g. 429 — an error must not be read as "not registered".
 */
export async function fetchUser(address: string, walletClient?: WalletClient) {
  const res = walletClient
    ? await authFetch(`${API_URL}/users/${address}`, walletClient)
    : await fetch(`${API_URL}/users/${address}`);
  if (!res.ok) throw new Error(`GET /users failed: ${res.status}`);
  return res.json();
}

export async function registerUser(
  walletClient: WalletClient,
  payload: {
    address: string;
    companyName: string;
    orgNumber: string;
    email: string;
    termsAccepted: boolean;
    paymentTermsAccepted: boolean;
  },
): Promise<{ ok: boolean; error?: string }> {
  const res = await authFetch(`${API_URL}/users/register`, walletClient, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error || "Registration failed" };
  }
  return { ok: true };
}

export async function updateUser(
  walletClient: WalletClient,
  address: string,
  payload: { companyName: string; orgNumber: string; email: string },
): Promise<{ ok: boolean; error?: string }> {
  const res = await authFetch(`${API_URL}/users/${address}`, walletClient, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error || "Update failed" };
  }
  return { ok: true };
}
