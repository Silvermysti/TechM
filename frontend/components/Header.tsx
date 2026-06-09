import Link from "next/link";

export function Header({ title, accent }: { title: string; accent: string }) {
  return (
    <header className="border-b border-slate-800 bg-slate-950/60 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <span className={`h-2.5 w-2.5 rounded-full ${accent}`} />
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        </div>
        <Link
          href="/"
          className="text-sm text-slate-400 transition hover:text-white"
        >
          ← All portals
        </Link>
      </div>
    </header>
  );
}
