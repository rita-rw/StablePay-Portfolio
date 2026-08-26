import type { WalletClient } from "viem";
import { authFetch } from "@/lib/authFetch";
import { API_URL } from "@/lib/constants";

export async function fetchUser(address: string) {
  const res = await fetch(`${API_URL}/users/${address}`);
  if (!res.ok) return null;
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
