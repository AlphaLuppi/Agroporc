# Arène FPS « chacun pour soi » dans la vue Palantir — design

Date : 2026-10-22 · Branche : `feat/agroparc-fps`

> **Version 1, remplacée par la v2** : `2026-10-22-arene-v2-design.md` (branche `feat/arene-v2` ; ses §13 et §13.6 priment sur tout le reste) et
> `2026-10-23-arene-hud-design.md` (HUD, mini-carte, tableau des scores). Ce document garde l'historique de la v1 ; l'architecture ci-dessous (client
> prédictif, serveur `Salle` pur, validation des tirs avec compensation de latence) est toujours celle de la v2. **Écarts de la v2 avec ce document** :
> * armes : le choix « une arme parmi quatre » devient un **équipement** (principale + secondaire + couteau, slot 4 pour l'arme spéciale d'Elsa), registre extensible dans `lib/fps/armes.ts` ;
> * **plus aucune dispersion** (le tir part de l'axe du réticule, gerbe fixe du pompe), retours de touche confirmés par le serveur (`degats`) ;
> * mouvement plus rapide, personnages plus gros, **accroupi** et **glissade** ; portée des pseudos : visibles seulement si le joueur est vu (≤ 70 m, ligne de vue) ;
> * mort : **killcam** (rejeu du tueur puis carte du tueur), **réapparition près du rond-point** au bout de 4 s, PV + bouclier + régénération ;
> * monde vivant : **Elsa** au Truck Muche (soin ou arme spéciale), **voitures PNJ** mortelles à pied, **voitures conduisibles** (conducteur + passagers qui tirent) ;
> * protocole `VERSION_PROTOCOLE = 2` (un client v1 reçoit `erreur{version}`), serveur déployé au même hôte `wss://pdj-fps.toam.tech` (la v2 remplace la v1, aucun second hôte) ;
> * capacité : 16 places pour les joueurs EN ARÈNE (les spectateurs n'en occupent aucune ; 64 connexions inscrites, 96 au total, 24 par IP) ;
> * HUD refondu : mini-carte déplaçable de coin, grande carte, tableau des scores riche, fin de match avec podium, touches modifiables (menu pause) ;
> * bout en bout : `scripts/fps/e2e_arene_v2.mjs` (deux navigateurs headless contre un serveur local, `window.__arene`).
>
> Les « Limites connues » ci-dessous qui sont **résolues par la v2** : bridage de vitesse par message (plafonds de vitesse validés par le serveur, `PLAFONDS`),
> `quitter` puis `rejoindre` qui contournait la réapparition (`reentreeT`), limite de 16 spectateurs compris (séparée de la limite en jeu), dispersion.

## Demande

Dans la vue Palantir (code « myrtille », `app/components/Agroparc3D.tsx`), on peut lancer une partie
de FPS « chacun pour soi » (deathmatch façon Counter-Strike) sur la carte d'Agroparc avec les autres
personnes qui ont aussi la vue ouverte. On choisit entre quatre armes : **pistolet**, **mitraillette**,
**fusil à pompe** et **sniper**. On peut courir sur les murs comme dans Titanfall 2 : quand on saute
contre un mur, on glisse le long du mur, et on peut sauter de mur en mur.

## Architecture

```
navigateur (vue Palantir)                       VPS (Docker, Traefik TLS)
 Agroparc3D.tsx ── lobby / HUD React             serveur-fps/  (Node 22 + ws)
   │                                               src/index.ts : WebSocket, salle unique
   ├─ lib/agroparc3d/scene.ts (vue aérienne)       └─ importe lib/fps/match.ts (PUR)
   └─ lib/fps/jeu.ts (vue FPS, même canvas)                  lib/fps/armes.ts, tir.ts, collision.ts
        ├─ mouvement.ts (PUR, wall-run)
        ├─ collision.ts (PUR, bâtiments extrudés)
        ├─ armes.ts / tir.ts (PUR)
        ├─ reseau.ts (WebSocket + interpolation)
        ├─ rendu.ts (avatars, armes en main, effets, three)
        └─ sons.ts (WebAudio synthétisé, aucun fichier)
```

* Vercel ne tient pas de WebSocket : le serveur temps réel tourne sur le VPS, derrière Traefik
  (`wss://pdj-fps.toam.tech`, route fichier dans `/etc/dokploy/traefik/dynamic/pdj-fps.yml`,
  conteneur sur le réseau `dokploy-network`). URL côté client : `NEXT_PUBLIC_FPS_WS_URL`, sinon
  `ws://localhost:8787` en dev et `wss://pdj-fps.toam.tech` en prod.
* **Salle unique**, 16 joueurs max. Tout visiteur de la vue Palantir se connecte en
  **spectateur** (présence : « 3 agents en ligne », liste des pseudos) ; il entre dans l'arène
  avec le bouton « Entrer dans l'arène ».
* **Mouvement autoritaire côté client** (prédiction locale, pas de réconciliation), le serveur
  borne la vitesse (téléportation refusée = position serveur gardée). **Tirs validés côté
  serveur** : cadence, nombre de plombs, portée, angle et ligne de vue (bâtiments) recalculés,
  dégâts calculés par le serveur. C'est un jeu de bureau : l'anti-triche reste léger.
* Les joueurs distants sont interpolés avec `JEU.interpolationMs` de retard.
* Le contrat client ↔ serveur est `lib/fps/protocole.ts` (types, constantes, silhouette). Il ne
  change pas sans mettre à jour les deux côtés.

## Modules et API (contrats à respecter)

Tout ce qui est dans `lib/fps/` sauf `jeu.ts`, `rendu.ts`, `sons.ts` et `reseau.ts` est **PUR**
(ni three, ni DOM, ni `Math.random` direct : un `alea: () => number` est injecté) et testé avec
vitest (`lib/fps/*.test.ts`), à la manière de `lib/agroparc3d/cachettes.ts`. Commentaires et noms
en français.

### `lib/fps/collision.ts` — le monde physique

```ts
export interface Prisme { anneau: Vec2[]; trous: Vec2[][]; h: number; boite: { x0; z0; x1; z1 } }
export interface Monde { prismes: Prisme[]; bornes: { x0: number; z0: number; x1: number; z1: number }; grille: … }
export function construireMonde(data: SceneData): Monde
/** Hauteur du sol sous (x, z) pour des pieds à y : le toit le plus haut ≤ y + tolerance, sinon 0. */
export function solSous(m: Monde, x: number, z: number, y: number, tolerance?: number): number
export interface Contact { nx: number; nz: number; profondeur: number; prisme: number }
/**
 * Pousse un cylindre vertical (pieds en p, rayon, hauteur) hors des prismes qu'il
 * chevauche (un prisme ne bloque que si y < h − 0,05 : au-dessus on marche sur le toit)
 * et le garde dans `bornes`. Renvoie la position corrigée et les contacts de murs
 * (normale horizontale unitaire sortante). Les bornes de l'arène renvoient aussi un contact
 * (prisme = -1).
 */
export function resoudre(m: Monde, p: Vec3, rayon: number, hauteur: number): { p: Vec3; contacts: Contact[] }
/** Distance du premier bâtiment touché par le rayon (o, d normalisé) jusqu'à `max`, ou Infinity. */
export function lancerRayon(m: Monde, o: Vec3, d: Vec3, max: number): number
/** Vrai si le segment a→b ne traverse aucun bâtiment. */
export function visible(m: Monde, a: Vec3, b: Vec3): boolean
/** Points d'apparition : sur la voirie (data.roads classes M/R/S), hors bâtiments (≥ 2 m), dans les bornes, espacés ≥ 12 m, déterministes. */
export function pointsApparition(data: SceneData, m: Monde): Vec2[]
```

Bornes de l'arène : le rectangle des centroïdes des bâtiments agrandi de 25 m (cf.
`zoneJouable` de `cachettes.ts`, réutilisable). Les trous (`holes`) sont des cours : on y circule.
Une grille uniforme (cellules de 16 m) indexe les prismes pour que `resoudre` et `lancerRayon`
restent rapides (142 bâtiments, appelé à 60 Hz + chaque tir).

### `lib/fps/mouvement.ts` — contrôleur du joueur (wall-run Titanfall)

```ts
export interface Entrees { avant: number; droite: number; /* −1..1 */ saut: boolean; /* maintenu */ sprint: boolean; lacet: number }
export interface EtatMouvement {
  p: Vec3; v: Vec3; auSol: boolean;
  /** wall-run en cours : normale du mur, côté (−1 = mur à gauche, 1 = à droite), temps écoulé */
  mur: { nx: number; nz: number; cote: -1 | 1; t: number; prisme: number } | null;
  sautsAir: number;          // double saut restant (1, rechargé au sol ET en wall-run)
  sautPrecedent: boolean;    // pour détecter le front montant de `saut`
  coyote: number;            // s restantes pour sauter après avoir quitté le sol/mur
  murRecent: { prisme: number; nx: number; nz: number; t: number } | null; // anti-recollage au même mur
  inclinaison: number;       // roulis caméra lissé (rad, + = penche à droite)
}
export function etatInitial(p: Vec3): EtatMouvement
export function etape(e: EtatMouvement, entrees: Entrees, dt: number, monde: Monde, vitesseArme?: number /* multiplicateur */): EtatMouvement
export const MOUV = { … }  // toutes les constantes, exportées pour les tests
```

Règles (valeurs de départ, à régler en jeu) :
* sol : marche 6,5 m/s, sprint 9 m/s (sprint seulement vers l'avant), accélération 60 m/s²,
  friction forte ; saut 6,8 m/s ; gravité 20 m/s² ; contrôle en l'air réduit (accélération 12) ;
  double saut (1 en l'air) ; coyote 0,12 s ; dt sous-découpé en pas ≤ 1/120 s.
* **wall-run** : en l'air, avec un contact de mur (prisme ≥ 0, pas les bornes), une entrée vers
  l'avant, une vitesse horizontale ≥ 4 m/s, et un angle entre la vitesse et le mur ≤ 65° de
  la tangente → on accroche. Vitesse projetée sur la tangente du mur, relevée à ≥ 8,5 m/s
  (max 11) ; vy mis à max(vy, 1,2) à l'accroche puis gravité réduite à 3 m/s² ; légère force
  vers le mur pour rester collé ; durée max 1,6 s ; fin si plus d'entrée avant, plus de contact
  (fin du mur), durée écoulée, ou contact du sol. L'inclinaison caméra vise ±0,22 rad (vers
  l'extérieur du mur). Le double saut est rechargé.
* **saut de mur** : front montant de `saut` pendant un wall-run → v = tangente × vitesse +
  normale × 6,5 + y 7 ; le même mur (même prisme et normale à < 25°) ne peut être raccroché
  avant 0,5 s : on enchaîne les murs en zigzag.
* **escalade** (mantle) : contre un mur, en l'air, entrée avant, si le toit du prisme est à
  ≤ 1,3 m au-dessus des pieds → on monte sur le toit (petite impulsion vy).
* `posture` à envoyer = "mur" si wall-run, "sol" si au sol, sinon "air".

### `lib/fps/armes.ts` — caractéristiques

```ts
export interface Arme {
  id: ArmeId; nom: string; degats: number; multTete: number; plombs: number;
  cadenceS: number; auto: boolean; chargeur: number; rechargeS: number;
  dispersion: { base: number; mouvement: number; air: number; parTir: number; max: number; retourS: number; viseur?: number };
  recul: { tangage: number; lacet: number };       // rad par tir
  portee: number; chute: { debut: number; fin: number; min: number }; // multiplicateur linéaire debut→fin, plancher min
  vitesse: number;            // multiplicateur de déplacement
  zoom: number | null;        // fov en visée (clic droit), null = pas de lunette
}
export const STATS: Record<ArmeId, Arme>
export function degatsPlomb(arme: ArmeId, zone: Zone, distance: number): number   // arrondi entier
export function dispersionCourante(arme: ArmeId, ctx: { vitesseH: number; auSol: boolean; vise: boolean; chaleur: number }): number
export function directionsTir(arme: ArmeId, d: Vec3, dispersion: number, alea: () => number): Vec3[]  // `plombs` directions normalisées dans un cône
```

Valeurs de départ : **pistolet** 28 dégâts ×2 tête, semi-auto 0,2 s, 12 balles, 1,3 s,
précis ; **mitraillette** 16 ×1,6, auto 0,075 s, 32 balles, 2,0 s, dispersion qui monte avec
la chaleur ; **pompe** 9 plombs × 12 ×1,5, 0,85 s, 6 cartouches, 2,4 s, cône 0,085 rad,
chute de 8 à 30 m jusqu'à ×0,25, portée 45 m ; **sniper** 95 ×2,5, 1,35 s, 5 balles, 2,9 s,
très imprécis sans lunette (0,09), parfait avec (`zoom` 18°), déplacement ×0,9.

### `lib/fps/tir.ts` — hitscan

```ts
export interface Cible { id: string; p: Vec3; vivant: boolean }
export interface Impact { cible: string | null; zone: Zone | null; distance: number; point: Vec3 }
/** Premier objet touché par le rayon : joueur (tête = sphère, corps = capsule, cf. SILHOUETTE) ou bâtiment (cible null), sinon impact à `portee` en l'air. Le tireur est exclu. */
export function tracer(monde: Monde, o: Vec3, d: Vec3, portee: number, cibles: Cible[], tireur: string): Impact
/** Validation serveur d'une touche déclarée (tolérance de latence) : distance ≤ portée + 2, cible à ≤ 1,2 m du rayon (+ marge proportionnelle à la vitesse de la cible), ligne de vue non bloquée. */
export function toucheVraisemblable(monde: Monde, o: Vec3, d: Vec3, portee: number, cible: Cible, vitesseCible: number): boolean
```

### `lib/fps/match.ts` — logique serveur (PURE)

Classe ou fonctions sans I/O, horloge `maintenant: number` passée à chaque appel, `alea`
injecté. Elle gère : connexion/déconnexion, pseudo (2 à 16 caractères, nettoyé, unique avec
suffixe), couleur attribuée parmi une palette de 16 couleurs vives lisibles sur fond noir,
entrée/sortie de l'arène, arme courante et suivante, état reçu (bornage de vitesse : un
déplacement > 14 m/s × dt + 1 m est refusé ; pieds hors bornes refusés), tirs (cadence tolérée
à 85 %, `plombs` ≤ stats, chaque touche passée à `toucheVraisemblable` puis `degatsPlomb`
— tous les plombs d'un même tir sur une même cible s'additionnent), protection d'apparition
(annulée dès que le protégé tire), mort, réapparition après `JEU.delaiReapparitionMs` au point
d'apparition le plus éloigné des joueurs vivants (parmi les 6 meilleurs, au hasard),
fin de match (objectif de kills atteint ou durée écoulée) → entracte → nouveau match (scores
remis à 0, tout le monde réapparaît). Elle renvoie les messages à émettre :
`{ a: "tous" | "autres" | id, m: MessageServeur }[]`.

```ts
export class Salle {
  constructor(monde: Monde, apparitions: Vec2[], alea: () => number, maintenant: number)
  connecter(id: string, pseudo: string, maintenant: number): Sortie[]
  deconnecter(id: string, maintenant: number): Sortie[]
  recevoir(id: string, msg: MessageClient, maintenant: number): Sortie[]
  tic(maintenant: number): Sortie[]      // réapparitions, fin de match, snapshots (à JEU.snapHz)
}
export type Sortie = { a: "tous" | string; sauf?: string; m: MessageServeur }
```

### `serveur-fps/` — serveur Node

`serveur-fps/package.json` (dépendance `ws`, `esbuild` en dev), `src/index.ts` : serveur HTTP
(`GET /sante` → `{ ok, joueurs, enJeu, match }`) + WebSocket sur le même port (`PORT`, 8787
par défaut). Charge `public/agroparc/scene.json` (chemin `SCENE_JSON`), construit le `Monde`,
une `Salle`, tic à 60 Hz (`setInterval` 1000/60). Messages ≤ 4 Ko, JSON invalide ignoré, ≤ 90
messages/s par client (sinon `erreur flood` + fermeture), `Origin` autorisées via
`ORIGINES` (liste séparée par des virgules ; vide = tout), ping WebSocket toutes les 5 s
(connexions mortes fermées). `Dockerfile` multi-étapes, contexte = racine du dépôt
(`docker build -f serveur-fps/Dockerfile .`) : esbuild regroupe `src/index.ts` + `lib/fps/*`
en un seul `dist/index.js` (node22-alpine, utilisateur non-root). `docker-compose.yml` pour le
VPS (réseau externe `dokploy-network`, `mem_limit: 256m`, `cpus: 0.3`, redémarrage auto).
`serveur-fps/` a son propre `tsconfig.json` et est exclu du `tsconfig.json` racine.

### `lib/fps/reseau.ts` — client WebSocket

```ts
export interface ClientArene {
  envoyer(m: MessageClient): void
  fermer(): void
  readonly id: string | null
  /** horloge serveur estimée (ms) : Date.now() + décalage mesuré par ping */
  maintenantServeur(): number
}
export function connecterArene(url: string, pseudo: string, surMessage: (m: MessageServeur) => void, surEtat: (e: "connexion" | "ouvert" | "ferme" | "erreur") => void): ClientArene
// reconnexion automatique avec backoff (1, 2, 4, 8 s max), ping toutes les 2 s
export class Interpolateur { ajouter(snap: { ts: number; j: EtatJoueurSnap[] }): void; echantillon(tsServeur: number): Map<string, EtatJoueurSnap> /* interpolation linéaire p, angles par le plus court chemin */ }
export function urlArene(): string
```
`Interpolateur` est pur et testé.

### `lib/fps/rendu.ts` + `lib/fps/sons.ts` (three / WebAudio)

* Style de la vue : fil de fer lumineux sur fond noir, bloom. Les bâtiments réutilisent le
  rendu de `scene.ts` (extraire les constructeurs `buildingGroup`, réseau au sol, arbres dans
  `lib/agroparc3d/decor.ts`, `scene.ts` les importe sans changer son rendu).
* `creerAvatar(couleur)` : silhouette humanoïde en fil de fer (tête, torse, bras, jambes)
  de la couleur du joueur, animée selon posture + vitesse (cycle de course, penché en
  wall-run du côté `mur`, ragdoll simple / chute à la mort), arme tenue, pseudo en sprite
  au-dessus de la tête.
* `creerArmeEnMain(id)` : modèle fil de fer de chaque arme en vue première personne, avec
  balancement à la course, recul au tir, animation de rechargement, flash de bouche.
* Effets : traçantes (lignes qui s'estompent en 80 ms), impacts sur les bâtiments (étincelles),
  marqueur de touche, éclaboussure de couleur sur un joueur touché.
* `sons.ts` : sons synthétisés (bruit filtré + enveloppe) par arme, rechargement, pas,
  wall-run (souffle), touche (tic), kill (ding), son positionnel pour les tirs distants
  (gain selon la distance, panoramique selon l'angle).

### `lib/fps/jeu.ts` — boucle de jeu

```ts
export interface HudEtat { pv: number; arme: ArmeId; munitions: number; chargeur: number; recharge: number /* 0..1, 0 = rien */; vise: boolean; vitesse: number; mur: boolean; mort: boolean; reapparitionDans: number; protege: boolean; verrouille: boolean /* pointer lock actif */ }
export interface JeuCallbacks {
  hud(e: HudEtat): void                      // ≈ 15 Hz
  evenement(e: { type: "kill" | "mort" | "touche" | "degat"; … }): void
  sortir(): void                            // le joueur a quitté l'arène
}
export function lancerJeu(canvas: HTMLCanvasElement, data: SceneData, client: ClientArene, arme: ArmeId, cb: JeuCallbacks): JeuHandle
export interface JeuHandle { choisirArme(a: ArmeId): void; recevoir(m: MessageServeur): void; dispose(): void }
```

Commandes : la souris tourne la vue (pointer lock au clic sur le canvas), **ZQSD et WASD**
(on lit `KeyboardEvent.code`, indépendant de la disposition : `KeyW` = Z sur AZERTY),
Espace saut / double saut / saut de mur, Maj sprint, clic gauche tir (maintenu pour la
mitraillette), clic droit visée / lunette du sniper, R recharger, 1 à 4 arme pour la
prochaine apparition (immédiate si mort), Tab tableau des scores, Échap libère la souris
(menu pause : reprendre / changer d'arme / quitter l'arène). Pendant la partie, **Échap ne
ferme pas la vue Palantir** (l'écouteur de `Agroparc3D` l'ignore quand l'arène est active).
FOV 90°, sensibilité réglable (localStorage `pdj-fps-sensibilite`). Le canvas est partagé :
la vue aérienne est détruite (`handle.dispose()`) à l'entrée, recréée à la sortie.

### UI React (`Agroparc3D.tsx` + `app/components/arene/`)

* Panneau « Arène » dans la vue Palantir : statut de connexion, nombre d'agents en ligne et
  liste (pseudo, couleur, en jeu ou non, K/D), champ pseudo (localStorage `pdj-fps-pseudo`,
  par défaut le personnage choisi dans les commentaires), choix de l'arme (4 cartes avec
  stats en barres), bouton « Entrer dans l'arène ». Sur écran tactile sans clavier/souris :
  « L'arène se joue au clavier et à la souris ».
* HUD en jeu : viseur (dynamique selon la dispersion), PV, munitions, arme, minuterie du
  match, fil des kills (« A ⟶ B [arme] », tête marquée), indicateurs de dégâts directionnels,
  écran de mort avec réapparition et choix d'arme, tableau des scores (Tab et fin de match),
  lunette du sniper (cache noir + réticule), aide des commandes au premier lancement.
* Thème : celui de la vue (tokens `--ag-*` de `Agroparc3D.module.css`, Chakra Petch + IBM
  Plex Mono), contraste AA.
* La vue aérienne affiche aussi les joueurs en jeu (point lumineux à leur couleur + pseudo)
  pour les spectateurs.

## Tests

* vitest : collision (sur le vrai `scene.json`), mouvement (wall-run accroche, dure, saut de
  mur, recollage interdit, escalade, double saut, pas de passage à travers un mur à 30 m/s),
  armes (dégâts, chute, cône), tir (tête/corps/bâtiment), match (cadence, triche de vitesse,
  kill, réapparition, fin de match), interpolation.
* Bout à bout : serveur local + deux navigateurs headless (Playwright) qui entrent dans
  l'arène, se voient, l'un tue l'autre.

## Écarts constatés à l'implémentation (après revues, 22/10)

Les signatures de la section « Modules et API » sont inchangées ; ces points précisent ou corrigent
les valeurs et règles de départ.

* **Armes** : la chaleur ne retombe qu'après `delaiRefroidissement(arme)` (cadence × 1,25 + 0,04 s),
  sinon elle ne montait jamais ; la mitraillette atteint sa dispersion maximale en ≈ 15 tirs (à régler
  en jeu). Le recul de la vue est rendu par `reculAcc` et revient tout seul (`delaiRecul`,
  `retourRecul`, plafond 0,2 s). Une arme à lunette ne vise pas pendant son rechargement.
* **Mouvement** : plafond de vitesse horizontale `MOUV.vitesseMaxH` = 13,5 m/s (le serveur refuse
  au-delà de 14 m/s) ; un mur ou une limite d'arène qui barre la route de face (`MOUV.murBarrageCos`)
  termine le wall-run (pas d'immobilité en coin rentrant).
* **Serveur (`match.ts`)** : touches validées contre l'historique des positions de la cible sur les
  300 dernières ms (`REWIND_MAX_MS`, compensation de latence) ; tolérance sur l'origine du tir
  `ECART_OEIL_M` = 1,5 m + 0,15 × vitesse ; vitesse déclarée plafonnée (20 m/s horizontale, 45 m/s
  verticale) ; crédit de 3 intervalles pour les armes automatiques (`CREDIT_RAFALE_AUTO`) après une
  gigue réseau ; joueur vivant sans état accepté depuis 20 s (`INACTIF_MS`) retiré de l'arène (le
  client redemande à entrer, en attendant le retour de l'onglet s'il est caché).
* **Client réseau** : pendant une coupure, seuls `rejoindre`, `quitter` et `arme` sont mis en file
  (les états, tirs et pings périmés sont jetés, sinon flood à la reconnexion).
* **UI** : `Agroparc3D` pose `data-arene="actif"` sur sa racine pendant la partie, ce qui neutralise
  le code « myrtille » (il ne referme plus la vue en plein match) ; le pseudo n'est plus renvoyé au
  serveur en cours de partie (appliqué à la sortie) ; Tab n'est capté que souris verrouillée ; le
  bouton du menu pause s'appelle « Jouer » à la première pause puis « Reprendre ». Hors production,
  `window.__arene` expose `etat`, `entrer`, `quitter`, `teleporter`, `regarder`, `tirerVers`, `touche`
  (tests bout à bout).
* Fichiers ajoutés : `lib/fps/vue.ts` (maths de visée pures, testées), `app/components/arene/armesInfo.ts`
  (fiches des armes pour le lobby), `lib/fps/ressenti.test.ts`, `lib/fps/match.reseau.test.ts`.

## Limites connues

* Pas de bridage de vitesse par message : un client modifié à 90 msg/s peut dépasser 14 m/s en cumulé.
* `quitter` puis `rejoindre` rend les PV (joueurs anonymes) et contourne le délai de réapparition.
* 16 connectés au total, spectateurs compris : 16 curieux empêchent d'autres d'entrer. Séparer la
  limite de joueurs en jeu de celle des spectateurs reste à faire.
* `ORIGINES` est vide par défaut dans `docker-compose.yml` : à renseigner en production.
* Diffusions de présence sans limite globale en cas de connexions répétées ; ≈ 0,9 Mbit/s par client à
  16 joueurs (nombres des instantanés non arrondis).
* Fentes de moins de 0,8 m entre deux bâtiments : un wall-run peut y rester coincé jusqu'à 1,6 s.
* Un tir par image de rendu au maximum : sous ≈ 13 images/s, la mitraillette tire moins vite que sa cadence.
* Tests de rendu faits avec un faux pointer lock et SwiftShader (pas de GPU ni de verrou réel).
* Le test de cachettes (`lib/agroparc3d/cachettes.test.ts`) exige Node ≥ 22.18 (retrait des types) :
  lancer `vitest` sous Node 22.
