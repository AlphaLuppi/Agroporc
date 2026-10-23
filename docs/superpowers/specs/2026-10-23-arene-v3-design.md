# Arène FPS v3 — sniper, Elsa dans le Truck Muche, voitures qui explosent, son des moteurs, chat vocal

Date : 2026-10-23. Prolonge la v2 (`2026-10-22-arene-v2-design.md`) et le HUD (`2026-10-23-arene-hud-design.md`).
Protocole : `VERSION_PROTOCOLE = 3` (client et serveur se déploient ensemble ; un client v2 en cache reçoit `erreur{version}`).

## 1. Sniper : dispersion sans lunette, niveaux de zoom

Seule exception à la règle « aucune dispersion » de la v2 §13.1.

- **Sans lunette** (tir à la hanche, « no scope »), le sniper tire dans un cône aléatoire : `STATS.sniper.hanche` =
  0,045 rad à l'arrêt, + 0,035 rad à 9 m/s (plafonné à 1,5 × cette vitesse), + 0,06 rad en l'air. Tirage uniforme dans le disque
  (`devier`, hasard fourni par le client). Le viseur affiche le cercle de dispersion (`HudEtat.ecartViseur`).
- **En lunette**, le tir part exactement sous le réticule (aucune dispersion), dès que la lunette est affichée.
- Le serveur ne contrôle pas la dispersion (il accepte déjà toute direction à moins de 70° de la visée connue, `COS_VISEE_MIN`).
- **Niveaux de zoom** : `STATS.sniper.zooms` = ×3, ×6 (défaut, l'ancien 18°) et ×12 (champ horizontal 2·atan(tan 45° / k)).
  En lunette, la molette règle le zoom (vers l'avant = plus serré, sans boucler) au lieu de changer d'arme ; l'action
  `zoomLunette` (clic milieu ou X par défaut) passe au niveau suivant en bouclant. Le niveau est retenu par arme pour la partie.
  La lunette affiche « ×N » et une pastille par niveau. La sensibilité de la souris suit déjà le champ de vision.

## 2. Elsa dans le Truck Muche

- Le Truck Muche est garé sur son POI (`placeTruck`, `zones.ts`), dans le sens où il arrive dans la vue aérienne (nez vers
  l'ouest-sud-ouest). Dimensions `TRUCK` : 7,4 × 2,4 m, caisse de 3,2 m, cabine à l'avant, plancher à 0,9 m.
- C'est un **obstacle** du monde de collision (`obstacleTruck`, ajouté par `construireMonde` côté client ET serveur) : on ne le
  traverse pas, il arrête les balles, on peut monter sur le toit.
- **Elsa est dedans**, debout sur le plancher derrière le **passe-plat** ouvert du flanc droit (comptoir à 1,85 m, volet relevé en
  auvent, enseigne « LE TRUCK MUCHE »). Elle sert des armes spéciales et des bonus (soin + bouclier) au lieu des petits plats :
  le cadeau tourne sur le comptoir, le faisceau et l'anneau de ramassage sont au **point de service**, 1,4 m devant le flanc
  (`positionElsa` = ce point, 2,5 m de rayon : un joueur collé au truck est servi).
- L'étiquette « Elsa » est au-dessus du toit ; sa visibilité est évaluée sur un point juste devant le passe-plat (Elsa est dans le
  prisme du truck, un rayon vers elle serait toujours bloqué).

## 3. Son des voitures

- Le moteur de la voiture conduite est un **vrai enregistrement** : `public/arene/moteur.wav` (boucle de ralenti « Racing car
  engine sound loops », domasx2, OpenGameArt, CC0 ; cf. `public/arene/CREDITS.txt`), joué en boucle ; la vitesse de lecture
  (le régime) va de 0,85 au ralenti à 2,1 à 28 m/s, un passe-bas s'ouvre avec la vitesse.
- Volume nettement plus bas (gain 0,16 au ralenti, 0,3 à fond, avant le master) ; plus de dent de scie ni de carré. Tant que la
  boucle n'est pas chargée (ou si elle ne se charge pas), un moteur synthétisé doux (triangle grave + grain) la remplace.
- Les chocs sont aussi moins forts.

## 4. Voitures qui explosent

Toutes les voitures (12 PNJ, 6 conduisibles) ont une carrosserie de 450 PV (`CARROSSERIE`, `epaves.ts`).

- **Balles** : le client cherche la première voiture coupée par chaque plomb (`impactVoiture`, méthode des dalles sur la caisse
  4,4 × 1,9 × 1,5 m) ; une voiture plus proche que le joueur ou le mur visé ARRÊTE la balle (sauf pour l'occupant de cette voiture,
  toujours touchable). Le tir déclare `voitures: [{ genre, id, plomb }]`. Le serveur revalide chaque plomb : caisse rejouée de 0 à
  300 ms en arrière par pas de 50 ms, marge 0,8 m, portée de l'arme, ligne de vue ; dégâts au corps selon la distance (`degatsPlomb`).
- **États** : ≤ 50 % fumée, ≤ 20 % feu, 0 explosion. Le serveur diffuse l'état complet (`voitures`) à chaque changement et à
  `rejoindre`.
- **Explosion** (`explosion`) : souffle sur les joueurs (220 jusqu'à 3 m — au-delà de PV + bouclier pleins —, linéaire jusqu'à 0 à
  8 m, ligne de vue depuis le centre), occupants tués (`cause: "explosion"`, crédit au tireur), voitures voisines abîmées (400 à 0 m,
  0 à 7 m : réaction en chaîne possible, 18 explosions au plus par tir). Fil des éliminations : « Explosé par <pseudo> ».
- **Épave** : la voiture disparaît (PNJ cachée, conduisible hors du snap, ni montée, ni renversement, ni écrasement) et une carcasse
  calcinée brûle là où elle a sauté, 20 s (PNJ) ou 15 s (conduisible) ; puis la PNJ reprend son circuit et la conduisible revient
  neuve à sa place de parking. Nouveau match : toutes les voitures neuves.
- Effets (`rendu-feux.ts`) : particules additives de fumée et de flammes sur les voitures abîmées et les épaves, éclair, boule de
  feu, braises et onde au sol à l'explosion ; son d'explosion atténué avec la distance, secousse de caméra à moins de 30 m,
  tintement de tôle quand ma balle touche une voiture.

## 5. Chat vocal de proximité

- WebRTC audio pair à pair entre tous les joueurs EN ARÈNE qui ont activé la voix (maillage, ≤ 15 flux Opus) ; la proximité est
  un **volume** : `gainVoix` plein jusqu'à 4 m, décroissant (courbe 1,6) jusqu'à 0 à 45 m, moitié moins fort pour un mort ;
  panoramique gauche / droite selon l'angle (adouci à 80 %). Gains lissés (80 ms), mis à jour à chaque image depuis la tête
  du joueur.
- Signalisation par le serveur de l'arène : `voixActif{actif}` (diffusé dans `presence.voix`) et `voix{a, s}` relayé en
  `voix{de, s}` seulement si les deux joueurs sont en arène avec la voix activée. Offre et réponse SDP complètes (pas de
  « trickle » : collecte ICE bornée à 2,5 s), SDP ≤ 12 000 caractères ; taille maximale d'un message portée à 16 ko. Le plus petit
  identifiant appelle ; une offre neuve remplace la connexion existante ; l'appelant retente 4 s après un échec.
- STUN public de Google, pas de TURN : deux joueurs derrière des NAT symétriques ne s'entendent pas (même réseau : sans objet).
- Micro (`getUserMedia`, annulation d'écho, réduction de bruit, gain automatique) demandé à l'activation. Activation et mode dans
  le menu pause (« Chat vocal de proximité ») : **appuyer pour parler** (action `parler`, T par défaut, défaut) ou **micro ouvert**.
  Réglages gardés (`pdj-fps-voix`) ; activé, le chat se relance à l'entrée dans l'arène. Micro refusé : la voix est décochée et la
  raison s'affiche dans le menu pause.
- HUD (`BlocVoix`, au-dessus de la ligne de course) : état du micro (allumé quand il émet) et pseudos des joueurs qu'on entend
  parler (niveau RMS > 0,02 et audibles).
