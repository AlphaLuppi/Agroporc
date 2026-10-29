# Zombies : inventaire façon Black Ops 1 (v10)

Statut : implémenté (`VERSION_PROTOCOLE = 10`). Prime sur les specs des zombies (v6, v7, v8) là où elles divergent.

## Demande

- Au départ : le pistolet et le couteau.
- Chaque arme achetée au mur ou prise à la boîte s'ajoute : deux armes à feu et le couteau. Ensuite, la nouvelle arme remplace celle qu'on a en
  main. On peut donc porter un fusil à pompe et un sniper.
- Pas d'emplacement en plus : seul un atout donne une troisième arme.
- Les emplacements sont génériques : n'importe quelle arme dans n'importe lequel (plus de « principale », « secondaire », « spéciale »).
- Coup de couteau arme en main. À partir de deux armes, le couteau ne se prend plus seul.
- Le coup de couteau est plus lent avec une arme lourde.

## Règles

### Emplacements

`Equipement` garde ses champs `principale`, `secondaire`, `speciale`, mais en zombies ce sont trois emplacements génériques :
**Arme 1**, **Arme 2** et **Arme 3** (l'Arme 3 seulement avec l'atout Bento). Les types acceptent toute `ArmeFeuId`. L'arène et le BR gardent
leurs catégories.

- Départ : le pistolet dans l'Arme 2 (`EQUIPEMENT_DEPART_ZOMBIES` inchangé), l'Arme 1 vide.
- Nouvelle arme (`slotPourNouvelleArme`, equipement.ts) : elle va dans le premier emplacement vide (Arme 1, Arme 2, puis Arme 3 avec le Bento).
  Sinon elle remplace l'arme en main. Arme blanche en main (une seule arme portée), elle remplace la première arme portée. L'arme remplacée perd
  son amélioration.
- Micro-ondes : l'arme déposée reste écrite dans son emplacement, qu'elle réserve (jamais choisi comme vide ni remplacé). Une arme qu'on n'a pas
  reprise dans les 15 s quitte l'inventaire et libère son emplacement (message `equipement`). On ne peut pas acheter, ni prendre à la boîte, une
  seconde fois l'arme qui cuit (`occupe`). À la reprise, elle revient dans son emplacement. Si c'était l'Arme 3 et que le Bento est perdu
  entre-temps, elle entre comme une nouvelle arme.
- Armes à munitions limitées (railgun, minigun, magnum doré de la boîte, Bazooka au four du grand secret) : en zombies, elles ne quittent jamais
  l'inventaire. Vides, elles attendent les Munitions max. Le serveur ne compte plus `munSpeciale` en zombies : le client compte toutes les
  munitions, comme pour les autres armes.

### Atout Bento (le Mule Kick)

`AtoutId` reçoit `bento` : 4 000 $, courant requis, distributeur dans le Labo (décrochement sud, entre les deux cuves). Perdu à terre comme les
autres atouts, avec l'arme de l'Arme 3 (`speciale` vidée par `Salle.mourir`). La récompense du grand secret donne tous les atouts, Bento compris :
l'Arme 1 garde une arme du joueur (celle en main, sinon une autre arme portée, sinon celle qui cuit), l'Arme 2 reçoit le Rayon Goulaf et
l'Arme 3 le Bazooka au four. Une arme au Micro-ondes qui n'est pas gardée est remboursée (5 000 $) : un Rayon ou un Bazooka reviendrait en
double, une autre arme n'aurait plus de place.

### Arme blanche

- À partir de deux armes à feu portées (`couteauTenable`), l'arme blanche ne se prend plus seule : `main{couteau}` est refusé par le serveur, la
  molette et Q la sautent, et la touche 3 prend l'Arme 3.
- Coup de couteau rapide (touche V, action `couteauRapide`, en zombies seulement) : l'arme s'écarte, la main gauche sort la lame et frappe à
  l'impact (le `coup` part alors, avec la visée de cet instant), puis l'arme revient en joue. La recharge est annulée. Pas de tir, de recharge ni
  de changement d'arme avant la fin. Arme blanche en main, V donne un coup ordinaire.
- Minutage (`lib/fps/coup-rapide.ts`) : une classe de poids par arme (`POIDS_ARME`, `Record` exhaustif).

  | Poids | Armes | Impact | Fin |
  | --- | --- | --- | --- |
  | léger | pistolets, mini Uzi, Perforeuse, rayon, magnum | 0,14 s | 0,5 s (= couteau seul) |
  | moyen | mitraillette, fusil d'assaut, Photocopieuse, Coupe-baguette | 0,2 s | 0,65 s |
  | lourd | pompe, Essoreuse, sniper, Agrafeuse, Brochette, Soufflerie, Grille-pain, railgun | 0,28 s | 0,85 s |
  | très lourd | mitrailleuse, minigun, bazooka | 0,36 s | 1,1 s |

  L'épée multiplie le tout par 1,25. Dégâts, portée et cibles : ceux de l'arme blanche (couteau 150, épée 1 000, trois tigres).
- Serveur : un `coup` reçu arme à feu en main est accepté en zombies, avec l'arme blanche de l'équipement et la cadence `dureeS` de l'arme en main
  (`cadenceOk`, crédit d'un demi-intervalle). Dans l'arène, il est ignoré.

### HUD et invites

- Rack : « Arme 1 / 2 / 3 » (texte pour les lecteurs d'écran), plus d'étiquette « SPÉCIALE », munitions `x/y` partout sauf sans recharge. À partir
  de deux armes, la ligne de l'arme blanche porte `[V]` et « COUP RAPIDE », l'Arme 3 porte `[3]`.
- Invite d'achat : « … (remplace <arme en main>) » quand l'inventaire est plein ; « Au Micro-ondes » pour l'arme qui cuit.

## Protocole

`VERSION_PROTOCOLE = 10`, `VERSIONS_ACCEPTEES = [8, 9, 10]`, `VERSION_MIN_ZOMBIES = 10`. Un client v8 ou v9 garde l'arène et le BR, mais reçoit
`erreur{version}` (« rechargez la page ») s'il demande la salle des zombies (`decisionMode`, salons.ts). Aucun message nouveau : `coup` existe déjà,
et `Equipement` garde sa forme. **Le serveur se déploie avant la fusion du client.**

## Tests

`lib/fps/zombies-inventaire.test.ts` (logique pure, contrôleur client, salle), bloc « (v10) » de `match-zombies.test.ts` (achats, Bento, perte à
terre, Micro-ondes, grand secret), `jeu-zombies.test.ts` (invites), `zombies-ui.test.ts` (rack), `zombies-carte-armes.test.ts` (distributeur),
`salons.test.ts` (version). Bout en bout : `scripts/fps/e2e_zombies.mjs` (touche 3 refusée avec deux armes, coups rapides au pistolet, mini Uzi qui
remplace l'arme en main).
