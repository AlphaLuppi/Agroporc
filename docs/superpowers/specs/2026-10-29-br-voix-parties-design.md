# Battle Royale : chat vocal de proximité, canal des spectateurs, parties multiples — design

Date : 2026-10-29 · Protocole : **inchangé** (`VERSION_PROTOCOLE = 10`), tous les ajouts sont additifs (champs optionnels, un message client `regarder`,
un message serveur `spectateur`). Prime sur `2026-10-28-battle-royale-design.md` là où ils divergent (chat vocal, arrivée pendant une partie).

## Demande

1. Le chat vocal de proximité dans le Battle Royale (jusqu'ici réduit au lien de killcam victime ↔ tueur).
2. Les spectateurs (éliminés) se parlent entre eux, sans que les joueurs en vie les entendent.
3. Quelqu'un qui arrive pendant une partie en cours peut créer sa partie, ou regarder la partie en cours en spectateur.
4. Un rayon du chat vocal plus grand (on devait être trop près pour s'entendre), en arène comme en Battle Royale.

## Chat vocal

- **Rayon** (`VOIX` de `lib/fps/voix.ts`, arène et BR) : volume plein jusqu'à 8 m (4 avant), muet au-delà de 75 m (45 avant), courbe 1,3 (1,6
  avant) : on s'entend nettement à 30 m (gain ≈ 0,6 au lieu de 0,2).
- **Deux canaux en BR** : les joueurs en vie entre eux (proximité), les spectateurs entre eux (éliminés et spectateurs venus regarder, à plein
  volume, sans position). Un joueur en vie n'entend jamais un spectateur, et réciproquement, sauf le lien de killcam (12 s, inchangé : une
  victime et son tueur s'échangent un « bien joué »).
- **Serveur** (`Salle.relayerVoix`, `relaiVoixBr`) : en BR, un signal `voix` (hors `fin`) ne passe qu'entre deux joueurs en jeu de la même
  catégorie (`vivant` égal), ou par un lien de killcam actif. La présence porte `spec: true` pour un joueur en jeu sans être en vie (BR seulement).
- **Client** (`ciblesVoixBr`, `jeu.ts` `ciblerVoixBr`, 4 fois par seconde) : 50 joueurs en maillage complet feraient 1 225 connexions, le client
  choisit donc ses correspondants. En vie : les voisins en vie à moins de `connexionBrM` (85 m), les `voisinsMaxBr` (8) plus proches ; une connexion
  établie tient jusqu'à `deconnexionBrM` (110 m, hystérésis), et toute connexion d'un vivant à moins de 110 m est gardée si c'est lui qui appelle
  (`admis`). Spectateur : les `spectateursMaxBr` (12) premiers spectateurs par identifiant appelés, tous admis. Position inconnue (à bord de
  l'avion) : aucun voisin. `voix-rtc.ts` : `cibler({ voulus, admis })` remplace `restreindre`, `planConnexions(…, admises)` ne ferme que ce
  qui n'est ni voulu ni admis.
- Interface : menu pause « Chat vocal de proximité » en BR (libellé selon vivant / éliminé), indicateur du micro dans le HUD, ligne du canal des
  spectateurs dans l'écran de spectateur (`texteVoixSpectateurs`).

## Arrivée pendant une partie : regarder ou créer sa partie

- **Parties multiples** (`serveur-fps/src/index.ts`) : la salle permanente `br1`, plus des salles créées à la demande (`br2`, `br3`…), chacune
  avec son monde (≈ 90 ms et 2 Mo à la création), refermées dès qu'elles sont vides. Au plus `PDJ_FPS_BR_PARTIES` (4) en même temps.
  Les statistiques (TOP 1) restent communes : le service relit la persistance partagée à chaque lecture.
- **Routage** (`decisionMode` / `choisirPartieBr` de `salons.ts`, PUR) : `mode{mode:"br", partie?}`. Sans partie : le lobby le plus peuplé, sinon
  la première partie qui a de la place (déjà dans une partie BR : écho). `partie: "nouvelle"` (`PARTIE_NOUVELLE`) : reprend une salle vide au
  lobby, sinon en crée une, sinon `refus{mode, limite}`. Jamais en jeu (`refus{mode, lobby}`). L'écho `mode` porte `partie`.
- **`salons.parties`** : toutes les parties (`ResumePartieBr` : id, phase, joueurs, vivants, palier, pseudo de l'hôte), salle permanente en tête ;
  `salons.br` reste le résumé de la salle permanente pour les anciens clients. `/sante.br.parties` les détaille.
- **Regarder** (`regarder` → `spectateur`, `Salle.regarderBr`) : un membre qui ne joue pas la partie en cours (pas admis, ou déjà éliminé) passe
  en jeu SANS être en vie (`JoueurSalle.spectateur`) : il reçoit les snaps comme un éliminé, n'est ni dans le snap ni touchable, n'est pas un
  partant pour le service ; la fin de partie le ramène au lobby comme les autres. Permis au décompte, en vol et en jeu
  (`ServiceBr.peutRegarder`) ; sinon `refus{regarder, lobby}` (ou `deja` s'il est déjà en jeu).
- **Client** : `lancerJeu(…, { mode: "br", spectateur: true })` envoie `regarder` au lieu de `rejoindre` ; à `spectateur`, le jeu devient
  spectateur (`devenirSpectateur` : caméra du joueur suivi, comme un éliminé dont la killcam est passée, bandeau « Spectateur »,
  `HudEtat.spectateurExterne`).
- **Lobby** (`LobbyBR`, `lignesPartiesBR`, `situationLobbyBR.peutRegarder`) : pendant une partie en cours, « Regarder la partie » et « Créer ma
  partie » ; liste « Parties » (dès qu'il y en a plusieurs ou que la mienne est lancée) avec « Rejoindre » (lobby, bilan) ou « Regarder » (en
  cours ; une autre partie : on y va d'abord, puis le jeu se monte en spectateur). Carte du choix du mode : « 2 parties · 17 joueurs ».
  Crochets de développement `window.__arene.regarderBr(id?)`, `creerPartieBr()`.

## Déploiement

Additif : un serveur à jour sert les anciens clients (une seule partie pour eux : celle où le routage les envoie), un client à jour devant un
ancien serveur retombe sur l'ancien comportement (pas de liste de parties, `regarder` ignoré, chat vocal de killcam seulement). Le serveur doit
être redéployé pour que les nouveautés existent.
