# Cartes multi-restos et cards « sans plat du jour » — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher une card pour chaque restaurant attendu même sans plat du jour, avec un dépliant « Voir la carte » chargé au clic, et scraper/noter les cartes de Basilic n'Go, Dubble et La Mijote comme celle du Trèfle.

**Architecture:** Le pipeline Python généralise le traitement hash-gardé de la carte du Trèfle à un registre `CARTE_SOURCES` (sources structurées → sections ; sources brutes PDF/HTML → texte + structuration LLM à la demande). Le front lit la liste des cartes disponibles en SSR, rend une `RestaurantSansPlatCard` par resto sans plat, et un client component `CarteLazy` va chercher `/api/carte?slug=` au premier dépliage.

**Tech Stack:** Next.js 15 / React 19 / TypeScript / Tailwind v4 / vitest (front) ; Python 3.13, `requests`, `pypdf` (nouveau), `anthropic` via `claude -p`, pytest (pipeline) ; Postgres `pdj_carte`.

**Spec:** `docs/superpowers/specs/2026-09-09-cartes-restaurants-design.md`

## Global Constraints

- Tout le texte UI, les logs et les messages d'erreur sont en **français**.
- Noms de restaurants **exacts** partout : `Le Bistrot Trèfle`, `La Pause Gourmande`, `Le Truck Muche`, `Basilic n'Go`, `Dubble`, `La Mijote`, `Vival`. Slugs : `bistrot_trefle`, `pause_gourmande`, `truck_muche`, `basilic_ngo`, `dubble`, `la_mijote`, `vival`.
- Prix au format `"9.90€"` (point décimal, symbole collé), `"N/A"` si absent.
- Python : lancer les tests avec le venv : `cd plats-du-jour && .venv/bin/python -m pytest -q` (ou `source .venv/bin/activate` **en dernier**, sinon Playwright masque le venv — mémoire projet). Ne jamais ajouter d'`ANTHROPIC_API_KEY`.
- Front : `npx vitest run` (tests dans `lib/**/*.test.ts`), `npx tsc --noEmit`, `npm run build`. Alias `@/*` = racine du projet.
- Travailler sur la branche `feat/cartes-restaurants` (créée à la Task 1). Un commit par task, messages en français, terminés par `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Le Tholéan est **hors périmètre** ; Vival n'a **aucun scraping**.
- Les cartes ne changent pas la logique des restos optionnels du run quotidien (`OPTIONAL_LABELS`, `None` = pas de plat).

---

## Structure des fichiers

**Pipeline (`plats-du-jour/`)**
- Créer `agent/carte_agent.py` — hash de texte brut + structuration LLM d'une carte (`_texte_hash`, `structurer_carte`).
- Modifier `scrapers/basilic_ngo.py` — `scrape_carte()` déterministe (ObyPay).
- Modifier `scrapers/dubble.py` — `scrape_carte()` PDF → texte.
- Modifier `scrapers/la_mijote.py` — `scrape_carte()` HTML → texte sans plats du jour.
- Modifier `agent/diet_agent.py` — `evaluate_carte(sections, restaurant)`.
- Modifier `run_state.py` — `cartes_traitees: list[str]` + migration.
- Modifier `publish.py` — `fetch_carte_hash(slug)`.
- Modifier `main.py` — `CARTE_SOURCES`, `_traiter_carte`, `_step_cartes`, `run_cartes`, commande `cartes`.
- Modifier `requirements.txt` — `pypdf`.
- Tests : `tests/test_carte_agent.py` (nouveau), `tests/test_basilic_ngo.py`, `tests/test_dubble.py`, `tests/test_la_mijote.py`, `tests/test_diet_agent_carte.py` (nouveau), `tests/test_run_state.py`, `tests/test_main_cartes.py` (nouveau).

**Front**
- Créer `lib/restaurants.ts` (+ `lib/restaurants.test.ts`) — liste ordonnée des restos, slugs, statuts, titres de carte.
- Modifier `lib/db.ts` — importe `SLUG_TO_RESTAURANT`, ajoute `getCartesDisponibles()`.
- Modifier `app/aide-moi-a-choisir/page.tsx` — `SLUGS` dérivé de `RESTAURANTS`.
- Modifier `app/api/carte/route.ts` — `GET ?slug=`.
- Renommer `app/CarteTrefle.tsx` → `app/CarteRestaurant.tsx` — sections seules.
- Créer `app/CarteLazy.tsx` — dépliant client, fetch au premier clic.
- Modifier `app/components/ClientScripts.tsx` — écoute `pdj:mode-refresh`.
- Modifier `app/page.tsx` — `RestaurantSansPlatCard`, onglet carte multi-restos.
- Modifier `lib/icons.ts` — icône et lien Vival.
- Modifier `CLAUDE.md`.

---

### Task 1 : `agent/carte_agent.py` — hash de texte et structuration LLM

**Files:**
- Create: `plats-du-jour/agent/carte_agent.py`
- Test: `plats-du-jour/tests/test_carte_agent.py`

**Interfaces:**
- Consumes: `agent.diet_agent._call_claude(prompt: str, timeout: int) -> str`, `agent.diet_agent._strip_code_fence(raw: str) -> str` (existants).
- Produces: `_texte_hash(texte: str) -> str` (SHA-1 hex), `structurer_carte(texte: str, restaurant: str) -> list[dict]` (`[{"nom": str, "plats": [{"plat": str, "prix": str}]}]`, lève `ValueError`/`json.JSONDecodeError` si la réponse est inexploitable), `_parse_reponse(raw: str) -> list[dict]`.

- [ ] **Step 1 : Créer la branche**

```bash
cd "/Users/toam/Documents/PDJ Master" && git checkout -b feat/cartes-restaurants
```

- [ ] **Step 2 : Écrire les tests (échouent)**

`plats-du-jour/tests/test_carte_agent.py` :

```python
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent import carte_agent


def test_texte_hash_insensible_aux_espaces_et_a_la_casse():
    a = carte_agent._texte_hash("LES HOT BOWLS\nle hot bowl au poulet   9,90€")
    b = carte_agent._texte_hash("les hot bowls le hot bowl au poulet 9,90€")
    assert a == b
    assert len(a) == 40


def test_texte_hash_change_avec_le_contenu():
    assert carte_agent._texte_hash("bowl 9,90€") != carte_agent._texte_hash("bowl 10,90€")


def test_parse_reponse_accepte_code_fence_et_nettoie():
    raw = '```json\n{"sections": [{"nom": "SALADES", "plats": [{"plat": " La César ", "prix": "10.40€"}, {"plat": "", "prix": "1€"}]}, {"nom": "VIDE", "plats": []}]}\n```'
    assert carte_agent._parse_reponse(raw) == [
        {"nom": "SALADES", "plats": [{"plat": "La César", "prix": "10.40€"}]}
    ]


def test_parse_reponse_prix_absent_devient_na():
    raw = '{"sections": [{"nom": "DESSERTS", "plats": [{"plat": "Brownie"}]}]}'
    assert carte_agent._parse_reponse(raw) == [{"nom": "DESSERTS", "plats": [{"plat": "Brownie", "prix": "N/A"}]}]


def test_parse_reponse_invalide_leve():
    with pytest.raises(ValueError):
        carte_agent._parse_reponse('{"plats": []}')
    with pytest.raises(ValueError):
        carte_agent._parse_reponse('{"sections": [{"nom": "X", "plats": []}]}')


def test_structurer_carte_appelle_claude_avec_le_texte(monkeypatch):
    prompts = []

    def fake_call(prompt, timeout=180):
        prompts.append(prompt)
        return '{"sections": [{"nom": "PLATS", "plats": [{"plat": "Bavette", "prix": "23.00€"}]}]}'

    monkeypatch.setattr(carte_agent, "_call_claude", fake_call)
    sections = carte_agent.structurer_carte("Bavette d'aloyau 23 €", "La Mijote")
    assert sections == [{"nom": "PLATS", "plats": [{"plat": "Bavette", "prix": "23.00€"}]}]
    assert "Bavette d'aloyau 23 €" in prompts[0]
    assert "La Mijote" in prompts[0]
```

- [ ] **Step 3 : Vérifier l'échec**

Run: `cd plats-du-jour && .venv/bin/python -m pytest -q tests/test_carte_agent.py`
Expected: erreur d'import `cannot import name 'carte_agent'`.

- [ ] **Step 4 : Implémenter `agent/carte_agent.py`**

```python
"""
Structuration LLM d'une carte de restaurant à partir de texte brut (PDF, page HTML
libre). Sert aux sources sans structure exploitable (Dubble, La Mijote). Appelé par
main._traiter_carte uniquement quand le hash du texte a changé, donc quelques fois
par an : le hash est calculé sur le texte brut, pas sur la sortie LLM.
"""
import hashlib
import json

from agent.diet_agent import _call_claude, _strip_code_fence

EXCLUSIONS = ("boissons, suppléments et protéines en plus, formules et menus composites "
              "(ex. « Entrée + Plat 18 € »), plats du jour, frais de livraison, couverts")


def _texte_hash(texte: str) -> str:
    """SHA-1 du texte normalisé (espaces réduits, casse ignorée)."""
    norm = " ".join((texte or "").split()).casefold()
    return hashlib.sha1(norm.encode("utf-8")).hexdigest()


def _build_prompt(texte: str, restaurant: str) -> str:
    return (
        f"Voici le texte brut de la carte du restaurant « {restaurant} », extrait d'un PDF ou "
        f"d'une page web (l'ordre des lignes peut être désordonné, les prix parfois décalés) :\n\n"
        f"---\n{texte}\n---\n\n"
        "Structure cette carte en sections de plats. Règles :\n"
        "- Garde uniquement ce qui se mange : entrées, plats, bowls, salades, sandwiches, desserts.\n"
        f"- EXCLUS : {EXCLUSIONS}.\n"
        "- Le nom du plat est repris tel qu'écrit, sans description longue. Si un plat n'a pas "
        "de nom mais une liste d'ingrédients, cette liste devient le nom.\n"
        "- Prix au format \"9.90€\" (point décimal, symbole collé, sans espace) ; \"N/A\" si absent.\n"
        "- Noms de sections courts, en majuscules (ex. \"SALADES\", \"HOT BOWLS\", \"DESSERTS\").\n\n"
        "Réponds UNIQUEMENT en JSON, sans commentaire, avec cette structure :\n"
        '{ "sections": [ { "nom": "…", "plats": [ { "plat": "…", "prix": "9.90€" } ] } ] }'
    )


def _parse_reponse(raw: str) -> list[dict]:
    """Valide la réponse LLM → sections non vides. Lève ValueError si inexploitable."""
    data = json.loads(_strip_code_fence(raw))
    sections = data.get("sections") if isinstance(data, dict) else None
    if not isinstance(sections, list):
        raise ValueError("réponse LLM sans liste 'sections'")
    out = []
    for sec in sections:
        if not isinstance(sec, dict):
            continue
        nom = str(sec.get("nom", "")).strip()
        plats = []
        for p in sec.get("plats", []) or []:
            if not isinstance(p, dict):
                continue
            plat = str(p.get("plat", "")).strip()
            if not plat:
                continue
            prix = str(p.get("prix") or "").strip() or "N/A"
            plats.append({"plat": plat, "prix": prix})
        if nom and plats:
            out.append({"nom": nom, "plats": plats})
    if not out:
        raise ValueError("réponse LLM sans aucun plat")
    return out


def structurer_carte(texte: str, restaurant: str) -> list[dict]:
    """Texte brut → [{"nom", "plats": [{"plat", "prix"}]}] via Claude. Lève si la réponse
    n'est pas un JSON exploitable (l'appelant loggue et ne publie pas)."""
    raw = _call_claude(_build_prompt(texte, restaurant), timeout=240)
    return _parse_reponse(raw)
```

- [ ] **Step 5 : Vérifier le succès**

Run: `cd plats-du-jour && .venv/bin/python -m pytest -q tests/test_carte_agent.py`
Expected: 6 passed.

- [ ] **Step 6 : Commit**

```bash
git add plats-du-jour/agent/carte_agent.py plats-du-jour/tests/test_carte_agent.py
git commit -m "feat(pipeline): carte_agent — hash de texte brut et structuration LLM d'une carte

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2 : `basilic_ngo.scrape_carte()` (ObyPay, déterministe)

**Files:**
- Modify: `plats-du-jour/scrapers/basilic_ngo.py`
- Test: `plats-du-jour/tests/test_basilic_ngo.py` (ajouter des tests)

**Interfaces:**
- Consumes: `_fetch_outlet_data() -> dict | None`, `_normalize(s) -> str` (existants dans le module).
- Produces: `CARTE_SECTIONS`, `_extract_carte(data: dict) -> list[dict]`, `_carte_hash(sections) -> str`, `scrape_carte() -> dict | None` renvoyant `{"restaurant": "Basilic n'Go", "hash": str, "sections": [...]}`.

- [ ] **Step 1 : Ajouter les tests (échouent)**

À la fin de `plats-du-jour/tests/test_basilic_ngo.py` :

```python
def _sample_carte():
    def prod(name, price, sec_id, sec_name):
        return {"name": name, "price": price, "description": "", "section": {"id": sec_id, "name": sec_name}}

    return {"products": [
        prod("La César", 10.4, "SxAY5moTd3", "Salade"),
        prod("La César", 10.4, "SxAY5moTd3", "Salade"),            # doublon menuMode
        prod("La Niçoise", 8.9, "SxAY5moTd3", "Salade"),
        prod("Ciabatta Italien", 7.9, "RNTDcsfYnC", "Sandwich "),   # espace final dans le nom de section
        prod("Poke bowl poulet", 13.4, "nJPphmXghg", "Poke Bowl "),
        prod("Brownie", 3.1, "zL1WM8RrTa", "Dessert "),
        prod("Crème glacée", 0, "zL1WM8RrTa", "Dessert "),           # prix 0 → ignoré
        prod("Plat du jour poisson", 9.4, "Nf8NZ3MTtZ", "Plat "),    # hors allowlist
        prod("Coca Cola 33cl", 2, "WFzyFtcGFf", "Boisson"),          # hors allowlist
        prod("Livraison zone 1", 8.9, "wgbSoCSErR", "Livraison"),    # hors allowlist
    ]}


def test_extract_carte_allowlist_dedup_prix():
    sections = basilic_ngo._extract_carte(_sample_carte())
    assert [s["nom"] for s in sections] == ["SALADE", "SANDWICH", "POKE BOWL", "DESSERT"]
    assert sections[0]["plats"] == [
        {"plat": "La César", "prix": "10.40€"},
        {"plat": "La Niçoise", "prix": "8.90€"},
    ]
    assert sections[3]["plats"] == [{"plat": "Brownie", "prix": "3.10€"}]


def test_carte_hash_stable_a_l_ordre():
    a = basilic_ngo._extract_carte(_sample_carte())
    data = _sample_carte()
    data["products"].reverse()
    b = basilic_ngo._extract_carte(data)
    assert basilic_ngo._carte_hash(a) == basilic_ngo._carte_hash(b)


def test_scrape_carte(monkeypatch):
    monkeypatch.setattr(basilic_ngo, "_fetch_outlet_data", lambda: _sample_carte())
    carte = basilic_ngo.scrape_carte()
    assert carte["restaurant"] == "Basilic n'Go"
    assert len(carte["hash"]) == 40
    assert len(carte["sections"]) == 4


def test_scrape_carte_api_ko_ou_vide(monkeypatch):
    monkeypatch.setattr(basilic_ngo, "_fetch_outlet_data", lambda: None)
    assert basilic_ngo.scrape_carte() is None
    monkeypatch.setattr(basilic_ngo, "_fetch_outlet_data", lambda: {"products": []})
    assert basilic_ngo.scrape_carte() is None
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd plats-du-jour && .venv/bin/python -m pytest -q tests/test_basilic_ngo.py`
Expected: `AttributeError: module 'scrapers.basilic_ngo' has no attribute '_extract_carte'`.

- [ ] **Step 3 : Implémenter**

Dans `plats-du-jour/scrapers/basilic_ngo.py`, ajouter `import hashlib` en tête, puis à la fin du fichier :

```python
# ── Carte permanente ─────────────────────────────────────────────────────────
# Même API : sections « Salade », « Sandwich », « Poke Bowl », « Dessert » (noms avec
# espace final côté API). Exclues : Plat (= plat du jour, déjà scrapé), Boisson,
# Livraison, Traiteur, Menus, Envie supplémentaire, Petit plaisir, Petite faim.

CARTE_SECTIONS = ["Salade", "Sandwich", "Poke Bowl", "Dessert"]
_CARTE_SECTION_SET = {_normalize(s) for s in CARTE_SECTIONS}


def _extract_carte(data: dict) -> list[dict]:
    """Sections de la carte (allowlist par nom de section), plats dédoublonnés par nom
    normalisé, prix > 0 uniquement ; ordre canonique CARTE_SECTIONS puis ordre de l'API."""
    by_section: dict[str, list[dict]] = {}

    def rec(obj):
        if isinstance(obj, dict):
            section = obj.get("section")
            if (obj.get("name") and obj.get("price") is not None
                    and isinstance(section, dict)
                    and _normalize(section.get("name")) in _CARTE_SECTION_SET):
                by_section.setdefault(_normalize(section.get("name")), []).append(obj)
                return
            for v in obj.values():
                rec(v)
        elif isinstance(obj, list):
            for item in obj:
                rec(item)

    rec(data)
    sections = []
    for nom in CARTE_SECTIONS:
        seen, plats = set(), []
        for p in by_section.get(_normalize(nom), []):
            name = " ".join(str(p["name"]).split())
            try:
                prix = float(p["price"])
            except (TypeError, ValueError):
                continue
            key = _normalize(name)
            if prix <= 0 or key in seen:
                continue
            seen.add(key)
            plats.append({"plat": name, "prix": f"{prix:.2f}€"})
        if plats:
            sections.append({"nom": nom.upper(), "plats": plats})
    return sections


def _carte_hash(sections: list[dict]) -> str:
    """SHA-1 déterministe (insensible à l'ordre renvoyé par l'API)."""
    parts = sorted(f"{sec['nom']}|{_normalize(p['plat'])}|{p['prix']}"
                   for sec in sections for p in sec["plats"])
    return hashlib.sha1("\n".join(parts).encode("utf-8")).hexdigest()


def scrape_carte() -> dict | None:
    """Carte permanente → {"restaurant", "hash", "sections"} ou None (API KO / carte vide)."""
    data = _fetch_outlet_data()
    if data is None:
        return None
    sections = _extract_carte(data)
    if not sections:
        print("[basilic_ngo] Carte vide")
        return None
    return {"restaurant": RESTAURANT, "hash": _carte_hash(sections), "sections": sections}
```

- [ ] **Step 4 : Vérifier le succès**

Run: `cd plats-du-jour && .venv/bin/python -m pytest -q tests/test_basilic_ngo.py`
Expected: tous passent (anciens + 4 nouveaux).

- [ ] **Step 5 : Commit**

```bash
git add plats-du-jour/scrapers/basilic_ngo.py plats-du-jour/tests/test_basilic_ngo.py
git commit -m "feat(scrapers): carte permanente de Basilic n'Go (ObyPay, hash trié)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3 : `dubble.scrape_carte()` (PDF saisonnier → texte)

**Files:**
- Modify: `plats-du-jour/scrapers/dubble.py`
- Modify: `plats-du-jour/requirements.txt`
- Test: `plats-du-jour/tests/test_dubble.py` (ajouter)

**Interfaces:**
- Consumes: `agent.carte_agent._texte_hash` (Task 1), `HEADERS`, `RESTAURANT` (existants).
- Produces: `CARTE_URL`, `CARTE_MIN_CHARS = 500`, `_fetch_pdf() -> bytes | None`, `_pdf_texte(data: bytes) -> str`, `scrape_carte() -> dict | None` renvoyant `{"restaurant": "Dubble", "hash": str, "texte": str}`.

- [ ] **Step 1 : Installer `pypdf` et l'épingler**

```bash
cd plats-du-jour && .venv/bin/pip install "pypdf>=6,<7" && .venv/bin/python -c "import pypdf; print(pypdf.__version__)"
```

Ajouter à `plats-du-jour/requirements.txt` la ligne : `pypdf>=6,<7`

- [ ] **Step 2 : Ajouter les tests (échouent)**

À la fin de `plats-du-jour/tests/test_dubble.py` :

```python
def _mini_pdf(lines: list[str]) -> bytes:
    """PDF minimal valide (xref calculé) : une ligne de texte Helvetica par élément."""
    ops = " ".join(f"({l}) Tj 0 -16 Td" for l in lines)
    content = f"BT /F1 12 Tf 72 720 Td {ops} ET".encode("latin-1")
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(content)).encode() + b" >> stream\n" + content + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


def test_pdf_texte_extrait_les_lignes():
    texte = dubble._pdf_texte(_mini_pdf(["LES HOT BOWLS", "le hot bowl au poulet 9,90"]))
    assert texte == "LES HOT BOWLS\nle hot bowl au poulet 9,90"


def test_scrape_carte_retourne_texte_et_hash(monkeypatch):
    lignes = [f"salade numero {i} 9,00" for i in range(40)]  # > 500 caractères
    monkeypatch.setattr(dubble, "_fetch_pdf", lambda: _mini_pdf(lignes))
    carte = dubble.scrape_carte()
    assert carte["restaurant"] == "Dubble"
    assert "salade numero 7 9,00" in carte["texte"]
    assert "sections" not in carte
    from agent.carte_agent import _texte_hash
    assert carte["hash"] == _texte_hash(carte["texte"])


def test_scrape_carte_texte_trop_court_ou_pdf_ko(monkeypatch):
    monkeypatch.setattr(dubble, "_fetch_pdf", lambda: _mini_pdf(["trop court"]))
    assert dubble.scrape_carte() is None
    monkeypatch.setattr(dubble, "_fetch_pdf", lambda: b"pas un pdf")
    assert dubble.scrape_carte() is None
    monkeypatch.setattr(dubble, "_fetch_pdf", lambda: None)
    assert dubble.scrape_carte() is None
```

- [ ] **Step 3 : Vérifier l'échec**

Run: `cd plats-du-jour && .venv/bin/python -m pytest -q tests/test_dubble.py`
Expected: `AttributeError: ... has no attribute '_pdf_texte'`.

- [ ] **Step 4 : Implémenter**

Dans `plats-du-jour/scrapers/dubble.py`, ajouter `import io` aux imports, puis à la fin du fichier :

```python
# ── Carte saisonnière (PDF) ──────────────────────────────────────────────────
# Le lien court redirige (301) vers un PDF Wix dont l'URL change à chaque saison :
# toujours passer par le lien court. Mise en page sur deux colonnes → le texte extrait
# est désordonné, c'est agent.carte_agent.structurer_carte (appelé par main quand le
# hash change) qui le remet en sections. Ici : texte brut + hash uniquement.

CARTE_URL = "https://link.dubble-food.com/Carte-Avignon-Agroparc"
CARTE_MIN_CHARS = 500


def _fetch_pdf() -> bytes | None:
    try:
        r = requests.get(CARTE_URL, headers={**HEADERS, "Accept": "application/pdf,*/*"},
                         timeout=30, allow_redirects=True)
        r.raise_for_status()
        ctype = r.headers.get("Content-Type", "")
        if "pdf" not in ctype.lower() and not r.content.startswith(b"%PDF"):
            print(f"[dubble] Carte : contenu inattendu ({ctype or 'sans Content-Type'})")
            return None
        return r.content
    except Exception as e:
        print(f"[dubble] Erreur téléchargement carte : {e}")
        return None


def _pdf_texte(data: bytes) -> str:
    """Texte de toutes les pages, une ligne par ligne du PDF (espaces réduits, vides retirées)."""
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    lignes = []
    for page in reader.pages:
        for l in (page.extract_text() or "").splitlines():
            l = " ".join(l.split())
            if l:
                lignes.append(l)
    return "\n".join(lignes)


def scrape_carte() -> dict | None:
    """Carte saisonnière → {"restaurant", "hash", "texte"} ou None (PDF KO, texte trop court)."""
    from agent.carte_agent import _texte_hash
    data = _fetch_pdf()
    if data is None:
        return None
    try:
        texte = _pdf_texte(data)
    except Exception as e:
        print(f"[dubble] PDF illisible : {e}")
        return None
    if len(texte) < CARTE_MIN_CHARS:
        print(f"[dubble] Texte de la carte trop court ({len(texte)} car.) → ignoré")
        return None
    return {"restaurant": RESTAURANT, "hash": _texte_hash(texte), "texte": texte}
```

- [ ] **Step 5 : Vérifier le succès**

Run: `cd plats-du-jour && .venv/bin/python -m pytest -q tests/test_dubble.py`
Expected: tous passent (anciens + 3 nouveaux).

- [ ] **Step 6 : Commit**

```bash
git add plats-du-jour/scrapers/dubble.py plats-du-jour/tests/test_dubble.py plats-du-jour/requirements.txt
git commit -m "feat(scrapers): carte saisonnière Dubble (PDF → texte + hash, dépendance pypdf)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4 : `la_mijote.scrape_carte()` (HTML → texte sans plats du jour)

**Files:**
- Modify: `plats-du-jour/scrapers/la_mijote.py`
- Test: `plats-du-jour/tests/test_la_mijote.py` (ajouter)

**Interfaces:**
- Consumes: `_fetch_html() -> str | None`, `_TAG_RE`, `RESTAURANT` (existants) ; `agent.carte_agent._texte_hash` (Task 1).
- Produces: `CARTE_MIN_CHARS = 200`, `_texte_carte(html: str) -> str`, `scrape_carte() -> dict | None` renvoyant `{"restaurant": "La Mijote", "hash": str, "texte": str}`.

- [ ] **Step 1 : Ajouter les tests (échouent)**

À la fin de `plats-du-jour/tests/test_la_mijote.py` :

```python
# Extrait simplifié de la partie carte de menu.html (formules + carte des Mijoteurs + desserts).
FIXTURE_CARTE_HTML = FIXTURE_HTML + """
<script>document.querySelector('.today').classList.remove('hidden');</script>
<section><h2>Formules</h2>
<div data-pgc-edit="formules_descriptions"><p>Entrée + Plat + Dessert</p><div><span>22 €</span></div>
  <p>Entrée + Plat ou Plat + Dessert</p><div><span>18 €</span></div>
  <h3>La carte des "Mijoteurs"</h3><h4>Plats</h4>
  <div><p><b>Bavette d'aloyau</b> "bœuf qualité Irlande", sauce béarnaise, salade &amp; frites maison.</p><p>23 €</p></div>
  <div><p><b>Pluma de cochon, purée de pommes de terre</b>, panais glacé au jus.</p><p>22 €</p></div>
</div>
<div data-pgc-edit="entree_a"><b>Asperges vertes de pays</b> (en velouté, crues, cuites…), guanciale</div>
<div data-pgc-edit="dessert_a"><b>Dessert du jour</b></div>
</section>
"""


def test_texte_carte_retire_plats_du_jour_et_scripts():
    texte = la_mijote._texte_carte(FIXTURE_CARTE_HTML)
    assert "Bavette d'aloyau" in texte
    assert "Pluma de cochon" in texte
    assert "Asperges vertes" in texte
    assert "23 €" in texte
    assert "saucisse purée" not in texte
    assert "Poulet mafé" not in texte
    assert "classList" not in texte
    assert "<" not in texte


def test_hash_carte_stable_quand_les_plats_du_jour_changent():
    from agent.carte_agent import _texte_hash
    autre_semaine = FIXTURE_CARTE_HTML.replace("Traditionnelle saucisse purée", "Blanquette de veau")
    assert _texte_hash(la_mijote._texte_carte(FIXTURE_CARTE_HTML)) == _texte_hash(la_mijote._texte_carte(autre_semaine))


def test_scrape_carte_sans_garde_fou_fraicheur(monkeypatch):
    def _boom():
        raise AssertionError("HEAD ne doit pas être appelé pour la carte")
    monkeypatch.setattr(la_mijote, "_last_modified", _boom)
    monkeypatch.setattr(la_mijote, "_fetch_html", lambda: FIXTURE_CARTE_HTML)
    carte = la_mijote.scrape_carte()
    assert carte["restaurant"] == "La Mijote"
    assert "Bavette" in carte["texte"]
    assert len(carte["hash"]) == 40


def test_scrape_carte_html_ko_ou_trop_court(monkeypatch):
    monkeypatch.setattr(la_mijote, "_fetch_html", lambda: None)
    assert la_mijote.scrape_carte() is None
    monkeypatch.setattr(la_mijote, "_fetch_html", lambda: "<html><body><p>Fermé</p></body></html>")
    assert la_mijote.scrape_carte() is None
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd plats-du-jour && .venv/bin/python -m pytest -q tests/test_la_mijote.py`
Expected: `AttributeError: ... has no attribute '_texte_carte'`.

- [ ] **Step 3 : Implémenter**

Dans `plats-du-jour/scrapers/la_mijote.py`, après `_TAG_RE`, ajouter :

```python
# Carte : les divs plat_<jour> ont un contenu simple (<b>…</b>, pas de div imbriqué —
# vérifié le 9 septembre 2026), on peut les retirer par regex non gourmande.
_PLAT_JOUR_RE = re.compile(r'<div[^>]*data-pgc-edit="plat_[a-z]+"[^>]*>.*?</div>', re.S)
_SCRIPT_RE = re.compile(r"<(script|style)\b[^>]*>.*?</\1>", re.S | re.I)
_BLOCK_TAG_RE = re.compile(r"</?(?:p|div|h[1-6]|li|ul|ol|br|tr|td|th|table|section|article)\b[^>]*>", re.I)
CARTE_MIN_CHARS = 200
```

et à la fin du fichier :

```python
# ── Carte (entrées, carte des Mijoteurs, desserts) ───────────────────────────

def _texte_carte(html: str) -> str:
    """Texte visible de la page sans les plats du jour (pour que le hash ne bouge pas
    chaque semaine) ni scripts/styles ; une ligne par élément bloc, espaces réduits."""
    txt = _PLAT_JOUR_RE.sub(" ", html)
    txt = _SCRIPT_RE.sub(" ", txt)
    txt = _BLOCK_TAG_RE.sub("\n", txt)
    txt = html_lib.unescape(_TAG_RE.sub(" ", txt)).replace("\xa0", " ")
    lignes = [" ".join(l.split()) for l in txt.split("\n")]
    return "\n".join(l for l in lignes if l)


def scrape_carte() -> dict | None:
    """Carte → {"restaurant", "hash", "texte"} ou None. Pas de garde-fou Last-Modified :
    une carte est permanente, la date « notée le » suffit côté site."""
    from agent.carte_agent import _texte_hash
    html = _fetch_html()
    if html is None:
        return None
    texte = _texte_carte(html)
    if len(texte) < CARTE_MIN_CHARS:
        print(f"[la_mijote] Texte de la carte trop court ({len(texte)} car.) → ignoré")
        return None
    return {"restaurant": RESTAURANT, "hash": _texte_hash(texte), "texte": texte}
```

- [ ] **Step 4 : Vérifier le succès**

Run: `cd plats-du-jour && .venv/bin/python -m pytest -q tests/test_la_mijote.py`
Expected: tous passent (anciens + 4 nouveaux).

- [ ] **Step 5 : Commit**

```bash
git add plats-du-jour/scrapers/la_mijote.py plats-du-jour/tests/test_la_mijote.py
git commit -m "feat(scrapers): carte de La Mijote (texte HTML sans plats du jour + hash)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5 : `diet_agent.evaluate_carte(sections, restaurant)`

**Files:**
- Modify: `plats-du-jour/agent/diet_agent.py` (fonction `evaluate_carte`, ~ligne 483)
- Test: `plats-du-jour/tests/test_diet_agent_carte.py` (nouveau)

**Interfaces:**
- Produces: `evaluate_carte(sections: list[dict], restaurant: str = "Le Bistrot Trèfle") -> list[dict]`.

- [ ] **Step 1 : Écrire le test (échoue)**

`plats-du-jour/tests/test_diet_agent_carte.py` :

```python
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent import diet_agent


def test_evaluate_carte_utilise_le_restaurant(monkeypatch):
    prompts = []

    def fake_call(prompt, timeout=180):
        prompts.append(prompt)
        return json.dumps({"plats": [{"restaurant": "Dubble", "plat": "Hot bowl poulet", "prix": "9.90€",
                                      "note": 7, "justification": "ok", "note_goulaf": 6,
                                      "justification_goulaf": "ok"}]})

    monkeypatch.setattr(diet_agent, "_call_claude", fake_call)
    monkeypatch.setattr(diet_agent, "_apply_ciqual", lambda result: result)
    monkeypatch.setattr(diet_agent, "_build_portion_calibration", lambda restos: f"CAL:{sorted(restos)}")

    sections = [{"nom": "HOT BOWLS", "plats": [{"plat": "Hot bowl poulet", "prix": "9.90€"}]}]
    out = diet_agent.evaluate_carte(sections, "Dubble")

    assert '"restaurant": "Dubble"' in prompts[0]
    assert "CAL:['Dubble']" in prompts[0]
    assert "carte permanente du restaurant « Dubble »" in prompts[0]
    assert out[0]["plats"][0]["note"] == 7


def test_evaluate_carte_defaut_trefle(monkeypatch):
    prompts = []
    monkeypatch.setattr(diet_agent, "_call_claude", lambda p, timeout=180: (prompts.append(p), '{"plats": []}')[1])
    monkeypatch.setattr(diet_agent, "_apply_ciqual", lambda result: result)
    monkeypatch.setattr(diet_agent, "_build_portion_calibration", lambda restos: "")
    diet_agent.evaluate_carte([{"nom": "PÂTES", "plats": [{"plat": "Linguine", "prix": "14€"}]}])
    assert '"restaurant": "Le Bistrot Trèfle"' in prompts[0]
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd plats-du-jour && .venv/bin/python -m pytest -q tests/test_diet_agent_carte.py`
Expected: `TypeError: evaluate_carte() takes 1 positional argument but 2 were given`.

- [ ] **Step 3 : Implémenter**

Dans `plats-du-jour/agent/diet_agent.py`, remplacer le début de `evaluate_carte` :

```python
def evaluate_carte(sections: list[dict], restaurant: str = "Le Bistrot Trèfle") -> list[dict]:
    """
    Note tous les plats de la carte d'un restaurant (Sportif + Goulaf + macros), SANS
    recommandation. Retourne les sections enrichies.
    """
    plats = [
        {"restaurant": restaurant, "plat": p.get("plat", ""), "prix": p.get("prix", "")}
        for sec in sections for p in sec["plats"]
    ]
    if not plats:
        return sections

    calibration = _build_portion_calibration({restaurant})
    prompt = (
        f"{_build_system_prompt()}{calibration}\n\n"
        f"Voici la carte permanente du restaurant « {restaurant} » :\n\n"
```

Le reste de la fonction (structure JSON demandée, `_call_claude`, `_apply_ciqual`,
`_rebuild_carte_sections`) est inchangé.

- [ ] **Step 4 : Vérifier le succès**

Run: `cd plats-du-jour && .venv/bin/python -m pytest -q tests/test_diet_agent_carte.py tests/test_carte.py`
Expected: passent.

- [ ] **Step 5 : Commit**

```bash
git add plats-du-jour/agent/diet_agent.py plats-du-jour/tests/test_diet_agent_carte.py
git commit -m "feat(agent): evaluate_carte prend le restaurant en paramètre

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6 : `run_state` — `cartes_traitees` et migration

**Files:**
- Modify: `plats-du-jour/run_state.py` (`_vierge`, `load`)
- Test: `plats-du-jour/tests/test_run_state.py` (ajouter)

**Interfaces:**
- Produces: clé d'état `state["cartes_traitees"]: list[str]` (slugs déjà traités cette semaine). La clé `carte_traitee` disparaît.

- [ ] **Step 1 : Ajouter les tests (échouent)**

À la fin de `plats-du-jour/tests/test_run_state.py` :

```python
def test_etat_vierge_a_cartes_traitees_vide():
    state = run_state.load(date(2026, 9, 14), "semaine")
    assert state["cartes_traitees"] == []
    assert "carte_traitee" not in state


def test_migration_ancien_flag_carte_traitee(_tmp_output):
    for ancien, attendu in ((True, ["bistrot_trefle"]), (False, [])):
        state = run_state._vierge(date(2026, 9, 14), "semaine")
        del state["cartes_traitees"]
        state["carte_traitee"] = ancien
        (_tmp_output / "run_state_2026-09-14.json").write_text(json.dumps(state), encoding="utf-8")
        charge = run_state.load(date(2026, 9, 14), "semaine")
        assert charge["cartes_traitees"] == attendu
        assert "carte_traitee" not in charge
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd plats-du-jour && .venv/bin/python -m pytest -q tests/test_run_state.py`
Expected: `KeyError: 'cartes_traitees'`.

- [ ] **Step 3 : Implémenter**

Dans `plats-du-jour/run_state.py`, dans `_vierge`, remplacer `"carte_traitee": False,` par
`"cartes_traitees": [],` et dans `load`, juste avant `return state` (dans le `if state.get("date") == str(d):`) :

```python
                # Migration : l'ancien booléen carte_traitee (Trèfle seul) devient une liste de slugs.
                if "cartes_traitees" not in state:
                    state["cartes_traitees"] = ["bistrot_trefle"] if state.pop("carte_traitee", False) else []
```

- [ ] **Step 4 : Vérifier le succès**

Run: `cd plats-du-jour && .venv/bin/python -m pytest -q tests/test_run_state.py`
Expected: passent.

- [ ] **Step 5 : Commit**

```bash
git add plats-du-jour/run_state.py plats-du-jour/tests/test_run_state.py
git commit -m "feat(pipeline): run_state — cartes_traitees (liste de slugs) avec migration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7 : `main.py` — registre `CARTE_SOURCES`, `_traiter_carte`, `_step_cartes`, commande `cartes`

**Files:**
- Modify: `plats-du-jour/publish.py` (`fetch_carte_hash`)
- Modify: `plats-du-jour/main.py` (imports, bloc carte de `run_semaine` ~l.306-313, `_traiter_carte` ~l.329-360, `main()`)
- Modify: `CLAUDE.md` (section Commands, pipeline)
- Test: `plats-du-jour/tests/test_main_cartes.py` (nouveau)

**Interfaces:**
- Consumes: `scrape_carte` des 4 scrapers (Tasks 2-4 + Trèfle existant), `carte_agent.structurer_carte` (Task 1), `diet_agent.evaluate_carte(sections, restaurant)` (Task 5), `state["cartes_traitees"]` (Task 6).
- Produces: `publish.fetch_carte_hash(slug: str = "bistrot_trefle") -> str | None` ; `main.CARTE_SOURCES: dict[str, Callable]` ; `main._traiter_carte(loop, slug, scrape_fn, force=False) -> None` ; `main._step_cartes(state, loop) -> None` ; `main.run_cartes(slug: str | None, force: bool) -> int` ; CLI `python main.py cartes [slug] [--force]`.

- [ ] **Step 1 : Écrire les tests (échouent)**

`plats-du-jour/tests/test_main_cartes.py` :

```python
import asyncio
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main
import run_state

SECTIONS = [{"nom": "SALADE", "plats": [{"plat": "La César", "prix": "10.40€"}]}]
NOTEES = [{"nom": "SALADE", "plats": [{"plat": "La César", "prix": "10.40€", "note": 7}]}]


class Espion:
    def __init__(self, monkeypatch, stored_hash="abc"):
        self.evals, self.structs, self.publies = [], [], []
        monkeypatch.setattr(main, "fetch_carte_hash", lambda slug: stored_hash)
        monkeypatch.setattr(main, "publish_carte", lambda payload: self.publies.append(payload) or True)
        monkeypatch.setattr(main.diet_agent, "evaluate_carte",
                            lambda sections, restaurant: self.evals.append((sections, restaurant)) or NOTEES)
        monkeypatch.setattr(main.carte_agent, "structurer_carte",
                            lambda texte, restaurant: self.structs.append((texte, restaurant)) or SECTIONS)


def _traiter(slug, fn, force=False):
    async def go():
        await main._traiter_carte(asyncio.get_event_loop(), slug, fn, force=force)
    asyncio.run(go())


def test_hash_identique_ne_reevalue_pas(monkeypatch):
    e = Espion(monkeypatch, stored_hash="abc")
    _traiter("basilic_ngo", lambda: {"restaurant": "Basilic n'Go", "hash": "abc", "sections": SECTIONS})
    assert e.evals == [] and e.publies == []


def test_hash_different_evalue_et_publie(monkeypatch):
    e = Espion(monkeypatch, stored_hash="ancien")
    _traiter("basilic_ngo", lambda: {"restaurant": "Basilic n'Go", "hash": "abc", "sections": SECTIONS})
    assert e.evals == [(SECTIONS, "Basilic n'Go")]
    assert e.structs == []
    assert e.publies == [{"restaurant_slug": "basilic_ngo", "restaurant": "Basilic n'Go", "hash": "abc", "sections": NOTEES}]


def test_texte_brut_est_structure_avant_evaluation(monkeypatch):
    e = Espion(monkeypatch, stored_hash=None)
    _traiter("dubble", lambda: {"restaurant": "Dubble", "hash": "abc", "texte": "hot bowl 9,90"})
    assert e.structs == [("hot bowl 9,90", "Dubble")]
    assert e.evals == [(SECTIONS, "Dubble")]
    assert e.publies[0]["restaurant_slug"] == "dubble"


def test_force_reevalue_meme_hash(monkeypatch):
    e = Espion(monkeypatch, stored_hash="abc")
    _traiter("basilic_ngo", lambda: {"restaurant": "Basilic n'Go", "hash": "abc", "sections": SECTIONS}, force=True)
    assert len(e.evals) == 1 and len(e.publies) == 1


def test_scrape_ko_ou_exception_ne_publie_rien(monkeypatch):
    e = Espion(monkeypatch, stored_hash=None)
    _traiter("la_mijote", lambda: None)

    def boom():
        raise RuntimeError("HTTP 500")
    _traiter("la_mijote", boom)
    assert e.evals == [] and e.publies == []


def test_step_cartes_continue_apres_une_erreur_et_marque_les_slugs(monkeypatch, tmp_path):
    monkeypatch.setattr(run_state, "OUTPUT_DIR", tmp_path)
    e = Espion(monkeypatch, stored_hash=None)

    def boom():
        raise RuntimeError("API KO")
    monkeypatch.setattr(main, "CARTE_SOURCES", {
        "bistrot_trefle": boom,
        "basilic_ngo": lambda: {"restaurant": "Basilic n'Go", "hash": "abc", "sections": SECTIONS},
    })
    state = run_state.load(date(2026, 9, 14), "semaine")
    state["cartes_traitees"] = []

    async def go():
        await main._step_cartes(state, asyncio.get_event_loop())
    asyncio.run(go())

    assert state["cartes_traitees"] == ["bistrot_trefle", "basilic_ngo"]
    assert [p["restaurant_slug"] for p in e.publies] == ["basilic_ngo"]


def test_step_cartes_saute_les_slugs_deja_traites(monkeypatch, tmp_path):
    monkeypatch.setattr(run_state, "OUTPUT_DIR", tmp_path)
    e = Espion(monkeypatch, stored_hash=None)
    appels = []
    monkeypatch.setattr(main, "CARTE_SOURCES", {
        "basilic_ngo": lambda: appels.append(1) or {"restaurant": "Basilic n'Go", "hash": "abc", "sections": SECTIONS},
    })
    state = run_state.load(date(2026, 9, 14), "semaine")
    state["cartes_traitees"] = ["basilic_ngo"]

    async def go():
        await main._step_cartes(state, asyncio.get_event_loop())
    asyncio.run(go())
    assert appels == [] and e.publies == []


def test_run_cartes_slug_inconnu(monkeypatch):
    Espion(monkeypatch)
    assert asyncio.run(main.run_cartes("tholean", force=False)) == 1
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd plats-du-jour && .venv/bin/python -m pytest -q tests/test_main_cartes.py`
Expected: `AttributeError: module 'main' has no attribute 'carte_agent'` (ou `CARTE_SOURCES`).

- [ ] **Step 3 : `publish.fetch_carte_hash(slug)`**

Dans `plats-du-jour/publish.py`, remplacer la fonction :

```python
def fetch_carte_hash(slug: str = "bistrot_trefle") -> str | None:
    """Hash de la carte stockée pour un resto (GET /api/carte?slug=…), ou None."""
    if not API_URL:
        return None
    url = f"{API_URL}/api/carte"
    try:
        resp = requests.get(url, params={"slug": slug}, timeout=30)
        if not resp.ok:
            return None
        data = resp.json()
        return data.get("hash") if isinstance(data, dict) else None
    except Exception as e:
        print(f"[publish] Erreur lecture hash carte ({slug}) : {e}")
        return None
```

- [ ] **Step 4 : `main.py` — imports et registre**

Ligne d'import des agents :

```python
from agent import diet_agent, repair_team, comment_agent, feedback_agent, idee_agent, portion_agent, carte_agent
```

Juste avant `_SCRAPE_FNS` :

```python
# Cartes permanentes : slug → scrape_carte(). Chaque fonction renvoie soit des
# "sections" (source structurée), soit un "texte" brut (structuré par le LLM seulement
# quand le hash change), ou None.
CARTE_SOURCES = {
    "bistrot_trefle": bistrot_trefle.scrape_carte,
    "basilic_ngo": basilic_ngo.scrape_carte,
    "dubble": dubble.scrape_carte,
    "la_mijote": la_mijote.scrape_carte,
}
```

- [ ] **Step 5 : `main.py` — remplacer `_traiter_carte` et ajouter `_step_cartes` / `run_cartes`**

Remplacer toute la fonction `_traiter_carte(loop)` par :

```python
async def _traiter_carte(loop, slug: str, scrape_fn, force: bool = False) -> None:
    """Scrape la carte d'un resto ; structure (si texte brut), ré-évalue et publie
    uniquement si le hash a changé (ou force). Ne lève jamais."""
    try:
        carte = await loop.run_in_executor(None, scrape_fn)
    except Exception as e:
        print(f"[pipeline:carte] {slug} : erreur scrape : {e}")
        return
    if not carte:
        print(f"[pipeline:carte] {slug} : carte non récupérée, skip")
        return

    stored_hash = await loop.run_in_executor(None, fetch_carte_hash, slug)
    if not force and stored_hash and stored_hash == carte["hash"]:
        print(f"[pipeline:carte] {slug} : carte inchangée, évaluation réutilisée")
        return

    print(f"[pipeline:carte] {slug} : carte modifiée → ré-évaluation...")
    restaurant = carte["restaurant"]
    try:
        sections = carte.get("sections")
        if not sections:
            sections = await loop.run_in_executor(
                None, carte_agent.structurer_carte, carte["texte"], restaurant)
        sections = await loop.run_in_executor(None, diet_agent.evaluate_carte, sections, restaurant)
    except Exception as e:
        print(f"[pipeline:carte] {slug} : erreur structuration/évaluation (non publiée) : {e}")
        return

    publish_carte({
        "restaurant_slug": slug,
        "restaurant": restaurant,
        "hash": carte["hash"],
        "sections": sections,
    })
    print(f"[pipeline:carte] {slug} : carte publiée (hash {carte['hash'][:8]})")


async def _step_cartes(state: dict, loop) -> None:
    """Une fois par semaine, traite chaque carte pas encore traitée (état reprenable)."""
    for slug, fn in CARTE_SOURCES.items():
        if slug in state["cartes_traitees"]:
            continue
        await _traiter_carte(loop, slug, fn)
        state["cartes_traitees"].append(slug)
        run_state.save(state)


async def run_cartes(slug: str | None = None, force: bool = False) -> int:
    """Commande manuelle : traite toutes les cartes (ou une seule), hors état de run."""
    if slug and slug not in CARTE_SOURCES:
        print(f"[pipeline:carte] Slug inconnu : {slug} (attendus : {', '.join(CARTE_SOURCES)})")
        return 1
    loop = asyncio.get_event_loop()
    for s, fn in CARTE_SOURCES.items():
        if slug and s != slug:
            continue
        await _traiter_carte(loop, s, fn, force=force)
    return 0
```

Dans `run_semaine`, remplacer le bloc :

```python
    # ── Carte permanente du Trèfle (une fois par lundi, hash-guardée) ────
    if not state["carte_traitee"]:
        try:
            await _traiter_carte(loop)
            state["carte_traitee"] = True
            run_state.save(state)
        except Exception as e:
            print(f"[pipeline:semaine] Erreur traitement carte : {e}")
```

par :

```python
    # ── Cartes permanentes (une fois par lundi, hash-gardées, reprenables) ──
    await _step_cartes(state, loop)
```

- [ ] **Step 6 : `main.py` — commande `cartes`**

Dans `main()`, mettre à jour l'usage :

```python
    usage = ("Usage: python main.py [semaine|jour|cartes [slug] [--force]|commentaires <personnage>"
             "|sync-feedback|nouveau-personnage|check-portions|desserts]")
```

et ajouter avant `elif mode == "check-portions":` :

```python
    elif mode == "cartes":
        args = [a for a in sys.argv[2:] if not a.startswith("--")]
        sys.exit(asyncio.run(run_cartes(args[0] if args else None, force="--force" in sys.argv)))
```

- [ ] **Step 7 : Vérifier le succès et l'ensemble de la suite**

Run: `cd plats-du-jour && .venv/bin/python -m pytest -q`
Expected: tout passe (aucune régression sur `test_main_scrape_jour.py`, `test_run_state.py`).

- [ ] **Step 8 : `CLAUDE.md`**

Dans la section « Python pipeline (`plats-du-jour/`) », ajouter après la ligne `python main.py jour` :

```
python main.py cartes [slug] [--force]  # Cartes permanentes (Trèfle, Basilic n'Go, Dubble, La Mijote) : scrape, hash, notation LLM si changement ; --force ré-évalue
```

Dans « Python pipeline structure », ajouter :

```
- `agent/carte_agent.py` — Structuration LLM d'une carte à partir de texte brut (PDF Dubble, HTML La Mijote) + `_texte_hash` ; appelé seulement quand le hash change
```

et compléter la ligne des scrapers optionnels : `basilic_ngo.py` (« + `scrape_carte()` ObyPay »), `dubble.py` (« + `scrape_carte()` PDF saisonnier via pypdf »), `la_mijote.py` (« + `scrape_carte()` texte HTML sans plats du jour »). Dans « Data flow », mentionner : « Cartes permanentes : `main.py CARTE_SOURCES` → hash → `/api/carte` (`pdj_carte`, une ligne par slug), traitées le lundi ou via `main.py cartes` ».

- [ ] **Step 9 : Commit**

```bash
git add plats-du-jour/main.py plats-du-jour/publish.py plats-du-jour/tests/test_main_cartes.py CLAUDE.md
git commit -m "feat(pipeline): cartes multi-restos — registre CARTE_SOURCES, structuration à la demande, commande cartes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8 : `lib/restaurants.ts` + `getCartesDisponibles()`

**Files:**
- Create: `lib/restaurants.ts`
- Test: `lib/restaurants.test.ts`
- Modify: `lib/db.ts` (supprimer `SLUG_TO_RESTAURANT` privé ~l.430-437, ajouter `getCartesDisponibles` après `upsertCarte` ~l.580)
- Modify: `app/aide-moi-a-choisir/page.tsx` (`SLUGS` ~l.16-23)

**Interfaces:**
- Produces: `RestaurantType`, `RestaurantDef { nom, slug, type, carte }`, `RESTAURANTS: RestaurantDef[]` (ordre d'affichage), `SLUG_TO_RESTAURANT`, `statutSansPlat(resto, isFuture): string`, `titreCarte(resto): string` ; `lib/db.ts` : `CarteDisponible { slug: string; evaluated_at: string | null }`, `getCartesDisponibles(): Promise<CarteDisponible[]>`.

- [ ] **Step 1 : Écrire les tests (échouent)**

`lib/restaurants.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { RESTAURANTS, SLUG_TO_RESTAURANT, statutSansPlat, titreCarte } from "./restaurants";

const bySlug = (slug: string) => RESTAURANTS.find((r) => r.slug === slug)!;

describe("RESTAURANTS", () => {
  it("commence par les 3 historiques puis les optionnels puis Vival", () => {
    expect(RESTAURANTS.map((r) => r.slug)).toEqual([
      "bistrot_trefle", "pause_gourmande", "truck_muche",
      "basilic_ngo", "dubble", "la_mijote", "vival",
    ]);
  });

  it("expose la table slug → nom", () => {
    expect(SLUG_TO_RESTAURANT.bistrot_trefle).toBe("Le Bistrot Trèfle");
    expect(SLUG_TO_RESTAURANT.la_mijote).toBe("La Mijote");
    expect(Object.keys(SLUG_TO_RESTAURANT)).toHaveLength(7);
  });

  it("marque les cartes scrapées", () => {
    expect(RESTAURANTS.filter((r) => r.carte).map((r) => r.slug)).toEqual([
      "bistrot_trefle", "basilic_ngo", "dubble", "la_mijote",
    ]);
  });
});

describe("statutSansPlat", () => {
  it("historique fermé", () => {
    expect(statutSansPlat(bySlug("pause_gourmande"), false)).toBe("Fermé aujourd'hui");
    expect(statutSansPlat(bySlug("pause_gourmande"), true)).toBe("Fermé aujourd'hui");
  });
  it("optionnel aujourd'hui vs jour futur", () => {
    expect(statutSansPlat(bySlug("dubble"), false)).toBe("Pas de plat du jour aujourd'hui");
    expect(statutSansPlat(bySlug("dubble"), true)).toBe("Plat du jour dévoilé le matin même");
  });
  it("Vival", () => {
    expect(statutSansPlat(bySlug("vival"), false)).toBe("Bar à salades sur place");
  });
});

describe("titreCarte", () => {
  it("accorde l'article", () => {
    expect(titreCarte(bySlug("bistrot_trefle"))).toBe("La carte du Bistrot Trèfle");
    expect(titreCarte(bySlug("la_mijote"))).toBe("La carte de la Mijote");
    expect(titreCarte(bySlug("dubble"))).toBe("La carte de Dubble");
    expect(titreCarte(bySlug("basilic_ngo"))).toBe("La carte de Basilic n'Go");
  });
});
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `npx vitest run lib/restaurants.test.ts`
Expected: `Failed to resolve import "./restaurants"`.

- [ ] **Step 3 : Implémenter `lib/restaurants.ts`**

```ts
/**
 * Liste de référence des restaurants d'Agroparc suivis par PDJ.
 * - `nom` : valeur exacte du champ `restaurant` des plats, clé des icônes et des liens.
 * - `slug` : `restaurant_slug` des cartes (`pdj_carte`) et des photos.
 * - `type` : core = historique (card « Fermé aujourd'hui » sans plat), optionnel = présent
 *   seulement les jours où il publie un plat, lien = aucun scraping (card lien seul).
 * - `carte` : une carte permanente est scrapée et notée par le pipeline.
 * L'ordre du tableau est l'ordre d'affichage des cards sans plat et des cartes.
 */
export type RestaurantType = "core" | "optionnel" | "lien";

export interface RestaurantDef {
  nom: string;
  slug: string;
  type: RestaurantType;
  carte: boolean;
}

export const RESTAURANTS: RestaurantDef[] = [
  { nom: "Le Bistrot Trèfle", slug: "bistrot_trefle", type: "core", carte: true },
  { nom: "La Pause Gourmande", slug: "pause_gourmande", type: "core", carte: false },
  { nom: "Le Truck Muche", slug: "truck_muche", type: "core", carte: false },
  { nom: "Basilic n'Go", slug: "basilic_ngo", type: "optionnel", carte: true },
  { nom: "Dubble", slug: "dubble", type: "optionnel", carte: true },
  { nom: "La Mijote", slug: "la_mijote", type: "optionnel", carte: true },
  { nom: "Vival", slug: "vival", type: "lien", carte: false },
];

export const SLUG_TO_RESTAURANT: Record<string, string> = Object.fromEntries(
  RESTAURANTS.map((r) => [r.slug, r.nom]),
);

/** Ligne de statut d'une card sans plat du jour. */
export function statutSansPlat(resto: RestaurantDef, isFuture: boolean): string {
  switch (resto.type) {
    case "core":
      return "Fermé aujourd'hui";
    case "optionnel":
      return isFuture ? "Plat du jour dévoilé le matin même" : "Pas de plat du jour aujourd'hui";
    case "lien":
      return "Bar à salades sur place";
  }
}

/** « La carte du Bistrot Trèfle », « La carte de la Mijote », « La carte de Dubble ». */
export function titreCarte(resto: RestaurantDef): string {
  if (resto.nom.startsWith("Le ")) return `La carte du ${resto.nom.slice(3)}`;
  if (resto.nom.startsWith("La ")) return `La carte de la ${resto.nom.slice(3)}`;
  return `La carte de ${resto.nom}`;
}
```

- [ ] **Step 4 : `lib/db.ts`**

Supprimer le bloc privé :

```ts
const SLUG_TO_RESTAURANT: Record<string, string> = {
  bistrot_trefle: "Le Bistrot Trèfle",
  ...
  la_mijote: "La Mijote",
};
```

et ajouter en tête de fichier (après l'import `pg`) : `import { SLUG_TO_RESTAURANT } from "@/lib/restaurants";`

Après `upsertCarte`, ajouter :

```ts
export interface CarteDisponible {
  slug: string;
  evaluated_at: string | null;
}

/** Cartes présentes en base (slug + date d'évaluation), sans le contenu : sert au SSR
 *  pour savoir quelles cards ont un dépliant « Voir la carte ». */
export async function getCartesDisponibles(): Promise<CarteDisponible[]> {
  await ensureCarteTable();
  const result = await sql`SELECT restaurant_slug, evaluated_at FROM pdj_carte`;
  return result.rows.map((r) => ({
    slug: r.restaurant_slug as string,
    evaluated_at: r.evaluated_at ? new Date(r.evaluated_at as string | Date).toISOString() : null,
  }));
}
```

- [ ] **Step 5 : `app/aide-moi-a-choisir/page.tsx`**

Remplacer la constante `SLUGS` par :

```ts
import { RESTAURANTS } from "@/lib/restaurants";

const SLUGS: { slug: string; nom: string }[] = RESTAURANTS.map((r) => ({ slug: r.slug, nom: r.nom }));
```

(l'import va avec les autres imports en tête de fichier ; Vival n'a pas de carte → `getCarte` renvoie `null`, `platsFromCarte(null, …)` renvoie `[]`, comportement inchangé).

- [ ] **Step 6 : Vérifier**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tests verts, aucune erreur de type.

- [ ] **Step 7 : Commit**

```bash
git add lib/restaurants.ts lib/restaurants.test.ts lib/db.ts app/aide-moi-a-choisir/page.tsx
git commit -m "feat(front): lib/restaurants (liste de référence, statuts) + getCartesDisponibles

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9 : `GET /api/carte?slug=`

**Files:**
- Modify: `app/api/carte/route.ts`

**Interfaces:**
- Consumes: `RESTAURANTS` (Task 8), `getCarte(slug)`.
- Produces: `GET /api/carte?slug=<slug>` → `Carte | null` (200), `{ error }` 400 si slug inconnu ; sans `slug` → `bistrot_trefle` (compatibilité avec l'ancien `fetch_carte_hash`).

- [ ] **Step 1 : Implémenter**

Remplacer la fonction `GET` :

```ts
import { RESTAURANTS } from "@/lib/restaurants";

const SLUGS_CONNUS = new Set(RESTAURANTS.map((r) => r.slug));

/** Lecture publique d'une carte (`?slug=`, défaut Trèfle) : rendu à la demande côté
 *  home + comparaison de hash côté pipeline. Slug inconnu → 400. */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug") ?? "bistrot_trefle";
  if (!SLUGS_CONNUS.has(slug)) {
    return NextResponse.json({ error: "Slug de restaurant inconnu" }, { status: 400 });
  }
  const carte = await getCarte(slug);
  return NextResponse.json(carte);
}
```

(placer l'import avec les autres, la constante après les imports ; `NextRequest` est déjà importé.)

- [ ] **Step 2 : Vérifier les types et, si la base est joignable, le comportement**

Run: `npx tsc --noEmit`
Expected: OK.

Puis (optionnel, nécessite `.env.local` pointant vers la base du VPS) : `npm run dev` dans un terminal, et

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/carte?slug=tholean"   # 400
curl -s "http://localhost:3000/api/carte?slug=dubble"                                   # null (pas encore de carte)
curl -s "http://localhost:3000/api/carte" | head -c 200                                 # carte du Trèfle
```

- [ ] **Step 3 : Commit**

```bash
git add app/api/carte/route.ts
git commit -m "feat(api): GET /api/carte?slug= (multi-restos, 400 si slug inconnu)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10 : `CarteRestaurant` (sections seules), `CarteLazy` (client), écouteur `pdj:mode-refresh`

**Files:**
- Rename: `app/CarteTrefle.tsx` → `app/CarteRestaurant.tsx`
- Create: `app/CarteLazy.tsx`
- Modify: `app/components/ClientScripts.tsx` (fin du `useEffect`, ~l.113-118)

**Interfaces:**
- Produces: `CarteRestaurant({ carte }: { carte: Carte })` (default export, rend `<div data-carte-sections>…</div>`) ; `CarteLazy({ slug, titre, icon, evaluatedAt, compact? })` (default export, client) ; événement DOM `pdj:mode-refresh` réappliquant le mode courant.

- [ ] **Step 1 : Renommer et alléger `CarteRestaurant`**

```bash
git mv app/CarteTrefle.tsx app/CarteRestaurant.tsx
```

Dans `app/CarteRestaurant.tsx` : supprimer l'import `getIcon`, et remplacer le composant `CarteTrefle` (tout ce qui suit `sortSectionPlats`) par :

```tsx
/** Sections d'une carte (tri par note moyenne, mode Sportif par défaut en SSR ; le tri
 *  dynamique selon le mode est fait côté client par applyMode sur [data-carte-sections]). */
export default function CarteRestaurant({ carte }: { carte: Carte }) {
  const sections = [...carte.sections]
    .map(sortSectionPlats)
    .sort((a, b) => sectionAvg(b, "sportif") - sectionAvg(a, "sportif"));

  const chevron = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="carte-chevron w-4 h-4 shrink-0">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );

  return (
    <div data-carte-sections>
      {sections.map((sec) => (
        <details key={sec.nom} data-carte-section className="mb-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-accent)]">
          <summary className="carte-summary flex items-center justify-between gap-3 px-3 py-2.5 cursor-pointer rounded-[var(--radius)]">
            <span className="text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">
              {sec.nom}
              <span className="ml-2 text-[var(--text-muted)] font-medium normal-case tracking-normal">({sec.plats.length})</span>
            </span>
            {chevron}
          </summary>
          <div className="px-3 pb-3 pt-1">
            {sec.plats.map((p, i) => (
              <CartePlatCard key={`${sec.nom}::${p.plat ?? i}`} plat={p} />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
```

- [ ] **Step 2 : Créer `app/CarteLazy.tsx`**

```tsx
"use client";

import { useEffect, useState, type SyntheticEvent } from "react";
import type { Carte } from "@/lib/db";
import CarteRestaurant from "./CarteRestaurant";

type Etat =
  | { statut: "idle" }
  | { statut: "chargement" }
  | { statut: "erreur" }
  | { statut: "ok"; carte: Carte };

interface Props {
  slug: string;
  /** « La carte du Bistrot Trèfle »… (affiché en mode non compact). */
  titre: string;
  /** SVG inline de l'icône du resto (getIcon), affiché en mode non compact. */
  icon: string;
  evaluatedAt: string | null;
  /** compact : résumé « Voir la carte » dans une card ; sinon en-tête pleine largeur (onglet). */
  compact?: boolean;
}

/** Dépliant qui va chercher la carte (`/api/carte?slug=`) au premier dépliage. */
export default function CarteLazy({ slug, titre, icon, evaluatedAt, compact = false }: Props) {
  const [etat, setEtat] = useState<Etat>({ statut: "idle" });

  // Les nœuds insérés après coup doivent recevoir le mode courant (Sportif/Goulaf) et le tri.
  useEffect(() => {
    if (etat.statut === "ok") window.dispatchEvent(new Event("pdj:mode-refresh"));
  }, [etat.statut]);

  const charger = async () => {
    setEtat({ statut: "chargement" });
    try {
      const res = await fetch(`/api/carte?slug=${encodeURIComponent(slug)}`);
      const carte = res.ok ? ((await res.json()) as Carte | null) : null;
      setEtat(carte ? { statut: "ok", carte } : { statut: "erreur" });
    } catch {
      setEtat({ statut: "erreur" });
    }
  };

  const onToggle = (e: SyntheticEvent<HTMLDetailsElement>) => {
    if (e.currentTarget.open && (etat.statut === "idle" || etat.statut === "erreur")) void charger();
  };

  const evalDate = evaluatedAt
    ? new Date(evaluatedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    : null;

  const chevron = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="carte-chevron w-4 h-4 shrink-0">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );

  return (
    <details
      onToggle={onToggle}
      className={
        compact
          ? "mt-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-accent)]"
          : "mb-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]"
      }
    >
      <summary className="carte-summary flex items-center justify-between gap-3 px-4 py-3 cursor-pointer rounded-[var(--radius)]">
        {compact ? (
          <span className="text-sm font-semibold text-[var(--accent)]">Voir la carte</span>
        ) : (
          <span className="flex items-center gap-2 text-lg font-bold tracking-tight" style={{ fontFamily: "var(--font-heading)" }}>
            <span dangerouslySetInnerHTML={{ __html: icon }} />
            {titre}
          </span>
        )}
        <span className="flex items-center gap-2 text-[var(--text-muted)] text-xs">
          {evalDate && <span className="hidden sm:inline">notée le {evalDate}</span>}
          {chevron}
        </span>
      </summary>
      <div className="px-4 pb-4 pt-1">
        {etat.statut === "chargement" && (
          <p className="text-sm text-[var(--text-muted)] italic py-2">Chargement de la carte…</p>
        )}
        {etat.statut === "erreur" && (
          <p className="text-sm text-[var(--bad)] py-2">Carte indisponible pour le moment.</p>
        )}
        {etat.statut === "ok" && <CarteRestaurant carte={etat.carte} />}
      </div>
    </details>
  );
}
```

- [ ] **Step 3 : `ClientScripts.tsx` — écouteur**

Remplacer la fin du `useEffect` :

```ts
    // ── Cart / Panier ────────────────────────────────────────────────────────
    initCart();

    return () => {
      cleanupMobileMenu?.();
    };
  }, [pathname]);
```

par :

```ts
    // ── Cart / Panier ────────────────────────────────────────────────────────
    initCart();

    // Cartes chargées à la demande (CarteLazy) : réappliquer le mode et le tri aux nœuds insérés.
    const onModeRefresh = () => applyMode(localStorage.getItem("pdj-mode") || "sportif");
    window.addEventListener("pdj:mode-refresh", onModeRefresh);

    return () => {
      cleanupMobileMenu?.();
      window.removeEventListener("pdj:mode-refresh", onModeRefresh);
    };
  }, [pathname]);
```

- [ ] **Step 4 : Vérifier les types**

Run: `npx tsc --noEmit`
Expected: une seule erreur attendue : `app/page.tsx` importe encore `./CarteTrefle` (corrigé à la Task 11). Aucune autre.

- [ ] **Step 5 : Commit**

```bash
git add app/CarteRestaurant.tsx app/CarteLazy.tsx app/components/ClientScripts.tsx
git commit -m "feat(front): CarteRestaurant (sections seules) + CarteLazy (chargement au clic) + pdj:mode-refresh

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11 : Home — `RestaurantSansPlatCard`, onglet « La carte » multi-restos, icône Vival

**Files:**
- Modify: `app/page.tsx` (imports l.1-9, `Home` l.13-31, `WeekView` l.80 et l.99, l.150-166, `DayPanel` l.186-246, `ClosedCard` l.290-304)
- Modify: `lib/icons.ts` (`RESTAURANT_ICON`, `RESTAURANT_LINKS`)
- Modify: `CLAUDE.md` (section Frontend structure)

**Interfaces:**
- Consumes: `getCartesDisponibles`, `CarteDisponible` (Task 8), `RESTAURANTS`, `statutSansPlat`, `titreCarte`, `RestaurantDef` (Task 8), `CarteLazy` (Task 10), `getIcon`, `OrderLinks` (existants).
- Produces: `RestaurantSansPlatCard({ resto, isFuture, carte? })` ; `WeekView` reçoit `cartes: CarteDisponible[]` ; `DayPanel` reçoit `cartesParSlug: Map<string, CarteDisponible>`.

- [ ] **Step 1 : `lib/icons.ts` — Vival**

Dans `RESTAURANT_ICON`, ajouter après `"La Mijote"` :

```ts
  "Vival":
    '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 11 4-7"/><path d="m19 11-4-7"/><path d="M2 11h20"/><path d="m3.5 11 1.6 7.4a2 2 0 0 0 2 1.6h9.8a2 2 0 0 0 2-1.6l1.7-7.4"/><path d="m9 11 1 9"/><path d="M4.5 15.5h15"/><path d="m15 11-1 9"/></svg>',
```

Dans `RESTAURANT_LINKS`, ajouter après `"La Mijote"` :

```ts
  "Vival": [
    {
      kind: "site",
      url: "https://magasins.vival.fr/fr/vival-montfavet",
      label: "Site",
    },
  ],
```

- [ ] **Step 2 : `app/page.tsx` — imports et `Home`**

Remplacer les imports :

```tsx
import { ensureTable, getWeekPdj, getCartesDisponibles } from "@/lib/db";
import { formatDate, formatDayShort, noteClass } from "@/lib/format";
import { getIcon, getRestaurantLinks, type RestaurantLink } from "@/lib/icons";
import type { Plat, PdjEntry, Recommandation, CarteDisponible } from "@/lib/db";
import { RESTAURANTS, statutSansPlat, titreCarte, type RestaurantDef } from "@/lib/restaurants";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import CommentSection from "./CommentSection";
import MacrosPanel from "./MacrosPanel";
import CarteLazy from "./CarteLazy";
```

Dans `Home` : remplacer `const carte = await getCarte("bistrot_trefle");` par
`const cartes = await getCartesDisponibles();` et `carte={carte}` par `cartes={cartes}`.

- [ ] **Step 3 : `WeekView`**

Signature :

```tsx
function WeekView({ weekPdj, cartes, prevHref, nextHref, currentMonday }: { weekPdj: PdjEntry[]; cartes: CarteDisponible[]; prevHref: string; nextHref: string; currentMonday: string }) {
  const cartesParSlug = new Map(cartes.map((c) => [c.slug, c]));
```

Remplacer `{carte && <ViewTabs />}` par `{cartes.length > 0 && <ViewTabs />}`.

Remplacer l'appel `DayPanel` :

```tsx
      {weekPdj.map((pdj, i) => (
        <DayPanel key={pdj.date} pdj={pdj} index={i} isDefault={i === defaultIdx} today={today} cartesParSlug={cartesParSlug} />
      ))}
```

Remplacer le panneau carte :

```tsx
      {cartes.length > 0 && (
        <div data-view-panel="carte" style={{ display: "none" }}>
          <ModeSelector />
          {RESTAURANTS.filter((r) => cartesParSlug.has(r.slug)).map((r) => (
            <CarteLazy
              key={r.slug}
              slug={r.slug}
              titre={titreCarte(r)}
              icon={getIcon(r.nom)}
              evaluatedAt={cartesParSlug.get(r.slug)?.evaluated_at ?? null}
            />
          ))}
        </div>
      )}
```

- [ ] **Step 4 : `DayPanel` et `RestaurantSansPlatCard`**

Signature de `DayPanel` :

```tsx
function DayPanel({ pdj, index, isDefault, today, cartesParSlug }: { pdj: PdjEntry; index: number; isDefault: boolean; today: string; cartesParSlug: Map<string, CarteDisponible> }) {
```

Remplacer le bloc final :

```tsx
      {RESTAURANTS_ATTENDUS.filter((r) => !pdj.plats.some((p) => p.restaurant === r)).map((r) => (
        <ClosedCard key={r} restaurant={r} />
      ))}
```

par :

```tsx
      {RESTAURANTS.filter((r) => !pdj.plats.some((p) => p.restaurant === r.nom)).map((r) => (
        <RestaurantSansPlatCard key={r.slug} resto={r} isFuture={isFuture} carte={cartesParSlug.get(r.slug)} />
      ))}
```

Supprimer `const RESTAURANTS_ATTENDUS = [...]` et la fonction `ClosedCard`, et ajouter à sa place :

```tsx
/** Card compacte d'un resto sans plat du jour : statut + liens + dépliant carte si disponible. */
function RestaurantSansPlatCard({ resto, isFuture, carte }: { resto: RestaurantDef; isFuture: boolean; carte?: CarteDisponible }) {
  return (
    <Card className="bg-[var(--surface)] border-[var(--border)] border-dashed opacity-90 mb-4 sm:mb-5">
      <CardContent className="p-6">
        <div className="flex items-center justify-between gap-2 mb-3">
          <span className="flex items-center gap-2 text-[var(--text-secondary)] font-semibold text-sm">
            <span dangerouslySetInnerHTML={{ __html: getIcon(resto.nom) }} />
            {resto.nom}
          </span>
          <OrderLinks restaurant={resto.nom} />
        </div>
        <div className="text-sm text-[var(--text-muted)] italic">{statutSansPlat(resto, isFuture)}</div>
        {carte && (
          <CarteLazy slug={resto.slug} titre={titreCarte(resto)} icon={getIcon(resto.nom)} evaluatedAt={carte.evaluated_at} compact />
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5 : Vérifier types, tests, build**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: aucune erreur ; le build liste `/` et `/api/carte`.

- [ ] **Step 6 : Vérification visuelle (si la base est joignable)**

`npm run dev`, ouvrir `http://localhost:3000` :
- Aujourd'hui : après les plats, une card par resto sans plat (Trèfle avec « Voir la carte », Basilic/Dubble/Mijote « Pas de plat du jour aujourd'hui », Vival « Bar à salades sur place » + bouton Site).
- Cliquer « Voir la carte » sur le Trèfle → « Chargement… » puis sections notées ; basculer Goulaf → les notes changent dans le dépliant.
- Onglet « La carte » : un dépliant « La carte du Bistrot Trèfle » (les autres apparaîtront une fois les cartes publiées).
- Onglet d'un jour futur : optionnels en « Plat du jour dévoilé le matin même ».

- [ ] **Step 7 : `CLAUDE.md` — section Frontend structure**

Remplacer la ligne de `app/page.tsx` par :

```
- `app/page.tsx` — Main page (SSR), builds the full week view with day tabs, mode selector, plat cards ; une `RestaurantSansPlatCard` par resto de `lib/restaurants.ts` sans plat (statut + liens + dépliant carte) ; onglet « La carte » = un `CarteLazy` par carte disponible
```

Ajouter :

```
- `lib/restaurants.ts` — Liste de référence des restos (nom exact, slug, type core/optionnel/lien, carte scrapée ou non), ordre d'affichage, `statutSansPlat`, `titreCarte`
- `app/CarteRestaurant.tsx` / `app/CarteLazy.tsx` — Sections notées d'une carte (`pdj_carte`) ; `CarteLazy` (client) va chercher `/api/carte?slug=` au premier dépliage et émet `pdj:mode-refresh`
```

Dans « Project Overview », remplacer « 3 optional (Basilic n'Go, Dubble, La Mijote, present only on days they publish a dish) » par « 3 optional (Basilic n'Go, Dubble, La Mijote : card « pas de plat du jour » + carte permanente notée les jours sans plat) + Vival (bar à salades, card lien seul, aucun scraping) ». Le Tholéan n'est pas mentionné.

- [ ] **Step 8 : Commit**

```bash
git add app/page.tsx lib/icons.ts CLAUDE.md
git commit -m "feat(front): cards sans plat du jour pour tous les restos + onglet carte multi-restos + Vival

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12 : Vérification complète et PR

**Files:** aucun nouveau.

- [ ] **Step 1 : Suites complètes**

```bash
cd "/Users/toam/Documents/PDJ Master" && npx tsc --noEmit && npx vitest run && npm run build
cd plats-du-jour && .venv/bin/python -m pytest -q
```

Expected: tout vert. Coller la sortie (nombre de tests) dans le compte rendu.

- [ ] **Step 2 : Test réel d'une carte sans publier**

Depuis `plats-du-jour/` (le venv a `pypdf`) :

```bash
.venv/bin/python -c "
from scrapers import basilic_ngo, dubble, la_mijote
for m in (basilic_ngo, dubble, la_mijote):
    c = m.scrape_carte()
    if c is None: print(m.__name__, '→ None'); continue
    print(m.__name__, c['hash'][:8], 'sections' if 'sections' in c else f\"texte {len(c['texte'])} car.\")
"
```

Expected : Basilic → `sections` ; Dubble → `texte ≈ 4700 car.` ; La Mijote → `texte` (> 200 car.). Aucun appel LLM ni publication.

- [ ] **Step 3 : Pousser et ouvrir la PR**

```bash
git push -u origin feat/cartes-restaurants
gh pr create --title "feat: cartes multi-restos + cards sans plat du jour (Basilic n'Go, Dubble, La Mijote, Vival)" --body "$(cat <<'EOF'
## Résumé
- Card pour chaque resto attendu même sans plat du jour (historiques « Fermé aujourd'hui », optionnels « Pas de plat du jour aujourd'hui », Vival lien seul), avec dépliant « Voir la carte » chargé au clic (`/api/carte?slug=`).
- Onglet « La carte » multi-restos (Trèfle + Basilic n'Go + Dubble + La Mijote), chargement à la demande.
- Pipeline : registre `CARTE_SOURCES`, cartes hash-gardées ; Basilic via ObyPay (déterministe), Dubble (PDF, `pypdf`) et La Mijote (HTML) via texte brut + structuration LLM seulement quand le hash change ; commande `python main.py cartes [slug] [--force]`.
- `lib/restaurants.ts` : liste de référence (nom, slug, type, carte).

Spec : `docs/superpowers/specs/2026-09-09-cartes-restaurants-design.md` · Plan : `docs/superpowers/plans/2026-09-09-cartes-restaurants.md`

## Après merge
Rebuild Docker sur le VPS (dépendance `pypdf`) puis `python main.py cartes` dans le conteneur.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4 : STOP — demander à Thomas la validation du merge et du déploiement VPS** (actions externes, non réversibles à la légère). Ne pas merger ni déployer sans son accord explicite.

---

### Task 13 : Déploiement (après accord de Thomas)

**Files:** aucun dans le dépôt.

- [ ] **Step 1 : Merge**

```bash
gh pr merge --merge --delete-branch
git checkout main && git pull
```

Vercel déploie `main` automatiquement (front + API). Vérifier : `curl -s "$VERCEL_API_URL/api/carte?slug=dubble"` → `null` (200), `?slug=tholean` → 400 (lire `VERCEL_API_URL` dans `plats-du-jour/.env`).

- [ ] **Step 2 : Rebuild du conteneur VPS** (mémoire `project_vps_deployment` : exclure `.env` pour préserver `CLAUDE_CODE_OAUTH_TOKEN`)

```bash
cd "/Users/toam/Documents/PDJ Master"
rsync -az --exclude '.env' --exclude '.venv' --exclude '__pycache__' --exclude output --exclude logs plats-du-jour/ vps:/opt/pdj/
ssh vps 'cd /opt/pdj && docker compose up -d --build'
ssh vps 'docker exec pdj-plats-du-jour-1 python -c "import pypdf; print(pypdf.__version__)"'
```

- [ ] **Step 3 : Peupler les cartes sans attendre lundi**

```bash
ssh vps 'docker exec pdj-plats-du-jour-1 ionice -c 3 nice -n 19 python main.py cartes'
```

Expected dans la sortie : `bistrot_trefle : carte inchangée`, puis pour `basilic_ngo`, `dubble`, `la_mijote` : `carte modifiée → ré-évaluation...` et `carte publiée (hash …)`. Durée : plusieurs minutes (2 appels `claude -p` pour Dubble et La Mijote, 1 pour Basilic, CPU plafonné à 0,5). Si un slug échoue (`erreur structuration/évaluation`), relancer `python main.py cartes <slug>`.

- [ ] **Step 4 : Vérifier en prod**

```bash
curl -s "$VERCEL_API_URL/api/carte?slug=dubble" | head -c 400
```

Ouvrir la home : les cards Basilic/Dubble/Mijote ont « Voir la carte » ; l'onglet « La carte » liste les 4 cartes ; le mode Goulaf s'applique après ouverture d'un dépliant.

- [ ] **Step 5 : Mémoire**

Mettre à jour `~/.claude/projects/-Users-toam-Documents-PDJ-Master/memory/reference_restaurants_agroparc_scrapables.md` : cartes scrapées (sources, hash, `main.py cartes`), Vival (bar à salades, lien seul, nom de l'enseigne inconnu), Tholéan reporté (IG 401 / FB mur / Uber Eats anti-bot, à retenter depuis le VPS). Pointeur `MEMORY.md` inchangé si l'entrée existe déjà.
