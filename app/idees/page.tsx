import { getAllIdees } from "@/lib/db";
import IdeeForm from "./IdeeForm";
import IdeesList from "./IdeesList";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Idées d'améliorations — Plats du Jour",
};

export default async function IdeesPage() {
  const idees = await getAllIdees();

  return (
    <div className="space-y-6">
      <div>
        <h1
          className="text-2xl sm:text-3xl font-bold text-[var(--text)]"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Idées d&apos;améliorations
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Proposez vos idées et votez pour celles des autres
        </p>
      </div>

      <IdeeForm />
      <IdeesList initialIdees={idees} />
    </div>
  );
}
