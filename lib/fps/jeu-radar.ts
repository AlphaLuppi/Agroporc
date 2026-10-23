/**
 * Visibilité des joueurs sur la mini-map (PUR : ni three ni DOM). Pas de wallhack (HUD §3.3) : un joueur n'est dessiné que s'il passe
 * `dansChampDeVue` ET `ligneDeVue` de `visibilite.ts` (les tests des pseudos, mais SANS plafond de distance : la mini-map est bornée par son
 * rayon), ou s'il occupe MON véhicule. Le rayon de ligne de vue n'est lancé qu'à `PSEUDO.hzTest` par joueur (phases décalées par hachage de
 * l'id) ; `vu` monte aussitôt et redescend en 0,6 s (`lisserVu`). Un mort reste en croix 3 s (âge compté depuis sa première vue morte).
 * `jeu.ts` appelle `maj` une fois par image avec le `RadarFrame` unique.
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md (§3.3)
 */
import type { Monde } from "./collision";
import type { Vec3 } from "./protocole";
import { ajouterJoueur, lisserVu, type RadarFrame, type RadarJoueur } from "./radar";
import { PSEUDO, dansChampDeVue, ligneDeVue } from "./visibilite";

/** Un joueur à évaluer (position interpolée du rendu). */
export interface JoueurRadarEntree {
  id: string;
  /** pieds ; position du siège pour un joueur assis */
  p: Vec3;
  /** direction de son regard (rad), pour la flèche de la mini-map */
  lacet: number;
  couleur: string;
  vivant: boolean;
  accroupi?: boolean;
  enVoiture: boolean;
  /** occupe le même véhicule que moi : toujours montré (je le vois à mes côtés) */
  dansMonVehicule: boolean;
}

interface EtatSuivi {
  vu: number;
  phase: number;
  tranche: number;
  ligne: boolean;
  /** instant (s) où on l'a vu mort pour la première fois, null s'il est vivant */
  morteT: number | null;
}

/** Hachage FNV-1a de l'id → [0, 1[ (décale les rayons : tous les joueurs ne sont pas testés à la même image). */
function hachage01(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class SuiviRadar {
  private etats = new Map<string, EtatSuivi>();

  constructor(private readonly monde: Monde) {}

  /**
   * À appeler chaque image (`t` et `dt` en SECONDES, `t` croissant) : évalue chaque joueur puis ajoute à `f` ceux qui doivent être
   * dessinés (`f.nJoueurs` doit avoir été remis à zéro par `viderRadarFrame`). Un joueur absent de la liste est oublié.
   */
  maj(f: RadarFrame, t: number, dt: number, oeil: Vec3, regard: Vec3, joueurs: readonly JoueurRadarEntree[]): void {
    const periode = 1 / PSEUDO.hzTest;
    const pas = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const presents = new Set<string>();
    for (const j of joueurs) {
      presents.add(j.id);
      let e = this.etats.get(j.id);
      if (!e) {
        e = { vu: 0, phase: hachage01(j.id) * periode, tranche: Number.NaN, ligne: false, morteT: null };
        this.etats.set(j.id, e);
      }
      if (j.vivant) e.morteT = null;
      else if (e.morteT === null) e.morteT = t;

      let estVu = false;
      if (j.dansMonVehicule) {
        estVu = true;
      } else {
        const centre: Vec3 = [j.p[0], j.p[1] + 1.05, j.p[2]];
        if (dansChampDeVue(oeil, regard, centre)) {
          const tranche = Math.floor((t + e.phase) / periode);
          if (tranche !== e.tranche) {
            e.tranche = tranche;
            e.ligne = ligneDeVue(this.monde, oeil, j.p, !!j.accroupi);
          }
          estVu = e.ligne;
        } else {
          // hors champ : le prochain rayon se relance dès qu'il y rentre
          e.tranche = Number.NaN;
        }
      }
      e.vu = lisserVu(e.vu, estVu, pas);
      const etat: RadarJoueur["etat"] = !j.vivant ? "mort" : j.enVoiture ? "voiture" : "pied";
      ajouterJoueur(f, {
        id: j.id, x: j.p[0], z: j.p[2], cap: j.lacet, couleur: j.couleur, etat, vu: e.vu,
        age: e.morteT === null ? 0 : Math.max(0, t - e.morteT),
      });
    }
    for (const id of this.etats.keys()) if (!presents.has(id)) this.etats.delete(id);
  }

  /** Visibilité courante (0..1) d'un joueur déjà évalué, 0 si inconnu. */
  vu(id: string): number {
    return this.etats.get(id)?.vu ?? 0;
  }

  oublier(id: string): void {
    this.etats.delete(id);
  }

  vider(): void {
    this.etats.clear();
  }
}
