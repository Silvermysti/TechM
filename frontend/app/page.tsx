import Link from "next/link";

const PORTALS = [
  {
    href: "/customer",
    title: "Customer Portal",
    desc: "Submit an after-sales request and track its status.",
    accent: "from-cyan-500/20 to-cyan-500/5 border-cyan-500/40",
    tag: "Vehicle owners",
    ready: true,
  },
  {
    href: "/manager",
    title: "Manager Command Center",
    desc: "Review AI recommendations, approve high-stakes decisions, monitor agents.",
    accent: "from-red-500/20 to-red-500/5 border-red-500/40",
    tag: "Operations",
    ready: true,
  },
  {
    href: "/dealer",
    title: "Dealer Portal",
    desc: "Service schedule, parts status, open jobs. (Phase 3)",
    accent: "from-amber-500/20 to-amber-500/5 border-amber-500/40",
    tag: "Service advisors",
    ready: false,
  },
  {
    href: "/admin",
    title: "Admin Console",
    desc: "Configure agents, rules, users, audit log. (Phase 3)",
    accent: "from-emerald-500/20 to-emerald-500/5 border-emerald-500/40",
    tag: "IT / config",
    ready: false,
  },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">
        Tech Mahindra · Automotive After-Sales
      </p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight">
        Unified AI Command Center
      </h1>
      <p className="mt-3 max-w-2xl text-slate-400">
        A demo of Plan B — a 3-tier agent hierarchy automating the automotive
        after-sales lifecycle, with a human in the loop for every high-stakes call.
        Pick a portal to begin.
      </p>

      <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2">
        {PORTALS.map((p) => (
          <Link
            key={p.href}
            href={p.href}
            className={`group rounded-2xl border bg-gradient-to-b ${p.accent} p-6 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/30`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {p.tag}
              </span>
              {!p.ready && (
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
                  preview
                </span>
              )}
            </div>
            <h2 className="mt-3 text-xl font-semibold">{p.title}</h2>
            <p className="mt-1 text-sm text-slate-400">{p.desc}</p>
            <span className="mt-4 inline-block text-sm font-medium text-slate-200 group-hover:text-white">
              Open →
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
