import { getAllIaProfiles } from "@/lib/db";
import IaProfilesList from "./IaProfilesList";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Profils IA — Plats du Jour",
};

export default async function IaPage() {
  const profiles = await getAllIaProfiles();

  return (
    <div className="space-y-6">
      <div>
        <h1
          className="text-2xl sm:text-3xl font-bold text-[var(--text)]"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Profils IA
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Modifiez le comportement de chaque agent. Tout le monde peut tout modifier — soyez sages.
        </p>
      </div>
      <IaProfilesList initialProfiles={profiles} />
    </div>
  );
}
