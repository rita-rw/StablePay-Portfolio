import type { WalletClient } from "viem";
import { authFetch } from "@/lib/authFetch";
import { API_URL } from "@/lib/constants";

export async function updateAdminSetting(
  walletClient: WalletClient,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; txHash?: string; error?: string }> {
  const res = await authFetch(`${API_URL}${endpoint}`, walletClient, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    return { ok: false, error: data?.error ?? "Request failed" };
  }

  return { ok: true, txHash: data.txHash };
}
