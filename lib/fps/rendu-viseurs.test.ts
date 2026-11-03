// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { creerArmeEnMain, creerModeleArmeMonde, type FenetreViseur } from "./rendu";
import { STATS, statsTir, viseurLunette, type Viseur } from "./armes";
import { ARMES_A_VISEUR, grossissement, parametresVisee, viseursDisponibles } from "./viseurs";
import type { ArmeFeuId } from "./protocole";

/**
 * Viseurs optiques CREUX de l'arme en main (arène, Battle Royale, zombies) : en visée, l'œil (origine de la caméra, dont l'arme est l'enfant)
 * regarde par la fenêtre du viseur sans qu'aucune face ne la masque (l'arme en main est dessinée par-dessus tout : une face sur la ligne de
 * visée cacherait la cible), la fenêtre est centrée sur l'axe (là où le HUD dessine le point), l'embase est posée sur la carcasse, et l'arme
 * ne bouge pas hors visée.
 */

type ArmeMain = ReturnType<typeof creerArmeEnMain>;
interface Cas { mode: string; id: ArmeFeuId; viseur: Viseur; grossi: number; paire: boolean; ameliore: boolean }

const REPOS = { vitesseH: 0, auSol: true, vise: false };
const PAS = 1 / 60;
const jouer = (arme: ArmeMain, s: number, vise: boolean, pas = PAS) => {
  for (let t = 0; t < s - 1e-9; t += pas) arme.maj(pas, { ...REPOS, vise });
};

/** Arène et Battle Royale : chaque viseur proposé de chaque arme, plus la lunette intégrée du sniper. Zombies : le viseur de chaque arme gratinée. */
function cas(): Cas[] {
  const res: Cas[] = [];
  for (const id of ARMES_A_VISEUR) {
    for (const v of viseursDisponibles(id)) {
      const p = parametresVisee(id, v);
      if (!p) continue;
      res.push({ mode: "arène/BR", id, viseur: p.viseur, grossi: grossissement(v), paire: false, ameliore: false });
    }
  }
  res.push({ mode: "arène/BR", id: "sniper", viseur: statsTir("sniper").viseur, grossi: 0, paire: false, ameliore: false });
  for (const id of Object.keys(STATS) as ArmeFeuId[]) {
    const st = statsTir(id, { zombies: true, ameliore: true });
    if (st.viseur !== "fer") res.push({ mode: "zombies", id, viseur: st.viseur, grossi: 0, paire: st.akimbo, ameliore: true });
  }
  return res;
}
const CAS = cas();
const nom = (c: Cas) => `${c.mode} ${c.id} ${c.viseur}${c.grossi ? ` ×${c.grossi}` : ""}`;

/** L'arme en main sous une caméra à l'origine, viseur posé, mise en joue : pleine visée, ou pour une lunette la fin de la transition (≥ 0,8, avant l'effacement à 0,85). */
function enJoue(c: Cas): { arme: ArmeMain; camera: THREE.PerspectiveCamera; f: FenetreViseur } {
  const camera = new THREE.PerspectiveCamera();
  const arme = creerArmeEnMain(c.id);
  camera.add(arme.group);
  arme.ameliorer(c.ameliore);
  arme.regler({ paire: c.paire, viseur: c.viseur, grossissement: c.grossi });
  if (viseurLunette(c.viseur)) {
    let n = 0;
    while (arme.ads < 0.8 && n++ < 1000) arme.maj(1 / 240, { ...REPOS, vise: true });
    expect(arme.ads, nom(c)).toBeLessThan(0.85);
    expect(arme.group.visible, nom(c)).toBe(true);
  } else jouer(arme, 2, true);
  camera.updateMatrixWorld(true);
  const f = arme.fenetreViseur;
  expect(f, nom(c)).not.toBeNull();
  return { arme, camera, f: f! };
}

/** Objet affiché (lui et tous ses parents jusqu'à la racine visibles) : le lancer de rayons de three ignore `visible`. */
function affiche(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
const eclair = (o: THREE.Object3D): boolean => {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData.ordreFixe) return true;
  return false;
};
function descendDe(o: THREE.Object3D, ancetre: THREE.Object3D | null): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === ancetre) return true;
  return false;
}
/** Faces vues des deux côtés le temps du test : une face tournée dans l'autre sens gênerait aussi la vue avec un autre matériau. */
function deuxFaces(racine: THREE.Object3D): void {
  racine.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) for (const mat of ([] as THREE.Material[]).concat(mesh.material)) mat.side = THREE.DoubleSide;
  });
}

/**
 * Rayons de l'œil (origine de la caméra) à travers une grille de 13 × 13 points sur 85 % de l'ouverture dans chaque sens (72 % de la surface ;
 * disque de rayon 0,85 r pour une lunette) : ceux qui touchent une face affichée de l'arme autre que la vitre.
 */
function gene(arme: ArmeMain, f: FenetreViseur): { rayons: number; genes: string[] } {
  // l'éclair de bouche (arêtes seulement, 45 ms au tir) se voit à travers le viseur, comme sur une vraie arme : il n'est pas une gêne
  const ray = new THREE.Raycaster();
  ray.params.Line = { threshold: 1e-4 };
  const origine = new THREE.Vector3();
  const p = new THREE.Vector3();
  const N = 6, K = 0.85;
  let rayons = 0;
  const genes: string[] = [];
  for (let i = -N; i <= N; i++) {
    for (let j = -N; j <= N; j++) {
      const u = (K * i) / N, v = (K * j) / N;
      if (f.ronde && u * u + v * v > K * K) continue;
      p.set(f.centre.x + u * f.demiL, f.centre.y + v * f.demiH, f.centre.z);
      f.repere.localToWorld(p);
      ray.set(origine, p.clone().normalize());
      rayons++;
      for (const h of ray.intersectObject(arme.group, true)) {
        if (!affiche(h.object) || h.object.userData.vitre || eclair(h.object)) continue;
        genes.push(`${h.object.type} à ${h.point.toArray().map((x) => x.toFixed(3)).join(", ")}`);
        break;
      }
    }
  }
  return { rayons, genes };
}

describe("viseurs creux de l'arme en main", () => {
  it("couvre tous les modes : viseurs proposés de l'arène et du BR, lunette du sniper, armes gratinées des zombies", () => {
    expect(CAS.filter((c) => c.mode === "zombies").length).toBeGreaterThanOrEqual(8);
    for (const v of ["point_rouge", "holo", "lunette", "thermique"] as const) expect(CAS.some((c) => c.viseur === v), v).toBe(true);
    expect(CAS.some((c) => c.grossi === 4)).toBe(true);
  });

  it.each(CAS.map((c) => [nom(c), c] as const))("%s : ligne de visée dégagée à travers la fenêtre", (_n, c) => {
    const { arme, f } = enJoue(c);
    deuxFaces(arme.group);
    const { rayons, genes } = gene(arme, f);
    expect(rayons).toBeGreaterThan(100);
    expect(genes.slice(0, 3), `${nom(c)} : ${genes.length} rayons sur ${rayons} touchent l'arme`).toEqual([]);
    arme.dispose();
  });

  it.each(CAS.filter((c) => !viseurLunette(c.viseur)).map((c) => [nom(c), c] as const))("%s : le recul en visée ne fait jamais entrer l'arme dans la fenêtre", (_n, c) => {
    const { arme, camera, f } = enJoue(c);
    deuxFaces(arme.group);
    // deux tirs rapprochés (recul plafonné), image par image jusqu'au retour au repos
    let pire = { t: 0, n: 0, premier: "" };
    arme.tirer();
    for (let k = 0; k < 120; k++) {
      if (k === 6) arme.tirer();
      arme.maj(1 / 240, { ...REPOS, vise: true });
      camera.updateMatrixWorld(true);
      const { genes } = gene(arme, f);
      if (genes.length > pire.n) pire = { t: k, n: genes.length, premier: genes[0] };
    }
    expect(pire.n, `${nom(c)} : ${pire.n} rayons touchent l'arme à l'image ${pire.t} (${pire.premier})`).toBe(0);
    arme.dispose();
  });

  it.each(CAS.filter((c) => c.id !== "sniper").map((c) => [nom(c), c] as const))("%s : viseur posé en plein rechargement ou en plein coup = posé au repos", (_n, c) => {
    const pose = (avant?: (a: ArmeMain) => void) => {
      const a = creerArmeEnMain(c.id);
      a.ameliorer(c.ameliore);
      if (avant) avant(a);
      a.regler({ paire: c.paire, viseur: c.viseur, grossissement: c.grossi });
      jouer(a, 4, false);
      const f = a.fenetreViseur!;
      const r = { centre: f.centre.clone(), piece: f.piece!.position.clone() };
      a.dispose();
      return r;
    };
    const repos = pose();
    for (const [quoi, avant] of [
      ["rechargement", (a: ArmeMain) => { a.recharger(2); jouer(a, 0.9, false); }],
      ["coup", (a: ArmeMain) => { a.coup(); jouer(a, 0.15, false); }],
      ["tir", (a: ArmeMain) => { a.tirer(); jouer(a, 0.02, false); }],
    ] as const) {
      const r = pose(avant);
      expect(r.centre.distanceTo(repos.centre), `${nom(c)} ${quoi}`).toBeLessThan(1e-9);
      expect(r.piece.distanceTo(repos.piece), `${nom(c)} ${quoi}`).toBeLessThan(1e-9);
    }
  });

  it.each(CAS.map((c) => [nom(c), c] as const))("%s : fenêtre centrée sur l'axe et entièrement vide", (_n, c) => {
    const { arme, f } = enJoue(c);
    const centre = f.repere.localToWorld(f.centre.clone());
    expect(Math.hypot(centre.x, centre.y), nom(c)).toBeLessThan(0.002);
    expect(centre.z).toBeLessThan(-0.05);
    // aucune vitre : la fenêtre est entièrement vide, rien ne teinte la vue
    expect(f.vitre).toBeNull();
    arme.dispose();
  });

  it.each(CAS.filter((c) => c.id !== "sniper").map((c) => [nom(c), c] as const))("%s : embase posée sur la carcasse, ni dedans ni en l'air", (_n, c) => {
    const { arme, f } = enJoue(c);
    const e = f.embase!;
    expect(e, nom(c)).not.toBeNull();
    const ray = new THREE.Raycaster();
    const bas = new THREE.Vector3(0, -1, 0).applyQuaternion(f.repere.getWorldQuaternion(new THREE.Quaternion()));
    const o = new THREE.Vector3(), local = new THREE.Vector3();
    let plusHaut = -Infinity;
    for (let i = 0; i <= 4; i++) {
      for (let j = 0; j <= 4; j++) {
        o.set(e.x0 + ((e.x1 - e.x0) * i) / 4, e.y + 0.05, e.z0 + ((e.z1 - e.z0) * j) / 4);
        f.repere.localToWorld(o);
        ray.set(o, bas);
        const h = ray.intersectObject(arme.group, true).find((x) => affiche(x.object) && !descendDe(x.object, f.piece) && (x.object as THREE.Mesh).isMesh);
        if (!h) continue;
        plusHaut = Math.max(plusHaut, f.repere.worldToLocal(local.copy(h.point)).y);
      }
    }
    const jeu = e.y - plusHaut;
    expect(jeu, `${nom(c)} : ${(jeu * 1000).toFixed(1)} mm`).toBeGreaterThanOrEqual(-1e-6);
    expect(jeu, `${nom(c)} : ${(jeu * 1000).toFixed(1)} mm`).toBeLessThanOrEqual(0.006);
    arme.dispose();
  });

  it.each(CAS.map((c) => [nom(c), c] as const))("%s : hors visée, l'arme reste à sa place de repos", (_n, c) => {
    const avec = creerArmeEnMain(c.id), sans = creerArmeEnMain(c.id);
    avec.regler({ paire: c.paire, viseur: c.viseur, grossissement: c.grossi });
    sans.regler({ paire: c.paire, viseur: "fer" });
    const memes = () => {
      expect(avec.group.position.distanceTo(sans.group.position), nom(c)).toBeLessThan(1e-9);
      expect(Math.abs(avec.group.rotation.y - sans.group.rotation.y)).toBeLessThan(1e-9);
      expect(avec.group.children[2].position.lengthSq()).toBe(0);
    };
    for (const a of [avec, sans]) jouer(a, 0.5, false);
    memes();
    // mise en joue puis relâchée : retour exact au repos
    for (const a of [avec, sans]) { jouer(a, 1, true); jouer(a, 3, false); }
    expect(avec.group.position.distanceTo(sans.group.position), nom(c)).toBeLessThan(1e-6);
    avec.dispose();
    sans.dispose();
  });

  it("vu de l'extérieur (avatars, bots, armes posées), le sniper garde une lunette pleine : on ne voit pas à travers", () => {
    const monde = creerModeleArmeMonde("sniper", 0xffffff);
    monde.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    ray.params.Line = { threshold: 1e-4 };
    // dans l'axe de la lunette, de face puis de dos, faces d'un seul côté comme dans le jeu
    for (const [z, dz] of [[-2, 1], [2, -1]] as const) {
      ray.set(new THREE.Vector3(0, 0.085, z), new THREE.Vector3(0, 0, dz));
      const h = ray.intersectObject(monde.group, true).filter((x) => (x.object as THREE.Mesh).isMesh && !(x.object as THREE.Line).isLine);
      expect(h.length, `de ${z < 0 ? "face" : "dos"}`).toBeGreaterThan(0);
    }
    monde.dispose();
  });

  it("la mire métallique se replie sous un viseur optique et revient sans lui", () => {
    const arme = creerArmeEnMain("fusil_assaut");
    const mires = () => {
      const l: THREE.Object3D[] = [];
      arme.group.traverse((o) => { if (o.userData.mire) l.push(o); });
      return l;
    };
    expect(mires().length).toBeGreaterThan(0);
    arme.regler({ paire: false, viseur: "holo" });
    expect(mires().every((o) => !o.visible)).toBe(true);
    arme.regler({ paire: false, viseur: "fer" });
    expect(mires().every((o) => o.visible)).toBe(true);
    arme.dispose();
  });
});
