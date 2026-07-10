# Fiabilisation de la pipeline PDJ — état de run idempotent + retries

Date : 2026-07-10

## Objectif

Fiabiliser la récupération quotidienne des plats du jour sans pic CPU sur le VPS :

1. Un scraper qui échoue (IG 429, site changé, timeout) ne doit plus faire perdre
   le jour/la semaine : les morceaux ratés sont **retentés automatiquement** dans
   la matinée, ce qui a réussi est conservé.
2. Plus d'échec silencieux : la complétude du jour est visible sur `/admin`
   (statut `partial` orange), sans nouveau canal d'alerte.
3. Une étape IA qui plante (éval diet, commentaires) ne fait pas tomber le run :
   **publication en mode dégradé** (plats sans scores/commentaires), complétée au
   retry suivant.
4. Le cache hebdo Truck survit aux rebuilds du conteneur (volume déjà en place,
   à vérifier côté VPS).

## Contrainte CPU

Jamais deux runs pipeline en parallèle. Le plafond existant (0.5 vCPU conteneur,
`nice`/`ionice`) reste inchangé ; les retries sont légers par construction
(no-op ~2 s si le jour est complet) et sérialisés par un lock global.

## Architecture

```
cron conteneur                    entrypoint.sh (flock global)
 7h30  run principal   ──────────►  main.py <mode>
 7h45→10h00 (toutes les 15 min) ─►  main.py <mode> --retry
                                        │
                              output/run_state_<date>.json   (volume Docker)
                                        │  (source de vérité intra-journée)
                              ne refait QUE ce qui manque, puis publie l'agrégat
```

Le poller `/admin` (`poll_runs.sh`, `docker compose run`) passe par le même
`entrypoint.sh`, donc par le même lock.

## 1. État de run — `plats-du-jour/run_state.py`

Nouveau module. Fichier `output/run_state_<date>.json` (volume Docker) :

```json
{
  "date": "2026-07-10",
  "mode": "jour",
  "attempts": 2,
  "scrapes": {
    "bistrot_trefle": {"ok": true, "data": {"restaurant": "…", "plat": "…", "prix": "…"}},
    "pause_gourmande": {"ok": true, "data": {…}},
    "truck_muche": {"ok": false, "erreur": "IG 429"}
  },
  "semaine": {"trefle": {…} , "truck": null},
  "eval_par_resto": {"bistrot_trefle": {…plat évalué (scores, macros)…}},
  "commentaires_par_resto": {"bistrot_trefle": [{…}]},
  "futurs_publies": false,
  "carte_traitee": true,
  "complet": false
}
```

API : `load(date) -> RunState`, `save(state)`, propriété `complet` calculée
(tous les scrapes ok + tous les plats évalués + commentaires présents +
futurs publiés si applicable). Fichier illisible/corrompu → warning + état
vierge (comportement actuel). Jour férié → état créé directement `complet`.
Les fichiers d'état des jours précédents sont purgés au passage (garde ~7 jours).

## 2. Refactor `main.py` — étapes idempotentes

`run_jour` / `run_semaine` sont découpés en étapes qui consultent l'état et ne
font que le travail manquant, en sauvant l'état après chaque étape :

1. **Scrape** : seuls les restos sans `ok: true` sont re-scrapés. Un succès
   écrit ses données dans l'état → jamais re-scrapé ce jour-là (Instagram
   n'est pas re-sollicité après un succès). `repair_team` n'est lancée que sur
   les échecs restants, au premier run seulement (pas à chaque retry).
2. **Semaine** (mode `semaine`, et `_publier_jours_futurs` en mode `jour`) :
   `scrape_semaine` Trèfle/Truck stockés dans `state.semaine` ; retentés
   uniquement si absents.
3. **Éval diet** : appelée uniquement sur les plats sans entrée dans
   `eval_par_resto` ; résultats mergés. Échec → plat publié sans scores
   (dégradé), retenté au retry suivant. Les recommandations (sportif/goulaf)
   sont recalculées quand l'ensemble des plats évalués change.
4. **Commentaires** : générés uniquement pour les restos sans entrée dans
   `commentaires_par_resto` ; échec non bloquant, retenté ensuite.
   `commentaires_semaine.json` continue d'être alimenté comme aujourd'hui.
5. **Jours futurs** : évalués/publiés une fois (`futurs_publies: true`) ;
   refaits seulement si de nouvelles données semaine sont arrivées depuis.
6. **Publication** : à chaque run ayant travaillé, publication de l'agrégat
   courant (`publish_pdj`) — le site montre dès 7h35 ce qu'on a.
7. **Sortie rapide** : si `complet` à l'entrée → une ligne de log, exit 0, ~2 s.

La carte Trèfle (`_traiter_carte`, lundi) est marquée dans l'état
(`carte_traitee`) pour ne pas être re-scrapée à chaque retry, mais son échec ne
compte pas dans `complet` (bonus, pas cœur du produit). Idem `idee_agent` et
`sync-feedback` : hors complétude.

## 3. Ordonnancement — cron conteneur (Dockerfile)

Lignes existantes conservées (7h30 semaine le lundi, jour mar-ven, desserts 13h).
Ajout des retries **toutes les 15 minutes de 7h45 à 10h00** :

```
45 7        * * 1-5 root /entrypoint.sh retry >> /app/logs/cron.log 2>&1
0,15,30,45 8-9 * * 1-5 root /entrypoint.sh retry >> /app/logs/cron.log 2>&1
0 10        * * 1-5 root /entrypoint.sh retry >> /app/logs/cron.log 2>&1
```

`entrypoint.sh retry` résout le mode du jour (lundi → `semaine`, sinon `jour`)
et lance `main.py <mode> --retry`. Dès que l'état est complet, chaque slot
restant est un no-op (~2 s). Le slot de 10h00 est le dernier : s'il se termine
incomplet, il reporte `error`.

## 4. Lock global inter-conteneurs

`flock` sur `output/pdj_run.lock` (volume partagé → le verrou traverse les
conteneurs `cron -f` et `docker compose run` du poller, même kernel), pris dans
`entrypoint.sh` :

- run principal 7h30 et runs poller `/admin` : `flock -w 900` (attend jusqu'à
  15 min, puis abandonne avec log) ;
- retries : `flock -n` → si un run tourne déjà, le slot saute son tour (le
  suivant, 15 min plus tard, rattrapera).

Garantie : jamais deux pipelines en parallèle, quel que soit le déclencheur
(cron interne, retry, bouton /admin).

## 5. Reporting `/admin`

- Un retry **no-op ne reporte pas** (pas de bruit : jusqu'à 10 slots/jour).
- Un retry qui a travaillé reporte avec `triggered_by: "cron-retry"`.
- Nouveau statut **`partial`** : un run qui se termine avec des données
  publiées mais un état incomplet reporte `partial` (badge orange sur /admin,
  à ajouter dans `AdminDashboard.tsx`). Le run de 10h00 encore incomplet
  reporte `error` (badge rouge = journée définitivement incomplète).
- Le log inclut une ligne de synthèse de complétude, ex. :
  `[état] scrapes 2/3 (truck_muche: IG 429) · éval 2/2 · commentaires 2/2`.
- Côté API : `report/route.ts` accepte `status: "partial"` et
  `triggered_by: "cron-retry"` ; aucune autre modification de schéma
  (`pipeline_runs.status` est du texte libre).

## 6. Volume Docker / cache Truck

`./output` est déjà monté en volume dans `docker-compose.yml` (le cache
`output/truck_muche_semaine.json` et le nouvel état de run persistent donc
déjà). Action au déploiement : **vérifier que le compose du VPS a bien ce
montage** ; sinon l'ajouter (c'était la cause du « cache Truck perdu »).

## Gestion d'erreurs

- État corrompu/illisible → warning, repart d'un état vierge.
- Report API injoignable → best-effort comme aujourd'hui (le run local aboutit).
- Lock non obtenu : retry → skip silencieux ; run principal/poller → log +
  abandon après timeout.
- Crash en plein run : l'état contient tout ce qui a été sauvé avant le crash ;
  le retry suivant reprend au bon endroit (le lock est libéré à la mort du
  process, comportement natif de flock).

## Hors périmètre (YAGNI)

- Pas de retry après 10h00 ; pas d'alerte externe (email/push).
- Pas de modification des scrapers ni de la logique repair_team.
- Pas de streaming de logs ; pas d'annulation de run.
- Pas de granularité intra-resto (un resto = une unité de retry).

## Tests / vérification

- Unitaires (`plats-du-jour/tests/`) : `run_state` — calcul de `complet`,
  merge éval/commentaires, état corrompu → vierge, purge des vieux états.
- Manuel : forcer un échec Truck (mocker le scraper), lancer `jour`, vérifier
  publication partielle + `run_state` avec `truck_muche.ok=false` ; relancer
  avec `--retry` (scraper rétabli), vérifier que seuls Truck + son éval + ses
  commentaires sont refaits et que le site est complété.
- Manuel : run complet puis `--retry` → sortie en ~2 s sans appel réseau.
- `/admin` : vérifier badge `partial` et `triggered_by: cron-retry`.
