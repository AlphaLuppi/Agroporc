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
