"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearSession } from "@/lib/auth";
import type { Session } from "@/lib/types";
import { ThemeToggle } from "./ThemeToggle";

type NavItem = { href: string; label: string; code: string; soon?: boolean };
type NavSection = { section: string; items: NavItem[] };

const MANAGER_NAV: NavSection[] = [
  {
    section: "Operations",
    items: [
      { href: "/", label: "Overview", code: "00" },
      { href: "/manager", label: "Command Center", code: "01" },
    ],
  },
  {
    section: "Network",
    items: [
      { href: "/dealer", label: "Dealer Portal", code: "02", soon: true },
      { href: "/admin", label: "Admin Console", code: "03", soon: true },
    ],
  },
];

const CUSTOMER_NAV: NavSection[] = [
  {
    section: "Self-service",
    items: [{ href: "/customer", label: "My Requests", code: "01" }],
  },
];

function Clock() {
  const [now, setNow] = useState("");
  useEffect(() => {
    const tick = () =>
      setNow(new Date().toLocaleTimeString("en-IN", { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="hidden font-mono text-xs tabular-nums text-faint md:block">
      {now || "--:--:--"} IST
    </span>
  );
}

export function Shell({
  title,
  session,
  children,
}: {
  title: string;
  session: Session;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const nav = session.role === "manager" ? MANAGER_NAV : CUSTOMER_NAV;
  const initials = session.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const logout = () => {
    clearSession();
    router.replace("/login");
  };

  return (
    <div className="flex min-h-screen">
      {/* ---- Sidebar ---- */}
      <aside className="sticky top-0 hidden h-screen w-60 flex-none flex-col border-r border-line bg-surface/70 backdrop-blur-sm lg:flex">
        <div className="border-b border-line px-5 py-[18px]">
          <div className="mark text-[0.68rem] text-ink">
            <span className="mark-glyph" />
            Tech&nbsp;Mahindra
          </div>
          <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-faint">
            After-Sales AI Command Center
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {nav.map((group) => (
            <div key={group.section} className="mb-5">
              <p className="eyebrow px-2 pb-2">{group.section}</p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-disabled={item.soon}
                        className={`group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition ${
                          active
                            ? "bg-techm-soft font-semibold text-ink"
                            : item.soon
                              ? "text-faint hover:text-muted"
                              : "text-muted hover:bg-raised hover:text-ink"
                        }`}
                      >
                        {active && (
                          <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-techm" />
                        )}
                        <span
                          className={`font-mono text-[10px] ${active ? "text-techm" : "text-faint"}`}
                        >
                          {item.code}
                        </span>
                        {item.label}
                        {item.soon && (
                          <span className="ml-auto font-mono text-[8px] uppercase tracking-wider text-faint">
                            soon
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-line p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-techm font-display text-xs font-bold text-white">
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium leading-tight text-ink">
                {session.name}
              </p>
              <p className="font-mono text-[9px] uppercase tracking-wider text-faint">
                {session.role}
              </p>
            </div>
          </div>
          <button
            onClick={logout}
            className="mt-2 w-full rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition hover:border-techm hover:text-techm"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* ---- Main column ---- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
          <div className="h-0.5 w-full bg-gradient-to-r from-techm via-techm/30 to-transparent" />
          <div className="flex items-center justify-between gap-4 px-6 py-3">
            <div className="flex items-center gap-3">
              <div className="mark text-[0.66rem] text-ink lg:hidden">
                <span className="mark-glyph" />
                TM
              </div>
              <h1 className="text-[15px] font-semibold tracking-tight text-ink">
                {title}
              </h1>
            </div>
            <div className="flex items-center gap-4">
              <span className="hidden items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-faint sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-ok" />
                Operational
              </span>
              <Clock />
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main className="flex-1 px-6 py-6">{children}</main>

        <footer className="border-t border-line px-6 py-2.5">
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-faint">
            <span>TechM After-Sales · Plan B demo</span>
            <span className="hidden sm:block">APQC PCF 6.7 / 8.2</span>
            <span>API · localhost:8000</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
