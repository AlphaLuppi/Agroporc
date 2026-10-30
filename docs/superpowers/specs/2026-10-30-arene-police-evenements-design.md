# Arène FPS : descente de police et événements paramétrables — design

Date : 2026-10-30 · Protocole : **`VERSION_PROTOCOLE` reste 11** (tout est additif, cf. §2 et §3.3) · Prime sur
`2026-10-24-arene-evenements-design.md` (service des événements), `2026-10-29-pause-parties-bots-design.md` (parties parallèles, bots du BR) et
`2026-10-29-zombies-retours-design.md` (sons échantillonnés) là où ils divergent.

## Statut

Spec de conception, **rien n'est implémenté**. Elle doit suffire à des agents qui n'ont que `CLAUDE.md` (sections « Arène FPS », « Événements de
l'arène (v3) », « Bus C3… », « Mode Battle Royale », « Parties parallèles, pause et bots (v11) », « Zombies v8 : sons échantillonnés ») et ce
document. Les références `fichier:ligne` sont celles de la branche `claude/arene-evenements-police` au 2026-10-30 : relire le code avant de s'y
fier à la ligne près. **Déploiement** : le serveur (`vps:/opt/pdj-fps`, `wss://pdj-fps.toam.tech`) doit être reconstruit et redéployé AVANT la
fusion du client, jamais de `docker compose down -v` (cf. §3.3 : l'ordre inverse est sans danger grâce aux capacités, mais les réglages
d'événements et la police n'existeraient pas).

## Demande

1. Un **son original du joueur** (`public/arene/sons/sirene-police.mp3`, 9,84 s, mono 44,1 kHz, 118 848 octets, créé sous FL Studio, source
   `3del.wav`, déjà importé) devient la sirène d'une **voiture de police qui débarque de nulle part**, en **arène** et en **Battle Royale** ; voir si
   la sirène peut aussi servir en **zombies**, sans voiture de police obligatoire.
2. La voiture fonce sur **le joueur qui a le plus de kills** en arène, sur **l'ennemi le plus proche** en Battle Royale. L'événement est **rare**.
3. Les **autres événements de l'arène sont paramétrables** : le joueur choisit lesquels il veut (tigre géant, etc.), pour éviter des parties où l'on
   a toujours les mêmes événements et un événement en permanence. Les événements doivent varier.

## Périmètre

Dans : `lib/fps/` (modules PURS, `Salle`, services), `serveur-fps/`, client (rendu, sons, UI), protocole (additif), tests, docs.
Hors : modifier un réglage d'une arène APRÈS sa création (pas de propriétaire ni de lobby en arène : on recrée une arène) ; réglage des événements en
zombies ; pause (arène et BR n'en ont pas) ; police en zombies (voiture) ; police qui monte dans les bâtiments, sur les toits ou dans l'eau ; la
circulation PNJ n'est pas un événement et n'est pas réglable ; bots du BR qui esquivent (lot facultatif, §4.5).

---

## 1. Décisions

### 1.1 Une seule voiture, deux déclencheurs

Un service PUR `lib/fps/match-police.ts` (`creerServicePolice(ctx, opts)`) simule la voiture. Il appartient à `Salle` (champ `this.police`,
`ServicePolice | null`), comme `elsa` ou `tigres`, et sert l'arène ET le Battle Royale. Il ne décide ni QUAND ni QUI cibler : il reçoit des
`ReglesPolice` injectées (mode arène : `police-regles.ts`, mode BR : `police-regles.ts` aussi, deux fabriques). Raisons : la voiture est la même
(physique, rendu, sirène, tirs), seules changent la cible, les conditions et la cadence ; en BR il n'y a pas de service `evenements`.

### 1.2 La police N'EST PAS un `TypeEvenement`

`TypeEvenement` reste `"truck" | "tigre"`. Un client déjà déployé qui recevrait `evenement{type:"police"}` annoncerait « Un tigre robot géant
attaque Agroparc ! » (`useArene.ts:408`) et rugirait (`sons.alerte`, défaut tigre). La police a donc SON message `police`, son champ de snap
`monstres.police` et sa cause de mort `police`. Les clients v8 à v11 ignorent les trois sans erreur (`default: break` de `jeu.ts:2302` et
`useArene.ts:448` ; `MondeMonstres.a` ne recopie que les clés connues).

### 1.3 Rareté : horloge propre, jamais dans l'alternance

La police a son minuteur, **hors** du rythme des événements à tour (Truck fou / tigre géant) : arène, une descente toutes les 5 à 9 min environ
(« Normal »), la première 4 à 7 min après la création de la salle OU après le moment où la salle compte deux joueurs en jeu (une salle restée vide
des heures n'a pas un minuteur échu : §4.2, « Armement ») ; BR, une seule par partie (deux au plus, §5). Elle occupe le créneau « un
événement à la fois » (§4.2, « Exclusivité ») mais ne modifie ni `dernierType` ni les intervalles des autres événements.

### 1.4 Réglages d'arène : fixés à la création, par le créateur

Un `ReglagesArene` (`evenements` + `frequence`) est choisi dans le panneau « Créer une arène », envoyé dans `mode{partie:"nouvelle", reglages}`,
validé par le serveur (liste fermée), porté par la partie (`Partie.config`) et diffusé dans `salons.listes` (`ResumePartie.reglages`). Il ne change
plus jusqu'à la fermeture de la partie (non permanente : fermée dès qu'elle n'a plus d'humain, `refermerVides`). La partie permanente **`ar1`**
(hall) a les réglages par défaut du serveur (tous les événements, fréquence Normal, surchargeables par `PDJ_FPS_EVT_ACTIFS` /
`PDJ_FPS_EVT_FREQUENCE`). Conséquence de routage : `PARTIE_NOUVELLE` ne reprend une arène vide que si ses réglages sont ÉGAUX à ceux demandés (`accepteVide`, §3.2) : jamais `ar1` vide pour des réglages non par défaut.

### 1.5 Pas de bump de protocole : capacités

Un client v11 en cache ne sait pas dessiner la voiture ni jouer la sirène. Sans précaution il se ferait écraser par une voiture invisible. Le
nouveau client annonce `bonjour.capacites: ["police"]` (`CAPACITE_POLICE`). Le serveur (`Client.capacites`, relayé à la salle par
`Salle.definirCapacites(id, capacites)`) traite un joueur humain SANS la capacité comme **immunisé et non ciblable** : la voiture ne l'écrase pas, ne
le choisit jamais pour cible et ne compte pas pour `joueursMin` / les candidats (un bot est toujours « capable »). Un joueur à jour qui arrive en
cours de descente est donc couvert sans règle de départ (la version d'une première rédaction ne vérifiait la capacité qu'au départ : un client v11 en
cache qui entrait pendant la poursuite se faisait tuer par une voiture invisible). Cela rend l'ordre de déploiement indifférent et `VERSION_PROTOCOLE`
inchangé (les trois tests qui figent 11 restent verts : `protocole.test.ts`, `match.v2.test.ts:1009`, `stats-br-fichier.test.ts`). `bonjour` est lu
AVANT `reprendre` dans `traiter` (`index.ts`) pour que `capacites` soit posé aussi sur une session reprise, et la salle les reçoit après chaque
`connecter` (`bonjour` comme changement de partie). Un client v8 à v10 (aucune capacité) est donc invisible pour la police.

### 1.6 Zombies : une patrouille de police en ambiance (§6)

Pas de voiture jouable ni d'écrasement : une **patrouille** passe en trombe hors de la carte, sirène et lueur bleu/rouge, 2 fois au plus par partie
à partir de la manche 3, synchronisée par le serveur (horloge virtuelle : la pause la fige), jamais pendant une manche du Truck.

---

## 2. Protocole (additif, `lib/fps/protocole.ts`)

| Ajout | Détail |
|---|---|
| `CauseMort` | `+ "police"`. Libellés « Écrasé par la police » dans `armesInfo.ts` (`libelleCause`) ET `hud-modele.ts` (`libelleFil`, qui ne connaît ni `bus_c3` ni `frappe_aerienne` : les ajouter au passage). Un client plus ancien affiche « Couteau » (repli `nomArme`) : sans importance, il n'est jamais écrasé (§1.5). |
| `CIBLE_POLICE = "police"` | valeur de `tir.touches[].cible` (et `coup.cibles` : non, la mêlée ne touche pas la voiture) pour un tir sur la voiture, sur le modèle de `CIBLE_TIGRE`. |
| `PoliceSnap` | `{ p: Vec3; cap: number; v: number; pv: number; pvMax: number; cible?: string; etat?: "fumee" \| "feu"; depart?: boolean }` ; `MonstresSnap.police?: PoliceSnap`. Arrondis au centimètre / milliradian comme `TruckSnap`. |
| Message serveur `police` | `{ t: "police"; phase: "debut" \| "fin" \| "etat"; debutT: number; finT: number; cible?: string; raison?: "temps" \| "detruite"; par?: string }`, adressé `a: "joueurs"`. `debut` à l'apparition (pas d'annonce préalable : la sirène audible de loin EST l'avertissement), `fin` à la disparition (`detruite` + `par` = tireur qui l'a achevée), `etat` à `synchro` d'un arrivant. |
| `EvenementZombies` | `+ { e: "patrouille"; p0: Vec3; p1: Vec3; t0: number; finT: number }` (§6). Un client sans ce cas ignore le `zevt`. |
| `mode` (client) | `+ reglages?: ReglagesArene`, lu seulement si `mode === "arene"` et `partie === PARTIE_NOUVELLE`. Écho serveur `mode` : `+ reglages?: ReglagesArene` (ceux de la partie rejointe, pour que le client sache ce qui a été appliqué ; absent d'un serveur ancien). |
| `ResumePartie` | `+ reglages?: ReglagesArene` (arènes seulement). |
| `bonjour` (client) | `+ capacites?: string[]` (liste blanche côté serveur : `["police"]`, le reste est ignoré). |
| `lancerPartie` (client) | `+ police?: boolean` (BR seulement ; absent = vrai ; tout autre type est ignoré = vrai). |
| `EtatPartieBr` | `+ police?: boolean` (réglage retenu, affiché dans le lobby aux non-hôtes). |

`PASSE_EN_SUSPENSION` (`suspension.ts:23-29`) : AUCUN nouveau `MessageClient`, rien à ajouter. `VERSIONS_ACCEPTEES` inchangé.

---

## 3. Réglages d'arène (couche A)

### 3.1 Modules PURS nouveaux

**`lib/fps/reglages-arene.ts`** (types, constantes, validation, libellés ; aucun accès horloge ni hasard) :

```ts
export const EVENEMENTS_ARENE = ["elsa", "avion", "bus", "truck", "tigre", "police"] as const;
export type IdEvenementArene = (typeof EVENEMENTS_ARENE)[number];
export const FREQUENCES = ["calme", "normal", "chaos"] as const;
export type FrequenceEvenements = (typeof FREQUENCES)[number];
export interface ReglagesArene { evenements: readonly IdEvenementArene[]; frequence: FrequenceEvenements }
export const REGLAGES_DEFAUT: ReglagesArene; // tous, "normal"
export function normaliserReglages(brut: unknown): ReglagesArene;
export function reglagesEgaux(a: ReglagesArene, b: ReglagesArene): boolean;
export function estParDefaut(r: ReglagesArene): boolean;
export const LIBELLES_EVENEMENTS: Record<IdEvenementArene, { nom: string; aide: string }>;
export function libelleReglages(r: ReglagesArene): string; // « Tous les événements · Normal », « Aucun événement », « Sans tigre géant, sans police · Calme »
```

Sens des cases (libellés français, `LIBELLES_EVENEMENTS`) : `elsa` « Elsa (soin et arme spéciale) » ; `avion` « Avion et tigres largués (donne le sort d'invocation) » ;
`bus` « Bus C3 (écrase à pied, largue des armes uniques) » ; `truck` « Truck Muche fou » ; `tigre` « Tigre robot géant (et titan) » ; `police`
« Descente de police ». `normaliserReglages` : non-objet → défaut ; `evenements` absent ou non tableau → TOUS (anciens clients) ; tableau → ses
éléments qui sont des chaînes de la liste fermée, dédoublonnés, rangés dans l'ordre de `EVENEMENTS_ARENE`, au plus 16 éléments examinés,
`[]` valide (« aucun événement ») ; `frequence` hors liste → `normal`. Ne jette jamais. Variable `PDJ_FPS_EVT_ACTIFS` : absente ⇒ défaut ; présente mais VIDE ⇒ aucun événement ; sinon liste CSV passée à `normaliserReglages`.

**`lib/fps/evenements-arene.ts`** (cadence et variété ; `alea: () => number` toujours en paramètre) :

```ts
export const FACTEURS_FREQUENCE = {
  calme:  { intervalle: 3,   tempsMort: 0.5, police: 2 },
  normal: { intervalle: 1.6, tempsMort: 0.3, police: 1 },
  chaos:  { intervalle: 1,   tempsMort: 0.1, police: 0.7 },
} as const; // Chaos = la cadence historique de la v3
export function choisirType(actifs: readonly TypeEvenement[], dernier: TypeEvenement | null, alea: () => number): TypeEvenement | null;
export function tempsMort(f: FrequenceEvenements, alea: () => number): boolean;
export function echelleIntervalle(base: { minMs: number; maxMs: number }, f: FrequenceEvenements): { minMs: number; maxMs: number };
export function typesActifs(r: ReglagesArene): TypeEvenement[]; // truck, tigre
export function optionsDepuisReglages(r: ReglagesArene, base: OptionsSalle, imposes: ImposesEnv): OptionsSalle;
```

- `choisirType` : tirage uniforme parmi `actifs` privés de `dernier` quand il en reste un autre (jamais deux fois de suite si possible) ; `null` si
  `actifs` est vide ; si un seul actif, il revient (pas d'autre choix). **Séquence de hasard identique à celle de la v3** (les tests de
  `match-evenements.test.ts` figent `alea`) : `actifs` toujours dans l'ordre `["truck","tigre"]`, UN seul tirage `Math.floor(alea() * n)` seulement quand
  plusieurs candidats restent (donc un tirage pour le tout premier événement, `alea() < 0,5` ⇒ truck, puis alternance sans tirage, comme aujourd'hui).
- `tempsMort` : `alea() < FACTEURS_FREQUENCE[f].tempsMort`. Un temps mort allonge le délai suivant d'un intervalle supplémentaire (donc des plages
  sans événement). `tempsMortP` ABSENT ⇒ 0 ⇒ AUCUN tirage de `alea` (les salles construites sans réglages, dont celles des tests, gardent exactement
  leur séquence d'avant).
- `optionsDepuisReglages` : retire `elsa`, `tigres`, `bus` des options selon les cases décochées, fixe `evenements.types` (`typesActifs`) et
  `evenements.tempsMortP`, met à l'échelle les intervalles (Elsa, avion, bus, premier/intervalle des événements) par `FACTEURS_FREQUENCE`, et
  `police` selon `echelleIntervalle` × `facteur.police` (plancher `POLICE.plancherMs`). `ImposesEnv` liste les intervalles fixés par une variable d'env
  (`PDJ_FPS_ELSA_*`, `PDJ_FPS_AVION_*`, `PDJ_FPS_BUS_*`, `PDJ_FPS_EVT_*`, `PDJ_FPS_POLICE_*`) : un intervalle imposé n'est JAMAIS mis à l'échelle
  (les e2e restent déterministes). `forcerType` (`PDJ_FPS_EVT_TYPE`) l'emporte sur `types`.

### 3.2 Serveur et routage

- `OptionsSalle` (`match.ts:191-226`) : `+ reglages?: ReglagesArene`, `+ police?: OptionsPolice` (§4.4). `Salle` conserve `reglages` (lecture) pour `resumePartie`.
- `OptionsServiceEvenements` (`match-evenements.ts:23-47`) : `+ types?: readonly TypeEvenement[]` (défaut `["truck","tigre"]`), `+ tempsMortP?: number`,
  `+ policeEnCours?: () => boolean`, `+ frequence?` inutile (déjà dans les intervalles). `prochainType()` (`:139-143`) devient
  `forcerType ?? choisirType(types, dernierType, ctx.alea)` ; `null` ⇒ le minuteur n'est jamais armé (`ph.t = Infinity`). `finEvenement` (`:156-161`) :
  `delai(intervalle)` + (si `tempsMortP > 0` et `alea() < tempsMortP`) un second `delai(intervalle)`. Le service n'annonce rien tant que `policeEnCours()` : le
  type déjà tiré est MÉMORISÉ dans `ph.type` et l'annonce est réessayée toutes les 5 s, exactement comme `tigrePermis` (sans mémoriser, chaque réessai
  retirerait un type et fausserait l'alternance). Équité police / événements : les deux réessaient toutes les 5 s, `evenements.tic` passe AVANT
  `police.tic` et chaque démarrage est atomique dans un tic ; la police attend en plus `margeApresEvenementMs`, donc un événement échu juste après une
  descente passe d'abord (aucune famine : l'intervalle des événements, ≥ 70 s même en Chaos, laisse toujours une fenêtre de 20 s libre à la police).
  Si `types` est vide, le service n'est PAS créé (`this.evenements = null`) ; le titan dépend du tigre : décocher `tigre` le désactive aussi.
- Le constructeur de `Salle` (`match.ts:326-349`) crée chaque service seulement si son option est présente ; `bus` : `this.busC3 = options.bus === false || zombies || br ? null : …`
  (`OptionsSalle.bus?: false | { intervalle }`). **Le service de police est construit EN DERNIER** (après `busC3`) : `creerEtatBusC3` et les autres services tirent
  `alea` à la construction, y insérer un tirage décalerait la séquence des salles existantes (tests à `alea` figé). **Découplage du bus** : `this.busC3` conditionne aujourd'hui la disponibilité des frappes (`match.ts:465`), `lancerFumigene` (`:851`)
  et la fusion des `armesLachees` / `fumigenes` / `frappes` dans le snap (`sortiesSnap` `:1795-1806`). Introduire `private readonly modeArene = !zombies && !br` et remplacer ces
  trois tests par `modeArene` ; le champ `bus` du snap n'est émis que si `busC3` existe. Sans bus : plus de bus, plus d'armes uniques larguées, mais les frappes (séries de 5
  kills) et les nuages de fumée déjà posés continuent de fonctionner.
- **`serveur-fps/src/index.ts`** : `creerSalleArene(reglages = reglagesHall)` fabrique `new Salle(construireMonde(scene), apparitions, Math.random, maintenantCreation(), optionsDepuisReglages(reglages, optionsBase, imposes))`.
  `reglagesHall` = `normaliserReglages({ evenements: PDJ_FPS_EVT_ACTIFS?.split(","), frequence: PDJ_FPS_EVT_FREQUENCE })` (variable absente ⇒ défaut ; `PDJ_FPS_POLICE=off` retire
  `police`). `PDJ_FPS_EVT_TYPE` continue de forcer le type.
- **`lib/fps/parties.ts`** : `fabriques: Record<ModeSalle, (config?: unknown) => S>` ; `creer(mode, permanente, config?)` ; `ouvrir(mode, config?)` ; `Partie<S>` gagne `config?: unknown` ;
  `resumePartie` (`index.ts:560-581`) y lit `reglages` pour l'arène. Aucune autre fabrique ne lit la config.
- **`lib/fps/salons.ts`** : `decisionPartie` reprend aujourd'hui une partie vide qui accueille (`parties.find(p => p.joueurs === 0 && …)`). Ajouter l'entrée
  `accepteVide?: (p: PartieRoutage) => boolean` (défaut : toute partie vide qui accueille) : `changerMode` (`index.ts:615-665`) la fournit pour une arène,
  `(p) => reglagesEgaux(reglagesDe(p.id), demandes)` (`reglagesDe` lit `Salle.reglages` de la partie du registre). Une arène vide ne sert donc qu'à qui veut EXACTEMENT ses
  réglages : ni `ar1` vide (réglages d'environnement) ni une arène personnalisée vide pas encore refermée (`refermerVides` passe au tic suivant : sans ce prédicat un
  créateur recevrait les événements d'un autre) ne sont reprises avec d'autres réglages. Plafond `PDJ_FPS_ARENE_PARTIES` (2) atteint :
  `refus{action:"mode", raison:"limite"}` comme aujourd'hui, et le lobby l'écrit (« Plus de place pour une arène de plus : rejoignez une arène existante » : une seule arène
  personnalisée à la fois tant que `ar1` existe ; relever le plafond demande de mesurer la charge, hors périmètre). `PARTIE_AUTO` ignore les réglages (la plus peuplée qui
  accueille, tous réglages confondus ; la liste et l'en-tête du panneau les affichent).
- **`changerMode`** valide `m.reglages` par `normaliserReglages` (JAMAIS le brut) puis appelle `registre.ouvrir("arene", reglages)` ; l'écho `mode` porte les réglages de la partie rejointe.
- **Capacités** : `bonjour` lit `capacites` (liste blanche), `Client.capacites`, `salle.definirCapacites(id, capacites)` à chaque `connecter` / changement de salle ; `ContexteSalle.supportePolice(id): boolean`
  (vrai pour un bot, faux pour un humain sans la capacité : §1.5).
- **Navigation partagée (arène ET BR)** : le cache de `carteNavigation` est un `WeakMap` PAR MONDE (`navigation.ts:30`) : « échauffer la grille du monde de référence » ne sert à aucune arène
  créée ensuite (`construireMonde(scene)` à chaque `creerSalleArene`, donc première grille à froid de 40 à 430 ms au premier Truck fou ou à la première police, en plein tic, sur un
  serveur 1 vCPU partagé par toutes les parties). Nouvelle fonction PURE `copierCarteNavigation(reference: Monde, monde: Monde, rayon: number)` (`navigation.ts`) : copie `bloque` de la grille
  de référence dans le cache du monde neuf (mêmes bornes, mêmes cases : tampon neuf, comme `installerNavigationBr`). `index.ts` calcule UNE fois avant `listen` `carteNavigation(mondeRefArene, 1.8)` et
  `carteNavigation(mondeRefBr, 1.8)` et appelle `copierCarteNavigation` dans `creerSalleArene` et `creerSalleBr` (arène : sert aussi le Truck fou, qui cessait de geler le serveur à sa première
  apparition). Test : la copie est identique à un calcul à froid et indépendante (écrire dans l'une ne change pas l'autre).

---

## 4. Descente de police (couche A, suite)

### 4.1 `lib/fps/police.ts` (PUR : constantes, cible, départ, écrasement)

```ts
export const POLICE = {
  longueur: VEH.longueur, largeur: VEH.largeur, hauteur: VEH.hauteur,   // 4,4 × 1,9 × 1,5 : la physique de pasVehicule est inchangée (24 m/s)
  pvMax: 700, fumeeFrac: 0.5, feuFrac: 0.2,
  dureeMs: 22_000, departMs: 4_000,                // poursuite puis retrait vers le point d'apparition (aucun écrasement pendant le retrait)
  vitesseEcrase: 4, margeEcrase: 0.2, hauteurMaxCibleM: 2.2,
  changementCibleMs: 2_000, cheminMs: 1_200, bloqueMs: 900, reculMs: 1_100, reessaiMs: 5_000, vitesseDepart: 14,
  departMinM: 90, departMaxM: 240, departIdealM: 160, candidatsVueMax: 24,   // plafond de points testés à vue (coût : §4.1, « Départ »)
  joueursMin: 2, margeApresEvenementMs: 20_000,
  premierMatchMs: 60_000,                          // aucune descente dans la première minute d'un match (arène : les kills repartent à 0)
  attendreLeaderMs: 60_000,                        // arène : délai maximal d'attente d'un premier kill avant de se rabattre sur le plus proche
  noeudsMax: 12_000, inaccessibleMs: 10_000,       // A* borné ; cible sans chemin écartée 10 s
  marges: { toucheM: 0.8 },                        // marge (m) de la boîte orientée de touche, en plus du rejeu de latence (§4.2)
  premier: { minMs: 240_000, maxMs: 420_000 },     // après la création de la salle OU le passage à 2 joueurs en jeu (arène)
  entre:   { minMs: 300_000, maxMs: 540_000 },     // après la fin d'une descente (arène, Normal)
  plancherMs: 150_000,
  br: { apresAtterrissageMs: 60_000, premierMinMs: 90_000, premierMaxMs: 240_000, vivantsMin: 4, secondeJoueursMin: 20, secondeMinMs: 180_000, secondeMaxMs: 300_000, max: 2 },
} as const;
export interface CandidatPolice { id: string; p: Vec3; kills: number; humain: boolean }
export function choisirCibleArene(c: readonly CandidatPolice[], voiture: Vec3, courante: string | null): string | null;
export function choisirCibleBr(c: readonly CandidatPolice[], voiture: Vec3): string | null;
export function choisirDepart(points: readonly Vec2[], joueurs: readonly Vec3[], cible: Vec3, vu: (x: number, z: number) => boolean, alea: () => number): Vec2 | null;
export function ecraseParPolice(e: EtatVehicule, p: Vec3, rayonJoueur: number): boolean;
export function etatCarrosserie(pv: number): "fumee" | "feu" | undefined;
```

- **Cible, arène** (`choisirCibleArene`) : le candidat de `kills` maximal ; égalité → le plus proche de la voiture ; **si personne n'a plus de 0 kill → le plus proche**. Les `kills` sont ceux
  du MATCH en cours (ils repartent à 0 à `demarrerMatch`) : pour que la voiture vise vraiment « celui qui a le plus de kills », `permis` n'autorise le départ que si un candidat a au moins 1 kill, ou
  si `attendreLeaderMs` (60 s) se sont écoulées depuis l'échéance du minuteur (repli : le plus proche). Hystérésis : la cible
  `courante` est gardée jusqu'à la prochaine réévaluation (`changementCibleMs` = 2 s) et ne change que si elle meurt, sort du jeu ou si un autre a STRICTEMENT plus de kills. Les
  candidats sont les joueurs vivants, en jeu, **à pied** (pas dans un véhicule, pas pilote du titan, pieds sous `hauteurMaxCibleM` : ni toit de bus, ni toit de bâtiment), hors protection
  d'apparition, **avec la capacité `police`** (§1.5) et **joignables** (ni l'« inaccessible » ci-dessous). Justification : la voiture n'écrase qu'à pied ; viser un conducteur ou un joueur sur un toit
  donnerait une poursuite sans fin. Un leader dans une voiture est donc remplacé, tant qu'il y est, par le meilleur des joueurs à pied. L'éligibilité de `reglesArene` reçoit de `Salle` la même fonction
  `aPied(j)` que celle injectée à Elsa et aux tigres (`!vehicules?.occupation(j.id) && !evenements?.estPilote(j.id)`) : le service ne voit pas `vehicules`.
- **Inaccessible** : si l'A* vers la cible renvoie `null` (cible sans chemin pour une voiture : intérieur d'un bâtiment creux du BR, cour fermée, plateforme), elle est écartée `inaccessibleMs` (10 s) et la
  cible suivante est choisie ; plus aucun candidat joignable depuis 3 s ⇒ `retrait`. Sans cette règle un joueur du BR qui fouille un bâtiment (la majorité, pendant la fouille) arrête la voiture contre un mur
  pendant 22 s. En BR, `permis` exige au moins un candidat humain dont le chemin n'est pas connu comme impossible.
- **Cible, BR** (`choisirCibleBr`) : le candidat **humain** le plus proche DE LA VOITURE ; s'il n'existe aucun humain éligible, le bot le plus proche. Justification : un bot n'est qu'un mannequin
  d'entraînement, la voiture n'a de sens que pour un humain ; les bots sur son chemin restent écrasables (l'écrasement s'applique à tout joueur à pied). Éligibles BR : vivant, au sol (ni à bord
  de l'avion ni en chute : `!vol.enVol`), non spectateur, hors invulnérabilité d'atterrissage (`protegeJusqua` vaut `Infinity` en vol et en chute puis `t + 5 s` à l'atterrissage : le filtre
  `t >= protegeJusqua` du service couvre les trois), DANS la zone courante (jamais de joueur déjà dans la tempête), joignables (ci-dessus), `kills` ignorés.
- **Départ « de nulle part »** (`choisirDepart`) : parmi `points` (routes, §4.4), ceux à ≥ `departMinM` de TOUS les joueurs en jeu (humains et bots, immunisés compris) ; parmi eux, ceux dont la distance à la
  cible est dans [110, `departMaxM`], triés par écart à `departIdealM` ; puis le premier qui est hors de la vue de tous (`vu(x,z)` = `visible(monde, œil, point)` d'au moins un joueur). **Coût borné** : le
  filtre de distance est fait d'abord (pur calcul), et `vu` n'est évalué que sur les `candidatsVueMax` (24) premiers points triés, soit ≤ 16 × 24 rayons en arène, ≤ 50 × 24 en BR (une version
  naïve testait chaque point de route, plusieurs centaines, contre chaque joueur dans le même tic : de l'ordre de la centaine de millisecondes) ; en BR les œils sont limités aux 12 joueurs
  vivants les plus proches du point candidat. Repli 1 : sans le critère de vue ; repli 2 : `departMinM` ramené à 60 m ; sinon `null`. Arène : l'appelant réessaie 3 fois à `reessaiMs`, puis abandonne
  et réarme à `maintenant + délai(entre) / 2`. BR : jamais abandonné, réessai toutes les `reessaiMs` tant que les conditions de `permis` tiennent (le coût d'un essai est borné comme ci-dessus). La voiture
  naît à `vitesseDepart` (14 m/s, jamais à l'arrêt) cap vers la cible. Test de coût : 50 joueurs et tous les points de route, un essai en moins de 5 ms.
- **Écrasement** : `ecraseParTruck` (`monstres.ts:213`) reçoit un dernier paramètre optionnel `dims = TRUCK_FOU` (comportement inchangé) ; `ecraseParPolice` l'appelle avec
  `{ longueur, largeur, hauteur, vitesseEcrase }` de `POLICE`. Mort : `ctx.tuer(j, null, "police", t)` (aucun kill crédité, bouclier ignoré, pas de classement du tueur) APRÈS un filtre
  `t >= j.protegeJusqua` fait par le service (`tuer` ignore la protection).

### 4.2 `lib/fps/match-police.ts` (service PUR)

```ts
export interface ReglesPolice {
  eligible(j: JoueurSalle, t: number): boolean;
  choisirCible(c: readonly CandidatPolice[], voiture: Vec3, courante: string | null): string | null;
  permis(t: number): boolean;                 // conditions du moment, faux = réessai dans reessaiMs
}
export interface OptionsServicePolice {
  mode: "arene" | "br";
  points: readonly Vec2[];                    // départs possibles, routes (index.ts les calcule avant listen)
  /** `carteNavigation(monde, 1.8)` (dégagement du Truck fou, arène ET BR, grille copiée par monde : §3.2) + `chemin(…, noeudsMax)` ; "attente" : le `BudgetNavigation` du serveur (un A* par 12 ms, TOUTES parties confondues, clé `police:<salle>`) a refusé ⇒ garder le chemin précédent ; null : aucun chemin (cible « inaccessible ») */
  chemin: (de: Vec2, vers: Vec2) => Vec2[] | null | "attente";
  regles: ReglesPolice;
  maintenant?: number;
  premier?: { minMs: number; maxMs: number }; entre?: { minMs: number; maxMs: number };   // arène : le service s'arme seul ; BR : absents, le service BR appelle armer()
  pvMax?: number; dureeMs?: number;          // essais
  autreEvenementEnCours?: () => boolean;     // arène : Truck fou / tigre / titan en cours ou annoncé
}
export interface ServicePolice {
  tic(maintenant: number): Sortie[];
  snap(): PoliceSnap | undefined;
  synchro(idDest: string): Sortie[];
  armer(t: number | null): void;             // BR ; null = plus jamais
  reinitialiser(t: number, rearmer: boolean): void;
  enCours(): boolean;
  /** revalide un plomb sur la boîte orientée de la voiture REJOUÉE sur son historique (`fenetreMs` = `Salle.rewindMaxMs`) ; renvoie la distance ou null */
  toucher(o: Vec3, d: Vec3, portee: number, t: number, fenetreMs: number): number | null;
  blesser(tireur: JoueurSalle, degats: number, t: number): Sortie[];
  liberer(id: string): void;
}
```

- **Phases** : `attente{t}` → `course{debutT, finT, e, cible, cibleT, bloqueDepuis, reculJusqua, ch, chT, pv, depart}` → `retrait{finT}` → `attente`. Copie de `ticTruck` (`match-evenements.ts:201-226`) :
  `pasTruck(e, vise, recul, dt, monde)` (physique de voiture, dérapage compris), A* toutes les `cheminMs`, `pointDeVisee`, marche arrière après `bloqueMs` immobile, écrasement
  `ecraseParPolice` sur les éligibles à pied. À `finT`, ou si plus aucune cible éligible depuis 3 s, passage en `retrait` : la voiture roule vers son point d'apparition (aucun écrasement), disparaît à moins de
  8 m ou après `departMs` (garde-fou : `fin` forcé à `finT + departMs + 1 s`).
- **Message `police`** : `debut` à l'apparition (`cible` = id de la cible initiale, mise à jour dans le snap), `fin` à la disparition (`raison:"temps"`) ou à la destruction (`raison:"detruite"`, `par`).
- **Historique et rejeu de latence** : à 24 m/s la voiture parcourt 2,4 m en 100 ms et le client la dessine avec `interpMs` de retard : une validation sur la seule position courante avec 0,3 m de marge
  rejetterait presque tous les tirs d'un joueur qui touche pourtant ce qu'il voit (le tigre géant, 8 m/s, tolère déjà 1,6 m sans rejeu). Le service garde donc un historique `{t, p, cap}` (une entrée par tic
  à 60 Hz, élaguée au-delà de `fenetreMs`, comme `positions()` de `match-tigres.ts`) ; `toucher` accepte le plomb si la boîte orientée (4,4 × 1,9 × 1,5 + `marges.toucheM` 0,8 m) d'UNE position de la fenêtre est
  touchée (même règle OU que `Salle.positionsCible`) et qu'aucun mur n'est plus proche (`lancerRayon`) ; `fenetreMs` est `Salle.rewindMaxMs` (300 ms en arène, `BR.rewindMaxMs` en BR : snaps à 10 Hz). Test : un
  plomb tiré sur la position de la voiture 200 ms plus tôt à 24 m/s touche ; 700 ms plus tôt non.
- **Destruction** : 700 PV (`pvMax`). Les tirs arrivent par `tir.touches[]` avec `cible: CIBLE_POLICE`, revalidés par `toucher` (ci-dessus) ; dégâts = dégâts de l'arme au corps (`degatsPlomb(arme, "corps", distance)`),
  **sans** multiplicateur de zone ; cumulés par tir puis appliqués par `blesser` comme `blesserMonstre`. `etatCarrosserie` : fumée ≤ 50 %, feu ≤ 20 % (champ `etat` du snap, rendu par `rendu-feux.ts`). À 0 PV :
  `explosionMonstre{p, rayon: 5}`, `police{phase:"fin", raison:"detruite", par}`, la voiture disparaît ; aucun dégât de souffle, aucun kill, aucun point (pas d'exploit de score) ; fil d'annonce « X a mis fin à
  la descente de police ». Les tirs sur la police ne passent que si la voiture est la première chose touchée (même règle que le tigre géant). La mêlée ne la touche pas.
- **Exclusivité (arène)** : le service ne démarre pas tant que `autreEvenementEnCours()` (Truck fou, tigre géant ou son annonce, titan), ni dans les `margeApresEvenementMs` (20 s) qui suivent la fin d'un
  événement ; en échange `OptionsServiceEvenements.policeEnCours` bloque l'annonce d'un Truck fou / tigre géant pendant une descente (type mémorisé : §3.2). Avion, tigres largués, bus C3 et Elsa ne sont PAS concernés (ils cohabitent).
- **Armement (arène)** : à la création `maintenant + délai(premier)` ; après chaque descente `maintenant + délai(entre)` (+ un `entre` de plus si `tempsMort`). **Salle peu peuplée** : tant que moins de
  `joueursMin` (2) joueurs CAPABLES sont en jeu, `permis` est faux ; à chaque PASSAGE de moins de 2 à 2 joueurs capables (état mémorisé d'un tic à l'autre), `t = max(t, maintenant + délai(premier))`. Sans cette règle,
  `ar1` (permanente, restée vide des heures, minuteur échu depuis longtemps) lâchait la voiture 45 s après l'arrivée du deuxième joueur, au mépris de « rare » ; la règle d'origine (« repousser à `maintenant + 45 s`
  à chaque tic ») donnait en plus une salle à 1 joueur qui se re-remplit une police tous les 45 s. Une salle qui oscille entre 1 et 2 joueurs ne déclenche rien, c'est voulu. Éteinte (`null`) si la case
  `police` est décochée ou `PDJ_FPS_POLICE=off`.
- **Phase de match (arène)** : comme `evenements.tic`, `police.tic` ne fait RIEN hors `enPhaseJeu()` (aucune descente ni écrasement pendant l'entracte et le podium). `Salle.terminer` appelle
  `police.reinitialiser(t, false)` (une descente en cours finit par `police{phase:"fin"}` : pas de voiture qui roule sur l'écran de classement) ; `Salle.demarrerMatch` aussi, puis `t = max(t, maintenant + premierMatchMs)`
  (60 s sans descente au début d'un match, les kills repartent à 0).
- **Capacités** : voir §1.5 (les joueurs sans la capacité sont immunisés et ne comptent ni dans `joueursMin` ni dans les candidats ; aucun veto global).
- **`reinitialiser(t, rearmer)`** : appelé par `Salle.terminer` et `Salle.demarrerMatch` (`rearmer:false`, la cadence de la police est celle de la salle, pas du match de 8 min ; une descente en cours est terminée sans message
  d'erreur : `police{phase:"fin"}`) et par le service BR au retour au lobby.
- **Hasard et horloge** : uniquement `ctx.alea` (les tirages de la police n'ont lieu qu'à l'armement et au départ, après la construction des autres services : §3.2) et le `maintenant` virtuel reçu ; AUCUN `Math.random`, `Date.now`, minuteur (garde `suspension.horloge.test.ts`, et ne PAS étendre la liste blanche
  `MATH_RANDOM_TOLERE`).

### 4.3 `lib/fps/police-regles.ts` (PUR : fabriques de règles)

`reglesArene(ctx, aPied, evenements)` : `eligible` selon §4.1 (à pied via la fonction `aPied` injectée par `Salle`, pas pilote du titan, hauteur, protection, capacité) ; `choisirCible = choisirCibleArene` ; `permis` = au moins
`joueursMin` joueurs capables en jeu, un candidat avec un kill ou `attendreLeaderMs` écoulées, `!evenements?.titanEnCours()`. `reglesBr(ctx, aide)` : `aide: AidePoliceBr` (§5.2) ; `eligible` selon §4.1 (BR) ; `choisirCible = choisirCibleBr` ; `permis` = `aide.phase() === "jeu"`, `t ≥ aide.premierAtterrissageT() + apresAtterrissageMs`,
vivants ≥ `vivantsMin`, au moins un humain éligible et joignable, un point de départ dans la zone courante (`aide.zone(t)`) ; `premierAtterrissageT()` n'existe pas encore dans `match-br.ts` : voir §5.2.

### 4.4 Câblage dans `Salle` et `index.ts`

- `ContexteSalle` (`match-contexte.ts:127-185`) : `+ supportePolice(id: string): boolean`. Nouvelle interface `ServicePolice` (ci-dessus) exportée de `match-contexte.ts`. `ServiceEvenements` gagne
  `occupe(): boolean` (annonce, événement ou titan en cours) et `titanEnCours(): boolean`.
- `Salle` : champ `private police: ServicePolice | null`, créé si `options.police` (arène : si `reglages.evenements` contient `police` ; BR : toujours créé, armé par le service BR), tic **juste après
  `evenements.tic`** (`match.ts:1578`), `snap` fusionné dans `monstres` (`sortiesSnap`, `match.ts:1791-1830` : en BR `monstres` n'existe pas aujourd'hui ; il est créé quand `police.snap()` est défini, sinon toujours absent),
  `synchro` à `rejoindre` arène (`:973`) et à l'arrivée BR (joueur ou spectateur), routage de `touches[].cible === CIBLE_POLICE` vers `police.toucher` / `police.blesser` à côté de celui de `CIBLE_TIGRE`
  (`match.ts:1339`, `:1396`), `liberer(id)` à la déconnexion, `demarrerMatch` → `reinitialiser(t, false)`.
- `OptionsSalle.police?: { points: Vec2[]; chemin: …; intervalle?; pvMax?; dureeMs?; capaciteRequise?: boolean }`. `index.ts` calcule `points` UNE fois avant `listen` :
  arène = `pointsApparition(scene, monde)` (`collision.ts:459`, routes hors bâtiments et eau, espacées de 12 m) ; BR = pool `route` de `pointsButin` (`br-carte.ts:437`) par monde BR. Navigation : l'arène réutilise
  `carteNavigation(monde, DEGAGEMENT_TRUCK_M = 1.8)` (même rayon que le Truck fou) ; le BR l'utilise AUSSI (et non la grille des bots) : la grille de `installerNavigationBr` (`grilleNav` : cases de 1,5 m,
  dégagement 0,8 m) fait passer par des portes et des passages de 2 m où une caisse de 4,4 × 1,9 m reste coincée. Dans les deux modes la grille est précalculée sur un monde de référence et COPIÉE dans chaque
  monde neuf (`copierCarteNavigation`, §3.2) ; les recherches passent par le `BudgetNavigation` unique du serveur (créé avant `listen`, partagé avec les bots, clé `police:<id de salle>`) et sont bornées
  à `POLICE.noeudsMax` ; aucun calcul de grille à froid pendant un tic.
- Variables d'essai : `PDJ_FPS_POLICE=off`, `PDJ_FPS_POLICE_MIN_MS` / `PDJ_FPS_POLICE_MAX_MS` (premier ET entre ; une seule borne sert aux deux, comme `intervalleEnv`), `PDJ_FPS_POLICE_DUREE_MS`, `PDJ_FPS_POLICE_PV`,
  `PDJ_FPS_EVT_ACTIFS` (liste CSV), `PDJ_FPS_EVT_FREQUENCE`. **Tous les scripts qui neutralisent déjà les événements (`PDJ_FPS_EVT_*`) neutralisent aussi la police** : `e2e_arene_v2.mjs:410`, `e2e_arene_tigres.mjs:408`,
  `e2e_apercus.mjs:76`, `captures_bots.mjs:48`, `palantir/captures_da.mjs:144`, `e2e_br.mjs`, `e2e_br_bots.mjs` (`PDJ_FPS_POLICE=off`) ; côté zombies `e2e_zombies.mjs`, `captures_zombies.mjs` et
`protocole_parties.mjs` (`PDJ_FPS_ZOMBIES_PATROUILLE=off` et `PDJ_FPS_POLICE=off`) : une patrouille de la manche 3 ou une descente attendue changeraient leurs scénarios déterministes.

### 4.5 Bots du BR (lot facultatif, non bloquant)

Sans réaction, les bots se font écraser comme du bétail. `EntreeCerveau` (`bots-br.ts:168-198`) gagne `menaces?: { p: Vec3; cap: number; v: number; rayon: number }[]` alimenté par `AideBots` (état de la police) ;
`decider` ajoute une branche « esquive » prioritaire quand la voiture est à moins de 25 m avec un temps d'impact < 1,5 s : déplacement perpendiculaire à son cap. Test : `bots-br.test.ts`. Ne change ni le
budget A* ni la cadence 20 Hz.

---

## 5. Battle Royale

### 5.1 Règles

- **Réglage** : « Descente de police » (activée par défaut), choisi par l'hôte dans le lobby, transmis par `lancerPartie{police}` ; lu dans `match-br.ts:334-362` (`police = msg.police !== false`), mémorisé comme `avecBots`,
  remis à vrai dans `retourLobby` (`:309-325`), publié dans `etatA` (`:181-205`, champ `police`).
- **Quand** : jamais en vol, jamais avant `premierAtterrissageT + apresAtterrissageMs` (60 s), jamais avec moins de `vivantsMin` (4) vivants, jamais si aucun humain n'est éligible, jamais avec un point de départ
  hors de la zone courante (donc jamais dans la tempête). **Armement** : `premierAtterrissageT` n'est connu qu'APRÈS le passage en jeu (`passerEnJeu`, `:389-398`, fin du trajet de l'avion : les premiers joueurs ont déjà sauté et touché le sol pendant la phase « vol »,
  et c'est elle qui arme), donc la formule d'origine « `premierAtterrissageT + 60 s + alea(…)` armée à `passerEnJeu` » était circulaire. Règle retenue : `police.armer(t)` à `passerEnJeu` avec
  `t = maintenant + alea(premierMinMs…premierMaxMs)` (90 à 240 s, bornes de `POLICE.br` ; `PDJ_FPS_BR_POLICE_MS` pour les essais) ET `permis` exige en plus `premierAtterrissageT() !== null` et
  `t ≥ premierAtterrissageT() + apresAtterrissageMs` (60 s). `premierAtterrissageT` = premier instant où un HUMAIN touche le sol (le service BR le note quand `vol.atterris()` passe de 0 à plus de 0 sans compter les
  bots, remis à `null` par `retourLobby`). Les points de départ hors zone courante ou à moins de 60 m d'un joueur (zones étroites des derniers paliers) rendent la descente impossible : elle n'a simplement pas lieu,
  sans erreur (un essai toutes les 5 s, coût borné : §4.1) ; elle ne consomme pas son quota `max` tant qu'elle n'a pas démarré. **Une seconde** n'est armée que si la partie comptait ≥ `secondeJoueursMin` (20) joueurs au départ (bots compris), `secondeMinMs`…`secondeMaxMs` (3 à 5 min) après la FIN de la première ; jamais une troisième.
- **Pas d'annonce préalable** : message `police{debut}` + sirène. Bandeau court pour tous (« Descente de police ») ; la cible voit « La police est à tes trousses ! » (`cible === moi`).
- **Mort** : `ctx.tuer(j, null, "police", t)` → `mourirBr` : aucun kill crédité, aucun +50 PV, place classée par l'instant de mort ; le tueur de la killcam est absent, donc la carte seule puis le spectateur
  (comportement existant des morts sans tueur). `verifierVictoire` voit la mort au tic suivant. Une partie avec bots reste « non comptée » comme avant.

### 5.2 Service BR

`match-br.ts` expose `aidePolice(): AidePoliceBr` sur le modèle de `aideBots` (`:295-305`) : `phase()`, `zone(t)`, `vivants()`, `premierAtterrissageT()` (nouveau : état à ajouter à côté de `atterrisMax`, `echantillonnerAtterris`), `enVol(id)`, `estSpectateur(id)`, `nbJoueursDepart()`.
Les humains sans la capacité `police` (§1.5) sont immunisés et ne comptent pas parmi les candidats ; un BR où aucun humain vivant n'est capable n'a pas de descente.
`creerServiceBr` ne CRÉE pas la voiture (elle est créée par `Salle`, §4.4) : il appelle `police.armer(t)` à `passerEnJeu`, `police.armer(null)` si désactivée, `police.reinitialiser(t, false)` à `retourLobby` et à la fin de partie.
`Salle.sortiesSnap` fusionne `monstres.police` dans le snap BR (10 Hz, ≈ 60 octets, une seule voiture : `match.br.charge.test.ts`, à lancer SEUL, doit rester ≤ 10,5 Ko à 50 joueurs, tic ≤ 2 ms).

---

## 6. Zombies : « Patrouille de police » (couche D)

**Choix** : pure ambiance, rare, sans voiture jouable. Les murs des bâtiments creusés font 40 m de haut : une voiture hors carte serait invisible ; le joueur ENTEND une sirène qui traverse la carte et VOIT une
lueur bleu/rouge sur les murs et à l'écran. Cohérent avec « Service de midi » (un service de midi dans un parc d'activités : la police passe sur la route de service).

- **Module PUR `lib/fps/patrouille-zombies.ts`** : `PATROUILLE = { mancheMin: 3, max: 2, entreMinMs: 240_000, entreMaxMs: 420_000, premierDelaiMs: 45_000, vitesse: 20, ecartM: 40, distanceLueurM: 90 }` ;
  `planPatrouille(bornes: Boite, alea): { p0: Vec3; p1: Vec3; dureeMs: number }` (segment parallèle à un bord de `BORNES_ZOMBIES`, à `ecartM` en dehors, sens au hasard, tiré par `alea`, longueur de la carte + 120 m) ;
  `positionPatrouille(plan, tServeur): Vec3 | null` ; `lueurPatrouille(distance, tS): { bleu: number; rouge: number }` (0..1, alternance à 3 Hz, nulle au-delà de `distanceLueurM`, jamais plus de 0,12 d'intensité) ;
  `patrouillePermise(etat): boolean`. Aucun accès horloge, aucun hasard global. **Le hasard de la salle n'est PAS consommé** : comme le grand secret, le service des zombies crée un générateur propre
  (`aleaGraine` de `zombies-secret.ts` ou équivalent, semé par l'instant du lancement de la partie) pour les délais et le plan de la patrouille ; un tirage de plus sur `alea` décalerait les bonus,
  les boîtes et les apparitions des tests à `alea` figé (`match-zombies.test.ts`, `match.zombies*.test.ts`).
- **Serveur** (`match-zombies.ts`, section « ambiance ») : la première est armée `premierDelaiMs` après le début de la manche `mancheMin` (3), puis tous les `entre` ; au plus `max` (2) par partie ; elle n'est JAMAIS
  lancée pendant une manche du Truck Muche (annonce de livraison comprise) ni pendant les 20 s qui suivent un `zevt{eclair}` d'orage, ni en `pause` entre manches (seulement en manche : une patrouille échue pendant la pause attend la manche suivante, minuteur repoussé de `premierDelaiMs`), ni pendant une
  suspension (l'horloge virtuelle la fige d'elle-même ; aucun minuteur réel). Émet `zevt{e:"patrouille", p0, p1, t0, finT}` (instants serveur virtuels). `PDJ_FPS_ZOMBIES_PATROUILLE=off`, `_PATROUILLE_MANCHE`, `_PATROUILLE_MS`
  (essais ; 0 = dès le début de la manche) ; état remis à zéro au lancement et au retour au lobby.
- **Client** : `jeu.ts` `case "zevt"` → `patrouille` : mémorise le plan ; chaque image, `positionPatrouille(plan, tServeur)` (l'horloge serveur est figée en pause : la sirène suit) alimente `sons.sirenePolice(placeSon(pos), vitesseRadiale)` ;
  la lueur colore doucement le fond / le brouillard dans `majAmbianceZ` (`jeu.ts:3053-3076`) et `rInterieurs.flash` jamais plus de `lueurPatrouille` (**sans mouvement réduit** : `prefers-reduced-motion` supprime la lueur, la sirène reste ;
  jamais d'écran blanc). Une seule voix de sirène : en zombies il n'y a pas d'autre source, mais `sirenePolice(null)` à la fin, à la défaite, au retour au lobby, au `dispose`. Le son est préchargé dès l'entrée en zombies (§7.2).
- Aucun nouveau `MessageClient`, aucun champ d'état persistant (une reconnexion en cours de passage la manque : sans importance).

---

## 7. Client : rendu, son, UI

### 7.1 Rendu (couche B)

- `jeu-monstres.ts:46-68` : `MondeMonstres.a()` interpole `police` par `interpoler` (clé ajoutée dans les DEUX chemins, snap unique compris) ; `majPolice(m)` mémorise `{debutT, finT, cible, raison, par}` ; `reinitialiser`. Test dans `jeu-monstres.test.ts`.
- `rendu-monstres.ts` : `creerPolice(parent, aDisposer)` sur le modèle de `creerTruck` (`:77-118`) : carrosserie filaire de la voiture (exporter `geometrieVoiture` de `rendu-monde.ts:147`), livrée bleu-gris / blanc cassé,
  **barre de gyrophares** toit (`lumiere` rouge 0xff2030 et bleu 0x2a7bff, alternance `Math.floor(tS * 7) % 2`, `fog:false`), tangage, fumée / feu via `rendu-feux.ts` (`SourceFeu`) selon `etat`, explosion via `rm.explosion`. Les deux
  teintes restent SOUS le seuil du bloom (0,24 en luminance) ; AUCUN phare blanc ni halo additif. Branché dans `creerRenduMonstres` (`:590-630`, `aDisposer` complet). Rien n'est dessiné pendant le rejeu de killcam
  (`monstresImage` vidé, `jeu.ts:2871`), comme le Truck fou.
- **Visée et tirs sur la voiture (client)** : la voiture n'est touchable que si le client la sait toucher. `jeu.ts:784` `toucheMonstre(o, d, limite)` gagne une troisième cible : boîte orientée (4,4 × 1,9 × 1,5 m, cap et
  position de `monstresImage.police`, donc au même retard d'interpolation que ce que le joueur voit) via un helper PUR `toucheBoiteOrientee` de `lib/fps/police.ts` (testé, partagé avec le serveur : même
  boîte, marge ajoutée côté serveur seulement) ; elle renvoie `{ cible: CIBLE_POLICE, zone: "corps", distance }`, ce qui fait partir le plomb dans `tir.touches[]`, arrête la traçante et déclenche l'impact. Le
  `degats{cible:"police"}` reçu en retour (`m.cible` n'est ni moi, ni un joueur distant : la branche `else` de `jeu.ts:1860` fait déjà `posTouche`/`distants.get` sur un id inconnu sans erreur) donne le marqueur de
  touche (`toucheConfirmee`) ; la giclée de sang n'est pas jouée pour `CIBLE_POLICE` (étincelles à la place, `effets.impact`). Sans ce volet, le serveur reçoit des tirs sur une cible que le client ne
  déclare jamais.
- `jeu.ts:2865-2905` `majMonstres` : traces de pneus `suivreTraces("police", …, 0.8, 1.5)` ; **feu et fumée** : en arène, `feux.maj` est déjà appelé UNE fois par image dans `majMondeDynamique` (avec `sourcesFeux`) : la
  voiture abîmée y ajoute sa `SourceFeu` (lue sur `monstresImage.police` de l'image précédente, un retard d'une image sans importance) ; un second appel de `feux.maj` ferait avancer les particules deux fois ;
  en BR, `majMondeDynamique` sort tôt (`jeu.ts:2819`) donc `majMonstres` appelle alors `feux.maj(dt, sources)` et `tracesPneus.maj(dt)` (jamais les deux chemins dans la même image). En zombies, rien (pas de voiture).
  Le modèle 3D de la voiture n'est construit qu'à la PREMIÈRE apparition de la police (pas au chargement de la partie : une descente est rare). `jeu.ts:1964` : `case "police"` → `jm.majPolice(m)` ; la sirène n'est PAS déclenchée par le message mais par la présence du snap. Un client sans la capacité reçoit le snap mais ignore la clé `police` (§1.2) et n'est jamais écrasé (§1.5).
- Option : marqueur de la voiture sur la mini-carte (`radarFrame.police`, sur le modèle de `radarFrame.bus`, `minimap-couche.ts`).
- HUD : `EtatMonstresHud.police?: { finT; surMoi: boolean }` (`jeu-types.ts:211-216`, rempli par `JeuHandle.monstres()` `jeu.ts:3589-3600`) ; `hud/BandeauEvenement.tsx` ajoute un type de bandeau CLIENT `"police"` (hors protocole :
  `TypeBandeau = TypeEvenement | "police"`, entrée `TEXTES.police` : titre « Descente de police », sous-titre « Elle fonce sur le meilleur » en arène / « Sauvez-vous » en BR, `surMoi` : « La police est à tes trousses ! ») ;
  `HudArene.module.css` : `[data-type="police"]` avec les tokens `--ag-cyan` / `--ag-danger` seulement ; `useArene.ts:405-413` : `case "police"` → annonce du fil (`annoncer`), « X a mis fin à la descente de police » si `raison:"detruite"`.

### 7.2 Son (couche B)

- **La sirène n'entre PAS dans `ECHANTILLONS`** : 118 848 octets dépassent `POIDS_MAX_EFFET` (80 000), son nom n'a pas de ligne dans `generer_sons.sh` (c'est un son ORIGINAL du joueur, pas une génération), et `URLS_ZOMBIES`
  est figé par `sons.test.ts:388-396`. `sons-echantillons.ts` gagne un registre séparé : `SONS_POLICE = { sirene: { url: "/arene/sons/sirene-police.mp3", gain: 0.7, boucleDebutS: 0.05, boucleFinS: 9.58 } }`,
  `URLS_ARENE = [SONS_POLICE.sirene.url]`, `POIDS_MAX_SIRENE = 130_000`. Test dédié dans `sons-echantillons.test.ts` : fichier présent, MP3, poids ≤ `POIDS_MAX_SIRENE`, nom cité dans `public/arene/CREDITS.txt`.
- **Boucle** : `Sons.sirenePolice(position: PositionSon | null, vitesseRadiale?: number): void` appelée À CHAQUE IMAGE (modèle exact de `sons.avion`, `sons.ts:1128-1187`) : voix persistante (source en boucle `loop = true`,
  `loopStart/loopEnd` de `SONS_POLICE` car la queue du fichier est à −48 dB et un raccord brut claquerait (niveaux mesurés par `ffmpeg volumedetect` : sirène soutenue à ≈ −25 dB moyens de 0,05 à 9,6 s, fondu de sortie de 9,6 à ≈ 9,77 s (−33 dB puis −47 dB), −62 dB à la fin, et une attaque de 50 ms au début, crête −8,7 dB, que la boucle saute : `boucleFinS` à 9,58 s, AVANT le fondu, et non à 9,77 s qui bouclerait au milieu du fondu et creuserait un trou audible de 0,15 s à chaque tour ; les décodeurs MP3 ajoutent en outre un décalage d'encodeur au début, d'où ces 50 ms de garde) ; à valider à l'oreille, et si la couture s'entend produire un dérivé `sirene-police-boucle.mp3` par `acrossfade` via `scripts/fps/importer_son.sh`),
  filtre passe-bas → gain → panoramique → master, mis à jour par `setTargetAtTime` (gain `max(0.05, 1 / (1 + d / 70))`, passe-bas `max(900, 5200 / (1 + d / 120))`, panoramique `position.pan`, `playbackRate`
  Doppler `clamp(1 − vr / 343, 0.92, 1.08)` si `playbackRate` existe), audible à ≈ 300 m (comme `klaxonCamion`). `null` éteint via `eteindre(gain, [src], 0.15)`. Ne consomme pas le pool `finsTous`. Repli tant que le buffer n'est pas décodé :
  deux oscillateurs 700 ↔ 1100 Hz à 0,7 Hz (famille de `sireneFrappe`), remplacés à chaud. Code défensif pour les faux AudioContext de `sons.test.ts` / `sons-br.test.ts` : `src.playbackRate?.`, `"loopStart" in src`, jamais `disconnect`.
- **Préchargement** : `Sons.prechargerArene()` (`prete(); telecharger(url)` pour `URLS_ARENE`) appelé par `jeu.ts:306` dans TOUS les modes (arène, BR et zombies, en plus de `prechargerZombies()` en zombies). Sans cela le
  premier passage serait muet (le chargeur ne télécharge rien hors zombies).
- **Arrêts garantis** : position `null` si snap sans police, `enReplay`, mort / killcam, `dispose` de `sons.ts` (`policeVoix.src.stop()`), sortie de `jeu.ts:3640-3645` (`sons.sirenePolice(null)` avant `sons.dispose()`), contexte audio gelé (pause zombies : `ctx.suspend()` gèle aussi la boucle).
- **Annonce sonore** : aucune sirène séparée du bandeau ; `sons.alerte` n'est PAS appelé pour `police`.

### 7.3 Interface des réglages et de la liste (couche C)

- **Composant `app/components/arene/ReglagesArene.tsx`** : `fieldset` / `legend` natifs, une case à cocher par événement (`LIBELLES_EVENEMENTS`, ordre de `EVENEMENTS_ARENE`), une rangée de radios « Fréquence » (Calme /
  Normal / Chaos, avec l'aide « Chaos = rythme d'origine »), boutons « Tout cocher » / « Aucun événement » et « Créer cette arène ». Mémorisé dans `localStorage` `pdj-fps-arene-reglages` (JSON relu par `normaliserReglages`, jamais
  confiance). Styles dans `Arene.module.css` avec les tokens `--ag-*` seulement, cibles tactiles ≥ 40 px. Texte entièrement en français. Rien du panneau n'entre dans le premier chargement du site (Arene est derrière `MyrtilleEasterEgg`).
- **`Arene.tsx`** : le bouton « Créer une arène » de `ListeParties.tsx:54` ouvre le panneau de réglages (un `<details>` « Créer une arène… » sous la liste) au lieu de créer d'un clic ; « Créer cette arène » appelle
  `surCreerPartie(reglages)` ; en tête du panneau, une ligne « Événements : … » (`libelleReglages` des réglages de la partie rejointe, lue dans l'écho `mode` ou dans `salons.listes`). Si le client a demandé des réglages non par
  défaut et que l'écho `mode` n'en porte pas (serveur ancien) : message « Ce serveur n'applique pas encore les réglages d'événements ». `refus{action:"mode", raison:"limite"}` (plafond d'arènes ou
  délai de création de 10 s) : « Plus de place pour une arène de plus, ou création trop rapprochée : rejoignez une arène de la liste ». Les réglages ne se modifient pas après la création (hors périmètre) : le
  panneau le dit (« Les événements d'une arène sont fixés à sa création »). Le choix mémorisé reste proposé à la création suivante.
- **Liste des parties** (`lobby-modele.ts`) : `PartieListee` accepte `reglages?` ; `lignesParties` (arène, `:282-288`) ajoute `evenements: libelleReglages(p.reglages)` à `LigneParties` quand défini ; `ListeParties.tsx` l'affiche en seconde ligne ;
  `listesDepuisSalons` met `reglages` à `undefined`. `ar1` : « Arène principale » + ses réglages par défaut.
- **Plomberie** : `contrats.ts:100` `choisirMode(mode, partie?, reglages?)` ; `useArene.ts:205-214` met `reglages` dans le message (arène + `PARTIE_NOUVELLE` seulement) ; `Agroparc3D.tsx:450-456` `creerPartie("arene", reglages)` passe `areneChoisie.current = true`
  comme aujourd'hui.
- **Lobby BR** (`LobbyBR.tsx`, fieldset « Bots » `:212-244` en modèle) : case « Descente de police » (activée), visible pour l'hôte hors partie en cours, mémorisée `pdj-fps-br-police`, `surLancer(difficulte?, bots?, police?)` ;
  non-hôtes : ligne en lecture seule « Descente de police : activée / désactivée » depuis `EtatPartieBr.police`. `useArene.lancerPartie(difficulte?, bots?, police?)` et `contrats.ts:102` suivent.

---

## 8. Découpage en couches (parallélisables)

| Couche | Contenu | Fichiers principaux |
|---|---|---|
| **A** pur + serveur + protocole + tests | `reglages-arene.ts`, `evenements-arene.ts`, `police.ts`, `police-regles.ts`, `match-police.ts`, protocole (§2), `match-evenements.ts` (types, temps morts, `policeEnCours`), `match.ts` (bus découplé, police, capacités), `match-contexte.ts`, `match-br.ts` (réglage, armement, `aidePolice`), `parties.ts`, `salons.ts`, `index.ts`, `suspension` (rien) | `lib/fps/*`, `serveur-fps/src/index.ts` |
| **B** client rendu + sons | §7.1 rendu / HUD-modèle, §7.2 sons et préchargement, libellés de cause | `jeu-monstres.ts`, `rendu-monstres.ts`, `jeu.ts`, `sons.ts`, `sons-echantillons.ts`, `hud-modele.ts`, `armesInfo.ts` |
| **C** UI | §7.3 réglages, liste, lobby BR, bandeau, fil | `app/components/arene/*`, `Agroparc3D.tsx`, `useArene.ts`, `lobby-modele.ts` |
| **D** zombies | §6 | `patrouille-zombies.ts`, `match-zombies.ts`, `jeu.ts` (`zevt`, `majAmbianceZ`) |
| **E** docs et scripts | `CLAUDE.md` (« Événements de l'arène (v3) », « Mode Battle Royale », « Zombies v8 : sons échantillonnés », arborescence `lib/fps`), `serveur-fps/README.md` (tableau d'env), `public/arene/CREDITS.txt`, `scripts/fps/protocole_parties.mjs`, neutralisation `PDJ_FPS_POLICE=off` des e2e (§4.4), captures | `docs`, `scripts/fps` |

Ordre : A d'abord (contrat), puis B, C et D en parallèle (indépendants une fois le protocole fixé), E en dernier. La couche A est testable seule (`npx vitest run lib/fps`).

## 9. Tests

- **Premier chargement** : `chargement-br.test.ts` (existant) doit rester vert sans changement : `reglages-arene.ts`, `police.ts`, `patrouille-zombies.ts`, `ReglagesArene.tsx` et la sirène ne sont atteints que par
  `Agroparc3D` (`next/dynamic`) et `lib/fps/jeu` (`import()`) ; le MP3 n'est JAMAIS importé, seulement `fetch` à l'entrée dans une partie (118 Ko, après le rendu du menu).
- **Purs** (couche A) : `reglages-arene.test.ts` (liste fermée, absent = tous, `[]` = aucun, doublons, ordre canonique, types douteux, 16 éléments max, `libelleReglages`) ; `evenements-arene.test.ts` (`choisirType` : jamais deux fois de
  suite quand possible, un seul actif, aucun actif ⇒ `null`, graine fixe ; `tempsMort` ; facteurs ; `optionsDepuisReglages` retire les services décochés, ne met jamais à l'échelle un intervalle imposé) ; `police.test.ts`
  (`choisirCibleArene` : leader, égalité, personne à > 0 kill, hystérésis, leader en voiture ou sur un toit remplacé ; `choisirCibleBr` : humain avant bot, plus proche de la voiture, hors zone exclu ; `choisirDepart` : hors vue, ≥ 90 m, replis, `null` ;
  `ecraseParPolice` : vitesse, hauteur, rectangle orienté ; `etatCarrosserie` ; `toucheBoiteOrientee` ; coût de `choisirDepart` ; `copierCarteNavigation` identique à un calcul à froid) ; `match-police.test.ts` (contexte factice : armement, grâce après entrée, `debut`, poursuite, écrasement sans kill, protection d'apparition,
  marche arrière, retrait, destruction par tirs, rejeu de latence (tir sur la position d'il y a 200 ms touche, 700 ms non), exclusivité avec un Truck fou, joueur sans capacité immunisé même arrivé en cours de descente,
  cible inaccessible écartée, rien hors `enPhaseJeu`, `terminer` / `demarrerMatch` arrêtent la voiture, passage de 1 à 2 joueurs ⇒ minuteur repoussé de `premier`, attente d'un premier kill puis repli, `reinitialiser`) ; `patrouille-zombies.test.ts`.
- **Intégration** : `match.police-arene.test.ts` (cases décochées ⇒ service absent ; bus décoché ⇒ frappes et fumigènes encore dans le snap ; `demarrerMatch` garde la cadence) ; `match.police-br.test.ts` (jamais en vol, jamais avant 60 s après le premier atterrissage humain, jamais
  avec < 4 vivants, une seule, deux avec ≥ 20 joueurs, mort sans kill et killcam sans tueur, bots, joueur dans un bâtiment creux écarté, jamais avec un point de départ hors zone, `retourLobby` arrête la voiture) ; `match.zombies-patrouille.test.ts` (manche ≥ 3, jamais en manche du Truck, jamais en suspension, 2 au plus) ; `match-evenements.test.ts` et
  `match.cohabitation.test.ts` (types actifs, temps morts, `policeEnCours`) ; `parties.test.ts` / `salons.test.ts` / `match.parties.test.ts` (config portée par la partie, `accepteVide` : une arène vide n'est reprise qu'avec des réglages égaux, `ar1` jamais réutilisée avec des réglages non par défaut) ;
  séquence de hasard inchangée pour une salle sans réglages (`match-evenements.test.ts` existant vert tel quel, `match.zombies*.test.ts` vert tel quel) ;
  `protocole.test.ts` (nouvelle cause, `CIBLE_POLICE`, version inchangée) ; `jeu-monstres.test.ts` ; `sons.test.ts` (boucle démarrée une fois, suivie, éteinte, repli, `dispose`) ; `sons-echantillons.test.ts` ; `lobby-parties.test.ts` / `arene-lobby.test.ts` ;
  `suspension.horloge.test.ts` (inchangé, doit passer) ; `match.charge*.test.ts` et `serveur.charge-agregee` (à lancer SEULS).
- **Protocole sans navigateur** : étendre `scripts/fps/protocole_parties.mjs` : création d'une arène avec `reglages{evenements:["elsa"], frequence:"calme"}` ⇒ écho et `listes` portent les réglages, `ar1` n'est pas écrasée, joueur sans capacité ⇒ aucune
  `police` même avec `PDJ_FPS_POLICE_MIN_MS=2000`, joueur avec capacité ⇒ `police{debut}` puis `monstres.police` dans les snaps puis `police{fin}` ; BR : `lancerPartie{police:false}` ⇒ rien, `{police:true}` avec `PDJ_FPS_BR_POLICE_MS` court ⇒ une descente.
- **Captures** : `scripts/fps/captures_police.mjs` (un navigateur, police forcée par env, voiture vue de loin / de près / explosée, bandeau) dans `docs/medias/police/`.

## 10. Risques et pièges

1. `tuer` ignore `protegeJusqua` et le vol BR : le filtre est dans le service (§4.2), testé.
2. `enPhaseJeu()` vaut vrai en BR en permanence : la police BR ne s'appuie que sur `aide.phase()`.
3. Grille de navigation à froid (40–430 ms) : le cache est PAR MONDE, un échauffement du monde de référence ne sert à rien ; calcul avant `listen` puis COPIE dans chaque monde neuf (`copierCarteNavigation`, §3.2), jamais pendant un tic.
4. Tout fichier `lib/fps/*.ts` hors `jeu|rendu|sons|reseau|voix-rtc` est scanné par `suspension.horloge.test.ts` : `police*.ts`, `match-police.ts`, `reglages-arene.ts`, `evenements-arene.ts`,
   `patrouille-zombies.ts` sont sans horloge ni `Math.random`.
5. `serveur-fps/dist/index.js` est un artefact : reconstruire avant déploiement (`npm run build` dans `serveur-fps/`).
6. `MondeMonstres.a()` ne recopie que les clés connues : oublier `police` rend la voiture invisible.
7. Les e2e qui ne neutralisent pas la police (ou la patrouille des zombies) verront une voiture inattendue : mise à jour des scripts listés au §4.4 (dix, zombies compris).
8. `PARTIE_AUTO` peut envoyer un nouvel arrivant dans une arène personnalisée : voulu, c'est la plus peuplée ; l'en-tête du panneau et la liste affichent ses événements.
9. Désactiver `avion` supprime aussi le sort d'invocation (G) ; décocher `tigre` supprime le titan : indiqué dans les libellés.
10. La couture de la boucle de sirène dépend du fichier : à valider à l'oreille (§7.2), points de boucle choisis d'après les niveaux mesurés.
11. Le plafond d'arènes (2) limite à UNE arène personnalisée tant que `ar1` existe : voulu (charge d'un vCPU), signalé par le message de limite du lobby.
12. Un client v11 en cache est invisible pour la police (jamais écrasé, jamais cible) : les rares descentes d'une arène où il n'y a que de tels clients n'ont pas lieu.
13. Un joueur du BR qui reste dans un bâtiment creux n'est pas joignable par une voiture : la descente vise un joueur dehors, ou n'a pas lieu (§4.1, « Inaccessible »).
14. Les `kills` de l'arène sont ceux du match en cours : la descente attend un premier kill (60 s au plus) pour viser « le meilleur » (§4.1).

---

## 11. Revue de la spec

Revue adverse de la première rédaction contre le code (`match.ts`, `match-evenements.ts`, `match-br.ts`, `navigation.ts`, `nav-bots.ts`, `salons.ts`, `parties.ts`, `index.ts`, `jeu.ts`, `sons-echantillons.ts`, le MP3 mesuré avec
`ffmpeg`). Problèmes réels trouvés et corrigés ci-dessus :

1. **Navigation de la voiture (§3.2, §4.4)** : le cache de `carteNavigation` est un `WeakMap` par monde ; « échauffer le monde de référence » ne servait à aucune arène neuve (première grille à froid de 40 à 430 ms en
   plein tic au premier Truck fou ou à la première police). Ajout de `copierCarteNavigation` (précalcul avant `listen`, copie dans chaque monde d'arène ET de BR).
2. **BR : mauvaise grille (§4.4)** : la spec renvoyait vers la grille des bots (cases de 1,5 m, dégagement 0,8 m), trop étroite pour une caisse de 4,4 × 1,9 m (portes, passages). Le BR utilise la grille de dégagement 1,8 m comme
   l'arène ; A* borné (`noeudsMax`) sous le `BudgetNavigation` unique du serveur, retour `"attente"` distinct de `null` (§4.2).
3. **Cible inaccessible (§4.1)** : un joueur du BR dans un bâtiment creux (la majorité des joueurs pendant la fouille) clouait la voiture contre un mur 22 s. Règle « inaccessible » : cible sans chemin écartée 10 s,
   retrait si plus personne ; `permis` exige un humain joignable.
4. **Validation des tirs sur la voiture (§4.2)** : 0,3 m de marge sans historique rejetait presque tous les tirs à 24 m/s (2,4 m parcourus en 100 ms ; le tigre géant, huit fois plus lent, tolère déjà 1,6 m).
   Historique de poses, rejeu sur `fenetreMs` (`rewindMaxMs` de la salle, 300 ms arène / `BR.rewindMaxMs`), marge 0,8 m, signature `toucher(o, d, portee, t, fenetreMs)` rendant la distance.
5. **Tirs côté client oubliés (§7.1)** : rien ne faisait déclarer `CIBLE_POLICE` au client. Ajout du test de touche local (`toucheBoiteOrientee` pur, partagé), du retour `degats`, de la touche sans giclée de sang.
6. **Phases du match (§4.2)** : la police ne s'arrêtait ni ne s'interrompait à l'entracte (écrasement sur le podium). `tic` inactif hors `enPhaseJeu`, `terminer` et `demarrerMatch` appellent `reinitialiser`,
   60 s de calme au début d'un match.
7. **Rareté non garantie (§1.3, §4.2)** : le « repousser à `maintenant + 45 s` à chaque tic » faisait tomber la voiture 45 s après l'arrivée du 2e joueur dans `ar1` vide depuis des heures (minuteur échu), et à chaque
   remplissage. Remplacé par : à chaque passage à 2 joueurs capables, `t = max(t, maintenant + délai(premier))`.
8. **« Le plus de kills » vide de sens au début (§4.1)** : les kills repartent à 0 à chaque match ; `permis` attend un premier kill, 60 s au plus (`attendreLeaderMs`), puis se rabat sur le plus proche.
9. **Capacités et arrivée en cours de descente (§1.5)** : la capacité n'était vérifiée qu'au départ ; un client v11 en cache entrant pendant la poursuite se faisait tuer par une voiture invisible. Les joueurs sans la
   capacité sont maintenant immunisés et non ciblables ; `bonjour` lu avant `reprendre`. Plus de veto global (un seul vieux client ne bloque plus la police pour tous).
10. **Départ « de nulle part » trop cher (§4.1)** : visibilité de chaque point de route contre chaque joueur dans un seul tic (centaines de points × jusqu'à 50 joueurs). Filtre de distance d'abord, `vu` limité à 24 candidats ;
    BR : départ jamais abandonné (réessai borné) et sans effet sur le quota `max`.
11. **BR, armement circulaire (§5.1)** : `premierAtterrissageT` n'existe pas dans `match-br.ts` et n'est connu qu'après `passerEnJeu` qui devait justement armer avec lui. Armement à `passerEnJeu` (90 à 240 s) +
    condition dynamique `t ≥ premierAtterrissageT + 60 s` ; état à ajouter côté service BR.
12. **Réutilisation d'arène vide (§1.4, §3.2)** : `reutiliserVide: boolean` ne couvrait que `ar1`. Prédicat `accepteVide` (réglages égaux) : une arène personnalisée vide pas encore refermée n'est plus reprise avec d'autres
    réglages. Message de limite explicite côté lobby (une seule arène personnalisée à la fois, plafond de 2).
13. **Séquence de hasard des salles existantes (§3.1, §3.2, §6)** : `choisirType` doit reproduire exactement les tirages de la v3 (un tirage au premier événement, alternance sans tirage), `tempsMortP` absent ⇒ aucun
    tirage, la police est construite en dernier, la patrouille des zombies a son générateur propre : sinon les tests à `alea` figé (`match-evenements`, `match.zombies*`) changent.
14. **Annonce d'événement retenue (§3.2)** : le type tiré doit être mémorisé pendant que `policeEnCours` retarde l'annonce (comme `tigrePermis`), sinon l'alternance est faussée ; équité police / événements décrite.
15. **Feu et fumée en arène (§7.1)** : un second `feux.maj` par image doublait l'avance des particules ; la voiture abîmée alimente le `sourcesFeux` existant de `majMondeDynamique`, et seul le BR appelle `feux.maj` /
    `tracesPneus.maj` depuis `majMonstres`. Le modèle 3D n'est construit qu'à la première descente.
16. **Boucle de la sirène (§7.2)** : mesures `volumedetect` du MP3 : soutenue à ≈ −25 dB jusqu'à 9,6 s, fondu de sortie de 9,6 à 9,77 s, attaque de 50 ms au début. `boucleFinS` ramené de 9,77 à 9,58 s (9,77 bouclait au
    milieu du fondu : trou audible à chaque tour).
17. **`aPied` (§4.1)** : le service ne voit pas `vehicules` ; `Salle` injecte la même fonction `aPied` que pour Elsa et les tigres.
18. **Zombies et scripts déterministes (§4.4, §6)** : `e2e_zombies.mjs`, `captures_zombies.mjs`, `protocole_parties.mjs` neutralisent la patrouille (manche 3) et la police ; patrouille échue pendant une pause repoussée à la
    manche suivante.
19. **Divers** : `PDJ_FPS_EVT_ACTIFS` vide = aucun événement ; libellé « Couteau » d'un client ancien pour la cause `police` documenté ; `chargement-br.test.ts` (existant) ajouté aux tests comme garde du premier chargement ;
    tests ajoutés pour chaque point ci-dessus (§9).

Points examinés et conformes au code, laissés tels quels : cohabitation avion / tigre géant (`tigrePermis`), bus C3 découplé de `modeArene`, budget du snap (une clé `monstres.police` seulement pendant une descente), horloge
virtuelle (aucune suspension en arène et BR, la patrouille des zombies lit `maintenantServeur` figé en pause), routage v8 à v10 vers les parties permanentes, `tuer` sans tueur (killcam déjà gérée pour le Truck fou), BR sans
véhicules (la voiture n'est pas un véhicule de `vehicules`), `VERSION_PROTOCOLE` inchangé grâce aux capacités, spectateurs (la voiture et la sirène ne les concernent que s'ils sont « en jeu »).
