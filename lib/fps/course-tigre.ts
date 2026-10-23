/**
 * Course du tigre de l'arène (PUR : maths de three, ni WebGL ni DOM). Au-delà de ce que le clip « Walking » suit sans glisser (lu à
 * `LECTURE_MAX` fois sa vitesse, 7,2 m/s au sol), le rendu (`rendu-tigres.ts`) pose le tigre avec le moteur du corps du thème Tigre
 * (lib/tigre3d/corps.ts) : trot puis galop, pieds VERROUILLÉS au sol pendant l'appui, testé sans glissement jusqu'à 3,4 m/s du modèle
 * (11,5 m/s au monde). La vitesse du moteur est imposée à celle du tigre dessiné (`vitesseImposee`) : les pieds suivent le sol sans le
 * retard du ressort d'accélération.
 * Spec : docs/superpowers/specs/2026-10-23-arene-tigres-design.md (Rendu)
 *
 * Repères. Le moteur avance sur +x de son repère « sol » (cap π/2), le corps en `c.x`. L'arène pose le modèle museau vers +z
 * (`rotation.y = cap + π`, convention des clips et de `poseTapie`). La pose sortie est donc celle du moteur, racine ramenée à
 * l'origine (x − `c.x`) et tournée de −π/2 autour de y : +x devient +z. Les autres os, relatifs à la racine, suivent.
 */
import { Quaternion, Vector3 } from "three";
import { avancerCorps, creerCorps, type Corps } from "../tigre3d/corps";
import { copierPose, placerRacine, type PoseTigre } from "../tigre3d/squelette";
import { ECHELLE_MODELE } from "../tigre3d/troupe";

/** Pas du moteur (s) : une image longue (rendu lent) est découpée, l'IK et les ressorts restent stables. */
export const PAS_COURSE_S = 1 / 60;
/** Au plus 20 pas par image : au-delà (onglet gelé), le temps perdu n'est pas rattrapé. */
const PAS_MAX = 20;
/** Cap du moteur : face à +x, son axe d'avance. */
const CAP_MOTEUR = Math.PI / 2;

const VERS_MUSEAU_Z = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2);
const _p = new Vector3();
const _q = new Quaternion();

/** Moteur du corps d'un tigre qui court (un par tigre dessiné). */
export function creerCourse(graine?: number): Corps {
  return creerCorps({ cap: CAP_MOTEUR, graine });
}

/**
 * Avance le moteur de `dt` s à la vitesse au sol `vMonde` (m/s du monde) et écrit dans `sortie` sa pose dans la convention de l'arène :
 * museau vers +z, corps à l'origine (à appliquer avec `origineX = 0`).
 */
export function avancerCourse(c: Corps, vMonde: number, dt: number, sortie: PoseTigre): PoseTigre {
  const v = Math.max(0, vMonde) / ECHELLE_MODELE;
  const duree = Math.min(Math.max(0, dt), PAS_MAX * PAS_COURSE_S);
  const n = Math.max(1, Math.ceil(duree / PAS_COURSE_S - 1e-9));
  for (let i = 0; i < n; i++) {
    avancerCorps(c, duree / n, { vitesse: v, sens: 1, cap: CAP_MOTEUR, regard: 0, couches: [], vitesseImposee: v });
  }
  copierPose(sortie, c.pose);
  // racine au repère du modèle (cf. `fkOs`), ramenée à l'origine puis tournée vers +z
  const sq = c.sq, k = sq.i.racine;
  _p.copy(c.pose.t[k]).multiplyScalar(sq.racine.s).applyQuaternion(sq.racine.q).add(sq.racine.t);
  _q.copy(sq.racine.q).multiply(c.pose.q[k]);
  _p.x -= c.x;
  _p.applyQuaternion(VERS_MUSEAU_Z);
  _q.premultiply(VERS_MUSEAU_Z);
  placerRacine(sq, sortie, _p, _q);
  return sortie;
}
