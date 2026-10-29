# Mode zombies v8 : retours du joueur (collisions, réseau, carte, objets, armes, grenades, Truck Muche, sons, ragdolls, grand secret) — design

Date : 2026-10-29 · Protocole : `VERSION_PROTOCOLE = 8` · Prime sur `2026-10-28-zombies-bo1-design.md` (v7) là où elles divergent, et donc
sur `2026-10-27-arene-zombies-design.md`. La solution du grand secret est dans `2026-10-29-zombies-secret-SOLUTION.md` (développeurs
seulement) : ce document n'en décrit que l'architecture.

## Demande

Après avoir joué la v7, le joueur a envoyé dix-sept retours. Une seule PR, découpée en lots (`zr/<lot>`) fusionnés sur la branche :

| n° | retour du joueur | réponse (lot) |
| --- | --- | --- |
| 1 | on traverse les tigres | corps solides côté client et serveur (`collision`), puis calibrage (`corps-v2`) |
| 2 | des armes de BO1, un Pack-a-Punch qui change vraiment l'arme | huit armes renommées, profils gratinés à effets (`armes`) |
| 3 | les barricades ne se reposent pas | aiguillage de `reparer` corrigé, cadence de BO1 (`objets`) |
| 4 | le Happy hour doit être le Fire Sale | une boîte à 10 $ à chaque emplacement pendant 30 s (`objets`) |
| 5 | rien n'indique une arme améliorée dans le HUD | nom gratiné, teinte et icône du Micro-ondes (`armes`) |
| 6 | le Micro-ondes doit garder l'arme comme le vrai | dépôt, cuisson, reprise par son seul joueur, sinon perdue (`objets`) |
| 7 | les manches du Truck Muche ne font pas peur | foudre, petits plus rapides, mini Trucks explosifs, orage (`truck`) |
| 8 | boîtes mal posées, de travers | chaque boîte dans un coin, droite, envol corrigé (`carte`, `objets`) |
| 9 | la tête passe à travers les plafonds | faux plafonds et linteaux solides (`collision`) |
| 10 | rollbacks, téléportations, gels | budget de distance, relève sans téléportation, reprise, navigation incrémentale (`reseau`) |
| 11 | les portes explosent en pluie de blocs | la porte se soulève et s'efface, débris à durée de vie bornée (`objets`) |
| 12 | trop de grands espaces | cours resserrées par des oliviers, parking du personnel (`carte`) |
| 13 | annonces vocales ratées | fichiers d'annonces et chargeur d'échantillons (`audio`) |
| 14 | des grenades | grenade à fragmentation et tigre à remontoir de BO1 (`grenades`) |
| 15 | les tigres meurent tout raides | morts désarticulées en ragdoll (`ragdoll`) |
| 16 | le coup de patte du gros tigre rouge doit s'entendre | son échantillonné calé sur le contact, jamais muet (`audio`, `truck`) |
| 17 | la Recette ultime est trop facile (finie à la manche 8) | grand secret « Le Menu fantôme » à neuf étapes sans aucun indice affiché (`secret`) |

## Sources

- Scripts GSC de BO1 (`maps/_zombiemode*.gsc`, mêmes dépôts que la v7) : Pack-a-Punch (`vending_weapon_upgrade`, `packapunch_timeout`),
  barricades (`blocker_trigger_think`), bonus (`get_valid_powerup` : pas de Fire Sale avant le premier déménagement de la boîte),
  Fire Sale, chiens et chiens de feu (`_zombiemode_ai_dogs.gsc`, `dog_round_aftermath`), grenades (`award_grenades_for_survivors`),
  Monkey Bomb, fichiers d'armes `*_zm` / `*_upgraded_zm` (dégâts, chargeurs, effets).
- Black Ops 2 Origins pour l'esprit du grand secret (indices dans le décor, déclencheurs variés, rien d'affiché).
- Sons libres, licence vérifiée : Kenney (CC0), Oculus Audio Pack 1 (CC BY 4.0), Inexor AudioAugust (CC BY 4.0) ; annonces par espeak-ng +
  MBROLA fr1 ; micro-ondes synthétisé par ffmpeg. Crédits dans `public/arene/CREDITS.txt`. Toujours AUCUN fichier d'Activision.

## Corps des tigres (retours 1, calibrage)

- `lib/fps/corps-tigres.ts` (PUR, client et serveur) : une capsule horizontale par tigre en chasse, sur l'axe du cap, tête exclue : de
  −0,335 à +0,315 × échelle, rayon 0,115 × échelle (au moins 0,31 m), dos à 0,45 × échelle (× 0,6 rampant). Ignorés : morts, modes `sol`,
  `saut`, `fenetre` (et `approche` côté serveur).
- Client : `jeu.ts` échantillonne les tigres AVANT le mouvement et passe les corps à moins de 8 m à `etape(…, obstacles)` (`CorpsTigres`).
  Dans `mouvement.ts`, on glisse le long d'un corps sans jamais y entrer plus qu'au début du pas ; un tigre apparu sur le joueur le repousse à
  4 m/s (`MOUV.capsulePoussee`) ; les murs restent prioritaires. Anti-coinçage (`EtatMouvement.coince`, hors protocole) : aucune direction
  libre pendant 0,5 s (`coinceS`) sans avancer de 0,2 m → on traverse les tigres 0,6 s (`fantomeS`). Une porte fermée par deux tigres n'est
  pas un étau (on peut reculer).
- Serveur : `zombies.ts` `ecarterDesJoueurs` écarte d'un joueur debout le tigre qui le chevauche (seul le tigre bouge).
- **Calibrage demandé ensuite** (« il faut deux tigres bien placés pour bloquer une porte ; en sautant ou en pas chassé on doit pouvoir passer
  entre un tigre et la porte, voire entre deux ») : rayon du joueur face aux tigres (`rayonContreTigres`) 0,4 m en marchant, 0,33 m en pas
  chassé (`rayonTigreCrabe`), 0,26 m en l'air (`rayonTigreAir`). Deux tigres côte à côte (1,4 m d'entraxe, 0,78 m de vide) arrêtent qui
  marche droit, pas qui saute ou passe en crabe ; deux tigres de biais ferment la porte. On saute par-dessus un petit (dos à 0,68 m).

## Plafonds (retour 9)

- `collision.ts` : `Prisme.plafond` (dessous d'un plafond solide, indépendant de `h`, gardé quand le prisme est détruit), `Monde.plafonds`,
  `plafondSur` (Infinity sans plafonds : arène et vue aérienne inchangées).
- `construireMondeZombies` pose le faux plafond `plafondZombies(h)` = min(`HAUTEUR_PLAFOND_ZOMBIES` = 3,4 ; h − 0,3) sur les bâtiments
  creusés et le linteau de 2,6 m (`HAUTEUR_PORTE_INTERIEURE`) sur les portes intérieures ; `rendu-interieurs.ts` dessine à la même hauteur.
- Les pieds restent à `MOUV.degagementTete` (œil + 0,15 = 2,10 m) sous le plafond : le saut s'y arrête, sauter trop haut dans une porte fait
  buter, un meuble trop haut pour y tenir debout renvoie au sol. L'escalade est coupée par `sansParkour`.

## Réseau (retour 10)

- **Budget de distance** à la place de la vérification instantanée (`Salle.recevoirEtat`) : un seau à jetons crédité de 19 m/s (45 en
  vertical) × le temps serveur écoulé, plafonné à `BUDGET_ARENE_S` = 0,5 s ou `BUDGET_ZOMBIES_S` = 1 s, marges `MARGE_ETAT_H_M` = 1 m et
  `MARGE_ETAT_V_M` = 1,5 m. Les rafales de paquets passent toutes ; un dépassement est accepté en partie (la position avance de ce que permet
  le budget), dans l'arène comme en zombies, sauf juste après une téléportation (jusqu'au premier état accepté en entier). Un tricheur ne
  gagne que la durée du plafond. Conséquence pour les scripts : plus aucun saut de 40 m, les e2e avancent par pas de 9 m (arène) et 18 m
  (zombies).
- **Relève sans téléportation** : `placerJoueur(…, { garder: true })` ne touche ni position, ni lacet, ni budget ; `apparition{garder}` :
  le client garde sa position et son regard (`gardePosition` de `reseau.ts`, à moins de `ECART_GARDE_M` = 3 m, toujours s'il est debout
  chez lui) et ses chargeurs. Un joueur à terre continue d'envoyer ses états (`ServiceZombies.aTerre`).
- **Griffe jugée en faveur du joueur** : à la fin de l'armement sur la position serveur, puis un aller-retour plus tard
  (`GRIFFE_DELAI_MAX_MS` = 200 ms, tigre figé dans son coup) ; il faut être dans le balayage les deux fois. Portées de relève, de planches et
  d'achats : + vitesse × demi-latence (1,5 m au plus).
- **Gel à l'achat d'une porte** (40 à 80 ms de calcul, ≈ 250 ms de gel réel sous 0,3 vCPU) : `majNavigation` recalcule sur place les seules
  cases autour de la porte (0,5 ms, identique à un recalcul complet) ; `instantaneNavigation` / `restaurerNavigation` pour le retour au lobby.
  Le conteneur passe à 1 vCPU et 384 Mo.
- **Anti-flood** pur (`anti-flood.ts`) : flux (`etat`, `conduite`, `pilotage`, `ping`) 45/s rafale 90, actions 90/s rafale 270 ; l'excédent
  est jeté sans fermer ; seule une fenêtre de plus de 600 messages bruts par seconde coupe.
- **Reprise après une micro-coupure** : un membre d'une partie en pause ou en manche coupé par le réseau (pas un code 1000, 1001 ou 1005 :
  `garderPourReprise` de `salons.ts`) est gardé 20 s (`REPRISE_MS`) ; le client renvoie id + jeton (`bonjour.reprise`) et retrouve sa
  partie au même id (`bienvenue{reprise}`, `zombies`, `batiments`, `argent`, `apparition{garder}`). Plus d'éviction pour inactivité en
  zombies (onglet caché).

## Carte (retours 12 et 8)

- Seules la Cour Centre et la Cour Est restent de grandes cours (cercle inscrit ≈ 12 m), chacune autour d'un olivier (`OLIVIERS`, `OLIVIER` :
  tronc de 0,9 m, haut de 2,4 m, bac octogonal bas qui n'est pas un refuge). La Cour Ouest devient le « Parking du personnel » : une rue le
  long du Labo puis quatre rangées d'îlots (voitures, conteneurs, palettes, haies), allées de 4,2 à 4,6 m. Pile de palettes au Passage Est,
  baie de plus au Local technique, meubles hauts recalés pour qu'un tigre seul ne bloque plus un recoin.
- Les aménagements (`PIECES_AMENAGEMENT`, genres `olivier`, `bac`, `haie`, `conteneur`, `palette`, `voiture`, `terrasse`, `muret`) sont
  ajoutés À LA FIN des pièces : les index de la v7 ne bougent pas, mais la carte partagée change (protocole 8).
- Boîtes : les cinq emplacements sont dans un coin, dos au mur, un bout à 0,15 m du mur perpendiculaire (`BOITE`, `tCoin`).
- Rendu : `rendu-interieurs.ts` dessine aussi les meubles du dehors (olivier low poly construit dans le code, aucun GLB).

## Barricades (retour 3)

`reparer` n'était pas aiguillé par `Salle.recevoir`. On repose en MAINTENANT E : première planche 0,2 s après l'appui
(`ZOMBIES.reposePremiereS`), puis une toutes les 0,9 s (`reposeS`), jamais plus vite en relâchant et réappuyant ; 10 $ par planche plafonnés à
min(50 × manche, 500). `decisionMaintien` (pur) démarre le maintien même si E était déjà enfoncée en arrivant. Le Menuisier remplit toutes
les fenêtres (planches qui reviennent en volant).

## Happy hour = Fire Sale (retour 4)

`zombies-boites.ts` (pur) : pendant 30 s, une boîte temporaire à chaque emplacement libre (`EtatPartieZombies.boitesSoldes`), toutes à
10 $, ni peluche ni déménagement, tirages non comptés pour la peluche ; un second Happy hour relance la minuterie ; la boîte en cours finit son
tirage. Le bonus n'est offert qu'après le premier déménagement et jamais pendant un Happy hour. Une boîte qui s'envole attend en l'air
plutôt que d'écraser un tirage payé (`ATTENTE_ENVOL_MS`).

## Micro-ondes Gratinator (retour 6)

On paye 5 000 $, l'arme quitte l'inventaire (`Equipement.enCuisson`, son slot est vide) et entre dans la machine ; cuisson de 4 s
(`PACK_A_PUNCH`), puis `EtatPap.etat = "pret"` : seul le déposant la reprend (E, gratuit, chargeurs pleins) pendant 15 s, sinon elle est
perdue sans remboursement. Le slot reste réservé (mur et boîte refusés « occupe », la boîte ne tire plus une arme de ce slot). Rendu
`rendu-microondes.ts` (cavité, plateau, porte vitrée, afficheur), chronologie pure `microondes-anim.ts`.

## Portes et débris (retour 11)

La porte achetée se soulève et s'efface (`ouverture-portes.ts`, `rendu-portes-zombies.ts`) : poussière au pied, 5 à 9 éclats légers, son de
verrou ; la pièce disparaît sans seuil (`EtatDestruction.effacer`). Tous les débris ont une vie bornée (`debris-vie.ts`) : 2,2 s + 0,8 s de
fondu pour une porte, 35 s + 2,5 s pour les gravats de l'arène.

## Armes et Pack-a-Punch à effets (retours 2 et 5)

- Huit armes réservées aux zombies (`ARMES_PRINCIPALES_ZOMBIES`, `ARMES_SECONDAIRES_ZOMBIES`, jamais au lobby de l'arène) : Coupe-baguette
  (Olympia), Agrafeuse (FAL), Photocopieuse (PPSh), Essoreuse (SPAS), Brochette (arbalète, carreau explosif), Soufflerie (Thundergun),
  Grille-pain (Wunderwaffe) et Perforeuse (CZ75). À la craie : Coupe-baguette 750 $ (Passage Ouest), Agrafeuse 1 200 $ (Passage Est),
  Photocopieuse 1 500 $ (Local technique), Perforeuse 1 000 $ (Labo) ; les autres sortent de la boîte.
- Chaque `Arme.zombie.ameliore` a un nom, un `nomCourt` (10 caractères au plus) et des effets lus par `statsTir` : `akimbo` (clic gauche =
  main droite, clic droit = main gauche, `tir.main: "g"`), projectile balistique (Moutarde & Sally, Brochette du chef : message `projectile`,
  `zevt{projectile}`), `brulure` (cause `feu`), `explosion`, `ricochets` (`touches[].seg`), `arc` (cause `electrique`), `perce`, cône de la
  Soufflerie (cause `souffle`, la XXL gèle), cadence, automatique, chargeur, `viseur` (`point_rouge`, `holo`, `lunette`, `thermique`) et
  `zooms`. Logique pure `effets-armes.ts`, application serveur dans `match-zombies.ts` ; un souffle reste borné à son rayon sous insta-kill et
  le Truck Muche ne prend que le profil de l'arme (`degatsTirTruck`).
- HUD : une arme gratinée affiche son nom amélioré, la teinte `--ag-gratin` et l'icône du Micro-ondes ; le rack affiche le nom court.

## Grenades (retour 14)

- Moteur PUR `grenades.ts` partagé client / serveur (pas fixe 1/60 s, rebonds sur murs, toits, sol et faux plafond, roulement) ; le serveur
  calcule la trajectoire une fois et diffuse `grenade`, le client la redessine à l'identique.
- Grenade à fragmentation de BO1 : mèche 3,5 s, cuisson en maintenant G, souffle de 6,5 m de 600 à 150, bloqué par les murs, lanceur blessé de
  45 PV au plus ; +2 par manche, 4 au plus ; une toutes les 0,5 s.
- Tigre à remontoir (Monkey Bomb) : 3 par la boîte (touche B), attire les tigres à 40 m pendant 8 s (sauf les mini Trucks), puis saute
  (1 200 → 400). Champ de distance propre aux leurres, suivi par les seuls tigres attirés.
- Touches `grenade` (G) et `remontoir` (B) : contexte zombies, jamais actif avec celui de l'arène (G invoque le tigre, B lance le fumigène).

## Manches du Truck Muche (retours 7 et 16)

- Petits (type 3) à 13,5 m/s, au-dessus du sprint du joueur (12,5) : on ne les sème plus qu'en glissade ; morsure armée en 0,22 s, recharge
  0,45 s, 30 PV en Plat (× 0,75 Entrée, × 1,25 Goulaf). Nouveau type 4, le **mini Truck Muche** (chiens de feu) : 14 m/s, vire mal, mèche à
  2,2 m d'un joueur puis saute (souffle de 4,5 m, 80 → 15 PV) ; abattu, il saute 120 ms plus tard et blesse aussi les tigres (réaction en
  chaîne, kills au tireur) ; les leurres ne l'attirent pas.
- Nombre : 8 par joueur, 11 dès la 3ᵉ livraison, au moins 10 en solo ; vivants au plus `min(24, 4 + 3 j)` ; 25 %, 35 % puis 50 % de mini Trucks.
- Apparitions par la foudre (`zombies-truck.ts`) dès 1,5 s : point d'une zone active à 6–18 m d'un joueur, annoncé 0,6 s avant
  (`zevt{eclair}`), intervalle de 1,4 à 0,8 s selon la livraison, jusqu'à −50 % en fin de manche ; le Truck lâche aussi un ennemi par seconde
  à son quai et rit (`zevt{truck, rire}`).
- Ambiance (`ambiance-zombies.ts`) : brouillard qui tombe en 3 s et se lève 2 s après le dernier ennemi, ciel d'orage, éclairs ; jamais
  d'écran blanc (un quart de l'éclat avec prefers-reduced-motion ; les braises d'une explosion s'éteignent près de la caméra).
- Le chef joue `griffeChef` à chaque coup de patte, aux planches comprises ; 3 voix, puis la griffe synthétisée : jamais un coup muet.

## Sons et annonces (retours 13 et 16)

Registre et logique pure dans `sons-echantillons.ts` : neuf effets (`ECHANTILLONS`), neuf annonces (`VOIX_ANNONCES`, texte de repli
compris), `instantPic` / `departCale` (le pic du fichier tombe au contact de la griffe, quel que soit le fichier), `FileAnnonces` (jamais
coupées). Fichiers dans `public/arene/sons/` et `public/arene/sons/voix/`. Repli `speechSynthesis` corrigé (voix fr-FR, file au lieu de
`cancel()`). `scripts/fps/importer_son.sh` convertit un MP4 (ou autre) en MP3 prêt à remplacer un son : c'est la voie prévue pour le son
du joueur (retour 16), `griffe-chef.mp3` étant PROVISOIRE.

## Morts désarticulées (retour 15)

`ragdoll-tigre.ts` (PUR, client seulement) : 27 particules de Verlet sur les os du GLB, contraintes et bornes d'angles, sol, murs et faux
plafond, 8 ragdolls éveillés au plus (au-delà, le nouveau mort joue la mort rigide de la v7). Impulsion selon l'arme, la zone et l'origine
du coup, que `zombieMort` transmet (`arme`, `ameliore`, `src`). Cadavres 4 s (5 s projetés).

## Grand secret « Le Menu fantôme » (retour 17) : architecture

- Remplace la Recette ultime (quête, ingrédients, four guidés par l'objectif). `objectifZombies` ne montre plus que la progression (sortir
  de l'open space, courant, Labo, Micro-ondes, puis « Survivre »). Les annonces `recette_cuit` / `recette_servie` sont supprimées.
- Règle de conception : AUCUN indice affiché (ni objectif, ni invite, ni compteur, ni annonce) ; tout passe par le décor, le son et les notes
  du lore (allusions sans lieu, ni nombre, ni ordre). Jamais de tirage de la boîte dans une étape obligatoire.
- Machine d'états PURE `lib/fps/zombies-secret.ts` (`creerSecret`, neuf étapes `ETAPES_SECRET`, réglages `SECRET`), ordres tirés à chaque
  partie par son propre générateur (le hasard de la salle n'est pas consommé). Positions dans `SECRET_CARTE` / `INTERACTIONS_SECRET` de
  `zombies-carte.ts`. Serveur : section « grand secret » de `match-zombies.ts`, crochets `tirSecret` / `coupSecret` appelés par `match.ts`,
  écouteur d'explosions. Réseau : `EtatPartieZombies.secret`, `zevt{secret, quoi}`, E sans invite → `acheter{id: "secret:<objet>"}`, réponse
  silencieuse. Client : `reagirSecret` / `majSecretZ` de `jeu.ts`, décor `creerDecorSecret`, sons `Sons.secret`, cinématique
  `CinematiqueZombies`. Récompense : armes gratinées et atouts ; victoire optionnelle (`bilan.victoire`).

## Protocole v8 (`protocole.ts`)

- `apparition.garder`, `bienvenue.jeton` / `bienvenue.reprise`, `bonjour.reprise{id, jeton}`.
- Grenades : client `lancerGrenade{genre, o, d, cuissonMs?}` ; serveur `grenade`, `zevt{grenade}` ; `JoueurZombies.grenades` / `remontoirs`.
- Armes : `tir.main`, `tir.ameliore` (relayé), `tir.touches[].seg`, message `projectile`, `zevt{projectile, arc, souffle}`.
- Snap `zombies` : bit 8 en feu, bit 9 gelé, bit 10 troisième bit du type (4 = mini Truck, bits 0–1 à 0) ; bit 2 = mèche du mini Truck.
- `zombieMort{arme?, ameliore?, src?, cause?}` (causes `feu`, `electrique`, `souffle` en plus).
- `boitesSoldes`, `EtatPap.etat = "pret"`, `zevt{pap, fin}`, `zevt{eclair}`, `zevt{miniTruck}`, `zevt{truck, quoi: "rire"}`,
  `EtatPartieZombies.secret` (remplace `quete`), `zevt{secret}`.
- La carte partagée change (aménagements). **Le serveur déployé doit être reconstruit et redéployé avec le client v8.**

## Essais et vérifications

- Serveur : `PDJ_FPS_ZOMBIES_BONUS` (paquet de bonus imposé), `PDJ_FPS_ZOMBIES_REMONTOIRS`, `PDJ_FPS_ZOMBIES_SECRET` (étape de départ 1 à 9),
  `PDJ_FPS_ZOMBIES_SECRET_MIDI_MS`, `PDJ_FPS_ZOMBIES_SECRET_LIVRAISON` ; dans l'arène, `PDJ_FPS_BUS_MIN_MS` / `_MAX_MS` (bus C3).
- Crochets de développement `window.__arene` : `tuerZombie`, `simuler`, `essayerArme`, `effetArme`, `secret`, `eclair`, `ambianceTruck`.
- Captures `scripts/fps/captures_zombies.mjs` : vues 14 à 20 (cours, parking, boîte), `RAGDOLL=1`, `ARMES=1` (`ESSAIS`), `SECRET=<n>`,
  `SANS_TIGRES=1`. Captures et vidéo d'une manche du Truck dans `docs/medias/zombies-retours/`.
- Tests unitaires de chaque module pur (corps, plafonds, navigation, anti-flood, grenades, effets d'armes, boîtes, Micro-ondes, portes,
  ambiance, Truck, échantillons, ragdoll, secret) et de bout en bout mis à jour (grenade, planche reposée, relève mesurée image par image).

## Reste à faire

- Remplacer `public/arene/sons/griffe-chef.mp3` par le son du joueur (son MP4 n'est pas arrivé) :
  `scripts/fps/importer_son.sh <son.mp4> public/arene/sons/griffe-chef.mp3`, puis l'origine et la licence dans `public/arene/CREDITS.txt`.
- Reconstruire et redéployer `serveur-fps` (v8) en même temps que le site.
