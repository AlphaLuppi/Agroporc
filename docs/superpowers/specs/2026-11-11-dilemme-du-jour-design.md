# Dilemme du jour : conception finale

Date : 2026-11-11. Branche : `claude/dilemme-du-jour`. Aucun changement Python, aucun changement de protocole, `wt-fusion/` n'est pas touché.

## 1. Produit

Une nouvelle entrée de menu, « Dilemme », avec deux pages.

- **`/dilemme`** : le duel du jour, par exemple « Croziflette » contre « Pâtes carbonara ». Deux plats déjà servis, chacun avec sa photo si elle existe. Chaque personne vote « en tant que Thomas » (ou Gab, Jimmy…). Un nouveau duel chaque jour calendaire, week-ends et fériés compris, car le duel ne dépend pas du menu du jour. On peut changer d'avis jusqu'à minuit (heure de Paris). Les duels passés se consultent (`?jour=YYYY-MM-DD`) en lecture seule.
- **`/dilemme/plats`** : l'historique de TOUS les plats déjà servis, avec photo (ou un fond d'assiette), restaurant, dates de service, notes Sportif et Goulaf, victoires en duel. Recherche, filtre par restaurant, filtre « avec photo », tri, pagination.

Arbitrages (écarts entre les deux propositions) :

| Sujet | Décision | Raison |
|---|---|---|
| Jours de duel | Tous les jours calendaires | Aucune règle de week-end à tester ni à expliquer |
| Pool du jour J | Plats dont la première date de service est `< J` | Le tirage ne dépend pas de l'heure de création, le menu du jour n'est pas « grillé » |
| Duel | Figé en base à la première demande | Les votes pointent vers un duel stable même si l'algorithme ou le vivier change |
| Suspense | Résultats masqués dans l'interface avant le vote, bouton « Voir les résultats » | Le serveur renvoie tout, secret purement d'interface : le site est privé, on n'invente pas une fausse sécurité |
| Classement | Part de voix lissée, aucun Elo | Un plat joue 0 à 2 duels dans sa vie |
| Identité | Les 16 personnages (IA comprises), aucun nom libre, aucun personnage présélectionné | Même modèle que `/idees`, usurpation assumée (site privé) |
| Photos utilisateur (`pdj_photos`) | Non utilisées | Lien faible (`plat_nom` brut), destinées aux portions |
| Anciennes photos | Hors périmètre : `python main.py images DEBUT..FIN` sur le pipeline | À signaler à Thomas dans le message de PR |

## 2. Fichiers

### À créer

| Fichier | Rôle |
|---|---|
| `lib/dilemme.ts` | Module PUR : catalogue, `memePlat`, PRNG, `choisirDuel`, résumé, statistiques, classement, validation, voisins de duel, liste de votants. Aucun import de `node:crypto`, de `lib/db` (types seulement) ni de React |
| `lib/dilemme.test.ts` | Tests du module ci-dessus |
| `lib/historique-plats.ts` | PUR : paramètres de l'URL, filtre, tri, pagination de l'historique |
| `lib/historique-plats.test.ts` | |
| `lib/limiteur-debit.ts` | PUR : `creerLimiteur`, `ipDeRequete` |
| `lib/limiteur-debit.test.ts` | |
| `lib/votant.ts` | PUR : clé `localStorage`, lecture validée, écriture, événement |
| `lib/votant.test.ts` | |
| `lib/dilemme-serveur.ts` | Serveur : orchestration (catalogue mis en cache, images, création du duel, état d'un duel, traitement d'un vote). Importe `lib/db`, `clePlatImage` |
| `lib/dilemme-api.test.ts` | Logique de `dilemme-serveur` et des deux routes, avec `vi.mock("./db")` |
| `lib/dilemme-rendu.test.ts` | Rendu statique des composants sans état + garde de la navigation |
| `app/api/dilemme/route.ts` | GET (fine enveloppe sur `dilemme-serveur`) |
| `app/api/dilemme/vote/route.ts` | POST (idem) |
| `app/components/useVotant.ts` | Hook client `useSyncExternalStore` |
| `app/components/SelecteurVotant.tsx` | Sélecteur « en tant que », client |
| `app/dilemme/page.tsx`, `loading.tsx`, `dilemme.module.css` | Page du duel |
| `app/dilemme/DilemmeDuel.tsx` | Client : cartes, vote, résultats |
| `app/dilemme/ResultatsCote.tsx` | Composant SANS état (barre, pourcentage, votants), testable en rendu statique |
| `app/dilemme/SousNav.tsx` | Deux `next/link` « Le duel » / « Tous les plats », `aria-current`, composant serveur sans état partagé par les deux pages |
| `app/dilemme/plats/page.tsx`, `loading.tsx` | Historique |

### À modifier

- `lib/db.ts` : types et fonctions SQL de la section 4.
- `lib/migrate.mjs` : même SQL que `ensureDilemmeTables`, inséré juste avant `console.log("[migrate] Terminé.")`.
- `app/layout.tsx` : lien « Dilemme » entre « Recettes » et « Idées », dans la barre desktop (classes `px-1.5 lg:px-3 py-2`, `whitespace-nowrap`) ET dans le menu burger (classes `px-3 py-2.5`). Oublier l'un des deux blocs est l'erreur la plus probable.
- `app/globals.css` : après la règle `nth-child(5)` du menu mobile, ajouter `#mobile-menu [data-nav-links] a:nth-child(6) { --i: 5; }` et `nth-child(7) { --i: 6; }` (le menu passe à 7 liens).
- `CLAUDE.md` : section « Dilemme du jour » (tables, règle du tirage, module `votant`, piège des photos du passé) et ligne dans la liste des commandes de tests.

Le lien actif est géré par `ClientScripts` (`startsWith`) : rien à coder. Aucun autre lien ne doit préfixer `/dilemme`.

## 3. Schéma SQL exact

Même texte dans `ensureDilemmeTables()` (`lib/db.ts`) et dans `lib/migrate.mjs`. Pas de clé étrangère (convention des tables `pdj_*`).

```sql
CREATE TABLE IF NOT EXISTS pdj_dilemmes (
  jour          DATE         PRIMARY KEY,
  a_cle         VARCHAR(64)  NOT NULL,
  a_restaurant  VARCHAR(100) NOT NULL,
  a_plat        VARCHAR(300) NOT NULL,
  b_cle         VARCHAR(64)  NOT NULL,
  b_restaurant  VARCHAR(100) NOT NULL,
  b_plat        VARCHAR(300) NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT pdj_dilemmes_distincts CHECK (a_cle <> b_cle)
);

CREATE TABLE IF NOT EXISTS pdj_dilemme_votes (
  jour        DATE        NOT NULL,
  votant      VARCHAR(50) NOT NULL,
  choix       CHAR(1)     NOT NULL CHECK (choix IN ('a', 'b')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (jour, votant)
);
```

- `a_cle` / `b_cle` = `clePlatImage(restaurant, variante)` : la clé de l'image et de la recette. Le nom du restaurant est dans la clé, donc le même plat dans deux restaurants a deux clés.
- Le libellé du plat est figé dans le duel : l'affichage d'un duel passé ne dépend pas du catalogue.
- Les photos ne sont pas stockées : résolues à l'affichage par `platImagesExistantes`, une image générée plus tard apparaît donc toute seule.
- Un vote par personne et par jour est garanti par `PRIMARY KEY (jour, votant)`. Les index des clés primaires suffisent (environ 250 duels par an).
- Les dates sont toujours lues avec `jour::text` (sinon `pg` renvoie un `Date` décalé par le fuseau).

## 4. `lib/db.ts` : fonctions à ajouter

Patron de `ensureTigreScoresTable` : `ensureDilemmeTables()` exportée, et un garde « une fois par processus » (`dilemmeTablesPretes: Promise<void> | null`, remis à `null` en cas d'échec). Chaque fonction ci-dessous commence par `await assurerTablesDilemme()`. Avantage : le site fonctionne même avant `npm run db:migrate`. Pool `pg` limité à 3 connexions : jamais plus de 2 requêtes en parallèle par page.

```ts
export interface LigneHistorique {
  date: string;                       // YYYY-MM-DD
  restaurant: string;
  plat: string | string[];
  prix: string | null;
  note: number | null;
  note_goulaf: number | null;
  options: { plat?: string | null; note?: number | null; note_goulaf?: number | null }[] | null;
}
export interface DilemmeLigne {
  jour: string;
  a_cle: string; a_restaurant: string; a_plat: string;
  b_cle: string; b_restaurant: string; b_plat: string;
}
export interface DuelAvecVoix extends DilemmeLigne { voix_a: number; voix_b: number }
export interface VoteDilemme { votant: string; choix: "a" | "b" }

export async function ensureDilemmeTables(): Promise<void>;
export async function getLignesHistorique(jusquAu: string): Promise<LigneHistorique[]>;
export async function getDilemme(jour: string): Promise<DilemmeLigne | null>;
export async function creerDilemmeSiAbsent(d: DilemmeLigne): Promise<void>;          // ON CONFLICT (jour) DO NOTHING
export async function getDuelsPasses(avant: string): Promise<{ jour: string; a_cle: string; b_cle: string }[]>; // jour desc
export async function getVotesDilemme(jour: string): Promise<VoteDilemme[]>;        // ORDER BY updated_at
export async function voterDilemme(jour: string, votant: string, choix: "a" | "b"): Promise<void>;
export async function getDuelsAvecVoix(avant: string): Promise<DuelAvecVoix[]>;     // jour desc, jour < avant
```

Requêtes clés.

```sql
-- getLignesHistorique : projection légère (pas d'ingredients_detail, de commentaires ni de justifications)
SELECT e.date::text AS date, p->>'restaurant' AS restaurant, p->'plat' AS plat,
       p->>'prix' AS prix, (p->>'note')::float AS note, (p->>'note_goulaf')::float AS note_goulaf,
       (SELECT jsonb_agg(jsonb_build_object('plat', o->>'plat', 'note', o->'note', 'note_goulaf', o->'note_goulaf'))
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p->'options') = 'array' THEN p->'options' ELSE '[]'::jsonb END) o) AS options
FROM pdj_entries e,
     jsonb_array_elements(CASE WHEN jsonb_typeof(e.data->'plats') = 'array' THEN e.data->'plats' ELSE '[]'::jsonb END) p
WHERE e.date <= $1::date AND COALESCE(p->>'coming_soon', 'false') <> 'true'
ORDER BY e.date;

-- voterDilemme
INSERT INTO pdj_dilemme_votes (jour, votant, choix) VALUES ($1::date, $2, $3)
ON CONFLICT (jour, votant) DO UPDATE SET choix = EXCLUDED.choix, updated_at = NOW();

-- getDuelsAvecVoix
SELECT d.jour::text AS jour, d.a_cle, d.a_restaurant, d.a_plat, d.b_cle, d.b_restaurant, d.b_plat,
       COUNT(v.votant) FILTER (WHERE v.choix = 'a')::int AS voix_a,
       COUNT(v.votant) FILTER (WHERE v.choix = 'b')::int AS voix_b
FROM pdj_dilemmes d LEFT JOIN pdj_dilemme_votes v ON v.jour = d.jour
WHERE d.jour < $1::date GROUP BY d.jour ORDER BY d.jour DESC;
```

`voterDilemme` n'exige pas que le duel existe : c'est `dilemme-serveur` qui l'a garanti juste avant (pas de clé étrangère, un vote orphelin est impossible en pratique car un duel n'est jamais supprimé). Un revote identique réécrit la ligne sans conséquence.

## 5. Modules purs

### 5.1 `lib/dilemme.ts`

```ts
export type Cote = "a" | "b";

/** Date de service d'un plat servi (`LigneHistorique` de lib/db). */
export interface PlatCatalogue {
  cle: string; base: string; restaurant: string;
  nom: string;                        // casseLisible(dernier libellé vu)
  dates: string[];                    // uniques, ordre croissant
  premiere: string; derniere: string; nbServices: number;
  prix: string | null;                // dernier prix non vide
  noteSportif: number | null;         // dernière occurrence notée
  noteGoulaf: number | null;
}

export function construireCatalogue(
  lignes: LigneHistorique[],
  cle: (restaurant: string, plat: string) => string,   // injectée : clePlatImage en production
  aujourdhui: string,
): PlatCatalogue[];                   // tri : derniere desc, puis nom
```

Règles de `construireCatalogue` :
- Une `LigneHistorique` est reconstruite en `Plat` (`restaurant`, `plat`, `prix`, `note`, `note_goulaf`, `options`) puis éclatée par `variantesPlat` ; jamais de lecture directe de `plat.plat` ni de `plat.note`.
- Regroupement par `baseClePlatImage(restaurant, variante.plat)`.
- Exclus : date `> aujourdhui` (publié d'avance), nom vide ou dont la forme normalisée (`normPlatImage`) a moins de 3 caractères, nom normalisé correspondant à `/\b(ferme|fermee|conges|pas de plat|indisponible|bientot|a venir)\b/`.
- Les jours fériés, jours sans plat et `coming_soon` ne produisent aucune ligne (le SQL les écarte).
- Les dates sont dédoublonnées ; `nbServices = dates.length`.

```ts
export function motsSignificatifs(nom: string): string[];        // normPlatImage, mots vides retirés
export function memePlat(a: { base: string; nom: string }, b: { base: string; nom: string }): boolean;
```
`memePlat` est vrai si : les bases sont égales ; ou les deux ensembles de mots significatifs sont non vides et l'un contient l'autre ; ou Jaccard ≥ 0,6. Mots vides : `de du des d la le les l au aux un une et en a avec sans sur sous sauce maison façon facon du chef et ses sa son`. Deux ensembles vides ne sont « même plat » que si les bases sont égales.

```ts
export function graineJour(texte: string): number;                // FNV-1a 32 bits
export function creerRng(graine: number): () => number;           // mulberry32, [0, 1)

export interface CandidatDuel { cle: string; base: string; restaurant: string; nom: string; aImage: boolean }
export interface DuelPasse { jour: string; a_cle: string; b_cle: string }
export const FENETRES_RECENTES = [14, 7, 0] as const;
export const MIN_CANDIDATS_PHOTO = 6;

export function choisirDuel(
  jour: string, candidats: CandidatDuel[], passes: DuelPasse[],
): { a: CandidatDuel; b: CandidatDuel } | null;
```

Algorithme de `choisirDuel` (aucun `Math.random`, aucune horloge) :
1. `rng = creerRng(graineJour("dilemme|v1|" + jour))`. Les candidats sont dédoublonnés par clé et triés par clé (résultat indépendant de l'ordre d'entrée). Seuls les `passes` de `jour < jour` comptent, du plus récent au plus ancien.
2. `joues(cle)` = nombre de duels passés où la clé apparaît. `paires` = ensemble des paires déjà jouées (clés triées).
3. Pour chaque fenêtre de `[14, 7, 0]` : les clés des `fenetre` derniers duels sont exclues. S'il reste au moins 2 candidats, on tente un tirage ; le premier succès est renvoyé ; `null` si aucune fenêtre ne donne rien.
4. Tirage (jusqu'à 20 essais) :
   - A : si au moins 6 candidats ont une photo, A est tiré parmi eux ; sinon parmi tous. Poids `(aImage ? 4 : 1) / (1 + joues)`.
   - B : parmi les candidats qui ne sont ni A, ni `memePlat(A, ·)`, ni dans une paire déjà jouée avec A. Si A a une photo et qu'au moins un B compatible en a une, B est restreint à ceux-là. Poids `(aImage ? 4 : 1) × (restaurant différent de celui de A ? 3 : 1) / (1 + joues)`.
   - Aucun B compatible : A est retiré de l'urne et on recommence.
5. Ordre `a`/`b` permuté par `rng() < 0.5` (pas de biais de position).

```ts
export function candidatsDuJour(catalogue: PlatCatalogue[], jour: string, cleAvecImage: Set<string>): CandidatDuel[];
// = plats dont premiere < jour
```

```ts
export interface Resume {
  a: number; b: number; total: number; pctA: number; pctB: number;   // pctA + pctB = 100 sauf total = 0
  gagnant: Cote | "egalite" | null;                                 // null si total = 0
}
export function resumerVotes(a: number, b: number): Resume;          // arrondi au plus fort reste

export interface StatPlat {
  cle: string; restaurant: string; nom: string;
  duels: number; victoires: number; defaites: number; nuls: number;
  pour: number; contre: number; score: number;                       // score = (pour + 1) / (pour + contre + 2)
}
export function agregerStats(duels: DuelAvecVoix[]): Map<string, StatPlat>;   // duels à zéro vote ignorés
export function classerStats(stats: Iterable<StatPlat>): StatPlat[];          // pour + contre >= 2 ; tri score desc, victoires desc, duels desc, cle

export function dateIsoValide(s: unknown): s is string;              // ^\d{4}-\d{2}-\d{2}$ + aller-retour Date UTC (2026-02-30 refusé)
export type ValidationVote =
  | { ok: true; votant: string; choix: Cote; jour: string | null }
  | { ok: false; erreur: string };
export function validerVote(corps: unknown): ValidationVote;
export function voisinsDuel(jours: string[], jour: string): { precedent: string | null; suivant: string | null };
export function listeVotants(noms: string[], max?: number): string; // « Thomas, Gab et 2 autres », « » si vide, max = 3
```

`validerVote` :
- `corps` doit être un objet. `votant` : chaîne non vide de 50 caractères au plus, retrouvée par `CHARACTERS_BY_NAME[nomPersonnage(votant)]?.name` (casse canonique et alias hérités acceptés ; le nom stocké est TOUJOURS `.name`). Sinon « Personnage inconnu : choisis-en un dans la liste. » (le vérifier dans `lib/characters.ts`).
- `choix` : chaîne, `trim().toLowerCase()` ∈ {a, b}. Sinon « Choix invalide. ».
- `jour` : absent ou `null` → `null` (le serveur prendra aujourd'hui). Présent → `dateIsoValide`, sinon « Date invalide. ».
- Un objet `{ ok: false, erreur }` est toujours de statut 400.

`voisinsDuel(jours, jour)` : `jours` en désordre et avec doublons possibles ; renvoie le jour immédiatement avant et après `jour` dans la liste triée (null aux extrémités ou si `jour` est absent).

### 5.2 `lib/historique-plats.ts`

```ts
export const PAR_PAGE = 24;
export type TriHistorique = "recents" | "victoires" | "servis" | "alpha";
export interface ParametresHistorique {
  q: string; restaurant: string | null;       // slug de RESTAURANTS, sinon null
  tri: TriHistorique; photo: boolean; page: number;
}
export function parametresHistorique(sp: Record<string, string | string[] | undefined>): ParametresHistorique;
export function hrefHistorique(p: ParametresHistorique, surcharge?: Partial<ParametresHistorique>): string;

export interface PlatHistorique extends PlatCatalogue { victoires: number; aImage: boolean }
export function filtrerHistorique(
  plats: PlatHistorique[], p: ParametresHistorique,
): { plats: PlatHistorique[]; total: number; page: number; pages: number };
```
- `parametresHistorique` : valeur répétée → la dernière ; `q` tronqué à 60 caractères et espaces normalisés ; `restaurant` inconnu → null ; `tri` inconnu → `recents` ; `photo` vrai pour `1`/`on`/`true` ; `page` entier ≥ 1 (défaut 1).
- `hrefHistorique` : n'écrit que les valeurs différentes du défaut ; renvoie `/dilemme/plats` nu si tout est par défaut.
- Recherche : chaque mot de `q` (normalisé par `normPlatImage`) doit être un début de mot du nom normalisé (« croz » trouve « Croziflette », « carbo » trouve « Pâtes carbonara »).
- Restaurant : `SLUG_TO_RESTAURANT[slug] === plat.restaurant`.
- Tris : `recents` (derniere desc), `victoires` (victoires desc puis derniere desc), `servis` (nbServices desc puis derniere desc), `alpha` (`localeCompare("fr")`). Départage final par `cle` pour un résultat stable.
- Page bornée à `[1, pages]` ; `pages` ≥ 1 même sans résultat.
- Pas de redirection vers une URL nettoyée (formulaire GET sans doublons de paramètres) : le parseur tolérant suffit.

### 5.3 `lib/limiteur-debit.ts`

```ts
export interface Limiteur { essayer(cle: string): boolean }       // true = autorisé
export function creerLimiteur(max: number, fenetreMs: number, maintenant?: () => number): Limiteur;
export function ipDeRequete(headers: { get(nom: string): string | null }): string;  // x-forwarded-for[0], x-real-ip, "unknown"
```
Fenêtre fixe par clé, purge paresseuse des entrées expirées à chaque appel (pas de `setInterval`). Les routes existantes ne sont pas touchées. Plafonds du vote : 30 par minute et par IP (le bureau partage probablement une adresse), 6 par minute et par votant. Limiteurs en constantes de module de la route.

### 5.4 `lib/votant.ts`

```ts
export const CLE_PERSONNAGE = "pdj-selected-character";           // même clé que /idees, /ia, commentaires, arène
export const EVENEMENT_VOTANT = "pdj:votant-refresh";
export function lireVotant(storage?: Pick<Storage, "getItem"> | null): string | null;   // valide contre CHARACTERS_BY_NAME, renvoie le nom canonique ; try/catch ; jamais d'exception
export function ecrireVotant(nom: string, storage?: Pick<Storage, "setItem"> | null, cible?: EventTarget | null): boolean; // refuse un nom inconnu, émet EVENEMENT_VOTANT, false si le stockage échoue
```
Les quatre fichiers qui redéclarent la constante ne sont pas refactorés dans cette PR. Par défaut `storage` = `window.localStorage` si disponible. `lib/votant.ts` n'importe aucun composant.

## 6. `lib/dilemme-serveur.ts` (serveur seulement)

```ts
export interface PlatDuel {
  cle: string; restaurant: string; nom: string;
  image: { src: string; credit?: string } | null;
  nbServices: number; derniere: string | null;                // 0 / null si le catalogue ne connaît plus le plat
}
export interface EtatDuel {
  jour: string; ouvert: boolean;                              // ouvert = (jour === aujourdhuiParis())
  dilemme: { a: PlatDuel; b: PlatDuel };
  voix: { a: number; b: number }; resume: Resume;
  votes: VoteDilemme[];                                       // pour les avatars et pour dériver « mon vote » côté client
  monVote: Cote | null;
}
export type ResultatEtat =
  | { ok: true; etat: EtatDuel }
  | { ok: false; status: 400 | 404 | 409 | 429 | 503; erreur: string; code?: "vivier" | "clos" | "limite" };

export async function chargerCatalogue(): Promise<PlatCatalogue[]>;   // cache mémoire 60 s (globalThis), requête getLignesHistorique(aujourdhui)
export async function imagesPourCles(cles: string[]): Promise<Map<string, { src: string; credit?: string }>>;  // platImagesExistantes, creditFournisseur, srcPlatImage ; {} si erreur
export async function assurerDilemme(jour: string): Promise<DilemmeLigne | null>;  // null = vivier insuffisant, rien d'écrit
export async function lireEtatDuel(jour: string | null, votant: string | null): Promise<ResultatEtat>;
export async function traiterVote(corps: unknown, ip: string, maintenant?: Date): Promise<ResultatEtat>;
```

`assurerDilemme(jour)` (uniquement pour `jour === aujourdhuiParis()`) : `getDilemme(jour)` → s'il existe, le renvoyer. Sinon : catalogue, `platImagesExistantes(clés des candidats)` pour construire `cleAvecImage`, `getDuelsPasses(jour)`, `choisirDuel`. `null` → renvoyer `null`. Sinon `creerDilemmeSiAbsent` (le premier qui écrit gagne) puis relire `getDilemme`. Deux requêtes simultanées produisent donc un seul duel.

`lireEtatDuel(jourParam, votant)` :
1. `jourParam` absent → aujourd'hui. Présent et `!dateIsoValide` → 400 « Date invalide. ».
2. `jour > aujourd'hui` → 404 « Pas de dilemme ce jour-là. ».
3. `jour === aujourd'hui` → `assurerDilemme` ; `null` → 404, `code: "vivier"`, « Pas encore assez de plats pour lancer un duel. Reviens demain ! ». `jour` passé → `getDilemme` ; absent → 404 « Pas de dilemme ce jour-là. » (pas de rétro-génération).
4. En parallèle : `getVotesDilemme` et `imagesPourCles([a, b])` (2 requêtes, jamais plus). `monVote` = vote du `votant` canonique, `null` si le paramètre est absent ou inconnu.
5. Toute exception de base de données → 503 « Le dilemme est indisponible pour le moment. ».

`traiterVote(corps, ip)` : ordre des contrôles, à respecter pour que les tests le fixent.
1. `corps` pas un objet → 400 « Requête invalide. ».
2. Honeypot `corps.website` non vide → `{ ok: true }` factice (la route renvoie `{ ok: true }` en 200 sans toucher à la base).
3. Limiteur IP épuisé → 429 « Trop de votes d'un coup, reprends ton souffle. », `code: "limite"`.
4. `validerVote` → 400 avec son message.
5. `jour` fourni et différent d'aujourd'hui (Paris) → 409 « Ce duel est terminé, rendez-vous demain. », `code: "clos"`.
6. Limiteur votant épuisé → 429 (même message).
7. `assurerDilemme(aujourd'hui)` ; `null` → 404 `code: "vivier"`.
8. `voterDilemme` puis `lireEtatDuel(aujourd'hui, votant)` ; `monVote` = le choix posé.
9. Exception base → 503 « Vote indisponible pour le moment. ».

## 7. Contrats d'API

Toutes les réponses : `Cache-Control: no-store`, JSON, messages en français, corps d'erreur `{ erreur: string, code?: string }`. Routes en `Response.json` (pas `NextResponse`), pour rester importables dans vitest.

### `GET /api/dilemme?jour=YYYY-MM-DD&votant=Nom`
`jour` et `votant` optionnels. 200 : `EtatDuel`. Erreurs : 400 date invalide, 404 (futur, passé sans duel, vivier insuffisant avec `code: "vivier"`), 503.

### `POST /api/dilemme/vote`
Corps JSON `{ votant: string, choix: "a" | "b", jour?: string, website?: string }`, 1 Ko au plus (au-delà : 400 « Requête invalide. »).
- 200 : `EtatDuel` avec `monVote` = le choix posé (ou `{ ok: true }` pour le honeypot).
- 400 : JSON invalide, `votant`, `choix` ou `jour` invalides.
- 404 : vivier insuffisant.
- 409 : duel clos.
- 429 : limite de débit.
- 503 : base indisponible.
Revoter pour le même plat réussit sans rien changer (idempotent). Le client reprend les décomptes renvoyés par le serveur : pas de mise à jour optimiste, donc pas de rollback.

Aucune route de classement ni d'historique : les deux pages sont rendues côté serveur.

## 8. Interface

Gabarit global : colonne de 860 px au plus déjà fournie par `app/layout.tsx`. Tokens uniquement (`--surface`, `--border`, `--border-control`, `--accent`, `--accent-soft`, `--good`, `--good-soft`, `--bad-soft`, `--bad-border`, `--text*`, `--radius`, `--font-heading`), jamais de couleur Tailwind en dur ni d'`opacity` pour atténuer un texte. Motif Tigre à reprendre : `html[data-theme="tigre"] .carte:not(:hover) { box-shadow: 0 0 0 1px var(--border-control); }`. Cibles tactiles ≥ 40 px. Les trois thèmes doivent être vérifiés. `export const metadata = { title: "Dilemme du jour — Agroporc" }` (et « Tous les plats — Agroporc »).

### `/dilemme` (page serveur, `export const dynamic = "force-dynamic"`)

Contenu de haut en bas : titre « Dilemme du jour » (`h1`, classes de `/recettes`), sous-titre, `SousNav`, date lisible du duel (`formatDate`), le duel (`DilemmeDuel`), « Duels précédents », « Classement des plats ».

Chargement serveur : `lireEtatDuel(searchParams.jour ?? null, null)` puis `getDuelsAvecVoix(aujourd'hui)` (catch → listes vides, avec un `role="alert"` seulement si le duel lui-même a échoué). Les deux premiers appels ne partent jamais en parallèle avec plus de 2 requêtes.

**`DilemmeDuel` (client)**, props : `etatInitial: EtatDuel`, `affichageDuJour: boolean`, `precedent: string | null`, `suivant: string | null`.
- Mobile (< 640 px) : cartes empilées, pastille « contre » entre les deux. Dès 640 px : deux colonnes (`grid-template-columns: 1fr auto 1fr`), pastille au centre.
- Carte (`<article>`) : photo 16/9 via `PlatImage format="tuile"` avec `key={src}` (ou bloc `.sansImage` + icône `Couverts` quand il n'y a pas d'image), `RestoBadge variante="chip" complet`, nom du plat en `--font-heading`, ligne « Servi 3 fois · dernier le jeu. 5 nov. » (omise si `nbServices` = 0), puis le bouton de vote. Crédit « Image : pollinations.ai » en pied de duel si une image porte un `credit`.
- Bouton de vote : `<button aria-pressed>` pleine largeur, 48 px, texte « Voter pour ce plat » ; une fois voté « Ton vote » (fond `--accent-soft`, bordure `--accent`). Le vainqueur ne change jamais la couleur de la carte : un badge texte (« En tête » tant que le duel est ouvert, « Vainqueur » une fois clos, « Égalité ») s'affiche dans l'en-tête de carte avec `--good-soft`.
- Identité : `useVotant()` (null au rendu serveur). Sans votant, un clic sur un plat ne vote pas : la grille « Qui es-tu ? » (16 avatars, 4 par ligne en mobile, 8 dès 640 px, nom sous l'avatar, repli emoji pour Ricardo, Ophélie et Nova) s'ouvre sous le duel avec « Choisis qui tu es pour voter pour *X* ». Le choix d'un avatar mémorise le votant (`ecrireVotant`) puis envoie le vote en attente : deux taps la première fois, un seul ensuite. Avec un votant, une ligne « Je vote en tant que [avatar] Thomas · changer » (même `SelecteurVotant`, forme bouton + `listbox`, inspiré de `IdeeForm`) reste visible au-dessus des cartes. Changer de personnage met à jour `monVote` à partir de `votes` déjà chargés.
- Suspense : tant que `monVote` est nul, que le duel est ouvert et que « Voir les résultats » n'a pas été cliqué, chaque carte n'affiche que « N personnes ont voté » (le total) et un bouton secondaire « Voir les résultats sans voter ». Le secret est d'interface seulement. Duel clos : résultats toujours visibles.
- Résultats (`ResultatsCote`, SANS état, dans une zone `aria-live="polite"`) pour chaque côté : barre dont la largeur est `pct %` (transition de `width`, annulée par la règle globale `prefers-reduced-motion`), texte clair « 5 voix · 62 % », avatars des votants (`title` = nom) accompagnés de la phrase `listeVotants` pour ne pas dépendre du survol. Texte jamais réservé à l'infobulle.
- Envoi : pendant la requête, `aria-busy` sur la carte et bouton désactivé. Succès : l'état est remplacé par la réponse du serveur. Échec : message du serveur dans un `role="alert"` sous le duel, l'état précédent est conservé. 409 : message puis `router.refresh()`.
- Actualisation : au `focus` de la fenêtre, si `affichageDuJour`, rappel de `GET /api/dilemme?votant=…` ; si `jour` a changé (minuit passé), le duel est remplacé. Pas de polling.
- Navigation entre jours : liens `next/link` « ← Duel précédent » / « Duel suivant → » (`?jour=`), calculés avec `voisinsDuel(jours, jour)` où `jours` = jours des duels clos + aujourd'hui. Le duel du jour est l'URL nue `/dilemme`. Un duel passé affiche aussi « Retour au duel du jour ».
- `<noscript>` : « Voter demande JavaScript. Le duel et ses résultats restent lisibles ici. »

**Duels précédents** : liste (`<ul>`) des 14 derniers duels clos, chaque ligne est un lien `?jour=` : date courte, « Croziflette 62 % contre Pâtes carbonara 38 % », mention « Vainqueur : … » ou « Égalité » ou « Personne n'a voté ».

**Classement des plats** : `<ol>` du top 10 de `classerStats(agregerStats(duelsClos))` : « Croziflette · Le Bistrot Trèfle — 75 % des voix · 2 victoires · 3 duels ». Section masquée si la liste est vide. Le duel du jour n'y compte pas tant qu'il est ouvert.

### `/dilemme/plats` (page serveur, `force-dynamic`)

- Formulaire GET sans JavaScript : champ `q` (type `search`, libellé visible « Rechercher un plat »), `select restaurant` (restaurants avec carte de plats, via `RESTAURANTS`, Vival exclu), `select tri` (Plus récents, Plus de victoires, Plus servis, A à Z), case « Avec photo seulement », bouton « Filtrer » (styles `.champ` et `.bouton` de `recettes.module.css`).
- Chargement : `chargerCatalogue()` (cache), puis en parallèle `imagesPourCles(toutes les clés)` et `getDuelsAvecVoix(aujourd'hui)` (2 requêtes ; échec des duels → victoires à 0, le reste s'affiche). Le jeu complet d'images est nécessaire à cause du filtre « avec photo ».
- Compteur « 712 plats » en `aria-live="polite"`, grille de cartes (1 colonne, 2 dès 640 px, 3 dès 960 px), 24 par page, `<nav aria-label="Pagination">` avec « ← Précédent » / « Suivant → » (liens `hrefHistorique`).
- Carte d'un plat : image (`PlatImage format="tuile"` ou `.sansImage` + `Couverts`), `RestoBadge chip complet`, nom, « Servi 3 fois · dernier le jeu. 5 nov. » (et première date quand le plat est servi plus d'une fois), prix (`fmtPrix` + `PartBudget`) s'il existe, notes Sportif et Goulaf écrites en clair (réutiliser `app/recettes/NotesRecette.tsx` si ses props acceptent deux nombres, sinon un petit composant local au même style ; « Non noté » plutôt qu'un « ? »), badge texte « 2 victoires » (`--good-soft`) pour les plats qui en ont.
- Les cartes ne sont pas cliquables : pas de panneau de détail (`DetailPanneau` est couplé à la semaine).
- Pied de page : crédit des images si l'une d'elles en porte un.
- États : liste vide → bloc `.vide` (bordure en pointillés) « Aucun plat ne correspond. » avec le lien « Effacer les filtres » (`/dilemme/plats`) ; base en erreur → `role="alert"` « L'historique est indisponible pour le moment. ».

### `loading.tsx`

`app/dilemme/loading.tsx` : `SkeletonPage label="Chargement du dilemme…"`, titre, deux grands blocs 16/9 côte à côte (empilés en mobile), puis une rangée de lignes. `app/dilemme/plats/loading.tsx` : `SkeletonPage label="Chargement des plats…"`, au gabarit de `app/recettes/loading.tsx` (barre de filtres, grille de cartes). Styles dans les modules de chaque page.

## 9. Cas limites

- **Vivier insuffisant** (premiers jours, base vide) : aucun duel écrit, page « Pas encore assez de plats pour lancer un duel. Reviens demain ! », l'historique reste utilisable.
- **Course à minuit / premier visiteur** : `creerDilemmeSiAbsent` en `ON CONFLICT DO NOTHING`, tout le monde relit la même ligne. Si le visiteur a ouvert la page à 23 h 59 et vote à 00 h 01, le 409 déclenche un rafraîchissement vers le nouveau duel.
- **Republication de `pdj_entries`** : le duel d'un jour ne change jamais (libellés figés). Le catalogue en cache peut retarder jusqu'à 60 s ; sans conséquence.
- **Plat d'un duel absent du catalogue** : carte affichée sans « Servi N fois ».
- **Plat sans photo** : fond d'assiette. Les images n'existent que depuis le 20/10 : au début, la plupart des duels n'ont qu'une photo ou aucune. La règle de préférence des photos s'efface d'elle-même sous 6 candidats photographiés.
- **Multi-options** (Basilic n'Go, Dubble) : chaque option est un plat distinct, avec ses propres notes ; `plat` en tableau sans options aussi.
- **Même plat dans deux restaurants** : deux entrées de catalogue, mais `memePlat` les empêche de s'affronter.
- **Noms en majuscules** : passés par `casseLisible` à la construction du catalogue.
- **Plats « fermé », « congés », « à venir »** : exclus du catalogue.
- **Égalité ou zéro vote** : `gagnant: "egalite"` / `null`, libellés dédiés ; un duel clos sans vote compte pour rien dans le classement.
- **Changement d'avis** : un clic sur l'autre carte ; la ligne est mise à jour (`updated_at`), les décomptes se recalculent.
- **`localStorage` indisponible ou nom inconnu stocké** : `lireVotant` renvoie `null`, la grille s'ouvre ; si l'écriture échoue le vote part quand même pour cette session (le votant reste en état local du composant).
- **Mêmes noms en minuscule ou alias hérités** (`thomas`, `Toam`) : canonisés par `nomPersonnage`, une seule ligne par personne.
- **Fuseau** : « aujourd'hui » vient toujours de `aujourdhuiParis()`, jamais de `new Date().toISOString()`.
- **Table absente ou base coupée** : `assurerTablesDilemme` crée les tables si besoin ; si la base est injoignable, 503 côté API et encadré `role="alert"` côté page, sans casser le reste du site.
- **Injection** : toutes les requêtes sont paramétrées ; `votant` n'arrive en base qu'après validation contre la liste des 16 personnages.
- **Usurpation** : n'importe qui peut voter en tant que Thomas. Identique à `/idees`, assumé et à dire dans `CLAUDE.md`.

## 10. Tests

Seuls les `.test.ts` sous `lib/` sont collectés. Commande : `npx vitest run lib/dilemme lib/historique-plats lib/limiteur-debit lib/votant`.

**`lib/dilemme.test.ts`**
- `memePlat` : « Croziflette » ≠ « Pâtes carbo » ; « Croziflette » = « Croziflette savoyarde » ; « Pâtes carbonara » = « Pâtes carbonara maison » ; « Pâtes carbonara » = « Carbonara de pâtes » ; « Pâtes carbo » ≠ « Pâtes bolo » ; ensembles vides.
- `construireCatalogue` : dédoublonnage par clé, dates uniques et triées, `nbServices`, dernier prix et dernières notes notées ; `plat` en tableau ; `options` éclatées avec leurs notes ; exclusion des dates futures, des noms « fermé » / trop courts ; même plat dans deux restaurants = deux entrées ; `cle` injectée (fausse fonction).
- `choisirDuel` : déterministe (même entrée, même sortie, y compris l'entrée mélangée) ; deux clés distinctes ; jamais `memePlat` sur 365 jours simulés ; aucune clé des 14 derniers duels quand le vivier suffit ; relâchement 14 → 7 → 0 ; `null` avec 0 ou 1 candidat, paire exacte avec 2 ; paire déjà jouée jamais rejouée ; au moins 6 candidats photographiés = duels à deux photos ; préférence d'un restaurant différent ; le duel change d'un jour à l'autre ; vecteur d'or figé (jour et catalogue fixes) pour détecter tout changement accidentel d'algorithme ; les `passes` de jour ≥ `jour` sont ignorés.
- `graineJour` / `creerRng` : stabilité, plage [0, 1).
- `resumerVotes` : 0 vote, égalité, 1-0, 2-1 (arrondi à 100 %), grands nombres.
- `agregerStats` / `classerStats` : victoire, défaite, nul, duel à zéro vote ignoré, plat dans plusieurs duels, seuil de 2 voix, score lissé, tri et départage stables.
- `dateIsoValide` : `2026-02-30`, `2026-13-01`, `26-11-11`, nombres, null.
- `validerVote` : `thomas` → `Thomas`, alias hérités, nom vide, 51 caractères, non-chaîne, nom inconnu, `choix` « A » accepté et « c » refusé, `jour` absent / invalide / valide, corps non objet.
- `voisinsDuel`, `listeVotants` (0, 1, 2, 3, 5 noms).

**`lib/historique-plats.test.ts`** : paramètres parasites et répétés, `restaurant` inconnu, `page` négative ou non numérique, `hrefHistorique` aller-retour ; recherche en début de mot avec accents ; filtre photo ; filtre restaurant ; chaque tri ; page bornée ; liste vide → `pages = 1`.

**`lib/limiteur-debit.test.ts`** : fenêtre fixe, remise à zéro après expiration, clés indépendantes, purge, horloge injectée, `ipDeRequete` (en-tête multiple, absence).

**`lib/votant.test.ts`** : faux `Storage`, nom invalide ignoré, accès qui lève une exception, événement émis à l'écriture.

**`lib/dilemme-api.test.ts`** (`vi.mock("./db")`) : GET (défaut, date invalide, futur, passé sans duel, vivier, 503, `monVote`) ; POST (honeypot, 429 IP, 429 votant, 400 de chaque champ, 409, 404, 503, idempotence, ordre des contrôles, création unique du duel quand `creerDilemmeSiAbsent` est appelé deux fois).

**`lib/dilemme-rendu.test.ts`** : `renderToStaticMarkup` de `ResultatsCote` (`62 %`, « 5 voix », barre, phrase des votants, état à zéro vote) et de `SousNav` (`aria-current`) ; garde de navigation : `app/layout.tsx` contient `href="/dilemme"` exactement deux fois.

**Hors vitest**
- `npx tsc --noEmit` : exclure temporairement `wt-fusion/` de `tsconfig.json` (ne pas committer ce changement).
- Requêtes SQL vérifiées en local contre le Postgres du VPS (forcer l'URL du VPS, cf. mémoire du projet) : 20 POST concurrents du même votant ne laissent qu'une ligne ; deux premiers GET simultanés ne créent qu'un duel.
- Captures Playwright de `/dilemme` et `/dilemme/plats` dans les trois thèmes, en 390 px et en 1280 px, dont le menu burger à 7 liens et la barre desktop entre 1280 et 1400 px (un 7e lien peut déborder : en cas de doute raccourcir le libellé). Les captures vont dans un dossier temporaire (`next dev` surveille tout le dépôt).

## 11. Ordre de réalisation

1. Modules purs et tests : `dilemme`, `historique-plats`, `limiteur-debit`, `votant`.
2. Base : `lib/db.ts` et `lib/migrate.mjs`.
3. `lib/dilemme-serveur.ts`, routes API, `lib/dilemme-api.test.ts`.
4. Interface : `useVotant`, `SelecteurVotant`, `/dilemme`, puis `/dilemme/plats`.
5. Navigation (deux blocs de `app/layout.tsx`, cascade CSS) et `CLAUDE.md`.
6. Vérification : vitest, `tsc`, captures.

**Déploiement** : `npm run db:migrate` avec la mise en ligne (non bloquant : les tables se créent à la première requête). Aucun serveur ni conteneur à reconstruire.

## 12. Hors périmètre

Duel qui dépend du menu du jour, vote sur un duel clos, retrait d'un vote, noms libres, authentification, Elo, panneau de détail d'un plat, rétro-génération des duels passés, refactorisation des quatre fichiers qui redéclarent `pdj-selected-character`, génération des photos du passé (commande pipeline à lancer à part).
