import type { WalletClient } from "viem";
import { authFetch } from "@/lib/authFetch";
import { API_URL } from "@/lib/constants";

export async function fetchAdminDisputes(walletClient: WalletClient) {
  const res = await authFetch(`${API_URL}/admin/disputes`, walletClient);
  if (!res.ok) return [];
  return res.json();
}

export async function fetchAdminDisputeDetail(walletClient: WalletClient, escrowAddress: string) {
  const res = await authFetch(`${API_URL}/admin/disputes/${escrowAddress}`, walletClient);
  if (!res.ok) return null;
  return res.json();
}
