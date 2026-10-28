/**
 * Moteur client du mode Battle Royale (PUR : ni DOM ni three, ni horloge ni hasard globaux ; les instants sont passés par l'appelant).
 *  - `ControleurVol` : le joueur dans l'avion, en chute libre, sous parachute, puis au sol. Il prédit la chute avec le MÊME `pasChute` que le
 *    serveur (qui reste autoritaire et simule en temps réel à partir des entrées envoyées en `chute`, ≈ 30 Hz) ; recalage en vol seulement au-delà
 *    de 25 m d'écart avec le snap, téléportation à l'atterrissage au-delà de 0,5 m (cf. spec « Protocole de la chute »).
 *  - `ButinClient` : objets au sol tels que le serveur les décrit (message `butin`) ; AUCUNE génération côté client.
 *  - `inviteRamassage` : l'objet à portée et le texte de l'invite « [E] … ».
 *  - `SuiviSpectateur` : qui le joueur mort regarde.
 *  - `etatHudBr` / `etatBrHud` : champs du HUD (scalaires pour `HudEtat`, complets pour `JeuHandle.br()`).
 * Spec : docs/superpowers/specs/2026-10-28-battle-royale-design.md (§Chute, §Inventaire, §Spectateur, §Client)
 */
import { STATS } from "./armes";
import { BR } from "./br-regles";
import { CHUTE_BR, etatChuteInitial, hauteurAuSol, pasChute, pasDuTemps, positionAvionBr, type EtatChute } from "./br-chute";
import { appliquerRamassage, raretePourArme, type ResultatRamassage } from "./br-butin";
import { distanceAuBord, etatDepuisZoneBr, horsZone } from "./br-zone";
import type { Monde } from "./collision";
import type {
  ArmeFeuId, AvionBr, ClasseMunitions, Equipement, EtatPartieBr, MessageClient, MessageServeur, ObjetBr, Rarete, Vec3, ZoneBr,
} from "./protocole";
import type { EtatBrHud, HudEtat } from "./jeu-types";

// ---------- ControleurVol ----------

export type PhaseVol = "avion" | "libre" | "voile" | "attenteAtterri" | "sol";

/** Période d'envoi du message `chute` (ms) : 30 Hz. */
export const PERIODE_CHUTE_MS = 1000 / 30;
/** Écart au snap retardé (m) au-delà duquel la prédiction est recalée en vol. */
export const ECART_RECALAGE_M = 25;
/** Écart à la position d'atterrissage du serveur (m) au-delà duquel le client s'y téléporte. */
export const ECART_ATTERRISSAGE_M = 0.5;
/** La caméra du passager est à cette hauteur au-dessus de l'avion (m). */
export const CAMERA_AVION_DY = 2;

/** Entrées d'une image : regard, déplacement (`avance`, `lateral` dans [−1, 1]) et touche de saut TENUE (le front montant est détecté ici). */
export interface EntreesVol { lacet: number; tangage: number; avance: number; lateral: number; saut: boolean }
/** Ce qui vient de se passer pendant `maj` : l'appelant envoie `sauter`, joue le son de la voile, attend `atterri`. */
export interface EvenementsVol {
  /** front montant de la touche de saut dans l'avion : envoyer `{ t: "sauter" }` */
  sauter: boolean;
  /** le parachute vient de s'ouvrir dans la prédiction */
  voile: boolean;
  /** la prédiction vient de toucher le sol ou un toit : figé jusqu'au message `atterri` */
  atterri: boolean;
}
export interface EtatVol {
  phase: PhaseVol;
  p: Vec3;
  v: Vec3;
  /** hauteur des pieds au-dessus du sol ou du toit sous eux (m), mise à jour à chaque `maj` */
  hauteur: number;
  /** vitesse de descente (m/s, ≥ 0) */
  vitesseDescente: number;
  voile: boolean;
  /** secondes depuis l'ouverture du parachute / depuis le saut */
  tVoile: number;
  tLibre: number;
}

const SANS_EVENT: EvenementsVol = { sauter: false, voile: false, atterri: false };
const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** Quantification des entrées : le client prédit avec les valeurs qu'il envoie, le serveur simule les mêmes. */
const q3 = (x: number): number => Math.round((Number.isFinite(x) ? x : 0) * 1000) / 1000 + 0;
const q2 = (x: number): number => Math.round((Number.isFinite(x) ? Math.min(1, Math.max(-1, x)) : 0) * 100) / 100 + 0;

export class ControleurVol {
  private phaseVol: PhaseVol = "sol";
  private avion: AvionBr | null = null;
  private e: EtatChute = etatChuteInitial([0, 0, 0], [0, 0, 0]);
  /** hauteur au-dessus du sol, vitesse de descente */
  private hauteur = 0;
  /** ms de temps de jeu non encore transformées en pas fixes */
  private reste = 0;
  /** horloge locale (ms, somme des `dt`) et instant du dernier `chute` envoyé */
  private horloge = 0;
  private dernierEnvoi = -Infinity;
  /** dernières entrées quantifiées (celles du dernier `maj`) */
  private avance = 0;
  private lateral = 0;
  /** touche de saut tenue à l'image précédente (détection du front montant) */
  private sautTenu = false;
  /** ouverture du parachute demandée (appui après le délai minimal) ; envoyée tant que le snap n'a pas montré `chute: "voile"` */
  private ouvertureDemandee = false;
  private voileConfirmee = false;

  /** Le joueur monte dans l'avion (message `br{etat}` + `rejoindre`) : phase "avion", position = celle de l'avion à `tsServeur`. */
  entrerAvion(avion: AvionBr, tsServeur: number): void {
    this.avion = { ...avion, depart: [...avion.depart], arrivee: [...avion.arrivee] };
    this.phaseVol = "avion";
    this.e = etatChuteInitial(positionAvionBr(avion, tsServeur), [0, 0, 0]);
    this.hauteur = avion.altitude;
    this.reste = 0;
    this.dernierEnvoi = -Infinity;
    this.sautTenu = false;
    this.ouvertureDemandee = false;
    this.voileConfirmee = false;
  }

  /** Retour à blanc (fin de partie, mort, changement de mode). */
  reinitialiser(): void {
    this.phaseVol = "sol";
    this.avion = null;
    this.e = etatChuteInitial([0, 0, 0], [0, 0, 0]);
    this.hauteur = 0;
    this.reste = 0;
    this.dernierEnvoi = -Infinity;
    this.sautTenu = false;
    this.ouvertureDemandee = false;
    this.voileConfirmee = false;
  }

  phase(): PhaseVol { return this.phaseVol; }

  /** En vol (chute libre, voile, ou attente du message d'atterrissage) : le serveur ignore alors `etat`. */
  enVol(): boolean { return this.phaseVol === "libre" || this.phaseVol === "voile" || this.phaseVol === "attenteAtterri"; }

  /** Position de l'avion à `tsServeur` (la caméra du passager y ajoute `CAMERA_AVION_DY`). Garde aussi la position du joueur à bord. */
  positionAvion(tsServeur: number): Vec3 {
    if (!this.avion) return [0, 0, 0];
    const p = positionAvionBr(this.avion, tsServeur);
    if (this.phaseVol === "avion") this.e = { ...this.e, p: [p[0], p[1], p[2]] };
    return p;
  }

  /** Message `saut` du serveur (ordre ou éjection forcée) : début de la chute libre à l'état initial du serveur. */
  surSaut(m: Extract<MessageServeur, { t: "saut" }>): void {
    this.e = etatChuteInitial(m.p, m.v);
    this.phaseVol = "libre";
    this.hauteur = this.e.p[1];
    this.reste = 0;
    this.dernierEnvoi = -Infinity;
    // le même appui qui quitte l'avion n'ouvre pas le parachute : il faut relâcher puis réappuyer
    this.sautTenu = true;
    this.ouvertureDemandee = false;
    this.voileConfirmee = false;
  }

  /**
   * Avance d'une image (`dt` en secondes). Dans l'avion : détecte l'appui sur saut (`sauter`). En vol : accumule le temps en pas fixes
   * (`pasDuTemps`, au plus 6 par appel) et les passe à `pasChute` avec les mêmes entrées que celles envoyées ; l'appui sur saut, une fois
   * `delaiOuvertureMinMs` écoulées depuis le saut, demande l'ouverture du parachute. Figé à l'atterrissage prédit jusqu'à `surAtterri`.
   */
  maj(dt: number, entrees: EntreesVol, monde: Monde): EvenementsVol {
    const dtMs = Number.isFinite(dt) && dt > 0 ? dt * 1000 : 0;
    this.horloge += dtMs;
    this.avance = q2(entrees.avance);
    this.lateral = q2(entrees.lateral);
    const front = entrees.saut && !this.sautTenu;
    this.sautTenu = entrees.saut;

    if (this.phaseVol === "avion") return front ? { sauter: true, voile: false, atterri: false } : SANS_EVENT;
    if (this.phaseVol !== "libre" && this.phaseVol !== "voile") return SANS_EVENT;

    if (front && !this.ouvertureDemandee && this.e.tLibre + 1e-9 >= CHUTE_BR.delaiOuvertureMinMs / 1000) this.ouvertureDemandee = true;

    const en = { lacet: q3(entrees.lacet), tangage: q3(entrees.tangage), avance: this.avance, lateral: this.lateral, ouvrir: this.ouvertureDemandee };
    const r = pasDuTemps(dtMs, this.reste);
    this.reste = r.reste;
    let voile = false, atterri = false;
    for (let k = 0; k < r.pas && !atterri; k++) {
      const avant = this.e.voile;
      this.e = pasChute(this.e, en, monde);
      if (!avant && this.e.voile) voile = true;
      if (this.e.atterri) atterri = true;
    }
    if (this.e.voile) this.phaseVol = "voile";
    if (atterri) this.phaseVol = "attenteAtterri";
    this.hauteur = atterri ? 0 : hauteurAuSol(monde, this.e.p);
    return voile || atterri ? { sauter: false, voile, atterri } : SANS_EVENT;
  }

  /**
   * Message `chute` à envoyer (≈ 30 Hz : null entre deux envois, et hors vol). `lacet` / `tangage` sont le regard de la même image que le
   * dernier `maj` (arrondis au millième, comme dans la prédiction). `ouvrir` reste vrai tant que le snap n'a pas montré la voile.
   */
  message(lacet: number, tangage: number): Extract<MessageClient, { t: "chute" }> | null {
    if (!this.enVol()) return null;
    if (this.horloge - this.dernierEnvoi < PERIODE_CHUTE_MS - 2) return null;
    this.dernierEnvoi = this.horloge;
    return {
      t: "chute", lacet: q3(lacet), tangage: q3(tangage), avance: this.avance, lateral: this.lateral,
      ouvrir: this.ouvertureDemandee && !this.voileConfirmee,
    };
  }

  /**
   * Position de MON entrée dans le snap retardé (et son champ `chute`). Si la prédiction s'en écarte de plus de 25 m, elle est recalée
   * (vrai) ; la vitesse et le reste de l'état sont gardés. `chute: "voile"` arrête l'envoi de `ouvrir`.
   */
  recaler(pSnap: Vec3, chute?: "libre" | "voile"): boolean {
    if (chute === "voile") this.voileConfirmee = true;
    if (this.phaseVol !== "libre" && this.phaseVol !== "voile") return false;
    if (dist3(this.e.p, pSnap) <= ECART_RECALAGE_M) return false;
    this.e = { ...this.e, p: [pSnap[0], pSnap[1], pSnap[2]] };
    return true;
  }

  /**
   * Message `atterri` du serveur : fin de la chute. Si la position prédite diffère de plus de 0,5 m de `p`, le client s'y téléporte
   * (`teleporte`) ; sinon il garde la sienne. Renvoie la position avec laquelle repartir (le mouvement normal reprend de là).
   */
  surAtterri(p: Vec3): { p: Vec3; teleporte: boolean } {
    if (this.phaseVol === "sol") return { p: [this.e.p[0], this.e.p[1], this.e.p[2]], teleporte: false };
    const ecart = this.phaseVol === "avion" ? Infinity : dist3(this.e.p, p);
    const teleporte = ecart > ECART_ATTERRISSAGE_M;
    if (teleporte) this.e = { ...this.e, p: [p[0], p[1], p[2]] };
    this.e = { ...this.e, v: [0, 0, 0], atterri: true };
    this.phaseVol = "sol";
    this.hauteur = 0;
    this.ouvertureDemandee = false;
    return { p: [this.e.p[0], this.e.p[1], this.e.p[2]], teleporte };
  }

  /** Copie de l'état courant. */
  etat(): EtatVol {
    return {
      phase: this.phaseVol, p: [this.e.p[0], this.e.p[1], this.e.p[2]], v: [this.e.v[0], this.e.v[1], this.e.v[2]],
      hauteur: this.hauteur, vitesseDescente: Math.max(0, -this.e.v[1]), voile: this.e.voile, tVoile: this.e.tVoile, tLibre: this.e.tLibre,
    };
  }
}

// ---------- ButinClient ----------

const copieObjet = (o: ObjetBr): ObjetBr => {
  const c: ObjetBr = { id: o.id, genre: o.genre, ref: o.ref, p: [o.p[0], o.p[1], o.p[2]] };
  if (o.qte !== undefined) c.qte = o.qte;
  return c;
};

/**
 * Objets au sol. Le serveur est seul à tirer : la liste initiale complète (≈ 450 objets) arrive dans un premier message `butin{ajoutes}`,
 * puis les écarts (objets ramassés, lâchés). Un `ajoutes` qui reprend un id existant le remplace.
 */
export class ButinClient {
  private readonly objets = new Map<number, ObjetBr>();
  private cache: ObjetBr[] | null = null;
  private rev = 0;

  appliquer(m: Extract<MessageServeur, { t: "butin" }>): void {
    let change = false;
    for (const o of m.retires ?? []) change = this.objets.delete(o) || change;
    for (const o of m.ajoutes ?? []) { this.objets.set(o.id, copieObjet(o)); change = true; }
    if (change) { this.cache = null; this.rev++; }
  }

  /** Vide tout (nouvelle partie). */
  vider(): void {
    if (this.objets.size === 0) return;
    this.objets.clear();
    this.cache = null;
    this.rev++;
  }

  taille(): number { return this.objets.size; }
  objet(id: number): ObjetBr | undefined { return this.objets.get(id); }
  /** Numéro de révision : change à chaque modification (le rendu ne reconstruit qu'alors). */
  revision(): number { return this.rev; }

  /** Tous les objets, ordre d'insertion ; le tableau est réutilisé tant que rien ne change (ne pas le modifier). */
  pourDessin(): readonly ObjetBr[] {
    if (!this.cache) this.cache = [...this.objets.values()];
    return this.cache;
  }

  /** Objets à moins de `rayon` mètres de `p` (distance 3D), du plus proche au plus lointain. */
  proches(p: Vec3, rayon: number): ObjetBr[] {
    const r2 = rayon * rayon;
    const res: { o: ObjetBr; d: number }[] = [];
    for (const o of this.objets.values()) {
      const d = (o.p[0] - p[0]) ** 2 + (o.p[1] - p[1]) ** 2 + (o.p[2] - p[2]) ** 2;
      if (d <= r2) res.push({ o, d });
    }
    return res.sort((a, b) => a.d - b.d || a.o.id - b.o.id).map((x) => x.o);
  }
}

// ---------- invite de ramassage ----------

export interface InviteRamassage {
  id: number;
  objet: ObjetBr;
  /** nom de l'objet seul : « Fusil d'assaut (rare) » */
  libelle: string;
  /** texte après « [E] » : « Ramasser Fusil d'assaut (rare), remplace Pistolet » ou « Boîte de cartouches (aucune arme compatible) » */
  detail: string;
  /** ramasser ne servirait à rien (le serveur répondrait `inutile`) */
  refuse?: true;
}

const NOMS_RARETE: Record<Rarete, string> = { commun: "commun", peu_commun: "peu commun", rare: "rare", legendaire: "légendaire" };
const NOMS_CLASSE: Record<ClasseMunitions, string> = { legeres: "Boîte de munitions légères", moyennes: "Boîte de munitions moyennes", cartouches: "Boîte de cartouches" };

const nomArme = (ref: ArmeFeuId | "epee"): string => (ref === "epee" ? "Épée" : STATS[ref].nom);

/** Nom d'un objet pour l'interface : « Fusil d'assaut (rare) », « Boîte de cartouches », « Bandage ×2 », « Potion de bouclier ». */
export function libelleObjetBr(o: ObjetBr): string {
  switch (o.genre) {
    case "arme": {
      const ref = o.ref as ArmeFeuId | "epee" | null;
      return ref === null ? "Arme" : `${nomArme(ref)} (${NOMS_RARETE[raretePourArme(ref)]})`;
    }
    case "munitions": return NOMS_CLASSE[o.ref as ClasseMunitions] ?? "Munitions";
    case "bandage": return o.qte && o.qte > 1 ? `Bandage ×${o.qte}` : "Bandage";
    case "potion": return o.qte && o.qte > 1 ? `Potion de bouclier ×${o.qte}` : "Potion de bouclier";
  }
}

function raisonRefus(o: ObjetBr, r: ResultatRamassage): string {
  if (r.raison === "inutile") {
    if (o.genre === "munitions") return "aucune arme compatible";
    if (o.genre === "arme") return "déjà portée";
    return "pile pleine";
  }
  return "inutilisable";
}

/**
 * L'objet le plus proche à portée (≤ `BR.rayonRamassageM` en horizontal ET en hauteur) et le texte de l'invite. L'effet du ramassage vient de
 * `appliquerRamassage` (le même code que le serveur) : une boîte sans arme compatible, une pile pleine ou une épée déjà portée sont `refuse`.
 * À égalité de distance, le plus petit id. Null s'il n'y a rien à portée.
 */
export function inviteRamassage(
  butin: Pick<ButinClient, "pourDessin">, p: Vec3, equip: Readonly<Equipement>, soins: Readonly<{ bandage: number; potion: number }>,
): InviteRamassage | null {
  let meilleur: ObjetBr | null = null, dMin = Infinity;
  for (const o of butin.pourDessin()) {
    if (Math.abs(o.p[1] - p[1]) > BR.rayonRamassageM) continue;
    const d = Math.hypot(o.p[0] - p[0], o.p[2] - p[2]);
    if (d > BR.rayonRamassageM) continue;
    if (d < dMin - 1e-9 || (Math.abs(d - dMin) <= 1e-9 && meilleur !== null && o.id < meilleur.id)) { meilleur = o; dMin = d; }
  }
  if (!meilleur) return null;
  const libelle = libelleObjetBr(meilleur);
  const r = appliquerRamassage(equip, soins, meilleur);
  if (!r.ok) return { id: meilleur.id, objet: meilleur, libelle, detail: `${libelle} (${raisonRefus(meilleur, r)})`, refuse: true };
  const suites: string[] = [];
  if (r.ajoutMunitions) suites.push(`+${r.ajoutMunitions.chargeurs} chargeur${r.ajoutMunitions.chargeurs > 1 ? "s" : ""}`);
  for (const l of r.lache ?? []) if (l.genre === "arme" && l.ref !== null) suites.push(`remplace ${nomArme(l.ref as ArmeFeuId | "epee")}`);
  return { id: meilleur.id, objet: meilleur, libelle, detail: `Ramasser ${libelle}${suites.length ? `, ${suites.join(", ")}` : ""}` };
}

// ---------- spectateur ----------

/** Un joueur que le spectateur peut suivre. `vivant` absent = vivant. */
export interface CandidatSuivi { id: string; p: Vec3; vivant?: boolean }

const numeroId = (id: string): number => {
  const n = Number(id.replace(/\D+/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const ordreId = (a: string, b: string): number => numeroId(a) - numeroId(b) || (a < b ? -1 : a > b ? 1 : 0);

/**
 * Qui regarde le joueur mort : le tueur s'il vit, sinon le vivant le plus proche de l'endroit de la mort. Quand la cible meurt (ou quitte),
 * la suivante est la plus proche de sa dernière position. `suivant` / `precedent` parcourent les vivants par numéro d'id, en boucle.
 */
export class SuiviSpectateur {
  private cibleId: string | null = null;
  /** dernière position connue de la cible (ou lieu de la mort) : sert à choisir le plus proche */
  private ref: Vec3 = [0, 0, 0];

  constructor(private readonly moi: string = "") {}

  /** Démarre le suivi à la mort : `tueur` = id du tueur (null : aucun), `p` = lieu de la mort. */
  commencer(tueur: string | null, p: Vec3, candidats: readonly CandidatSuivi[]): string | null {
    this.ref = [p[0], p[1], p[2]];
    this.cibleId = null;
    const vivants = this.vivants(candidats);
    const t = tueur !== null ? vivants.find((c) => c.id === tueur) : undefined;
    this.cibleId = (t ?? this.plusProche(vivants))?.id ?? null;
    this.memoriser(vivants);
    return this.cibleId;
  }

  /** À chaque snap : si la cible est morte ou partie, bascule sur le plus proche de sa dernière position ; sinon suit sa position. */
  maj(candidats: readonly CandidatSuivi[]): string | null {
    const vivants = this.vivants(candidats);
    if (this.cibleId === null || !vivants.some((c) => c.id === this.cibleId)) this.cibleId = this.plusProche(vivants)?.id ?? null;
    this.memoriser(vivants);
    return this.cibleId;
  }

  cible(): string | null { return this.cibleId; }

  suivant(candidats: readonly CandidatSuivi[]): string | null { return this.pas(candidats, 1); }
  precedent(candidats: readonly CandidatSuivi[]): string | null { return this.pas(candidats, -1); }

  private pas(candidats: readonly CandidatSuivi[], sens: 1 | -1): string | null {
    const ids = this.vivants(candidats).map((c) => c.id).sort(ordreId);
    if (ids.length === 0) { this.cibleId = null; return null; }
    const i = this.cibleId === null ? -1 : ids.indexOf(this.cibleId);
    this.cibleId = i < 0 ? (sens === 1 ? ids[0] : ids[ids.length - 1]) : ids[(i + sens + ids.length) % ids.length];
    this.memoriser(this.vivants(candidats));
    return this.cibleId;
  }

  private vivants(candidats: readonly CandidatSuivi[]): CandidatSuivi[] {
    return candidats.filter((c) => c.vivant !== false && c.id !== this.moi);
  }

  private plusProche(vivants: readonly CandidatSuivi[]): CandidatSuivi | null {
    let m: CandidatSuivi | null = null, dm = Infinity;
    for (const c of vivants) {
      const d = Math.hypot(c.p[0] - this.ref[0], c.p[1] - this.ref[1], c.p[2] - this.ref[2]);
      if (d < dm - 1e-9 || (Math.abs(d - dm) <= 1e-9 && m !== null && ordreId(c.id, m.id) < 0)) { m = c; dm = d; }
    }
    return m;
  }

  private memoriser(vivants: readonly CandidatSuivi[]): void {
    const c = vivants.find((x) => x.id === this.cibleId);
    if (c) this.ref = [c.p[0], c.p[1], c.p[2]];
  }
}

// ---------- HUD ----------

export interface EntreeHudBr {
  /** dernier `br{etat}` reçu */
  partie: EtatPartieBr | null;
  vol: EtatVol;
  /** horloge serveur estimée (ms) */
  serveurT: number;
  /** position et lacet du joueur (ou de la cible suivie) */
  p: Vec3;
  lacet: number;
  vivant: boolean;
  bandage: number;
  potion: number;
  usage: { objet: "bandage" | "potion"; finT: number } | null;
  /** je regarde (mort) et qui */
  spectateur: boolean;
  suivi: string | null;
}

export type ChampsHudBr = Required<Pick<HudEtat, "phaseVol" | "altitude" | "vitesseChute" | "bandages" | "potions" | "usageSoin" | "horsZone" | "spectateur" | "spectateurCible">>;

const enJeu = (e: EntreeHudBr): boolean => e.partie !== null && (e.partie.phase === "vol" || e.partie.phase === "jeu");

/** Progression 0..1 de l'usage d'un soin (0 : aucun). */
export function progressionUsage(usage: { objet: "bandage" | "potion"; finT: number } | null, serveurT: number): number {
  if (!usage) return 0;
  const ms = BR.usage[usage.objet].ms;
  return Math.min(1, Math.max(0, (serveurT - (usage.finT - ms)) / ms));
}

/** Distance signée au bord de la zone (m, > 0 dehors) et cap relatif vers son centre (rad, 0 devant, + à droite) ; 0 / 0 sans zone. */
export function reperesZone(zone: ZoneBr | null, serveurT: number, p: Vec3, lacet: number): { distanceBord: number; capCentre: number } {
  if (!zone) return { distanceBord: 0, capCentre: 0 };
  const z = etatDepuisZoneBr(zone, serveurT);
  const cible = Math.atan2(-(z.centre[0] - p[0]), -(z.centre[1] - p[2]));
  let rel = lacet - cible; // le lacet croît vers la gauche : cible à droite = lacet plus grand
  rel = Math.atan2(Math.sin(rel), Math.cos(rel));
  return { distanceBord: distanceAuBord(z, p[0], p[2]), capCentre: rel };
}

/** Champs scalaires du HUD du Battle Royale (les valeurs continues passent par `HudLive.usage`). */
export function etatHudBr(e: EntreeHudBr): ChampsHudBr {
  const dedans = enJeu(e) && !e.spectateur;
  let dehors = false;
  if (dedans && e.vivant && e.partie!.zone && e.vol.phase !== "avion") {
    dehors = horsZone(etatDepuisZoneBr(e.partie!.zone, e.serveurT), e.p[0], e.p[2]);
  }
  const enVol = e.vol.phase === "libre" || e.vol.phase === "voile" || e.vol.phase === "avion";
  return {
    phaseVol: dedans ? e.vol.phase : "",
    altitude: enVol ? Math.max(0, Math.round(e.vol.hauteur)) : 0,
    vitesseChute: e.vol.phase === "libre" || e.vol.phase === "voile" ? Math.round(e.vol.vitesseDescente) : 0,
    bandages: e.bandage,
    potions: e.potion,
    usageSoin: e.usage ? e.usage.objet : "",
    horsZone: dehors,
    spectateur: e.spectateur,
    spectateurCible: e.spectateur ? (e.suivi ?? "") : "",
  };
}

/** État complet pour `JeuHandle.br()` : les champs du HUD, la zone, l'avion, les soins et les objets proches (objet neuf à chaque appel). */
export function etatBrHud(e: EntreeHudBr, proches: readonly ObjetBr[], place: number | null): EtatBrHud {
  const c = etatHudBr(e);
  const rep = e.partie?.zone && enJeu(e) ? reperesZone(e.partie.zone, e.serveurT, e.p, e.lacet) : { distanceBord: 0, capCentre: 0 };
  return {
    partie: e.partie, avion: e.partie?.avion ?? null, zone: e.partie?.zone ?? null,
    phaseVol: c.phaseVol, serveurT: e.serveurT, distanceBord: rep.distanceBord, capCentre: rep.capCentre,
    bandage: e.bandage, potion: e.potion, usage: e.usage ? { ...e.usage } : null,
    proches: [...proches], suivi: e.spectateur ? e.suivi : null, place: e.vivant ? null : place,
  };
}
