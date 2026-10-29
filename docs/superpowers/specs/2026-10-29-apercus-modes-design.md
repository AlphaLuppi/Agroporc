# Vue Palantir : un aperçu par mode de jeu (carte, caméra, joueurs en direct ou simulés) — design

Date : 2026-10-29 · Issue GitHub #84 « Previews différentes selon le mode de jeu sélectionné » · Protocole : **inchangé** (`VERSION_PROTOCOLE = 10`),
un seul ajout, additif : le message serveur `apercu` (un client plus ancien l'ignore, un client à jour devant un ancien serveur retombe sur la
simulation). Ne remplace aucune spec ; complète `2026-10-27-arene-zombies-design.md`, `2026-10-28-battle-royale-design.md`,
`2026-10-29-br-voix-parties-design.md` et `2026-10-22-agroparc-fps-design.md` (vue aérienne).

## Demande (issue #84)

1. Choisir un mode dans le panneau « Arène » change la carte affichée en arrière-plan, avec une transition de caméra, en gardant la vue
   « satellite » (la vue aérienne fil de fer actuelle) : la carte du match à mort n'est pas celle du Battle Royale ni des zombies.
2. S'il y a une partie en direct dans le mode regardé, on y voit les joueurs (aujourd'hui seulement ceux de l'arène) ; en zombies, aussi les tigres
   qui se baladent et attaquent le bâtiment où sont les joueurs.
3. Sans partie : des simulations (faux joueurs qui s'affrontent ou coopèrent selon le mode), avec de la variété et du hasard.

## Ce qui existe (lu dans le code)

- `lib/agroparc3d/scene.ts` (`createAgroparcScene`) : un seul renderer, une caméra (`REST` = dx −30, y 230, dz 380 autour de `data.focus`),
  `MapControls`, composer + bloom, décor ajouté directement dans `scene` (`ajouterBatiments`, `ajouterReseauSol`, `ajouterGrille`, `ajouterArbres`), POI
  (faisceau + anneau + étiquette HTML), avion, Truck, voitures et bus, tigre caché. `recenter()` = transition 1,2 s (`recentering`, courbe `ease`).
  `SceneHandle.joueurs(liste)` : un faisceau de 24 m + un anneau + une étiquette HTML par joueur (`JoueurAerien`), position posée telle quelle.
- `app/components/Agroparc3D.tsx` : la vue aérienne est DÉTRUITE à l'entrée en jeu et recréée à la sortie (`enArene`, `cleCanvas`). L'effet
  « Spectateurs » (≈ ligne 590) pousse toutes les 250 ms `arene.snapRef` (joueurs en jeu de l'arène, instantané < 2 s) dans `handleRef.current.joueurs`.
  `ChoixMode` est monté dans le lobby du mode CONFIRMÉ (`arene.mode`) ; `arene.modeVoulu` suit la carte cochée tout de suite (revient en arrière sur
  `refus`). Panneau fermé hors jeu : le client repasse dans l'arène (effet « Panneau refermé hors partie »).
- Serveur : un client n'est inscrit qu'à UNE salle (`Client.salle`). Choisir un mode le déplace dans la salle du mode (`changerMode`) : il y est
  « spectateur » (inscrit, `enJeu` faux). `Salle.sortiesSnap` n'envoie aux spectateurs un instantané (`a: "spectateurs"`, 10 Hz) **qu'en arène** (`!this.zombies
  && !this.br`) : en zombies et en BR, un spectateur ne reçoit ni joueurs ni tigres. Il reçoit en revanche `zombies{etat}` et `br{etat}` (adresse `tous` :
  `fenetres` (planches restantes par fenêtre, ordre de `FENETRES`), `portes`, `manche` ; `avion`, `zone`, `vivants`, `total`) et `presence` (pseudos, couleurs).
- Cartes : `donneesZombies(scene).data` (4 bâtiments creusés `creux`, 20 pièces synthétiques ajoutées à la fin de `buildings`, `focus` = `FOCUS_ZOMBIES`
  [118, −25], `BORNES_ZOMBIES` x 8..236, z −110..24, 13 `FENETRES` avec `points` / `dehors` / `dedans`) et `donneesBr(scene).data` (20 bâtiments creux dont les 4 des
  zombies, bornes = centroïdes des 142 bâtiments ± marge : x −324..367, z −233..209, soit 0,3 km²). `lib/fps/rendu-interieurs.ts` (`creerRenduInterieurs`, option `sansPlafond`,
  `batiments`) dessine murs, cloisons, mobilier, oliviers, voitures garées : le décor générique (`ajouterBatiments`) ignore ces types (`SANS_DECOR`). `HUD`
  (`sceneHud`) construit déjà ces deux scènes côté client : `Agroparc3D.tsx` importe `donneesZombies` et `donneesBr` statiquement, derrière le
  `next/dynamic` de `Agroparc3D` (rien n'entre dans le premier chargement du menu).
- Modules PURS réutilisables : `lib/fps/br-zone.ts` (`genererPlanZone`, `etatZone`, `etatDepuisZoneBr`, `horsZone`), `lib/fps/br-chute.ts` (`tracerVolBr`,
  `positionAvionBr`, `capAvionBr`, `AVION_BR`, `CHUTE_BR`), `lib/fps/br-carte.ts` (`centresBatimentsEligibles`), `lib/fps/protocole.ts` (`decoderZombies`,
  `SnapZombies`, `ZombieSnap`), `lib/fps/couleurs.ts` (`couleurJoueur`), `lib/characters.ts` (`CHARACTERS` : 16 prénoms), `lib/agroparc3d/cachettes.ts` (`aleaGraine`, mulberry32).

## Décisions (tranchées)

1. **Même scène, même renderer, trois décors.** Le renderer, le composer, la caméra et les contrôles ne sont jamais recréés ; la vue reste « rayons X » (DA
   néon inchangée). Le décor de l'arène (bâtiments, voirie, grille, arbres) est rangé dans un `Group` ; les décors des zombies et du BR sont des `Group` frères
   (bâtiments de leur scène ; voirie, grille et arbres communs restent) construits à la demande, masqués (`visible = false`) quand ils ne sont pas le mode
   affiché. Aucun nouveau canvas, aucun rechargement de three.
2. **Tout est conditionné par le panneau « Arène » ouvert** (`areneOuverte` et pas `enArene`). Panneau fermé : vue strictement inchangée (caméra `REST`, décor de
   l'arène, POI, voitures, avion, faux joueurs absents, spectateurs de l'arène par le chemin actuel de l'effet « Spectateurs »). Panneau ouvert : le mode affiché
   est `arene.modeVoulu` (la carte cochée, sans attendre le serveur).
3. **Transition de caméra différenciée par mode**, 1,6 à 2,6 s, en arc (la caméra monte à mi-chemin puis redescend), décor échangé au point haut (k = 0,5) avec
   une impulsion de bloom de 0,45 s (le « scan » néon cache l'échange). Cadrage par mode : arène = `REST` exact (rond-point, 380 m) ; zombies = le Pôle R&D
   en gros plan (`FOCUS_ZOMBIES`, ≈ 220 m de distance) ; BR = plongée haute et large sur toute la carte (≈ 630 m, la zone et l'avion tiennent à l'écran). Le
   brouillard change avec le mode (plus dense en zombies, très léger en BR) et suit la transition. `prefers-reduced-motion` : coupure franche (durée 0, pas
   d'arc, pas d'impulsion), échange du décor immédiat.
4. **Jamais de mélange** vrais et faux joueurs. Dès qu'il y a au moins un joueur réel visible pour le mode affiché, la simulation s'efface (fondu de 0,6 s) ; elle
   revient 4 s après la disparition du direct (hystérésis : pas de clignotement entre deux paquets perdus). Les faux joueurs sont distincts : repère en
   pointillés, étiquette précédée de « ◇ », et un bandeau « SIMULATION » (cf. UI). Le bandeau dit « EN DIRECT » seulement avec de vraies données.
5. **Flux d'aperçu additif `apercu`** (cf. Protocole) pour les zombies et le BR, émis par la salle seulement s'il y a des spectateurs (inscrits hors jeu), à 5 Hz
   (zombies) et 3,3 Hz (BR), compact (positions au décimètre, tigres = `SnapZombies` existant), auto-suffisant (pseudos et couleurs inclus : pas de dépendance à
   `presence`). L'arène garde son instantané `snap` aux spectateurs (inchangé) : pas de nouveau flux pour elle.
6. **BR à plusieurs parties** : un client BR est dans UNE partie (`choisirPartieBr`). L'aperçu qu'il reçoit est celui de sa partie si elle est en vol / en jeu, sinon
   celui de la partie en cours qui compte le plus de survivants (relayé par `index.ts`, décision pure `partieApercuBr` dans `salons.ts`), sinon rien (simulation).
   Le message porte `partie` (id) pour que le bandeau dise « partie br2 ».
7. **Faux joueurs : simulations pures et déterministes** (module PUR, générateur semé `aleaGraine`, jamais `Math.random`, jamais d'horloge), faites pour être
   TESTÉES (même graine = mêmes positions après N pas). La graine est tirée par l'hôte non pur (`crypto.getRandomValues`) à chaque ouverture du panneau, à chaque
   changement de mode et à chaque nouveau cycle de la simulation : la variété vient de la graine (effectif, scénario, fenêtre attaquée, trajectoire de l'avion,
   cercles de la zone, pseudos). Les marqueurs des faux joueurs vivent sur les routes libres de bâtiments (`apercu-sol.ts`), jamais dans un mur.
8. **Tigres des zombies vus d'en haut** : deux `InstancedMesh` (64 instances) : une pointe de flèche plate orientée par le cap (couleur et taille par type : tigre,
   doré, chef, petit, mini Truck) et un anneau au sol (clignotant en rouge quand le tigre arrache les planches d'une fenêtre, pulsant à la sortie du sol). Pas de GLB,
   pas de squelette, 2 appels de dessin quel que soit le nombre de tigres. Les fenêtres sont 13 barres instanciées (couleur = planches restantes), un trait relie
   chaque tigre « à la fenêtre » à sa barre, et le contour du bâtiment qui contient les survivants pulse en rouge tant qu'une fenêtre est attaquée.
9. **Étiquettes plafonnées** : en BR (50 joueurs) seules les 12 étiquettes HTML les plus proches du point visé sont affichées (recalcul à 2 Hz, avec hystérésis) ;
   les autres joueurs restent des repères 3D sans texte. Arène (16) et zombies (8) : toutes.
10. **Le tigre caché de la chasse** (easter egg) est masqué et non cliquable tant que le mode affiché n'est pas l'arène (sinon il serait confondu avec les tigres des
    zombies et flotterait hors de son bâtiment).
11. **Pas de nouvelle interaction** : on ne « rejoint » ni ne « regarde » rien depuis l'aperçu (les boutons du lobby restent les seuls). Hors périmètre : tirs et
    traceurs en direct, portes des zombies qui s'ouvrent en direct, butin du BR, un mode « spectateur des zombies ».

## Architecture, fichier par fichier

### Modules PURS (lib/fps/, vitest, sans three)

- `apercu-cadrage.ts` : `CADRAGES: Record<ModeSalle, { focus: Vec2 | null; dx: number; y: number; dz: number; brouillard: number }>` ; arène `{ focus: null (= data.focus), dx: −30,
  y: 230, dz: 380, brouillard: 0.0011 }` (un test l'égale à `REST` de `scene.ts`), zombies `{ focus: FOCUS_ZOMBIES, dx: −10, y: 135, dz: 175, brouillard: 0.0017 }`, BR
  `{ focus: centre de bornesBr(scene) ≈ [21,8, −12,1], dx: 0, y: 540, dz: 330, brouillard: 0.0006 }`. `poseCadrage(mode, data)` → `{ pos, cible }` ; `interpolerCadrage(de, vers,
  k, leve)` : position et cible interpolées par `ease` entrée-sortie (`k` < 0,5 : 4k³ ; sinon 1 − (−2k + 2)³/2) plus une élévation `leve × sin(πk)` (leve = 0,18 × la plus grande
  distance caméra-cible des deux poses) ; `dureeTransition(de, vers, reduit)` = 0 si `reduit`, sinon 1,6 s + 0,4 s par 500 m de déplacement de la cible et du recul, plafonnée à 2,6 s ;
  `MI_TRANSITION = 0.5`. Export `bornesBr(scene)` ajouté à `br-carte.ts` (la fonction privée `bornesDe` existe déjà).
- `apercu-reseau.ts` : le fil. `APERCU = { zombiesTousLesSnaps: 4, brTousLesSnaps: 3, perimeMs: 3000, retourSimulationMs: 4000 }`. Côté serveur
  `construireApercu({ mode, ts, snap, noms, zombies?, manche?, br? })` → `Extract<MessageServeur, { t: "apercu" }>` : un joueur = tuple `[id, pseudo, couleur, xDm, yDm, zDm,
  f]` (f : bit 0 vivant, bit 1 chute libre, bit 2 sous voile ; en zombies « non vivant » = à terre, en BR = éliminé depuis moins de 5 s) ; `z` = `SnapZombies` tel quel (sans le
  Truck des livraisons s'il est absent) ; `m` = manche ; `br` = `{ phase, vivants, total, zone, avion }`. Côté client `decoderApercu(msg)` → `ApercuDirect` (cf. ci-dessous)
  et `ageApercu`. Pas d'import de three.
- `apercu-source.ts` : types du modèle d'affichage et choix direct / simulation.
  `ApercuDirect = { mode: ModeSalle; partie?: string; joueurs: JoueurAerien[]; tigres: TigreAerien[]; fenetres?: number[]; manche?: number; zone?: ZoneBr | null;
  avion?: AvionBr | null; vivants?: number; total?: number; recuT: number; decalageServeurMs: number }` (`TigreAerien` = `{ id: number; x; z; cap; type: 0..4; mode:
  "chasse" | "sol" | "fenetre" | "saut"; pvPct }`, `JoueurAerien` est exporté de `scene.ts`, ici redéfini en type pur dans `apercu-source.ts` et réexporté par `scene.ts`) ;
  `choisirSource({ modeAffiche, modeConfirme, connecte, direct, maintenant })` → `"direct" | "simulation"` (direct si connecté, modes égaux, `direct.mode === modeAffiche`,
  âge ≤ `APERCU.perimeMs`, au moins un joueur réel ou un tigre) ; classe `SuiviSource` (hystérésis : direct → simulation seulement après `retourSimulationMs`, simulation →
  direct tout de suite) ; `libelleBandeau(source, mode, modele)` → `{ etat: "direct" | "simulation"; titre; detail }` (français, cf. UI) ; `estimerDecalageServeur(ts, maintenant)`.
- `apercu-sol.ts` : `creerSolLibre(buildings, bornes, pas = 4)` : grille rastérisée une fois (centre de cellule dans un bâtiment du type plein, ou dans l'eau = occupé ; les
  bâtiments `creux`, `coque`/`cloison`/`meuble`/`fenetre` ne bloquent pas : on marche dedans), `libre(x, z)`, `pointLibre(alea, centre, rMin, rMax)` (tirage par rejet, 40 essais, repli
  = centre libre le plus proche), `pas(x, z, dx, dz)` (déplacement qui glisse le long d'un obstacle, jamais dans un mur). Une instance par scène (≈ 15 000 cellules, < 15 ms).
- `apercu-noms.ts` : `tirerEquipe(alea, n, rangDepart = 0)` → `{ pseudo; couleur }[]` : prénoms de `CHARACTERS` sans doublon (au-delà de 16 : prénom + « 2 », « 3 »…),
  couleurs `couleurJoueur(rang)`.
- `apercu-sim-arene.ts`, `apercu-sim-zombies.ts`, `apercu-sim-br.ts` : une simulation chacune, même interface `Simulation { pas(dt: number): void; modele(sortie: ModeleApercu): void;
  evenements(): string[] /* vidé à la lecture */; cycle: number }`. `creerSim*(graine: number, ctx)` ; `ctx` = `{ data, sol, bornes, fenetres?, centresBatiments? }` (jamais d'horloge ni
  de `Math.random`, `dt` borné à 0,1 s, pas interne fixe de 1/30 s). Paramètres :
  - **Arène** : 6 à 12 agents, disque de 140 m autour du rond-point (`ROND_POINT`), vitesse 5,5 à 7,5 m/s. États : errer (waypoint libre à 30–90 m) → poursuivre l'ennemi le plus
    proche à moins de 70 m → tirer (à moins de 28 m : s'arrête 0,9 à 2 s, un trait de tir toutes les 0,18 s) ; la cible meurt au bout de 1,6 à 2,5 s de tirs cumulés (touche 60 %), les
    deux peuvent se tirer dessus ; mort : repère grisé 1,2 s puis retiré, réapparition 3 s plus tard à plus de 40 m de tout ennemi, dans l'anneau 25–140 m. Journal : « Nova a éliminé Kilian »
    (au plus un toutes les 2,5 s). Jamais de fin : le match tourne.
  - **Zombies** : une partie de 1 à 4 survivants, manche de départ 1 à 6, fenêtre d'ancrage tirée parmi les 13 `FENETRES` ; les fenêtres à moins de 45 m d'elle forment le front (au moins
    2, sinon les 2 plus proches). Survivants : apparition à moins de 3 m du `dedans` de l'ancre, errent entre les `dedans` du front, tirent sur le tigre le plus proche à moins de 14 m (≈ 90
    PV/s). Tigres : `n = min(24, 6 + 4 × (manche − 1))` par manche, apparition échelonnée (un toutes les 1,2 s, 2 s × 0,95^manche) à un des `points` d'une fenêtre du front : sortie du sol 1,2 s
    (mode `sol`) → marche vers `dehors` (1,6 m/s jusqu'à la manche 2, 3,4 jusqu'à la 5, 5,6 ensuite) → arrache les planches une par une (une toutes les 0,9 à 1,6 s, mode `fenetre`, la
    fenêtre perd une planche à chaque fois, 6 au départ) → saut 0,5 s (mode `saut`) → chasse le survivant le plus proche en ligne droite (mode `chasse`). PV d'un tigre : 150, +100 par
    manche jusqu'à 9. Au contact (< 1,2 m) un tigre touche un survivant toutes les 1,1 s ; 3 touches = à terre 6 s (relevé par un autre survivant à moins de 3 m, sinon éliminé) ;
    plus personne debout = fin (4 s) puis un NOUVEAU cycle (nouvelle graine, autre ancre, autre effectif). Fin de manche quand tous les tigres sont morts : pause de 5 s, planches
    reposées (la fenêtre repasse à 6 une planche par 0,3 s), `manche + 1`. Le cycle s'arrête aussi au hasard entre `manche + 2` et `manche + 6`. Journal : « Manche 4 », « Jimmy est à terre »,
    « Tom relève Jimmy ».
  - **Battle Royale** : 14 à 32 joueurs. Avion : `tracerVolBr(bornes, alea, 0, { dureeMs: 16 000 })` (le point de départ est tiré), saut de chaque joueur à un instant tiré dans les 12
    premières secondes de la traversée ; chute 5 s (de l'altitude à 60 m) puis voile 6 s jusqu'à un point d'atterrissage tiré près d'un `centresBatimentsEligibles` ; au sol : errer vers
    le bâtiment creux le plus proche puis suivre la zone. Zone : `genererPlanZone({ bornes, debutT: début de la fouille − 4 s, alea, centresBatiments, echelle: 0,09 })` : les 6 paliers
    durent ≈ 48 s, le rétrécissement se voit. Éliminations programmées pour qu'il reste un seul joueur à la fin du dernier palier : les instants de mort sont tirés d'avance et triés
    (le dernier vers 8 s avant la fermeture complète), le tueur est le joueur vivant le plus proche de la victime, qui court vers elle, tire 1 à 2 s puis la victime tombe (repère grisé
    5 s) ; les joueurs hors zone se dirigent vers le centre. Le dernier survivant « gagne » : 6 s de fin puis nouveau cycle (nouvelle graine). Journal : « Zone 2 : 85 m », « Nova a éliminé
    Kilian (12 restants) », « Victoire de Tom ».
  Sorties de `modele` : `ModeleApercu = { source: "simulation"; mode; joueurs (avec `sim: true`); tigres; fenetres?; zone?; avion?; manche?; vivants?; total? }`, tableaux réutilisés
  d'une lecture à l'autre (aucune allocation par image après l'échauffement).
- `apercu-zombies-vue.ts` : `batimentDesJoueurs(data, positions)` → index du bâtiment creux qui contient le plus de survivants (ou null) ; `fenetresAttaquees(tigres, fenetres)` →
  indices des fenêtres ayant un tigre en mode `fenetre` à moins de 7 m ; `BATIMENT_DE_FENETRE` (fenêtre → index de bâtiment creux, null en cour). Utilisé par le rendu.

### Rendu (three, sans vitest : captures)

- `lib/fps/rendu-apercu.ts` : `creerRenduApercu({ scene, camera, data, labelsEl, reduit, impulsion(k: number): void, sceneHandle })` → `RenduApercu` avec
  - `mode(m: ModeSalle, opts?: { immediat?: boolean })` : lance la transition (voir plus bas) ;
  - `actif(b: boolean)` : faux = retour à l'arène (transition si besoin), simulation et marqueurs détruits ;
  - `direct(d: ApercuDirect | null)` : données reçues (null = pas de direct) ; la source effective suit `SuiviSource` ;
  - `maj(dt, t)` : transition, simulation (`pas(dt)` puis `modele()`), lissage des positions, tigres, fenêtres, zone, avion BR, journal (via `cb.onEvent("SIM" | "LIVE", texte)`) ;
  - `etat()` : `{ actif, mode, source, joueurs, tigres, transition, camera }` pour le crochet de développement ;
  - `dispose()`.
  Décors : `construireDecorMode(mode)` = `ajouterBatiments(groupe, donneesZombies(...).data | donneesBr(...).data, { fantomes: true })` + `creerRenduInterieurs(groupe, data, pieces,
  { sansPlafond: true, courant: true, batiments })` (zombies : les 4 bâtiments, BR : `donnees.creux`) ; le type du premier paramètre de `creerRenduInterieurs` passe de `THREE.Scene` à
  `THREE.Object3D` (il ne fait que `scene.add`). Construction : au premier `actif(true)`, un décor par créneau `requestIdleCallback` (timeout 1,5 s) ; si l'utilisateur choisit un mode
  avant que son décor soit prêt, il est construit tout de suite au début de la transition (≈ 100 à 250 ms, absorbés par les 1,6 s d'arc). Aucun décor de mode n'est construit sans panneau ouvert.
  Zone du BR : un plan `PlaneGeometry(6000, 6000)` à y = 0,6 avec `ShaderMaterial` (uniformes centre, rayon, cible, rayon cible, temps) : intérieur transparent, bord cyan lumineux
  (liseré de 2 m), extérieur rouge `--ag-danger` à 14 % d'opacité avec un balayage lent, cercle visé en pointillés blancs. Avion du BR : `creerAvionFilaire()` (la fonction extraite de
  `scene.ts`, voir plus bas) posé sur `positionAvionBr` / `capAvionBr`, feux clignotants comme celui de l'arène. Chute et voile : le faisceau du joueur descend jusqu'au sol (longueur =
  altitude) et l'anneau reste en l'air.
- `lib/agroparc3d/scene.ts` (modifié) :
  - le décor fixe de l'arène va dans `const decorArene = new THREE.Group(); scene.add(decorArene)` (même contenu, même ordre : aucun changement visuel) ;
  - `repos` devient modifiable (`pos`, `target` recopiés depuis `poseCadrage`) ; `recentering` est généralisé en `transition { t, duree, de, vers, leve, courbe, milieu }` : `recenter()` crée
    la même transition qu'avant (1,2 s, courbe `ease`, `leve = 0`) vers le cadrage du mode affiché ; la transition de mode utilise la courbe entrée-sortie et `leve` ; à `k ≥ 0,5` elle
    appelle une seule fois `apercu.echangerDecor()` et `impulsion` ; le brouillard (`FogExp2.density`) est interpolé de la valeur de départ à celle du mode ;
  - `SceneHandle.apercu: ApercuHandle` (`mode`, `actif`, `direct`, `etat`), chargé paresseusement : `import("@/lib/fps/rendu-apercu")` au premier `actif(true)` (les appels reçus avant
    la fin du chargement sont mémorisés : seul le dernier état voulu est appliqué) ; `OptionsScene.modeInitial?: ModeSalle` (la scène recréée après une partie démarre directement sur le cadrage du
    mode du lobby, l'intro d'arrivée vise ce cadrage) ;
  - `JoueurAerien` reçoit `sim?: true`, `chute?: "libre" | "voile"`, `hors?: "terre" | "mort"` (tous optionnels, vue inchangée sans eux) et `majJoueurs` un second paramètre
    `{ lisser?: boolean; etiquettesMax?: number }` : `lisser` = position visée + lissage exponentiel (`1 − exp(−12 dt)`, téléport au-delà de 12 m) dans la boucle, désactivé par défaut (le chemin
    historique de l'arène reste identique) ; `etiquettesMax` plafonne les étiquettes (les plus proches de `controls.target`, recalcul à 2 Hz). Repère d'un faux joueur : anneau en
    pointillés (`LineDashedMaterial`, `computeLineDistances`), faisceau à 40 % d'opacité, étiquette `data-sim="1"` ; repère « à terre » / « mort » : gris `--ag-ink-dim`, anneau seul ;
  - hors arène, POI + faisceaux + étiquettes, voitures, bus, avion de l'arène, Truck et tigre caché sont masqués (`TigreCache.afficher(b: boolean)` ajouté à `tigre.ts` : cache le groupe et
    ignore le clic) ; retour en arène : ils reviennent (le Truck garé reste garé, son marqueur n'est rallumé que s'il est arrivé).
  - l'avion filaire de l'arène est extrait en `creerAvionFilaire()` dans `decor.ts` (géométrie identique, test de structure : 6 enfants) pour que le BR le réutilise.
- `lib/fps/br-carte.ts` : `export const bornesBr = bornesDe` (une ligne). `lib/fps/rendu-interieurs.ts` : signature élargie à `THREE.Object3D`.

### React

- `app/components/arene/useArene.ts` : cas `apercu` (avant `jeuRef.current?.recevoir`) : `apercuRef.current = decoderApercu(m, Date.now())`, `apercuTRef.current = Date.now()` (comme `snapRef` /
  `snapTRef`) ; remis à null au changement de salle (`mode`) ; exposés par `UseArene` (`contrats.ts`). Aucun état React (pas de rendu à 5 Hz).
- `app/components/arene/BadgeApercu.tsx` (+ styles dans `Agroparc3D.module.css`, tokens `--ag-*` seulement) : `role="status"` `aria-live="polite"`, remplace la légende du bas à gauche
  (`.legend`) tant que le panneau est ouvert et que le mode n'est pas l'arène, en plus au-dessus d'elle en arène (une ligne). Texte : pastille « SIMULATION » (contour pointillé,
  `--ag-ink-dim`) ou « EN DIRECT » (pastille pleine `--ag-ok`, point qui pulse sauf `prefers-reduced-motion`) + titre (« Match à mort », « Zombies tigres », « Battle Royale ») + détail
  (« 9 agents fictifs », « manche 4 · 3 survivants · 14 tigres », « 23 en vie sur 31 · zone 3/6 · partie br2 »). Légende de mode : arène « Agents », zombies « Survivants · Tigres ·
  Fenêtres », BR « Joueurs · Zone · Avion ». Sans direct pendant qu'une partie est en cours (`salons`) : « Simulation · partie en cours, aperçu en direct indisponible » (ancien serveur).
  Mis à jour à 2 Hz au plus et seulement si le texte change.
- `app/components/Agroparc3D.tsx` : l'effet « Spectateurs » devient l'effet « Aperçu » : (a) `modeAffiche = areneOuverte && !selected ? arene.modeVoulu : "arene"` ; `rendu.actif(areneOuverte &&
  !selected && !enArene)` ; `rendu.mode(modeAffiche)` ; (b) intervalle de 100 ms : arène (`mode confirmé = "arene"`) → direct construit depuis `snapRef` comme aujourd'hui (même filtre
  `vivant && enJeu`, âge < 2 s) ; zombies et BR → `decoderApercu` déjà fait, complété par `arene.zombies?.fenetres` et `arene.br?.zone/avion` (même `recuT`) ; envoi à `rendu.direct()` seulement
  quand `apercuTRef` a changé ; (c) panneau fermé (ou restaurant choisi) : exactement le chemin historique (`h.joueurs(liste)` toutes les 250 ms, liste vide au nettoyage). `OptionsScene.modeInitial` =
  `areneOuverte ? arene.modeVoulu : "arene"` à la création de la scène (`sceneRef` relu dans l'effet qui crée la scène, sans le mettre en dépendance). Ajoute `window.__palantir.apercu()`,
  `apercuGraine(n)` (recrée la simulation avec une graine imposée) et `apercuAvancer(s)` (avance la simulation de `s` secondes, pas de 1/30 s) en développement.
- `ChoixMode.tsx`, `lobby-modele.ts` : inchangés. Le choix du mode reste synchrone (`modeVoulu`) ; sur `refus`, `modeVoulu` revient et la caméra repart vers l'ancien mode.

### Serveur

- `lib/fps/protocole.ts` : types `JoueurApercuFil`, `BrApercu`, `ApercuFil`, et la variante `| { t: "apercu"; ts: number; mode: ModeSalle; partie?: string; j: JoueurApercuFil[]; z?: SnapZombies; m?: number;
  br?: BrApercu }` de `MessageServeur` (commentaire : additif, `VERSION_PROTOCOLE` inchangé). `VERSIONS_ACCEPTEES` inchangé.
- `lib/fps/match.ts` : `sortiesSnap` : quand `(this.zombies || this.br) && this.nombreJoueurs() > this.nombreEnJeu()` (il y a des spectateurs) et que `this.rangApercu++ % N === 0` (N = 4 en
  zombies, 3 en BR), ajoute `{ a: "spectateurs", m: construireApercu(...) }` réutilisant le `snap(maintenant)` et le `zombies.snap()` déjà calculés (aucun recalcul). `noms` lit la table des joueurs
  (`pseudo`, `couleur`) ; `br` = `{ phase, vivants, total, zone, avion }` fourni par `ServiceBr` (méthode `apercu()` ajoutée à l'interface de `match-br.ts`, valeurs déjà tenues par `etatA`).
  Hors partie (lobby, décompte, fin, pause sans joueur en jeu) : le snap est vide, `nombreEnJeu() === 0` ⇒ la salle ne tique pas ses snaps (déjà le cas) ⇒ pas d'aperçu : le client bascule en simulation.
- `lib/fps/salons.ts` : `partieApercuBr(parties: { id; phase; vivants }[], miennePartie: string): string | null` (PUR) : la sienne si `phase ∈ { vol, jeu }`, sinon la partie en vol / en jeu aux plus
  de `vivants` (égalité : première de la liste), sinon null.
- `serveur-fps/src/index.ts` : `diffuser(salle, sorties)` ajoute `partie` (id) aux `apercu` d'une partie BR ; après le tic d'une partie en vol / en jeu, l'`apercu` est aussi envoyé aux
  spectateurs (inscrits hors jeu) des AUTRES parties BR pour lesquelles `partieApercuBr(...)` désigne cette partie. Aucun autre changement : pas de nouvelle limite de connexions, pas de
  nouvelle variable d'environnement (les essais ralentissent déjà le BR par `PDJ_FPS_BR_*`). Anti-flood : message serveur → client, rien à compter.
- Documentation : `serveur-fps/README.md` (message `apercu`, cadences, relais entre parties BR) et `CLAUDE.md` (puce « Aperçus par mode (vue Palantir) », mention « le serveur doit être
  redéployé pour que le direct des zombies et du BR existe ; sans lui, simulation »).

## Protocole

```ts
/** [id, pseudo, couleur "#rrggbb", x, y, z en décimètres entiers, drapeaux : 1 vivant, 2 chute libre, 4 sous voile] */
type JoueurApercuFil = [string, string, string, number, number, number, number];
interface BrApercu { phase: PhaseBr; vivants: number; total: number; zone: ZoneBr | null; avion: AvionBr | null }
{ t: "apercu"; ts: number; mode: ModeSalle; partie?: string; j: JoueurApercuFil[]; z?: SnapZombies; m?: number; br?: BrApercu }
```

- Émis seulement pour `mode` `"zombies"` ou `"br"`, jamais pour l'arène. Adresse `spectateurs` (inscrits hors jeu de la salle) ; relais entre parties BR par `index.ts`.
- Cadence : toutes les 4 émissions de snap en zombies (snap 20 Hz → 5 Hz), toutes les 3 en BR (snap 10 Hz → 3,3 Hz). Périmé après 3 s côté client.
- Compatibilité : un client d'avant ignore le type inconnu (`switch` sans effet, `jeu.recevoir` l'ignore) ; un client à jour devant un serveur d'avant ne reçoit jamais `apercu` (source =
  simulation, bandeau honnête). Aucun changement de `VERSION_PROTOCOLE`, de `VERSIONS_ACCEPTEES` ni du lobby.

## Budgets de performance

| Mesure | Budget |
|---|---|
| Taille d'un `apercu` BR à 50 joueurs en vie, JSON | ≤ 3,6 Ko (≈ 70 octets par joueur) ; à 3,3 Hz ≈ 12 Ko/s par spectateur |
| Taille d'un `apercu` zombies, 8 joueurs + 24 tigres + Truck | ≤ 1,8 Ko ; à 5 Hz ≈ 9 Ko/s par spectateur |
| Coût serveur de `construireApercu` (50 joueurs) | ≤ 0,15 ms par émission ; coût moyen d'un tic BR à 50 joueurs avec 5 spectateurs ≤ 2 ms (`match.br.charge.test.ts` inchangé) |
| Aucun spectateur | zéro octet, zéro appel (test) |
| Décor d'un mode (construction, thread principal) | ≤ 250 ms zombies, ≤ 300 ms BR ; hors transition quand la file d'inactivité a eu le temps |
| Mémoire GPU des décors supplémentaires | ≤ 12 Mo au total (deux groupes de bâtiments + intérieurs) ; libérée à `dispose` |
| Appels de dessin supplémentaires | arène/zombies ≤ 60 ; BR (50 repères + zone + avion) ≤ 180 ; décors masqués : 0 |
| JS par image (simulation BR de 32 + marqueurs + lissage) | ≤ 1,2 ms ; pas d'allocation par image après échauffement |
| Étiquettes HTML | ≤ 16 au total en aperçu (12 joueurs en BR + légendes) |
| `pas(dt)` d'une simulation (test) | 20 000 pas de 1/30 s en < 1,5 s sous vitest, par simulation |
| Premier chargement du menu | inchangé (aucune importation nouvelle hors `Agroparc3D` ; `rendu-apercu` chargé au premier `actif(true)`) |

## Plan de tests

**Unitaires (vitest, Node 22) :**
- `apercu-cadrage.test.ts` : le cadrage d'arène égale `REST` ; pour chaque mode, la cible est dans les bornes de sa carte, la distance caméra-cible est dans [`minDistance` 40, `maxDistance` 1800]
  des contrôles, l'angle de plongée est dans [25°, 70°] ; `interpolerCadrage` vaut `de` à k = 0 et `vers` à k = 1, est continue, monte à k = 0,5 ; `dureeTransition` = 0 en mouvement
  réduit, ≤ 2,6 s ; l'ordre arène → zombies → BR est symétrique en durée.
- `apercu-reseau.test.ts` : aller-retour `construireApercu` → JSON → `decoderApercu` (positions au décimètre, drapeaux, pseudos, tigres via `decoderZombies`) ; budgets de taille ci-dessus sur
  50 joueurs et 24 tigres ; `estimerDecalageServeur`.
- `apercu-source.test.ts` : `choisirSource` (mode non confirmé, apercu périmé, aucun joueur, ancien serveur) ; `SuiviSource` (4 s d'hystérésis, retour immédiat au direct) ; `libelleBandeau`.
- `apercu-sol.test.ts` : sur le VRAI `scene.json` (lu comme `cachettes.test.ts`) : aucun point tiré par `pointLibre` dans un bâtiment plein ni dans l'eau (1 000 tirages par graine), `pas` ne
  traverse jamais un mur, une grille construite en < 50 ms.
- `apercu-noms.test.ts` : prénoms uniques, couleurs distinctes, au-delà de 16.
- `apercu-sim-arene.test.ts`, `apercu-sim-zombies.test.ts`, `apercu-sim-br.test.ts` : (1) déterminisme : même graine, mêmes `modele()` après 900 pas, graines différentes → positions
  différentes ; (2) invariants sur 10 graines × 120 s : positions finies, dans les bornes, jamais dans un bâtiment plein, jamais plus de 16 agents (arène) / 4 survivants et 64 tigres
  (zombies) / 32 joueurs (BR), `sim: true` sur tous les repères ; (3) arène : au moins un kill par 30 s, réapparition après 3 s ; (4) zombies : chaque tigre apparaît sur un `points` d'une
  fenêtre du front, `fenetres[i]` ne remonte pas pendant une manche et revient à 6 entre deux manches, un tigre ne passe en `chasse` qu'après `saut`, la manche s'incrémente, le cycle se termine
  puis repart avec une autre ancre ; (5) BR : le nombre de vivants décroît sans jamais augmenter, un seul vainqueur à la fin du dernier palier, le rayon de la zone ne grandit jamais,
  l'avion traverse les bornes, les joueurs en chute descendent sans remonter, le cycle repart avec un autre effectif ; (6) variété : sur 20 graines, ≥ 4 effectifs et ≥ 3 ancres / trajectoires
  distincts ; (7) performance (cf. budget).
- `apercu-zombies-vue.test.ts` : bâtiment des survivants, fenêtres attaquées, correspondance fenêtre → bâtiment sur la vraie carte.
- `match.apercu.test.ts` (modèle de `match.zombies.test.ts` / `match.br.test.ts`) : zombies avec un joueur en jeu et un spectateur : un `apercu` toutes les 4 émissions de snap, contenant les tigres
  et le joueur ; BR : toutes les 3, avec `br.zone` et `br.avion` ; sans spectateur : aucun ; en arène : aucun `apercu` (le snap aux spectateurs reste identique octet pour octet) ; les joueurs « à bord
  de l'avion » BR n'y figurent pas ; budgets de taille ; `match.zombies.charge.test.ts` et `match.br.charge.test.ts` restent verts (à lancer seuls).
- `salons.test.ts` : `partieApercuBr` (la sienne en jeu, la plus peuplée sinon, null sinon, égalité).
- `decor.test.ts` (étendu) : `creerAvionFilaire` (structure) ; `tigre.ts` : `afficher(false)` cache le groupe.
- Les tests existants (`decor`, `cachettes`, `facade`, `salons`, `match.*`) passent sans modification de leurs attentes.

**Vérification visuelle headless** (`scripts/fps/captures_apercus.mjs`, mêmes conventions que `captures_zombies.mjs` : Playwright, `next dev` et `serveur-fps` sur ports libres, `window.__palantir`) :
1. Ouvrir la vue (code `myrtille`), ouvrir « Arène » : cadrage d'arène, bandeau « Simulation · Match à mort », ≥ 4 repères en pointillés mobiles ; capture.
2. Cocher « Zombies tigres » : transition (captures à 0, 0,5 et 1 s), décor des zombies, bandeau « Simulation · Zombies tigres », tigres et fenêtres animés ; `apercuAvancer(60)` montre une manche
   avec fenêtres rouges ; capture avec contour de bâtiment pulsant.
3. Cocher « Battle Royale » : avion, parachutes, zone qui se resserre (`apercuAvancer`), éliminations ; capture ; revenir à « Arène » : décor, POI et voitures de retour, strictement identique à la
   capture avant ouverture (comparaison de pixels sur une zone sans éléments mobiles, ou `apercu().camera` égale à `REST`).
4. Panneau fermé : `apercu().actif === false`, aucun faux joueur, caméra `REST`, décor de l'arène visible (non-régression).
5. `prefers-reduced-motion` (`emulateMedia`) : changement de mode sans arc (durée 0).
6. Direct (script `e2e_apercus.mjs`, deux Chromium, serveur avec `PDJ_FPS_ZOMBIES_TOTAL` grand et `PDJ_FPS_BR_MIN_JOUEURS=1`) : B joue en arène → A (panneau ouvert, arène) voit « En direct » avec B ; B
   lance une partie de zombies → A coche Zombies (arrivée après le lancement) voit B et les tigres, bandeau « En direct · manche 1 » ; idem BR (A regarde la partie en vol de B, sans le jeu) ; le serveur
   coupé (`apercu` absent) → simulation sous 4 s. Écran : captures dans `E2E_OUT`.
7. Mesures : `performance.now` moyen d'une image avec BR de 32 joueurs simulés (budget ci-dessus), nombre d'appels de dessin (`renderer.info.render.calls`).

## Découpage en étapes de commit (branche de l'issue, locaux)

1. `feat(apercu): flux d'aperçu additif des zombies et du Battle Royale` : protocole, `apercu-reseau.ts`, émission dans `match.ts` / `match-br.ts`, `partieApercuBr`, relais dans `index.ts`,
   `useArene` (stockage), tests serveur, charge.
2. `feat(apercu): cadrages et transition de caméra par mode` : `apercu-cadrage.ts`, `bornesBr`, `scene.ts` (décor en groupe, `repos` mutable, transition généralisée, `OptionsScene.modeInitial`,
   `creerAvionFilaire`, masquage hors arène, `TigreCache.afficher`), tests.
3. `feat(apercu): décors des zombies et du Battle Royale dans la vue aérienne` : `rendu-apercu.ts` (décors paresseux, échange au point haut, bloom, brouillard), `creerRenduInterieurs(Object3D)`,
   zone en nuanceur, avion BR.
4. `feat(apercu): simulations pures de l'arène, des zombies et du Battle Royale` : `apercu-sol`, `apercu-noms`, trois sims, `apercu-zombies-vue`, tests (déterminisme, invariants, perf).
5. `feat(apercu): repères fictifs et en direct, tigres instanciés, fenêtres, zone` : extension de `JoueurAerien` / `majJoueurs`, nuée de tigres, barres de fenêtres, contour de bâtiment, journal.
6. `feat(apercu): choix direct ou simulation et bandeau` : `apercu-source.ts`, `BadgeApercu`, effet « Aperçu » d'`Agroparc3D.tsx`, crochets de développement, styles.
7. `test(apercu): captures et bout en bout de l'aperçu par mode` : `captures_apercus.mjs`, `e2e_apercus.mjs`, README du serveur, `CLAUDE.md`, `npm run build`.
   Avant chaque commit : `npx vitest run lib/agroparc3d lib/fps`, `npx tsc --noEmit -p .`, `cd serveur-fps && npm run typecheck`.

## Risques et parades

| Risque | Parade |
|---|---|
| Régression de la vue aérienne normale | Décor de l'arène dans un groupe de même contenu ; tout le reste derrière `actif(true)` ; test visuel 4 (caméra `REST`, mêmes POI) ; chemin historique de l'effet « Spectateurs » conservé panneau fermé |
| Le spectateur de zombies est admis à la prochaine pause (`match-zombies.ts`) : le jeu se monte et détruit la vue | Comportement existant, pas touché : le direct des zombies dure jusqu'à la prochaine pause pour un arrivant ; le bandeau l'affiche (« vous rejoindrez à la prochaine manche » vient du lobby) |
| Pas de direct en BR si une autre partie est en cours que celle du client | Relais d'aperçu entre parties (`partieApercuBr`) ; sinon simulation |
| Construction du décor qui bloque l'interface | Créneaux d'inactivité, un décor par créneau, repli synchrone masqué par l'arc de la caméra ; budgets mesurés |
| Contexte WebGL ou mémoire (3 décors) | Pas de nouveau renderer ; décors libérés à `dispose` ; `rendu-apercu` libère ses géométries et matériaux ; décors non affichés `visible = false` (zéro dessin) |
| Faux joueurs pris pour un vrai direct | Repères en pointillés, « ◇ », bandeau « SIMULATION » toujours visible, jamais de mélange |
| Simulation qui fait marcher des agents dans les murs | `apercu-sol` (grille rastérisée de la vraie carte) et tests d'invariants sur 10 graines ; tigres des zombies : trajets droits `dehors` → `dedans` → survivant, les cloisons intérieures ne sont pas modélisées (aperçu, pas gameplay) |
| Ancien serveur (non redéployé) | Aucun `apercu` : simulation avec bandeau explicite ; le serveur doit être redéployé pour le direct, ordre indifférent |
| Charge réseau du serveur (1 vCPU) | `apercu` seulement s'il y a des spectateurs, ≤ 12 Ko/s par spectateur, réutilise le snap déjà calculé ; test de charge existant maintenu |
| Rendu logiciel des tests headless très lent (2–10 images/s) | Les scripts avancent la simulation par `apercuAvancer` plutôt que d'attendre ; captures après une durée fixe de transition lue dans `apercu().transition` |
| Accessibilité | Bandeau `role="status"` mis à jour à 2 Hz au plus ; aucune information portée par la seule couleur (pointillés, glyphe « ◇ », texte du bandeau) ; mouvement réduit : coupure franche, pas d'impulsion |

## Déploiement

Additif, aucun ordre imposé. Le serveur (`wss://pdj-fps.toam.tech`) doit être reconstruit et redéployé pour que l'aperçu en direct des zombies et du Battle Royale existe (un client à jour devant un serveur
d'avant affiche la simulation) ; le site Vercel peut être déployé avant ou après. Aucune migration, aucune variable d'environnement nouvelle, `public/agroparc/*.json` inchangés.
