/**
 * Couche de pose du coureur : des intentions du cycle de course (lib/macron3d/course.ts) aux
 * rotations locales des 74 os. Maths de three seulement (Vector3, Quaternion, Matrix4 : aucun
 * WebGL), testée en Node sur le squelette lu dans le GLB.
 *
 *   bassin : position + lacet / tangage / roulis ; colonne répartie sur 3 vertèbres ;
 *   tête : orientation voulue dans le monde (stabilisée), répartie sur le cou, la tête finit
 *     exactement sur la cible quel que soit le mouvement du buste ;
 *   jambes : IK analytique à 2 os (lib/tigre3d/ik.ts) avec pôle vers l'avant, puis chaque os
 *     est « visé » : sa direction ET son axe de pli (genou) sont imposés, donc aucune torsion
 *     parasite ; pied orienté en monde à l'appui (pivots verrouillés), relatif au tibia en vol ;
 *   bras : directions bras / avant-bras construites dans le repère du thorax (balancement,
 *     écartement, rotation interne, coude), même visée par direction + axe de pli : en
 *     balancement, paume vers le corps et pouce en haut sans toucher aux os de torsion.
 */
import { Matrix4, Quaternion, Vector3 } from "three";
import { ik2 } from "../tigre3d/ik";
import type { IntentionsCourse, Vec } from "./course";
import { COTES, DOIGTS, SIGNE, deCote, type Cote, type Role } from "./os";
import { fk, fkOs, type Monde, type Pose, type Squelette } from "./squelette";

const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);

/**
 * Axes de pli en repère LOCAL de l'os (relevés sur planches, cf. rig du modèle) : flexion du
 * coude (rotation +), flexion du genou (+), avancée de la clavicule (+).
 */
const AXES_LOCAUX: Record<Cote, { coude: Vector3; genou: Vector3; clavicule: Vector3 }> = {
  G: { coude: new Vector3(0.12, 0.01, 0.99).normalize(), genou: new Vector3(-1, 0.02, 0).normalize(), clavicule: new Vector3(0.11, 0.48, 0.87).normalize() },
  D: { coude: new Vector3(0.12, -0.01, -0.99).normalize(), genou: new Vector3(-1, -0.02, 0).normalize(), clavicule: new Vector3(0.11, -0.48, -0.87).normalize() },
};

const RAD = Math.PI / 180;
/**
 * Poing léger de course : phalanges 1, 2, 3 de chaque doigt long (rad, autour de +X local, mêmes
 * signes à G et D), un peu plus fermé de l'index vers l'auriculaire (main détendue, pas crispée).
 */
const POING: Record<(typeof DOIGTS)[number], number[]> = {
  index: [52, 68, 45].map((d) => d * RAD),
  majeur: [58, 76, 50].map((d) => d * RAD),
  annulaire: [64, 82, 52].map((d) => d * RAD),
  auriculaire: [70, 86, 54].map((d) => d * RAD),
};
/** Part de l'écart de repos entre un doigt et le majeur que le poing referme (doigts serrés). */
const RESSERRER = 0.8;
/**
 * Pouce posé contre la phalange moyenne de l'index (bout à ≈ 1,5 cm, cherché par balayage) :
 * opposition de Thumb1 (±Z), torsion de Thumb1 sur son axe (±Y), flexion de Thumb1 / 2 / 3 (+X).
 */
const POUCE = { opposition: 0.8, torsion: -0.4, flexion: [0, 0.3, 0.3] } as const;

/** Constantes de repos d'un côté, calculées une fois par squelette. */
interface Repos {
  dirBras: Vector3; dirAvantBras: Vector3; axeCoude: Vector3;
  dirCuisse: Vector3; dirTibia: Vector3; axeGenou: Vector3;
  longCuisse: number; longTibia: number;
  /** Lacet de repos de l'axe du pied (rad) ; charnière cheville / orteils en local ; vertical en local du pied. */
  lacetPied: number; chPied: Vector3; chOrteils: Vector3; hautPied: Vector3;
}

export interface Poseur {
  sq: Squelette;
  pose: Pose;
  monde: Monde;
  /**
   * Applique des intentions : remplit `pose` (locales) et `monde` (cinématique directe).
   * `yeux` : regard relatif à la tête (rad ; lacet + = vers sa gauche, tangage + = vers le bas).
   * `leve` : un bras levé tendu au-dessus de la tête (pris au lasso par le poignet), mélangé à la
   * course de `poids` ∈ [0, 1].
   */
  poser(it: IntentionsCourse, yeux?: { lacet: number; tangage: number }, leve?: BrasLeve): void;
  /** IK : distance hanche → cheville demandée et atteinte à la dernière pose, par côté. */
  portee: Record<Cote, { demande: number; atteinte: number }>;
}

const versV = (p: Vec, out: Vector3) => out.set(p.x, p.y, p.z);

/** Bras levé tendu (lasso au poignet) : côté, et part du geste (0 = bras de course, 1 = levé). */
export interface BrasLeve { cote: Cote; poids: number }
/** Bras levé : un peu écarté du corps et vers l'avant, dans le repère du thorax. */
const DIRECTION_LEVE = new Vector3(0.22, 1, 0.12).normalize();

export function creerPoseur(sq: Squelette): Poseur {
  const i = sq.i;
  const dir = (a: Role, b: Role) => sq.pM[i[b]].clone().sub(sq.pM[i[a]]).normalize();
  const repos = {} as Record<Cote, Repos>;
  for (const c of COTES) {
    const r = (role: Parameters<typeof deCote>[0]) => deCote(role, c);
    const versPlante = sq.pM[i[r("orteils")]].clone().sub(sq.pM[i[r("pied")]]);
    const lacetPied = Math.atan2(versPlante.x, versPlante.z);
    // Axe latéral du pied au repos : tourner autour de lui de −θ lève la pointe de θ.
    const lat = new Vector3(Math.cos(lacetPied), 0, -Math.sin(lacetPied));
    const inv = (role: Role) => sq.qM[i[role]].clone().invert();
    repos[c] = {
      dirBras: dir(r("bras"), r("avantBras")),
      dirAvantBras: dir(r("avantBras"), r("main")),
      axeCoude: AXES_LOCAUX[c].coude.clone().applyQuaternion(sq.qM[i[r("avantBras")]]).normalize(),
      dirCuisse: dir(r("cuisse"), r("tibia")),
      dirTibia: dir(r("tibia"), r("pied")),
      axeGenou: AXES_LOCAUX[c].genou.clone().applyQuaternion(sq.qM[i[r("tibia")]]).normalize(),
      longCuisse: sq.pM[i[r("cuisse")]].distanceTo(sq.pM[i[r("tibia")]]),
      longTibia: sq.pM[i[r("tibia")]].distanceTo(sq.pM[i[r("pied")]]),
      lacetPied,
      chPied: lat.clone().applyQuaternion(inv(r("pied"))),
      chOrteils: lat.clone().applyQuaternion(inv(r("orteils"))),
      hautPied: Y.clone().applyQuaternion(inv(r("pied"))),
    };
  }

  // Doigts serrés : rotation de la phalange 1 autour de son axe d'écartement (+Z local, normale à
  // la paume) qui la rapproche du majeur (angle signé calculé sur le repos, donc juste à G et à D).
  const ecartDoigt = {} as Record<Cote, Record<(typeof DOIGTS)[number], number>>;
  for (const c of COTES) {
    const yDe = (role: Role) => Y.clone().applyQuaternion(sq.qM[i[role]]);
    const yMajeur = yDe(deCote("majeur1", c));
    ecartDoigt[c] = {} as Record<(typeof DOIGTS)[number], number>;
    for (const d of DOIGTS) {
      const k = i[deCote(`${d}1` as const, c)];
      const z = Z.clone().applyQuaternion(sq.qM[k]);
      const y = yDe(deCote(`${d}1` as const, c)).projectOnPlane(z).normalize();
      const m = yMajeur.clone().projectOnPlane(z).normalize();
      ecartDoigt[c][d] = RESSERRER * Math.atan2(new Vector3().crossVectors(y, m).dot(z), y.dot(m));
    }
  }

  const pose: Pose = { q: sq.q.map((q) => q.clone()), t: sq.t.map((t) => t.clone()) };
  const monde: Monde = { p: sq.t.map(() => new Vector3()), q: sq.q.map(() => new Quaternion()) };
  const portee = { G: { demande: 0, atteinte: 0 }, D: { demande: 0, atteinte: 0 } };

  // Temporaires.
  const qa = new Quaternion(), qb = new Quaternion(), qc = new Quaternion(), qd = new Quaternion();
  const va = new Vector3(), vb = new Vector3(), vc = new Vector3(), vd = new Vector3(), ve = new Vector3();
  const genou = new Vector3(), bout = new Vector3(), cible = new Vector3(), pole = new Vector3();
  const e1 = new Vector3(), e2 = new Vector3(), e3 = new Vector3(), f1 = new Vector3(), f2 = new Vector3(), f3 = new Vector3();
  const mE = new Matrix4(), mF = new Matrix4();
  const rot = (axe: Vector3, ang: number, out: Quaternion) => out.setFromAxisAngle(axe, ang);

  /**
   * Rotation qui amène (direction r, axe de pli a) sur (d, n) : impose la direction de l'os ET
   * l'orientation de son plan de pli (pas de torsion libre, contrairement à un simple « viser »).
   */
  function aligner(r: Vector3, a: Vector3, d: Vector3, n: Vector3, out: Quaternion) {
    e1.copy(r);
    e2.copy(a).addScaledVector(r, -a.dot(r)).normalize();
    e3.crossVectors(e1, e2);
    f1.copy(d);
    f2.copy(n).addScaledVector(d, -n.dot(d));
    if (f2.lengthSq() < 1e-10) f2.copy(e2); // axe dégénéré (ne devrait pas arriver)
    f2.normalize();
    f3.crossVectors(f1, f2);
    mE.makeBasis(e1, e2, e3).transpose();
    mF.makeBasis(f1, f2, f3).multiply(mE);
    return out.setFromRotationMatrix(mF);
  }

  /** Locale d'un os pour une orientation monde voulue (parent déjà calculé). */
  function localDepuisMonde(k: number, qMonde: Quaternion) {
    const p = sq.parent[k];
    pose.q[k].copy(monde.q[p]).invert().multiply(qMonde);
    fkOs(sq, pose, monde, k);
  }

  /** Os visé : orientation de repos tournée par (direction, axe). */
  function viser(k: number, rRepos: Vector3, aRepos: Vector3, d: Vector3, n: Vector3) {
    aligner(rRepos, aRepos, d, n, qa);
    qb.copy(qa).multiply(sq.qM[k]);
    localDepuisMonde(k, qb);
  }

  function colonne(it: IntentionsCourse) {
    const b = it.bassin;
    const kb = i.bassin;
    versV(b.p, pose.t[kb]);
    pose.q[kb].copy(sq.q[kb])
      .multiply(rot(Y, b.lacet, qa)).multiply(rot(X, b.tangage, qb)).multiply(rot(Z, b.roulis, qc));
    const parts: Array<[Role, number]> = [["dos1", 0.3], ["dos2", 0.35], ["dos3", 0.35]];
    for (const [role, f] of parts) {
      const k = i[role];
      pose.q[k].copy(sq.q[k])
        .multiply(rot(Y, it.dos.lacet * f, qa)).multiply(rot(X, it.dos.tangage * f, qb)).multiply(rot(Z, it.dos.roulis * f, qc));
    }
    fk(sq, pose, monde);
  }

  /** Tête stabilisée : chaque vertèbre du cou prend une part de la correction, la tête finit exactement. */
  function tete(it: IntentionsCourse, yeux?: { lacet: number; tangage: number }) {
    const h = it.tete;
    qd.copy(rot(Y, h.lacet, qa)).multiply(rot(X, h.tangage, qb)).multiply(rot(Z, h.roulis, qc)).multiply(sq.qM[i.tete]);
    const chaine: Array<[Role, number]> = [["cou1", 0.3], ["cou2", 0.35], ["cou3", 0.45], ["tete", 1]];
    chaine.forEach(([role, f], n) => {
      const k = i[role];
      // Locale qui amènerait la tête sur la cible si le reste du cou restait au repos.
      qa.copy(monde.q[sq.parent[k]]).invert().multiply(qd);
      qb.identity();
      for (let m = chaine.length - 1; m > n; m--) qb.premultiply(sq.q[i[chaine[m][0]]]);
      qa.multiply(qb.invert());
      pose.q[k].copy(sq.q[k]).slerp(qa, f);
      fkOs(sq, pose, monde, k);
    });
    for (const c of COTES) {
      const k = i[deCote("oeil", c)];
      // Globe oculaire : repère local = celui de la tête au repos, regard vers +Z local.
      if (yeux) pose.q[k].copy(sq.q[k]).multiply(rot(Y, yeux.lacet, qa)).multiply(rot(X, yeux.tangage, qb));
      fkOs(sq, pose, monde, k);
    }
  }

  function bras(it: IntentionsCourse, c: Cote, leve?: BrasLeve) {
    const b = it.bras[c], s = SIGNE[c], rp = repos[c];
    const kc = i[deCote("clavicule", c)], kb = i[deCote("bras", c)], ka = i[deCote("avantBras", c)];
    pose.q[kc].copy(sq.q[kc]).multiply(rot(AXES_LOCAUX[c].clavicule, b.clavicule, qa));
    fkOs(sq, pose, monde, kc);
    fkOs(sq, pose, monde, kb);
    // Repère du thorax : sa rotation depuis le repos, appliquée aux axes du modèle.
    qc.copy(monde.q[i.dos3]).multiply(qd.copy(sq.qM[i.dos3]).invert());
    // Bras pendant, écarté, puis balancé autour de l'axe latéral du thorax.
    const ecart = rot(Z, s * b.abduction, qa);
    va.set(0, -1, 0).applyQuaternion(ecart);                           // direction du bras
    vb.set(-1, 0, 0).applyQuaternion(ecart);                           // axe de pli du coude
    vb.applyQuaternion(rot(va, s * b.croise, qb));                     // rotation interne : l'avant-bras rentre
    const balance = rot(X, -b.balancement, qb);
    va.applyQuaternion(balance).applyQuaternion(qc);
    vb.applyQuaternion(balance).applyQuaternion(qc);
    vc.copy(va).applyQuaternion(rot(vb, b.coude, qd));                 // direction de l'avant-bras
    // Levé (lasso au poignet) : bras et avant-bras alignés vers le haut, coude tendu.
    const w = leve && leve.cote === c ? Math.min(1, Math.max(0, leve.poids)) : 0;
    if (w > 0) {
      vd.set(s * DIRECTION_LEVE.x, DIRECTION_LEVE.y, DIRECTION_LEVE.z).applyQuaternion(qc);
      va.lerp(vd, w).normalize();
      vc.lerp(vd, w).normalize();
      // L'axe du coude reste perpendiculaire au bras (sinon la visée tord l'os).
      vb.addScaledVector(va, -vb.dot(va)).normalize();
    }
    viser(kb, rp.dirBras, rp.axeCoude, va, vb);
    viser(ka, rp.dirAvantBras, rp.axeCoude, vc, vb);
    for (const role of ["torsion1", "torsion2", "main"] as const) fkOs(sq, pose, monde, i[deCote(role, c)]);
  }

  function jambe(it: IntentionsCourse, c: Cote) {
    const p = it.pieds[c], rp = repos[c];
    const kh = i[deCote("cuisse", c)], kt = i[deCote("tibia", c)], kp = i[deCote("pied", c)], ko = i[deCote("orteils", c)];
    const hanche = monde.p[kh];
    versV(p.cheville, cible);
    versV(p.pole, pole);
    const res = ik2(hanche, cible, rp.longCuisse, rp.longTibia, pole, genou, bout);
    portee[c].demande = res.demande;
    portee[c].atteinte = res.atteinte;
    // Axe de pli n = w × u (u : hanche → cheville, w : pôle perpendiculaire) : tourner la cuisse
    // de + flexion autour de n amène le tibia.
    vd.copy(bout).sub(hanche).normalize();
    ve.copy(pole).addScaledVector(vd, -pole.dot(vd)).normalize();
    vc.crossVectors(ve, vd).normalize();
    va.copy(genou).sub(hanche).normalize();
    viser(kh, rp.dirCuisse, rp.axeGenou, va, vc);
    vb.copy(bout).sub(genou).normalize();
    viser(kt, rp.dirTibia, rp.axeGenou, vb, vc);
    // Pied : orientation monde (appui) ou relative au tibia (vol), mélangées par un slerp.
    const dLacet = p.lacet - rp.lacetPied;
    qa.copy(rot(Y, dLacet, qb)).multiply(sq.qM[kp]).multiply(rot(rp.chPied, -p.tangage, qc));
    if (p.poidsTibia > 0) {
      qd.copy(monde.q[kt]).multiply(sq.q[kp]).multiply(rot(rp.hautPied, dLacet, qb)).multiply(rot(rp.chPied, -p.angleCheville, qc));
      qa.slerp(qd, p.poidsTibia);
    }
    localDepuisMonde(kp, qa);
    pose.q[ko].copy(sq.q[ko]).multiply(rot(rp.chOrteils, -p.orteils, qa));
    fkOs(sq, pose, monde, ko);
    fkOs(sq, pose, monde, i[deCote("boutPied", c)]);
  }

  function mains(it: IntentionsCourse) {
    const k = it.poing;
    for (const c of COTES) {
      for (const d of DOIGTS) POING[d].forEach((ang, n) => {
        const kk = i[`${d}${n + 1}${c}` as Role];
        pose.q[kk].copy(sq.q[kk]);
        if (n === 0) pose.q[kk].multiply(rot(Z, ecartDoigt[c][d] * k, qa));
        pose.q[kk].multiply(rot(X, ang * k, qa));
      });
      // Pouce posé contre l'index : opposition (−Z à gauche, +Z à droite), phalanges fléchies.
      const k1 = i[deCote("pouce1", c)], k2 = i[deCote("pouce2", c)], k3 = i[deCote("pouce3", c)];
      pose.q[k1].copy(sq.q[k1]).multiply(rot(Z, -SIGNE[c] * POUCE.opposition * k, qa))
        .multiply(rot(X, POUCE.flexion[0] * k, qb)).multiply(rot(Y, SIGNE[c] * POUCE.torsion * k, qc));
      pose.q[k2].copy(sq.q[k2]).multiply(rot(X, POUCE.flexion[1] * k, qa));
      pose.q[k3].copy(sq.q[k3]).multiply(rot(X, POUCE.flexion[2] * k, qa));
    }
  }

  return {
    sq, pose, monde, portee,
    poser(it, yeux, leve) {
      for (let k = 0; k < sq.q.length; k++) { pose.q[k].copy(sq.q[k]); pose.t[k].copy(sq.t[k]); }
      colonne(it);
      tete(it, yeux);
      for (const c of COTES) bras(it, c, leve);
      for (const c of COTES) jambe(it, c);
      mains(it);
      fk(sq, pose, monde);
    },
  };
}
