/**
 * Équipement d'un joueur (PUR) : principale + secondaire + spéciale éventuelle (+ couteau toujours présent), garde-fous de types,
 * alias v1 (`arme`), navigation entre slots, mémorisation (`localStorage` `pdj-fps-equipement`, migration de `pdj-fps-arme`, stockage injecté),
 * chaîne des slots du HUD. (v10, zombies) inventaire façon Black Ops 1 : emplacements génériques, `slotPourNouvelleArme`, `couteauTenable`.
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§2.4, §5.12), 2026-10-27-arene-zombies-design.md (épée)
 */
import {
  ARMES, ARMES_PRINCIPALES, ARMES_SECONDAIRES, ARMES_SPECIALES, ARMES_UNIQUES, EQUIPEMENT_DEFAUT, SLOTS, copierEquipement, estMelee,
  type ArmeFeuId, type ArmeId, type ArmeMeleeId, type ArmePrincipaleId, type ArmeSecondaireId, type ArmeSpecialeId, type ArmeUniqueId, type Equipement, type Slot,
} from "./protocole";

export const estPrincipale = (x: unknown): x is ArmePrincipaleId => (ARMES_PRINCIPALES as readonly unknown[]).includes(x);
export const estSecondaire = (x: unknown): x is ArmeSecondaireId => (ARMES_SECONDAIRES as readonly unknown[]).includes(x);
export const estSpeciale = (x: unknown): x is ArmeSpecialeId => (ARMES_SPECIALES as readonly unknown[]).includes(x);
export const estUnique = (x: unknown): x is ArmeUniqueId => (ARMES_UNIQUES as readonly unknown[]).includes(x);
export const estSpecialeOuUnique = (x: unknown): x is ArmeSpecialeId | ArmeUniqueId => estSpeciale(x) || estUnique(x);
export const estArmeFeu = (x: unknown): x is ArmeFeuId => (ARMES as readonly unknown[]).includes(x);
export const estSlot = (x: unknown): x is Slot => (SLOTS as readonly unknown[]).includes(x);

/** Arme blanche de l'équipement (couteau si `melee` est absent). */
export function meleeDe(eq: Readonly<Equipement>): ArmeMeleeId { return eq.melee ?? "couteau"; }

/**
 * Arme d'un slot (l'arme blanche pour `couteau` ; null si le slot spécial est vide, pour la principale / secondaire d'un équipement
 * `sansPrincipale` / `sansSecondaire`, ou (v8) pour le slot de l'arme déposée dans le Micro-ondes, `enCuisson`).
 */
export function armeDuSlot(eq: Equipement, slot: Slot): ArmeId | null {
  const a = armeBruteDuSlot(eq, slot);
  return a !== null && eq.enCuisson !== undefined && a === eq.enCuisson ? null : a;
}
function armeBruteDuSlot(eq: Equipement, slot: Slot): ArmeId | null {
  switch (slot) {
    case "principale": return eq.sansPrincipale ? null : eq.principale;
    case "secondaire": return eq.sansSecondaire ? null : eq.secondaire;
    case "couteau": return meleeDe(eq);
    case "speciale": return eq.speciale;
  }
}

/** Slot qui porte `arme` dans cet équipement, null si elle n'y est pas (ou si elle est au Micro-ondes). */
export function slotDeLArme(eq: Equipement, arme: ArmeId): Slot | null {
  if (estMelee(arme)) return "couteau";
  if (eq.enCuisson !== undefined && arme === eq.enCuisson) return null;
  if (!eq.sansPrincipale && arme === eq.principale) return "principale";
  if (!eq.sansSecondaire && arme === eq.secondaire) return "secondaire";
  if (eq.speciale !== null && arme === eq.speciale) return "speciale";
  return null;
}

// ---------- (v10) inventaire des zombies : emplacements d'armes génériques ----------

/** (v10, zombies) Emplacements d'armes à feu, dans l'ordre où ils se remplissent : Arme 1, Arme 2, puis Arme 3 avec l'atout Bento. */
export function slotsArmesZombies(troisieme: boolean): Slot[] {
  return troisieme ? ["principale", "secondaire", "speciale"] : ["principale", "secondaire"];
}

/** Arme écrite dans un emplacement d'arme à feu, même déposée au Micro-ondes (`enCuisson`) ; null si l'emplacement est vide. */
export function armeEcriteDansSlot(eq: Equipement, slot: Exclude<Slot, "couteau">): ArmeFeuId | null {
  const a = armeBruteDuSlot(eq, slot);
  return a === null || estMelee(a) ? null : a;
}

/** Armes à feu réellement en main ou à la ceinture (pas celle du Micro-ondes). */
export function armesFeuPortees(eq: Equipement): ArmeFeuId[] {
  const res: ArmeFeuId[] = [];
  for (const s of ["principale", "secondaire", "speciale"] as const) {
    const a = armeDuSlot(eq, s);
    if (a !== null && !estMelee(a)) res.push(a);
  }
  return res;
}

/** (v10, zombies) L'arme blanche se prend seule en main tant qu'on porte moins de deux armes à feu (au-delà : coup rapide seulement). */
export function couteauTenable(eq: Equipement): boolean {
  return armesFeuPortees(eq).length < 2;
}

/** Vide un emplacement d'arme à feu (principale / secondaire : `sansPrincipale` / `sansSecondaire`, spéciale : null). */
export function viderSlot(eq: Equipement, slot: Exclude<Slot, "couteau">): void {
  if (slot === "principale") eq.sansPrincipale = true;
  else if (slot === "secondaire") eq.sansSecondaire = true;
  else eq.speciale = null;
}

/** Écrit `arme` dans un emplacement d'arme à feu (et lève le drapeau « vide » correspondant). */
export function poserDansSlot(eq: Equipement, slot: Exclude<Slot, "couteau">, arme: ArmeFeuId): void {
  if (slot === "principale") { eq.principale = arme; delete eq.sansPrincipale; }
  else if (slot === "secondaire") { eq.secondaire = arme; delete eq.sansSecondaire; }
  else eq.speciale = arme;
}

/**
 * (v10, zombies) Où ranger une arme à feu qu'on n'a pas encore (achat au mur, boîte, Micro-ondes) : le premier emplacement VIDE parmi
 * `slotsArmesZombies(troisieme)` (celui d'une arme au Micro-ondes est réservé, jamais vide) ; sinon elle remplace l'arme EN MAIN ; arme blanche
 * en main (moins de deux armes portées), elle remplace la première arme portée. `remplacee` : l'arme qui quitte l'inventaire, null si aucune.
 * Null : aucun emplacement possible (une seule arme, au Micro-ondes, et un emplacement : n'arrive pas avec deux emplacements au moins).
 */
export function slotPourNouvelleArme(eq: Equipement, main: Slot, troisieme: boolean): { slot: Exclude<Slot, "couteau">; remplacee: ArmeFeuId | null } | null {
  const slots = slotsArmesZombies(troisieme) as Exclude<Slot, "couteau">[];
  const vide = slots.find((s) => armeEcriteDansSlot(eq, s) === null);
  if (vide) return { slot: vide, remplacee: null };
  if (main !== "couteau" && (slots as Slot[]).includes(main)) {
    const a = armeDuSlot(eq, main);
    if (a !== null && !estMelee(a)) return { slot: main, remplacee: a };
  }
  for (const s of slots) {
    const a = armeDuSlot(eq, s);
    if (a !== null && !estMelee(a)) return { slot: s, remplacee: a };
  }
  return null;
}

/** Équipement valide : valeurs invalides remplacées par `prec`. La spéciale est celle de `prec` (elle ne se choisit pas). */
export function normaliserEquipement(brut: { principale?: unknown; secondaire?: unknown; melee?: unknown }, prec: Equipement): Equipement {
  const res = copierEquipement(prec);
  if (brut && typeof brut === "object") {
    if (estPrincipale(brut.principale)) res.principale = brut.principale;
    if (estSecondaire(brut.secondaire)) {
      res.secondaire = brut.secondaire;
      delete res.sansSecondaire; // choisir une secondaire en fournit une
    }
    // `couteau` = absent : seule l'épée écrit la clé ; une valeur inconnue garde celle de `prec`
    if (brut.melee === "epee") res.melee = "epee";
    else if (brut.melee === "couteau") delete res.melee;
  }
  return res;
}

/** Alias v1 `arme` → équipement + slot en main ; null si l'arme est invalide ou spéciale. */
export function depuisAlias(arme: unknown, prec: Equipement): { equip: Equipement; main: Slot } | null {
  if (estPrincipale(arme)) {
    const equip = { ...copierEquipement(prec), principale: arme };
    delete equip.sansPrincipale; // choisir une principale en fournit une
    return { equip, main: "principale" };
  }
  if (estSecondaire(arme)) {
    const equip = { ...copierEquipement(prec), secondaire: arme };
    delete equip.sansSecondaire;
    return { equip, main: "secondaire" };
  }
  return null;
}

/**
 * Slot suivant/précédent portant une arme (saute le spécial vide), cyclique. Sans autre slot, renvoie `depuis`. `permis` (v10, zombies) écarte
 * en plus des slots (l'arme blanche à partir de deux armes à feu).
 */
export function slotVoisin(eq: Equipement, depuis: Slot, sens: 1 | -1, permis: (s: Slot) => boolean = () => true): Slot {
  const n = SLOTS.length;
  const i0 = SLOTS.indexOf(depuis);
  for (let k = 1; k <= n; k++) {
    const s = SLOTS[(((i0 + sens * k) % n) + n) % n];
    if (armeDuSlot(eq, s) !== null && permis(s)) return s;
  }
  return depuis;
}

export const CLE_EQUIPEMENT = "pdj-fps-equipement";
/** Clé de la v1 : une seule arme, en chaîne brute. */
const CLE_ARME_V1 = "pdj-fps-arme";

/** Choix du lobby : `melee` absent = couteau. */
export interface ChoixArmes { principale: ArmePrincipaleId; secondaire: ArmeSecondaireId; melee?: ArmeMeleeId }

/**
 * Lecture localStorage `{principale, secondaire, melee?}` (une sauvegarde sans `melee` reste valide : couteau) ; migre `pdj-fps-arme` (l'arme est rangée dans son slot par catégorie, l'autre
 * slot prend le défaut). JSON abîmé, valeurs inconnues ou stockage absent : défaut, champ par champ. Stockage injecté.
 */
function choixDe(e: Equipement): ChoixArmes {
  const c: ChoixArmes = {
    principale: estPrincipale(e.principale) ? e.principale : EQUIPEMENT_DEFAUT.principale,
    secondaire: estSecondaire(e.secondaire) ? e.secondaire : EQUIPEMENT_DEFAUT.secondaire,
  };
  if (e.melee === "epee") c.melee = "epee";
  return c;
}

export function lireEquipement(stockage?: { getItem(k: string): string | null } | null): ChoixArmes {
  const defaut: ChoixArmes = { principale: EQUIPEMENT_DEFAUT.principale, secondaire: EQUIPEMENT_DEFAUT.secondaire };
  if (!stockage) return defaut;
  try {
    const s = stockage.getItem(CLE_EQUIPEMENT);
    if (s) {
      const brut: unknown = JSON.parse(s);
      if (brut && typeof brut === "object" && !Array.isArray(brut)) {
        const e = normaliserEquipement(brut as Record<string, unknown>, { ...defaut, speciale: null });
        return choixDe(e);
      }
    }
  } catch {
    // JSON abîmé : on retombe sur l'ancienne clé, puis sur le défaut
  }
  try {
    const alias = depuisAlias(stockage.getItem(CLE_ARME_V1), { ...defaut, speciale: null });
    if (alias) return choixDe(alias.equip);
  } catch {
    // stockage inaccessible
  }
  return defaut;
}

export function ecrireEquipement(eq: ChoixArmes, stockage?: { setItem(k: string, v: string): void } | null): boolean {
  try {
    if (!stockage) return false;
    stockage.setItem(CLE_EQUIPEMENT, JSON.stringify(eq.melee === "epee"
      ? { principale: eq.principale, secondaire: eq.secondaire, melee: "epee" }
      : { principale: eq.principale, secondaire: eq.secondaire }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Chaîne HUD "principale:fusil_assaut:23:30|secondaire:pistolet:12:12|couteau:couteau:0:0|speciale:railgun:4:6" et son décodage.
 * L'arme blanche (couteau ou épée) porte 0 / 0 (pas de munitions). Une éventuelle 5ᵉ colonne (réserve, HUD §3.2) est tolérée à la lecture et ignorée ici.
 */
export interface LigneSlot { slot: Slot; arme: ArmeId; munitions: number; chargeur: number }

const entierPositif = (v: number) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

export function serialiserSlots(lignes: readonly LigneSlot[]): string {
  return lignes.map((l) => `${l.slot}:${l.arme}:${entierPositif(l.munitions)}:${entierPositif(l.chargeur)}`).join("|");
}

/** (v10) Les emplacements d'armes à feu des zombies sont génériques : toute arme à feu y est valide ; l'arme blanche seulement au slot `couteau`. */
export function armeValidePourSlot(slot: Slot, arme: string): boolean {
  return slot === "couteau" ? estMelee(arme) : estArmeFeu(arme);
}

export function lireSlots(s: string): LigneSlot[] {
  const res: LigneSlot[] = [];
  if (typeof s !== "string" || s === "") return res;
  for (const morceau of s.split("|")) {
    const c = morceau.split(":");
    if (c.length !== 4 && c.length !== 5) continue;
    const [slot, arme, m, ch] = c;
    if (!estSlot(slot) || !armeValidePourSlot(slot, arme)) continue;
    if (!/^\d+$/.test(m) || !/^\d+$/.test(ch)) continue;
    res.push({ slot, arme: arme as ArmeId, munitions: Number(m), chargeur: Number(ch) });
  }
  return res;
}
