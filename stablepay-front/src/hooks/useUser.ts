"use client";

import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { fetchUser } from "@/services/users";
import type { User } from "@/types/user";

export type { User };

export function useUser() {
  const { address, isConnected } = useAccount();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!isConnected || !address) {
      setUser(null);
      setLoading(false);
      setChecked(true);
      return;
    }

    function load() {
      setLoading(true);
      fetchUser(address!)
        .then((data) => setUser(data))
        .catch(() => setUser(null))
        .finally(() => {
          setLoading(false);
          setChecked(true);
        });
    }

    load();
    window.addEventListener("stablepay:userUpdated", load);
    return () => window.removeEventListener("stablepay:userUpdated", load);
  }, [address, isConnected]);

  return { user, loading, checked, isRegistered: !!user };
}
