/**
 * Rendu des grenades du mode zombies (three, v8) : grenade à fragmentation (olive, cuillère et goupille) qui tourne en vol, tigre à
 * remontoir (peluche mécanique orange à rayures, clé dans le dos, cymbales dorées) qui claque des cymbales une fois posé, et traînée pâle
 * en vol. Réserve fixe de modèles par genre (aucune allocation par image), tout est libéré par `dispose`. Les positions viennent de
 * `jeu-grenades.ts` (PUR, testé) ; l'explosion elle-même passe par `rendu-feux.ts` (`feux.explosion`).
 */
import * as THREE from "three";
import type { GrenadeAffichee } from "./jeu-grenades";
import { TRAINEE_POINTS } from "./jeu-grenades";
import type { GenreGrenade } from "./protocole";

/** Modèles en réserve par genre : au-delà, les grenades suivantes ne sont pas dessinées. */
export const RESERVE_GRENADES = 12;

export interface ModeleGrenade { group: THREE.Group; dispose(): void }

/** Grenade à fragmentation (≈ 12 cm) : corps olive quadrillé, tête sombre, cuillère. Origine au centre. */
export function creerModeleFrag(): ModeleGrenade {
  const g = new THREE.Group();
  const olive = new THREE.MeshBasicMaterial({ color: 0x5d6b2f });
  const sombre = new THREE.MeshBasicMaterial({ color: 0x2b2f22 });
  const metal = new THREE.MeshBasicMaterial({ color: 0xb9b9a8 });
  const geos: THREE.BufferGeometry[] = [new THREE.SphereGeometry(0.06, 10, 8), new THREE.CylinderGeometry(0.025, 0.03, 0.04, 8), new THREE.BoxGeometry(0.012, 0.09, 0.02), new THREE.TorusGeometry(0.018, 0.004, 4, 10)];
  const corps = new THREE.Mesh(geos[0], olive); corps.scale.set(1, 1.18, 1);
  const tete = new THREE.Mesh(geos[1], sombre); tete.position.y = 0.075;
  const cuillere = new THREE.Mesh(geos[2], metal); cuillere.position.set(0.035, 0.035, 0); cuillere.rotation.z = -0.25;
  const anneau = new THREE.Mesh(geos[3], metal); anneau.position.set(-0.035, 0.085, 0);
  g.add(corps, tete, cuillere, anneau);
  // quadrillage : trois anneaux sombres
  for (const y of [-0.03, 0, 0.03]) {
    const r = Math.sqrt(Math.max(0, 0.06 * 0.06 - (y / 1.18) ** 2)) + 0.002;
    const geo = new THREE.TorusGeometry(r, 0.0035, 3, 14);
    geos.push(geo);
    const m = new THREE.Mesh(geo, sombre); m.rotation.x = Math.PI / 2; m.position.y = y; g.add(m);
  }
  const mats = [olive, sombre, metal];
  return { group: g, dispose() { g.removeFromParent(); for (const x of geos) x.dispose(); for (const x of mats) x.dispose(); } };
}

/**
 * Tigre à remontoir (≈ 35 cm) : corps et tête orange, rayures et yeux noirs, museau blanc, clé dorée dans le dos (enfant `cle`), deux
 * cymbales dorées tenues devant (enfants `cymbaleG` / `cymbaleD`). Origine sous les pattes, regard vers +z.
 */
export function creerModeleRemontoir(): ModeleGrenade {
  const g = new THREE.Group();
  const orange = new THREE.MeshBasicMaterial({ color: 0xff8c2a });
  const noir = new THREE.MeshBasicMaterial({ color: 0x1a0d05 });
  const blanc = new THREE.MeshBasicMaterial({ color: 0xf4efe6 });
  const or = new THREE.MeshBasicMaterial({ color: 0xffd34d, side: THREE.DoubleSide });
  const s = (r: number) => new THREE.SphereGeometry(r, 12, 10);
  const geos: THREE.BufferGeometry[] = [s(0.11), s(0.085), s(0.035), s(0.03), s(0.02), new THREE.CylinderGeometry(0.06, 0.06, 0.006, 16), new THREE.BoxGeometry(0.015, 0.06, 0.015), new THREE.TorusGeometry(0.025, 0.008, 4, 10)];
  const corps = new THREE.Mesh(geos[0], orange); corps.position.y = 0.12; corps.scale.set(1, 1.1, 0.9);
  const tete = new THREE.Mesh(geos[1], orange); tete.position.y = 0.27;
  const museau = new THREE.Mesh(geos[2], blanc); museau.position.set(0, 0.255, 0.07);
  g.add(corps, tete, museau);
  for (const sx of [-1, 1]) {
    const oreille = new THREE.Mesh(geos[3], orange); oreille.position.set(sx * 0.06, 0.34, 0); g.add(oreille);
    const oeil = new THREE.Mesh(geos[4], noir); oeil.scale.setScalar(0.5); oeil.position.set(sx * 0.03, 0.29, 0.075); g.add(oeil);
    const patte = new THREE.Mesh(geos[3], orange); patte.position.set(sx * 0.07, 0.03, 0.04); g.add(patte);
  }
  for (const y of [0.07, 0.13, 0.19]) {
    const geo = new THREE.TorusGeometry(0.1, 0.008, 4, 16);
    geos.push(geo);
    const r = new THREE.Mesh(geo, noir); r.rotation.x = Math.PI / 2; r.position.y = y; g.add(r);
  }
  // cymbales tenues par les pattes avant (elles s'écartent et se rejoignent quand il joue)
  for (const [nom, sx] of [["cymbaleG", -1], ["cymbaleD", 1]] as const) {
    const bras = new THREE.Group(); bras.name = nom; bras.position.set(sx * 0.1, 0.17, 0.06);
    const c = new THREE.Mesh(geos[5], or); c.rotation.z = Math.PI / 2; c.position.x = sx * 0.02;
    bras.add(c);
    g.add(bras);
  }
  // clé de remontoir dans le dos
  const cle = new THREE.Group(); cle.name = "cle"; cle.position.set(0, 0.14, -0.11);
  const tige = new THREE.Mesh(geos[6], or); tige.rotation.x = Math.PI / 2; tige.position.z = -0.02;
  const boucleA = new THREE.Mesh(geos[7], or); boucleA.position.set(0.028, 0, -0.05);
  const boucleB = new THREE.Mesh(geos[7], or); boucleB.position.set(-0.028, 0, -0.05);
  cle.add(tige, boucleA, boucleB);
  g.add(cle);
  const mats = [orange, noir, blanc, or];
  return { group: g, dispose() { g.removeFromParent(); for (const x of geos) x.dispose(); for (const x of mats) x.dispose(); } };
}

export interface RenduGrenades {
  /** place les grenades de l'image (`t` : horloge locale en s, pour les animations) */
  maj(liste: readonly GrenadeAffichee[], t: number): void;
  dispose(): void;
}

interface Emplacement { modele: ModeleGrenade; trainee: THREE.Line; positions: Float32Array; cle?: THREE.Object3D; cymbales?: THREE.Object3D[] }

export function creerRenduGrenades(scene: THREE.Object3D): RenduGrenades {
  const racine = new THREE.Group();
  racine.name = "grenades";
  scene.add(racine);
  const matTrainee = new THREE.LineBasicMaterial({ color: 0xfff2d0, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false });
  const reserve: Record<GenreGrenade, Emplacement[]> = { frag: [], remontoir: [] };
  for (const genre of ["frag", "remontoir"] as const) {
    for (let i = 0; i < RESERVE_GRENADES; i++) {
      const modele = genre === "frag" ? creerModeleFrag() : creerModeleRemontoir();
      modele.group.visible = false;
      racine.add(modele.group);
      const positions = new Float32Array(TRAINEE_POINTS * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const trainee = new THREE.Line(geo, matTrainee);
      trainee.frustumCulled = false;
      trainee.visible = false;
      racine.add(trainee);
      const e: Emplacement = { modele, trainee, positions };
      if (genre === "remontoir") {
        e.cle = modele.group.getObjectByName("cle") ?? undefined;
        e.cymbales = ["cymbaleG", "cymbaleD"].map((n) => modele.group.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
      }
      reserve[genre].push(e);
    }
  }

  return {
    maj(liste, t) {
      const pris: Record<GenreGrenade, number> = { frag: 0, remontoir: 0 };
      for (const g of liste) {
        const e = reserve[g.genre][pris[g.genre]];
        if (!e) continue;
        pris[g.genre]++;
        const grp = e.modele.group;
        grp.visible = true;
        const dx = g.p[0] - g.avant[0], dz = g.p[2] - g.avant[2];
        const vole = !g.posee && Math.hypot(dx, g.p[1] - g.avant[1], dz) > 0.005;
        if (g.genre === "frag") {
          grp.position.set(g.p[0], g.p[1], g.p[2]);
          // elle tourne en vol, se couche une fois posée
          if (vole) { grp.rotation.x = t * 14 + g.id; grp.rotation.z = t * 9; }
          else { grp.rotation.set(Math.PI / 2, (g.id * 1.7) % (Math.PI * 2), 0); }
        } else {
          // le remontoir vole en culbutant, puis se pose debout, tourné vers où il allait, et claque des cymbales (de plus en plus vite)
          grp.position.set(g.p[0], g.p[1] - 0.15, g.p[2]);
          if (vole) { grp.rotation.set(t * 8, Math.atan2(dx, dz), 0); }
          else {
            grp.rotation.x = 0; grp.rotation.z = 0;
            if (Math.hypot(dx, dz) > 1e-4) grp.rotation.y = Math.atan2(dx, dz);
            const cadence = 6 + 10 * g.mecheEcoulee;
            const ouvert = 0.5 + 0.5 * Math.sin(t * cadence * Math.PI);
            e.cymbales?.forEach((c, i) => { c.rotation.y = (i === 0 ? 1 : -1) * 0.7 * ouvert; });
            grp.position.y += Math.abs(Math.sin(t * cadence * Math.PI)) * 0.02;
          }
          if (e.cle) e.cle.rotation.z = t * (g.posee ? 5 : 1);
        }
        // traînée pâle en vol
        if (g.trainee.length >= 2) {
          for (let k = 0; k < TRAINEE_POINTS; k++) {
            const q = g.trainee[Math.min(k, g.trainee.length - 1)];
            e.positions[k * 3] = q[0]; e.positions[k * 3 + 1] = q[1]; e.positions[k * 3 + 2] = q[2];
          }
          (e.trainee.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
          e.trainee.visible = true;
        } else e.trainee.visible = false;
      }
      for (const genre of ["frag", "remontoir"] as const) {
        for (let i = pris[genre]; i < RESERVE_GRENADES; i++) {
          const e = reserve[genre][i];
          if (!e.modele.group.visible && !e.trainee.visible) break;
          e.modele.group.visible = false;
          e.trainee.visible = false;
        }
      }
    },
    dispose() {
      for (const genre of ["frag", "remontoir"] as const) {
        for (const e of reserve[genre]) { e.modele.dispose(); e.trainee.geometry.dispose(); }
      }
      matTrainee.dispose();
      racine.removeFromParent();
    },
  };
}
