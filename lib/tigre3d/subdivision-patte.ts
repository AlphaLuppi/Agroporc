/**
 * Subdivision du bout de la patte avant droite, au chargement du modèle, pour la main humaine
 * (lib/tigre3d/main-humaine.ts). PUR (aucune dépendance). La patte du GLB n'a que 2 à 3 arêtes par
 * doigt : la main y serait une moufle. Les triangles dont les trois sommets ont `mainD` comme
 * influence principale sont coupés en quatre (milieux des arêtes), une ou deux fois. Les triangles
 * voisins qui partagent une arête coupée sont coupés en deux ou trois, sans nouveau sommet, pour
 * que la surface reste fermée (pas de sommet posé au milieu d'une arête d'un autre triangle).
 *
 * Le maillage reste unique, animé par le même squelette : un sommet ajouté est le milieu de son
 * arête (position, normale, coordonnées de texture), ses poids d'os sont la moyenne de ceux des
 * deux extrémités (les quatre plus forts, renormalisés). Au repos, la patte a donc la même forme.
 * Les milieux sont créés par paire d'indices : les sommets doublés le long des coutures de texture
 * donnent deux milieux à la même position, chacun avec ses coordonnées de texture.
 */

export interface MaillagePatte {
  /** 3 valeurs par sommet, dénormalisées. */
  positions: ArrayLike<number>;
  normales: ArrayLike<number>;
  /** 2 valeurs par sommet. */
  uv: ArrayLike<number>;
  /** 4 valeurs par sommet : indices et poids des os (poids dénormalisés). */
  indicesOs: ArrayLike<number>;
  poidsOs: ArrayLike<number>;
  /** 3 indices par triangle. */
  indices: ArrayLike<number>;
}

export interface MaillagePatteSubdivise {
  positions: Float32Array;
  normales: Float32Array;
  uv: Float32Array;
  indicesOs: Uint16Array;
  poidsOs: Float32Array;
  indices: Uint32Array;
}

/** Influence principale d'un sommet : l'os de plus fort poids. */
function osPrincipal(indicesOs: ArrayLike<number>, poidsOs: ArrayLike<number>, i: number): number {
  const parOs = new Map<number, number>();
  for (let j = 0; j < 4; j++) parOs.set(indicesOs[i * 4 + j], (parOs.get(indicesOs[i * 4 + j]) ?? 0) + poidsOs[i * 4 + j]);
  let meilleur = -1, max = -Infinity;
  for (const [os, p] of parOs) if (p > max) { max = p; meilleur = os; }
  return meilleur;
}

/**
 * Coupe en quatre, `niveaux` fois, les triangles du bout de la patte (trois sommets d'influence
 * principale `osMain`), et en deux ou trois leurs voisins pour fermer la surface.
 */
export function subdiviserPatte(m: MaillagePatte, osMain: number, niveaux = 2): MaillagePatteSubdivise {
  const pos: number[] = Array.from(m.positions), nor: number[] = Array.from(m.normales), uv: number[] = Array.from(m.uv);
  const io: number[] = Array.from(m.indicesOs), po: number[] = Array.from(m.poidsOs);
  let tris: number[] = Array.from(m.indices);
  const n0 = pos.length / 3;
  // Triangles à couper en quatre au niveau courant (indices de triangle dans `tris`).
  let bout = new Set<number>();
  for (let t = 0; t < tris.length / 3; t++) {
    if ([0, 1, 2].every((k) => osPrincipal(m.indicesOs, m.poidsOs, tris[t * 3 + k]) === osMain)) bout.add(t);
  }
  for (let niveau = 0; niveau < niveaux; niveau++) {
    // Milieu de chaque arête d'un triangle du bout, une fois par paire d'indices.
    const milieux = new Map<number, number>();
    const cle = (a: number, b: number) => (a < b ? a * 4194304 + b : b * 4194304 + a);
    const milieu = (a: number, b: number) => {
      const c = cle(a, b);
      let i = milieux.get(c);
      if (i !== undefined) return i;
      i = pos.length / 3;
      milieux.set(c, i);
      for (let k = 0; k < 3; k++) pos.push((pos[a * 3 + k] + pos[b * 3 + k]) / 2);
      const nx = nor[a * 3] + nor[b * 3], ny = nor[a * 3 + 1] + nor[b * 3 + 1], nz = nor[a * 3 + 2] + nor[b * 3 + 2];
      const l = Math.hypot(nx, ny, nz) || 1;
      nor.push(nx / l, ny / l, nz / l);
      for (let k = 0; k < 2; k++) uv.push((uv[a * 2 + k] + uv[b * 2 + k]) / 2);
      // Poids d'os : moyenne des deux extrémités, os par os, puis les quatre plus forts renormalisés.
      const parOs = new Map<number, number>();
      for (const s of [a, b]) for (let j = 0; j < 4; j++) {
        const p = po[s * 4 + j];
        if (p > 0) parOs.set(io[s * 4 + j], (parOs.get(io[s * 4 + j]) ?? 0) + p / 2);
      }
      const tri = [...parOs].sort((x, y) => y[1] - x[1]).slice(0, 4);
      const somme = tri.reduce((s, [, p]) => s + p, 0) || 1;
      const total = [...parOs.values()].reduce((s, p) => s + p, 0);
      for (let j = 0; j < 4; j++) {
        io.push(tri[j]?.[0] ?? 0);
        po.push(tri[j] ? (tri[j][1] / somme) * total : 0);
      }
      return i;
    };
    for (const t of bout) for (let k = 0; k < 3; k++) milieu(tris[t * 3 + k], tris[t * 3 + ((k + 1) % 3)]);
    const nouveaux: number[] = [];
    const prochain = new Set<number>();
    const ajouter = (a: number, b: number, c: number, enfant: boolean) => {
      if (enfant) prochain.add(nouveaux.length / 3);
      nouveaux.push(a, b, c);
    };
    for (let t = 0; t < tris.length / 3; t++) {
      const s = [tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]];
      const mi = [0, 1, 2].map((k) => milieux.get(cle(s[k], s[(k + 1) % 3])));
      const coupes = mi.filter((x) => x !== undefined).length;
      if (coupes === 0) { ajouter(s[0], s[1], s[2], false); continue; }
      if (coupes === 3) {
        // Coupe en quatre, sens de parcours conservé.
        const [m0, m1, m2] = mi as number[];
        const enfant = bout.has(t);
        ajouter(s[0], m0, m2, enfant); ajouter(m0, s[1], m1, enfant); ajouter(m2, m1, s[2], enfant); ajouter(m0, m1, m2, enfant);
        continue;
      }
      // Fermeture : rotation pour que l'arête (s0, s1) soit coupée.
      let r = mi.findIndex((x) => x !== undefined);
      if (coupes === 2 && mi[(r + 2) % 3] !== undefined) r = (r + 2) % 3;
      const a = s[r], b = s[(r + 1) % 3], c = s[(r + 2) % 3];
      const mab = mi[r] as number, mbc = mi[(r + 1) % 3];
      if (mbc === undefined) { ajouter(a, mab, c, false); ajouter(mab, b, c, false); continue; }
      ajouter(mab, b, mbc, false); ajouter(a, mab, mbc, false); ajouter(a, mbc, c, false);
    }
    tris = nouveaux;
    bout = prochain;
  }
  if (pos.length / 3 > 4194304 || n0 > 4194304) throw new Error("subdivision : trop de sommets");
  return {
    positions: Float32Array.from(pos), normales: Float32Array.from(nor), uv: Float32Array.from(uv),
    indicesOs: Uint16Array.from(io), poidsOs: Float32Array.from(po), indices: Uint32Array.from(tris),
  };
}
