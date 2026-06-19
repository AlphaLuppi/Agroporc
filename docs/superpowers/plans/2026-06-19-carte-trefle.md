# Carte permanente du Bistrot Trèfle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scraper toute la carte permanente du Bistrot Trèfle, la noter une seule fois (Sportif/Goulaf + macros) tant qu'elle ne change pas (détection par hash), et l'afficher dans un bloc repliable sur la home.

**Architecture:** Le scraper ajoute `scrape_carte()` qui renvoie les sections plats salés + desserts dédupliquées + un hash SHA-1 déterministe. La pipeline `semaine` compare ce hash à celui stocké via une nouvelle route `/api/carte` ; si différent, elle ré-évalue (`diet_agent.evaluate_carte`) et publie dans une nouvelle table `pdj_carte`. La home lit la carte en SSR et l'affiche dans un bloc client repliable réutilisant les classes `mode-sportif`/`mode-goulaf` existantes.

**Tech Stack:** Python (urllib, hashlib, pytest), Next.js 15 / React 19 / TypeScript, Vercel Postgres (`@vercel/postgres`).

---

## File Structure

- **Modify** `lib/db.ts` — types `CartePlat`/`CarteSection`/`Carte`, table `pdj_carte`, `ensureCarteTable`/`getCarte`/`upsertCarte`.
- **Create** `app/api/carte/route.ts` — `GET` public (lecture + hash), `POST` protégé (upsert).
- **Modify** `plats-du-jour/scrapers/bistrot_trefle.py` — helper `_fetch_outlet_data()`, `scrape_carte()` + helpers de hash/dédup.
- **Modify** `plats-du-jour/agent/diet_agent.py` — `evaluate_carte()` + `_rebuild_carte_sections()`.
- **Modify** `plats-du-jour/publish.py` — `publish_carte()`, `fetch_carte_hash()`.
- **Modify** `plats-du-jour/main.py` — `_traiter_carte()` appelé dans `run_semaine`.
- **Create** `app/CarteTrefle.tsx` — bloc client repliable.
- **Modify** `app/page.tsx` — lecture `getCarte` en SSR + rendu `<CarteTrefle>`.
- **Create** `plats-du-jour/tests/test_carte.py` — tests unitaires scraper + reconstruction sections.

---

## Task 1: Couche base de données (`lib/db.ts`)

**Files:**
- Modify: `lib/db.ts` (ajouter après l'interface `Recommandation`, vers la ligne 58)

- [ ] **Step 1: Ajouter les types Carte**

Insérer après l'interface `Recommandation` (ligne 58) dans `lib/db.ts` :

```ts
// --- Carte permanente (notée une fois, ré-évaluée par hash) ---

export interface CartePlat {
  plat: string;
  prix: string;
  note?: number;
  justification?: string;
  note_goulaf?: number;
  justification_goulaf?: string;
  nutrition_estimee?: {
    calories: number;
    proteines_g: number;
    glucides_g: number;
    lipides_g: number;
  };
  nutrition_source?: "ciqual" | "llm";
  ingredients_detail?: IngredientDetail[];
}

export interface CarteSection {
  nom: string;
  plats: CartePlat[];
}

export interface Carte {
  restaurant_slug: string;
  hash: string;
  restaurant?: string;
  sections: CarteSection[];
  evaluated_at?: string;
}
```

- [ ] **Step 2: Ajouter table + accesseurs**

Ajouter à la fin de `lib/db.ts` :

```ts
/** Crée la table de la carte si elle n'existe pas */
export async function ensureCarteTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS pdj_carte (
      restaurant_slug VARCHAR(50) PRIMARY KEY,
      hash TEXT NOT NULL,
      data JSONB NOT NULL,
      evaluated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

/** Récupère la carte stockée pour un restaurant (ou null) */
export async function getCarte(slug: string): Promise<Carte | null> {
  await ensureCarteTable();
  const result = await sql`
    SELECT data, hash, evaluated_at FROM pdj_carte WHERE restaurant_slug = ${slug} LIMIT 1
  `;
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    ...(r.data as Carte),
    hash: r.hash,
    evaluated_at: r.evaluated_at,
  };
}

/** Insère ou met à jour la carte d'un restaurant */
export async function upsertCarte(carte: Carte): Promise<void> {
  await ensureCarteTable();
  await sql`
    INSERT INTO pdj_carte (restaurant_slug, hash, data, evaluated_at)
    VALUES (${carte.restaurant_slug}, ${carte.hash}, ${JSON.stringify(carte)}, NOW())
    ON CONFLICT (restaurant_slug)
    DO UPDATE SET hash = ${carte.hash}, data = ${JSON.stringify(carte)}, evaluated_at = NOW()
  `;
}
```

- [ ] **Step 3: Vérifier le typecheck**

Run: `cd "/Users/toam/Documents/PDJ Master" && npx tsc --noEmit`
Expected: aucune erreur (exit 0).

- [ ] **Step 4: Commit**

```bash
cd "/Users/toam/Documents/PDJ Master"
git add lib/db.ts
git commit -m "feat(db): table pdj_carte + types Carte"
```

---

## Task 2: Route API `/api/carte`

**Files:**
- Create: `app/api/carte/route.ts`

- [ ] **Step 1: Créer la route**

Créer `app/api/carte/route.ts` (calquée sur `app/api/update/route.ts`) :

```ts
import { NextRequest, NextResponse } from "next/server";
import { ensureCarteTable, getCarte, upsertCarte } from "@/lib/db";
import type { Carte } from "@/lib/db";

export const runtime = "nodejs";

/** Lecture publique de la carte (sert le rendu home + la comparaison de hash côté pipeline) */
export async function GET() {
  await ensureCarteTable();
  const carte = await getCarte("bistrot_trefle");
  return NextResponse.json(carte);
}

/** Upsert protégé par token (depuis le pipeline) */
export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const token = process.env.API_SECRET_TOKEN;
  if (!token || auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as Carte;

    if (!body.restaurant_slug || !body.hash) {
      return NextResponse.json(
        { error: "Champs 'restaurant_slug' et 'hash' requis" },
        { status: 400 }
      );
    }

    await ensureCarteTable();
    await upsertCarte(body);

    return NextResponse.json({ ok: true, hash: body.hash });
  } catch (e) {
    console.error("[api/carte] Erreur:", e);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Vérifier le typecheck**

Run: `cd "/Users/toam/Documents/PDJ Master" && npx tsc --noEmit`
Expected: aucune erreur (exit 0).

- [ ] **Step 3: Commit**

```bash
cd "/Users/toam/Documents/PDJ Master"
git add app/api/carte/route.ts
git commit -m "feat(api): route /api/carte (GET public, POST protégé)"
```

---

## Task 3: Scraper `scrape_carte()`

**Files:**
- Modify: `plats-du-jour/scrapers/bistrot_trefle.py`
- Test: `plats-du-jour/tests/test_carte.py`

- [ ] **Step 1: Installer pytest dans le venv**

Run:
```bash
cd "/Users/toam/Documents/PDJ Master/plats-du-jour" && source .venv/bin/activate && pip install pytest
```
Expected: `Successfully installed pytest-...`

- [ ] **Step 2: Écrire le test du scraper (échoue)**

Créer `plats-du-jour/tests/test_carte.py` :

```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scrapers import bistrot_trefle


def _sample_outlet():
    """Réponse API Obypay minimale : sections allowlist + sections exclues + doublons."""
    def prod(name, price, sec_id, sec_name):
        return {"name": name, "price": price, "section": {"id": sec_id, "name": sec_name}}

    return {
        "products": [
            prod("FISH AND CHIPS", 16, "E9", "PLATS"),
            prod("fish and chips", 16, "X1", "PLATS"),          # doublon (casse/section)
            prod("LINGUINE AU PESTO VERT", 14, "rv", "PÂTES"),
            prod("TIRAMISU À LA FRAMBOISE", 7, "z1", "DESSERTS"),
            prod("TIRAMISU À LA FRAMBOISE", 7, "z2", "DESSERTS"),  # doublon (2 sections desserts)
            prod("COCA-COLA 33cl", 3, "jj", "BOISSONS"),         # exclu
            prod("MENU À 24,90", 24, "mm", "Menus"),             # exclu
        ]
    }


def test_scrape_carte_filtre_et_dedup(monkeypatch):
    monkeypatch.setattr(bistrot_trefle, "_fetch_outlet_data", lambda: _sample_outlet())
    carte = bistrot_trefle.scrape_carte()

    assert carte is not None
    assert carte["restaurant"] == "Le Bistrot Trèfle"
    noms = [s["nom"] for s in carte["sections"]]
    # Seules les sections allowlist, dans l'ordre canonique (PLATS, PÂTES, DESSERTS)
    assert noms == ["PLATS", "PÂTES", "DESSERTS"]

    plats_par_section = {s["nom"]: [p["plat"] for p in s["plats"]] for s in carte["sections"]}
    assert plats_par_section["PLATS"] == ["FISH AND CHIPS"]            # doublon retiré
    assert plats_par_section["DESSERTS"] == ["TIRAMISU À LA FRAMBOISE"]  # doublon inter-sections retiré
    assert "BOISSONS" not in noms and "Menus" not in noms

    plat = carte["sections"][0]["plats"][0]
    assert plat["prix"] == "16€"


def test_scrape_carte_hash_stable_selon_ordre(monkeypatch):
    sample = _sample_outlet()
    monkeypatch.setattr(bistrot_trefle, "_fetch_outlet_data", lambda: sample)
    h1 = bistrot_trefle.scrape_carte()["hash"]

    shuffled = {"products": list(reversed(sample["products"]))}
    monkeypatch.setattr(bistrot_trefle, "_fetch_outlet_data", lambda: shuffled)
    h2 = bistrot_trefle.scrape_carte()["hash"]

    assert h1 == h2 and len(h1) == 40  # SHA-1 hex


def test_scrape_carte_none_si_api_ko(monkeypatch):
    monkeypatch.setattr(bistrot_trefle, "_fetch_outlet_data", lambda: None)
    assert bistrot_trefle.scrape_carte() is None
```

- [ ] **Step 3: Lancer le test (doit échouer)**

Run: `cd "/Users/toam/Documents/PDJ Master/plats-du-jour" && source .venv/bin/activate && python -m pytest tests/test_carte.py -v`
Expected: FAIL — `AttributeError: module 'scrapers.bistrot_trefle' has no attribute '_fetch_outlet_data'` / `scrape_carte`.

- [ ] **Step 4: Refactor du téléchargement API**

Dans `plats-du-jour/scrapers/bistrot_trefle.py`, ajouter `import hashlib` en haut (après `import json`), puis ajouter ce helper avant `scrape()` :

```python
def _fetch_outlet_data() -> dict | None:
    """Télécharge la réponse brute de l'API Obypay (ou None si échec)."""
    try:
        req = urllib.request.Request(API_URL, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"[bistrot_trefle] Erreur API : {e}")
        return None
```

Remplacer le bloc try/except de `scrape()` (lignes 22-28) par :

```python
    data = _fetch_outlet_data()
    if data is None:
        return None
```

Remplacer le bloc try/except de `scrape_semaine()` (lignes 66-72) par :

```python
    data = _fetch_outlet_data()
    if data is None:
        return None
```

- [ ] **Step 5: Implémenter `scrape_carte()` et ses helpers**

Ajouter à la fin de `plats-du-jour/scrapers/bistrot_trefle.py` :

```python
# ── Carte permanente ────────────────────────────────────────────────────────

CARTE_SECTIONS = ["PLATS", "SALADES ET POKE BOWLS", "PÂTES", "POISSONS", "CLUBS SANDWICH", "DESSERTS"]


def _normalize(s: str) -> str:
    return " ".join((s or "").split()).upper()


_CARTE_SECTION_SET = {_normalize(s) for s in CARTE_SECTIONS}


def scrape_carte() -> dict | None:
    """
    Récupère la carte permanente (plats salés + desserts).
    Retourne { "restaurant": str, "hash": str, "sections": [ {nom, plats:[{plat,prix}]} ] }
    ou None si échec / carte vide.
    """
    data = _fetch_outlet_data()
    if data is None:
        return None

    by_section = _extract_carte_products(data)
    sections = []
    for nom in CARTE_SECTIONS:
        prods = by_section.get(nom)
        if not prods:
            continue
        seen = set()
        plats = []
        for p in prods:
            name = (p.get("name") or "").strip()
            key = _normalize(name)
            if not name or key in seen:
                continue
            seen.add(key)
            prix = p.get("price")
            plats.append({"plat": name, "prix": f"{prix}€" if prix is not None else "N/A"})
        if plats:
            sections.append({"nom": nom, "plats": plats})

    if not sections:
        print("[bistrot_trefle] Carte vide")
        return None

    return {
        "restaurant": "Le Bistrot Trèfle",
        "hash": _carte_hash(sections),
        "sections": sections,
    }


def _carte_hash(sections: list[dict]) -> str:
    """SHA-1 déterministe du contenu (insensible à l'ordre renvoyé par l'API)."""
    parts = [
        f"{sec['nom']}|{_normalize(p['plat'])}|{p['prix']}"
        for sec in sections for p in sec["plats"]
    ]
    parts.sort()
    return hashlib.sha1("\n".join(parts).encode("utf-8")).hexdigest()


def _extract_carte_products(data: dict) -> dict[str, list[dict]]:
    """Regroupe les produits par nom de section canonique (allowlist uniquement)."""
    results: dict[str, list[dict]] = {}

    def rec(obj):
        if isinstance(obj, dict):
            section = obj.get("section")
            if (obj.get("name") and obj.get("price") is not None
                    and isinstance(section, dict)
                    and _normalize(section.get("name")) in _CARTE_SECTION_SET):
                results.setdefault(_normalize(section.get("name")), []).append(obj)
                return
            for v in obj.values():
                rec(v)
        elif isinstance(obj, list):
            for item in obj:
                rec(item)

    rec(data)
    return {nom: results[_normalize(nom)] for nom in CARTE_SECTIONS if _normalize(nom) in results}
```

- [ ] **Step 6: Lancer les tests (doivent passer)**

Run: `cd "/Users/toam/Documents/PDJ Master/plats-du-jour" && source .venv/bin/activate && python -m pytest tests/test_carte.py -v`
Expected: 3 tests PASS (les `_rebuild` viendront en Task 4).

- [ ] **Step 7: Vérifier la non-régression de `scrape()`/`scrape_semaine()`**

Run: `cd "/Users/toam/Documents/PDJ Master/plats-du-jour" && source .venv/bin/activate && python -c "from scrapers import bistrot_trefle; print(bool(bistrot_trefle.scrape_semaine()))"`
Expected: `True` (appel réseau réel ; si pas de réseau, vérifier au moins l'absence d'`ImportError`/`SyntaxError`).

- [ ] **Step 8: Commit**

```bash
cd "/Users/toam/Documents/PDJ Master"
git add plats-du-jour/scrapers/bistrot_trefle.py plats-du-jour/tests/test_carte.py
git commit -m "feat(scraper): scrape_carte() du Trèfle (sections plats+desserts, dédup, hash)"
```

---

## Task 4: Évaluation `diet_agent.evaluate_carte()`

**Files:**
- Modify: `plats-du-jour/agent/diet_agent.py`
- Test: `plats-du-jour/tests/test_carte.py` (ajout)

- [ ] **Step 1: Écrire le test de reconstruction (échoue)**

Ajouter à la fin de `plats-du-jour/tests/test_carte.py` :

```python
from agent import diet_agent


def test_rebuild_carte_sections_merge_par_nom():
    sections = [
        {"nom": "PLATS", "plats": [
            {"plat": "FISH AND CHIPS", "prix": "16€"},
            {"plat": "SALADE CAESAR", "prix": "13€"},
        ]},
    ]
    evaluated = [
        {"plat": "fish and chips", "note": 5, "note_goulaf": 8,
         "justification": "frit", "justification_goulaf": "régal",
         "nutrition_estimee": {"calories": 800, "proteines_g": 30, "glucides_g": 70, "lipides_g": 40},
         "nutrition_source": "ciqual"},
        # SALADE CAESAR absente de l'éval → conservée sans note
    ]
    out = diet_agent._rebuild_carte_sections(sections, evaluated)

    fish = out[0]["plats"][0]
    assert fish["note"] == 5 and fish["note_goulaf"] == 8
    assert fish["prix"] == "16€"  # prix d'origine préservé
    assert fish["nutrition_source"] == "ciqual"

    salade = out[0]["plats"][1]
    assert salade["plat"] == "SALADE CAESAR"
    assert "note" not in salade  # pas d'éval → pas de note inventée


def test_evaluate_carte_sans_recommandation(monkeypatch):
    sections = [{"nom": "PLATS", "plats": [{"plat": "FISH AND CHIPS", "prix": "16€"}]}]

    fake_raw = '{"plats": [{"restaurant": "Le Bistrot Trèfle", "plat": "FISH AND CHIPS", "prix": "16€", "note": 4, "note_goulaf": 9, "justification": "x", "justification_goulaf": "y"}]}'
    monkeypatch.setattr(diet_agent, "_call_claude", lambda prompt, timeout=180: fake_raw)
    monkeypatch.setattr(diet_agent, "_apply_ciqual", lambda result: result)  # bypass appel Ciqual/Claude

    out = diet_agent.evaluate_carte(sections)
    assert isinstance(out, list)
    plat = out[0]["plats"][0]
    assert plat["note"] == 4 and plat["note_goulaf"] == 9
```

- [ ] **Step 2: Lancer le test (doit échouer)**

Run: `cd "/Users/toam/Documents/PDJ Master/plats-du-jour" && source .venv/bin/activate && python -m pytest tests/test_carte.py -v -k carte`
Expected: FAIL — `module 'agent.diet_agent' has no attribute '_rebuild_carte_sections'`.

- [ ] **Step 3: Implémenter `evaluate_carte` et `_rebuild_carte_sections`**

Ajouter dans `plats-du-jour/agent/diet_agent.py`, juste après la fonction `evaluate` (vers la ligne 435) :

```python
def _norm_plat(s: str) -> str:
    return " ".join((s or "").split()).upper()


def _rebuild_carte_sections(sections: list[dict], evaluated: list[dict]) -> list[dict]:
    """Réinjecte les plats notés dans leurs sections d'origine (matching par nom)."""
    by_name = {_norm_plat(p.get("plat", "")): p for p in evaluated}
    enrich_keys = ("note", "justification", "note_goulaf", "justification_goulaf",
                   "nutrition_estimee", "nutrition_source", "ingredients_detail")
    out = []
    for sec in sections:
        plats = []
        for p in sec["plats"]:
            merged = dict(p)
            ev = by_name.get(_norm_plat(p["plat"]))
            if ev:
                for k in enrich_keys:
                    if ev.get(k) is not None:
                        merged[k] = ev[k]
            plats.append(merged)
        out.append({"nom": sec["nom"], "plats": plats})
    return out


def evaluate_carte(sections: list[dict]) -> list[dict]:
    """
    Note tous les plats de la carte (Sportif + Goulaf + macros), SANS recommandation.
    Retourne les sections enrichies.
    """
    plats = [
        {"restaurant": "Le Bistrot Trèfle", "plat": p["plat"], "prix": p["prix"]}
        for sec in sections for p in sec["plats"]
    ]
    if not plats:
        return sections

    calibration = _build_portion_calibration({"Le Bistrot Trèfle"})
    prompt = (
        f"{_build_system_prompt()}{calibration}\n\n"
        f"Voici la carte permanente d'un restaurant :\n\n"
        f"{json.dumps(plats, ensure_ascii=False, indent=2)}\n\n"
        f"Note CHAQUE plat (Sportif ET Goulaf). NE DONNE PAS de recommandation.\n\n"
        f"Réponds en JSON avec cette structure :\n"
        f'{{ "plats": [{{"restaurant": "...", "plat": "...", "prix": "...", "ingredients": [...], '
        f'"nutrition_estimee_llm": {{...}}, "note": 0, "justification": "...", '
        f'"note_goulaf": 0, "justification_goulaf": "..."}}] }}'
    )

    raw = _call_claude(prompt, timeout=300)
    result = _apply_ciqual(json.loads(_strip_code_fence(raw)))
    return _rebuild_carte_sections(sections, result.get("plats", []))
```

- [ ] **Step 4: Lancer les tests (doivent passer)**

Run: `cd "/Users/toam/Documents/PDJ Master/plats-du-jour" && source .venv/bin/activate && python -m pytest tests/test_carte.py -v`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd "/Users/toam/Documents/PDJ Master"
git add plats-du-jour/agent/diet_agent.py plats-du-jour/tests/test_carte.py
git commit -m "feat(agent): evaluate_carte() — notation de la carte sans recommandation"
```

---

## Task 5: Publication (`publish.py`)

**Files:**
- Modify: `plats-du-jour/publish.py`

- [ ] **Step 1: Ajouter `publish_carte` et `fetch_carte_hash`**

Ajouter dans `plats-du-jour/publish.py`, après `publish_pdj` (vers la ligne 48) :

```python
def publish_carte(data: dict) -> bool:
    """Envoie la carte évaluée vers l'API Vercel (POST /api/carte)."""
    if not API_URL or not API_TOKEN:
        print("[publish] VERCEL_API_URL ou API_SECRET_TOKEN non configuré")
        return False

    url = f"{API_URL}/api/carte"
    headers = {
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.post(url, json=data, headers=headers, timeout=60)
        if resp.ok:
            print(f"[publish] OK — carte publiée ({data.get('hash', '?')[:8]})")
            return True
        print(f"[publish] Erreur carte {resp.status_code}: {resp.text}")
        return False
    except Exception as e:
        print(f"[publish] Erreur réseau carte: {e}")
        return False


def fetch_carte_hash() -> str | None:
    """Récupère le hash de la carte actuellement stockée (GET /api/carte), ou None."""
    if not API_URL:
        return None
    url = f"{API_URL}/api/carte"
    try:
        resp = requests.get(url, timeout=30)
        if not resp.ok:
            return None
        data = resp.json()
        return data.get("hash") if isinstance(data, dict) else None
    except Exception as e:
        print(f"[publish] Erreur lecture hash carte: {e}")
        return None
```

- [ ] **Step 2: Vérifier l'import**

Run: `cd "/Users/toam/Documents/PDJ Master/plats-du-jour" && source .venv/bin/activate && python -c "import publish; print(callable(publish.publish_carte), callable(publish.fetch_carte_hash))"`
Expected: `True True`

- [ ] **Step 3: Commit**

```bash
cd "/Users/toam/Documents/PDJ Master"
git add plats-du-jour/publish.py
git commit -m "feat(publish): publish_carte + fetch_carte_hash"
```

---

## Task 6: Intégration pipeline (`main.py`)

**Files:**
- Modify: `plats-du-jour/main.py` (import ligne 28, `run_semaine` vers ligne 388)

- [ ] **Step 1: Étendre l'import publish**

Dans `plats-du-jour/main.py`, remplacer la ligne 28 :

```python
from publish import publish_pdj
```

par :

```python
from publish import publish_pdj, publish_carte, fetch_carte_hash
```

- [ ] **Step 2: Ajouter le helper `_traiter_carte`**

Ajouter dans `plats-du-jour/main.py`, dans la section « Utilitaires communs » (avant `_evaluer_et_sauver`, vers la ligne 402) :

```python
async def _traiter_carte(loop) -> None:
    """Scrape la carte du Trèfle ; ré-évalue et publie uniquement si elle a changé (hash)."""
    try:
        carte = await loop.run_in_executor(None, bistrot_trefle.scrape_carte)
    except Exception as e:
        print(f"[pipeline:carte] Erreur scrape carte : {e}")
        return
    if not carte:
        print("[pipeline:carte] Carte non récupérée, skip")
        return

    stored_hash = fetch_carte_hash()
    if stored_hash and stored_hash == carte["hash"]:
        print("[pipeline:carte] Carte inchangée, évaluation réutilisée")
        return

    print("[pipeline:carte] Carte modifiée → ré-évaluation...")
    try:
        sections = await loop.run_in_executor(None, diet_agent.evaluate_carte, carte["sections"])
    except Exception as e:
        print(f"[pipeline:carte] Erreur évaluation carte (non publiée) : {e}")
        return

    payload = {
        "restaurant_slug": "bistrot_trefle",
        "restaurant": carte["restaurant"],
        "hash": carte["hash"],
        "sections": sections,
    }
    publish_carte(payload)
```

- [ ] **Step 3: Appeler `_traiter_carte` dans `run_semaine`**

Dans `plats-du-jour/main.py`, dans `run_semaine`, juste après la ligne `publish_pdj(output)` (vers la ligne 389, le `publish_pdj` final avant le bloc « Évaluation des idées »), ajouter :

```python
    # ── Carte permanente du Trèfle (ré-évaluée seulement si elle a changé) ──
    try:
        await _traiter_carte(loop)
    except Exception as e:
        print(f"[pipeline:semaine] Erreur traitement carte : {e}")
```

- [ ] **Step 4: Vérifier l'import du module**

Run: `cd "/Users/toam/Documents/PDJ Master/plats-du-jour" && source .venv/bin/activate && python -c "import main; print('ok')"`
Expected: `ok` (pas d'`ImportError`/`SyntaxError`).

- [ ] **Step 5: Commit**

```bash
cd "/Users/toam/Documents/PDJ Master"
git add plats-du-jour/main.py
git commit -m "feat(pipeline): traitement carte du Trèfle dans run_semaine"
```

---

## Task 7: Frontend — bloc « La carte du Trèfle »

**Files:**
- Create: `app/CarteTrefle.tsx`
- Modify: `app/page.tsx`

> **Note technique :** le contenu de la carte est rendu **en permanence** dans le DOM et masqué via l'attribut `hidden` sur le conteneur (et non démonté conditionnellement). Raison : le script global de bascule Sportif/Goulaf (`app/components/ClientScripts.tsx`, lignes ~608-611) parcourt tous les `.mode-sportif`/`.mode-goulaf` au chargement et à chaque clic. Si la carte était démontée, ses notes auraient une visibilité incorrecte après un changement de mode suivi d'un dépliage. Toujours présente dans le DOM, elle reste synchronisée.

- [ ] **Step 1: Créer le composant `CarteTrefle.tsx`**

Créer `app/CarteTrefle.tsx` :

```tsx
"use client";

import { useState } from "react";
import type { Carte, CartePlat } from "@/lib/db";
import { noteClass } from "@/lib/format";
import { getIcon } from "@/lib/icons";
import { Card, CardContent } from "@/components/ui/card";
import MacrosPanel from "./MacrosPanel";

function CartePlatCard({ plat }: { plat: CartePlat }) {
  const note = plat.note ?? "?";
  const noteG = plat.note_goulaf ?? note;
  const noteCls = noteClass(note);
  const noteGCls = noteClass(noteG);

  return (
    <Card className="plat-card bg-[var(--surface)] border-[var(--border)] mb-3 relative overflow-hidden" style={{ backgroundImage: "var(--card-stripe)" }}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex justify-between items-center mb-2 gap-2">
          <span className="text-base font-semibold leading-snug" style={{ fontFamily: "var(--font-heading)" }}>
            {plat.plat}
          </span>
          <span className={`note note-${noteCls} mode-sportif shrink-0`} data-note={note}>
            {note}<span className="note-max">/10</span>
          </span>
          <span className={`note note-${noteGCls} mode-goulaf shrink-0`} data-note={noteG} style={{ display: "none" }}>
            {noteG}<span className="note-max">/10</span>
          </span>
        </div>

        <div className="text-[var(--accent)] font-bold mb-3">{plat.prix}</div>

        <MacrosPanel
          nutri={plat.nutrition_estimee}
          ingredients={plat.ingredients_detail}
          source={plat.nutrition_source}
        />

        {plat.justification && (
          <p className="mode-sportif text-sm text-[var(--text-secondary)] leading-relaxed">{plat.justification}</p>
        )}
        {(plat.justification_goulaf || plat.justification) && (
          <p className="mode-goulaf text-sm text-[var(--text-secondary)] leading-relaxed" style={{ display: "none" }}>
            {plat.justification_goulaf || plat.justification}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function CarteTrefle({ carte }: { carte: Carte }) {
  const [open, setOpen] = useState(false);
  const evalDate = carte.evaluated_at
    ? new Date(carte.evaluated_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <div className="mt-8 sm:mt-10">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] text-left hover:border-[var(--border-accent)] transition-colors"
      >
        <span className="flex items-center gap-2 font-semibold" style={{ fontFamily: "var(--font-heading)" }}>
          <span dangerouslySetInnerHTML={{ __html: getIcon("Le Bistrot Trèfle") }} />
          La carte du Trèfle
        </span>
        <span className="flex items-center gap-2 text-[var(--text-muted)] text-xs">
          {evalDate && <span className="hidden sm:inline">notée le {evalDate}</span>}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 transition-transform" style={{ transform: open ? "rotate(180deg)" : "none" }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      <div hidden={!open} className="mt-4">
        {carte.sections.map((sec) => (
          <section key={sec.nom} className="mb-6">
            <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)] mb-3">{sec.nom}</h3>
            {sec.plats.map((p, i) => (
              <CartePlatCard key={`${sec.nom}-${i}`} plat={p} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Brancher la carte dans `app/page.tsx`**

Dans `app/page.tsx`, ajouter aux imports (après la ligne 8) :

```tsx
import { getCarte } from "@/lib/db";
import type { Carte } from "@/lib/db";
import CarteTrefle from "./CarteTrefle";
```

Remplacer le corps de `Home` (lignes 13-28) par (ajout du fetch carte + passage en prop) :

```tsx
  await ensureTable();
  const params = await searchParams;
  const monday = resolveMonday(params.semaine);
  const mondayStr = monday.toLocaleDateString("en-CA");
  const weekPdj = await getWeekPdj(mondayStr);
  const carte = await getCarte("bistrot_trefle");
  const fullWeek = buildFullWeek(weekPdj, monday);
  const prev = new Date(monday); prev.setDate(monday.getDate() - 7);
  const next = new Date(monday); next.setDate(monday.getDate() + 7);
  return (
    <WeekView
      weekPdj={fullWeek}
      carte={carte}
      prevHref={`/?semaine=${prev.toLocaleDateString("en-CA")}`}
      nextHref={`/?semaine=${next.toLocaleDateString("en-CA")}`}
      currentMonday={mondayStr}
    />
  );
```

Modifier la signature de `WeekView` (ligne 77) pour accepter `carte` :

```tsx
function WeekView({ weekPdj, carte, prevHref, nextHref, currentMonday }: { weekPdj: PdjEntry[]; carte: Carte | null; prevHref: string; nextHref: string; currentMonday: string }) {
```

Dans le `return` de `WeekView`, juste après la boucle `weekPdj.map(... <DayPanel ... />)` et avant le `</>` de fermeture (lignes 147-150), ajouter :

```tsx
      {carte && <CarteTrefle carte={carte} />}
```

- [ ] **Step 3: Vérifier le typecheck**

Run: `cd "/Users/toam/Documents/PDJ Master" && npx tsc --noEmit`
Expected: aucune erreur (exit 0).

- [ ] **Step 4: Vérifier le build**

Run: `cd "/Users/toam/Documents/PDJ Master" && npm run build`
Expected: build réussi, route `/api/carte` listée dans la sortie.

- [ ] **Step 5: Commit**

```bash
cd "/Users/toam/Documents/PDJ Master"
git add app/CarteTrefle.tsx app/page.tsx
git commit -m "feat(front): bloc repliable 'La carte du Trèfle' sur la home"
```

---

## Task 8: Vérification de bout en bout

**Files:** aucun (vérification manuelle)

- [ ] **Step 1: Suite de tests Python complète**

Run: `cd "/Users/toam/Documents/PDJ Master/plats-du-jour" && source .venv/bin/activate && python -m pytest tests/ -v`
Expected: tous les tests PASS (5 tests carte).

- [ ] **Step 2: Test manuel du flux carte (réseau requis)**

Run: `cd "/Users/toam/Documents/PDJ Master/plats-du-jour" && source .venv/bin/activate && python -c "from scrapers import bistrot_trefle; c = bistrot_trefle.scrape_carte(); print(c['hash']); [print(s['nom'], len(s['plats'])) for s in c['sections']]"`
Expected: un hash + les sections (PLATS, SALADES ET POKE BOWLS, PÂTES, POISSONS, CLUBS SANDWICH, DESSERTS) avec leurs comptes — confirme l'allowlist sur les vraies données.

- [ ] **Step 3: Vérifier visuellement (optionnel, si DB locale configurée)**

Run: `cd "/Users/toam/Documents/PDJ Master" && npm run dev`
Vérifier sur `http://localhost:3000` : le bloc « La carte du Trèfle » apparaît sous la vue du jour, replié par défaut ; au dépliage, les sections s'affichent ; la bascule Sportif/Goulaf change bien les notes du bloc.
(Le bloc n'apparaît que si la table `pdj_carte` contient une ligne — sinon c'est attendu qu'il soit absent tant que la pipeline `semaine` n'a pas tourné.)

---

## Notes d'implémentation

- **Aucune migration manuelle** : `ensureCarteTable()` est appelée paresseusement dans `getCarte`/`upsertCarte`/la route, comme les autres `ensure*` du projet.
- **Pas de commentaires** ni de bouton « Ajouter » sur les plats de la carte (choix produit : carte statique non datée).
- **Sécurité du flux** : si `GET /api/carte` est indisponible côté pipeline, `fetch_carte_hash()` renvoie `None` → la carte est ré-évaluée (au pire on recalcule, jamais de publication corrompue). Un échec d'évaluation n'écrase pas la carte précédente.
- **Extensibilité** : la table est clé par `restaurant_slug` ; ajouter un autre restaurant ne demanderait qu'un `scrape_carte` dédié et un appel supplémentaire.
```
