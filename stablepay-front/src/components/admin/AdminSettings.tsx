"use client";

import { useState, useEffect } from "react";
import { useAccount, useWalletClient, useReadContract } from "wagmi";
import { useRouter } from "next/navigation";
import Link from "next/link";
import EscrowFactoryABI from "@/abi/EscrowFactory.json";
import { updateAdminSetting } from "@/services/adminSettings";
import { PLATFORM_ADDRESS, FACTORY_ADDRESS, BASESCAN_URL } from "@/lib/constants";

const FACTORY = FACTORY_ADDRESS as `0x${string}`;
const ABI = EscrowFactoryABI.abi as never[];

type SettingKey = "fee" | "autoApproval" | "disputeTimeout" | "correctionWindow";

type TxResult = {
  ok: boolean;
  txHash?: string;
  error?: string;
};

function SettingRow({
  label,
  description,
  currentValue,
  displayValue,
  inputLabel,
  inputMin,
  inputMax,
  inputStep,
  loading,
  pending,
  result,
  onSubmit,
}: {
  label: string;
  description: string;
  currentValue: string;
  displayValue?: string;
  inputLabel: string;
  inputMin: number;
  inputMax?: number;
  inputStep?: number;
  loading: boolean;
  pending: boolean;
  result: TxResult | null;
  onSubmit: (value: number) => void;
}) {
  const [inputVal, setInputVal] = useState("");

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white px-6 py-5 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-zinc-900">{label}</h2>
        <p className="mt-0.5 text-xs text-zinc-500">{description}</p>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <span className="text-xs text-zinc-500">Current:</span>
        {loading ? (
          <span className="h-4 w-20 animate-pulse rounded bg-zinc-200 inline-block" />
        ) : (
          <span className="text-sm font-medium text-zinc-800">{displayValue ?? currentValue}</span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <input
          type="number"
          min={inputMin}
          max={inputMax}
          step={inputStep ?? 1}
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          placeholder={inputLabel}
          disabled={pending}
          className="w-40 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400 disabled:opacity-50"
        />
        <button
          onClick={() => {
            const v = parseFloat(inputVal);
            if (!isNaN(v)) onSubmit(v);
          }}
          disabled={pending || inputVal === ""}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-40"
        >
          {pending ? "Pending…" : "Update"}
        </button>
      </div>

      {result && (
        <div className="mt-3">
          {result.ok && result.txHash ? (
            <p className="text-xs text-emerald-600">
              Done!{" "}
              <a
                href={`${BASESCAN_URL}/tx/${result.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-emerald-800"
              >
                View on Basescan
              </a>
            </p>
          ) : (
            <p className="text-xs text-red-600">{result.error ?? "Transaction failed"}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminSettings() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  // On-chain reads
  const { data: feeBps, isLoading: loadingFee, refetch: refetchFee } = useReadContract({
    address: FACTORY,
    abi: ABI,
    functionName: "platformFeeBps",
  });

  const { data: autoApprovalDays, isLoading: loadingAutoApproval, refetch: refetchAutoApproval } = useReadContract({
    address: FACTORY,
    abi: ABI,
    functionName: "defaultAutoApprovalDays",
  });

  const { data: disputeTimeoutDays, isLoading: loadingDisputeTimeout, refetch: refetchDisputeTimeout } = useReadContract({
    address: FACTORY,
    abi: ABI,
    functionName: "defaultDisputeTimeoutDays",
  });

  const { data: correctionWindowDays, isLoading: loadingCorrectionWindow, refetch: refetchCorrectionWindow } = useReadContract({
    address: FACTORY,
    abi: ABI,
    functionName: "defaultCorrectionWindowDays",
  });

  // Pending/result state per setting
  const [pending, setPending] = useState<Record<SettingKey | "tokenApprove" | "tokenRemove", boolean>>({
    fee: false,
    autoApproval: false,
    disputeTimeout: false,
    correctionWindow: false,
    tokenApprove: false,
    tokenRemove: false,
  });
  const [results, setResults] = useState<Record<SettingKey | "tokenApprove" | "tokenRemove", TxResult | null>>({
    fee: null,
    autoApproval: null,
    disputeTimeout: null,
    correctionWindow: null,
    tokenApprove: null,
    tokenRemove: null,
  });
  const [tokenAddress, setTokenAddress] = useState("");

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (mounted && (!isConnected || address?.toLowerCase() !== PLATFORM_ADDRESS?.toLowerCase())) {
      router.replace("/");
    }
  }, [mounted, isConnected, address, router]);

  if (!mounted) return null;
  if (!isConnected || address?.toLowerCase() !== PLATFORM_ADDRESS?.toLowerCase()) return null;

  async function handleSetting(
    key: SettingKey,
    endpoint: string,
    body: Record<string, unknown>,
    refetch: () => void,
  ) {
    if (!walletClient) return;
    setPending((p) => ({ ...p, [key]: true }));
    setResults((r) => ({ ...r, [key]: null }));
    const result = await updateAdminSetting(walletClient, endpoint, body);
    setResults((r) => ({ ...r, [key]: result }));
    setPending((p) => ({ ...p, [key]: false }));
    if (result.ok) refetch();
  }

  async function handleToken(action: "tokenApprove" | "tokenRemove") {
    if (!walletClient || !tokenAddress) return;
    const endpoint = action === "tokenApprove" ? "/admin/settings/tokens/approve" : "/admin/settings/tokens/remove";
    setPending((p) => ({ ...p, [action]: true }));
    setResults((r) => ({ ...r, [action]: null }));
    const result = await updateAdminSetting(walletClient, endpoint, { tokenAddress });
    setResults((r) => ({ ...r, [action]: result }));
    setPending((p) => ({ ...p, [action]: false }));
  }

  const feeBpsNum = feeBps !== undefined ? Number(feeBps) : null;
  const autoApprovalNum = autoApprovalDays !== undefined ? Number(autoApprovalDays) : null;
  const disputeTimeoutNum = disputeTimeoutDays !== undefined ? Number(disputeTimeoutDays) : null;
  const correctionWindowNum = correctionWindowDays !== undefined ? Number(correctionWindowDays) : null;

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-8">
          <Link
            href="/projects"
            className="mb-6 inline-block text-sm text-zinc-500 hover:text-zinc-900 hover:underline"
          >
            ← Back to Projects
          </Link>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Admin Settings</h1>
          <p className="mt-1 text-sm text-zinc-500">Manage on-chain factory configuration.</p>
        </div>

        <div className="flex flex-col gap-4">
          <SettingRow
            label="Platform Fee"
            description="Fee taken by the platform on each payment (max 10%)."
            currentValue={feeBpsNum !== null ? String(feeBpsNum) : "—"}
            displayValue={feeBpsNum !== null ? `${(feeBpsNum / 100).toFixed(2)}%` : "—"}
            inputLabel="Fee in bps (0–1000)"
            inputMin={0}
            inputMax={1000}
            loading={loadingFee}
            pending={pending.fee}
            result={results.fee}
            onSubmit={(v) =>
              handleSetting("fee", "/admin/settings/fee", { feeBps: v }, refetchFee)
            }
          />

          <SettingRow
            label="Auto-Approval Days"
            description="Days before a submitted milestone is automatically approved."
            currentValue={autoApprovalNum !== null ? `${autoApprovalNum} days` : "—"}
            inputLabel="Days"
            inputMin={1}
            loading={loadingAutoApproval}
            pending={pending.autoApproval}
            result={results.autoApproval}
            onSubmit={(v) =>
              handleSetting("autoApproval", "/admin/settings/auto-approval", { days: v }, refetchAutoApproval)
            }
          />

          <SettingRow
            label="Dispute Timeout Days"
            description="Days before an open dispute times out."
            currentValue={disputeTimeoutNum !== null ? `${disputeTimeoutNum} days` : "—"}
            inputLabel="Days"
            inputMin={1}
            loading={loadingDisputeTimeout}
            pending={pending.disputeTimeout}
            result={results.disputeTimeout}
            onSubmit={(v) =>
              handleSetting("disputeTimeout", "/admin/settings/dispute-timeout", { days: v }, refetchDisputeTimeout)
            }
          />

          <SettingRow
            label="Correction Window Days"
            description="Days a seller has to correct work after a dispute is raised (0 = disabled)."
            currentValue={correctionWindowNum !== null ? `${correctionWindowNum} days` : "—"}
            inputLabel="Days"
            inputMin={0}
            loading={loadingCorrectionWindow}
            pending={pending.correctionWindow}
            result={results.correctionWindow}
            onSubmit={(v) =>
              handleSetting(
                "correctionWindow",
                "/admin/settings/correction-window",
                { days: v },
                refetchCorrectionWindow,
              )
            }
          />

          {/* Token Management */}
          <div className="rounded-2xl border border-zinc-200 bg-white px-6 py-5 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-zinc-900">Approved Tokens</h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Approve or remove ERC-20 payment tokens on the factory.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <input
                type="text"
                value={tokenAddress}
                onChange={(e) => setTokenAddress(e.target.value)}
                placeholder="0x token address"
                disabled={pending.tokenApprove || pending.tokenRemove}
                className="w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-400 disabled:opacity-50"
              />

              <div className="flex gap-3">
                <button
                  onClick={() => handleToken("tokenApprove")}
                  disabled={pending.tokenApprove || pending.tokenRemove || !tokenAddress}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-40"
                >
                  {pending.tokenApprove ? "Pending…" : "Approve"}
                </button>
                <button
                  onClick={() => handleToken("tokenRemove")}
                  disabled={pending.tokenApprove || pending.tokenRemove || !tokenAddress}
                  className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-40"
                >
                  {pending.tokenRemove ? "Pending…" : "Remove"}
                </button>
              </div>

              {results.tokenApprove && (
                <div className="mt-1">
                  {results.tokenApprove.ok && results.tokenApprove.txHash ? (
                    <p className="text-xs text-emerald-600">
                      Token approved!{" "}
                      <a
                        href={`${BASESCAN_URL}/tx/${results.tokenApprove.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline hover:text-emerald-800"
                      >
                        View on Basescan
                      </a>
                    </p>
                  ) : (
                    <p className="text-xs text-red-600">{results.tokenApprove.error ?? "Transaction failed"}</p>
                  )}
                </div>
              )}

              {results.tokenRemove && (
                <div className="mt-1">
                  {results.tokenRemove.ok && results.tokenRemove.txHash ? (
                    <p className="text-xs text-emerald-600">
                      Token removed!{" "}
                      <a
                        href={`${BASESCAN_URL}/tx/${results.tokenRemove.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline hover:text-emerald-800"
                      >
                        View on Basescan
                      </a>
                    </p>
                  ) : (
                    <p className="text-xs text-red-600">{results.tokenRemove.error ?? "Transaction failed"}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
