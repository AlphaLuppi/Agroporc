/**
 * Rocket Muche en ligne : construction du monde d'un match en ligne (lot SALLE). PUR.
 *
 * Plusieurs humains par monde : `creerMonde` n'en connaît qu'un (le slot 0 de `equipeJoueur`). Le monde en ligne est donc d'abord créé par
 * `creerMonde`, puis `humain`, `nom`, `equipe` et `slot` de chaque voiture sont imposés d'après `VoitureStatique` et `idHumain` = `moi`.
 * Le moteur (`match.ts`, `voiture.ts`…) n'est pas touché : la physique ne lit ni `humain` ni `idHumain` (spec § 1). Identique côté serveur
 * (`moi = -1`, aucune voiture « à moi ») et côté client.
 */
import { creerMonde, preparerCoupDEnvoi } from "../match";
import type { CreerMondeEnLigne, GraineBot } from "./protocole";

export const creerMondeEnLigne: CreerMondeEnLigne = (config, voitures, moi, arene) => {
  const m = creerMonde(config, arene);
  if (voitures.length !== m.voitures.length) {
    throw new Error(`creerMondeEnLigne : ${voitures.length} voitures décrites, le format ${config.format} en compte ${m.voitures.length}`);
  }
  const vus = new Set<number>();
  let replacer = false;
  for (const s of voitures) {
    const v = m.voitures[s.id];
    if (!v || vus.has(s.id)) throw new Error(`creerMondeEnLigne : id de voiture invalide ou répété (${s.id})`);
    vus.add(s.id);
    if (v.equipe !== s.equipe || v.slot !== s.slot) { v.equipe = s.equipe; v.slot = s.slot; replacer = true; }
    v.humain = s.humain;
    v.nom = s.nom;
  }
  m.idHumain = moi;
  // La répartition décrite par `debut` suit toujours l'ordre de `creerMonde` ; si ce n'était pas le cas, le coup d'envoi (fonction du slot) est retiré,
  // à l'identique des deux côtés.
  if (replacer) preparerCoupDEnvoi(m);
  return m;
};

/** Graine du cerveau d'un bot : même formule que le mode local (`creerCerveaux` de `jeu.ts`). */
export const graineBot: GraineBot = (grainePartie, idVoiture) => (Math.imul(grainePartie, 2654435761) + idVoiture * 40503 + 1) >>> 0;
