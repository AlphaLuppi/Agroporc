# Arène FPS : pause des zombies, parties parallèles, bots du Battle Royale — design

Date : 2026-10-29 · Protocole : **`VERSION_PROTOCOLE = 11`** (`VERSIONS_ACCEPTEES = [8, 9, 10, 11]`, `VERSION_MIN_ZOMBIES = 11` ; les deux constantes ne passent à 11
qu'au **lot 2**, cf. §2) · Prime sur
`2026-10-29-br-voix-parties-design.md` (parties BR), `2026-10-29-zombies-retours-design.md` et `2026-10-28-battle-royale-design.md` là où ils divergent.

## Statut

Spec de conception, **rien n'est implémenté**. Elle doit suffire à des agents qui n'ont aucun autre contexte que `CLAUDE.md` (sections « Arène
FPS », « Mode zombies », « Mode Battle Royale ») et ce document. Les références `fichier:ligne` sont celles du dépôt au 2026-10-29 (branche
`claude/zombies-pause-parties-bots-br`) : relire le code avant de s'y fier à la ligne près. Ordre de fusion avec la spec voisine non commitée
`2026-10-29-apercus-modes-design.md` (message `apercu`) : cette spec-ci est fusionnée AVANT ; l'aperçu lit alors la partie PERMANENTE de chaque
mode (`ar1`, `z1`, `br1`) et la spec des aperçus doit être réconciliée (elle suppose une seule salle de zombies et dit `ChoixMode` / `lobby-modele`
« inchangés » alors que le lot 5 les réécrit). Voir « Révisions » en fin de document.

## Demande

1. **Pause en zombies** : n'importe quel joueur de la partie peut la mettre en pause, même à plusieurs ; une pause fige TOUT pour tout le monde
   (tigres, minuteurs, manche, cuisson du Micro-ondes, bonus, grenades, cadran du secret…) ; n'importe qui peut reprendre.
2. **Parties parallèles** : deux groupes de joueurs peuvent lancer chacun leur partie de zombies en même temps sans partager la même partie.
   Pareil pour l'arène et pour le Battle Royale (qui a déjà des parties multiples).
3. **Battle Royale solo avec bots** : on peut lancer seul pour s'entraîner ; les bots sont des **tigres qui marchent debout (bipèdes) et tiennent
   des armes** pour essayer de tuer le joueur.

## Périmètre

Dans : serveur (`serveur-fps/`, `lib/fps/`), client (`lib/fps/`, `app/components/arene/`), protocole v11, tests, e2e, documentation.
Hors : bots en arène ou en zombies, bots qui conduisent / wall-run / parkour / ramassent sur les toits, pause en arène ou en BR, accroupi des
bots, vote de pause, sauvegarde d'une partie en pause au-delà de la déconnexion de tous ses joueurs, matchmaking par niveau.

---

## 1. Décisions

### 1.1 Pause : horloge virtuelle appliquée à l'entrée de `Salle` (« stratégie B »)

- **Choix** : `Salle` possède une horloge virtuelle `tJeu = reel − decalagePauseMs`. Les cinq points d'entrée de `Salle` (`connecter`,
  `deconnecter`, `reprendre`, `recevoir`, `tic`) convertissent l'horloge réelle que leur passe `serveur-fps/src/index.ts` en horloge
  virtuelle AVANT de la transmettre à quoi que ce soit. Pendant la suspension, l'horloge virtuelle vaut une constante `V`, `Salle.tic` ne
  tique AUCUN service et les entrées de jeu sont jetées.
- **Pourquoi** : tout le code serveur du jeu reçoit l'horloge en paramètre (`maintenant`) ; je n'ai trouvé aucun `Date.now()` ni `Math.random`
  dans le code serveur de `lib/fps/` (seulement dans `serveur-fps/src/index.ts`) ; `Math.random` n'apparaît que comme VALEUR PAR DÉFAUT d'un paramètre `alea`
(`zombies-secret.ts:289`, `bus-c3.ts:94` et `183`, `frappe-aerienne.ts:70`), jamais appelé tant que `Salle` injecte `this.alea` (c'est le cas de
`match.ts:328`, `754` et de `match-zombies.ts:192`). Figer l'entrée gèle d'un coup la centaine d'horloges
  de `match-zombies.ts`, `zombies.ts`, `zombies-secret.ts`, `effets-armes.ts`, `grenades.ts` et les champs de `Salle` (`protegeJusqua`,
  `histo`, budget de distance, `prochainSnap`…), sans qu'aucun de ces fichiers change.
- **Rejeté (« stratégie A »)** : ne plus appeler le service et décaler à la reprise tous les `finT` : une centaine de champs, dont ceux déjà
  envoyés aux clients (`finT`, `terreFinT`, boîte, effets) et les trajectoires de grenades / projectiles que le client calcule depuis `t0` /
  `explosionT` ; un oubli donne un bug silencieux (un bonus qui expire pendant la pause, un tigre qui griffe dès la reprise).
- **Garde** : un test (`suspension.horloge.test.ts`) lit le source de TOUS les `lib/fps/*.ts` non client (liste blanche d'exclusion explicite : `jeu*`, `rendu*`,
  `sons*`, `reseau*`, `voix-rtc*`, `*.test.ts`, plus `lib/fps/hud/**`) et vérifie qu'aucun ne contient `Date.now(`, `performance.now(`, `new Date(`, `setTimeout(`,
  `setInterval(` ; `Math.random` n'est toléré que dans la liste blanche `{zombies-secret.ts, bus-c3.ts, frappe-aerienne.ts}` en valeur par défaut d'un paramètre
  `alea`. Un second test vérifie que `Salle` injecte `this.alea` à ces trois appels. C'est l'hypothèse de toute la stratégie.
- **Nommage** : `PhaseZombies "pause"` (protocole.ts:188) désigne déjà la pause ENTRE deux manches, et `HudArene.tsx:199` a une variable `pause`
  pour le menu Échap. Dans le code la pause demandée par un joueur s'appelle **suspension** (`Suspension`, `suspendue`, message `pauseZ`,
  `zpause`). Le texte affiché dit « Pause ». **Deux collisions de vocabulaire levées** : (1) `serveur-fps/src/index.ts` a `interface Suspens` / `enSuspens`
  (sessions RÉSEAU coupées, gardées `REPRISE_MS`) : le lot 1 les renomme `SessionCoupee` / `coupees` dans le code (la clé JSON `/sante.zombies.enSuspens` reste, pour
  les sondes existantes) ; (2) « reprise » désigne déjà `bonjour.reprise{id, jeton}`, `bienvenue.reprise`, `Salle.reprendre` et `REPRISE_MS` (réseau) : le compte
  à rebours qui précède la fin d'une suspension s'appelle donc **compte à rebours** (`compteMs`, `PDJ_FPS_ZOMBIES_COMPTE_MS`, `zpause.compte`) et la fin d'une suspension
  une **levée** (`demanderLevee`, `lever`), jamais « reprise » dans les noms de code.
- **Qui peut** : tout membre ADMIS de la partie de zombies (debout, à terre, éliminé en attente de relève ; pas un `attente` arrivé en cours de
  manche), partie `enCours()` (phase `pause` ou `manche`). **Pas pendant le décompte de lancement ni tant qu'un admis n'a pas fini de charger** (`enJeu`, comme
  `attenteChargementMaxMs`, `match-zombies.ts:987`) : le client n'a alors pas encore de jeu pour appliquer le gel (cf. « Client », `zpause` mémorisé) et le budget de distance
  serait faussé ; `refus{action:"pause", raison:"lobby"}` dans ce cas. Refus en `lobby` / `fin`
  (`refus{action:"pause", raison:"lobby"}`), non admis (`raison:"inconnu"`).
- **Levée** : n'importe quel membre admis. Si plus d'un admis, **compte à rebours** `compteMs` (3 000 par défaut) pendant lequel
  le jeu reste figé (les joueurs reprennent la souris) ; si le demandeur est le seul admis (décidé par le SERVEUR : `admisCount`, un `attente` n'est pas admis ; un joueur à terre
  ou éliminé en attente de relève compte comme admis), levée immédiate. Un `pauseZ{actif:true}` pendant le compte à rebours l'annule (retour à la suspension pleine) :
  **annulable une seule fois par suspension**, et le cooldown du joueur s'applique à cette annulation (sinon deux joueurs pourraient alterner indéfiniment et geler les autres).
- **Abus** (valables SEULEMENT quand plusieurs humains sont admis ; **un joueur seul admis en est exempt** : ni `cooldownMs`, ni `totalMs`, ni `maxMs`, car il n'y a personne
  à protéger et un refus laisserait le menu ouvert sur un jeu qui tourne) : 10 s de délai entre deux suspensions d'un même joueur (`cooldownMs`), 5 min au plus par suspension
  (`maxMs`, levée automatique avec compte à rebours non annulable), **15 min cumulées par partie** (`totalMs`, appliqué aussi à la suspension en cours : au-delà, levée forcée
  non annulable ; puis `refus{action:"pause", raison:"limite"}`). Le budget `totalMs` est **remis à zéro à chaque lancement de partie et dans `retourLobby`**
  (`susp.reinitialiserPartie()` : `z1` sert à des parties successives) ; seul le décalage d'horloge survit. Le client affiche le refus (« Pause indisponible : limite atteinte »).
  Le jeton de reprise réseau (`REPRISE_MS` = 20 s, `index.ts`) tourne en temps RÉEL pour une salle non suspendue ; **tant qu'une salle est suspendue, l'échéance de
  reprise réseau de ses membres est portée à 60 s** (`REPRISE_SUSPENDUE_MS`) : sinon une connexion qui tombe 25 s pendant une pause serait retirée alors que le jeu est figé.
- **Fin de partie pendant la pause** : la suspension est levée d'office dès que `!zombies.enCours()` (un départ qui déclenche `liberer` /
  `verifierDefaite` / `retourLobby`), sinon le bilan et le retour au lobby, déclenchés par `tic`, ne partiraient plus.
- **Le joueur qui a suspendu part** : la suspension reste (`pseudo` gardé), n'importe qui lève.
- **Solo** : si le joueur est le seul admis, ouvrir le menu pause (perte du pointer lock) suspend la partie automatiquement ; « Reprendre »
  lève (pas de compte à rebours), exempté de toute limite (cf. « Abus »). Le déclencheur automatique **exclut** le premier verrouillage du pointeur (`premiereFois`,
  `HudArene.tsx:200`), le lobby, la fin de partie, la killcam, et tout état sans partie `enCours()` ; la décision « seul » est celle du serveur (le client envoie
  `pauseZ{actif:true}`, le serveur refuse `refus{pause, raison:"plusieurs"}` s'ils sont plusieurs, et le client n'affiche alors que le menu habituel). À plusieurs,
  Échap ne suspend PAS (un alt-tab ou un clic perdu gèlerait les autres) : un bouton « Mettre la partie en pause pour tous » et la touche P (action `pauseZ`) font la demande.

### 1.2 Parties parallèles : un registre de parties par mode, trois modes

- **Modèle** : le serveur tient un **registre** `RegistreParties<Salle>` (module PUR générique `lib/fps/parties.ts`, testable avec de fausses
  salles) : liste ordonnée de `Partie { id, mode, salle, permanente }`. Il remplace `salleArene`, `salleZombies` et `partiesBr[]` de `index.ts`.
- **Ids** : `ar1`, `ar2`… (arène), `z1`, `z2`… (zombies), `br1`, `br2`… (BR). Compteur par mode, croissant, jamais réutilisé. Les ids `br<N>`
  gardent leur forme actuelle (les scripts `protocole_br_parties.mjs` et `e2e_br.mjs` en dépendent). Les ids de PARTIES (`z1`) ne sont pas des ids
  de JOUEURS (`j<n>`) ni de tigres (`t<n>`, `z<n>` : sans conflit, ce sont deux espaces de noms distincts, mais ne jamais mélanger dans le code
  que lit un id à l'aveugle : les parties n'apparaissent que dans `mode.partie`, `salons.listes`, `/sante`).
- **Permanentes** : `ar1` (le hall d'arrivée : tout nouveau client est placé dans `ar1`, la présence du Palantir y vit, et l'arène tique toujours
  même vide comme aujourd'hui : Elsa, bus C3 ; **c'est un hall de spectateurs, pas une arène de plus : le choix d'une arène se fait sur `enJeu`, jamais sur `joueurs`**), `z1` et `br1` (déjà permanentes : leurs anciens champs `salons.zombies` / `salons.br` et `/sante`
  restent valables pour les clients d'avant). Toutes les autres parties sont **créées à la demande** et **refermées dès qu'elles n'ont plus aucun
  membre humain** (vérifié après chaque `mode`, à chaque déconnexion et une fois par seconde par le timer `salons`).
- **Plafonds** (variables d'environnement, lues par `index.ts`) : `PDJ_FPS_ARENE_PARTIES` (2), `PDJ_FPS_ZOMBIES_PARTIES` (3),
  `PDJ_FPS_BR_PARTIES` (4, existant), `PDJ_FPS_PARTIES_TOTAL` (6 tant que la charge agrégée n'est pas mesurée sur le VPS, 8 ensuite ; toutes salles confondues, permanentes comprises : chaque salle vivante coûte un monde mutable en
  mémoire et un tic, sur un conteneur à 1 vCPU / 512 Mo). **Une création par mode reste toujours possible** tant que le mode est sous son propre plafond (réserve d'un
  emplacement par mode : 4 parties BR avec bots ne peuvent pas affamer les zombies ; le total n'est dépassé que de cette réserve, soit 3 au plus). Créer au-delà →
  `refus{action:"mode", raison:"limite"}`.
  **Limites de création (anti-gel du tic)** : construire un monde coûte 17–90 ms et la première `grilleNav` ≈ 430 ms ; un client qui alterne créer/quitter gèlerait toutes les
  parties. (a) 10 s au moins entre deux `partie:"nouvelle"` d'un même client (`refus{limite}`) ; (b) au plus UNE partie non permanente créée par IP à la fois ; (c) création refusée
  (`refus{limite}`) si `ticMaxMs` récent (fenêtre de 10 s) dépasse `PDJ_FPS_CREATION_TIC_MAX_MS` (12 ms par défaut) ; (d) **précalcul au démarrage, avant `listen`** : un monde
  de référence par mode et la `grilleNav` BR (tableaux `libre` ET `etats`, cf. §1.4) sont construits une fois puis copiés (`.slice()`) dans chaque nouvelle salle ; (e) une partie
  vide fermée n'est pas recyclée (pas de pool) : reconstruire est acceptable une fois (a), (b) et (d) en place.
- **Chaque partie a son monde** : `construireMonde(scene)` (arène), `construireMondeZombies(scene)` (≈ 17–40 ms de navigation), `construireMondeBr(scene)`
  (≈ 90 ms, 2 Mo). Les mondes sont mutables (brèches, portes achetées) et la navigation est mise en cache PAR `Monde` (`WeakMap`,
  `navigation.ts:17`) : on ne partage JAMAIS un `Monde`. Restent partagés en lecture seule : `scene`, `circuits`, `flotte(circuits)`,
  `cachettes`, `donneesZombies(scene)` (le service n'en lit que `departs`), `persistanceBr`.
- **Routage** (PUR, `lib/fps/salons.ts`, `decisionPartie`) : `mode{mode, partie?}` pour les trois modes.
  - `partie` nommée et existante, du bon mode : on y va (`changer`) ; déjà dedans : écho ; client en jeu : `refus{lobby}` ; pleine : `refus{plein}`.
  - `partie: "nouvelle"` (`PARTIE_NOUVELLE`) : refus si en jeu ; sinon reprend d'abord une partie vide du mode qui accueille (hors la sienne), sinon
    crée si le registre le permet, sinon `refus{limite}`.
  - `partie` absente : client déjà dans une partie de ce mode → écho avec sa partie ; sinon `choisirPartie(mode, parties)` :
    **arène** : la partie qui accueille (`enJeu` + réservations < `JEU.joueursMax` = 16) avec le plus de joueurs EN JEU ; `PartieRoutage` porte donc `enJeu` (arène) en plus de `joueurs` ;
    si toutes sont pleines, en crée une (si possible). **L'arène n'a ni lobby ni « lancer », donc tout nouveau client atterrit dans `ar1` (hall) : le débordement ne se déclenche
    pas à l'arrivée mais à l'action `rejoindre`** : le client envoie `mode{arene, partie:"auto"}` (`PARTIE_AUTO`) avant `rejoindre` (le lobby d'arène le fait), et le serveur répond
    `mode{partie}` avec la partie choisie par `choisirPartie` (la plus peuplée qui accueille, sinon création) ; un `rejoindre` qui échoue `plein` renvoie au client
    `refus{rejoindre, plein, alternative: "<id>"}` et le lobby propose « Changer d'arène ». Les places choisies mais pas encore occupées sont comptées comme **réservations** pendant
    5 s (`accueille` ne se base pas seulement sur `enJeu`, sinon course à 15/16). Un bouton « Créer une arène » est ajouté au lobby d'arène (lot 5). **Zombies** : le lobby le plus peuplé (tout le monde se retrouve) ; sinon, si création possible, une NOUVELLE partie
    (un arrivant ne tombe pas par défaut dans la partie en cours de quelqu'un d'autre : « Rejoindre » dans la liste reste possible) ; sinon la
    première avec de la place. **BR** : inchangé (lobby le plus peuplé, sinon première avec de la place : on peut la regarder ou créer la sienne).
  - `accueille` d'une partie (PUR, `accueillante`) : zombies et BR = phase `lobby` ; arène = `enJeu + réservations < JEU.joueursMax`. Une partie NOMMÉE (clic sur « Rejoindre » dans la liste)
    contourne `accueille` en zombies / BR : « Rejoindre » une partie de zombies en cours est permis (arrivée en `attente`, entre à la pause suivante) ; seul le routage PAR DÉFAUT se limite aux lobbies.
  - `ResumePartie.capacite` : arène = 16 (`JEU.joueursMax`, joueurs en jeu), pas `connexionsMax` (64).
  - **Anciens clients (`version < 11`)** : routés TOUJOURS vers la partie permanente du mode (`ar1`, `z1`, `br1`), jamais vers `ar2`… où ils ne retrouveraient pas leurs amis et n'ont pas d'UI
    pour changer ; `z1` leur reste fermé (`VERSION_MIN_ZOMBIES`), `salons.parties` ne contient que du BR.
- **Reprise réseau des zombies qui retrouve SA partie** : `Suspens` stocke déjà la `salle` (`index.ts:284-285`) ; `fermer` et `reprendre`
  testent aujourd'hui `=== salleZombies` (`index.ts:300-302`, `332`) : remplacer par « la salle du client est en mode zombies »
  (`Salle.mode() === "zombies"`) et, à la reprise, par « la salle d'origine est encore dans le registre » ; sinon (partie refermée, ou client qui revient après avoir changé de salle)
  le client est rerouté comme un arrivant (jamais l'état d'une autre partie). `garderPourReprise({salleZombies})`
  devient `{estZombies}`. Une partie dont des membres sont en suspens n'est pas vide (`nombreJoueurs()` compte la `table`) donc n'est pas
  refermée ; quand `REPRISE_MS` expire et que personne n'est revenu, le timer la referme. Côté client, `connexionPerdue` mémorise aussi
  `partieVoulue` : si la reprise échoue (jeton expiré, partie refermée), il renvoie `mode{modeVoulu, partie: partieVoulue}` ; une partie disparue
  tombe dans le routage par défaut du mode (pas une erreur).
- **Tic** : boucle sur toutes les parties ; une partie est tiquée si c'est `ar1`, ou si elle a au moins un membre humain. La phase de snap de chaque salle est décalée (`prochainSnap`
  initial réparti sur la période) pour ne pas empiler les envois. `ticMaxMs` / `ticsLents` de `/sante` restent globaux (somme des salles) ; ajouter le nombre de salles tiquées.
  **Critères humains seuls** : tout ce que `index.ts` fait avec `nombreJoueurs()` ou `resumeBr().joueurs` bascule sur le registre et sur `nombreHumains()` : `attendDansLobbyBr`
  (`index.ts:585-589`, devient `attendDansLobby` pour tout lobby), `SPECTATEUR_INACTIF_MS` (15 min, un membre de lobby qui attend l'hôte n'est pas recyclé), `resumePartie`,
  `ouvrirPartieBr` (devient `ouvrirPartie`), `refermerPartiesVides`, `salons()`, `SALLES()`.
- **`/sante`** : champs plats historiques inchangés (`joueurs`, `enJeu`, `match` = `ar1`, `zombies{}` = `z1`, `br{}` = `br1`) + `parties: [{id, mode,
  permanente, joueurs, humains, bots, phase, suspendue?}]` (`suspendue` = pause de joueur ; `zombies.enSuspens` = sessions réseau coupées : deux notions distinctes, documentées dans le README).
- **Compatibilité** : `salons.parties` reste le tableau des parties BR (les clients v10 l'interprètent comme tel : ne JAMAIS y mettre d'autres
  modes). Les clients v11 lisent le nouveau champ `salons.listes` (§2). `salons.arene` / `.zombies` / `.br` = résumés des parties permanentes.

### 1.3 Bots du BR : de vrais joueurs de la table, reconnaissables à leur id

- **Représentation** : un bot est un **vrai `JoueurSalle`** de `Salle.table` avec `bot: true`. Tout le reste du jeu part de `table` (snap
  `match.ts:1623`, `infliger` 363, `mourirBr` 462, `infoTueur` 497, butin à la mort, journal des événements, rejeu de latence `histo`,
  killcam, spectateur, tableau des scores) et fonctionne sans code dupliqué. Un modèle à part (comme les tigres largués `t<n>`) obligerait à refaire
  le snap, le kill crédité, le butin, la killcam. Rejeté.
- **Construction** : `Salle.connecter` fabrique le `JoueurSalle` en littéral ET remplit `this.suivi` (`match.ts:662`) ; `recevoirEtat` fait `this.suivi.get(j.id)!` (`match.ts:1043`).
  Un bot absent de `suivi` lèverait un `TypeError` dans `Salle.tic`. Le lot 3 extrait donc une fabrique privée `nouveauJoueur(id, pseudo, maintenant)` (joueur + `suivi`) réutilisée par
  `connecter` et `ajouterBot` ; `retirerBot` fait le même nettoyage que `deconnecter` (`table`, `suivi`, `mortT`, `histo`) sans la partie réseau.
- **Id** : `b<n>` en **décimal** (`^b\d+$`, jamais en base 36 : `b` + `r1` = « br1 » entrerait en collision avec un id de partie BR), compteur PAR SALLE remis à zéro à chaque partie
  (`ContexteSalle.nouvelIdBot()`), disjoint de `j<n>` / `t<n>` / `z<n>` (règle des ids disjoints, protocole.ts:186). `estIdBot(id)` dans `protocole.ts`. Le client reconnaît un bot par son id sans attendre la présence ; `JoueurPublic.bot?: true`
  (présence) et `LigneBilanBr.bot?: true` portent le drapeau pour les listes. Pas de champ de plus dans le snap (+0 octet). **Exclusions** : `ciblesVoixBr` (`voix.ts:136`) et
  `LiensVoixKillcam` (`voix.ts:63`) ignorent `estIdBot` (sinon, dans une partie à 2 humains et 11 bots, les 8 voisins vocaux sont des bots sans micro et le client tente des offres WebRTC
  vers `b<n>` pendant 12 s) ; `infoTueur` (`match.ts:497`) ne cherche pas les statistiques d'un bot (`cleStats(pseudo)` d'un bot pourrait égaler celle d'un humain homonyme) ; les noms de bots
  sont suffixés « [BOT] » à l'affichage côté client (jamais dans `pseudo`, qui sert de clé).
- **Pas de réseau simulé** : `diffuser` (`index.ts`) ignore les adresses qui ne sont pas dans `clients` : les sorties adressées à un bot (`soin`,
  `equipement`, `inventaire`, `ramasse`…) tombent sans erreur. Un bot n'a ni socket, ni reprise, ni voix, ni ping (0).
- **Même voie de validation** : le cerveau produit des `MessageClient` (`etat`, `main`, `tir`, `coup`, `sauter`, `chute`, `ramasser`, `utiliser`)
  et les passe à `Salle.recevoir(bot.id, msg, t)`. Cadence (`cadenceOk`), dégainage, œil et direction (`validerVisee`), gerbe du pompe,
  `toucheVraisemblable`, rejeu de latence, dégâts, mort, +50 PV, butin lâché : inchangés. Aucun contournement (écrire `j.p`, appeler `infliger`) :
  on perdrait `tir{ts,o,d}`, le journal de la killcam, `histo` et les compteurs.
- **Nombre choisi au lobby par l'hôte** : `lancerPartie{bots?: number, difficulte?: Difficulte}` (la difficulté existe déjà pour les zombies ; en BR
  elle règle les bots : Entrée = débutants, Plat du jour = normal, Goulaf = redoutables). `bots` doit être un **entier** (`Number.isInteger`, sinon traité comme absent) borné par
  `min(BR.botsMax (20), BR.joueursMax − humains − 1, quota global restant)` (le `− 1` laisse une place libre à un arrivant). **Remplissage automatique en solo, pour tous les clients** :
  `bots` ABSENT et un seul humain → `BR.botsSolo` (11) bots (additif : un client v9/v10 en solo n'a pas l'affichage des bots mais voit des humanoïdes fil de fer, acceptable, et sans
  remplissage il verrait « lancer » sans effet ; documenté dans le README) ; `bots` présent → pris tel quel (borné). Il faut ensuite `humains + bots ≥ joueursMin` (2) et au moins un humain. **Un lancement qui échoue n'est
  jamais silencieux** : `refus{action:"lancer", raison:"bots"}` (pas assez de joueurs) ou `raison:"limite"` (quota de bots global épuisé), affiché dans le lobby. Le quota restant
  est publié dans `listes.br[].botsRestants`. Le lobby du BR désactive « Lancer » avec le message « Ajoutez des bots (ou un autre joueur) » quand il y a 1 humain et 0 bot. `PDJ_FPS_BR_MIN_JOUEURS` n'est pas touché (essais). Plafond par partie `PDJ_FPS_BR_BOTS_MAX` (20) et global
  `PDJ_FPS_BR_BOTS_TOTAL` (24 en attendant la mesure, 40 ensuite, toutes parties : 4 parties partagent 1 vCPU).
- **Les parties avec bots ne comptent pas** dans les statistiques (TOP 1, kills, parties) : `nonComptee = true` (drapeau existant, affiché par le
  client) dès qu'un bot a pris part à la partie, et les lignes `bot` sont de toute façon filtrées de `appliquerPartie`.
- **Début de partie** : le vol ne démarre que si **au moins un humain est monté** (`bord.some(j => !j.bot)`) ; sinon `retourLobby(annulation)` (`match-br.ts:312-313` démarre aujourd'hui si
  `bord.length ≥ joueursMin`, et les bots montent d'office : un humain qui n'a pas fini de charger en 30 s deviendrait spectateur d'un combat de bots). `decompteTermine` n'est vrai qu'une fois
  l'hôte monté ou le plafond de 30 s atteint.
- **Fin de partie** : un humain éliminé voit sa killcam puis regarde ; **dès qu'il ne reste aucun humain EN VIE** (tous éliminés, la place de chacun est déjà fixée), la partie se termine
  `BR.finSansHumainMs` (15 s, pour laisser la killcam du dernier) après la dernière mort humaine : `terminer(t)` avec bilan et places figées (la partie n'est de toute façon pas
  comptée), au lieu de faire tourner plusieurs minutes de zone pour rien. Un spectateur « venu regarder » (`JoueurSalle.spectateur`) garde la salle OUVERTE (il compte dans `nombreJoueurs()`)
  mais ne compte pas dans `nombreHumains()` « en lice » pour retarder cette fin. Le dernier humain qui part (`liberer`) → retour au lobby sans statistiques, bots retirés, la partie vide est refermée.
- **Exclus de l'hôte et des conflits** : un bot n'est jamais hôte (`hote()` filtre `!bot`) ni compté dans `conflitDeNoms` ; l'hôte est toujours le
  premier HUMAIN arrivé. Les bots comptent dans les règles dépendantes de la taille de la partie (`nbObjetsPour`, `echelleDureeZone`) : voulu.

### 1.4 IA des bots (module pur `lib/fps/bots-br.ts`, câblage `match-br-bots.ts`)

- **Cadence** : cerveau à 20 Hz par bot, phase décalée par bot (`(tic + i) % 3 === 0` sur le tic à 60 Hz) ; mouvement par `etape(e, entrees, dt,
  monde, vitesseArme)` (`mouvement.ts:733`) avec le `dt` réel, **borné pour rester dans le budget de distance du serveur** (`recevoirEtat` : 19 m/s × temps écoulé plafonné à
  `BUDGET_ARENE_S`, marge `MARGE_ETAT_H_M`), puis `etat` avec un `seq` croissant (le premier `seq` est 0 : `placerJoueur` met `j.seq = -1`). Le bot **teste le retour de
  `Salle.recevoir`** : si l'état est refusé (budget, `seq`), il se resynchronise sur `j.p` au tic suivant (jamais de bot « refoulé en silence »). Les angles `lacet` / `tangage` sont
  envoyés dans le MÊME `etat` que la position, AVANT le `tir` du tic. Sprint en déplacement, marche en combat, saut ponctuel quand il est coincé, pas de wall-run. Coût mesuré
  (Mac) : `etape` 0,085–0,1 ms, soit ≈ 0,4 % d'un vCPU par bot ; 15 bots ≈ 5–6 %.
- **États** : `atterrir → fouiller → zone → combat → soigner → fuir`, mémoire par bot (`MemoireBot`) ; transitions :
  - `atterrir` : avant `decompteTermine`, `rejoindre` interne (`entreeJoueur` → `vol.entrer`) ; à un instant tiré dans `[avion.debutT, avion.finT]`
    calé sur la distance au point visé : `vol.sauter` ; en chute `vol.recevoirChute` avec `lacet = capVers(dx, dz)`, piqué (tangage ≈ −π/3) puis plané,
    `ouvrir: true` après `delaiOuvertureMinMs` (le serveur simule la chute et ouvre seul sous 90 m). Point visé : un point de butin (hors pool
    `toit`) de la composante principale, tiré avec le hasard de la partie, deux bots évitent d'atterrir au même point (écart ≥ 30 m). Éjection
    forcée à `finT` déjà gérée.
  - `fouiller` : va au `ObjetBr` le plus intéressant à portée (arme > munitions de sa classe > bandage si PV < 60), `ramasser{id}` à moins de
    `BR.rayonRamassageM` (2,5 m) avec `ramassageAccessible`, puis `utiliser` un bandage/une potion si PV < 60 hors combat. Priorité des armes :
    raretés de `ARMES_PAR_RARETE`. Il simule lui-même chargeur, recharge (`STATS[arme].chargeur`, `rechargeS`) et réserve (2 chargeurs, 6 au plus) car
    le serveur ne suit que `munSpeciale` ; il positionne `j.recharge` / `j.vise` pour que le snap les montre.
  - `zone` : lit le plan (`etatZone(plan, t)` → centre, rayon, cible ; `distanceAuBord`) ; rejoint le cercle visé AVANT le rétrécissement, sprinte dès
    que `distanceAuBord > −marge` ; la zone prime sur le butin dès le palier 2 ou dès qu'il est hors cercle.
  - `combat` : perception toutes les ~150 ms (joueurs vivants à moins de la portée de l'arme + marge, puis `visible()` pour les 5 plus proches ; pas
    de `visibilite.ts`), cible = la plus proche visible ; mêlée (couteau 34 / épée 70, `trouverCiblesMelee`) à moins de 2,2 m ; sinon tir à distance
    optimale de l'arme avec esquive latérale ; recharge à couvert.
  - `soigner` : PV < 35 sans ennemi visible → bandage/potion, sinon `fuir` (recule vers un bâtiment, vers la zone).
- **Visée avec imprécision réglable** : la cible est lue dans `histo` à `t − reactionMs` (retard de réaction : tirs en retard sur une cible rapide,
  le rejeu de latence du serveur, `BR.rewindMaxMs` 400 ms, garde le tir valide) ; bruit gaussien sur l'angle (`sigmaDeg`, croît avec la distance et la
  vitesse de la cible) intégré à `lacet` / `tangage` envoyés par `etat` AVANT le `tir` ; vitesse de rotation bornée ; `tir.o` = œil (`p + oeilDe`,
  1,95 m debout), `tir.d` = axe réel de la vue (la killcam et la vue empruntée recalent la caméra dessus). Un tir ne part que si l'erreur angulaire
  est sous un seuil, en rafales courtes avec pauses (cadence automatique : respecte le crédit de rafale de `cadenceOk`). `touches` calculé par
  `tracer(monde, o, d, portee, cibles, id)` (`tir.ts:61`) sur les positions ACTUELLES (le serveur revalide par `toucheVraisemblable`) ; pompe : un
  `tracer` par plomb avec `directionsTir`. Un bot qui tire perd sa protection d'atterrissage comme un humain.
- **Niveaux** (`NIVEAUX_BOT: Record<Difficulte, ParamsBot>`) : **`reactionMs` ≤ 350** (la validation d'un tir ne rejoue la cible que sur `BR.rewindMaxMs` = 400 ms, `match.ts:1100-1112` : un bot
  qui viserait une position vieille de 450 ms serait hors fenêtre, et ses tirs échoueraient tous au lieu d'être « moins bons » ; la faiblesse du débutant se règle par `sigmaDeg`).
  Entrée = réaction 350 ms, σ 3,5°, rotation 6 rad/s, rafales de 3 tirs max, pause 700 ms ;
  Plat du jour = 280 ms, 1,6°, 8 rad/s, 5 tirs, 450 ms ; Goulaf = 200 ms, 0,6°, 10 rad/s, rafale complète, 250 ms. Valeurs de départ à ajuster en jeu ;
  un seul tableau les porte. Les parties avec bots ne sont jamais comptées : l'effet réel d'un niveau n'est vérifié que par les essais (`PDJ_FPS_BR_BOTS_ESSAI`, §6).
- **Vitesse des bots** : les bots NE vont PAS à la vitesse des joueurs (`MOUV.marche` = 9 m/s, `MOUV.sprint` = 12,5 m/s, `mouvement.ts:44-45`). Le tigre bipède est animé par le moteur du corps (§1.5) dont
  la plage utile est le trot (≈ 0,8–1,5 m/s du modèle, `allures.ts:41-44`, soit 1,8–3,5 m/s à l'échelle 2,3) et que `VITESSE_MODELE_MAX` (3,2 modèle ≈ 7,4 m/s) borne ; au-delà les pieds
  glisseraient de deux à quatre fois la vitesse animée. Les bots ont donc une vitesse propre **`VITESSE_BOT_M_S`** (valeur de départ 5 m/s, à fixer par le spike du lot 4, entre 3,5 m/s =
  trot plein et 7 m/s) obtenue en réduisant les `entrees` (`avant` / `droite` ∈ [−1, 1] dans `etape`) ; plus lents que le sprint du joueur, c'est voulu pour l'entraînement. En combat leur
  vitesse est bornée par `vitesseMaxSelonDirection` (`bot-allure.ts`, appliquée par `decider`) selon l'angle entre la marche et la visée : pleine vitesse dans le cône de ±50° du cap du corps et à reculons
  (le corps garde la visée, les pieds reculent), ≈ 0,93 m/s en latéral pur (le cap du corps est borné à ±50° de `lacet`, §1.5 : une esquive latérale rapide ferait patiner les pieds) ; l'esquive latérale est donc une marche lente.
- **Budget de calcul du serveur (toutes parties)** : un seul A\* par tic **pour l'ensemble du serveur** (file d'attente FIFO partagée entre les salles BR, `BudgetNavigation`), plafond de
  3 000 nœuds par recherche (au lieu de `NOEUDS_MAX` = 20 000 ; reprise au tic suivant si inachevée), échecs mémorisés par bot (pas de nouvel A\* pour la même cible avant 8 s). À
  l'atterrissage, onze bots demandent un chemin en même temps : leurs demandes sont étalées sur plusieurs tics. Test de charge agrégé au lot 3 (cf. lots).
- **Navigation** : `grilleNav` (`tigre-arene.ts:358`, cases de 1,5 m, dégagement 0,8 m, à jour des bâtiments détruits) + `chercherChemin`
  (`NOEUDS_MAX` 20 000), PAS `carteNavigation` (cases de 2,01 m, trop grossières pour les portes de 2,6 m, laissent passer les murs fins).
  Mesures : A\* de 20 à 150 m ≈ 1,6 ms, 150–400 m ≈ 8 ms (pire 41 ms), cible scellée 50–450 ms ; première `grilleNav` ≈ 430 ms par monde.
  Règles : (1) étiqueter UNE fois par monde les composantes connexes de `g.libre` (flood-fill ≈ 59 ms, 25 composantes dont une de 139 003 cases) et ne
  choisir que des cibles de la composante où se trouve le bot ; (2) ignorer le pool `toit` (0 toit accessible sur 1012) ; (3) au plus UN A\* par tic
  et par salle, replanification toutes les 2–3 s ou quand la cible change ; (4) repli en ligne droite + glissement (`etape` fait `resoudre`) ; (5)
  blocage : moins de 0,3 m en 1 s → saut puis replanification ; (6) suivi par `pointDeVisee` (`navigation.ts:220`). La première `grilleNav` d'un monde est
  **précalculée au démarrage du serveur, avant `listen`** (≈ 0,45 s deviennent du temps de démarrage) sur un monde de référence, avec les composantes connexes (hypothèse : monde BR
  statique pour la navigation des bots, aucun bâtiment détruit ; si ce n'est plus vrai, invalider l'étiquetage). `GrilleNav` expose `libre` ET `etats` (`tigre-arene.ts:270-279`, `etats`
  détecte les prismes modifiés) : copier `libre` seul ferait recalculer toutes les plages à la première `actualiserGrille`, il faut copier les deux tableaux (`.slice()`) dans
  chaque nouvelle salle BR.
- **Désactivation** : `PDJ_FPS_BR_BOTS_MAX=0` coupe les bots (le lobby n'affiche plus le réglage : `botsMax` est publié dans `salons.listes.br`,
  cf. §2).

### 1.5 Rendu : tigre bipède armé (`lib/fps/bot-tigre-anim.ts`, `rendu-bots.ts`)

- **Précédent copié** : `lib/fps/zombies-anim.ts` (un `Corps` persistant de `lib/tigre3d/corps.ts` + une `Couche` de geste par groupe d'os +
  `vitesseImposee`). Le moteur du corps est quadrupède (avance sur +x) ; le dressé existant (`gestes/batte.ts:28,43-47`) n'est qu'un geste immobile.
  On construit donc une **couche permanente « debout »** : `corps: {tangage ≈ 1,35, pivot: "hanches"}`, `deltas` de `cou` / `tete` / `machoire` à
  0,62 / 0,38 / 0,38 × tangage (+ terme de visée), pattes avant `avG` / `avD` tenues par la couche (poids 1) et posées sur l'arme, pattes arrière
  `arG` / `arD` à poids 0 : la locomotion les pilote (pieds verrouillés au sol, IK).
- **Allure** : verrouiller marche / trot. Au galop (`allures.ts:41-44`) les pattes arrière sont quasi synchrones : saut de lapin. Seul changement de
  moteur : champ optionnel `allureMax` de `Consignes` utilisé à `corps.ts:271` : `amortir(c.allure, Math.min(allurePourVitesse(vitesse), k.allureMax ?? 2), …)`.
  Les bots passent `allureMax: 1`. `vitesseImposee = |v horizontale| / échelle`, plafonnée à `VITESSE_MODELE_MAX` (3,2 m/s modèle) ET, pour les bots, bornée par `VITESSE_BOT_M_S / ECHELLE_BOT`
  (§1.4) : le moteur avance `c.x` à la vitesse imposée (`corps.ts:264-266`), donc une vitesse animée différente de la vitesse réelle ferait glisser les pieds. **Spike obligatoire avant d'engager
  le lot 4** (une demi-journée) : un bot local qui marche à 3, 5 et 7 m/s, en latéral, en recul et sous parachute, avec captures et mesure du glissement ; il fixe `VITESSE_BOT_M_S` et décide
  entre la bride de vitesse décrite ici et une entrée `ALLURES` dédiée au bipède (course alternée, appui ≈ 0,4).
  **Résultat du spike (retenu : la bride, `bot-allure.ts`)** : glissement des pieds arrière en appui, mesuré dans le monde (`bot-tigre-anim.test.ts`) — en avant de 1 à 6,25 m/s : moyenne 0,002 à 0,04 mm/image,
  pire image < 1,3 mm ; à reculons : moyenne 0,10 à 0,16 mm/image, pire image 2,9 à 6,8 mm (un pic par pas, à la première image d'appui : le bout de la patte, IK amortie, traîne de 3 à 15 mm derrière le point de
  pose en fin de vol et le rejoint en une image) ; de côté ou en diagonale (au-delà de ±50° du cap du corps) : glissement de `GLISSEMENT_MAX_M_S` = 0,6 m/s soit ≈ 10 mm/image, voulu par le contrat
  (il fixe la vitesse maximale dans cette direction, ≈ 0,93 m/s en latéral pur). **Le critère « < 0,1 mm/image » n'est donc tenu qu'en avant** ; à reculons le seuil retenu est 0,2 mm de moyenne et 8 mm
  au pire, de côté 0,65 m/s (les tests mesurent ces valeurs ; le pic à reculons n'est pas éliminé, il est borné et à l'échelle d'un pied de 40 cm).
- **Échelle et hitbox** : le rendu doit coller à la silhouette de touche du joueur (`tir.ts:63-90` : tête y = 2,0 r = 0,3 ; capsule 0,19 → 1,73 r =
  0,475). Échelle ≈ 2,3 (tête à 0,875 modèle → 2,0 m ; le thème Tigre, 3,397, est trop grand), `origineX = anim.x() − 0,274` pour que les hanches soient
  sur `p` (la racine est à ≈ 0,274 modèle en avant des pieds). Recalage par test : `tete` y = 2,0 ± 0,15, torse dans r = 0,475 de l'axe vertical. Le
  serveur ne met JAMAIS `accroupi` pour un bot : une seule pose. Jambes courtes assumées (« torse long, jambes courtes »), le talon qui décolle compense.
- **Cibles de mains** (repère sol, mesurées) : dans ≈ 0,30 m de l'épaule (épaule à ≈ 0,31 modèle derrière la racine, y ≈ 0,63 ; bras L = 0,34) :
  z sol entre −0,15 et 0, y entre 0,62 et 0,75 ; au-delà `manque` > 5 mm. Test pur « manque < 5 mm » dans le style de `batte.test.ts:91-120`.
- **Arme** : `creerArmeBot(id, couleur)` exporté de `rendu.ts`, **dérivé de `creerModeleArmeMonde(id, couleur)` (`rendu.ts:1118`, déjà exporté et utilisé par `rendu-br.ts`, `rendu-microondes.ts`,
  `rendu-objets-zombies.ts`)** : il n'en duplique pas la logique, il ajoute seulement `prise` / `garde` / `bouche` que cette fabrique ne renvoie pas (arêtes de 2 px comme
  l'avatar, `ordonner(group, false, 5)`). Posée dans la RACINE du bot (non mise à l'échelle, pas dans un os : axes locaux hétérogènes), à chaque
  image positionnée à `porte` (épaule / torse + décalage) et orientée par `Quaternion.setFromUnitVectors((0,0,−1), dirVisée)` en repère local de
  la racine ; échelle ≈ ×1,5 ; mains sur `prise` (avD) et `garde` (avG, ou au repos pour une arme à une main) sur le modèle d'`attraper` (`rendu.ts:1647`, fermeture locale à `creerAvatar`, NON réutilisable : à réécrire pour les pattes du tigre).
  `positionBouche()` = `arme.bouche` en monde (`localToWorld`, sur le modèle de `rendu.ts:1687-1691` pour l'avatar et `1405-1409` pour l'arme en main). Tir : `tirer()` + coup de pattes −0,03 en z
  décroissant + petit kick de tangage ; recharge : arme inclinée, pattes baissées 0,5 s.
- **Orientation** : repère zombies (corps le long de +x, `groupe.rotation.y = lacet + π/2`, `rendu-zombies.ts:~325`). Le corps suit la direction de
  marche, borné à ±50° de `lacet` ; l'arme vise toujours `lacet` / `tangage` (± `tangage × 0,5` ajouté à `cou` / `tete`).
- **Mort** : ragdoll (`creerRagdoll`, `ragdoll-tigre.ts:419`, `collisionsDuMonde(monde)`, repère `cap` de la convention zombies, plafond
  `ragdollPermis` à 8 actifs, repli : bascule rigide autour des pieds), cadavre ≈ 4 s. **Parachute** : `creerParachute(ATTACHE_PARACHUTE)`
  (`creerParachute` est dans `rendu-avion.ts:143`, importé par `rendu.ts` et appelé en `rendu.ts:1807` ; la constante `ATTACHE_PARACHUTE` est en `rendu.ts:1464`) + pose « bras levés, jambes pendantes ».
  **Touche** : matériau cloné par bot (teinte du joueur × texture, `color.lerp(blanc)`).
  Liseré de couleur optionnel (`materiauLisere` de `rendu-tigres.ts:273`) dans les 15 m.
- **Coût** : GLB = 15 629 sommets, 25 000 triangles, 1 maillage skinné, 39 os, 481 Ko. `avancerCorps` ≈ 0,4–1,7 ms par pas (vitest, indicatif ; sur douze bots à moins de 40 m, 5 à 20 ms par image hors GPU) :
  LOD obligatoire via `animerCetteImage(distance, image, id)` / `periodeAnimation` (`jeu-zombies.ts:341-350` : chaque image sous 40 m, une sur
  deux sous 80 m, une sur quatre au-delà). **Pool de 6 tigres GLB complets par défaut** (les plus proches / à l'écran ; 12 seulement si la mesure en navigateur du lot 4 tient le budget : **≤ 3 ms de CPU par image pour les bots**, avec mises à jour
  plafonnées par image), les autres bots gardent l'avatar fil de fer `creerAvatar` ; le fil de fer sert aussi de repli avant le chargement du GLB (la `FabriqueBots` bascule). Au plus 2 créations de clone par image.
  Copie privée de la géométrie (`morphAttributes = {}`, attribut `mainHumaine` retiré) et de la texture, `sansHalo` sur le matériau, libérées au
  `dispose` ; JAMAIS `libererModele` ; une `FabriqueBots` par `lancerJeu`, détruite à `dispose()` (`jeu.ts:3557`). Tout est derrière
  `import("@/lib/fps/jeu")` : rien dans le premier chargement du menu.
- **Branchement unique** : le nouvel avatar implémente `AvatarJoueur` (`rendu.ts:47-70`) ; `jeu.ts:1360-1367` `creerAvatarDistant(id)` choisit
  `estIdBot(id) || infos.get(id)?.bot ? creerAvatarBot(couleur, pseudo, fabrique) : creerAvatar(...)`. Les autres sites d'appel (`majInfos`,
  `majDistants`, `afficherPseudo`, tir / coup / touche distants, `avatarVictime`) ne changent pas. Plaque « Tigre · pseudo » (`texturePseudo`,
  `Y_PSEUDO` = 2,5).

---

## 2. Protocole v11 (`lib/fps/protocole.ts`)

Tous les TYPES sont ajoutés au **lot 1** ; les lots suivants n'éditent pas ce fichier, **sauf le lot 2** pour les deux constantes de version (et leur commentaire).

```ts
// fin du lot 1 : le client déployé (v10) fonctionne tel quel, aucune version ne change côté client
export const VERSION_PROTOCOLE = 10;
export const VERSIONS_ACCEPTEES: readonly number[] = [8, 9, 10, 11];   // le serveur accepte déjà 11
export const VERSION_MIN_ZOMBIES = 10;
// fin du lot 2 (sémantique d'horloge changée, client avec HorlogeServeur.recaler/figer) :
export const VERSION_PROTOCOLE = 11;
export const VERSION_MIN_ZOMBIES = 11;   // un client v10 ne gèlerait pas son horloge : la salle des zombies lui est fermée (erreur{version})
```

Pourquoi 11 : la pause change la sémantique de l'horloge serveur (un client v10 verrait tigres et minuteurs sauter à la reprise). Les parties
parallèles et les bots seuls seraient additifs. **Le bump n'a lieu qu'au lot 2** : jusque-là un client reconstruit annoncerait v11 sans la logique `recaler` / `figer`, et
`VERSION_MIN_ZOMBIES = 11` fermerait les zombies aux clients déployés (contre « un lot ne casse jamais un client déjà déployé »). Les scripts qui codent la version en dur
(`scripts/fps/protocole_br_parties.mjs:42` : `v: 10`) passent à `VERSION_PROTOCOLE` / 11 dans le lot qui bumpe (lot 2), pas au lot 6. Règle de déploiement habituelle :
**serveur reconstruit et redéployé AVANT le client v11** (il sert 8, 9, 10 et 11 ; la salle des zombies seulement aux 11 après le lot 2). Mettre à jour le commentaire de déploiement de
`protocole.ts` et `CLAUDE.md`.

**Client → serveur**
- `{ t: "pauseZ"; actif: boolean }` : demande de suspension (`true`) ou de levée (`false`) ; idempotent ; zombies seulement. Un message inconnu est
  ignoré par un ancien serveur.
- `{ t: "mode"; mode: ModeSalle; partie?: string }` : inchangé de forme ; `partie` vaut désormais pour les TROIS modes (id d'une partie de
  `salons.listes[mode]`, `PARTIE_NOUVELLE`, ou `PARTIE_AUTO` pour l'arène : « la plus peuplée qui accueille, sinon en créer une »).
- `{ t: "lancerPartie"; difficulte?: Difficulte; bots?: number }` : `bots` (**entier** 0..`BR.botsMax`, validé par `Number.isInteger`) ne vaut qu'en BR ; absent → remplissage
  automatique en solo (§1.3).

**Serveur → client**
- `{ t: "zpause"; actif: boolean; par?: string; pseudo?: string; maintenant: number; compte?: number }`, diffusé à toute la salle :
  `actif: true` = salle figée ; `maintenant` = temps virtuel `V` gelé ; `par` / `pseudo` = qui a suspendu ; `compte` (ms) = compte à rebours
  en cours (le jeu est encore figé, le client décompte en temps local) ; `actif: false` = jeu repris, `maintenant` = `V` à la levée.
  **Émis à TOUT client de la salle de zombies juste après chaque `bienvenue` (connexion, `reprendre`, changement de salle par `mode`), qu'elle soit suspendue ou non** : un client
  qui était gelé, dont la socket est tombée ou qui change de salle pendant que l'autre lève la suspension ne reste jamais figé. Pour une salle non suspendue, c'est `zpause{actif:false}`
  (le client le traite comme « dégelé »). Le `bienvenue` caractérise déjà l'horloge virtuelle (`maintenant`) : le client cale son horloge sur `V` dès le `bienvenue`, avant le `zpause`.
  Le client remet `gele` / `horloge.figer` à zéro à chaque `bienvenue`, dans `quitter` et dans `dispose`.
- `salons` : `listes?: { arene: ResumePartie[]; zombies: ResumePartie[]; br: ResumePartie[] }` (parties de chaque mode, permanente en tête) et les
  champs historiques `arene`, `zombies`, `br`, `parties` (BR seulement) inchangés. Ajouter à `ResumeSalonBr`-compatible un `botsMax?: number` et un `botsRestants?: number`
  (quota global restant) dans chaque entrée BR de `listes` (`botsMax` 0 = bots coupés).
  ```ts
  export interface ResumePartie {
    id: string; mode: ModeSalle; phase: PhaseZombies | PhaseBr | "arene";
    joueurs: number;           // membres humains (lobby compris)
    capacite: number;          // zombies 8, BR 50, arène 16 (JEU.joueursMax, joueurs EN JEU ; pas connexionsMax)
    hote?: string;             // pseudo de l'hôte (zombies, BR)
    vivants?: number; palier?: number; manche?: number;
    enJeu?: number;            // arène : joueurs en arène
    bots?: number; botsMax?: number;   // BR
    suspendue?: true;          // zombies : partie figée
  }
  ```
- `mode` (écho) : `partie?: string` pour les trois modes.
- `presence` : `JoueurPublic.bot?: true`. `LigneBilanBr.bot?: true`.
- `refus` : `action` ajoute `"pause"` (raisons : `"lobby"` pas en partie ou pas encore chargé, `"inconnu"` non admis, `"limite"` délai / plafond de pause, `"plusieurs"` auto-suspension refusée
  parce que plusieurs humains sont admis) et `"lancer"` (raisons `"bots"` : pas assez de joueurs, `"limite"` : quota de bots global épuisé) ; `refus{rejoindre, plein}` gagne un champ
  optionnel `alternative?: string` (id d'une partie d'arène qui accueille). `"limite"` s'applique aussi à `mode` (plafonds, délai de 10 s entre deux créations, disjoncteur de tic).
- `bienvenue.maintenant` et `pong.maintenant` sont désormais l'horloge VIRTUELLE de la salle (égale à l'horloge réelle tant qu'aucune pause n'a eu lieu).
- Ids : `b<n>` = bots (`estIdBot`, motif décimal `^b\d+$`), documenter à côté de `estIdZombie`.

---

## 3. Lots d'implémentation

Ordre imposé : **1 → 2 → 3a**, puis **3b**, puis **4 en parallèle de 3b** (si les agents partagent un même répertoire de travail, 2 et 4 touchent `jeu.ts` à
des endroits distincts, fusion triviale mais à enchaîner), puis **5b** ; **5a** (liste des parties, « Créer ma partie », arène et zombies) ne dépend que du lot 1 et se fait **en parallèle du
lot 2** (les parties parallèles de la demande 2 ne doivent pas attendre la pause ni les bots) ; **6** termine, mais `protocole_parties.mjs` est créé dès le lot 1 et enrichi à chaque lot.
Le **lot 3** est scindé : **3a** = plomberie (bots dans la `table`, `suivi`, hôte, fin de partie, statistiques, bots SCRIPTÉS qui marchent droit et tirent mal, test de charge agrégé),
**3b** = IA (navigation, combat, niveaux) ; le BR solo est livrable dès 3a avec l'avatar fil de fer existant, le tigre bipède (lot 4) est un incrément et non un prérequis.
Le **lot 5** est scindé de même : **5a** (parties) et **5b** (réglage des bots, après 3a). Chaque lot garde `npx vitest run lib/fps` et `npm run typecheck` (et
`cd serveur-fps && npm run typecheck`) au vert, Node 22. Un lot ne casse jamais un client déjà déployé : à la fin du lot 1, le client actuel
(inchangé, v10) fonctionne contre le serveur du lot 1 et les zombies lui restent ouverts (le bump de `VERSION_MIN_ZOMBIES` est au lot 2).
**Charge agrégée** (au plus tard fin du lot 3a) : un test de charge combiné (1 arène avec ses services, 3 parties de zombies à la manche 20, 4 parties BR avec 11 bots chacune) mesure la moyenne
et le p99 d'un tic et la RSS sur 1 vCPU / 512 Mo ; les plafonds par défaut (`PDJ_FPS_PARTIES_TOTAL`, `PDJ_FPS_BR_BOTS_TOTAL`, `BR.botsSolo`) sont ABAISSÉS tant que cette mesure n'a pas
été faite sur le VPS (valeurs de départ : total 6, bots global 24, solo 11).

### Lot 1 — Protocole v11, registre de parties, routage, serveur multi-parties

**Crée** : `lib/fps/parties.ts` (+ `parties.test.ts`), `scripts/fps/protocole_parties.mjs` (clients WebSocket nus : le script de vérification des critères ci-dessous ; enrichi aux lots suivants).
**Modifie** : `lib/fps/protocole.ts` (tout §2 : `VERSIONS_ACCEPTEES` seulement, `pauseZ`, `zpause`, `listes`, `ResumePartie`, `bot`, `bots`, `PARTIE_AUTO`, `refus.action "pause"` / `"lancer"`, `estIdBot`),
`lib/fps/salons.ts` (+ `salons.test.ts`), `lib/fps/protocole.test.ts`, `lib/fps/br-regles.ts` (`BR.botsMax = 20`, `BR.botsSolo = 11`, `BR.finSansHumainMs = 15_000`, ajoutés ici pour
qu'aucun lot suivant ne le touche), `lib/fps/match.ts` (SEULEMENT : méthode `mode(): ModeSalle` déduite des options `zombies` / `br`),
`serveur-fps/src/index.ts` (dont le renommage `Suspens` → `SessionCoupee`, le précalcul des mondes de référence avant `listen`, les limites de création), `serveur-fps/README.md` (tableau des variables),
`lib/fps/match.charge*.test.ts` (si le coût d'un tic change).
**NE touche PAS** : `match-*.ts`, `jeu.ts`, `reseau.ts`, `app/**`, les autres `scripts/**`, `CLAUDE.md`.

Fonctions PURES :
```ts
// lib/fps/parties.ts
export interface Partie<S> { id: string; mode: ModeSalle; salle: S; permanente: boolean }
export class RegistreParties<S> {
  constructor(o: { fabriques: Record<ModeSalle, () => S>; max: Record<ModeSalle, number>; maxTotal: number;
                   humains: (s: S) => number; permanentes: readonly ModeSalle[] });
  liste(mode?: ModeSalle): readonly Partie<S>[];          // permanente en tête
  parId(id: string): Partie<S> | null;
  deSalle(s: S): Partie<S> | null;
  peutOuvrir(mode: ModeSalle): boolean;                   // plafond du mode ET plafond total
  ouvrir(mode: ModeSalle): Partie<S>;                     // id = préfixe + compteur du mode (ar / z / br), lève si !peutOuvrir
  refermerVides(): Partie<S>[];                           // retire les non permanentes à 0 humain, retourne les retirées
}
export const PREFIXE_PARTIE: Record<ModeSalle, string>;   // { arene: "ar", zombies: "z", br: "br" }

// lib/fps/salons.ts
export interface PartieRoutage { id: string; mode: ModeSalle; joueurs: number; capacite: number; accueille: boolean; enJeu?: number; phase: string }   // `phase` passe de PhaseBr à string ; arène : comparer enJeu
export function accueillante(mode: ModeSalle, r: { phase: string; enJeu?: number }): boolean;
export function choisirPartie(mode: ModeSalle, parties: readonly PartieRoutage[], creerPossible: boolean): PartieRoutage | "nouvelle" | null;
export function decisionPartie(e: { mode: ModeSalle; partie?: unknown; partieActuelle?: string | null; salleActuelle: ModeSalle; enJeu: boolean;   // `salleActuelle`, comme decisionMode existant
  parties: readonly PartieRoutage[]; creerPossible: boolean; version?: number }): DecisionMode;   // remplace decisionPartieBr
export function decisionMode(e: …): DecisionMode | null;    // même signature d'appel qu'aujourd'hui ; `parties` devient valable pour tous les modes
export function messageSalons(a: ResumePartie | null, z: ResumePartie | null, br: ResumePartie | null, listes: Record<ModeSalle, ResumePartie[]>):
  Extract<MessageServeur, { t: "salons" }>;                 // champs historiques calculés depuis les permanentes + parties BR + listes
export function garderPourReprise(e: { estZombies: boolean; membre: boolean; code: number; phase: PhaseZombies | null }): boolean;
```
`decisionMode` garde son comportement actuel quand `parties` est absent (compatibilité des tests existants). `PartieRoutage` remplace
`{id, joueurs, phase}` : adapter `choisirPartieBr` en `choisirPartie("br", …)` et garder un alias exporté tant que des fichiers l'importent.

`index.ts` : `RegistreParties` remplace `salleArene` / `salleZombies` / `partiesBr` ; trois fabriques (`creerSalleArene()` avec
`construireMonde(scene)` et des options dont AUCUN état muté n'est partagé — vérifier `optionsArene`, `circuits`, `flotte`, `cachettes`
—, `creerSalleZombies()`, `creerSalleBr()` existante) ; `Client.salle` initiale = salle de `ar1` ; `changerMode` appelle `decisionPartie` pour les
trois modes, ouvre la partie si `PARTIE_NOUVELLE`, écho `mode{partie}` pour tous ; `fermer` / `reprendre` généralisés (§1.2) ; tic sur toutes les
parties ; timer `salons` : `refermerVides()` puis `diffuserSalons()` (listes) ; `/sante.parties` ; variables d'environnement
`PDJ_FPS_ARENE_PARTIES`, `PDJ_FPS_ZOMBIES_PARTIES`, `PDJ_FPS_PARTIES_TOTAL` lues avec `nombreEnv`.

Tests vitest :
- `parties.test.ts` : ids `ar1`, `ar2`, `z1`, `br1`…, compteurs indépendants par mode et jamais réutilisés ; `peutOuvrir` respecte le plafond du
  mode et le plafond total ; `refermerVides` ne retire jamais une permanente ; une partie à 1 humain n'est pas retirée ; `deSalle` par identité.
- `salons.test.ts` : (0) arène : `ar1` (hall, 0 joueur en jeu, 3 spectateurs) et `ar2` (15 en jeu) → `ar2` choisie ; `ar1` pleine → création d'`ar2` ; `partie:"auto"` ; réservations comptées ; client `version < 11` → toujours la permanente ; (a) deux clients zombies sans `partie` → même lobby ; (b) A lance, B arrive sans `partie` → nouvelle partie (création possible),
  sinon première avec de la place, sinon `refus{plein}` ; (c) `partie:"nouvelle"` reprend une partie vide au lobby avant d'en créer ; `refus{limite}`
  au plafond ; client en jeu → `refus{lobby}` ; (d) arène : partie pleine (16 en arène) évitée, création si toutes pleines ; (e) partie nommée
  disparue → routage par défaut ; (f) écho avec `partie` pour client déjà dans une partie du mode ; (g) `garderPourReprise` avec `estZombies` ; (h) les
  tests BR existants passent inchangés ; (i) `messageSalons` : `parties` ne contient QUE du BR, `listes` les trois modes, champs historiques = permanentes.
- `protocole.test.ts` : constantes (au lot 1 `VERSION_PROTOCOLE === 10` et `VERSION_MIN_ZOMBIES === 10`, mis à jour au lot 2), `estIdBot` (`b12` oui, `br1` non, `b` seul non), `VERSIONS_ACCEPTEES` contient 8 à 11.
- `parties.test.ts` : ajouter la réserve d'un emplacement par mode (4 BR ne privent pas les zombies d'une 2e partie), le délai de 10 s entre deux créations d'un client et la limite par IP.
- Test de charge / serveur : `match.charge.test.ts` inchangé ; un test `index`-free vérifie que deux `Salle` zombies avec deux `Monde` distincts n'interfèrent pas
  (détruire un bâtiment dans l'une ne le détruit pas dans l'autre, navigation indépendante).

Critères d'acceptation (vérifiés par `scripts/fps/protocole_parties.mjs`, créé dans ce lot) : deux clients WebSocket nus, A et B, obtiennent chacun `z1` puis `z2` (A `mode{zombies}`, lance ; B `mode{zombies, partie:"nouvelle"}`)
et lancent deux parties séparées dont les `zombies{etat}` diffèrent ; idem `ar1`/`ar2` et `br1`/`br2` ; la partie vide est refermée en moins de 2 s ;
l'ancien client (v10, `bonjour v:10`) joue comme avant, **y compris les zombies (`VERSION_MIN_ZOMBIES` reste 10 jusqu'au lot 2)** ; `/sante` garde
ses champs plats ; 10 créations en 10 s par le même client → `refus{limite}` sans que `ticMaxMs` dépasse le seuil ; `npx vitest run lib/fps` vert.

### Lot 2 — Pause des zombies (suspension)

**Crée** : `lib/fps/suspension.ts` (+ `suspension.test.ts`), `lib/fps/match.suspension.test.ts`, `lib/fps/suspension.horloge.test.ts`, `lib/fps/gel.ts` (+ `gel.test.ts`, module PUR du gel côté client, cf. plus bas).
**Modifie** : `lib/fps/match.ts` (Salle : horloge virtuelle, `pauseZ`, garde des entrées, levée automatique ; PAS les parties BR ni les bots),
`lib/fps/match-contexte.ts` (`ServiceZombies.peutSuspendre(id)`, `ResumeZombies.suspendue?`), `lib/fps/reseau.ts` (`HorlogeServeur`, traitement de
`zpause` / `bienvenue` dans `connecterArene`), `lib/fps/jeu.ts` (`frame`, `peutAgir`, `peutLancerGrenade`, `envoyerEtat`, `pauseZ()` du `JeuHandle`, état
`gele`), `lib/fps/sons.ts` (suspension de l'`AudioContext` du jeu, `speechSynthesis`), `lib/fps/touches.ts` (action `pauseZ`, touche P, libellé, anciennes
sauvegardes complétées, test de conflit), `app/components/arene/hud/MenuPause.tsx`, `app/components/arene/HudArene.tsx`, le type `HudEtat` (là où il est
défini : `grep -n "interface HudEtat" lib/fps app`) , `app/components/Agroparc3D.module.css` (`animation-play-state: paused` sous `[data-suspendue]`),
`serveur-fps/src/index.ts` (SEULEMENT les variables `PDJ_FPS_ZOMBIES_SUSPENSION_MAX_MS`, `_COMPTE_MS`, `_SUSPENSION_COOLDOWN_MS`, `_SUSPENSION_TOTAL_MS` dans
`optionsZombies`, et `suspendue` dans le bloc `/sante.zombies` et dans `resumePartie`).
**NE touche PAS** : `protocole.ts` (types faits au lot 1 ; SEULS `VERSION_PROTOCOLE` et `VERSION_MIN_ZOMBIES` passent à 11 ici, avec leur commentaire de déploiement, et `scripts/fps/protocole_br_parties.mjs:42` `v: 10` devient `VERSION_PROTOCOLE` / 11), `salons.ts`, `parties.ts`, `match-zombies.ts`, `zombies.ts`, `zombies-secret.ts`, `effets-armes.ts`,
`grenades.ts` (la stratégie B les laisse intacts : s'ils doivent changer, c'est que l'horloge virtuelle fuit), `match-br*.ts`, tout rendu de bots, `app/components/arene/{Lobby*,ChoixMode,Arene,useArene}.*`, `scripts/**`.

Module PUR :
```ts
// lib/fps/suspension.ts
export interface OptionsSuspension { maxMs: number; compteMs: number; cooldownMs: number; totalMs: number }   // 300000, 3000, 10000, 900000
export interface EtatSuspension { par: string; pseudo: string; debutReel: number; compteFinReel: number | null }
export class Suspension {
  constructor(o?: Partial<OptionsSuspension>);
  virtuel(reel: number): number;                         // reel − décalage ; gelé à V tant que suspendue
  get active(): EtatSuspension | null;
  peutSuspendre(par: string, reel: number, admisCount: number): "ok" | "limite";   // cooldown par joueur et total cumulé ; admisCount ≤ 1 → toujours "ok" (solo exempté)
  suspendre(par: string, pseudo: string, reel: number, admisCount: number): { v: number } | null;   // idempotent : déjà suspendue → null ; annule un compte à rebours (une seule fois par suspension)
  demanderLevee(reel: number, admisCount: number): "immediate" | "compte" | "rien";  // admisCount ≤ 1 → levée immédiate
  tic(reel: number): "leve" | "compte" | "auto" | "force" | null;       // fin du compte à rebours ; dépassement de maxMs → compte non annulable ; totalMs atteint → levée forcée
  lever(reel: number): void;                             // levée d'office (fin de partie), décalage += durée réelle
  reinitialiserPartie(): void;                           // appelé au lancement de partie et dans retourLobby : remet totalMs et cooldowns à zéro, conserve le décalage
  totalSuspenduMs(): number;
}
```
`Salle` : champ `susp: Suspension`, conversion en tête de `connecter`, `deconnecter`, `reprendre`, `recevoir`, `tic`. Suspendue : `tic` n'appelle AUCUN
service, ne fait que `susp.tic(reel)` (compte à rebours, plafond de durée) et renvoie les `zpause` ; `recevoir` intercepte `pauseZ` (ne va pas au
service). **LISTE BLANCHE** (et non liste noire : le `switch` de `match.ts:722-780` contient aussi `monter`, `descendre`, `siege`, `pilotage`, `canon`, `lancerFrappe`,
`lancerFumigene`, `monterBus`, `invoquer`, `chute`, `ramasser`, `lacher`, `utiliser`, `arme`, `equiper`, `regarder`… et un oubli ferait tourner le service sans horloge) :
pendant la suspension ne passent que `pseudo`, `quitter`, `ping`, `vueScores`, `voixActif`, `voix`, `rejoindre`, `pauseZ` ; TOUT le reste est jeté. Test exhaustif : pour chaque
valeur de `MessageClient["t"]`, un message envoyé salle suspendue n'a aucun effet (le type `MessageClient["t"]` est parcouru par `satisfies Record<…>` pour que l'ajout d'un message
oblige à choisir). À la suspension : un dernier snap forcé (`prochainSnap = 0` puis un snap), puis `zpause{actif:true, maintenant:V}`. Fin de chaque point d'entrée : si suspendue et
`!zombies.enCours()` → `lever` + `zpause{actif:false}`. **`connecter` / `reprendre` / `rejoindreZombies` d'un client dans une salle suspendue** (et le `mode` qui y amène) émettent
`bienvenue` PUIS `zpause{actif:true}` PUIS **un snap et un `zombies{etat}` ciblés sur ce client** (forcer l'émission, sinon un joueur qui revient pendant 5 min de pause voit une carte
vide : le dernier snap n'est diffusé qu'une fois) ; dans une salle non suspendue : `bienvenue` puis `zpause{actif:false}` (cf. §2). `pauseZ` hors zombies, hors partie, avant la fin du chargement
ou non admis → `refus{action:"pause"}`. `susp.reinitialiserPartie()` au lancement de partie et dans `retourLobby`. **À la levée, le seau de distance de `recevoirEtat` est remis à plein** (le
`suivi.budgetT` est recalé sur l'horloge virtuelle : aucun joueur n'est refusé juste après la reprise, une téléportation reste impossible).

Client : `HorlogeServeur` (reseau.ts:41-42, 69, 191, 244-246) gagne
```ts
recaler(serveur: number, local: number): void;   // vide les mesures, precis = false, pose le décalage ; appelé à chaque `bienvenue`
figer(v: number): void;                          // maintenant() renvoie max(v, dernière valeur locale) : l'horloge ne RECULE jamais au gel (le client est en avance d'≈ un demi-RTT sur V) ; `ajouter` (pongs) ignoré pendant le gel
degeler(v: number, local: number, rttMs: number): void;   // recaler(v + rtt/2, local), levée du gel ; raccord sur ≈ `interpMs` pour l'interpolateur (cf. plus bas)
```
(sans quoi `amorcer` est ignoré une fois `precis` et le décalage reste faux de la durée de pause). **Logique du gel dans `lib/fps/gel.ts` (PUR, testé)** et non enfouie dans `jeu.ts` :
état (`gele`, `reprendreA`), `dtEffectif(dt)`, `peutEmettreEtat()`, `actionsAutorisees()`, minuteurs locaux de cuisson de grenade indexés sur `maintenantServeur()` (donc figés ; sinon la grenade part
seule à la levée), de sorte que la régression « les tigres piétinent pendant la pause » soit attrapée par vitest et non seulement par l'e2e en rendu logiciel. `jeu.ts` : à `zpause{actif:true}` → `horloge.figer(V)`,
`gele = true`, `document.exitPointerLock()`, `ctx.suspend()` du son ; dans `frame` (jeu.ts:3232) `dt = gele ? 0 : …` en gardant `dernierT = maintenant`
(pas de grand saut à la reprise), `peutAgir()` (jeu.ts:587) devient `… && !gele` (tir, recharge, changement d'arme, E, cuisson de grenade),
`peutLancerGrenade()` (jeu.ts:1224) refuse, `envoyerEtat` (jeu.ts:3105) n'émet plus, le rendu continue (monde figé : `maintenantServeur()` gelé fait
que tigres, projectiles, grenades, Truck et cadran du secret ne bougent pas). À `zpause{actif:false}` → `degeler`, `gele = false`, `ctx.resume()`. **`zpause` reçu avant la création du jeu** (pause pendant le chargement 3D, ou `zpause` entre un `bienvenue` et `lancerJeu`) : `useArene` mémorise le DERNIER `zpause` et le passe à `lancerJeu`, qui applique `figer` / `gele` à la création (d'où aussi l'interdiction de suspendre avant la fin du chargement côté serveur : défense en profondeur). **Raccord à la levée** : `maintenant()` figé renvoie `V` mais l'`Interpolateur` rend à `V − interpMs` : à `degeler`, ne pas sauter vers l'avant de ≈ `interpMs` avec des snaps absents du tampon ; le rendu reste sur le dernier état (`attendreSnap`) jusqu'au premier snap postérieur à `V`, y compris quand `compteMs = 0` ou en solo. Le pointer lock ne se reprend que par un geste : celui qui clique « Reprendre la partie » le récupère, les autres voient le menu Pause habituel. `sons.ts` :
drapeau `gele`, `reveiller` (691) et `prete()` (701) hors de portée du drapeau (sinon un clic sur l'écran de pause relance le son), `speechSynthesis.pause()`.
Le chat vocal (`voix-rtc.ts:91`, son propre `AudioContext`) continue : voulu.

UI : `MenuPause.tsx` — suspendue : « Partie en pause (par X) », « Tous les joueurs sont figés », compte à rebours « Reprise dans 3… », bouton
« Reprendre la partie » (envoie `pauseZ false`) distinct du bouton « Reprendre » (re-verrouille la souris) ; non suspendue en zombies : bouton « Mettre la
partie en pause pour tous ». Désactivé hors partie. Pas d'écran de plus : le menu apparaît déjà dès que le pointer lock est libéré (`HudArene.tsx:199-200`, 441).
Auto-suspension en solo (§1.1) : exclut `premiereFois`, lobby, fin, killcam ; le client affiche un `refus{pause}` (« Pause indisponible : limite atteinte » / rien pour `"plusieurs"`).

Tests vitest :
- `suspension.test.ts` : horloge virtuelle continue (pas de saut à la reprise), cooldown par joueur, plafond total, **solo exempté** (Échap, Reprendre, Échap en moins de 10 s : deux suspensions ; 20 min cumulées
  seul : toujours possible ; 6 min seul : pas de levée automatique), levée immédiate en solo, compte à rebours et **annulation une seule fois** (la 2e est refusée, cooldown appliqué), plafond de 5 min (compte non annulable),
  `totalMs` appliqué à la suspension en cours, idempotence, `lever`, `reinitialiserPartie` (deux parties successives dans la même `Salle`).
- `gel.test.ts` (PUR) : `dtEffectif` nul gelé, aucune émission d'`etat`, aucune action autorisée, cuisson de grenade figée, horloge qui ne recule pas, `zpause` antérieur à la création du jeu appliqué.
- `match.suspension.test.ts` (sur une vraie `Salle` zombies, horloge simulée) : lancer la partie, avancer, suspendre, `tic` pendant 10 minutes simulées,
  reprendre, puis comparer à une salle témoin : positions des tigres, `finT` des effets, `terreFinT`, `pendulesT` du secret, bonus, boîte, Micro-ondes
  (cuisson), grenades en vol, `protegeJusqua`, budget de distance (un `etat` pendant la suspension n'ajoute aucun budget, une téléportation reste impossible), `bilan.dureeMs`
  sans la pause ; un `tir` jeté pendant la suspension ; levée d'office à la défaite ; le suspendeur qui part ; `reprendre` renvoie `zpause` ET un snap ; **reprise après levée de la suspension** (A gelé, socket
tombée, B lève, A revient : `zpause{actif:false}` à la `bienvenue`) ; un client qui quitte la salle suspendue par `mode` ; ordre des messages d'un arrivant en `attente` (horloge calée avant `zpause`) ; **un message de chaque type
envoyé salle suspendue n'a aucun effet** (parcours exhaustif de `MessageClient["t"]`) ; `pauseZ` refusé avant la fin du chargement ; budget de distance remis à plein à la levée.
- `suspension.horloge.test.ts` : la garde élargie de §1.1 (`Date.now(`, `performance.now(`, `new Date(`, `setTimeout(`, `setInterval(`, `Math.random` hors liste blanche) sur tous les `lib/fps/*.ts` non client, et `Salle` injecte `this.alea`.
- `reseau.test.ts` (ou nouveau) : `figer` / `degeler` / `recaler` de `HorlogeServeur` (pongs ignorés pendant le gel, reconnexion après une pause, deux salles, aucun recul au gel).
- `touches.test.ts` : `pauseZ` sans conflit dans `ACTIONS_ZOMBIES`, anciennes sauvegardes complétées.

Critères d'acceptation : A suspend, B reçoit `zpause` et voit les `z<n>` immobiles pendant 3 s, B lève, le compte à rebours s'affiche, l'horloge client est
continue ; un joueur qui rejoint / reprend pendant la pause est figé aussi et reçoit un monde complet ; un joueur gelé qui se reconnecte après la levée est dégelé ; aucun fichier de jeu serveur (`match-zombies.ts`…) n'a changé ; en solo
Échap suspend et « Reprendre » reprend ; `npx vitest run lib/fps` vert.

### Lot 3 — Bots du Battle Royale côté serveur (3a plomberie, 3b IA)

**3a** : tout sauf le contenu de `decider` : `JoueurSalle.bot`, fabrique `nouveauJoueur`, `ajouterBot` / `retirerBot`, hôte, `lancerPartie` corrigé, fin de partie, statistiques, quotas, `refus{lancer}`,
exclusions de voix / killcam / stats, test de charge agrégé, `scripts/fps/protocole_parties.mjs` (scénario « BR solo avec bots »), et des bots **scriptés** (ils marchent en ligne droite vers le centre de la zone et tirent
mal) pour que le BR solo soit jouable avant l'IA. **3b** : `decider` complet (navigation, combat, niveaux), budget global d'A\*, variable d'essai `PDJ_FPS_BR_BOTS_ESSAI`.

**Crée** : `lib/fps/bots-br.ts` (cerveau PUR) + `bots-br.test.ts`, `lib/fps/match-br-bots.ts` (câblage) + `match.br-bots.test.ts`.
**Modifie** : `lib/fps/match-contexte.ts` (`JoueurSalle.bot?`, `ContexteSalle.ajouterBot`, `retirerBot`, `recevoir`, `nouvelIdBot`, `nombreHumains`, interface
`ButinBr` : `objets()`, `stock(id)`), `lib/fps/match.ts` (fabrique privée `nouveauJoueur(id, pseudo, maintenant)` qui crée AUSSI `suivi`, réutilisée par `connecter` et `ajouterBot` ; `ajouterBot`, `retirerBot` (nettoie
`table`, `suivi`, `mortT`), `nombreHumains()`, exclusion des bots de l'éviction d'inactivité `match.ts:~1560`, `JoueurPublic.bot` dans `joueursPublics`, exclusion des bots de `infoTueur` pour les stats), `lib/fps/voix.ts`
(`ciblesVoixBr`, `LiensVoixKillcam` ignorent `estIdBot`), `lib/fps/match-br.ts`,
`lib/fps/match-br-butin.ts`, `lib/fps/match-br-vol.ts` (si nécessaire), `lib/fps/match.br.charge.test.ts`, `serveur-fps/src/index.ts` (SEULEMENT :
`PDJ_FPS_BR_BOTS_MAX`, `PDJ_FPS_BR_BOTS_TOTAL`, `PDJ_FPS_BR_BOTS_ESSAI`, `nombreHumains()` à la place de `nombreJoueurs()` dans la fermeture des parties vides, le `joueursCible`, `/sante`
et la condition de tic ; `botsMax`, `botsRestants` et `bots` dans `resumePartie` ; **capacité** : le routage compte humains + bots (`PartieRoutage.joueurs` = membres de `table`), car `Salle.connecter` refuse à
`table.size >= BR.joueursMax` par `erreur{plein}` que `diffuser` transforme en fermeture de socket (`index.ts:381`) : un arrivant doit recevoir `refus{plein}` ou devenir spectateur, jamais être déconnecté ;
les bots sont plafonnés à `joueursMax − humains − 1`). `scripts/fps/protocole_parties.mjs` (scénario BR solo avec bots).
**NE touche PAS** : `protocole.ts`, `salons.ts`, `parties.ts`, tout le rendu (`rendu*.ts`, `jeu*.ts`, `lib/tigre3d/**`), `app/**`, la suspension (`suspension.ts` et
les parties de `match.ts` qui lui sont propres).

Fonctions PURES de `bots-br.ts` (noms recommandés, signatures figées) :
```ts
export interface ParamsBot { reactionMs: number; sigmaDeg: number; rotationMax: number; rafaleMax: number; pauseMs: number; agressivite: number }
export const NIVEAUX_BOT: Record<Difficulte, ParamsBot>;
export type EtatBot = "atterrir" | "fouiller" | "zone" | "combat" | "soigner" | "fuir";
export interface MemoireBot { etat: EtatBot; cible: string | null; chemin: Vec2[]; cheminT: number; dernierTirT: number; rafale: number; coinceDepuis: number; sautT: number; /* … */ }
export interface Percu { id: string; p: Vec3; vitesse: Vec3; distance: number; visible: boolean }
export interface Consignes { entrees: Entrees; lacet: number; tangage: number; tirer: boolean; recharger: boolean; changerArme?: SlotArme;
                             ramasser?: number; utiliser?: "bandage" | "potion"; sauter: boolean; ouvrirParachute?: boolean }
export function decider(m: MemoireBot, e: EntreeCerveau, p: ParamsBot, alea: () => number): { m: MemoireBot; c: Consignes };
export function capVers(dx: number, dz: number): number;                                   // convention de pasChute
export function entreesDepuisDirection(dirX: number, dirZ: number, lacet: number): { avant: number; droite: number };   // avant = (−sin, −cos), droite = (cos, −sin)
export function limiterRotation(actuel: number, voulu: number, dtS: number, max: number): number;
export function bruitVisee(lacet: number, tangage: number, p: ParamsBot, distance: number, vitesseCible: number, alea: () => number): { lacet: number; tangage: number };
export function choisirCible(percus: readonly Percu[], moi: Vec3, p: ParamsBot): Percu | null;
export function choisirButin(objets: ReadonlyMap<number, ObjetBr>, moi: EtatBotPublic, composante: ReadonlySet<number>): number | null;
export function choisirAtterrissage(points: readonly Vec3[], deja: readonly Vec3[], alea: () => number): Vec3;
export function instantDeSaut(avion: { debutT: number; finT: number; depart: Vec3; cap: number; vitesse: number }, cible: Vec3, alea: () => number): number;
export function etiqueterComposantes(libre: ArrayLike<number>, largeur: number, hauteur: number): { etiquette: Uint8Array | Uint16Array; principale: number };
export function nomsDeBots(n: number, pris: readonly string[], alea: () => number): string[];   // noms sans chiffres finaux, uniques
```
`match-br-bots.ts` : sous-service de `match-br.ts` branché comme `match-br-vol.ts` / `match-br-butin.ts` via `ContexteSalle` ; garde les handles `vol` et
`butin` ; `creer(n, difficulte, t)` crée les bots PUIS **`lancerPartie` relit `ctx.joueurs()`** : `match-br.ts:286-290` capture aujourd'hui `const salle = ctx.joueurs()` AVANT le test `salle.length < joueursMin` (287) et
avant la boucle `for (const o of salle)` (290) ; créer les bots « avant la boucle » ne les mettrait donc pas dans `salle` (ni admis, ni `remettreAZero`), et en solo `1 < joueursMin` retournerait `[]` avant toute création.
Ordre exact : (1) valider `humains + bots ≥ joueursMin` et `humains ≥ 1` sur des COMPTES, sinon `refus{lancer}` ; (2) `conflitDeNoms` sur les humains ; (3) créer les bots ; (4) `const salle = ctx.joueurs()` relu ;
(5) boucle d'admission ; (6) `nbObjetsPour(salle.length)` et `echelleDureeZone` sur cette liste relue. `tic(t)` fait tourner les cerveaux sur une COPIE de la liste (réentrance : `ctx.recevoir` → `infliger` → `br.surMort`
pendant `Salle.tic`) et **collecte les `Sortie[]` renvoyées par chaque `ctx.recevoir(bot, msg)`** pour les RENDRE à `br.tic` puis à `Salle.tic` (diffusion de `tir`, `degats`, `mort`, killcam : sans cela les tirs des
bots ne sont jamais diffusés) ; un seul A\* par tic pour tout le serveur (budget global, §1.4) ; `retirerTous()` dans `retourLobby`.

Modifications de `match-br.ts` : `lancerPartie` lit `msg.bots` / `msg.difficulte` (clamp §1.3, ordre ci-dessus), compte `humains + bots` contre `joueursMin`, exige un humain ; `demarrerVol` exige un humain monté ;
`terminer` anticipé sans humain en vie (§1.3) ;
`hote()` filtre `!bot` ; `conflitDeNoms` exclut les bots ; `liberer` teste « plus aucun humain » (`ctx.joueurs().length === 0` n'est jamais vrai avec des bots) ;
`retourLobby` retire les bots (`ctx.retirerJoueur` ne suffit pas, il ne supprime pas de `table`) ; `resume()` compte les humains et publie `bots` ;
`nonComptee` si bots ; `estPseudoCompte` / `appliquerPartie` ignorent les bots ; `LigneBilanBr.bot`.

Tests vitest :
- `bots-br.test.ts` (pur) : `capVers` / `entreesDepuisDirection` cohérents avec `pasChute` ; `limiterRotation` ; le bruit croît avec la distance ; `decider`
  enchaîne atterrir → fouiller → zone → combat sur un scénario scripté ; priorité de butin ; `etiqueterComposantes` sur une grille jouet ; `nomsDeBots` unique et
  sans chiffre final ; Entrée plus lent / moins précis que Goulaf (statistique sur une graine fixe).
- Test de **crash** : un bot qui envoie `etat` n'est jamais absent de `suivi` ; `retirerBot` nettoie `suivi` et `mortT`. Test de **collecte** : un tir de bot produit un `tir` / `degats` dans les `Sortie[]` de `Salle.tic`.
- Test de **lancement** : solo + `bots` absent → 11 bots, `bots:0` → `refus{lancer, bots}`, `bots:2.5` / `"3"` / NaN traité comme absent, quota global épuisé → `refus{lancer, limite}`, humain pas monté au bout de 30 s → `retourLobby`
  (jamais de combat de bots sans humain), tous les humains morts → fin 15 s plus tard avec bilan, spectateur venu regarder qui garde la salle ouverte.
- Test **voix / stats** : `ciblesVoixBr` n'inclut aucun `b<n>` ; le tueur-bot n'ouvre aucun `LiensVoixKillcam` ; `infoTueur` d'un bot n'a pas de stats.
- Test **capacité** : 49 humains + bots ≤ 50, un arrivant à 50 reçoit `refus{plein}` et non une fermeture de socket.
- Test **mouvement** : 60 s simulées, aucun `recevoirEtat` du bot refusé (budget de distance, `seq`).
- `match.br-bots.test.ts` (vraie `Salle` BR, `construireMondeBr` sur le vrai `scene.json`, horloge simulée) : lancement solo avec 1 humain + bots (`lancerPartie{bots}` et
  remplissage auto sans `bots`) ; les bots rejoignent l'avion, sautent, atterrissent, ramassent une arme ; un bot tue un humain immobile (kill crédité, `+50 PV`, killcam :
  `mort.tueur`, le tueur figure dans le snap avec `vise` / `recharge`, journal `tir`/`degats` avec `ts`) ; un humain tue un bot (rejeu de latence valide) ; la partie
  n'est pas comptée (`nonComptee`, `appliquerPartie` n'est pas appelé pour les bots) ; l'hôte reste l'humain ; le dernier humain qui part referme la partie sans
  statistique et retire les bots ; un bot n'est pas évincé pour inactivité (20 s simulées sans `etat` externe) ; `nombreHumains()` ; capacité humains + bots ≤ 50 ;
  `PDJ_FPS_BR_BOTS_MAX = 0` : `bots` ignoré.
- `match.br.charge.test.ts` (à lancer SEUL) : bloc 15 bots + 1 humain, tic moyen ≤ 2 ms hors pics, aucun A\* > 50 ms, snap ≤ 10,5 Ko à 50 joueurs.
- `serveur.charge-agregee.test.ts` (à lancer SEUL, fin du lot 3a) : 1 arène avec ses services + 3 parties de zombies à la manche 20 + 4 parties BR avec 11 bots ; moyenne et p99 d'un tic, RSS ; fixe les valeurs par défaut des plafonds
  (§3, intro) ; chaque A\* ≤ 3 000 nœuds, au plus un par tic toutes salles confondues.

Critères d'acceptation (3a puis 3b) : un client WebSocket nu lance seul `lancerPartie{}` en BR, reçoit 11 bots (`presence` avec `bot: true`, ids `b<n>`), la partie atteint la fouille,
les bots tirent sur lui (dégâts `degats` reçus ; en essai déterministe `PDJ_FPS_BR_BOTS_ESSAI=agressif` : graine fixe, apparition à moins de 60 m du joueur) ; la zone tue un bot qui l'ignore ; aucune statistique écrite ; `/sante.br` ne compte que des humains ;
`npx vitest run lib/fps` vert (charge à part).

### Lot 4 — Rendu du tigre bipède armé (client)

**Spike préalable (avant tout le lot)** : un bot local qui marche à 3, 5 et 7 m/s, en latéral, en recul et sous parachute, captures et mesure du glissement des pieds ; il fixe `VITESSE_BOT_M_S`
(§1.4) et la voie (bride de vitesse ou allure bipède dédiée). Mesure en navigateur du coût CPU de 6 puis 12 clones (budget ≤ 3 ms par image).

**Crée** : `lib/fps/bot-tigre-anim.ts` (PUR) + `bot-tigre-anim.test.ts`, `lib/fps/rendu-bots.ts`, `scripts/fps/captures_bots.mjs` (déplacé du lot 6 : il exploite le crochet `__arene.avatarBot` du lot 4).
**Modifie** : `lib/tigre3d/corps.ts` (SEULEMENT `allureMax` optionnel de `Consignes`, une ligne + le test existant de `corps`), `lib/fps/rendu.ts` (SEULEMENT l'export
`creerArmeBot` dérivé de `creerModeleArmeMonde`, éventuellement `Y_PSEUDO`), `lib/fps/jeu.ts` (SEULEMENT `creerAvatarDistant`, `dispose`, et un crochet de développement `__arene.avatarBot(id, opts)` qui
pose un bot local pour les captures).
**NE touche PAS** : serveur (`match*.ts`, `serveur-fps/**`), `protocole.ts`, `salons.ts`, `app/**`, le reste de `lib/tigre3d/**`, `rendu-tigres.ts` / `rendu-zombies.ts`
(on les imite, on ne les modifie pas), la suspension.

Fonctions PURES :
```ts
// lib/fps/bot-tigre-anim.ts
export const ECHELLE_BOT = 2.3;
export const DECALAGE_RACINE = 0.274;                 // racine en avant des pieds, en unités modèle
export interface EntreeBot { vitesse: [number, number]; lacet: number; tangage: number; tir: boolean; recharge: boolean; posture: string; dtS: number }
export function creerCorpsBot(graine: number): { corps: Corps; couche: Couche };
export function avancerBot(b: { corps: Corps; couche: Couche }, e: EntreeBot): void;     // consignes : allureMax 1, vitesseImposee plafonnée, couche « debout »
export function ciblesMains(arme: { prise: Vec3; garde: Vec3 | null; deuxMains: boolean }, dirVisee: Vec3, tangage: number, kick: number): { avG: Vec3; avD: Vec3 };
export function capDuCorps(lacet: number, vitesse: [number, number], capActuel: number, dtS: number): number;   // ±50° de lacet
export function origineXBot(xAnim: number): number;                                       // xAnim − DECALAGE_RACINE
// lib/fps/rendu-bots.ts
export class FabriqueBots { constructor(renderer, chargeur); creerAvatarBot(couleur: number, pseudo: string): AvatarJoueur; dispose(): void }
```
Tests : `bot-tigre-anim.test.ts` — tête ≈ 2,0 ± 0,15 m et torse dans r = 0,475 (vrai GLB, vrai squelette, comme `batte.test.ts`) ; `manque` des bras < 5 mm pour chaque arme
de `STATS` ; pieds sans glissement **en avant** (< 0,1 mm/image, comme Macron) et, **à `VITESSE_BOT_M_S`**, à reculons (< 0,2 mm/image en moyenne, 8 mm au pire) et de côté (≤ `GLISSEMENT_MAX_M_S`, vitesse bornée par `vitesseMaxSelonDirection`, cf. §1.5 « Résultat du spike ») ; hanches sur `p` ; l'allure ne dépasse jamais le trot (`allureMax`) ; aucune position NaN après 10 s de
mouvements aléatoires ; `corps.test` existant inchangé hors `allureMax`.

Critères d'acceptation : capture 1280×720 d'un bot local immobile / marchant / tirant / rechargeant / mort / sous parachute avec chacune des 5 armes principales
(`scripts/fps/captures_bots.mjs`, écrit dans ce lot) ; la hitbox de tir colle au rendu (test mesuré) ; pool de 6 GLB (12 si le budget de 3 ms/image tient), au-delà fil de fer ;
`libererModele` jamais appelé ; contexte WebGL libéré à la sortie de l'arène ; `npx vitest run lib/fps lib/tigre3d` vert.

### Lot 5 — UI : lobbies, parties, bots (5a parties, 5b bots)

**5a** (après le lot 1, en parallèle du lot 2) : `useArene` (`partie` pour tous les modes), `lobby-modele.ts`, `contrats.ts`, `ChoixMode`, `LobbyZombies`, `Arene` (bouton « Créer une arène » / « Changer d'arène », envoi de
`mode{arene, partie:"auto"}` avant `rejoindre`, redirection sur `refus{rejoindre, plein, alternative}`), `ListeParties`, `Agroparc3D` (`rejoindrePartie` / `creerPartie`). Le premier `zpause` mémorisé et les boutons de pause viennent du lot 2.
**5b** (après 3a) : réglage des bots du `LobbyBR`, étiquette BOT, bilan. L'ensemble de la liste ci-dessous se répartit ainsi.

**Crée** : `app/components/arene/ListeParties.tsx` (partagé), tests `lobby-modele.test.ts`.
**Modifie** : `app/components/arene/useArene.ts` (`partie` / `partieRef` pour tous les modes à la place de `partieBr`, `case "mode"` généralisé, `choisirMode(m, partie?)`,
`texteRefus` pour `limite` en arène et zombies et pour `lancer` / `bots` / `limite`, `connexionPerdue` renvoie `modeVoulu` ET `partieVoulue`, `lancerPartie(difficulte, bots?)`, `zpause` mémorisé pour l'affichage
« en pause » du lobby), `lobby-modele.ts` (`lignesParties(mode, listes, actuelle)` remplace `lignesPartiesBR`, `compteurMode` par somme des parties), `contrats.ts`
(type `Salons` : `listes?`, seulement ce type), `ChoixMode.tsx`, `LobbyZombies.tsx` (section « Parties », « Créer ma partie », pastille « en pause »), `LobbyBR.tsx`
(réglage « Bots » 0..`botsMax` pour l'hôte, défaut 11 en solo, niveau = difficulté existante, « Lancer » **désactivé avec un message** quand 1 humain et 0 bot, quota restant `botsRestants` affiché, mention « Entraînement : partie non comptée », bots listés avec une étiquette BOT),
`Arene.tsx` (liste dès qu'il y a plus d'une partie ; **« Créer une arène » toujours disponible** si le plafond le permet, sinon l'arène n'aurait aucune UI pour exister), `Agroparc3D.tsx` (`regarderBr` / `creerPartieBr` factorisés en `rejoindrePartie(mode, id)` / `creerPartie(mode)`,
crochets `window.__arene.creerPartie(mode)` / `rejoindrePartie(mode, id)` en plus des anciens), tableau des scores et bilan BR (étiquette BOT, `LigneBilanBr.bot`).
**NE touche PAS** : `jeu.ts`, `reseau.ts`, `rendu*.ts`, `lib/fps/match*.ts`, `protocole.ts`, `salons.ts`, `serveur-fps/**`, la logique de pause (les boutons de pause du menu viennent du lot 2).

Comportement : liste « Parties » (id, phase, joueurs / capacité, hôte, « en pause », « en cours : manche 7 ») avec « Rejoindre » (lobby) / « Rejoindre » (en cours, zombies :
arrive à la prochaine pause entre manches ; une partie nommée contourne `accueille`, §1.2) / « Regarder » (BR), et « Créer ma partie » ; carte du choix du mode « 2 parties · 9 joueurs » ; un client v11 devant un ancien serveur
(pas de `listes`) retombe sur l'ancien comportement (une seule partie, `parties` pour le BR). Texte de refus `limite` : « Trop de parties en cours, rejoignez-en une ».

Tests : `lobby-modele.test.ts` — `lignesParties` par mode, repli sans `listes`, compteurs, actions possibles selon la phase ; `zombies-ui.test.ts` et `arene-lobby.test.ts` existants
adaptés ; libellés des refus.

Critères d'acceptation : deux onglets, deux joueurs distincts, chacun « Créer ma partie » en zombies, lancent deux parties qui ne se voient pas ; idem arène (`ar1` pleine → l'arrivant bascule dans `ar2`) ; BR : réglage des bots,
lancement seul avec bots ; ChoixMode et listes à jour en direct ; mobile : lobbies lisibles (cibles tactiles ≥ 40 px, tokens `--ag-*`) ; `npm run build` passe.

### Lot 6 — E2E, scripts, documentation

**Crée** : `scripts/fps/e2e_br_bots.mjs` (un Chromium, BR solo avec bots à durées raccourcies, **déterministe** par `PDJ_FPS_BR_BOTS_ESSAI=agressif` (graine fixe, apparition proche du joueur) :
bots dans le snap, un bot tue ou blesse le joueur, killcam sur un bot, partie non comptée, captures du tigre bipède armé dans `E2E_OUT`). **Enrichit** `scripts/fps/protocole_parties.mjs` (créé au lot 1) :
deux parties d'arène, deux de zombies, deux de BR en parallèle ; pause globale ; **pause + déconnexion / reprise réseau de A** ; **`zpause` rejoué pendant la levée** ; BR solo
avec bots ; **bot tueur → killcam → spectateur → fin** ; plafonds ; refermeture ; reprise réseau qui retrouve sa partie ; ancien client v10. (`scripts/fps/captures_bots.mjs` est créé au lot 4.)
**Modifie** : `scripts/fps/e2e_zombies.mjs` (étape pause : A suspend, B reçoit `zpause` et les `z<n>` n'avancent pas pendant 3 s, B reprend, `PDJ_FPS_ZOMBIES_COMPTE_MS=0` ;
étape deux parties parallèles), `scripts/fps/protocole_br_parties.mjs` (`bonjour v:` : `VERSION_PROTOCOLE`/11, déjà fait au lot 2) ; `e2e_br.mjs` ne code pas la version en dur, vérifier seulement que les ids `br<N>` restent inchangés, `e2e_arene_v2.mjs` / `e2e_arene_tigres.mjs` /
`captures_zombies.mjs` (version du protocole si câblée en dur, atterrissage dans `ar1`), `serveur-fps/README.md` (variables, déploiement serveur d'abord), `CLAUDE.md` (sections « Arène FPS »,
« Mode zombies », « Mode Battle Royale », `VERSION_PROTOCOLE = 11`, parties parallèles, pause, bots, nouveaux tests et scripts, variables d'environnement), mémoire projet si pertinent.
**NE touche PAS** : le code source (`lib/**`, `app/**`, `serveur-fps/src/**`) sauf pour corriger un bug trouvé, à signaler dans le résumé du lot.

Critères d'acceptation : les cinq scripts passent (Node 22, Playwright, ports libres, jamais 8787), `protocole_parties.mjs` en quelques secondes ; les captures du tigre bipède sont
dans `docs/medias/` ; `CLAUDE.md` décrit les 3 fonctionnalités sans contredire les sections existantes.

---

## 4. Cas limites et pièges

**Pause**
- `PhaseZombies "pause"` ≠ suspension : ne jamais réutiliser le champ `phase` ni un nom `pause*` pour la suspension.
- Une suspension qui se prolonge pendant que le jeton de reprise réseau expire (60 s tant que la salle est suspendue, 20 s sinon) : le joueur coupé est retiré (`liberer`) ; si cela ramène la partie en `fin` / `lobby`, lever la suspension.
- Un client gelé dont la socket tombe, ou qui quitte la salle par `mode`, ne doit JAMAIS rester gelé : `zpause` à chaque `bienvenue`, `gele` remis à zéro à `bienvenue` / `quitter` / `dispose` (§2).
- Un `zpause` qui arrive avant `lancerJeu` est mémorisé par `useArene` et appliqué à la création du jeu ; le serveur refuse d'ailleurs la suspension avant la fin du chargement.
- Solo : jamais de cooldown, de plafond total ni de `maxMs` ; un refus de pause est affiché, jamais silencieux.
- `ping` / budget de distance : le seau à jetons des états se remplit en temps virtuel (rien pendant la pause, une téléportation reste impossible) ; `delaiMs` (ping, griffe) reste réel.
- Annonces vocales (`speechSynthesis`), `setTimeout` de `sons.ts:649,661,1470` : cosmétiques, à suspendre au mieux. Animations CSS du HUD : `animation-play-state: paused` ;
  les hooks `useEphemere` (HudArene.tsx:129) restent en temps réel (cosmétique).
- Un client qui perd le pointer lock par alt-tab ne suspend rien à plusieurs : seule la demande explicite compte.
- Arène et BR n'ont pas de pause (la demande ne vise que les zombies) ; `pauseZ` y est refusé.
- `bienvenue.maintenant` virtuel + `recaler` : sans `recaler` à chaque `bienvenue`, un client qui change de salle (`mode`) ou se reconnecte après une pause garde un décalage faux (`precis` empêche `amorcer`).
- Le test de non-régression « aucune horloge réelle dans le jeu » est la garde : un futur `Date.now()` dans un service casse silencieusement la pause.

**Parties parallèles**
- Aucun `Monde` partagé entre salles (mutable, navigation en cache par `Monde`). Aucun objet d'options muté partagé (`optionsArene`, `circuits`, `cachettes` sont en lecture seule : le vérifier).
- Précalculer au démarrage (avant `listen`) les mondes de référence et la `grilleNav` BR (`libre` ET `etats`), limiter les créations (délai, IP, disjoncteur de tic), réserver un emplacement par mode : sans cela un client qui crée / quitte en boucle gèle toutes les parties.
- Les tampons de `collision.ts` sont des scratch synchrones : pas de réentrance entre salles tant que les salles tiquent l'une après l'autre dans le même thread (ne PAS paralléliser).
- Coût : la durée du tic devient la somme des salles ; surveiller `ticMaxMs` / `ticsLents` de `/sante` (seuil 8 ms) ; plafonds par env. `CONNEXIONS_TOTAL_MAX` (160) et par IP sont globaux.
- Hall `ar1` : l'arène permanente reste le point d'entrée de tout client (présence du Palantir). `ar2`… sont créées sur demande et refermées vides ; ne jamais fermer `ar1`, `z1`, `br1`.
- Ids de parties vs ids de tigres `z<n>` : espaces de noms différents, jamais mélangés dans un `switch` sur un préfixe.
- Une partie avec uniquement des membres « en suspens » n'est pas vide ; une partie BR avec uniquement des bots l'est (`nombreHumains()`) : fermée, bots retirés.
- Statistiques BR communes à toutes les parties (persistance partagée) : inchangé.
- Anciens clients (v8 à v10) : une seule partie par mode (celle où le routage les place), `salons.parties` BR seulement, zombies fermés aux < v11.
- Un client dont la partie nommée a disparu entre l'affichage de la liste et le clic : routage par défaut, pas d'erreur.

**Bots**
- Éviction d'inactivité (`match.ts:~1560`, `BR.inactifMs` 20 s) : exclure `bot`, sinon le bot est retiré sans `etat` frais.
- `hote()` = `ctx.joueurs()[0]` : filtrer les bots ; les humains précèdent les bots dans `table`.
- `conflitDeNoms` / `nomDeBase` retirent les chiffres finaux : « Tigre1 » et « Tigre2 » seraient en conflit ; les noms de bots n'ont pas de chiffres, `pseudoUnique` suffixe les doublons : pas de doublon à fabriquer.
- `liberer` : `ctx.joueurs().length === 0` n'est jamais vrai avec des bots → partie fantôme ; tester « plus d'humain ».
- Réentrance : `ctx.recevoir` depuis `br.tic` appelle `infliger` → `br.surMort` pendant `Salle.tic` ; itérer sur une copie, ne pas modifier la liste des bots en cours d'itération, et RENDRE les `Sortie[]` de chaque `recevoir` (sinon aucun tir de bot n'est diffusé).
- Fabrique `nouveauJoueur` : un bot sans entrée dans `suivi` plante `recevoirEtat` (`match.ts:1043`, `suivi.get(j.id)!`).
- Ordre de `lancerPartie` : relire `ctx.joueurs()` APRÈS la création des bots, sinon ils ne sont ni admis ni remis à zéro et le solo retourne `[]`.
- `demarrerVol` ne démarre pas sans humain monté ; la partie se termine 15 s après la mort du dernier humain.
- Vitesse des bots ≠ vitesse des joueurs (`VITESSE_BOT_M_S`) : sinon les pieds du tigre bipède glissent.
- Un seul A\* par tic pour TOUT le serveur, borné à 3 000 nœuds ; grille précalculée au démarrage.
- `placerJoueur` met `j.seq = -1` : le premier `seq` du bot est 0 ; le premier `etat` après l'atterrissage doit être entier (dans le budget de distance) : le bot l'envoie depuis `j.p`.
- `histo` du bot doit être alimenté à chaque mise à jour (`recevoirEtat`, `match.ts:1090`) sinon les tirs d'un humain sur un bot en mouvement échouent (rejeu de latence).
- `tir.o` = œil réel, `tir.d` = axe réel : la killcam recale la caméra dessus, les angles du bot dans `etat` doivent donc suivre cet axe (rotation lissée, jamais de téléportation d'angle).
- `ping` d'un bot = 0 : pas de ping fictif ; `decalageVue(0, interp)` suffit pour la vue empruntée.
- Cible inaccessible (toits, cases scellées) : un A\* échoue en 50–450 ms ; filtrer par composante connexe AVANT de planifier, au plus un A\* par tic, A\* borné.
- Le serveur ne met jamais `accroupi` à un bot ; il remplit `vise` / `recharge` du snap (additifs) pour que la vue empruntée soit exacte.
- Munitions des armes principale et secondaire : comptées côté client pour les humains (le serveur ne suit que `munSpeciale`) ; le bot les simule lui-même, sinon il tirerait sans fin.
- `PDJ_FPS_BR_MIN_JOUEURS` reste réservé aux essais ; ne pas l'abaisser pour permettre le solo (le solo passe par les bots).
- Clients v8 à v10 : un bot s'affiche comme un humanoïde fil de fer normal (id `b<n>` ignoré) ; acceptable (additif).
- Voix : `relayerVoix` exige `dest.voix` ; `ciblesVoixBr` et `LiensVoixKillcam` excluent `estIdBot` (cf. §1.3), sinon les 8 voisins vocaux sont des bots et le client tente des offres WebRTC vers `b<n>`.
- Une coupure du seul humain d'une partie solo avec bots ferme la partie (`liberer`) : cohérent avec la règle du BR (« reconnexion en cours de partie impossible », hors périmètre).
- Rendu : jambes courtes, qualité visuelle du trot bipède à valider en capture ; budget d'animation à mesurer en navigateur (les chiffres de cette spec viennent de vitest) ; ne jamais appeler `libererModele`.
- Premier lancement avec bots : ≈ 0,45 s de `grilleNav` par monde (voir §1.4) ; mesurer `ticMaxMs`.

## 5. Déploiement

1. Reconstruire et redéployer le serveur (`vps:/opt/pdj-fps`) AVANT le client v11 : il sert 8, 9, 10 et 11 ; la salle des zombies refuse les clients < 11 avec `erreur{version}` (« rechargez la page »).
2. Ne jamais `docker compose down -v` (volume `pdj-fps-donnees`, TOP 1 du BR).
3. Après déploiement : surveiller `/sante` (`ticMaxMs`, `ticsLents`, `alerte`, `parties`), la mémoire du conteneur (1 vCPU, 512 Mo) avec 2+ parties de chaque mode, et ajuster `PDJ_FPS_*_PARTIES` / `PDJ_FPS_PARTIES_TOTAL` / `PDJ_FPS_BR_BOTS_*`.

## 6. Variables d'environnement ajoutées

| Variable | Défaut | Rôle |
|---|---|---|
| `PDJ_FPS_ARENE_PARTIES` | 2 | parties d'arène en même temps |
| `PDJ_FPS_ZOMBIES_PARTIES` | 3 | parties de zombies en même temps |
| `PDJ_FPS_BR_PARTIES` | 4 (existant) | parties de BR en même temps |
| `PDJ_FPS_PARTIES_TOTAL` | 6 (provisoire, 8 après mesure) | plafond toutes salles confondues (une création par mode reste réservée) |
| `PDJ_FPS_CREATION_TIC_MAX_MS` | 12 | création de partie refusée si `ticMaxMs` récent dépasse ce seuil |
| `PDJ_FPS_REPRISE_SUSPENDUE_MS` | 60000 | délai de reprise réseau d'un membre d'une salle suspendue |
| `PDJ_FPS_ZOMBIES_SUSPENSION_MAX_MS` | 300000 | durée max d'une suspension (plusieurs humains seulement) |
| `PDJ_FPS_ZOMBIES_COMPTE_MS` | 3000 | compte à rebours de reprise (0 en e2e) |
| `PDJ_FPS_ZOMBIES_SUSPENSION_COOLDOWN_MS` | 10000 | délai entre deux suspensions d'un joueur (plusieurs humains seulement) |
| `PDJ_FPS_ZOMBIES_SUSPENSION_TOTAL_MS` | 900000 | pause cumulée max par partie, remise à zéro à chaque partie (plusieurs humains seulement) |
| `PDJ_FPS_BR_BOTS_MAX` | 20 | bots par partie (0 = coupés) |
| `PDJ_FPS_BR_BOTS_TOTAL` | 24 (provisoire, 40 après mesure sur le VPS) | bots toutes parties confondues |
| `PDJ_FPS_BR_BOTS_ESSAI` | absent | `agressif` : graine fixe et apparition proche du joueur, pour les e2e déterministes |

---

## 7. Révisions (revue critique du 2026-10-29)

Trois critiques croisées avec le code ont été intégrées ; chaque point a été relu dans le source avant d'être retenu. Ce qui a changé :

**Corrigé parce que faux dans le code**
- Lot 3 : `match-br.ts:286-290` capture `ctx.joueurs()` avant le test `joueursMin` et avant la boucle ; l'ordre de `lancerPartie` est réécrit (comptes, noms, création des bots, relecture de la liste, admission).
- Les bots ne passaient pas par `suivi` (`match.ts:662`, `1043` : `TypeError` au premier `etat`) : fabrique `nouveauJoueur`, nettoyage de `retirerBot` (`suivi`, `mortT`).
- « Aucun `Math.random` » : faux (`zombies-secret.ts:289`, `bus-c3.ts:94, 183`, `frappe-aerienne.ts:70`, valeurs par défaut d'un paramètre `alea`, jamais utilisées car `Salle` injecte `this.alea`) ; garde d'horloge élargie à tous les `lib/fps/*.ts` non client et à `new Date(`, `setTimeout`, `setInterval`.
- Références de lignes : `peutLancerGrenade` `jeu.ts:1224`, `frame` `3232`, `allurePourVitesse` `corps.ts:271`, `materiauLisere` `rendu-tigres.ts:273`, `attraper` `rendu.ts:1647` (fermeture locale non réutilisable), `localToWorld` `1687-1691` / `1405-1409`, `creerParachute` `rendu-avion.ts:143`, `histo` `match.ts:1090`, `tracer` `tir.ts:61`.
- `e2e_br.mjs` ne code pas la version en dur, seul `protocole_br_parties.mjs:42` le fait (lot 6 corrigé) ; `creerModeleArmeMonde` (`rendu.ts:1118`) existe déjà : `creerArmeBot` en dérive ; `decisionPartie` utilise `salleActuelle` ; `PartieRoutage.phase` devient `string`.
- La vitesse des bots : `MOUV.marche` 9 / `sprint` 12,5 m/s dépassent la plage du trot (≈ 1,8–3,5 m/s à l'échelle 2,3) : `VITESSE_BOT_M_S` propre aux bots, déplacement latéral/recul lent, spike obligatoire avant le lot 4.
- `reactionMs` 450 dépassait `BR.rewindMaxMs` = 400 : plafonné à 350, faiblesse du débutant par `sigmaDeg`.
- `GrilleNav` porte aussi `etats` (`tigre-arene.ts:278`) : copier `libre` et `etats`.

**Pause**
- Solo exempté de `cooldownMs`, `totalMs` et `maxMs` ; auto-suspension exclut `premiereFois`, lobby, fin, killcam ; décision « seul » prise par le serveur ; refus affiché.
- Compte à rebours annulable une seule fois, cooldown appliqué à l'annulation, `totalMs` appliqué à la suspension en cours ; `reinitialiserPartie()` à chaque lancement et `retourLobby`.
- Liste BLANCHE des messages acceptés salle suspendue (au lieu d'une liste noire) + test exhaustif sur `MessageClient["t"]`.
- `zpause` émis à CHAQUE `bienvenue` (suspendue ou non) ; `gele` remis à zéro à `bienvenue` / `quitter` / `dispose` ; snap et `zombies{etat}` ciblés pour un arrivant en pause ; `zpause` mémorisé avant `lancerJeu` ; pause refusée avant la fin du chargement ; seau de distance remis à plein à la levée.
- Client : module pur `gel.ts` testé ; horloge qui ne recule pas au `figer` ; raccord à la levée ; cuisson de grenade indexée sur l'horloge serveur ; reprise réseau portée à 60 s tant que la salle est suspendue.
- Vocabulaire : `Suspens` / `enSuspens` d'`index.ts` renommés `SessionCoupee` / `coupees` (clé JSON de `/sante` gardée) ; compte à rebours et levée à la place de « reprise » (`compteMs`, `zpause.compte`, `PDJ_FPS_ZOMBIES_COMPTE_MS`, `demanderLevee`).

**Parties parallèles**
- Arène : choix sur `enJeu` (le hall `ar1` n'est pas une arène de plus), `PARTIE_AUTO`, réservations, `refus{rejoindre, plein, alternative}`, bouton « Créer une arène » ; `capacite` arène = 16.
- Anciens clients (`version < 11`) toujours routés vers la permanente.
- Une création par mode réservée ; plafonds provisoires abaissés (total 6, bots 24) jusqu'à la mesure agrégée ; limites de création (délai de 10 s par client, une partie par IP, disjoncteur sur `ticMaxMs`), précalcul des mondes et de `grilleNav` avant `listen`, phases de snap décalées.
- Tout critère « humains seuls » de `index.ts` migre vers le registre (`attendDansLobby`, `SPECTATEUR_INACTIF_MS`, `resumePartie`, `ouvrirPartie`, `refermerPartiesVides`, `salons()`, `SALLES()`) ; une partie nommée contourne `accueille`.
- Version : le lot 1 n'ajoute que 11 à `VERSIONS_ACCEPTEES` ; `VERSION_PROTOCOLE` et `VERSION_MIN_ZOMBIES` passent à 11 au lot 2 (avec `protocole_br_parties.mjs`). `protocole_parties.mjs` créé dès le lot 1.
- Ordre de fusion avec la spec des aperçus (`apercu`) précisé : celle-ci d'abord, l'aperçu lit les parties permanentes.

**Bots**
- Début : au moins un humain monté ; fin : 15 s après la mort du dernier humain en vie ; spectateurs venus regarder gardent la salle ouverte.
- Capacité : routage humains + bots, bots ≤ `joueursMax − humains − 1`, arrivant jamais déconnecté par `erreur{plein}`.
- Sorties (`Sortie[]`) des `ctx.recevoir` des bots collectées et rendues ; `Number.isInteger` sur `bots` ; `refus{lancer}` explicite ; quota publié (`botsRestants`) ; remplissage auto documenté pour tous les clients ; lobby qui désactive « Lancer » avec 1 humain et 0 bot.
- Exclusion des bots de `ciblesVoixBr`, `LiensVoixKillcam` et des stats de `infoTueur` ; ids décimaux `^b\d+$` (évite la collision `br1`) ; compteur remis à zéro par partie.
- Le bot teste le retour de `recevoir`, borne son `dt` au budget de distance ; un seul A\* par tic pour tout le serveur, 3 000 nœuds, échecs mémorisés ; variable d'essai `PDJ_FPS_BR_BOTS_ESSAI`.
- Rendu : pool de 6 clones par défaut (12 si ≤ 3 ms/image mesurés en navigateur).

**Découpage**
- Lot 3 scindé en 3a (plomberie, bots scriptés, charge agrégée) et 3b (IA) ; lot 5 en 5a (parties, juste après le lot 1) et 5b (bots) ; `captures_bots.mjs` déplacé au lot 4 ; test de charge combiné (arène + 3 zombies + 4 BR avec bots) exigé avant de figer les plafonds.

**Écarté (non fondé ou hors périmètre)**
- Pool de salles recyclées (remplacé par précalcul et limites de création) ; délai de reprise réseau pour une micro-coupure en BR solo (le BR n'a pas de reprise, documenté) ; suspension en arène / BR (hors demande) ; renommage complet de « suspension » (seules les collisions réelles sont levées).
