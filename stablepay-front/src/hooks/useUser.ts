"use client";

import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { fetchUser } from "@/services/users";
import type { User } from "@/types/user";

export type { User };

export function useUser() {
  const { address, isConnected, status } = useAccount();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (status === "connecting" || status === "reconnecting") return;

    if (!isConnected || !address) {
      setUser(null);
      setLoading(false);
      setChecked(true);
      return;
    }

    let cancelled = false;
    const load = () => {
      setLoading(true);
      fetchUser(address)
        .then((data) => {
          if (!cancelled) setUser(data);
        })
        .catch(() => {
          if (!cancelled) setUser(null);
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
            setChecked(true);
          }
        });
    };

    setChecked(false);
    load();
    window.addEventListener("stablepay:userUpdated", load);
    return () => {
      cancelled = true;
      window.removeEventListener("stablepay:userUpdated", load);
    };
  }, [address, isConnected, status]);

  return { user, loading, checked, isRegistered: !!user };
}
