"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import type { WalletClient } from "viem";
import { renameProjectTitle } from "@/services/projects";

type ProjectTitleProps = {
  /** null until the backend has answered. */
  title: string | null | undefined;
  /** False until the project details have loaded — nothing is shown before that. */
  ready: boolean;
  /** Only the buyer can rename. */
  canRename: boolean;
  walletClient: WalletClient | undefined;
  escrowAddress: string;
  onRenamed: (title: string) => void;
};

/** Project heading, with an inline rename form for the buyer. */
export function ProjectTitle({ title, ready, canRename, walletClient, escrowAddress, onRenamed }: ProjectTitleProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEdit = () => {
    setDraft(title || "");
    setError(null);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setDraft("");
    setError(null);
  };

  const save = async () => {
    if (!walletClient) {
      setError("Wallet not ready — please try again.");
      return;
    }
    const nextTitle = draft.trim();
    if (!nextTitle) {
      setError("Title is required");
      return;
    }
    if (nextTitle.length > 200) {
      setError("Title must be at most 200 characters");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const result = await renameProjectTitle(walletClient, escrowAddress, nextTitle);
      if (!result.ok) {
        setError(result.error || "Failed to rename project");
        return;
      }
      onRenamed(result.title ?? nextTitle);
      setIsEditing(false);
      setDraft("");
    } catch {
      setError("Failed to rename project — please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (isEditing) {
    return (
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={200}
            disabled={saving}
            autoFocus
            className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-lg font-semibold text-zinc-900 outline-none focus:border-zinc-500"
            placeholder="Project name"
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") cancelEdit();
            }}
          />
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={cancelEdit}
            disabled={saving}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex min-h-9 items-center gap-2">
      {ready && <h1 className="text-3xl font-bold tracking-tight text-zinc-900">{title || "Untitled Project"}</h1>}
      {ready && canRename && (
        <button
          type="button"
          onClick={startEdit}
          className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
          aria-label="Rename project"
        >
          <Pencil className="h-3.5 w-3.5" />
          Rename
        </button>
      )}
    </div>
  );
}
