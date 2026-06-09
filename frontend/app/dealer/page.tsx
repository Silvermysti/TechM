import { Header } from "@/components/Header";

export default function DealerPortal() {
  return (
    <>
      <Header title="Dealer Portal" accent="bg-amber-400" />
      <main className="mx-auto w-full max-w-3xl px-6 py-16 text-center">
        <h2 className="text-xl font-semibold">Coming in Phase 3</h2>
        <p className="mt-2 text-slate-400">
          Service schedule, parts status, open jobs, and an AI-assist panel for
          service advisors.
        </p>
      </main>
    </>
  );
}
