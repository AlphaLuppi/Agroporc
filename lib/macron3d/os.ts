/**
 * Os du coureur 3D par rôle. Le GLB (public/macron/macron.glb, « Emmanuel M. » de jamray747,
 * Sketchfab, CC BY 4.0) a un squelette Mixamo / Ready Player Me de 74 os dont les noms portent
 * un suffixe d'index Sketchfab (« LeftHand_017 », et l'atypique « RightHandMiddle2_00 ») : tout
 * le code passe par la clé sans suffixe (`cleOs`) puis par ces rôles. Pur (aucune dépendance) ;
 * lib/macron3d/os.test.ts vérifie que chaque clé existe une seule fois dans le GLB.
 *
 * Repère du modèle : visage vers +Z, haut +Y, gauche DU PERSONNAGE = +X ; pieds à y = 0 ; mètres.
 * G / D = côté du personnage.
 */

/** Nom d'os three → clé Mixamo (suffixe d'index retiré). */
export function cleOs(nom: string): string {
  return nom.replace(/_\d+$/, "");
}

export type Cote = "G" | "D";
export const COTES: readonly Cote[] = ["G", "D"];
/** +1 pour la gauche du personnage (x > 0), −1 pour la droite. */
export const SIGNE: Record<Cote, 1 | -1> = { G: 1, D: -1 };

const MIXAMO_COTE: Record<Cote, string> = { G: "Left", D: "Right" };

/** Rôles du tronc et de la tête → clé Mixamo. */
const AXE = {
  racine: "_rootJoint",
  bassin: "Hips",
  dos1: "Spine", dos2: "Spine1", dos3: "Spine2",
  cou1: "Neck", cou2: "Neck1", cou3: "Neck2",
  tete: "Head", sommet: "HeadTop_End",
} as const;

/** Rôles d'un côté (suffixés G / D) → clé Mixamo sans « Left » / « Right ». */
const MEMBRE = {
  oeil: "Eye",
  clavicule: "Shoulder", bras: "Arm", avantBras: "ForeArm", torsion1: "ForeArm1", torsion2: "ForeArm2", main: "Hand",
  pouce1: "HandThumb1", pouce2: "HandThumb2", pouce3: "HandThumb3",
  index1: "HandIndex1", index2: "HandIndex2", index3: "HandIndex3",
  majeur1: "HandMiddle1", majeur2: "HandMiddle2", majeur3: "HandMiddle3",
  annulaire1: "HandRing1", annulaire2: "HandRing2", annulaire3: "HandRing3",
  auriculaire1: "HandPinky1", auriculaire2: "HandPinky2", auriculaire3: "HandPinky3",
  cuisse: "UpLeg", tibia: "Leg", pied: "Foot", orteils: "ToeBase", boutPied: "Toe_End",
} as const;

type RoleAxe = keyof typeof AXE;
type RoleMembre = keyof typeof MEMBRE;
export type Role = RoleAxe | `${RoleMembre}${Cote}`;

/** Rôle → clé Mixamo (« mainG » → « LeftHand »). */
export const CLES_OS: Record<Role, string> = (() => {
  const r = { ...AXE } as Record<string, string>;
  for (const c of COTES) for (const [role, cle] of Object.entries(MEMBRE)) r[role + c] = MIXAMO_COTE[c] + cle;
  return r as Record<Role, string>;
})();

export const ROLES = Object.keys(CLES_OS) as Role[];

/** Rôle d'un côté : « bras » + « G ». */
export const deCote = (role: RoleMembre, c: Cote) => `${role}${c}` as Role;

/** Phalanges repliées pour un poing (doigts longs), dans l'ordre 1 → 3. */
export const DOIGTS = ["index", "majeur", "annulaire", "auriculaire"] as const;

/**
 * Index de chaque rôle dans une liste de noms d'os (noms three du GLB). Lève une erreur si un
 * rôle manque ou est ambigu : le modèle a changé, le code ne doit pas animer au hasard.
 */
export function indexerRoles(noms: readonly string[]): Record<Role, number> {
  const parCle = new Map<string, number>();
  const doublons = new Set<string>();
  noms.forEach((n, i) => {
    const c = cleOs(n);
    if (parCle.has(c)) doublons.add(c);
    parCle.set(c, i);
  });
  const r = {} as Record<Role, number>;
  for (const role of ROLES) {
    const cle = CLES_OS[role];
    if (doublons.has(cle)) throw new Error(`coureur 3D : os ${cle} en double dans le GLB`);
    const i = parCle.get(cle);
    if (i === undefined) throw new Error(`coureur 3D : os ${cle} absent du GLB`);
    r[role] = i;
  }
  return r;
}
