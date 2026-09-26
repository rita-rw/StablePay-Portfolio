"use client";

import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { fetchUser } from "@/services/users";
import type { User } from "@/types/user";

export type { User };

const userCache = new Map<string, User | null>();
const storedUserKey = (address: string) => `stablepay:user:${address.toLowerCase()}`;

function readStoredUser(address: string): User | null | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem(storedUserKey(address));
    if (raw === null) return undefined;
    return raw === "null" ? null : (JSON.parse(raw) as User);
  } catch {
    return undefined;
  }
}

function writeStoredUser(address: string, user: User | null): void {
  try {
    sessionStorage.setItem(storedUserKey(address), user ? JSON.stringify(user) : "null");
  } catch {
    // Private mode can reject storage; the in-memory cache still works.
  }
}

export function useUser() {
  const { address, isConnected, status } = useAccount();
  const cached = address ? userCache.get(address.toLowerCase()) : undefined;
  const hasCachedUser = address ? userCache.has(address.toLowerCase()) : false;
  const [user, setUser] = useState<User | null>(hasCachedUser ? cached ?? null : null);
  const [loading, setLoading] = useState(!hasCachedUser);
  const [checked, setChecked] = useState(hasCachedUser);

  useEffect(() => {
    if (status === "connecting" || status === "reconnecting") {
      if (!address) return;
    } else if (!isConnected || !address) {
      setUser(null);
      setLoading(false);
      setChecked(true);
      return;
    }

    let cancelled = false;
    const key = address.toLowerCase();
    const load = () => {
      if (!userCache.has(key)) {
        const stored = readStoredUser(key);
        if (stored !== undefined) {
          userCache.set(key, stored);
          setUser(stored);
          setChecked(true);
          setLoading(false);
        } else {
          setLoading(true);
          setChecked(false);
        }
      }
      fetchUser(address)
        .then((data) => {
          if (cancelled) return;
          userCache.set(key, data);
          writeStoredUser(key, data);
          setUser(data);
        })
        .catch(() => {
          if (cancelled) return;
          userCache.set(key, null);
          writeStoredUser(key, null);
          setUser(null);
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
            setChecked(true);
          }
        });
    };

    load();
    window.addEventListener("stablepay:userUpdated", load);
    return () => {
      cancelled = true;
      window.removeEventListener("stablepay:userUpdated", load);
    };
  }, [address, isConnected, status]);

  return { user, loading, checked, isRegistered: !!user };
}
