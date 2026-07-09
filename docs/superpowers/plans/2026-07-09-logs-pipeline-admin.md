# Logs & relance pipeline — page admin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une page admin protégée par mot de passe pour voir les logs des runs du pipeline Python et les relancer (jour/semaine) à distance, via un pont Postgres.

**Architecture:** Le site Vercel écrit/lit une table `pipeline_runs` en Postgres. Un poller cron sur le VPS interroge l'API pour récupérer les runs demandés, exécute le pipeline Docker, et renvoie le log final. Le run cron 7h30 s'enregistre aussi.

**Tech Stack:** Next.js 15 (App Router, route handlers `runtime=nodejs`), `@vercel/postgres`, Node `crypto` (HMAC cookie), Tailwind v4, bash + curl + jq côté VPS.

**Spec:** `docs/superpowers/specs/2026-07-09-logs-pipeline-admin-design.md`

---

## File Structure

- Create `lib/adminAuth.ts` — signature/vérif cookie admin + vérif Bearer.
- Modify `lib/db.ts` — table `pipeline_runs` + fonctions d'accès.
- Create `app/api/pipeline/login/route.ts` — login mot de passe → cookie.
- Create `app/api/pipeline/trigger/route.ts` — demande de run (cookie).
- Create `app/api/pipeline/runs/route.ts` — liste des runs (cookie).
- Create `app/api/pipeline/next/route.ts` — claim run (Bearer, VPS).
- Create `app/api/pipeline/report/route.ts` — clôture/insert run (Bearer, VPS).
- Create `app/admin/page.tsx` — page serveur (vérifie cookie, rend login OU dashboard).
- Create `app/admin/AdminDashboard.tsx` — client : boutons + liste + auto-refresh.
- Create `app/admin/LoginForm.tsx` — client : formulaire mot de passe.
- Create `plats-du-jour/poll_runs.sh` — poller cron VPS.
- Modify `plats-du-jour/cron_pdj.sh` — reporter le run 7h30 vers l'API.

---

## Task 1: Couche DB — table `pipeline_runs` et accès

**Files:**
- Modify: `lib/db.ts` (ajouter en fin de fichier)

- [ ] **Step 1: Ajouter les types et fonctions dans `lib/db.ts`**

Ajoute à la fin de `lib/db.ts` :

```typescript
// --- Runs du pipeline (logs & relance) ---

export type PipelineMode = "jour" | "semaine";
export type PipelineStatus = "requested" | "running" | "success" | "error";

export interface PipelineRun {
  id: number;
  mode: PipelineMode;
  status: PipelineStatus;
  triggered_by: string; // "admin" | "cron"
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  log: string | null;
}

const RUNS_KEEP = 50;
const LOG_MAX_CHARS = 200_000;

export async function ensurePipelineRunsTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id SERIAL PRIMARY KEY,
      mode VARCHAR(20) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'requested',
      triggered_by VARCHAR(20) NOT NULL DEFAULT 'admin',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      log TEXT
    )
  `;
}

/** Y a-t-il déjà un run en attente ou en cours ? */
export async function hasActiveRun(): Promise<boolean> {
  await ensurePipelineRunsTable();
  const r = await sql`
    SELECT 1 FROM pipeline_runs
    WHERE status IN ('requested', 'running') LIMIT 1
  `;
  return r.rows.length > 0;
}

/** Crée une demande de run. Renvoie l'id, ou null si un run est déjà actif. */
export async function requestRun(
  mode: PipelineMode,
  triggeredBy = "admin"
): Promise<number | null> {
  await ensurePipelineRunsTable();
  if (await hasActiveRun()) return null;
  const r = await sql`
    INSERT INTO pipeline_runs (mode, status, triggered_by)
    VALUES (${mode}, 'requested', ${triggeredBy})
    RETURNING id
  `;
  return r.rows[0].id as number;
}

/** Renvoie les N runs les plus récents. */
export async function getRecentRuns(): Promise<PipelineRun[]> {
  await ensurePipelineRunsTable();
  const r = await sql`
    SELECT id, mode, status, triggered_by, created_at, started_at, finished_at, log
    FROM pipeline_runs
    ORDER BY id DESC
    LIMIT ${RUNS_KEEP}
  `;
  return r.rows as PipelineRun[];
}

/** Claim atomique du plus vieux run 'requested' → 'running'. Renvoie {id, mode} ou null. */
export async function claimNextRun(): Promise<{ id: number; mode: PipelineMode } | null> {
  await ensurePipelineRunsTable();
  const r = await sql`
    UPDATE pipeline_runs SET status = 'running', started_at = NOW()
    WHERE id = (
      SELECT id FROM pipeline_runs
      WHERE status = 'requested'
      ORDER BY id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, mode
  `;
  if (r.rows.length === 0) return null;
  return { id: r.rows[0].id as number, mode: r.rows[0].mode as PipelineMode };
}

function truncateLog(log: string): string {
  if (log.length <= LOG_MAX_CHARS) return log;
  return log.slice(-LOG_MAX_CHARS);
}

async function purgeOldRuns() {
  await sql`
    DELETE FROM pipeline_runs
    WHERE id NOT IN (SELECT id FROM pipeline_runs ORDER BY id DESC LIMIT ${RUNS_KEEP})
  `;
}

/** Clôt un run existant (par id). */
export async function finishRun(
  id: number,
  status: PipelineStatus,
  log: string
): Promise<void> {
  await ensurePipelineRunsTable();
  await sql`
    UPDATE pipeline_runs
    SET status = ${status}, log = ${truncateLog(log)}, finished_at = NOW()
    WHERE id = ${id}
  `;
  await purgeOldRuns();
}

/** Insère directement un run déjà terminé (cron 7h30, ne passe pas par claim). */
export async function recordFinishedRun(
  mode: PipelineMode,
  status: PipelineStatus,
  log: string,
  triggeredBy = "cron"
): Promise<void> {
  await ensurePipelineRunsTable();
  await sql`
    INSERT INTO pipeline_runs (mode, status, triggered_by, started_at, finished_at, log)
    VALUES (${mode}, ${status}, ${triggeredBy}, NOW(), NOW(), ${truncateLog(log)})
  `;
  await purgeOldRuns();
}
```

- [ ] **Step 2: Vérifier la compilation TypeScript**

Run: `npx tsc --noEmit`
Expected: PASS (aucune erreur nouvelle liée à `lib/db.ts`).

- [ ] **Step 3: Commit**

```bash
git add lib/db.ts
git commit -m "feat(admin): table pipeline_runs + accès DB"
```

---

## Task 2: Helper d'authentification admin

**Files:**
- Create: `lib/adminAuth.ts`

- [ ] **Step 1: Écrire `lib/adminAuth.ts`**

```typescript
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "pdj_admin";
const MAX_AGE_S = 60 * 60 * 24 * 30; // 30 jours

function secret(): string {
  const s = process.env.ADMIN_PASSWORD;
  if (!s) throw new Error("ADMIN_PASSWORD non défini");
  return s;
}

/** Jeton = HMAC(expiry) sous forme "expiry.signature". */
export function signAdminToken(): string {
  // expiry en secondes epoch ; Date.now est autorisé côté serveur Next (pas dans un workflow).
  const expiry = Math.floor(Date.now() / 1000) + MAX_AGE_S;
  const sig = createHmac("sha256", secret()).update(String(expiry)).digest("hex");
  return `${expiry}.${sig}`;
}

export function verifyAdminToken(token: string | undefined): boolean {
  if (!token) return false;
  const [expiryStr, sig] = token.split(".");
  if (!expiryStr || !sig) return false;
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry < Math.floor(Date.now() / 1000)) return false;
  const expected = createHmac("sha256", secret()).update(expiryStr).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Vérifie le mot de passe fourni au login (comparaison à temps constant). */
export function checkPassword(input: string): boolean {
  const s = secret();
  const a = Buffer.from(input);
  const b = Buffer.from(s);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Lit le cookie admin (App Router) et renvoie true si valide. */
export async function isAdminRequest(): Promise<boolean> {
  const store = await cookies();
  return verifyAdminToken(store.get(ADMIN_COOKIE)?.value);
}

export const COOKIE_MAX_AGE = MAX_AGE_S;

/** Vérifie le header Authorization: Bearer <API_SECRET_TOKEN>. */
export function verifyBearer(authHeader: string | null): boolean {
  const token = process.env.API_SECRET_TOKEN;
  return !!token && authHeader === `Bearer ${token}`;
}
```

- [ ] **Step 2: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/adminAuth.ts
git commit -m "feat(admin): helper auth cookie + bearer"
```

---

## Task 3: Route login

**Files:**
- Create: `app/api/pipeline/login/route.ts`

- [ ] **Step 1: Écrire la route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { checkPassword, signAdminToken, ADMIN_COOKIE, COOKIE_MAX_AGE } from "@/lib/adminAuth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const { password } = (await request.json()) as { password?: string };
    if (!password || !checkPassword(password)) {
      return NextResponse.json({ error: "Mot de passe invalide" }, { status: 401 });
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set(ADMIN_COOKIE, signAdminToken(), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
    return res;
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }
}
```

- [ ] **Step 2: Compilation**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/pipeline/login/route.ts
git commit -m "feat(admin): route login"
```

---

## Task 4: Route trigger

**Files:**
- Create: `app/api/pipeline/trigger/route.ts`

- [ ] **Step 1: Écrire la route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { requestRun, type PipelineMode } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  try {
    const { mode } = (await request.json()) as { mode?: string };
    if (mode !== "jour" && mode !== "semaine") {
      return NextResponse.json({ error: "mode invalide" }, { status: 400 });
    }
    const id = await requestRun(mode as PipelineMode, "admin");
    if (id === null) {
      return NextResponse.json({ error: "Un run est déjà en cours" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, id });
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }
}
```

- [ ] **Step 2: Compilation** — `npx tsc --noEmit` → PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/pipeline/trigger/route.ts
git commit -m "feat(admin): route trigger (relance)"
```

---

## Task 5: Route runs (liste)

**Files:**
- Create: `app/api/pipeline/runs/route.ts`

- [ ] **Step 1: Écrire la route**

```typescript
import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { getRecentRuns } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const runs = await getRecentRuns();
  return NextResponse.json({ runs });
}
```

- [ ] **Step 2: Compilation** — `npx tsc --noEmit` → PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/pipeline/runs/route.ts
git commit -m "feat(admin): route runs (liste)"
```

---

## Task 6: Route next (claim, Bearer)

**Files:**
- Create: `app/api/pipeline/next/route.ts`

- [ ] **Step 1: Écrire la route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { verifyBearer } from "@/lib/adminAuth";
import { claimNextRun } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!verifyBearer(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const run = await claimNextRun();
  return NextResponse.json(run ?? {});
}
```

- [ ] **Step 2: Compilation** — `npx tsc --noEmit` → PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/pipeline/next/route.ts
git commit -m "feat(admin): route next (claim run, VPS)"
```

---

## Task 7: Route report (clôture, Bearer)

**Files:**
- Create: `app/api/pipeline/report/route.ts`

- [ ] **Step 1: Écrire la route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { verifyBearer } from "@/lib/adminAuth";
import { finishRun, recordFinishedRun, type PipelineMode, type PipelineStatus } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!verifyBearer(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  try {
    const body = (await request.json()) as {
      id?: number;
      mode?: string;
      triggered_by?: string;
      status?: string;
      log?: string;
    };
    const status = body.status;
    if (status !== "success" && status !== "error") {
      return NextResponse.json({ error: "status invalide" }, { status: 400 });
    }
    const log = body.log ?? "";

    if (typeof body.id === "number") {
      await finishRun(body.id, status as PipelineStatus, log);
      return NextResponse.json({ ok: true });
    }
    // Pas d'id → run cron direct : mode requis
    if (body.mode !== "jour" && body.mode !== "semaine") {
      return NextResponse.json({ error: "mode requis sans id" }, { status: 400 });
    }
    await recordFinishedRun(
      body.mode as PipelineMode,
      status as PipelineStatus,
      log,
      body.triggered_by ?? "cron"
    );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  }
}
```

- [ ] **Step 2: Compilation** — `npx tsc --noEmit` → PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/pipeline/report/route.ts
git commit -m "feat(admin): route report (clôture run, VPS)"
```

---

## Task 8: Page admin + composants client

**Files:**
- Create: `app/admin/page.tsx`
- Create: `app/admin/LoginForm.tsx`
- Create: `app/admin/AdminDashboard.tsx`

- [ ] **Step 1: Page serveur `app/admin/page.tsx`**

```typescript
import { isAdminRequest } from "@/lib/adminAuth";
import { getRecentRuns } from "@/lib/db";
import LoginForm from "./LoginForm";
import AdminDashboard from "./AdminDashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const authed = await isAdminRequest();
  if (!authed) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="mb-4 text-2xl font-bold">Admin — Pipeline</h1>
        <LoginForm />
      </main>
    );
  }
  const runs = await getRecentRuns();
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-2xl font-bold">Admin — Pipeline</h1>
      <AdminDashboard initialRuns={runs} />
    </main>
  );
}
```

- [ ] **Step 2: `app/admin/LoginForm.tsx`**

```typescript
"use client";
import { useState } from "react";

export default function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/pipeline/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setLoading(false);
    if (res.ok) {
      window.location.reload();
    } else {
      setError("Mot de passe invalide");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Mot de passe"
        className="rounded border px-3 py-2"
        autoFocus
      />
      <button
        type="submit"
        disabled={loading}
        className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
      >
        {loading ? "…" : "Se connecter"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 3: `app/admin/AdminDashboard.tsx`**

```typescript
"use client";
import { useEffect, useState } from "react";
import type { PipelineRun } from "@/lib/db";

const STATUS_STYLE: Record<string, string> = {
  requested: "bg-gray-200 text-gray-800",
  running: "bg-blue-200 text-blue-900",
  success: "bg-green-200 text-green-900",
  error: "bg-red-200 text-red-900",
};

function duration(run: PipelineRun): string {
  if (!run.started_at || !run.finished_at) return "—";
  const ms = new Date(run.finished_at).getTime() - new Date(run.started_at).getTime();
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
}

export default function AdminDashboard({ initialRuns }: { initialRuns: PipelineRun[] }) {
  const [runs, setRuns] = useState(initialRuns);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const active = runs.some((r) => r.status === "requested" || r.status === "running");

  async function refresh() {
    const res = await fetch("/api/pipeline/runs");
    if (res.ok) setRuns((await res.json()).runs);
  }

  useEffect(() => {
    if (!active) return;
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [active]);

  async function trigger(mode: "jour" | "semaine") {
    setBusy(true);
    setMsg("");
    const res = await fetch("/api/pipeline/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    setBusy(false);
    if (res.ok) {
      setMsg(`Relance « ${mode} » demandée.`);
      refresh();
    } else if (res.status === 409) {
      setMsg("Un run est déjà en cours.");
    } else {
      setMsg("Erreur lors de la demande.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3">
        <button
          onClick={() => trigger("jour")}
          disabled={busy || active}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          Relancer (jour)
        </button>
        <button
          onClick={() => trigger("semaine")}
          disabled={busy || active}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          Relancer (semaine)
        </button>
      </div>
      {msg && <p className="text-sm text-gray-600">{msg}</p>}
      {active && <p className="text-sm text-blue-700">Un run est en cours… (rafraîchissement auto)</p>}

      <ul className="flex flex-col gap-2">
        {runs.map((r) => (
          <li key={r.id} className="rounded border">
            <button
              onClick={() => setOpen(open === r.id ? null : r.id)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
            >
              <span className="flex items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status] ?? ""}`}>
                  {r.status}
                </span>
                <span className="font-medium">{r.mode}</span>
                <span className="text-xs text-gray-500">{r.triggered_by}</span>
              </span>
              <span className="text-xs text-gray-500">
                {new Date(r.created_at).toLocaleString("fr-FR")} · {duration(r)}
              </span>
            </button>
            {open === r.id && (
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap border-t bg-gray-50 p-3 text-xs">
                {r.log || "(pas encore de log)"}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Compilation + build** — `npx tsc --noEmit` puis `npm run build` → PASS.

- [ ] **Step 5: Commit**

```bash
git add app/admin/
git commit -m "feat(admin): page /admin (login + dashboard runs)"
```

---

## Task 9: Poller VPS + report du run cron 7h30

**Files:**
- Create: `plats-du-jour/poll_runs.sh`
- Modify: `plats-du-jour/cron_pdj.sh`

- [ ] **Step 1: Écrire `plats-du-jour/poll_runs.sh`**

```bash
#!/bin/bash
# Poller : récupère un run 'requested' via l'API, lance le pipeline, renvoie le log.
# À lancer par cron chaque minute sur le VPS.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
set -a; source .env; set +a   # API_SECRET_TOKEN, VERCEL_API_URL

# Un seul poller à la fois
exec 9>/tmp/pdj_poll.lock
flock -n 9 || exit 0

resp=$(curl -sf -H "Authorization: Bearer $API_SECRET_TOKEN" \
  "$VERCEL_API_URL/api/pipeline/next" || echo '{}')
id=$(echo "$resp" | jq -r '.id // empty')
mode=$(echo "$resp" | jq -r '.mode // empty')
[ -z "$id" ] && exit 0

echo "$(date '+%Y-%m-%d %H:%M') [poll] run #$id mode=$mode"
if log=$(docker compose run --rm plats-du-jour "$mode" 2>&1); then
  status=success
else
  status=error
fi

jq -n --argjson id "$id" --arg s "$status" --arg l "$log" \
  '{id:$id, status:$s, log:$l}' \
| curl -sf -X POST \
    -H "Authorization: Bearer $API_SECRET_TOKEN" \
    -H 'Content-Type: application/json' -d @- \
    "$VERCEL_API_URL/api/pipeline/report" > /dev/null
```

- [ ] **Step 2: Rendre exécutable**

Run: `chmod +x plats-du-jour/poll_runs.sh`

- [ ] **Step 3: Vérifier la syntaxe bash**

Run: `bash -n plats-du-jour/poll_runs.sh`
Expected: aucune sortie (syntaxe OK).

- [ ] **Step 4: Modifier `plats-du-jour/cron_pdj.sh` pour reporter le run 7h30**

Remplace le bloc "Pipeline" existant par une version qui capture la sortie et la POSTe. Le fichier devient :

```bash
#!/bin/bash
# Script cron pour le pipeline PDJ + déploiement site
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Charger l'environnement
source .venv/bin/activate
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
set -a; source .env; set +a   # API_SECRET_TOKEN, VERCEL_API_URL

MODE="${1:-jour}"
echo "$(date '+%Y-%m-%d %H:%M') [cron] Lancement pipeline mode=$MODE"

# Capture combinée pour report vers l'API
LOGFILE="$(mktemp)"
status=success
{
  python3 main.py check-portions
  python3 main.py "$MODE"
} >> "$LOGFILE" 2>&1 || status=error

# Conserver aussi le log local existant
cat "$LOGFILE" >> output/cron.log

# Report vers l'API (best-effort ; n'échoue pas le cron)
if [ -n "${VERCEL_API_URL:-}" ] && [ -n "${API_SECRET_TOKEN:-}" ]; then
  jq -n --arg mode "$MODE" --arg s "$status" --rawfile l "$LOGFILE" \
    '{mode:$mode, triggered_by:"cron", status:$s, log:$l}' \
  | curl -sf -X POST \
      -H "Authorization: Bearer $API_SECRET_TOKEN" \
      -H 'Content-Type: application/json' -d @- \
      "$VERCEL_API_URL/api/pipeline/report" > /dev/null || true
fi
rm -f "$LOGFILE"

echo "$(date '+%Y-%m-%d %H:%M') [cron] Terminé"
```

- [ ] **Step 5: Vérifier la syntaxe bash**

Run: `bash -n plats-du-jour/cron_pdj.sh`
Expected: aucune sortie.

- [ ] **Step 6: Commit**

```bash
git add plats-du-jour/poll_runs.sh plats-du-jour/cron_pdj.sh
git commit -m "feat(admin): poller VPS + report du run cron"
```

---

## Task 10: Documentation déploiement

**Files:**
- Modify: `plats-du-jour/.env.example` (si présent) ou créer une note
- Create: `docs/superpowers/plans/DEPLOY-admin-logs.md`

- [ ] **Step 1: Écrire la note de déploiement**

Créer `docs/superpowers/plans/DEPLOY-admin-logs.md` :

```markdown
# Déploiement — page admin logs/relance

## Vercel
- Ajouter la variable d'env `ADMIN_PASSWORD` (mot de passe de la page /admin).
- `API_SECRET_TOKEN` déjà présent (réutilisé pour /next et /report).
- Déployer normalement (la table `pipeline_runs` se crée toute seule au 1er accès).

## VPS (/opt/pdj)
1. `rsync` le repo (poll_runs.sh + cron_pdj.sh mis à jour).
2. Vérifier que `jq` et `flock` (util-linux) sont installés : `which jq flock`.
   Sinon `apt-get install -y jq util-linux`.
3. Vérifier `.env` : `API_SECRET_TOKEN` et `VERCEL_API_URL` présents.
4. Ajouter au crontab la ligne du poller (chaque minute) :
   `* * * * * /opt/pdj/poll_runs.sh >> /opt/pdj/output/poll.log 2>&1`
5. Le cron 7h30 existant (cron_pdj.sh) reporte désormais automatiquement.

## Vérif
- Ouvrir https://<site>/admin, se connecter, cliquer « Relancer (jour) ».
- Dans la minute, le run passe requested → running → success/error avec le log.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/DEPLOY-admin-logs.md
git commit -m "docs(admin): note de déploiement logs/relance"
```

---

## Notes de vérification finale

- `npm run build` passe sans erreur.
- Les routes Bearer (`/next`, `/report`) refusent sans token (401).
- Les routes cookie (`/trigger`, `/runs`) refusent sans cookie (401).
- `/trigger` renvoie 409 si un run est déjà actif.
- Le poller et cron_pdj sont `bash -n` clean.
- Déploiement VPS = manuel (rsync + crontab), documenté dans DEPLOY-admin-logs.md.
