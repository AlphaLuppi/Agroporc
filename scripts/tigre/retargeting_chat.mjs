// Reciblage HORS LIGNE de la capture du chat « shake my hand » (vidéo : chat debout qui
// applaudit, agite les pattes, tend la patte pour serrer la main) sur le tigre du GLB.
//
//   node scripts/tigre/retargeting_chat.mjs [trajectoires.json] [lib/tigre3d/clips/chat-serre-main.json]
//
// Entrée : scripts/tigre/donnees/chat-shake-trajectoires.json (205 images à 30 i/s, 362 × 498 px,
// points 2D + confiance c, g/d = côté DU CHAT, g = droite de l'écran ; cf. son champ `convention`).
// Sortie : un clip d'images (format `ClipImages` de lib/tigre3d/gestes/types.ts, lu par
// `echantillonnerClip`) : une `PoseGeste` par image vidéo, au même instant (timing exact).
//
// Le tigre est DEBOUT sur ses pattes arrière, face caméra (cap 0), comme le chat. Rien n'est posé à
// la main : chaque grandeur vient des points de la vidéo.
//   1. Lissage léger sans retard : moyenne gaussienne centrée (σ = 0,7 image) pondérée par la confiance
//      (les claps et les balancements rapides gardent leur amplitude).
//   2. Points 2D → vecteurs 3D par segment : longueur 3D du segment = sa plus grande longueur projetée
//      (95e centile des images fiables), profondeur = raccourcissement √(L² − l²) le long de l'axe de
//      visée de la caméra de la vidéo (`ELEVATION` : elle filme le chat d'en haut). Le signe (vers ou
//      loin de l'objectif) est choisi sur toute la vidéo (Viterbi) : segments au plus près du plan
//      frontal, patte devant le poitrail, chemin le plus continu ; dans un segment annoté « patte d …
//      vers la caméra » (fin de la vidéo), cette patte va vers l'objectif plutôt que de pendre.
//   3. Buste : bassin → milieu des épaules = inclinaison avant du corps (tangage du tigre autour des
//      hanches) ; référence « droit » = longueur médiane des images 0–77 (chat droit à l'écran).
//   4. Pattes avant : le vecteur épaule → poignet du chat (bras + avant-bras, en 3D), divisé par la
//      longueur de son bras, multiplié par la longueur de la chaîne IK du tigre (épaule + bras), part de
//      l'épaule du tigre : c'est la cible IK du poignet (normalisation par longueurs de segments ; les
//      claps se touchent). Hors de portée, la cible est ramenée le long de la même direction.
//      Contacts lus dans l'image : quand les bouts de pattes du chat se touchent ou se croisent, c'est
//      le BOUT de la patte du tigre qui est reciblé (sa patte est plus courte), et la patte de devant
//      (la plus visible) passe devant l'autre ; quand le bout de patte recouvre le nez, le bout de
//      la patte du tigre va au museau du tigre (tête posée par les deltas de la même image).
//      Main : direction poignet → bout de patte du chat ; coussinet vers la caméra, ou vers l'autre
//      patte quand elles se rapprochent (paumes face à face aux claps). Angles d'Euler déroulés
//      d'une image à l'autre (aucun saut de ±2π à l'interpolation).
//   5. Tête : roulis = ligne des yeux ; lacet = glissement du nez sur l'axe des yeux ; tangage = écart
//      sommet du crâne – yeux (tête sphérique, lisible même patte devant le museau) ; neutre = regard
//      caméra. Cou : direction milieu des épaules → milieu des yeux. Mâchoire : `bouche`. Oreilles :
//      angle œil → oreille.
//   6. Queue : bassin → bout de queue quand elle est visible, derrière le corps ; cachée, elle reste
//      derrière lui (hors du champ), le long du sol ; mélange par la visibilité lissée.
//
// Constantes hors de la vidéo (géométrie, pas des poses) : élévation de la caméra, saillie du nez et
// élévation des yeux sur le crâne du chat, gain de la mâchoire, épaisseur du poitrail. Limites : le
// roulis latéral du buste et sa torsion ne sont pas rendus (le moteur ne cabre le corps qu'en tangage
// autour des hanches) ; la patte du tigre (sans coude, plus courte) ne va pas aussi loin que celle du
// chat (fin de la vidéo : patte tendue vers l'objectif).
import { readFileSync, writeFileSync } from "node:fs";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";

const ENTREE = process.argv[2] ?? "scripts/tigre/donnees/chat-shake-trajectoires.json";
const SORTIE = process.argv[3] ?? "lib/tigre3d/clips/chat-serre-main.json";
const SQUELETTE = "lib/tigre3d/donnees/squelette.json";

/** Élévation de la caméra de la vidéo (rad) : carrelage (Hough ≈ 60°) et proportions du chat (≈ 52°). */
const ELEVATION = (50 * Math.PI) / 180;
/** Saillie du nez du chat devant la ligne des yeux, en écarts d'yeux (géométrie d'une tête de chat) : lacet. */
const SAILLIE_NEZ = 0.45;
/** Ouverture de la mâchoire du tigre (rad) pour `bouche` = 1 (pas d'intérieur de gueule : menton baissé). */
const GAIN_MACHOIRE = 0.5;
/** Bout de patte « au nez » : distance image (en écarts d'yeux) sous laquelle le contact est plein / nul. */
const CONTACT_NEZ = [1.3, 2.3];
/** Bouts de pattes « qui se touchent » : distance image (en largeurs d'épaules), plein / nul. */
const CONTACT_PATTES = [0.35, 0.8];
/** Avance (m, vers l'objectif) de la patte de devant quand les pattes se croisent. */
const ECART_CROISE = 0.03;
/** Images où le chat est droit à l'écran (référence du buste et du cou) : segments 0 à 6. */
const IMAGES_DROIT = [0, 77];
/** Images fiables pour les longueurs de référence (au-delà : patte d près de l'objectif, en partie synthétique). */
const IMAGES_REFERENCE = [0, 155];

const donnees = JSON.parse(readFileSync(ENTREE, "utf8"));
const N = donnees.n, FPS = donnees.fps;

// ─── Squelette de repos du tigre (repère du modèle) ─────────────────────────────────────────────
const sqj = JSON.parse(readFileSync(SQUELETTE, "utf8"));
const ROLES = {
  racine: "_rootJoint", hancheG: "Bone005_03", cuisseG: "Bone006_04",
  epauleG: "Bone002_017", brasG: "Bone003_018", mainG: "Bone004_019", bout_mainG: "Bone004_end_032",
  epauleD: "Bone022_026", brasD: "Bone023_027", mainD: "Bone024_028", bout_mainD: "Bone024_end_037",
  cou: "Bone015_020", tete: "Bone017_00", bout_tete: "Bone017_end_034", queue1: "Bone009_07", bout_queue: "Bone014_end_030",
};
const repos = (() => {
  const pr = sqj.parentRacine;
  const mRacine = new Matrix4().compose(new Vector3(...pr.t), new Quaternion(...pr.q), new Vector3(pr.s, pr.s, pr.s));
  const M = [];
  sqj.os.forEach((o, k) => {
    const local = new Matrix4().compose(new Vector3(...o.t), new Quaternion(...o.q), new Vector3(1, 1, 1));
    M[k] = (o.parent < 0 ? mRacine.clone() : M[o.parent].clone()).multiply(local);
  });
  const r = {};
  for (const [role, nom] of Object.entries(ROLES)) {
    const k = sqj.os.findIndex((o) => o.nom === nom);
    if (k < 0) throw new Error(`os ${nom} absent`);
    r[role] = new Vector3().setFromMatrixPosition(M[k]);
  }
  return r;
})();
const LONGUEUR_CHAINE = {
  G: repos.epauleG.distanceTo(repos.brasG) + repos.brasG.distanceTo(repos.mainG),
  D: repos.epauleD.distanceTo(repos.brasD) + repos.brasD.distanceTo(repos.mainD),
};
/** Direction de repos du cou (racine du cou → pivot de la tête), de la queue (base → bout), de la main. */
const COU0 = repos.tete.clone().sub(repos.cou).normalize();
/** Patte du tigre (poignet → bout), au repos, et sa longueur ; largeur d'épaules (bras G ↔ D). */
const BOUT_MAIN = { G: repos.bout_mainG.clone().sub(repos.mainG), D: repos.bout_mainD.clone().sub(repos.mainD) };
const LONGUEUR_PATTE = { G: BOUT_MAIN.G.length(), D: BOUT_MAIN.D.length() };
const LARGEUR_EPAULES_TIGRE = repos.brasG.distanceTo(repos.brasD);
const QUEUE0 = repos.bout_queue.clone().sub(repos.queue1).normalize();

// ─── Points de la vidéo : lissage sans retard pondéré par la confiance ──────────────────────────
const NOMS = Object.keys(donnees.images[0].points).concat(["bout_queue"]);
const brut = {};
for (const nom of new Set(NOMS)) {
  brut[nom] = donnees.images.map((im) => {
    const p = im.points[nom];
    return p && p.x != null ? { x: p.x, y: p.y, c: p.c ?? 0 } : { x: 0, y: 0, c: 0 };
  });
}
const SIGMA = 0.7, RAYON = 3;
const G = Array.from({ length: 2 * RAYON + 1 }, (_, j) => Math.exp(-((j - RAYON) ** 2) / (2 * SIGMA * SIGMA)));
function lisser(serie) {
  return serie.map((_, i) => {
    let sx = 0, sy = 0, sw = 0, sc = 0, sg = 0;
    for (let j = -RAYON; j <= RAYON; j++) {
      const k = i + j;
      if (k < 0 || k >= N) continue;
      const g = G[j + RAYON], c = serie[k].c;
      const w = g * Math.max(c, 1e-3) * (c > 0 ? 1 : 0);
      sx += w * serie[k].x; sy += w * serie[k].y; sw += w; sc += g * c; sg += g;
    }
    return sw > 0 ? { x: sx / sw, y: sy / sw, c: sc / sg } : { x: serie[i].x, y: serie[i].y, c: 0 };
  });
}
const P = {};
for (const nom of Object.keys(brut)) P[nom] = lisser(brut[nom]);
const bouche = lisserScalaire(donnees.images.map((im) => im.bouche ?? 0));
function lisserScalaire(s) {
  return s.map((_, i) => {
    let a = 0, w = 0;
    for (let j = -RAYON; j <= RAYON; j++) { const k = i + j; if (k < 0 || k >= N) continue; a += G[j + RAYON] * s[k]; w += G[j + RAYON]; }
    return a / w;
  });
}

/** Queue : visibilité (confiance du bout de queue) lissée plus fort (σ = 4 images), et « derrière ». */
const visibiliteQueue = (() => {
  const c = P.bout_queue.map((p) => Math.min(1, Math.max(0, (p.c - 0.3) / 0.35)));
  const s = 4, R = 12;
  return c.map((_, i) => {
    let a = 0, w = 0;
    for (let j = -R; j <= R; j++) { const k = i + j; if (k < 0 || k >= N) continue; const g = Math.exp(-(j * j) / (2 * s * s)); a += g * c[k]; w += g; }
    return a / w;
  });
})();
const DERRIERE = new Vector3(0, -0.15, -1).normalize();
/** Patte d devant la g (> 0) : confiance du bout de patte d moins celle du g, lissée (σ = 4 images). */
const devant = (() => {
  const c = P.bout_patte_d.map((p, i) => p.c - P.bout_patte_g[i].c);
  return c.map((_, i) => {
    let a = 0, w = 0;
    for (let j = -12; j <= 12; j++) { const k = i + j; if (k < 0 || k >= N) continue; const g = Math.exp(-(j * j) / 32); a += g * c[k]; w += g; }
    return a / w;
  });
})();

// Image → plan (a vers la droite de l'écran = +X du tigre face à nous, b vers le haut).
const vec2 = (de, a, i) => ({ a: P[a][i].x - P[de][i].x, b: -(P[a][i].y - P[de][i].y) });
const milieu = (n1, n2, i) => ({ x: (P[n1][i].x + P[n2][i].x) / 2, y: (P[n1][i].y + P[n2][i].y) / 2 });
const norme2 = (v) => Math.hypot(v.a, v.b);
const sinE = Math.sin(ELEVATION), cosE = Math.cos(ELEVATION);
/**
 * Vecteur 2D projeté (a, b) d'un segment de longueur 3D L → vecteur 3D (X droite, Y haut, Z vers la
 * caméra, horizontal). Caméra en plongée d'`ELEVATION` : b = Y·cos e − Z·sin e ; la composante le long
 * de l'axe de visée (w ≥ 0 : vers l'objectif) vaut √(L² − a² − b²).
 */
function en3D(v, L, versCamera = 1) {
  const w = versCamera * Math.sqrt(Math.max(0, L * L - v.a * v.a - v.b * v.b));
  return new Vector3(v.a, v.b * cosE + w * sinE, -v.b * sinE + w * cosE);
}
function centile(xs, q) {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
}
function mediane(xs) { return centile(xs, 0.5); }
const plage = ([a, b]) => Array.from({ length: b - a + 1 }, (_, k) => a + k);

/** Longueur de référence d'un segment (95e centile des projections, deux côtés, images fiables). */
function longueurRef(de, a) {
  const l = [];
  for (const i of plage(IMAGES_REFERENCE)) for (const s of ["g", "d"]) {
    const n1 = de.replace("#", s), n2 = a.replace("#", s);
    if (P[n1][i].c >= 0.4 && P[n2][i].c >= 0.4) l.push(norme2(vec2(n1, n2, i)));
  }
  return centile(l, 0.95);
}
const L_BRAS = longueurRef("epaule_#", "coude_#");
const L_AVANT_BRAS = longueurRef("coude_#", "poignet_#");
const L_PATTE = longueurRef("poignet_#", "bout_patte_#");

const milieuEpaules = (i) => milieu("epaule_g", "epaule_d", i);
const milieuYeux = (i) => milieu("oeil_g", "oeil_d", i);
const vecPts = (A, B) => ({ a: B.x - A.x, b: -(B.y - A.y) });
const buste2 = (i) => vecPts(P.bassin_centre[i], milieuEpaules(i));
const cou2 = (i) => vecPts(milieuEpaules(i), milieuYeux(i));
// Droit à l'écran : vertical en 3D, donc longueur 3D = projetée / cos e.
const L_BUSTE = mediane(plage(IMAGES_DROIT).map((i) => norme2(buste2(i)))) / cosE;
const L_COU = mediane(plage(IMAGES_DROIT).map((i) => norme2(cou2(i)))) / cosE;

// ─── Tête : mesures dans le repère des yeux (roulis retiré) ──────────────────────────────────────
function mesuresTete(i) {
  const g = P.oeil_g[i], d = P.oeil_d[i], n = P.nez[i];
  const roulis = Math.atan2(-(g.y - d.y), g.x - d.x); // > 0 : œil gauche (écran droite) plus haut
  const E = Math.hypot(g.x - d.x, g.y - d.y);
  const m = milieuYeux(i);
  // Nez dans le repère des yeux : u le long de la ligne d → g, v vers le bas du visage.
  const ux = (g.x - d.x) / E, uy = (g.y - d.y) / E;
  const dx = n.x - m.x, dy = n.y - m.y;
  const u = dx * ux + dy * uy, v = -dx * uy + dy * ux;
  const oreille = (s) => {
    const o = P[`oreille_${s}`][i], oe = P[`oeil_${s}`][i];
    const ox = o.x - oe.x, oy = o.y - oe.y;
    const ou = ox * ux + oy * uy, ov = -ox * uy + oy * ux; // ov < 0 : au-dessus des yeux
    return Math.atan2((s === "g" ? 1 : -1) * ou, -ov); // angle depuis la verticale, > 0 vers l'extérieur
  };
  // Sommet de la tête au-dessus de la ligne des yeux (repère des yeux, > 0 vers le haut).
  const st = P.sommet_tete[i];
  const sommet = -(-(st.x - m.x) * uy + (st.y - m.y) * ux);
  return { roulis, E, u, v, sommet, oreilleG: oreille("g"), oreilleD: oreille("d") };
}
const tetes = Array.from({ length: N }, (_, i) => mesuresTete(i));
const U0 = mediane(tetes.map((t) => t.u / t.E));
/** Élévation des yeux sur la sphère du crâne du chat (géométrie : yeux au-dessus de l'équateur). */
const ELEVATION_YEUX = (25 * Math.PI) / 180;
/** Rayon de la tête (en écarts d'yeux), du neutre : T₀ = ρ·(1 − sin β). */
const RAYON_TETE = mediane(plage(IMAGES_DROIT).map((i) => tetes[i].sommet / tetes[i].E)) / (1 - Math.sin(ELEVATION_YEUX));
const OREILLE0 = { G: mediane(tetes.map((t) => t.oreilleG)), D: mediane(tetes.map((t) => t.oreilleD)) };
const ROULIS0 = mediane(tetes.map((t) => t.roulis));

function orientationTete(i) {
  const t = tetes[i];
  // Échelle s (le chat s'approche de l'objectif) et lacet ψ : écart des yeux E = s·E₀·cos ψ ; le nez
  // (saillie r·E₀) glisse sur la ligne des yeux de s·r·E₀·sin ψ, donc u / E = r·tan ψ.
  const lacet = Math.atan((t.u / t.E - U0) / SAILLIE_NEZ);
  // Tangage p (> 0 : museau baissé) : tête = sphère de rayon ρ ; le sommet (silhouette) reste à +ρ au-
  // dessus du centre quand la tête bascule, les yeux (à l'élévation β sur la sphère) descendent en
  // ρ·sin(β − p). L'écart sommet–yeux T = ρ·(1 − sin(β − p)) se lit malgré la patte devant le museau ;
  // ρ vient du neutre (regard caméra, chat droit : images 0–77). Échelle : T rapporté à E / cos ψ.
  const T = (t.sommet * Math.cos(lacet)) / t.E;
  const sinus = Math.max(-1, Math.min(1, 1 - T / RAYON_TETE));
  const tangage = ELEVATION_YEUX - Math.asin(sinus);
  return { lacet, tangage, roulis: t.roulis - ROULIS0 };
}

// ─── Quaternions ──────────────────────────────────────────────────────────────────────────────
const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1);
const qAxe = (axe, a) => new Quaternion().setFromAxisAngle(axe, a);
const versEuler = (q) => { const e = new Euler().setFromQuaternion(q, "XYZ"); return [e.x, e.y, e.z]; };
/** Rotation minimale qui amène la direction u sur v. */
const qEntre = (u, v) => new Quaternion().setFromUnitVectors(u.clone().normalize(), v.clone().normalize());
/** Exprime une rotation monde dans le repère du corps (R_b⁻¹ · Q · R_b). */
const versCorps = (Rb, Q) => Rb.clone().invert().multiply(Q).multiply(Rb);
/**
 * Base (avant, normale) → rotation depuis la base de repos (avant +Z, coussinet −Y). Avec un état
 * (`etat` : avant et normale de l'image précédente), la normale suit la précédente transportée le
 * long du mouvement de la patte (aucune torsion ajoutée), puis tourne vers la normale voulue d'au plus
 * `TORSION_MAX` rad par image, d'autant moins qu'elle est mal définie (presque dans l'axe de la
 * patte) : jamais de retournement de la main d'une image à l'autre.
 */
const TORSION_MAX = 0.3;
function qBase(avant, normale, etat = null) {
  const f = avant.clone().normalize();
  const voulue = normale.clone().addScaledVector(f, -normale.dot(f));
  const nette = Math.min(1, Math.max(0, (voulue.length() - 0.1) / 0.4));
  let n;
  if (etat && etat.f) {
    n = etat.n.clone().applyQuaternion(qEntre(etat.f, f));
    n.addScaledVector(f, -n.dot(f)).normalize();
    if (voulue.lengthSq() > 1e-10) {
      const v = voulue.clone().normalize();
      const angle = Math.atan2(new Vector3().crossVectors(n, v).dot(f), n.dot(v));
      const pas = Math.max(-TORSION_MAX, Math.min(TORSION_MAX, angle)) * nette;
      n.applyAxisAngle(f, pas);
    }
  } else n = voulue.lengthSq() > 1e-10 ? voulue.normalize() : new Vector3(0, 1, 0).addScaledVector(f, -f.y).normalize();
  if (etat) { etat.f = f.clone(); etat.n = n.clone(); }
  const c = new Vector3().crossVectors(f, n);
  // Repos : f0 = +Z, n0 = −Y, c0 = f0 × n0 = +X.
  const M = new Matrix4().makeBasis(c, n.clone().negate(), f); // colonnes = images de +X, +Y, +Z
  return new Quaternion().setFromRotationMatrix(M);
}

/**
 * Cible du poignet (repère du corps) : épaule de repos + v. Hors de portée de la chaîne IK (qui part
 * du rachis, `epaule`), elle est ramenée LE LONG de la direction du bras du chat depuis l'épaule,
 * jusqu'au bord de la portée : le bras du tigre (plus court) garde l'angle du bras du chat.
 */
function portee(cote, v) {
  const S = repos[`bras${cote}`], R = repos[`epaule${cote}`], Lmax = 0.97 * LONGUEUR_CHAINE[cote];
  const cible = S.clone().add(v);
  if (cible.distanceTo(R) <= Lmax) return cible;
  const d = v.clone().normalize(), m = S.clone().sub(R);
  // |m + s·d| = Lmax, s > 0.
  const b = m.dot(d), c = m.lengthSq() - Lmax * Lmax;
  const s = -b + Math.sqrt(Math.max(0, b * b - c));
  return S.clone().addScaledVector(d, Math.max(0, s));
}

/**
 * Profondeur des bras : une vue unique laisse deux solutions par segment (w = ±√(L² − l²) le long de
 * l'axe de visée). On choisit, sur toute la vidéo à la fois (Viterbi, 4 combinaisons bras × avant-bras
 * par image), le chemin qui garde les segments au plus près du plan frontal du corps (|z| minimal),
 * la patte DEVANT le poitrail (z du poignet ≥ `DEVANT_POITRAIL`, en longueurs de bras) et le moins de
 * sauts d'une image à l'autre. Même chose pour la main (2 solutions).
 */
const DEVANT_POITRAIL = 0.15; // ≈ 5 cm devant l'épaule du tigre (épaisseur du poitrail)
const SAUT = 20;
function solutions(v, L) {
  return [en3D(v, L, 1), en3D(v, L, -1)];
}
function viterbi(etats, cout, transition) {
  const n = etats.length;
  let prec = etats[0].map((e) => cout(e, 0));
  const retour = [];
  for (let i = 1; i < n; i++) {
    const cur = [], ret = [];
    etats[i].forEach((e) => {
      let best = Infinity, arg = 0;
      etats[i - 1].forEach((f, k) => { const c = prec[k] + transition(f, e); if (c < best) { best = c; arg = k; } });
      cur.push(best + cout(e, i)); ret.push(arg);
    });
    prec = cur; retour.push(ret);
  }
  let k = prec.indexOf(Math.min(...prec));
  const chemin = [k];
  for (let i = n - 2; i >= 0; i--) { k = retour[i][k]; chemin.unshift(k); }
  return chemin.map((k, i) => etats[i][k]);
}
/** Épaule de la vidéo (plan image, px) → monde orthographique (dans le plan du corps). */
const epaule3 = (s, i) => { const p = P[`epaule_${s}`][i]; return new Vector3(p.x, -p.y * cosE, p.y * sinE); };
/** Segments annotés « patte x … vers la camera » : CETTE patte va vers l'objectif (au lieu de pendre). */
const VERS_CAMERA = { g: new Set(), d: new Set() };
for (const sg of donnees.segments) {
  const m = /patte (g|d)\b[^,;]*vers la camera/.exec(sg.geste);
  if (m) for (let i = sg.debut; i <= sg.fin; i++) VERS_CAMERA[m[1]].add(i);
}
const BRAS = { g: [], d: [] };
for (const s of ["g", "d"]) {
  const Lt = L_BRAS + L_AVANT_BRAS;
  const etats = Array.from({ length: N }, (_, i) => {
    const B = solutions(vec2(`epaule_${s}`, `coude_${s}`, i), L_BRAS);
    const A = solutions(vec2(`coude_${s}`, `poignet_${s}`, i), L_AVANT_BRAS);
    const r = [];
    for (const b of B) for (const a of A) r.push({ n: b.clone().add(a).divideScalar(Lt), z: (Math.abs(b.z) + Math.abs(a.z)) / Lt, zv: (b.z + a.z) / Lt });
    return r;
  });
  const choix = viterbi(
    etats,
    (e, i) => (VERS_CAMERA[s].has(i) ? -e.zv : e.z) + 10 * Math.max(0, DEVANT_POITRAIL - e.n.z),
    (f, e) => SAUT * f.n.distanceTo(e.n),
  );
  const mains = viterbi(
    Array.from({ length: N }, (_, i) => solutions(vec2(`poignet_${s}`, `bout_patte_${s}`, i), L_PATTE).map((m) => m.divideScalar(L_PATTE))),
    (m) => Math.abs(m.z), (f, e) => SAUT * f.distanceTo(e),
  );
  choix.forEach((c, i) => BRAS[s].push({ n: c.n, main: mains[i].clone().normalize() }));
}

// ─── Reciblage image par image ───────────────────────────────────────────────────────────────
const arrondi = (x) => Math.round(x * 1e3) / 1e3 + 0; // mm / mrad : assez fin, fichier léger
const r3v = (v) => v.map(arrondi);
// ─── Contacts lus dans l'image (par image, puis lissés : un contact s'établit sur quelques images) ──
const lisse01 = (x, a, b) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
const dist2 = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
function lisserSigma(serie, sigma) {
  const R = Math.ceil(3 * sigma);
  return serie.map((_, i) => {
    let a = 0, w = 0;
    for (let j = -R; j <= R; j++) { const k = i + j; if (k < 0 || k >= N) continue; const g = Math.exp(-(j * j) / (2 * sigma * sigma)); a += g * serie[k]; w += g; }
    return a / w;
  });
}
const SIGMA_CONTACT = 2;
const largeurEpaulesPx = Array.from({ length: N }, (_, i) => Math.hypot(P.epaule_g[i].x - P.epaule_d[i].x, P.epaule_g[i].y - P.epaule_d[i].y));
// Bouts de pattes qui se touchent / se croisent.
const kToucheS = lisserSigma(Array.from({ length: N }, (_, i) => 1 - lisse01(dist2(P.bout_patte_g[i], P.bout_patte_d[i]) / largeurEpaulesPx[i], CONTACT_PATTES[0], CONTACT_PATTES[1])), SIGMA_CONTACT);
const croiseS = lisserSigma(Array.from({ length: N }, (_, i) => lisse01((P.bout_patte_d[i].x - P.bout_patte_g[i].x) / largeurEpaulesPx[i], -0.05, 0.2)), SIGMA_CONTACT);
// Bout de patte sur le nez.
const kNezS = {};
for (const s of ["g", "d"]) {
  kNezS[s] = lisserSigma(Array.from({ length: N }, (_, i) => {
    const bout = P[`bout_patte_${s}`][i], ctr = P[`centre_patte_${s}`][i], nez = P.nez[i];
    return (1 - lisse01(Math.min(dist2(bout, nez), dist2(ctr, nez)) / tetes[i].E, CONTACT_NEZ[0], CONTACT_NEZ[1])) * lisse01(bout.c, 0.3, 0.5);
  }), SIGMA_CONTACT);
}
// Normale du coussinet : vers la caméra, ou vers l'autre patte quand elles se rapprochent ; lissée.
const normaleS = {};
for (const s of ["g", "d"]) {
  const autre = s === "g" ? "d" : "g";
  const brut = Array.from({ length: N }, (_, i) => {
    const poignet = (c) => epaule3(c, i).divideScalar(L_BRAS + L_AVANT_BRAS).add(BRAS[c][i].n);
    const versAutre = poignet(autre).sub(poignet(s));
    const kPaume = 1 - lisse01(versAutre.length(), 0.2, 0.9);
    return new Vector3(0, 0, 1).lerp(versAutre.normalize(), kPaume).normalize();
  });
  const xs = lisserSigma(brut.map((v) => v.x), SIGMA_CONTACT), ys = lisserSigma(brut.map((v) => v.y), SIGMA_CONTACT), zs = lisserSigma(brut.map((v) => v.z), SIGMA_CONTACT);
  normaleS[s] = xs.map((x, i) => new Vector3(x, ys[i], zs[i]).normalize());
}

const images = [];
const mesures = [];
/** Normale de main de l'image précédente, par côté (cf. qBase). */
const normalePrec = {};
for (let i = 0; i < N; i++) {
  // Buste → tangage du tigre (autour des hanches) : π/2 = droit, moins = penché vers la caméra.
  const buste = en3D(buste2(i), L_BUSTE);
  const penche = Math.atan2(buste.z, buste.y);
  const tangage = Math.PI / 2 - penche;
  const Rb = qAxe(X, -tangage); // rotation du corps (moteur : Euler(−tangage) autour de X)
  const RbInv = Rb.clone().invert();

  // Tête et cou (d'abord : le museau posé sert de cible au contact patte → nez).
  const o = orientationTete(i);
  const C = qAxe(Y, o.lacet).multiply(qAxe(X, o.tangage)).multiply(qAxe(Z, o.roulis));
  const cou3 = en3D(cou2(i), L_COU);
  const couMonde = COU0.clone().applyQuaternion(Rb);
  const Dcou = versCorps(Rb, qEntre(couMonde, cou3));
  const parentTete = Rb.clone().multiply(Dcou);
  const Dtete = parentTete.clone().invert().multiply(C);
  const deltas = {
    cou: versEuler(Dcou),
    tete: versEuler(Dtete),
    machoire: versEuler(Dtete.clone().multiply(qAxe(X, GAIN_MACHOIRE * bouche[i]))),
  };
  // Museau du tigre en repère du corps (cinématique directe des deltas : cou, puis tête).
  const DcDt = Dcou.clone().multiply(Dtete);
  const teteP = repos.cou.clone().add(repos.tete.clone().sub(repos.cou).applyQuaternion(Dcou));
  const museau = teteP.clone().add(repos.bout_tete.clone().sub(repos.tete).applyQuaternion(DcDt));

  // Pattes avant.
  const pattes = {};
  const mesurePattes = {};
  const largeurEpaules = largeurEpaulesPx[i];
  // Bouts de pattes qui se touchent / se croisent ; patte de devant = la plus visible.
  const kTouche = kToucheS[i], croise = croiseS[i];
  const devantD = 1 / (1 + Math.exp(-8 * devant[i]));
  for (const [s, cote] of [["g", "G"], ["d", "D"]]) {
    const { n, main } = BRAS[s][i];
    const normale = normaleS[s][i];
    // Main : rotation monde H (repos → avant = poignet → bout, coussinet vers la caméra ou vers l'autre
    // patte) ; le moteur l'applique en repère du corps (corps · extremite · repos) : extremite = R_b⁻¹ · H.
    const H = qBase(main, normale, (normalePrec[cote] ??= {}));
    const Ecorps = RbInv.clone().multiply(H);
    // Cible du poignet (monde, m) : épaule de repos + vecteur du chat (normalisé par les longueurs de bras).
    // Bouts qui se touchent : on recible le bout (n + (rapport du chat − rapport du tigre) · main).
    const rapportChat = L_PATTE / (L_BRAS + L_AVANT_BRAS), rapportTigre = LONGUEUR_PATTE[cote] / LONGUEUR_CHAINE[cote];
    const v = n.clone().addScaledVector(main, (rapportChat - rapportTigre) * kTouche).multiplyScalar(LONGUEUR_CHAINE[cote]);
    // Pattes croisées : celle de devant passe devant l'autre (vers l'objectif).
    v.z += ECART_CROISE * croise * (s === "d" ? devantD : 1 - devantD);
    let cible = repos[`bras${cote}`].clone().add(v.applyQuaternion(RbInv));
    // Bout de patte sur le nez du chat : le bout de la patte du tigre va au museau du tigre (même décalage
    // image, à l'échelle des épaules), un peu devant ; le poignet s'en déduit par l'orientation de la main.
    const bout = P[`bout_patte_${s}`][i], nez = P.nez[i];
    const kNez = kNezS[s][i];
    if (kNez > 1e-3) {
      const echelle = LARGEUR_EPAULES_TIGRE / largeurEpaules;
      const decalage = new Vector3((bout.x - nez.x) * echelle, -(bout.y - nez.y) * echelle, 0.02).applyQuaternion(RbInv);
      const poignetNez = museau.clone().add(decalage).sub(BOUT_MAIN[cote].clone().applyQuaternion(Ecorps));
      cible.lerp(poignetNez, kNez);
    }
    cible = portee(cote, cible.sub(repos[`bras${cote}`]));
    pattes[`av${cote}`] = { cible: r3v([cible.x, cible.y, cible.z]), extremite: versEuler(Ecorps) };
    mesurePattes[cote] = { n: [n.x, n.y, n.z], kNez, kTouche, croise };
  }

  const t = tetes[i];
  const dOreille = {
    G: Math.max(-0.6, Math.min(0.6, t.oreilleG - OREILLE0.G)),
    D: Math.max(-0.6, Math.min(0.6, t.oreilleD - OREILLE0.D)),
  };
  // Oreille G (+X) vers l'extérieur = rotation −Z ; D (−X) = +Z.
  deltas.oreilleG = r3v(versEuler(Dtete.clone().multiply(qAxe(Z, -dOreille.G))));
  deltas.oreilleD = r3v(versEuler(Dtete.clone().multiply(qAxe(Z, dOreille.D))));

  // Queue : visible → direction bassin → bout de queue, derrière le corps (w ≤ 0) ; cachée → derrière
  // le corps (elle n'est pas dans le champ), le long du sol. Mélange par la visibilité lissée.
  const kq = visibiliteQueue[i];
  let dir = DERRIERE.clone();
  if (kq > 0.001) {
    const v = vec2("bassin_centre", "bout_queue", i);
    const vu = en3D(v, norme2(v) * 1.15, -1).normalize();
    dir = DERRIERE.clone().lerp(vu, kq).normalize();
  }
  const D = versCorps(Rb, qEntre(QUEUE0.clone().applyQuaternion(Rb), dir));
  const tiers = new Quaternion().slerp(D, 1 / 3);
  for (const q of ["queue1", "queue2", "queue3"]) deltas[q] = r3v(versEuler(tiers));

  images.push({
    corps: { tangage: arrondi(tangage), pivot: "hanches" },
    pattes,
    deltas,
    // Pas de `poids` : chaque groupe touché (corps, pattes avant, cou, tête, mâchoire, oreilles, queue) vaut 1.
  });
  mesures.push({ i, penche, tete: o, pattes: mesurePattes });
  if (process.env.TRACE) console.log(i, (penche * 57.3).toFixed(1), (o.lacet * 57.3).toFixed(1), (o.tangage * 57.3).toFixed(1), (o.roulis * 57.3).toFixed(1), P.nez[i].c.toFixed(2));
}

// Angles d'Euler déroulés : de chaque triplet (x, y, z) XYZ on garde, parmi ses deux écritures
// équivalentes ((x, y, z) et (x + π, π − y, z + π)) à 2π près, celle la plus proche de l'image
// précédente. Le clip est interpolé composante par composante : sans cela, un passage par ±π
// faisait faire un tour complet à la main en une image.
const TAU = 2 * Math.PI;
const pres = (x, ref) => x + TAU * Math.round((ref - x) / TAU);
function derouler(e, ref) {
  if (!ref) return e;
  let mieux = null, dMin = Infinity;
  for (const c of [e, [e[0] + Math.PI, Math.PI - e[1], e[2] + Math.PI]]) {
    const u = c.map((x, k) => pres(x, ref[k]));
    const d = Math.hypot(u[0] - ref[0], u[1] - ref[1], u[2] - ref[2]);
    if (d < dMin) { dMin = d; mieux = u; }
  }
  return mieux;
}
{
  const precedent = {};
  for (const im of images) {
    for (const cote of ["avG", "avD"]) {
      const k = `p.${cote}`;
      im.pattes[cote].extremite = r3v(precedent[k] = derouler(im.pattes[cote].extremite, precedent[k]));
    }
    for (const r of Object.keys(im.deltas)) {
      const k = `d.${r}`;
      im.deltas[r] = r3v(precedent[k] = derouler(im.deltas[r], precedent[k]));
    }
  }
}
// Contrôle : les deux écritures donnent bien la même rotation.
{
  const e = [0.3, -0.7, 2.9], q1 = new Quaternion().setFromEuler(new Euler(...e, "XYZ"));
  const q2 = new Quaternion().setFromEuler(new Euler(e[0] + Math.PI, Math.PI - e[1], e[2] + Math.PI, "XYZ"));
  if (q1.angleTo(q2) > 1e-6) throw new Error("écriture d'Euler équivalente fausse");
}

const clip = {
  nom: "chat-serre-main",
  fps: FPS,
  source: "Capture 2D de la vidéo « shake my hand » (chat debout), reciblée par scripts/tigre/retargeting_chat.mjs : ne pas éditer à la main.",
  segments: donnees.segments,
  images,
};
// Une image par ligne : diff lisible.
const texte = `{\n "nom": ${JSON.stringify(clip.nom)},\n "fps": ${clip.fps},\n "source": ${JSON.stringify(clip.source)},\n "segments": ${JSON.stringify(clip.segments)},\n "images": [\n${images.map((im) => "  " + JSON.stringify(im)).join(",\n")}\n ]\n}\n`;
writeFileSync(SORTIE, texte);
const info = {
  images: N, fps: FPS, duree_s: (N - 1) / FPS,
  longueurs_px: { bras: L_BRAS, avantBras: L_AVANT_BRAS, patte: L_PATTE, buste: L_BUSTE, cou: L_COU, yeux: mediane(tetes.map((t) => t.E)) },
  chaineTigre_m: LONGUEUR_CHAINE,
  penche_deg: [Math.min(...mesures.map((m) => m.penche)), Math.max(...mesures.map((m) => m.penche))].map((x) => +(x * 180 / Math.PI).toFixed(1)),
};
console.log(`${N} images → ${SORTIE} (${(texte.length / 1024).toFixed(0)} Ko)`);
console.log(JSON.stringify(info));
