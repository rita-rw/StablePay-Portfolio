"use client";

import { useEffect, useState } from "react";
import { AUTH_DECLINED_EVENT, AUTH_SIGNED_EVENT } from "@/lib/authFetch";

/**
 * Shown when the user closes the MetaMask signature request.
 * Without it, pages just look empty ("0 projects") and it's unclear why.
 */
export default function SignatureBanner() {
  const [declined, setDeclined] = useState(false);

  useEffect(() => {
    const show = () => setDeclined(true);
    const hide = () => setDeclined(false);
    window.addEventListener(AUTH_DECLINED_EVENT, show);
    window.addEventListener(AUTH_SIGNED_EVENT, hide);
    return () => {
      window.removeEventListener(AUTH_DECLINED_EVENT, show);
      window.removeEventListener(AUTH_SIGNED_EVENT, hide);
    };
  }, []);

  if (!declined) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-amber-900">
          <span className="font-semibold">Signature needed to load your data.</span> StablePay asks your wallet
          to sign a short message to prove it&apos;s you. It&apos;s not a transaction and costs no gas.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="shrink-0 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
