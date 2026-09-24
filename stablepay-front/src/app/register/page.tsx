"use client";

import { Suspense, useState, useEffect } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@/hooks/useUser";
import { registerUser } from "@/services/users";

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { user, loading: userLoading, checked } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") ?? "/projects";
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [companyName, setCompanyName] = useState("");
  const [orgNumber, setOrgNumber] = useState("");
  const [email, setEmail] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [paymentTermsAccepted, setPaymentTermsAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (checked && user) {
      router.push(redirectTo);
    }
  }, [checked, user, router, redirectTo]);

  useEffect(() => {
    if (mounted && !isConnected) router.replace("/");
  }, [mounted, isConnected, router]);

  if (!mounted || userLoading) return null;
  if (!isConnected) return null;

  if (user) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!companyName.trim()) {
      setError("Company name is required");
      return;
    }
    if (!orgNumber.trim()) {
      setError("Organisation number is required");
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("A valid email address is required");
      return;
    }
    if (!termsAccepted || !paymentTermsAccepted) {
      setError("You must accept both terms to continue");
      return;
    }

    setSubmitting(true);

    try {
      if (!walletClient) {
        setError("Wallet not connected");
        setSubmitting(false);
        return;
      }
      const result = await registerUser(walletClient, {
        address: address!,
        companyName: companyName.trim(),
        orgNumber: orgNumber.trim(),
        email: email.trim(),
        termsAccepted: true,
        paymentTermsAccepted: true,
      });

      if (!result.ok) {
        setError(result.error || "Registration failed");
        setSubmitting(false);
        return;
      }

      router.push(redirectTo);
    } catch {
      setError("Registration failed — please try again");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 flex items-start justify-center pt-16 pb-16 px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary mb-3">Get started</p>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 mb-2">Company Registration</h1>
          <p className="text-sm text-zinc-500 leading-relaxed">
            Register your company to start using StablePay. This information is required for compliance.
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-zinc-400/60 bg-white p-8 shadow-[0_4px_24px_rgba(0,0,0,0.10)]">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-900">Company Name *</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Acme AB"
                maxLength={200}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-900">Organisation Number *</label>
              <input
                type="text"
                value={orgNumber}
                onChange={(e) => setOrgNumber(e.target.value)}
                placeholder="556677-8899"
                maxLength={20}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-900">Email *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="billing@acme.se"
                maxLength={200}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
              />
            </div>

            <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <label className="flex items-start gap-3 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="mt-0.5 accent-primary"
                />
                <span className="text-zinc-600">
                  I accept the <span className="font-medium text-zinc-800">Terms of Service</span>
                </span>
              </label>
              <label className="flex items-start gap-3 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={paymentTermsAccepted}
                  onChange={(e) => setPaymentTermsAccepted(e.target.checked)}
                  className="mt-0.5 accent-primary"
                />
                <span className="text-zinc-600">
                  I accept the <span className="font-medium text-zinc-800">Payment Terms</span>
                </span>
              </label>
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl px-6 py-3 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50"
              style={{ background: "linear-gradient(145deg, hsl(221 83% 30%) 0%, hsl(217 91% 55%) 100%)", boxShadow: "0 2px 8px hsl(217 91% 30% / 0.35)" }}
            >
              {submitting ? "Registering..." : "Register Company"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
