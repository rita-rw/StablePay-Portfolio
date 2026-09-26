import type { WalletClient } from "viem";
import { authFetch } from "@/lib/authFetch";
import { API_URL } from "@/lib/constants";
import type { Escrow } from "@/types/escrow";

export async function fetchUserProjects(address: string, walletClient?: WalletClient): Promise<Escrow[]> {
  const res = walletClient
    ? await authFetch(`${API_URL}/projects/${address}`, walletClient)
    : await fetch(`${API_URL}/projects/${address}`);
  if (!res.ok) return [];
  return res.json();
}

export async function fetchAdminProjects(walletClient: WalletClient): Promise<Escrow[]> {
  const res = await authFetch(`${API_URL}/admin/projects`, walletClient);
  if (!res.ok) return [];
  return res.json();
}

export async function fetchProjectDetail(escrowAddress: string, walletClient?: WalletClient) {
  const doFetch = walletClient
    ? authFetch(`${API_URL}/projects/detail/${escrowAddress}`, walletClient)
    : fetch(`${API_URL}/projects/detail/${escrowAddress}`);
  const res = await doFetch;
  if (!res.ok) return null;
  return res.json();
}

export async function seedProject(walletClient: WalletClient, payload: {
  escrowAddress: string;
  metadataHash: string;
  title: string;
  description: string | null;
  txHash: string;
}): Promise<void> {
  await authFetch(`${API_URL}/projects/seed`, walletClient, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function saveProjectMetadata(
  walletClient: WalletClient,
  payload: {
    title: string;
    description: string | null;
    metadataHash: string;
    milestoneLabels?: string[];
  },
): Promise<{ ok: boolean; error?: string }> {
  const res = await authFetch(`${API_URL}/projects/metadata`, walletClient, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error || "Failed to save project metadata — please try again." };
  }
  return { ok: true };
}

export async function renameProjectTitle(
  walletClient: WalletClient,
  escrowAddress: string,
  title: string,
): Promise<{ ok: boolean; title?: string; error?: string }> {
  const res = await authFetch(`${API_URL}/projects/${escrowAddress}/title`, walletClient, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: data.error || "Failed to rename project — please try again." };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: true, title: data.title ?? title };
}
