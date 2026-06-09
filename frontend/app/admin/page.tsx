import { Header } from "@/components/Header";

export default function AdminConsole() {
  return (
    <>
      <Header title="Admin Console" accent="bg-emerald-400" />
      <main className="mx-auto w-full max-w-3xl px-6 py-16 text-center">
        <h2 className="text-xl font-semibold">Coming in Phase 3</h2>
        <p className="mt-2 text-slate-400">
          Agent prompt configuration, warranty rules, user management, and a
          searchable audit log.
        </p>
      </main>
    </>
  );
}
