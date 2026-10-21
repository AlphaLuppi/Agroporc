// Lecture du squelette de repos d'un GLB (chunk JSON) : partagé par le script
// scripts/tigre/extraire_squelette.mjs et par le test qui vérifie lib/tigre3d/donnees/squelette.json.
// Sans dépendance (ni three ni Node) : composition des matrices des nœuds parents à la main.

/** Nom d'un nœud tel que GLTFLoader le donne à l'objet three (PropertyBinding.sanitizeNodeName). */
export function nomThree(nom) {
  return nom.replace(/\s/g, "_").replace(/[[\].:/]/g, "");
}

/** Chunk JSON d'un GLB (Uint8Array / Buffer). */
export function jsonGLB(octets) {
  const vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  const longueur = vue.getUint32(12, true);
  const texte = new TextDecoder().decode(octets.subarray(20, 20 + longueur));
  return JSON.parse(texte);
}

const arrondi = (x) => Math.round(x * 1e6) / 1e6;

// Matrices 4×4 en colonnes (comme three).
function matriceTRS(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
function produit(a, b) {
  const r = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let l = 0; l < 4; l++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + l] * b[c * 4 + k];
    r[c * 4 + l] = s;
  }
  return r;
}

/**
 * Squelette de repos : os du skin (ordre parent avant enfant), TRS locaux, et transformation
 * (repère de la scène glTF) du parent de la racine, décomposée en translation, quaternion, échelle
 * uniforme.
 */
export function extraireSquelette(octets) {
  const j = jsonGLB(octets);
  const skin = j.skins[0];
  const parent = new Map();
  j.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
  const joints = new Set(skin.joints);
  // Ordre topologique : profondeur croissante, puis ordre du skin.
  const profondeur = (i) => { let p = 0; for (let k = parent.get(i); k !== undefined; k = parent.get(k)) p++; return p; };
  const ordre = [...skin.joints].sort((a, b) => profondeur(a) - profondeur(b) || skin.joints.indexOf(a) - skin.joints.indexOf(b));
  const index = new Map(ordre.map((n, i) => [n, i]));
  const os = ordre.map((n) => {
    const nd = j.nodes[n];
    const p = parent.get(n);
    return {
      nom: nomThree(nd.name),
      parent: joints.has(p) ? index.get(p) : -1,
      t: (nd.translation ?? [0, 0, 0]).map(arrondi),
      q: (nd.rotation ?? [0, 0, 0, 1]).map(arrondi),
    };
  });
  const racine = ordre.find((n) => !joints.has(parent.get(n)));
  let m = matriceTRS();
  const chaine = [];
  for (let k = parent.get(racine); k !== undefined; k = parent.get(k)) chaine.unshift(k);
  for (const k of chaine) {
    const nd = j.nodes[k];
    m = produit(m, nd.matrix ?? matriceTRS(nd.translation, nd.rotation, nd.scale));
  }
  const s = Math.hypot(m[0], m[1], m[2]);
  // Quaternion de la matrice de rotation pure (colonnes / s).
  const r = [m[0] / s, m[1] / s, m[2] / s, m[4] / s, m[5] / s, m[6] / s, m[8] / s, m[9] / s, m[10] / s];
  const [m11, m21, m31, m12, m22, m32, m13, m23, m33] = r;
  const tr = m11 + m22 + m33;
  let q;
  if (tr > 0) { const k = 0.5 / Math.sqrt(tr + 1); q = [(m32 - m23) * k, (m13 - m31) * k, (m21 - m12) * k, 0.25 / k]; }
  else if (m11 > m22 && m11 > m33) { const k = 2 * Math.sqrt(1 + m11 - m22 - m33); q = [0.25 * k, (m12 + m21) / k, (m13 + m31) / k, (m32 - m23) / k]; }
  else if (m22 > m33) { const k = 2 * Math.sqrt(1 + m22 - m11 - m33); q = [(m12 + m21) / k, 0.25 * k, (m23 + m32) / k, (m13 - m31) / k]; }
  else { const k = 2 * Math.sqrt(1 + m33 - m11 - m22); q = [(m13 + m31) / k, (m23 + m32) / k, 0.25 * k, (m21 - m12) / k]; }
  return {
    source: "public/tigre/tigre.glb",
    parentRacine: { t: [m[12], m[13], m[14]].map(arrondi), q: q.map(arrondi), s: arrondi(s) },
    os,
  };
}
