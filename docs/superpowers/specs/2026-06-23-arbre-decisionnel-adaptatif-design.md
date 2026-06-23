# Quiz « Aide-moi à choisir » — moteur multi-critères

Date : 2026-06-23 (révisé 2026-06-24 : passage arbre élagué → moteur multi-critères)

## Historique

V1 (mergée puis remplacée) : un arbre de décision adaptatif qui **élaguait** les options
absentes du jour pour garantir « zéro cul-de-sac ». Problème remonté à l'usage : le quiz
proposait trop peu d'options (ex. pas d'option « végé », « bœuf » ou « poisson » si le plat
n'existait pas ce jour-là), ce qui le rendait pauvre.

## Objectif (V2)

Un quiz **riche** : chaque question affiche **toujours toutes ses options**, jamais élaguées.
On garde les garanties clés :

- **Atteignabilité** : chaque plat du jour est joignable en répondant son profil exact.
- **Déterminisme** : un même jeu de réponses mène toujours au même résultat.
- **Repli au plus proche** : un choix sans plat correspondant retombe sur le mieux noté du jour
  (on aboutit toujours à un plat du jour).

Tout se calcule **au rendu serveur Next.js** ; pas de pipeline Python / VPS.

## Design

### Moteur (`lib/quiz-engine.ts`)

Tagging de chaque plat sur 4 axes, dérivés du nom + ingrédients :

- **envie** (axe combiné famille/protéine) : poulet, bœuf, porc, veau/agneau, poisson, végé.
- **cuisine** : mijoté, asiatique, méditerranéen, streetfood, froid (mots-clés ; sinon « autre »).
- **lourdeur** : léger / copieux (mots-clés ; repli sur la note sportif si ambigu).
- **budget** : éco (≤ 10€) / standard (parse du prix).

`meilleursCandidats(pool, criteres, mode)` : score chaque plat = nombre de critères **précisés**
(hors « peu importe ») qu'il satisfait, garde les plats au **score max**, triés par note du mode
puis départage stable (restaurant, plat). Renvoie aussi `exact` (un plat satisfait tous les
critères) et `nbCriteres`.

### Parcours (`QuizClient.tsx`)

Questions à options complètes, dans l'ordre : mode → plat/menu → envie → cuisine → léger/copieux
→ budget → (si menu) saveur dessert → lourdeur dessert. Puis :

- 0 critère précisé → **recommandation** : le mieux noté.
- ≥1 critère, 1 seul candidat → résultat direct.
- ≥1 critère, plusieurs candidats à égalité → **départage par nom** (« Lequel te tente ? »),
  listant les meilleurs candidats du jour (cap à 6). Choix explicite, pas d'axe déguisé.

Barre de progression (6 étapes, +2 si dessert), masquée sur l'écran de résultat.

### UI (gros boutons tactiles)

Boutons ≥ 60px, pastille emoji, flèche, feedback au press (scale + surface), focus clavier
visible. CSS vars existantes (`--accent`, `--surface`, `--border`, `--radius`) → tous les thèmes.

### Données (`page.tsx`)

Le pool = plats du jour ; repli sur les cartes s'il n'y en a pas encore publié.

## Tests

- `lib/quiz-engine.test.ts` : dérivation des 4 axes, atteignabilité par profil exact,
  recommandation sans critère, repli au plus proche, déterminisme, pool vide.

## Ce qu'on ne fait pas (YAGNI)

- Pas d'arbre élagué (remplacé).
- Pas de génération de questions côté pipeline Python / VPS.
