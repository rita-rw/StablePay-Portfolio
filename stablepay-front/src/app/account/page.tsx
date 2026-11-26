"use client";

import { useState, useEffect } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { useRouter } from "next/navigation";
import { fetchUser, updateUser } from "@/services/users";
import { useMounted } from "@/hooks/useMounted";
import { formatDate } from "@/lib/formatters";

type UserProfile = {
  address: string;
  companyName: string;
  orgNumber: string;
  email: string;
  createdAt: string;
};

type EditState = {
  companyName: string;
  orgNumber: string;
  email: string;
};

export default function AccountPage() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const router = useRouter();

  const mounted = useMounted();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [form, setForm] = useState<EditState>({ companyName: "", orgNumber: "", email: "" });

  useEffect(() => {
    if (!mounted) return;
    if (!isConnected || !address) {
      router.push("/");
      return;
    }
    if (!walletClient) return;

    let cancelled = false;
    setLoading(true);
    fetchUser(address, walletClient).then((data) => {
      if (cancelled) return;
      if (!data) {
        router.push("/register");
        return;
      }
      setProfile(data);
      setForm({
        companyName: data.companyName ?? "",
        orgNumber: data.orgNumber ?? "",
        email: data.email ?? "",
      });
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setLoadError(true);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [mounted, isConnected, address, walletClient, router]);

  function startEdit() {
    setSaveError(null);
    setSaveSuccess(false);
    setEditing(true);
  }

  function cancelEdit() {
    if (!profile) return;
    setForm({ companyName: profile.companyName, orgNumber: profile.orgNumber, email: profile.email });
    setSaveError(null);
    setEditing(false);
  }

  async function handleSave() {
    if (!walletClient || !address || !profile) return;
    setSaving(true);
    setSaveError(null);
    const result = await updateUser(walletClient, address, form);
    if (!result.ok) {
      setSaveError(result.error ?? "Something went wrong");
      setSaving(false);
      return;
    }
    setProfile({ ...profile, ...form });
    window.dispatchEvent(new Event("stablepay:userUpdated"));
    setSaving(false);
    setSaveSuccess(true);
    setEditing(false);
    setTimeout(() => setSaveSuccess(false), 3000);
  }

  if (!mounted || loading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <p className="text-sm text-zinc-600">Could not load your account. Please reload the page.</p>
      </div>
    );
  }

  if (!profile) return null;

  const initials = profile.companyName.slice(0, 2).toUpperCase();
  const createdMs = profile.createdAt ? Date.parse(profile.createdAt) : NaN;
  const memberSince = Number.isFinite(createdMs)
    ? formatDate(createdMs)
    : null;

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-2xl px-4 py-10">

        {/* Header */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-xl font-bold text-white shadow-md">
            {initials}
          </div>
          <h1 className="mt-4 text-2xl font-bold text-zinc-900">{profile.companyName}</h1>
          {memberSince && (
            <p className="mt-1 text-sm text-zinc-500">Member since {memberSince}</p>
          )}
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm">

          {/* Card header */}
          <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-400">
              Company Profile
            </h2>
            {!editing && (
              <button
                onClick={startEdit}
                className="rounded-lg border border-zinc-200 px-4 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
              >
                Edit
              </button>
            )}
          </div>

          {/* Fields */}
          <div className="divide-y divide-zinc-100">
            <Field
              label="Company Name"
              value={profile.companyName}
              editing={editing}
              inputValue={form.companyName}
              onChange={(v) => setForm((f) => ({ ...f, companyName: v }))}
            />
            <Field
              label="Organisation Number"
              value={profile.orgNumber}
              editing={editing}
              inputValue={form.orgNumber}
              onChange={(v) => setForm((f) => ({ ...f, orgNumber: v }))}
            />
            <Field
              label="Email Address"
              value={profile.email}
              editing={editing}
              inputValue={form.email}
              onChange={(v) => setForm((f) => ({ ...f, email: v }))}
              type="email"
            />
            <Field
              label="Wallet Address"
              value={profile.address}
              editing={false}
              inputValue={profile.address}
              onChange={() => {}}
              mono
              readonly
            />
          </div>

          {/* Edit actions */}
          {editing && (
            <div className="border-t border-zinc-100 px-6 py-4">
              {saveError && (
                <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{saveError}</p>
              )}
              <div className="flex gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50"
                  style={{ background: "linear-gradient(145deg, hsl(221 83% 30%) 0%, hsl(217 91% 55%) 100%)" }}
                >
                  {saving ? "Saving…" : "Save Changes"}
                </button>
                <button
                  onClick={cancelEdit}
                  disabled={saving}
                  className="rounded-xl border border-zinc-200 px-5 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Success toast */}
        {saveSuccess && (
          <div className="mt-4 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm font-medium text-emerald-700">
            Profile updated successfully.
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  editing,
  inputValue,
  onChange,
  type = "text",
  mono = false,
  readonly = false,
}: {
  label: string;
  value: string;
  editing: boolean;
  inputValue: string;
  onChange: (v: string) => void;
  type?: string;
  mono?: boolean;
  readonly?: boolean;
}) {
  return (
    <div className="flex items-center gap-4 px-6 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-0.5">{label}</p>
        {editing && !readonly ? (
          <input
            type={type}
            value={inputValue}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        ) : (
          <p className={`text-sm text-zinc-900 truncate ${mono ? "font-mono text-xs text-zinc-500" : "font-medium"}`}>
            {value?.trim() ? value : "—"}
          </p>
        )}
      </div>
      {readonly && (
        <span className="shrink-0 rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-400">
          Read-only
        </span>
      )}
    </div>
  );
}
