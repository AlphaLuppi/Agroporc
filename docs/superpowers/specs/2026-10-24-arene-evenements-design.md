# Événements de l'arène : Truck Muche fou, tigre robot géant, titan tigre — design

Date : 2026-10-24 · Branche : `feat/arene-evenements` · Protocole : `VERSION_PROTOCOLE = 3`

## Demande

Rendre l'arène plus drôle avec des événements qui touchent tout le monde :

1. **Truck Muche fou** : le Truck devient fou et fonce sur tout le monde, rapidement ; un bandeau l'annonce sur l'écran des joueurs.
2. **Tigre robot géant** (titan de Titanfall en forme de tigre) : un boss que tout le monde crible ; **celui qui l'achève pilote le titan tigre**.

## Règles

- **Minuteur** (`match-evenements.ts`, service de la salle comme Elsa) : premier événement 45 à 70 s après le début du match, puis 70 à 110 s
  après la fin du précédent ; Truck et tigre en alternance (le premier au hasard) ; jamais deux à la fois, jamais pendant le titan, jamais dans une
  arène vide. Annonce à tous 4 s avant le début (`evenement{phase:"annonce"}`), puis `debut` et `fin`. Nouveau match : tout s'arrête.
- **Truck Muche fou** (25 s) : part du stand d'Elsa, vise le joueur vivant le plus proche (révisé toutes les 1,5 s), conduit avec la **physique
  des voitures** (`pasVehicule`, dérapage compris : frein à main quand la cible est franchement de côté à pleine vitesse), suit un chemin A*
  (`navigation.ts`), recule braqué quand il est bloqué. Caisse 6 × 2,6 × 3,2 m : tout joueur dessous meurt (`truck_fou`, aucun tueur) dès
  4 m/s. Se réfugier sur un toit (> 3,2 m) protège.
- **Tigre robot** (150 s au plus) : c'est le VRAI tigre 3D du thème Tigre (`public/tigre/tigre.glb`) à l'échelle `ECHELLE_TIGRE` = 24 :
  26 m du museau au bout de la queue, près de 10 m au garrot, la tête vers 13 m, plus haut que les bâtiments. Pelage rayé assombri en métal,
  maillage lumineux par-dessus, yeux rouges qui grossissent quand le laser est armé ; démarche du moteur `lib/tigre3d/corps.ts` (pieds plantés)
  et geste « rugir » au coup de patte (`tigre-geant.ts`). Il apparaît à 85 m du rond-point du côté dégagé, marche à 6 m/s vers le joueur le plus proche (chemin A* recalculé
  toutes les 1,2 s + moustaches de contournement). PV = 1 500 + 500 par joueur en arène (16 au plus). Attaques (`tigre_robot`, aucun tueur) :
  écrasement sous le corps quand il marche ; **coup de patte** devant lui à 18 m (armé 0,65 s, recharge 2,2 s) ; **laser des yeux** toutes les
  8 s sur un joueur en vue à 110 m au plus : visée annoncée (`laser`) puis impact 1,4 s plus tard sur un disque de 3,5 m (75 dégâts, bouclier
  d'abord) : on l'esquive en bougeant.
- **Tirs sur le tigre** : les touches visent la cible réservée `CIBLE_TIGRE` (`tir.touches`) ; le serveur revalide le rayon sur la forme du
  tigre (8 sphères en m du modèle × échelle, d'après son squelette : tête, poitrail, ventre, croupe, 4 pattes, marge 1,6 m) et les bâtiments ; dégâts = `degatsPlomb` au corps, ×1,5 à la tête ; `degats` au
  seul tireur (marqueur de touche). Le dernier tireur l'achève : `evenement{phase:"fin", raison:"vaincu", par}` puis `titan{phase:"debut"}`.
- **Titan tigre** (90 s) : le même tigre à l'échelle 11 (12 m de long), piloté par le vainqueur (sorti de sa voiture s'il en avait une). Le pilote est invulnérable
  (`infliger`/`tuer` l'ignorent), ne tire plus ses armes, ne monte pas en voiture, ne prend pas les cadeaux d'Elsa. Il simule le titan en local
  (`ControleurTitan`, 10 m/s, glisse le long des bâtiments) et envoie `pilotage` à 30 Hz ; le serveur borne la vitesse (+1 m/s, 1,5 m) et
  refuse une pénétration > 0,6 m dans un bâtiment. **Canon** (`canon`) : tir continu, 0,12 s, 28 dégâts (×1,5 à la tête), 300 m, revalidé par
  le serveur (œil à `OEIL_TITAN` = 6,6 m, cône de visée, `toucheJoueur` avec compensation de latence) ; kills crédités au pilote (`titan`).
  **Écrasement** des joueurs sous le titan quand il marche. Le titan a 1 500 PV ; les autres le criblent (`CIBLE_TITAN`). Fin : détruit
  (explosion, `par` = destructeur), durée écoulée ou pilote parti ; le pilote reprend pied à sa place, PV pleins.

## Protocole v3 (`lib/fps/protocole.ts`)

- Client → serveur : `pilotage{seq, p, cap, lacet, tangage}`, `canon{o, d, touches}` ; `tir.touches[].cible` accepte `CIBLE_TIGRE` / `CIBLE_TITAN`.
- Serveur → client : `evenement{type, phase: annonce|debut|fin|etat, debutT, finT, raison?, par?}`, `laser{de, vers, rayon, tirT}`,
  `explosion{p, rayon}`, `titan{phase: debut|fin|etat, pilote, p, cap, finT, raison?, par?}`, `canon{id, o, d}` ; `snap.monstres{truck?, tigre?, titan?}`
  (joueurs en arène seulement) ; `EtatJoueurSnap.titan` marque le pilote (avatar ni dessiné ni touchable) ; causes `truck_fou`, `tigre_robot`, `titan`.
- `rejoindre` reçoit l'état en cours (`evenement{phase:"etat"}`, `titan{phase:"etat"}`).

## Code

| Module | Rôle |
| --- | --- |
| `lib/fps/monstres.ts` (PUR, testé) | constantes, formes de touche, poursuite du Truck, marche et attaques du tigre, contournement, déplacement du titan |
| `lib/fps/navigation.ts` (PUR, testé) | grille d'occupation par rayon (cache par monde), A* 8 voisins, point visé le long du chemin |
| `lib/fps/match-evenements.ts` (PUR, testé) | service de la salle : minuteur, simulation, attaques, dégâts, titan |
| `lib/fps/jeu-monstres.ts` (PUR, testé) | client : interpolation des monstres, événement, lasers, `ControleurTitan` |
| `lib/fps/tigre-geant.ts` | animation du tigre géant : moteur de locomotion du tigre 3D + geste « rugir » |
| `lib/fps/rendu-monstres.ts` (three) | Truck, tigre robot (GLB cloné : métal, maillage lumineux, yeux ; robot en boîtes tant que le modèle charge), titan aux couleurs du pilote, laser, explosions |
| `app/components/arene/hud/BandeauEvenement.tsx` | alerte à rayures, bande du Truck, barre de vie du tigre, bande du titan |

Serveur : `PDJ_FPS_EVT_MIN_MS` / `PDJ_FPS_EVT_MAX_MS` (délai avant chaque événement), `PDJ_FPS_EVT_TYPE` (`truck` ou `tigre`),
`PDJ_FPS_TIGRE_PV` (PV imposés au tigre) pour les essais.

## Limites connues

- Pas de marqueur des monstres sur la mini-carte.
- Le tigre traverse les voitures conduisibles et PNJ (ni collision ni écrasement des voitures elles-mêmes, leurs occupants meurent sous lui).
- Le pilote voit depuis la tête du titan : son propre titan n'est pas dessiné.

## Révision du 2026-10-24 (après essais)

- **Tigre géant** : `ECHELLE_TIGRE` = 40 (44 m de long, 16 m au garrot, tête vers 21 m). Plus haut que les bâtiments, il les **enjambe**
  (aucune collision, plus de chemin A* pour lui ; la navigation sert au Truck). PV = 4 000 + 1 500 par joueur. Marche à 8 m/s, s'arrête à 24 m.
- **Attaques** (`lancerAttaque`, une toutes les 6,5 s ± 20 %, réessai 0,5 s si personne n'est à portée) : **laser** (1, ou 3 en rafale
  enragé, visée un peu devant le joueur qui court), **saut** (bond de 1,3 s jusqu'à 18 m, anneau d'impact annoncé `onde`, à l'atterrissage
  70 dégâts à tout joueur AU SOL dans 32 m : sauter l'esquive), **charge** (ramassé 0,8 s face à sa cible puis ruée de 1,5 s à 34 m/s qui
  écrase), plus le **coup de patte** (32 m devant lui). **Rage** sous 50 % des PV (`TigreSnap.rage`) : attaques 1,8 fois plus fréquentes,
  triple laser, maillage rouge, « ENRAGÉ » dans le bandeau. `TigreSnap.a` : `patte`, `saut` (p[1] = hauteur du bond), `charge`.
- **Titan** : échelle 18 (20 m), 2 500 PV, 13 m/s, **dash** (Maj : 42 m/s pendant 0,32 s, recharge 1,6 s), **saut** (Espace : 24 m/s,
  gravité 34) qui permet de monter sur les toits (`solSous`), **atterrissage** d'au moins 3 m de chute qui écrase les joueurs au sol dans
  10 m. Le serveur borne 44 m/s à l'horizontale, 45 m/s à la verticale, refuse toute pénétration > 0,6 m dans un bâtiment (toits permis).
  `OEIL_TITAN` = 9,5 m. **Vue à la 3ᵉ personne par-dessus l'épaule** (`CAMERA_TITAN` de `jeu.ts`) : on voit son tigre ; le canon tire
  de sa tête vers le point sous le réticule (rayon depuis la caméra).
- Essais : `PDJ_FPS_TIGRE_ATTAQUE` (`laser`, `saut` ou `charge`) impose l'attaque spéciale.

## Révision 2 du 2026-10-24

- **Bâtiments destructibles** : `collision.ts` (`detruireBatiment` met la hauteur du prisme à 0 : gravats plats, ni mur ni toit ni
  ligne de vue ; `releverBatiment(s)`, `batimentsDetruits`, `batimentsSous`). Le serveur écrase ce qui est sous les pattes et le ventre
  du tigre qui marche ou charge, tout dans 22 m à l'atterrissage de son saut, et dans 7 m quand le titan retombe ; message
  `batiments{detruits, nouveaux}` (liste complète, liste vide au nouveau match, envoyé à `rejoindre` s'il y a des ruines). Rendu
  (`decor.ts`, `creerEtatDestruction`) : un attribut `aBat` (index du bâtiment) par sommet et une texture d'une ligne lue par le
  nuanceur de sommets, qui écrase la hauteur à 5 % (aucune géométrie reconstruite) ; effondrement animé en 1,1 s, poussière, grondement.
- **Traces d'impact** (`rendu-impacts.ts`) : brûlures orange à plat sur la surface touchée (`normaleImpact`), un seul `InstancedMesh`
  de 240 traces en anneau, éteintes en 20 s, couleurs mises à jour 4 fois par seconde.
- **Klaxon du Truck Muche fou** : trompe à air (`sons.klaxonCamion`) toutes les 2,2 à 3,6 s, atténuation douce (on l'entend à 300 m).
- **Titan à la 1ʳᵉ personne dans un cockpit** (`hud/CockpitTitan.tsx`) : calque SVG (poutre, montants fins, console, armature, voyants)
  et deux écrans (intégrité, recharge du dash), vitre centrale dégagée ; son propre titan n'est pas dessiné.
- **Tigre** : barre de vie de boss avec les PV en chiffres, plus de minuterie affichée ; durée maximale portée à 5 min.
