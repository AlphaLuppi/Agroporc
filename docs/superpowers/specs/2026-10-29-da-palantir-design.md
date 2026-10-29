# Palantir : rework de la direction artistique (issue #83)

Statut : implémentée (branche `claude/issue-83-da-palantir`, mesures et écarts à la spec en bas de page). Cette spec ne change ni le protocole, ni le serveur, ni `scene.json`, ni `cachettes.json`. Elle s'applique à la vue
aérienne « rayons X » et, par `construireDecor`, à l'arène, aux zombies et au Battle Royale (cf. « Quels modes, quoi »).

## Demande (issue #83, « Rework de la DA graphique »)

Plus de détails, plus de cohérence, en gardant la DA minimaliste rétro néon (fil de fer lumineux, bloom) « mais pas aussi minimaliste » :
routes retravaillées, passages piétons, signalisation, végétation diversifiée, façades améliorées. Pistes de l'issue : s'aider d'extraits Google
Street View pour que le modèle sache quoi ajouter.

## Contexte (Street View, recherche web, données disponibles)

- **Street View** : aucun accès (pas d'API, pas d'extraction d'images). Remplacé par la seule source de vérité terrain utilisable : OpenStreetMap,
  qui décrit la zone bien plus finement que ce que `scene.json` en garde (cf. ci-dessous).
- **Recherche web (29/10/2026)** : très peu de choses sur l'aménagement d'Agroparc. Retenu : le parking relais d'Agroparc (Grand Avignon, ouvert
  le 26/05/2023) a 320 places dont 9 PMR et 4 avec borne de recharge, 12 places moto, un local vélo de 10 places, un terminus à 2 quais pour les
  lignes 4 et C3, des voiries et places en enrobé, et il est décrit comme « végétalisé » ([Écho du mardi](https://echodumardi.com/politiqueetterritoire/parking-relais-dagroparc-lintermodalite-au-coeur-de-la-politique-de-transports-du-grand-avignon)).
  Les dossiers du Grand Avignon ([technopole](https://www.grandavignon.fr/sites/default/files/2019-07/dossier_de_presse_avignon_technopole.pdf))
  confirment un parc d'activités tertiaire de bureaux et d'enseignes, sans détail de végétation ni de signalisation. **Aucune essence d'arbre
  n'est documentée** : les types d'arbres ci-dessous sont des hypothèses de paysage provençal (platanes d'alignement, pins parasols, cyprès,
  oliviers, feuillus), choisies par règles, pas des relevés. Les 1 625 arbres OSM de la requête sur 1 641 n'ont ni `genus`, ni `species`, ni `leaf_type`.
- **OSM, mesuré le 29/10/2026 par Overpass sur la boîte du générateur (dans la boîte de `scene.json`, `TREE_BOX`)** : 788 arbres (les mêmes que
  `scene.trees`), 158 pelouses `landuse=grass`, 2 prairies, 19 jardins, 3 parcs, 87 haies `barrier=hedge`, 25 alignements `natural=tree_row`, 7 bois,
  42 lampadaires `highway=street_lamp`, 35 passages piétons `highway=crossing`, 6 stops et 5 cédez-le-passage (dont 4 autour du rond-point), 6 arrêts
  de bus, 9 bancs, 12 corbeilles, 11 racks à vélos, 5 portails. **Aucun feu tricolore.** L'OSM est incomplet (42 lampadaires sur une zone de
  780 × 480 m) : on complète par des règles, on ne remplace pas.
- **Géométrie de `scene.json`** : 374 voies (`M` 26 tronçons, 3,4 km ; `R` 17, 4,2 km ; `S` 164, 15,3 km, surtout des allées de parking ; `F` 167,
  15,3 km), uniquement des **axes** sans largeur. Les croisements voie piétonne × chaussée, dédoublonnés à 6 m : 23 sur `M`, 23 sur `R`, 84 sur `S`.
  Un seul rond-point (centre (28,2 ; 2,5), rayon 18,1 m, `ROND_POINT` de `lib/fps/zones.ts`). 78 parkings (57 000 m² en tout).

## Ce qui existe

- `lib/agroparc3d/decor.ts` (partagé par `scene.ts` et `lib/fps/jeu.ts` via `construireDecor`) : bâtiments en fil de fer (façades à étages,
  fenêtres, porte, corniche, équipements de toit quand `detail`), `ajouterReseauSol` (UN `LineSegments` : axes des voies à y = 0,4, contours de
  parkings à 0,25, eau à 0,2), grille, arbres (UNE seule silhouette : icosaèdre filaire de 2,4 m + un trait pour le tronc). Environ 15 draw calls.
- Pas de chaussée (la route est un trait), pas de marquage, pas de trottoir, pas de signalisation, pas de pelouse ni de haie, aucune place de
  parking, un seul type d'arbre, un seul style de façade (teinte cyan unique).
- Bloom : `UnrealBloomPass(0.62, 0.42, 0.24)` (seuil de luminosité 0,24) dans `scene.ts` et `creerPostTraitement` (`lib/fps/rendu.ts`). Tout ce qui
  dépasse 0,24 de luminosité fait du halo : les teintes de décor doivent rester sous ce seuil, sauf les accents voulus (fenêtres allumées, lampes).
- Voitures PNJ (`lane` 2,1 m) et bus (`lane` 2,6 m) circulent sur les axes ; les conduisibles de l'arène sont garées sur `parkings[3]`
  (`EMPLACEMENTS_VOITURES`, `lib/fps/zones.ts`).

## Décisions

### D1. Les données : un fichier additif `public/agroparc/decor.json`, `scene.json` intact

- **`scene.json` n'est PAS régénéré** : l'ordre des 142 bâtiments pilote les indices des zombies (`BATIMENTS_CREUX = [72,70,62,74]`, `idPrisme`),
  du BR (142 d'origine) et des cachettes ; relancer l'IGN les décalerait. `cachettes.json` ne change donc pas non plus et son test de
  régénération à l'octet (`cachettes.test.ts`) reste vert sans toucher à rien.
- Nouveau générateur `scripts/agroparc/build_decor.py` (stdlib seulement, même repère local que `build_scene.py` : `LON0, LAT0`, `xz()`, mêmes
  boîtes `TREE_BOX` = bornes des bâtiments de `scene.json` + 55 m). Il interroge Overpass (cache dans `scripts/agroparc/.cache/osm_decor.json`, options
  `--refresh` / `--offline` comme `build_scene.py`) et écrit `public/agroparc/decor.json` (cible : 30 à 60 Ko, coordonnées à 0,1 m, tableaux
  triés pour un fichier stable, anneaux simplifiés à 0,3 m par Douglas-Peucker). Requête (testée le 29/10/2026, ~360 Ko brut, 1 appel) :

  ```
  [out:json][timeout:60];
  ( node["highway"~"crossing|street_lamp|traffic_signals|stop|give_way"](43.911,4.880,43.921,4.896);
    node["amenity"~"bench|waste_basket|bicycle_parking"](43.911,4.880,43.921,4.896);
    node["barrier"~"gate|swing_gate"](43.911,4.880,43.921,4.896);
    way["barrier"="hedge"](43.911,4.880,43.921,4.896);
    way["landuse"~"grass|meadow"](43.911,4.880,43.921,4.896);
    way["leisure"~"park|garden"](43.911,4.880,43.921,4.896);
    way["natural"~"wood|tree_row|scrub"](43.911,4.880,43.921,4.896);
    way["landuse"="forest"](43.911,4.880,43.921,4.896);
  ); out geom;
  ```
  (`out geom` à la place de `out tags center`, pour avoir les sommets.) Le fichier est versionné ; le générateur n'est relancé qu'à la main.
- Format, type `DecorOsm` ajouté à `lib/agroparc3d/types.ts` :
  `{ v: 1, pelouses: { k: "grass"|"garden"|"park"|"meadow"; r: Vec2[] }[], bois: Vec2[][], haies: Vec2[][], alignements: Vec2[][],
  lampadaires: Vec2[], passages: Vec2[], stops: Vec2[], cedez: Vec2[], signaux: Vec2[], bancs: Vec2[], corbeilles: Vec2[], velos: Vec2[], portails: Vec2[] }`
  (`signaux` = `traffic_signals`, vide aujourd'hui). `SceneData` reçoit un champ optionnel `decor?: DecorOsm` (jamais dans `scene.json`).
- **Chargement tolérant** : `Agroparc3D.tsx` charge `decor.json` EN PARALLÈLE de `scene.json` et des cachettes (`Promise.all`), mais une erreur
  réseau ou de parsing donne `undefined` sans message d'erreur : le décor se dessine alors avec les seules règles dérivées de `scene.json` (D2).
  Le résultat est posé dans `scene.data.decor` (spread : `{ ...d, decor }`), ce qui le fait suivre `lancerJeu(canvas, scene.data, …)` ; `donneesZombies` /
  `donneesBr` le conservent par `{ ...scene }`. `serveur-fps` lit `scene.json` seul : rien à redéployer, aucun changement de protocole.

### D2. Tout ce qui est dérivé vit dans des modules PURS testés (sans three, sans DOM)

Aucune de ces fonctions n'a d'état global ; elles prennent `SceneData` (+ `data.decor` s'il existe) et rendent des tableaux de nombres. Placement
déterministe (hachage entier `hachage32`, mulberry32 de `facade.ts` à extraire dans `lib/agroparc3d/hasard.ts` pour être partagés), jamais de
`Math.random`. Mémoïsation par `WeakMap` sur `data.roads` (les copies de modes la partagent).

| Module | Contenu |
| --- | --- |
| `voirie.ts` | `DEMI_LARGEUR` par classe (M 3,5 m, R 2,75 m, S 1,9 m, F 0), `bordsChaussee` (bords M et R échantillonnés tous les 2 m, fusionnés en polylignes, échantillons dont le point tombe dans la chaussée d'une AUTRE voie supprimés par grille spatiale de 16 m : c'est ce qui dessine les carrefours), `rubanChaussee` (triangles), `axesPointilles` (M seulement : 3 m de trait, 6 m de vide, coupés dans les carrefours et sur le rond-point), `passagesPietons` (OSM + croisements F × voies, dédoublonnés à 6 m ; bandes de 0,5 m espacées de 0,5 m, 3 m dans le sens de la circulation, sur toute la largeur de la chaussée ; S seulement si OSM ou voie piétonne d'au moins 25 m ; 160 au plus), `lignesArret` (stops et cédez OSM, côté droit du sens d'arrivée, plus dents de requin à chaque entrée du rond-point), `giratoire` (anneau M + îlot central r − 3,5 m, avec `trouverRondPoint` de `lib/fps/zones.ts`, pur, sans cycle d'exécution), `trottoirs` (ligne à demi-largeur + 1,8 m sur M et R, absente à moins de 4 m d'un bâtiment) |
| `parkings.ts` | `placesParking` : par parking de `data.parkings` d'au moins 150 m² (uniquement ceux de `scene.json`), rectangle d'aire minimale, rangées de places de 2,5 × 5 m orientées sur l'allée `S` voisine (sinon sur le petit côté), séparateurs tirés tous les 2,5 m, hors bâtiments, hors chaussée `S`, hors zones d'exclusion ; sortie : segments |
| `vegetation.ts` | `classerArbres` (type, échelle, rotation, teinte par arbre), `haies` (polylignes OSM découpées en tronçons, hors chaussée et bâtiments), `pelouses` (triangulation, triangles dont le centre est dans un bâtiment ou à moins de `demi` d'une chaussée retirés), `arbustes` (poisson-disc de 3 m dans jardins et pelouses des parcs, îlot du rond-point, 400 au plus) |
| `mobilier.ts` | `lampadaires` (OSM + complément tous les 32 m le long de M et R, côté alterné, à `demi + 1,4 m` de l'axe, au moins 18 m de tout autre ; parkings : un mât par 900 m² ; au plus 350), `panneaux` (stop, cédez, passage piéton bleu à 1,5 m avant chaque passage, arrêt de bus), `abrisBus` (aux 6 arrêts OSM, `data.busStops`), `bancsEtc` (bancs, corbeilles, racks à vélos OSM) |
| `facade.ts` (étendu) | `styleFacade(b, id, poiType?)` (cf. D6) |

`deriverDecor(data, opts)` (dans `lib/agroparc3d/decor-donnees.ts`, pur) appelle les cinq et rend un objet unique ; `opts.exclure?: Boite[]` (points et
tronçons retirés), `opts.eviter?: Vec2[]` (cachettes du tigre) et `opts.qualite`. **Budget de calcul : 60 ms sur la machine de développement à
froid (le prototype naïf sur 45 000 échantillons, avec les allées S, mesurait 103 ms, d'où : pas de bords sur S, pas de bords sur F, pas de 1 m)**. Un
test pose un plafond large (400 ms) pour ne pas être instable en CI et affiche la mesure.

### D3. DA du sol : la route a une surface, des bords et des marques

- **Chaussée** : ruban de triangles (`rubanChaussee`) de couleur `C.chaussee` 0x070f16 (à peine plus clair que le fond 0x04060a), M et R seulement ;
  `S` garde sa seule ligne (ce sont des allées de parking). Largeurs : M 7 m (les voitures PNJ roulent à 2,1 m de l'axe, les bus à 2,6 m : ils
  restent dans leur voie), R 5,5 m.
- **Bords** : lignes de bord de chaussée à la couleur de la classe (`roadM`, `roadR`) à 80 % d'intensité ; **trottoirs** : ligne `C.trottoir`
  0x14323d à `demi + 1,8 m`. **Axe** M : pointillé blanc froid `C.marquage` 0xdbeef5 à 70 % (au-dessus du seuil du bloom : il brille comme un néon,
  c'est voulu). Axe existant des voies conservé en trait fin sombre pour R et S (pas de pointillé).
- **Passages piétons** : zébras en quads (un seul `Mesh` fusionné, couleur de sommets) avec la couleur `C.marquage` à 55 % : brillance juste sous le
  seuil, pas de halo envahissant. **Lignes d'arrêt** de 0,5 m ; **dents de requin** (triangles de 0,6 × 0,4 m espacés de 0,8 m) à chaque entrée du rond-point.
- **Rond-point** : deux cercles de bord (rayons 14,6 et 21,6 m), îlot central en pelouse hachurée + massif d'arbustes (aucun arbre ni mât au centre :
  les joueurs de l'arène y apparaissent et le décor n'a aucune collision), flèche d'entrée en chevron sur chaque branche (quad fusionné).
- **Parkings** : séparateurs de places `C.park` éclairci (0x1c4a5a), un `LineSegments` ; **aucune voiture factice** (elles ne bloqueraient pas les
  balles et se confondraient avec les 6 conduisibles ; décision définitive).
- Couches, toutes `depthWrite: false`, `renderOrder` croissant : pelouses −3, chaussée −2, trottoirs et parkings −1, lignes de bord/axes/zébras 0
  (les anciennes lignes à y = 0,4, 0,25 et 0,2 gardent leur hauteur ; les nouvelles : pelouses 0,10, chaussée 0,30, marquages 0,45). Les murs,
  toits et arêtes de bâtiments (`renderOrder` 1 et 2) passent après.

### D4. Végétation : six silhouettes filaires, règles de choix, haies, pelouses

Tout reste fil de fer (`wireframe: true`), couleurs sous le seuil du bloom, un `InstancedMesh` par silhouette avec `instanceColor` pour la variation de
teinte, un seul `LineSegments` pour tous les troncs.

| Type | Géométrie (m) | Teinte | Règle de choix |
| --- | --- | --- | --- |
| `platane` | icosaèdre détail 1, ellipsoïde 4,2 × 3,6, tronc 5 m | `C.platane` 0x2c7a52 ; 35 % `C.automne` 0x5a4318 (fin octobre) | arbre d'un alignement (`alignements` OSM ou ≥ 2 voisins alignés à 6–14 m, à moins de 8 m d'une voie M ou R) : 70 %, sinon feuillu |
| `pin` | disque aplati (cylindre 8 faces r 4,5 → 3, h 1,8) sur tronc de 6 m | 0x2a6b52 | dans un bois OSM : 100 % ; en terrain ouvert : 35 % |
| `cypres` | cône étroit r 1,1, h 7, 6 faces | `C.cypres` 0x174d3b | à moins de 8 m d'un bâtiment : 30 % ; par paires le long des haies |
| `olivier` | icosaèdre détail 0, 1,6 × 0,8 × 1,6, tronc 1,8 m | 0x5f8f78 (gris-vert) | à moins de 8 m d'un bâtiment : 45 % ; parkings : 30 % |
| `feuillu` | l'icosaèdre actuel (r 2,4, tronc 3,2 m) | `C.tree` 0x1d5a4a | tout le reste (≈ 35 % du total) |
| `arbuste` | octaèdre r 0,8 | 0x1f6f55 | jardins, îlot du rond-point, pied de haie |

Tirage par `hachage32(x, z)` (échelle 0,75 à 1,3, rotation, teinte). Les arbres de `scene.trees` ne bougent pas (un test vérifie `classerArbres`
renvoie exactement `data.trees.length` éléments à la même position, l'arbre dans un bâtiment étant retiré du rendu seulement : 1 sur 788) ; leur nombre
alimente la difficulté des cachettes et reste donc intact.
**Haies** : tronçons de 0,9 m × 1,1 m, arêtes + faces translucides, un `LineSegments` + un `Mesh` (2 draws). **Pelouses** : un `Mesh` fusionné
(`ShapeGeometry` de chaque anneau, earcut de three), couleur `C.pelouse` 0x0b2a22 à 45 %, hachures diagonales dans un nuanceur
(`onBeforeCompile`, `fract((x + z) × 0,5)`, `customProgramCacheKey` unique) pour qu'une prairie se lise comme tel en fil de fer.

### D5. Signalisation et mobilier : instanciés et fusionnés, trois draw calls

- **Lampadaires** : mât (trait de 6,5 m), bras de 1,6 m, tête émissive `C.lampe` 0xffd9a0 (au-dessus du seuil : un point lumineux avec halo), et
  **une tache de lumière au sol** (disque de 7 m, dégradé par couleurs de sommets, mélange additif, intensité 0,10, donc sans bloom) : ce sont ces
  taches qui donnent le côté « néon la nuit » aux avenues. Un `InstancedMesh` pour les taches, la tête dans le `Mesh` fusionné.
- **Panneaux** (plaque + poteau) : stop (octogone `C.stop` 0xff4a3a), cédez (triangle ambre `C.amber`), passage piéton (carré `C.info` 0x4cc3ff),
  arrêt de bus (rectangle `C.bus`). Pas de feux tricolores : aucun dans OSM, on n'invente pas de signalisation lumineuse.
- **Abris de bus** aux 6 arrêts (boîte filaire 3 × 1,6 × 2,5 m + toit translucide), bancs (boîte 1,6 × 0,45 × 0,5), corbeilles (cylindre bas), racks
  à vélos (arceaux), portails OSM (deux montants).
- Résultat : `LineSegments` des mâts/poteaux/arêtes (1), `Mesh` fusionné des plaques/têtes/bancs (1), `InstancedMesh` des taches (1).
- **Aucune collision** : ni `construireMonde`, ni `tir.ts`, ni la navigation ne lisent ces objets ; les balles les traversent comme les arbres
  actuels. Test `decor-sans-collision.test.ts` : `construireMonde(data)` est identique avec et sans `data.decor`.

### D6. Façades v2 (shader, aucune géométrie ni collision de plus)

Extension de `facade.ts` et de `GLSL_FACADE` (`decor.ts`), mêmes règles de miroir JS ↔ GLSL qu'aujourd'hui (constantes recopiées, test de parité).
`aMur.w` reste (porte) ; nouvel attribut `aStyle` (un float par sommet, constant par bâtiment) = style (bits bas) + drapeau resto (bit 3).
`styleFacade(b, id, poiType)`, déterministe (hachage de l'`id`) :

- `percee` (≈ 50 %) : l'actuelle.
- `bandeau` (≈ 25 %, étages ≥ 2) : fenêtres en bande continue par étage, meneaux tous les 3 m, allège pleine.
- `mur_rideau` (≈ 15 %, h ≥ 9 m et emprise ≥ 150 m²) : grille fine de meneaux (1,5 m × 3,2 m), verre sombre, reflet cyan en diagonale.
- `industriel` (≈ 10 %, h < 7 m et emprise ≥ 400 m²) : bardage vertical (lignes fines tous les 0,6 m), peu de fenêtres en hauteur, porte sectionnelle de 4 m.
- Restaurants (`resto`) et la base (`home`) : toujours `percee` + **enseigne néon** (barre ambre `C.amber` de 60 % de la largeur de la porte, au-dessus d'elle, au-dessus du seuil du bloom) ; la base garde sa teinte blanche.
- Tous : **rez-de-chaussée vitré** pour `percee` quand le mur a une porte (vitrine continue de part et d'autre, 2,6 m de haut), teinte de bâtiment par hachage
  (trois nuances cyan → bleu-vert → gris-bleu, toutes sous le seuil), léger **soubassement** foncé (déjà `socle`), **toits** : acrotère (liseré à 0,5 m du bord
  par distance à l'arête, calculée depuis un attribut de toit `aMur.x` = distance au bord) et **panneaux solaires** (deux boîtes inclinées instanciées
  dans `ajouterEquipementsToit`, type `solaire`, un tirage sur les toits plats de plus de 300 m², sans allonger la liste de `placementsToit` des tests existants :
  nouveau type ajouté EN FIN de tirage pour ne pas modifier les positions déjà tirées).
- L'effondrement des bâtiments (arène) continue de plier la hauteur par `vMondeB.y` : le nouveau motif s'en sert aussi.
- `customProgramCacheKey` passe de `batiment-effondrable-4-…` à `-5-…`.

### D7. Quels modes, quoi

| | Sol (chaussée, marques, parkings) | Végétation | Mobilier | Façades v2 |
| --- | --- | --- | --- | --- |
| Vue aérienne | oui | oui | oui (taches de lumière comprises) | oui (nouveau : `detail` y passe à vrai pour les styles ; jusque-là faux) |
| Arène | oui | oui | oui | oui |
| BR | oui | oui | oui | oui |
| Zombies | oui | arbres retypés seulement | non | oui |

- **Zombies** : dans `BORNES_ZOMBIES` (x 8..236, z −110..24) agrandi de 6 m, aucun lampadaire, panneau, banc, haie, pelouse, arbuste ni séparateur de place
  (les aménagements maison de la carte, oliviers, parking du personnel, conteneurs, les remplacent ; `opts.exclure`). Les arbres OSM sont retypés comme ailleurs
  (ils y étaient déjà). Pas de taches de lumière : l'ambiance orageuse (`ambiance-zombies.ts`) reste lisible.
- **Qualité** : `opts.qualite = "basse"` si `matchMedia("(pointer: coarse)")` ou `navigator.hardwareConcurrency <= 4` : sans taches de lumière, sans haies, sans arbustes,
  sans styles `mur_rideau` / `industriel` (retombent sur `percee`). L'arène est déjà indisponible au tactile ; la vue aérienne y reste utilisable.
- **Chasse au tigre** : `opts.eviter` = positions de `cachettes.json` (la vue aérienne les a) ; aucun mobilier, arbuste ni haie à moins de 3 m d'une cachette, pour que
  le halo orange du tigre (`LUEUR`) ne soit pas noyé par une tête de lampadaire. La difficulté des cachettes (bâtiments, arbres de `scene.trees`) ne bouge pas.

### D8. Palette

`C` de `decor.ts` reçoit : `chaussee 0x070f16`, `trottoir 0x14323d`, `marquage 0xdbeef5`, `pelouse 0x0b2a22`, `haie 0x1f6f55`, `platane 0x2c7a52`,
`automne 0x5a4318`, `cypres 0x174d3b`, `olivier 0x5f8f78`, `pin 0x2a6b52`, `lampe 0xffd9a0`, `stop 0xff4a3a`, `info 0x4cc3ff`. Aucune couleur n'est écrite en
dur ailleurs. Ces valeurs sont un point de départ : la revue des captures « après » peut les régler (règle : tout reste sous 0,24 de luminosité sauf marquage de
l'axe, enseignes, têtes de mâts et fenêtres allumées). Les tokens CSS `--ag-*` de `Agroparc3D.module.css` ne changent pas (la DA 3D n'a pas de style CSS).

## Architecture fichier par fichier

**Données et scripts**
- `scripts/agroparc/build_decor.py` (nouveau) ; `public/agroparc/decor.json` (nouveau, généré).
- `scripts/palantir/captures_da.mjs` (nouveau) : captures « avant » / « après » et mesure de fluidité (cf. Tests).

**Modules purs** (`lib/agroparc3d/`, un `.test.ts` chacun)
- `types.ts` (`DecorOsm`, `SceneData.decor?`), `hasard.ts` (extraction du hachage et de mulberry32 de `facade.ts`, qui les réimporte ; `fenetreAllumee` et
  `placementsToit` rendent exactement les mêmes valeurs qu'avant : leurs tests existants sont le garde-fou), `voirie.ts`, `parkings.ts`, `vegetation.ts`,
  `mobilier.ts`, `decor-donnees.ts` (`deriverDecor`), `facade.ts` (`styleFacade`, constantes des styles).

**three** (`lib/agroparc3d/`)
- `decor-sol.ts` : `ajouterChaussees`, `ajouterMarquages`, `ajouterPelouses`, `ajouterPlacesParking` (+ le `LineSegments` des bords ajouté à `ajouterReseauSol`, qui reste le seul `LineSegments` de sol à couleurs de sommets).
- `decor-vegetation.ts` : `ajouterVegetation` (remplace `ajouterArbres`, qui reste exportée et rend l'ancien dessin quand `deriverDecor` n'est pas demandé : vue aérienne sans `decor`, tests existants).
- `decor-mobilier.ts` : `ajouterMobilier`.
- `decor.ts` : `OptionsDecor` gagne `ambiance?: "complete" | "zombies"`, `qualite?: "haute" | "basse"`, `eviter?: readonly Vec2[]` ; `construireDecor` orchestre ; `GLSL_FACADE` étendu ; `C` étendu. `ajouterBatiments` garde sa signature.
- `scene.ts` : `construireDecor(scene, data, { fantomes: true, detail: true, eviter: cachettes })` à la place des quatre appels séparés (même ordre, grille comprise).

**Client jeu**
- `lib/fps/jeu.ts` : `construireDecor(decor, data, { fantomes: false, destruction, ambiance: modeZ ? "zombies" : "complete", qualite })` (une ligne). Les `dispose` existants (parcours du `decor`) libèrent tout ; aucune texture, aucun `DataTexture` nouveau.
- `lib/fps/zombies-carte.ts` : exporte `BORNES_ZOMBIES` (déjà exporté) ; `construireDecor` lit la boîte via `opts.exclure` posée par `jeu.ts`, pas d'import de `lib/fps` dans `lib/agroparc3d`.

**React**
- `app/components/Agroparc3D.tsx` : `fetchDecor()` tolérant, passé dans `scene.data.decor`.

**Serveur, protocole, DB, Python du pipeline** : aucun changement. `VERSION_PROTOCOLE` reste 10. Le serveur n'a pas à être redéployé avant le client.

## Budgets de performance

Mesure de référence prise AVANT toute modification (étape 0), même machine, rendu logiciel (SwiftShader), même point de vue : 60 images consécutives,
médiane du temps d'image.

- **Draw calls du décor** (compte des `Mesh` / `LineSegments` / `InstancedMesh` visibles, test dans `decor.test.ts`) : aujourd'hui ≈ 15 (9 + 2 toits + sol + grille + 2 arbres) ; après :
  **≤ 32** dont ruban de chaussée 1, marquages 1, pelouses 1, places 1 (bords et trottoirs ajoutés au `LineSegments` de sol existant), arbres 6 (5 couronnes + 1 troncs, +1 arbustes), haies 2, mobilier 3. Façades : 0 draw call de plus.
- **Triangles** : ≤ 120 000 de plus que la scène actuelle (arbres ≈ 40 000 triangles filaires, chaussée ≈ 20 000, marquages ≈ 3 000, pelouses ≈ 6 000, mobilier ≈ 15 000).
- **Aucun travail par image** : le décor est statique (pas de `uTime`, pas de mise à jour d'instances). Le coût JS par image ne bouge pas.
- **Temps d'image en rendu logiciel** : médiane après ≤ 1,25 × celle d'avant dans la vue aérienne au repos, dans l'arène à hauteur d'œil au rond-point et dans l'arène devant
  une façade ; au-delà, la qualité « basse » devient la valeur par défaut des captures et on retire d'abord les taches de lumière (transparence additive plein écran), puis les pelouses.
- **Calcul au chargement** : `deriverDecor` ≤ 60 ms mesurés (plafond de test 400 ms). `decor.json` ≤ 60 Ko. Chargement : une requête de plus, en parallèle des deux autres, jamais bloquante.
- **« Menu d'abord »** : tout le code est derrière `Agroparc3D` (`next/dynamic`) ; aucun import n'est ajouté au premier chargement de la page du menu.
- **Mémoire** : un seul jeu de géométries fusionnées par scène, libérées par les parcours de `dispose` existants (`scene.ts`, `jeu.ts`) ; pas de texture.

## Tests

**Unitaires (vitest, Node 22, sur le vrai `scene.json` et `decor.json`)**
- `voirie.test.ts` : aucun point de bord dans la chaussée d'une autre voie (tolérance 0,15 m) ; axe pointillé : alternance 3 m / 6 m, rien dans les carrefours ; chaque passage piéton centré à moins de 0,5 m d'un axe de voie, jamais dans un bâtiment, entre 60 et 200 passages, au plus 160 ; dents de requin : au moins 3 entrées au rond-point ; déterminisme (deux appels égaux) ; plafond de temps.
- `parkings.test.ts` : chaque séparateur dans son parking, hors bâtiments, hors chaussée S ; 1 000 à 4 000 séparateurs.
- `vegetation.test.ts` : un élément par arbre de `scene.trees` à la même position ; chaque type représenté (≥ 3 % chacun hors arbuste) ; platane sur alignement ; haies jamais dans un bâtiment ni sur une chaussée ; triangles de pelouse hors bâtiments ; déterminisme ; arbres dans un bois OSM = pins.
- `mobilier.test.ts` : lampadaires espacés d'au moins 18 m, jamais sur la chaussée (distance à l'axe ≥ demi + 0,6 m) ni dans un bâtiment, entre 150 et 350 ; rien à moins de 3 m d'une cachette quand `eviter` est fourni ; panneaux orientés vers l'arrivée ; abris aux arrêts.
- `facade.test.ts` : `styleFacade` déterministe, répartition dans ±8 points des proportions, restos et base toujours `percee` ; parité JS ↔ GLSL des constantes ; `fenetreAllumee` et `placementsToit` inchangés (tests existants non modifiés).
- `decor.test.ts` : nombre de draw calls ≤ 32 en vue complète ; sans `data.decor`, repli sans erreur ; `ambiance: "zombies"` ne crée ni mobilier ni haies dans la boîte des zombies ; `qualite: "basse"` retire taches, haies, arbustes ; compile les nuanceurs modifiés comme le test existant (`compiler`).
- `decor-sans-collision.test.ts` : `construireMonde(data)` (arène), `construireMondeZombies` et `construireMondeBr` rendent des prismes identiques avec et sans `data.decor`.
- `decor-osm.test.ts` : schéma de `decor.json` (versions, types, anneaux fermables, coordonnées dans `TREE_BOX`), 30 à 60 Ko, comptes dans des plages larges (lampadaires 30–60, passages 25–50, haies 60–110, pelouses 120–200) pour résister aux évolutions d'OSM.
- Les tests « détail faux (vue aérienne) » de `decor.test.ts` supposent la vue aérienne inchangée : `detail` y passe à vrai (façades v2), ils sont réécrits pour viser `detail: false` explicite, et les tests du mode `detail` couvrent le reste.
- Existants à garder verts : `cachettes.test.ts` (octet), `facade.test.ts`, `decor.test.ts`, `minimap*.test.ts`, `zombies-carte.test.ts`, `br-carte.test.ts`, `match.br.charge.test.ts` lancé seul.
- Commandes : `npx vitest run lib/agroparc3d lib/fps`, `npx tsc --noEmit -p .`, `cd serveur-fps && npm run typecheck`, `npm run build`.

**Vérification visuelle headless obligatoire** (`scripts/palantir/captures_da.mjs`, modèle : `scripts/fps/captures_zombies.mjs` pour les ports libres, le pointer lock émulé
et `window.__arene` ; `window.__palantir` pour la vue aérienne). Rendu logiciel lent : **leçon de la préparation de cette spec** (un essai de capture de la vue aérienne a dépassé le délai de 30 s de `page.screenshot` en 1280 × 720) : utiliser `screenshot({ timeout: 120000, type: "jpeg", quality: 82 })`, `deviceScaleFactor: 1`, et attendre 15 s après `myrtille` ; `E2E_OUT` pour le dossier.
Les images sont rangées dans **`docs/medias/palantir-da/`** (`avant-*.jpg`, `apres-*.jpg`, même nom de vue). Vues :
1. aérienne au repos ; 2. aérienne, zoom 120 m sur le rond-point (28,2 ; 2,5) ; 3. aérienne, zoom sur le grand parking de (115, 194) ; 4. aérienne, zoom sur Vival (200 ; −2,8) ;
5. arène, hauteur d'œil, à 45 m du rond-point, vue vers lui (îlot, dents de requin, 4 cédez) ; 6. arène, passage piéton (OSM : (36,5 ; −36,4)) ; 7. arène, parking `parkings[3]` (0 ; −30), les conduisibles
bien lisibles ; 8. arène, devant Le Bistrot Trèfle (55,2 ; 48,5), enseigne ; 9. arène, façade vitrée de CBA (−162,8 ; −12,7) ; 10. arène, allée de platanes ; 11. zombies, à la limite de
la boîte (Cour Ouest, (76 ; −68)) : aucun doublon d'aménagements ; 12. BR, vue d'altitude (position de l'avion `AVION_BR`) ; 13. tigre débusqué avec `__palantir.debusquer()` puis `viser(30)`, avant / après, dans trois cachettes : il reste repérable.
Chaque capture « après » est relue à l'œil par l'implémenteur (aplat jaune, bloom saturé, z-fighting des couches de sol, clignotements, hiérarchie des routes) avant le commit.
**Mesure de fluidité** : dans le même script, 60 `requestAnimationFrame` consécutifs aux vues 1, 5 et 9, médiane et p95, avant et après ; résultats dans le message de commit de l'étape 8.

## Découpage en commits (branche locale de l'issue, jamais poussée)

0. `chore(palantir): captures « avant » et mesure de fluidité de référence` (script, images `avant-*`, copie de cette spec).
1. `feat(palantir): données OSM du décor` : `build_decor.py`, `decor.json`, `DecorOsm`, `hasard.ts`, chargement tolérant, `decor-osm.test.ts`.
2. `feat(palantir): chaussées, bords, axes, passages piétons et rond-point` : `voirie.ts`, `decor-donnees.ts`, `decor-sol.ts`, palette, branchement dans `construireDecor` (`ambiance`, `exclure`, `qualite` posés d'emblée pour ne jamais casser les zombies), `scene.ts` et `jeu.ts` migrés.
3. `feat(palantir): places de parking marquées`.
4. `feat(palantir): végétation diversifiée, haies, pelouses` : `vegetation.ts`, `decor-vegetation.ts`, remplacement d'`ajouterArbres` dans `construireDecor`.
5. `feat(palantir): signalisation et mobilier` : `mobilier.ts`, `decor-mobilier.ts`, `eviter` (cachettes).
6. `feat(palantir): façades v2` : styles, rez vitré, enseignes néon, teintes, acrotère, panneaux solaires, clé de programme -5.
7. `test(palantir): décor sans collision, budgets de draw calls et de calcul`.
8. `docs(palantir): captures « après », mesures, CLAUDE.md` : mise à jour de la section « Arène FPS » et de `lib/agroparc3d` dans `CLAUDE.md` (décor, `decor.json`, `build_decor.py`, `deriverDecor`, options de `construireDecor`), statut de cette spec « implémenté ».
Chaque commit passe `vitest run lib/agroparc3d lib/fps` + `tsc --noEmit` ; `npm run build` aux commits 2, 6 et 8.

## Risques

- **Rendu logiciel des e2e** (2–10 images/s) : transparences additives (taches de lumière), pelouses translucides et façades plus chargées en nuanceur. Parades : budget 1,25 ×, `qualite: "basse"`, retrait des taches d'abord. Les e2e (`e2e_arene_v2`, `e2e_zombies`, `e2e_br`) sont à relancer à l'étape 8 : leurs délais pourraient se rallonger.
- **Bloom saturé** par les marquages ou les têtes de mât en groupe (halo qui s'additionne à 12 lampadaires autour du rond-point) : tout élément brillant est un accent, pas une surface ; intensité réglable par token `C`, revue sur captures.
- **Z-fighting / ordre des couches de sol** (aérien à 230 m, rendu logiciel) : couches `depthWrite: false` + `renderOrder`, hauteurs distinctes de ≥ 0,05 m ; vérifier sur les vues 1 à 3.
- **Overpass indisponible ou OSM qui évolue** : `decor.json` est versionné, le générateur n'est pas dans la chaîne de build ; les tests utilisent des plages larges. Sans `decor.json` le rendu se dégrade proprement (règles dérivées seules).
- **Découvrabilité du tigre** : `eviter` et la vérification visuelle 13 ; les arbres de `scene.trees` ne changent pas de nombre (difficulté des cachettes inchangée).
- **Cohérence avec les zombies** : exclusion de la boîte de la carte ; vue 11 pour le vérifier. Une pièce synthétique de zombies en bordure de boîte peut chevaucher un lampadaire OSM : la marge de 6 m est là pour ça.
- **Hypothèses de paysage** (essences, enseigne, verre) : non documentées en dehors d'OSM ; elles sont isolées dans des tables (`vegetation.ts`, `styleFacade`) faciles à retoucher.
- **Fichiers hors périmètre** : aucun changement de `scene.json`, `cachettes.json`, `generer_cachettes.mjs`, `serveur-fps/`, `protocole.ts`.

## Mesures et écarts à la spec (implémentation du 29/10/2026)

Mesures prises sur la machine de développement, rendu logiciel SwiftShader, 1280 × 720, `scripts/palantir/captures_da.mjs` (images `avant-*` / `apres-*` et `avant-fluidite.json` / `apres-fluidite.json` dans `docs/medias/palantir-da/`).

- **Draw calls du décor** (`decor.test.ts`) : 26 dans l'arène (≤ 32), façades v2 sans draw call de plus. **Triangles** : 24 065 → 73 189 (+49 000, budget 120 000). `decor.json` : 43 Ko.
- **Calcul** : `deriverDecor` ≈ 70 à 80 ms à froid (voirie 30, places 10, arbres 6, haies 4, pelouses 8, arbustes 5, mobilier 4, contexte 7) en test isolé, jusqu'à 170 ms sous la charge d'une suite de tests ; plafond de test 400 ms. Un peu au-dessus de la cible de 60 ms.
- **Fluidité** (médiane / p95 de 60 images après 30 images de chauffe ; la mesure des premières images, non chauffées, était trompeuse) : vue 1 aérienne 183 → 233 ms (× 1,27, un cran de 16,7 ms au-dessus du budget de × 1,25), vue 5 arène au rond-point 283 → 217 ms, vue 9 arène devant CBA 183 → 200 ms (× 1,09). Pour tenir ces chiffres, le nuanceur de façade saute tout le calcul de détail quand le détail est estompé à plus de 99,5 % et le détail s'estompe plus tôt (`smoothstep(0.18, 0.5, px)` au lieu de `(0.28, 0.85)`, soit à partir de 0,5 m par pixel, ≈ 270 m en arène) : les fenêtres lointaines sont donc un peu plus lisses qu'avant. Taches de lumière et pelouses n'ont pas eu à être retirées.
- **Écarts de détail** : l'enseigne néon des restaurants mesure 2,4 m × 0,28 m (et non 60 % de la largeur de la porte, soit 0,96 m, trop petit pour se lire) ; les bords du rond-point viennent des arcs M de `scene.json` (cordes de 22°), pas de cercles parfaits ; `placesParking` marque ≈ 1 130 séparateurs (parkings de plus de 150 m², allées S exclues) ; ≈ 97 passages piétons (34 OSM) et 268 lampadaires (≈ 42 OSM), 10 abris de bus (les `busStops` de `scene.json` comptent 10 points à plus de 6 m les uns des autres) ; l'acrotère est un liseré de lignes (pas un motif de nuanceur : la triangulation du toit n'a que des sommets de bord, une distance au bord ne s'interpole pas) ; les panneaux solaires vont par paires inclinées de 25° sur ≈ 60 % des toits de plus de 300 m² ; le mur rideau, le bandeau et l'industriel sont répartis parmi les styles admissibles (la part de façades percées dépasse donc 50 %).
- **Non vérifié à l'œil** : l'enseigne néon d'un restaurant vue de face (la porte du Bistrot Trèfle est masquée par un petit bâtiment à 6 m ; la vue 8 montre le côté et la vitrine allumée) ; les trois e2e (`e2e_arene_v2`, `e2e_zombies`, `e2e_br`) n'ont pas été relancés (voir le risque « rendu logiciel » plus haut).
