"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "./types";

const KEY = "techm.session";

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function setSession(s: Session): void {
  window.localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearSession(): void {
  window.localStorage.removeItem(KEY);
}

/**
 * Client-side route guard. Reads the stored session on mount and, if absent or
 * the role isn't allowed, redirects to /login. Returns the session once known.
 *
 *   `ready` is false until the localStorage check has run (avoids a flash).
 */
export function useAuth(allow?: ("customer" | "manager")[]): {
  session: Session | null;
  ready: boolean;
} {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    if (allow && !allow.includes(s.role)) {
      // Logged in but wrong portal — send them to their own home.
      router.replace(s.role === "manager" ? "/" : "/customer");
      return;
    }
    setSessionState(s);
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { session, ready };
}
