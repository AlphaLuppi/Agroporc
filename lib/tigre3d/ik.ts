/**
 * IK analytique à deux os (pur) : racine A, cible C, longueurs a (A → B) et b (B → C), et un
 * vecteur de pli (« pôle ») qui dit de quel côté plie l'articulation du milieu B.
 */
import { Vector3 } from "three";

const u = new Vector3(), w = new Vector3();

export interface ResultatIK {
  /** Distance A → C demandée, et atteinte (plus courte si la cible est hors de portée). */
  demande: number;
  atteinte: number;
}

/**
 * Calcule B (articulation du milieu) et C' (extrémité effectivement atteinte) dans `milieu` et
 * `bout`. La distance est bornée à [|a − b| + 1e-4, (a + b) · etirementMax] : hors de portée,
 * la patte se tend dans la direction de la cible et l'extrémité reste en deçà.
 */
export function ik2(
  A: Vector3, C: Vector3, a: number, b: number, pole: Vector3, milieu: Vector3, bout: Vector3, etirementMax = 0.999,
): ResultatIK {
  u.copy(C).sub(A);
  const demande = u.length();
  if (demande < 1e-9) u.set(0, -1, 0); else u.divideScalar(demande);
  const d = Math.min(Math.max(demande, Math.abs(a - b) + 1e-4), (a + b) * etirementMax);
  const cosA = Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  // Direction de pli : le pôle, rendu perpendiculaire à A → C.
  w.copy(pole).addScaledVector(u, -pole.dot(u));
  if (w.lengthSq() < 1e-12) w.set(0, 0, 1).addScaledVector(u, -u.z);
  w.normalize();
  milieu.copy(A).addScaledVector(u, a * cosA).addScaledVector(w, a * sinA);
  bout.copy(A).addScaledVector(u, d);
  return { demande, atteinte: d };
}
