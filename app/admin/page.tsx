import { redirect } from "next/navigation";
import { isAdminRequest } from "@/lib/adminAuth";
import { getRecentRuns } from "@/lib/db";
import AdminDashboard from "./AdminDashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!(await isAdminRequest())) {
    redirect("/admin/login");
  }
  const runs = await getRecentRuns();
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-2xl font-bold">Admin — Pipeline</h1>
      <AdminDashboard initialRuns={runs} />
    </main>
  );
}
