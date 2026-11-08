/**
 * Anti-flood de Rocket Muche en ligne (lot SERVEUR, PUR : l'horloge est passée à chaque appel). Trois seaux à jetons par connexion (spec § 7) :
 * les ENTRÉES du jeu (120/s, rafale 240), les `ping` applicatifs (5/s, rafale 10) et les ACTIONS du lobby (10/s, rafale 30). Les seaux sont
 * distincts pour qu'un flot de messages de lobby ne prive pas la physique, et inversement. L'excédent est jeté sans fermer la socket ; seul un
 * débit brut aberrant (plus de `floodCoupureParSeconde` messages dans une seconde, qu'aucun client honnête n'atteint) la coupe.
 * `lib/fps/anti-flood.ts` n'est pas touché : ses types de flux sont une liste blanche figée de l'arène.
 */
import { RESEAU } from "./protocole";
import type { AdmettreRocket, ClasseMessage, CreerLimiteur } from "./protocole";

/** Seaux pleins à la connexion. */
export const creerLimiteur: CreerLimiteur = (maintenantMs) => ({
  entrees: RESEAU.floodEntreesRafale,
  ping: RESEAU.floodPingRafale,
  actions: RESEAU.floodActionsRafale,
  t: maintenantMs,
  fenetreT: maintenantMs,
  fenetreNb: 0,
});

/**
 * Décision pour un message de la classe `classe` reçu à `maintenantMs` : `ok` (traité), `jeter` (ignoré, la connexion reste ouverte) ou `couper`
 * (flood réel). Tout message brut compte dans la fenêtre d'une seconde, même jeté.
 */
export const admettreRocket: AdmettreRocket = (e, classe: ClasseMessage, maintenantMs) => {
  if (maintenantMs - e.fenetreT >= 1000) { e.fenetreT = maintenantMs; e.fenetreNb = 0; }
  if (++e.fenetreNb > RESEAU.floodCoupureParSeconde) return "couper";
  const dt = Math.max(0, (maintenantMs - e.t) / 1000);
  e.t = Math.max(e.t, maintenantMs);
  e.entrees = Math.min(RESEAU.floodEntreesRafale, e.entrees + RESEAU.floodEntreesParS * dt);
  e.ping = Math.min(RESEAU.floodPingRafale, e.ping + RESEAU.floodPingParS * dt);
  e.actions = Math.min(RESEAU.floodActionsRafale, e.actions + RESEAU.floodActionsParS * dt);
  if (classe === "entrees") {
    if (e.entrees < 1) return "jeter";
    e.entrees -= 1;
  } else if (classe === "ping") {
    if (e.ping < 1) return "jeter";
    e.ping -= 1;
  } else {
    if (e.actions < 1) return "jeter";
    e.actions -= 1;
  }
  return "ok";
};
