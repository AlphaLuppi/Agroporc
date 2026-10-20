"""
Images IA des plats du jour (POC) : génère une photo appétissante par variante de plat
et l'envoie à l'API Next (POST /api/plat-image). Best-effort : ne lève jamais.

Fournisseurs gratuits, essayés dans l'ordre (PDJ_IMAGES_FOURNISSEURS pour forcer) :
  - cloudflare   : Workers AI flux-1-schnell (compte gratuit, ~120 images/jour)
                   → CF_ACCOUNT_ID + CF_API_TOKEN (permission « Workers AI »).
  - horde        : AI Horde, Juggernaut XL (bénévole, file d'attente)
                   → AIHORDE_API_KEY (compte gratuit) ; sans clé, anonyme seulement si
                     PDJ_IMAGES_HORDE_ANONYME=1 (≈ 15-20 min d'attente par image).
  - pollinations : anonyme, sans compte. 1 image / 45 s / IP, qualité moyenne,
                   petit logo Pollinations dans un coin (laissé visible, crédit affiché sous
                   l'image dans le panneau : le tier anonyme ne permet pas de l'enlever).
Aucune diffusion locale : le VPS n'a ni GPU ni CPU à revendre.
"""
import base64
import json
import os
import re
import time
import urllib.parse

import requests

import plat_image
from publish import fetch_plat_images_existantes, publish_plat_image

USER_AGENT = "PlatsDuJour/1.0 (POC images; +https://github.com/AlphaLuppi)"
LARGEUR, HAUTEUR = 768, 512

# Budget maximal d'UNE image par fournisseur (sous-deadline) : un job lent ne vide pas le
# budget du lot, et on garde de quoi essayer le fournisseur suivant.
PLAFOND_S = {"cloudflare": 90.0, "horde": 300.0, "pollinations": 300.0}
# Budget restant minimal pour tenter un fournisseur : Horde (file d'attente de plusieurs
# minutes) est sauté dans le run de 7h30 (150 s) et laissé à la commande `images`.
BUDGET_MIN_S = {"horde": 240.0}
# Réservé au fournisseur suivant quand il y en a un (≈ 1 essai Pollinations).
RESERVE_SUIVANT_S = 60.0
# Plafond de lecture d'une réponse (base64 Cloudflare compris) avant valider_image.
LECTURE_MAX = 4 * plat_image.TAILLE_MAX
HOTES_HORDE = ("r2.cloudflarestorage.com", "aihorde.net")

POLLINATIONS_INTERVALLE = 46      # s entre deux appels (limite anonyme 1 / 45 s / IP)
POLLINATIONS_ESSAIS = 4
_dernier_appel_pollinations = 0.0


class Indisponible(Exception):
    """Fournisseur non configuré ou hors service : on passe au suivant."""


def _attendre(secondes: float, deadline: float) -> None:
    secondes = min(secondes, max(0.0, deadline - time.monotonic()))
    if secondes > 0:
        time.sleep(secondes)


def _retry_after(resp) -> float | None:
    """Délai demandé par le serveur (en-tête Retry-After ou « retry after N s » dans le corps)."""
    h = resp.headers.get("Retry-After") if resp is not None else None
    if h and h.strip().isdigit():
        return float(h)
    try:
        m = re.search(r"retry after (\d+)", resp.text or "", re.I)
        return float(m.group(1)) if m else None
    except Exception:
        return None


def _lire_borne(resp, maximum: int = LECTURE_MAX) -> bytes:
    """Lit un corps `stream=True` sans dépasser `maximum` octets (sinon ValueError)."""
    try:
        taille = int(resp.headers.get("Content-Length") or 0)
    except (TypeError, ValueError):
        taille = 0
    if taille > maximum:
        resp.close()
        raise ValueError(f"réponse trop grosse ({taille} o annoncés)")
    morceaux, total = [], 0
    for bloc in resp.iter_content(64 * 1024):
        total += len(bloc)
        if total > maximum:
            resp.close()
            raise ValueError(f"réponse trop grosse (> {maximum} o)")
        morceaux.append(bloc)
    return b"".join(morceaux)


def _url_horde_sure(url) -> bool:
    """N'accepte que du https vers le stockage R2 utilisé par Horde."""
    try:
        u = urllib.parse.urlsplit(url if isinstance(url, str) else "")
    except ValueError:
        return False
    hote = (u.hostname or "").lower()
    return u.scheme == "https" and any(hote == h or hote.endswith("." + h) for h in HOTES_HORDE)


# ── Cloudflare Workers AI ───────────────────────────────────────────────────

def _cloudflare(prompt: str, seed: int, deadline: float) -> bytes:
    compte, jeton = os.getenv("CF_ACCOUNT_ID", ""), os.getenv("CF_API_TOKEN", "")
    if not compte or not jeton:
        raise Indisponible("CF_ACCOUNT_ID / CF_API_TOKEN absents")
    url = (f"https://api.cloudflare.com/client/v4/accounts/{compte}"
           "/ai/run/@cf/black-forest-labs/flux-1-schnell")
    timeout = max(5.0, min(90.0, deadline - time.monotonic()))
    resp = requests.post(url, json={"prompt": prompt, "steps": 6},
                         headers={"Authorization": f"Bearer {jeton}"}, timeout=timeout, stream=True)
    if resp.status_code in (401, 403):
        raise Indisponible(f"Cloudflare {resp.status_code} (jeton ?)")
    if resp.status_code == 429:
        raise Indisponible("Cloudflare : quota gratuit du jour épuisé")
    resp.raise_for_status()
    image = (json.loads(_lire_borne(resp)).get("result") or {}).get("image")
    if not image:
        raise ValueError("Cloudflare : pas de champ result.image")
    return base64.b64decode(image)


# ── AI Horde ────────────────────────────────────────────────────────────────

def _horde(prompt: str, seed: int, deadline: float) -> bytes:
    cle = os.getenv("AIHORDE_API_KEY", "")
    if not cle:
        if os.getenv("PDJ_IMAGES_HORDE_ANONYME") != "1":
            raise Indisponible("AIHORDE_API_KEY absente")
        cle = "0000000000"
    base = "https://aihorde.net/api/v2"
    entetes = {"apikey": cle, "User-Agent": USER_AGENT, "Client-Agent": "plats-du-jour:1:poc"}
    corps = {
        "prompt": f"{prompt} ### {plat_image.NEGATIF}",
        "params": {"width": LARGEUR, "height": HAUTEUR, "steps": 25, "cfg_scale": 6,
                   "sampler_name": "k_dpmpp_2m", "karras": True, "seed": str(seed), "n": 1},
        "models": ["Juggernaut XL"],
        "nsfw": False, "censor_nsfw": True, "r2": True,
    }
    resp = requests.post(f"{base}/generate/async", json=corps, headers=entetes, timeout=30)
    if resp.status_code not in (200, 202):
        raise Indisponible(f"Horde {resp.status_code} : {resp.text[:120]}")
    job = resp.json()["id"]
    try:
        while time.monotonic() < deadline:
            _attendre(10, deadline)
            chk = requests.get(f"{base}/generate/check/{job}", headers=entetes, timeout=20).json()
            if chk.get("faulted") or chk.get("is_possible") is False:
                raise Indisponible("Horde : job impossible / en échec")
            if chk.get("done"):
                st = requests.get(f"{base}/generate/status/{job}", headers=entetes, timeout=20).json()
                gens = st.get("generations") or []
                if not gens:
                    raise ValueError("Horde : aucune génération")
                url_img = gens[0].get("img")
                if not _url_horde_sure(url_img):
                    raise ValueError(f"Horde : URL d'image inattendue {str(url_img)[:80]!r}")
                img = requests.get(url_img, headers={"User-Agent": USER_AGENT}, timeout=60,
                                   stream=True, allow_redirects=False)
                img.raise_for_status()
                return _lire_borne(img)
        raise TimeoutError("Horde : budget de temps écoulé")
    except Exception:
        try:  # libère la place dans la file
            requests.delete(f"{base}/generate/status/{job}", headers=entetes, timeout=10)
        except Exception:
            pass
        raise


# ── Pollinations (anonyme) ──────────────────────────────────────────────────

def _pollinations(prompt: str, seed: int, deadline: float) -> bytes:
    global _dernier_appel_pollinations
    url = ("https://image.pollinations.ai/prompt/" + urllib.parse.quote(prompt, safe="")
           + f"?width={LARGEUR}&height={HAUTEUR}&seed={seed}")
    for essai in range(POLLINATIONS_ESSAIS):
        _attendre(POLLINATIONS_INTERVALLE - (time.monotonic() - _dernier_appel_pollinations), deadline)
        restant = deadline - time.monotonic()
        if restant < 10:
            raise TimeoutError("Pollinations : budget de temps écoulé")
        _dernier_appel_pollinations = time.monotonic()
        try:
            resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=min(150.0, restant),
                                stream=True)
            if resp.status_code == 200:
                return _lire_borne(resp)
        except requests.RequestException as e:
            print(f"[images] pollinations essai {essai + 1} : {e}")
            continue
        attente = _retry_after(resp)
        print(f"[images] pollinations essai {essai + 1} : HTTP {resp.status_code} {resp.text[:100]!r}")
        if resp.status_code not in (402, 429, 500, 502, 503, 504):
            break
        if resp.status_code in (402, 429):
            # FREE_LIMIT : le « Retry after N s » annoncé est trompeur, un refus relance la
            # fenêtre de 45 s (constaté le 20/10/2026) → intervalle complet + marge croissante.
            _dernier_appel_pollinations = time.monotonic() + 15 * essai
        elif attente is not None:
            # 503 « Classic API is at its limit, retry after 10s » : on rappelle après N s.
            _dernier_appel_pollinations = time.monotonic() - POLLINATIONS_INTERVALLE + attente + 2
    raise Indisponible(f"Pollinations : échec après {POLLINATIONS_ESSAIS} essais")


FOURNISSEURS = {"cloudflare": _cloudflare, "horde": _horde, "pollinations": _pollinations}


def fournisseurs_actifs() -> list[str]:
    """Ordre des fournisseurs : PDJ_IMAGES_FOURNISSEURS, sinon ceux configurés + pollinations."""
    force = [f.strip() for f in os.getenv("PDJ_IMAGES_FOURNISSEURS", "").split(",") if f.strip()]
    if force:
        return [f for f in force if f in FOURNISSEURS]
    ordre = []
    if os.getenv("CF_ACCOUNT_ID") and os.getenv("CF_API_TOKEN"):
        ordre.append("cloudflare")
    if os.getenv("AIHORDE_API_KEY") or os.getenv("PDJ_IMAGES_HORDE_ANONYME") == "1":
        ordre.append("horde")
    ordre.append("pollinations")
    return ordre


def _optimiser(data: bytes, content_type: str) -> tuple[bytes, str]:
    """Recadre en 3:2 et passe en WebP 768×512 (Pillow, dans requirements.txt ; sans lui l'image part telle quelle)."""
    try:
        from PIL import Image  # type: ignore
        import io
    except ImportError:
        return data, content_type
    try:
        im = Image.open(io.BytesIO(data)).convert("RGB")
        w, h = im.size
        cible = LARGEUR / HAUTEUR
        if w / h > cible:
            nw = int(h * cible)
            im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
        else:
            nh = int(w / cible)
            im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
        im = im.resize((LARGEUR, HAUTEUR))
        out = io.BytesIO()
        im.save(out, "WEBP", quality=80)
        return out.getvalue(), "image/webp"
    except Exception as e:
        print(f"[images] optimisation ignorée : {e}")
        return data, content_type


def sous_deadline_fournisseur(nom: str, maintenant: float, deadline: float, dernier: bool) -> float:
    """Deadline d'une tentative : plafond par fournisseur, et part réservée au suivant."""
    fin = min(deadline, maintenant + PLAFOND_S.get(nom, 120.0))
    if not dernier and deadline - maintenant > 2 * RESERVE_SUIVANT_S:
        fin = min(fin, deadline - RESERVE_SUIVANT_S)
    return fin


# Descriptions LLM : un seul appel par lot, plafonné pour laisser du budget aux images.
DESCRIPTION_TIMEOUT_MAX_S = 120
DESCRIPTION_PART_BUDGET = 0.4


def _appel_llm(prompt: str, timeout: float) -> str:
    """Un seul essai borné par `timeout` (pas les relances de `diet_agent._call_claude`, qui
    multiplieraient le délai et videraient le budget images du run de 7h30)."""
    import subprocess
    from agent.diet_agent import CLAUDE_BIN
    if os.getenv("ANTHROPIC_API_KEY"):
        import anthropic
        client = anthropic.Anthropic(timeout=timeout, max_retries=0)
        msg = client.messages.create(
            model="claude-sonnet-4-6", max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
        return msg.content[0].text
    if not CLAUDE_BIN:
        raise RuntimeError("ni ANTHROPIC_API_KEY ni CLI claude")
    res = subprocess.run([CLAUDE_BIN, "-p", prompt, "--output-format", "text"],
                         capture_output=True, text=True, timeout=timeout)
    if res.returncode != 0:
        raise RuntimeError(f"claude CLI : {res.stderr.strip()[:200]}")
    return res.stdout


def decrire(items: list[dict], timeout: float) -> dict[str, str]:
    """Descriptions visuelles anglaises {cle: description} par le LLM du pipeline.
    Best-effort : {} si le LLM est indisponible ou répond mal (on garde le libellé brut)."""
    if not items or timeout < 15 or os.getenv("PDJ_IMAGES_DESCRIPTION") == "off":
        return {}
    try:
        brut = _appel_llm(plat_image.prompt_descriptions(items), timeout)
    except Exception as e:
        print(f"[images] descriptions LLM indisponibles : {e}")
        return {}
    out = plat_image.parser_descriptions(brut, [it["cle"] for it in items])
    print(f"[images] descriptions LLM : {len(out)}/{len(items)}")
    return out


def generer(restaurant: str, plat: str, deadline: float, description: str | None = None) -> dict:
    """Génère l'image d'une variante : premier fournisseur qui renvoie une image valide.
    Renvoie {prompt, fournisseur, content_type, data} ; lève si tous échouent."""
    prompt = plat_image.construire_prompt(restaurant, plat, description)
    seed = plat_image.seed_image(restaurant, plat)
    erreurs = []
    noms = fournisseurs_actifs()
    for i, nom in enumerate(noms):
        maintenant = time.monotonic()
        if maintenant >= deadline:
            break
        if deadline - maintenant < BUDGET_MIN_S.get(nom, 0.0):
            erreurs.append(f"{nom}: budget restant insuffisant, sauté")
            continue
        sous_deadline = sous_deadline_fournisseur(nom, maintenant, deadline, dernier=i == len(noms) - 1)
        try:
            data = FOURNISSEURS[nom](prompt, seed, sous_deadline)
            ct = plat_image.valider_image(data)
            data, ct = _optimiser(data, ct)
            return {"prompt": prompt, "fournisseur": nom, "content_type": ct, "data": data}
        except Exception as e:
            erreurs.append(f"{nom}: {e}")
    raise RuntimeError("aucun fournisseur : " + " | ".join(erreurs) if erreurs else "budget écoulé")


def illustrer(pdjs: list[dict], budget_s: float, force: bool = False, max_images: int | None = None,
              sauver_dans=None) -> dict:
    """Génère et publie les images manquantes des PDJ donnés, dans la limite du budget.
    Ne lève jamais. Renvoie un bilan {a_faire, deja, ok, echecs, restantes}."""
    bilan = {"a_faire": 0, "deja": 0, "ok": 0, "echecs": 0, "restantes": 0}
    try:
        deadline = time.monotonic() + budget_s
        items, vus = [], set()
        for pdj in pdjs:
            try:
                a_faire = plat_image.a_illustrer(pdj)
            except Exception as e:  # un PDJ mal formé ne prive pas les autres d'images
                print(f"[images] PDJ {(pdj or {}).get('date') if isinstance(pdj, dict) else '?'} ignoré : {e}")
                continue
            for it in a_faire:
                if it["cle"] not in vus:
                    vus.add(it["cle"])
                    items.append(it)
        if not force and items:
            existantes = fetch_plat_images_existantes([it["cle"] for it in items])
            if existantes is None:
                print("[images] liste des images existantes indisponible → on ne génère rien")
                bilan["restantes"] = len(items)
                return bilan
            bilan["deja"] = sum(1 for it in items if it["cle"] in existantes)
            items = [it for it in items if it["cle"] not in existantes]
        bilan["a_faire"] = len(items)
        a_decrire = items if max_images is None else items[:max_images]
        descriptions = decrire(a_decrire, min(DESCRIPTION_TIMEOUT_MAX_S, budget_s * DESCRIPTION_PART_BUDGET))
        for i, it in enumerate(items):
            if time.monotonic() >= deadline or (max_images is not None and bilan["ok"] >= max_images):
                bilan["restantes"] = len(items) - i
                break
            try:
                res = generer(it["restaurant"], it["plat"], deadline, descriptions.get(it["cle"]))
            except Exception as e:
                print(f"[images] {it['restaurant']} — {it['plat']} : {e}")
                bilan["echecs"] += 1
                continue
            if sauver_dans is not None:
                try:
                    ext = res["content_type"].split("/")[1].replace("jpeg", "jpg")
                    (sauver_dans / f"{it['cle']}.{ext}").write_bytes(res["data"])
                except Exception as e:
                    print(f"[images] sauvegarde locale ratée : {e}")
            ok = publish_plat_image({
                "cle": it["cle"], "restaurant": it["restaurant"], "plat": it["plat"],
                "prompt": res["prompt"], "fournisseur": res["fournisseur"],
                "content_type": res["content_type"],
                "image_base64": base64.b64encode(res["data"]).decode("ascii"),
                "force": force,
            })
            if ok:
                bilan["ok"] += 1
                print(f"[images] {it['restaurant']} — {it['plat']} : OK ({res['fournisseur']}, "
                      f"{len(res['data']) // 1024} Ko)")
            else:
                bilan["echecs"] += 1
    except Exception as e:
        print(f"[images] erreur inattendue : {e}")
    print(f"[images] bilan {json.dumps(bilan)}")
    return bilan
