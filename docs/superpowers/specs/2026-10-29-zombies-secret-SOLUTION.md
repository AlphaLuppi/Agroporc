# Grand secret du mode zombies : « Le Menu fantôme » — SOLUTION (développeurs seulement)

> **Ne pas montrer aux joueurs.** Ce document donne la solution complète du grand secret de la carte « Service de midi ». Le jeu, lui,
> n'affiche AUCUN indice explicite : pas d'objectif, pas d'invite, pas de compteur, pas d'annonce. Tout passe par le décor et le son.

Date : 2026-10-29. Remplace la « Recette ultime » de la v7 (spec `2026-10-28-zombies-bo1-design.md`, section « Lore « Opération Plat du
Jour » et objectifs ») : trois ingrédients ramassés avec E sous un bandeau OBJECTIF, puis 30 s au four. Un joueur l'avait finie à la
manche 8 (retour 17 : « trop facile »).

Code : `lib/fps/zombies-secret.ts` (machine d'états PURE, testée), positions dans `SECRET_CARTE` / `INTERACTIONS_SECRET` de
`lib/fps/zombies-carte.ts`, branchement serveur dans `lib/fps/match-zombies.ts` (section « grand secret »), crochets de la salle dans
`lib/fps/match.ts` (`tirSecret`, `coupSecret`), rendu dans `lib/fps/rendu-objets-zombies.ts` (`creerDecorSecret`), sons dans
`lib/fps/sons.ts` (`Sons.secret`), réactions du client dans `lib/fps/jeu.ts` (`reagirSecret`, `majSecretZ`).

## 1. Intention

Un vrai secret façon Black Ops 2 Origins, à l'échelle de notre carte :

- **découvert en observant** : des détails qui clochent (des pendules toutes arrêtées sur la même heure, une ardoise au menu raturé, des
  post-it numérotés sur des écrans, une ampoule qui clignote sans raison, une cuve « n° 3 » quand la note du disjoncteur parle d'un
  congélateur n° 3) ;
- **déclencheurs variés** et non triviaux : couteau, tirs ordonnés (deux fois, lus à deux sources différentes), tigres tués dans une
  zone pendant une livraison, grenade à un endroit précis, objet porté en temps limité, Micro-ondes à un instant précis, kills au
  couteau, service final pendant une livraison tardive ;
- **lié à la progression** : courant (pendules, cuve, ampoules), portes (cuisine, cour, labo, local), Pack-a-Punch (midi), manches du
  Truck Muche (marmite, service) ;
- **jamais de tirage de la boîte** dans une étape obligatoire (le piège de Moon) ;
- **faisable seul**, plus confortable à plusieurs (un lit le morse pendant que l'autre tire, un porte la truffe pendant que les autres
  dégagent le chemin, tout le monde défend le service) ;
- **long** : le service final ne s'ouvre qu'à la **troisième livraison du Truck Muche ou une suivante** (livraisons aux manches 5–7, puis
  tous les 4 à 6 manches : la troisième tombe entre les manches 13 et 19, ≈ 15–16 en moyenne). Un bon joueur qui connaît la solution ne
  peut donc pas finir avant la manche 13, et en pratique pas avant ≈ 15 ;
- **confirmations subtiles** : un son du décor là où ça se passe, un objet qui change, une lumière ; un accord très doux quand une étape
  se referme. Aucune ligne de texte.

## 2. Indices dans le décor et le lore

| Indice | Où | Ce qu'il dit (sans le dire) |
|---|---|---|
| Pendules arrêtées sur **11 h 58** | open space, salle de pause, cuisine, labo (4) ; celle du Local technique tourne dès que le courant revient | « elles se sont arrêtées en même temps » ; l'heure de l'intro (11 h 58) |
| Note 3 (rapport d'incident) | Cour Centre | « 11 h 58 : toutes les pendules se sont arrêtées… personne n'a pensé à les remonter » |
| Ardoise « Menu du jour » | mur ouest de la cuisine | quatre plats raturés (Entrée, Plat, Fromage, Dessert), chacun précédé d'un **picto de resto** ; « service : 12 h » à demi effacé |
| Batterie de cuivre | au-dessus du piano de la cuisine | quatre casseroles, un picto gravé sur chacune (trèfle, croissant, camion, feuille) |
| Note 4 (carnet du chef) | comptoir de la cuisine | « ma batterie de cuivre le chante, pourvu qu'on la fasse sonner dans l'ordre. Le fumet ne monte que quand le Truck livre. Ensuite le froid, ensuite le feu. » |
| Marmite | Cour Centre, contre la façade de la cuisine | une marmite sur un réchaud, froide |
| Note 6 (étiquette du disjoncteur) | Local technique | « le réarmement rallume … le **congélateur n° 3** » |
| Cuves numérotées N° 1, 2, 3 | Labo | la n° 3 est près du Micro-ondes |
| Note 8 (journal du Dr Gratin) | Labo | « Il ne se trompe qu'à une heure, celle que l'ampoule lui répète. … Le hachoir du chef, lui, a encore faim. » |
| Ampoule au-dessus du Micro-ondes | Labo | clignote **« MIDI »** en morse (`-- .. -.. ..`) une fois la truffe servie |
| Douze coups de midi | toutes les pendules (son spatialisé depuis la plus proche) | une fois remontées, les pendules tournent trop vite : midi sonne toutes les 5 minutes |
| Post-it 1 à 8 | huit écrans de l'open space | numéros mélangés à chaque partie |
| Note 1 (post-it de Kévin) | open space | « ne décollez pas mes post-it. Le local technique me les dicte toute la nuit, et il ne se trompe jamais d'ordre » |
| Ampoule au-dessus du disjoncteur | Local technique | clignote un code de **quatre chiffres** en morse (après midi) |
| Billot et couperet | comptoir de la cuisine | le couperet planté rougeoie quand on « nourrit » le billot |
| Note 5 (bon de livraison) | Cour Est | au dos : « à la troisième livraison, le chef sera servi. Qu'il ne reparte pas. » |
| Cloche de service | comptoir de la cuisine | brille une fois le secret servi |

Le conseil du lobby dit seulement : « Lisez les notes : le chef a laissé plus qu'un menu. »

## 3. Étapes (solution)

Valeurs dans `SECRET` de `zombies-secret.ts`. Les positions sont dans `SECRET_CARTE` (repère de scene.json, m). Une étape n'écoute que
son déclencheur : tout le reste est sans effet (testé : « aucun raccourci »).

### 1. Les pendules (`pendules`)
- **Prérequis** : courant rétabli (disjoncteur du Local technique), donc D2 + D4 + D7 + D8 au plus court, et D9 (Labo) pour la 4e pendule.
- **Déclencheur** : un **coup d'arme blanche** (couteau ou épée) sur chacune des **quatre pendules arrêtées** (open space, salle de pause,
  cuisine, labo), dans n'importe quel ordre. Portée et cône de l'arme, ligne de vue (`objetFrappe`). La pendule du Local technique ne
  compte pas.
- **Confirmation** : la pendule frappée fait « tic-tac » (son) et son aiguille bat la seconde sur place ; à la quatrième, carillon, et
  toutes les pendules repartent ensemble de 11 h 58 en tournant trop vite (un tour du cadran des heures en 5 min).
- **Échec** : aucun.

### 2. La batterie de cuivre (`casseroles`)
- **Déclencheur** : **tirer** sur les quatre casseroles dans l'**ordre des pictos de l'ardoise** (de haut en bas). L'ordre est tiré à
  chaque partie. Un tir ne compte qu'une casserole (le plomb le plus proche pour le fusil à pompe).
- **Confirmation** : chaque bonne casserole tinte, plus aiguë à chaque note, et se balance ; à la quatrième, les veilleuses bleues du
  piano s'allument (flamme, accord).
- **Échec** : une fausse note (mauvaise casserole) fait s'entrechoquer toute la batterie : on reprend au début.

### 3. Le fumet (`marmite`)
- **Déclencheur** : pendant une **manche de livraison du Truck Muche** (les « chiens »), tuer **6 ennemis seul, +4 par joueur** (au plus
  20) à moins de **6 m** de la marmite de la Cour Centre (petits, mini Trucks, tigres ; toute cause sauf la nuke). Il faut donc attirer la
  livraison dans la cour.
- **Confirmation** : chaque kill fait bouillonner la marmite, la vapeur monte avec l'avancée ; pleine, le couvercle saute et une lueur
  dorée reste.
- **Échec** : la manche finit avant : la marmite se vide (sifflement), il faudra une autre livraison.

### 4. Le congélateur n° 3 (`congelateur`)
- **Déclencheur** : une **grenade** (à fragmentation ; le tigre à remontoir compte aussi mais ne sort que de la boîte, il n'est jamais
  nécessaire) qui **saute à moins de 2,5 m** (au sol) **de la cuve n° 3** du Labo, courant rétabli. Ni la n° 1, ni la n° 2.
- **Confirmation** : la porte de la cuve saute, nuage de givre ; une truffe noire est posée à l'intérieur.

### 5. La chaîne du froid (`truffe`) — étape minutée
- **Déclencheur** : **E** devant la cuve n° 3 ouverte (aucune invite) : le joueur prend la truffe ; puis **E devant le four de la
  cuisine** (aucune invite) en **moins de 30 s**. Le chemin le plus court Labo → D9 → Cour Ouest → G1 → Passage Ouest → G2 → Cour Centre →
  D4 → cuisine fait ≈ 120 m : ≈ 11 s au sprint, beaucoup plus avec des tigres dans les couloirs.
- **Confirmation** : le porteur entend le givre craquer, de plus en plus vite ; posée, le four s'embrase et garde une veilleuse.
- **Échec** (temps écoulé, porteur à terre, porteur qui quitte la partie) : la truffe fond, **la cuve se referme : retour à l'étape 4**
  (il faut une nouvelle grenade). Un seul porteur à la fois.

### 6. Midi pile (`midi`)
- **Prérequis** : Pack-a-Punch (Micro-ondes Gratinator, 5 000 $, courant), une arme à feu non gratinée en main.
- **Indice** : l'ampoule au-dessus du Micro-ondes clignote « MIDI » en morse ; les pendules sonnent les douze coups de midi toutes les
  5 minutes (fenêtre de 8 s à partir du premier coup, un coup toutes les 0,6 s).
- **Déclencheur** : **déposer une arme au Micro-ondes pendant les douze coups de midi**. Hors fenêtre : un Pack-a-Punch ordinaire.
- **Confirmation** : bip du Micro-ondes, ding de cloche, l'ampoule s'éclaire en or et s'éteint (l'arme ressort gratinée normalement).

### 7. Les post-it (`postits`)
- **Indice** : l'ampoule au-dessus du disjoncteur clignote en morse un code de **quatre chiffres distincts** (1 à 8, tiré à chaque
  partie), répété avec un long silence (`morseAllume`, unité 280 ms). Les huit écrans de l'open space portent des post-it numérotés 1
  à 8 (mélangés à chaque partie).
- **Déclencheur** : **tirer** sur les écrans dont le post-it porte les chiffres du code, **dans l'ordre**, les quatre en **15 s**.
- **Confirmation** : un écran juste s'allume en vert (bip) ; les quatre faits : accord, l'ampoule du Local s'éclaire puis s'éteint.
- **Échec** : un mauvais écran (rouge, bourdonnement) ou plus de 15 s : on reprend au premier chiffre. À deux, l'un lit le morse au Local
  technique, l'autre tire dans l'open space.

### 8. Le hachoir (`hachoir`)
- **Déclencheur** : achever **8 tigres seul, +3 par joueur**, d'un **coup d'arme blanche** (le coup fatal : on peut les affaiblir au fusil
  avant, comme dans BO1), à moins de **5 m** du billot de la cuisine, pendant une manche. L'épée (3 000 $, Cour Est) aide beaucoup.
- **Confirmation** : bruit de couperet, la lame rougeoie à mesure ; plein, le couperet se dresse.

### 9. Le service (`service`)
- **Déclencheur** : pendant une **manche de livraison du Truck Muche à partir de la troisième** (`SECRET.livraisonService`), le Truck
  encore là (il recule vers son quai ou décharge), **E devant le four** (aucune invite) : le service est lancé (le four rugit). Il est
  **servi** si le **Truck Muche saute** avant de repartir et que **personne ne tombe** entre-temps.
- **Échec** : le Truck repart intact, un joueur tombe, ou la manche finit : le four retombe, on recommencera à une livraison suivante
  (l'étape ne recule pas).
- **Confirmation (récompense)** : courte cinématique (chœur, voile doré, bandes de cinéma, intérieurs illuminés, colonne de lumière au
  four) ; tous les ennemis tombent en silence (sans points) et la livraison s'arrête là ; chaque joueur admis (relevé s'il était à
  terre) reçoit le **Rayon Goulaf** (pistolet à rayons gratiné, secondaire), le **Bazooka au four** (l'arme unique de l'arène, gratinée,
  jamais dans la boîte des zombies), **tous les atouts**, des munitions et grenades pleines.

### 10. La cloche (fin optionnelle)
- Après le service, la cloche du comptoir brille. **E devant elle** (aucune invite) finit la partie sur une **victoire** : bilan « Service
  accompli » (`bilan.victoire`). On peut aussi continuer à jouer avec la récompense.

## 4. Réseau

`VERSION_PROTOCOLE = 8`. `EtatPartieZombies.secret: EtatSecretZombies` remplace `quete` (ce que le rendu doit savoir : étape, pendules,
ordres, avancées, truffe, code pendant l'étape 7, service). `zevt{e: "secret", quoi, p, i?, k?, joueur?}` remplace `ingredient` et
`cuisson` ; `RaisonAchat` perd `quete`. E sur un objet du secret part en `acheter{id: "secret:<truffe|four|cloche>"}` (le client l'envoie
quand aucune invite n'est proposée et qu'un de ces objets est à portée, quel que soit l'état) : le serveur ne répond rien si rien ne se
passe. `bilan.victoire` (optionnel) signale la fin à la cloche.

## 5. Essais

- `PDJ_FPS_ZOMBIES_SECRET=<1..9>` : chaque partie démarre à cette étape (les précédentes sont faites, les pendules tournent depuis le
  lancement) ; 9 = servi (la cloche finit la partie).
- `PDJ_FPS_ZOMBIES_SECRET_MIDI_MS=<ms>` : tour du cadran des pendules (midi une fois par tour ; 20 000 pour les essais).
- `PDJ_FPS_ZOMBIES_SECRET_LIVRAISON=<n>` : première livraison où le service s'ouvre (1 pour les essais), avec `PDJ_FPS_ZOMBIES_TRUCK`
  pour avancer la première livraison et `PDJ_FPS_ZOMBIES_COURANT=1` pour le courant.
- Crochet de dev : `window.__arene.secret()` (état public, heure des pendules, midi en cours, cinématique, positions des objets).
- Captures : `SECRET=<étape> COURANT=1 SANS_TIGRES=1 VUES='[…]' node scripts/fps/captures_zombies.mjs`.
- Tests : `lib/fps/zombies-secret.test.ts` (chaque étape, échecs, reprise, aucun raccourci, ordres tirés, visibilité des objets sur le
  vrai monde) et `lib/fps/match-zombies.test.ts` (« grand secret » : l'enchaînement complet par le service de la salle, du couteau sur
  les pendules à la cloche ; la truffe qui fond quand son porteur tombe ; le silence des E hors étape).

## 6. Durée visée

Pour un bon joueur qui connaît la solution : étapes 1–2 dès le courant (manches 3–5), étape 3 à la première livraison (5–7) ou à la
deuxième, 4–6 dans la foulée (grenades, 5 000 $), 7–8 en une ou deux manches, service à la troisième livraison (13–19). Pour un nouveau :
il faut d'abord comprendre que les pendules se remontent au couteau ; aucun signe ne le dit.
