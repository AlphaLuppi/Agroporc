# Arbre décisionnel adaptatif — « Aide-moi à choisir »

Date : 2026-06-23

## Problème

Le quiz `app/aide-moi-a-choisir/` pose des questions **codées en dur** (mode → plat/menu →
famille → protéine → dessert), puis `choisirPlat` filtre le pool et renvoie le **mieux noté**
des plats qui matchent. Deux défauts :

1. **Non-atteignabilité** : si ≥2 plats du jour tombent dans le même seau (même famille +
   protéine), seul le mieux noté est jamais renvoyé. Les autres sont inaccessibles.
2. **Non-déterminisme perçu** : aucune garantie qu'un chemin de réponses isole un plat unique.

## Objectif

Chaque matin, quand 3 nouveaux plats du jour sont publiés, l'arbre doit **s'adapter** pour que :

- **Chacun des plats du jour soit atteignable** par au moins un chemin de réponses.
- **Un chemin de réponses donné mène toujours au même résultat** (déterminisme).

Tout se calcule **au rendu de la page (côté serveur Next.js)**. Le pipeline Python et le VPS ne
sont **pas** concernés : la page connaît déjà les plats du jour à chaque chargement.

## Périmètre

- **Ciblé** : `app/aide-moi-a-choisir/page.tsx`, `QuizClient.tsx`, nouveau `lib/quiz-tree.ts`.
- **Réutilisé tel quel** : `lib/quiz-tags.ts` (tagging famille/protéine), `lib/desserts.ts`
  (branche dessert), `lib/quiz-plats.ts` (résolution déterministe d'un groupe → un plat).
- **Hors périmètre** : pipeline Python, scraping, base de données, autres pages.

## Design

### 1. Construction de l'arbre (serveur)

Nouveau module `lib/quiz-tree.ts`. Entrée : la liste des **plats du jour** (déjà disponible dans
`page.tsx` via `platsJour`). Sortie : un `QuizTree` sérialisable passé en props à `QuizClient`.

Algorithme — partitionnement récursif des plats du jour :

1. **Axe famille** : on regroupe les plats par `tagsForPlat().famille`. On n'expose comme options
   que les familles **réellement présentes** parmi les plats du jour (+ « Peu importe »). Zéro
   option morte → zéro cul-de-sac.
2. **Axe protéine** : à l'intérieur d'un groupe famille comptant ≥2 plats, on subdivise par
   `tagsForPlat().proteine`, là encore en n'exposant que les protéines présentes.
3. **Départage final par nom** : si après famille + protéine un groupe contient encore ≥2 plats,
   on insère une question explicite « Lequel te tente ? » listant ces plats **par nom**. Pas
   d'axe « déguisé » (restaurant/prix/léger-gourmand) : choix direct et lisible.
4. **Feuille = exactement un plat.** Les 3 plats du jour sont donc tous atteignables.

### 2. Déterminisme

- Chaque chemin complet de réponses → une seule feuille → un seul plat. Toujours le même.
- « Peu importe » à un nœud est résolu de façon **déterministe** via `choisirPlat` sur le
  sous-groupe courant : meilleur score du mode choisi, départage stable (note, puis nom de
  restaurant, puis nom de plat) en cas d'égalité. Donc même « Peu importe » donne toujours le
  même résultat.

### 3. QuizClient = marcheur d'arbre

`QuizClient` ne contient plus d'étapes codées en dur. Il :

- pose d'abord la question **mode** (sportif/goulaf) — elle ne branche pas, elle pilote
  l'affichage note/justification ;
- pose la question **plat / plat+dessert** ;
- descend ensuite le `QuizTree` reçu en props, nœud par nœud, jusqu'à une feuille ;
- conserve la **branche dessert existante** (`choisirDessert` sur `lib/desserts.ts`) en fin de
  parcours, inchangée ;
- affiche le `Resultat` (plat retenu + dessert éventuel).

### 4. Repli carte

Quand aucun plat du jour n'est publié (`hasJour === false`), on retombe sur le pool de cartes
avec le comportement actuel (l'arbre est construit sur ce pool de repli). Quand des plats du jour
existent, l'arbre porte sur eux.

### 5. UI — gros boutons tactiles (registre product)

Refonte de la classe `card` et du `QuestionStep`, en s'appuyant sur les CSS vars existantes
(`--accent`, `--surface`, `--border`, `--radius`) qui gèrent déjà les thèmes :

- **Cibles tactiles** ≥ 56px de haut (au-delà du minimum 44px), padding généreux, gap ≥ 12px
  entre boutons (anti-mistap).
- **Texte plus grand** (≈18px), emoji en pastille à gauche pour l'ancrage visuel.
- **Feedback au press** : `:active` scale 0.97 + changement de surface, transition 150–200ms
  ease-out (pas d'animation de layout).
- **Focus visible** au clavier (anneau 2px sur `--border-accent`).
- **Indicateur de progression** : « Étape n / total » discret en tête de parcours.
- **Bouton « Recommencer »** et CTA principal conservés, agrandis et alignés sur le même style.
- Mobile-first : conteneur `max-w-[520px]`, pas de scroll horizontal, `min-h-dvh` non requis
  (contenu court).

## Tests

- `lib/quiz-tree.test.ts` (nouveau) :
  - chaque plat du jour est atteignable (un chemin de réponses le renvoie) ;
  - déterminisme : même chemin → même plat, sur plusieurs jeux de plats ;
  - pas d'option morte (les options proposées correspondent toujours à ≥1 plat) ;
  - cas 2 et 3 plats dans le même seau → étape de départage par nom générée ;
  - « Peu importe » résolu de façon stable.
- Tests existants `quiz-plats`, `quiz-tags`, `desserts` conservés (réutilisés).

## Ce qu'on ne fait pas (YAGNI)

- Pas de génération de questions côté pipeline Python / VPS.
- Pas d'axe discriminant « déguisé » (restaurant/prix/léger-gourmand) pour les plats.
- Pas de restriction du pool de carte hors du cas « pas de plats du jour ».
