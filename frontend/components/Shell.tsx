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
      <aside
        className="sticky top-0 hidden h-screen flex-none flex-col border-r border-line bg-surface/80 backdrop-blur-md lg:flex"
        style={{ width: "256px" }}
      >
        {/* Sidebar header */}
        <div className="border-b border-line px-5 py-4">
          <div className="mark text-[0.7rem] text-ink">
            <span className="mark-glyph" />
            Tech&nbsp;Mahindra
          </div>
          <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.22em] text-faint">
            After-Sales AI
          </p>
        </div>

        {/* Nav */}
        <nav className="no-scrollbar flex-1 overflow-y-auto px-3 py-4">
          {nav.map((group) => (
            <div key={group.section} className="mb-6">
              <p className="eyebrow mb-2 px-2">{group.section}</p>
              <ul className="space-y-px">
                {group.items.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-disabled={item.soon}
                        className={[
                          "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-all duration-150",
                          active
                            ? "bg-techm-soft font-semibold text-ink"
                            : item.soon
                              ? "cursor-default text-faint"
                              : "text-muted hover:bg-raised hover:text-ink",
                        ].join(" ")}
                      >
                        {/* Left accent strip on active */}
                        {active && (
                          <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-techm" />
                        )}

                        {/* Code badge */}
                        <span
                          className={[
                            "flex h-5 w-5 flex-none items-center justify-center rounded font-mono text-[9px] font-medium",
                            active
                              ? "bg-techm text-white"
                              : "bg-raised text-faint group-hover:bg-line-strong group-hover:text-muted",
                          ].join(" ")}
                        >
                          {item.code}
                        </span>

                        <span className="flex-1 truncate">{item.label}</span>

                        {item.soon && (
                          <span className="ml-auto rounded border border-line px-1 font-mono text-[8px] uppercase tracking-wider text-faint">
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

        {/* User section */}
        <div className="border-t border-line p-3 space-y-2">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            {/* Initials avatar */}
            <span
              className="flex h-9 w-9 flex-none items-center justify-center rounded-lg font-display text-xs font-bold text-white"
              style={{
                background:
                  "linear-gradient(135deg, var(--techm) 0%, var(--techm-deep) 100%)",
                boxShadow: "0 2px 8px -2px var(--techm)",
              }}
            >
              {initials}
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold leading-tight text-ink">
                {session.name}
              </p>
              <span className="chip mt-0.5 border-techm-soft text-[8px] text-techm">
                {session.role}
              </span>
            </div>
          </div>

          <button
            onClick={logout}
            className="w-full rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition-all duration-150 hover:border-techm/50 hover:bg-techm-soft hover:text-techm"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* ---- Main column ---- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur-md">
          {/* Brand accent line */}
          <div className="h-[2px] w-full bg-gradient-to-r from-techm via-techm/40 to-transparent" />

          <div className="flex items-center justify-between gap-4 px-6 py-2.5">
            {/* Left: mobile mark + page title */}
            <div className="flex items-center gap-3">
              <div className="mark text-[0.66rem] text-ink lg:hidden">
                <span className="mark-glyph" />
                TM
              </div>
              <h1 className="text-[15px] font-semibold tracking-tight text-ink">
                {title}
              </h1>
            </div>

            {/* Right: status cluster */}
            <div className="flex items-center gap-4">
              {/* Operational status with live dot */}
              <span className="hidden items-center gap-1.5 sm:flex">
                <span className="dot dot-live" />
                <span className="font-mono text-[10px] uppercase tracking-widest text-faint">
                  Operational
                </span>
              </span>

              <Clock />
              <ThemeToggle />
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 px-6 py-6">{children}</main>

        {/* Footer */}
        <footer className="border-t border-line px-6 py-2">
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
