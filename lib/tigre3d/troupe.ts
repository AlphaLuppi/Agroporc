/**
 * Troupe du tigre 3D : la mère (ou le tigre seul) et ses petits, chacun avec son animateur et sa
 * position en pixels d'écran. Logique pure (pas de three, pas de DOM) : le trajet, la fuite du
 * sursaut, le départ content ou vexé après la tape, la sortie de l'écran. La scène (scene.ts) se
 * contente d'appliquer les poses et de dessiner.
 *
 * Repère : x en pixels d'écran du centre du corps de chaque tigre (0 = bord gauche), à l'échelle
 * `pxParMetre` (un tigre mesure environ 3,75 m du museau au bout de la queue). Chaque tigre avance
 * exactement de ce que ses pieds ont parcouru (`anim.dx`, m du modèle × échelle) : aucun patinage.
 * Les petits calquent la vitesse de la mère (distance fixe) ; si elle sursaute et fuit, toute la
 * troupe fait demi-tour sur place. Une mère cliquée près d'un bord s'arrête (ou revient au pas)
 * dans la zone où elle reste entière à l'écran.
 */
import { creerAnimateur, type Animateur, type EvenementTigre } from "./animateur";
import { ECHELLE_PETIT, VITESSES, type Evenement } from "../tigre-courant";
import { LONGUEUR_MODELE_M } from "./os";

/** Mètres de scène par mètre du modèle, pour un tigre adulte de 3,75 m (le modèle fait 1,104 m). */
export const ECHELLE_MODELE = 3.75 / LONGUEUR_MODELE_M;

export interface MembreTroupe {
  anim: Animateur;
  /** 1 pour la mère, `ECHELLE_PETIT` pour un petit. */
  echelle: number;
  /** Abscisse du centre du corps (px d'écran). */
  x: number;
  /** Profondeur (m) : les petits ne sont pas tous dans le plan de la mère. */
  z: number;
}

export interface OptionsTroupe {
  evenement: Evenement;
  petits: number;
  sens: 1 | -1;
  /** Vitesse de la mère en largeurs de tigre par seconde. */
  vitesse: number;
  largeurEcran: number;
  /** Largeur d'un tigre adulte (px) : unité de vitesse. */
  largeurTigrePx: number;
  /** Pixels par mètre de tigre. */
  pxParMetre: number;
  alea?: () => number;
}

/** Demi-longueur d'un tigre (m, queue et marge comprises) : au-delà il est entièrement sorti. */
const DEMI_LONGUEUR_M = 2.3;
/** Distance (m) entre la mère et le premier petit, puis entre deux petits. */
const ECART_PREMIER_PETIT_M = 2.6;
const ECART_PETITS_M = 1.65;
/**
 * Réaction qui l'immobilise : la mère reste entièrement à l'écran. Marge (m) entre son centre et le
 * bord : un tigre cliqué à peine entré continue jusque-là, un tigre freiné près de la sortie revient
 * au pas (il marche, il ne glisse pas).
 */
const MARGE_REACTION_M = 1.5;

export interface Troupe {
  membres: MembreTroupe[];
  mere: MembreTroupe;
  /** Tous les tigres ont quitté l'écran. */
  termine: boolean;
  sur(f: (e: EvenementTigre) => void): void;
  maj(dt: number): void;
  clic(): "lancer" | "taper" | "ignorer";
  /** Abscisse du milieu de la troupe (px) : le canvas est centré dessus. */
  centre(): number;
  /** Étendue totale de la troupe (px), de bord à bord. */
  largeur(): number;
}

/** Étendue de la troupe en mètres, devant et derrière la mère (sens de course) : sert à dimensionner le canvas. */
export function etendueTroupe(petits: number): { devant: number; derriere: number } {
  const derriere = DEMI_LONGUEUR_M + (petits > 0 ? ECART_PREMIER_PETIT_M + ECART_PETITS_M * (petits - 1) : 0);
  return { devant: DEMI_LONGUEUR_M, derriere };
}

export function creerTroupe(o: OptionsTroupe): Troupe {
  const alea = o.alea ?? Math.random;
  const { sens, pxParMetre: pxm } = o;
  const mere: MembreTroupe = {
    anim: creerAnimateur({ sens, mode: o.evenement === "eclair" ? "eclair" : "galop", vitesse: o.vitesse, alea }),
    echelle: 1, x: 0, z: 0,
  };
  const membres: MembreTroupe[] = [mere];
  for (let i = 0; i < o.petits; i++) {
    membres.push({
      anim: creerAnimateur({ sens, mode: "trot", vitesse: o.vitesse, echelle: ECHELLE_PETIT, alea }),
      echelle: ECHELLE_PETIT, x: 0, z: i % 2 ? 0.25 : -0.2,
    });
  }
  /** px d'écran par mètre du modèle, pour un membre. */
  const pxParModele = (m: MembreTroupe) => ECHELLE_MODELE * m.echelle * pxm;
  const { devant } = etendueTroupe(o.petits);
  // Départ hors champ : le premier tigre (la mère) juste derrière le bord d'entrée, les petits après lui.
  mere.x = sens === 1 ? -devant * pxm : o.largeurEcran + devant * pxm;
  membres.slice(1).forEach((p, i) => {
    p.x = mere.x - sens * (ECART_PREMIER_PETIT_M + ECART_PETITS_M * i) * pxm;
  });
  const ecouteurs: Array<(e: EvenementTigre) => void> = [];
  let sorti = false;

  mere.anim.sur((e) => {
    if (e.type === "fuite") {
      // Tout le monde fait demi-tour sur place et file : la mère à l'éclair, les petits à son allure.
      const [min, max] = VITESSES.eclair;
      mere.anim.courir({ vitesse: min + alea() * (max - min) });
      for (const p of membres.slice(1)) p.anim.courir({ sens: e.sens, mode: "trot" });
    } else if (e.type === "fin" && e.vitesse) {
      mere.anim.courir({ vitesse: mere.anim.vitesse * e.vitesse });
    }
    for (const f of ecouteurs) f(e);
  });

  /** Un tigre est sorti de l'autre côté de l'écran, dans le sens où il court. */
  const estSorti = (m: MembreTroupe) => {
    const demi = DEMI_LONGUEUR_M * m.echelle * pxm;
    return m.anim.sens === 1 ? m.x - demi > o.largeurEcran : m.x + demi < 0;
  };

  const troupe: Troupe = {
    membres, mere,
    get termine() { return sorti; },
    sur: (f) => { ecouteurs.push(f); },
    maj(dt) {
      const m = mere.anim;
      // Zone d'arrêt de la mère (x de son corps) : entière à l'écran pendant une réaction.
      const marge = Math.min(MARGE_REACTION_M * pxm, o.largeurEcran / 2);
      const k = pxParModele(mere);
      m.zoneArret = {
        min: m.corps.x + (marge - mere.x) / k,
        max: m.corps.x + (o.largeurEcran - marge - mere.x) / k,
      };
      m.maj(dt);
      mere.x += m.dx * k;
      // Pendant que la mère réagit (hors bond), les petits s'arrêtent avec elle et se tournent vers nous.
      const fige = m.reaction != null && m.reaction.nom !== "saut" && m.reaction.nom !== "sursaut";
      for (const p of membres.slice(1)) {
        p.anim.figer(fige);
        p.anim.vitesse = m.vitesse;
        // Même vitesse d'écran que la mère, dans les unités du petit.
        p.anim.vitesseImposee = dt > 0 ? m.dx / dt / p.echelle : 0;
        p.anim.maj(dt);
        p.x += p.anim.dx * pxParModele(p);
      }
      sorti = membres.every(estSorti);
    },
    clic: () => mere.anim.clic(),
    centre() {
      const xs = membres.map((p) => p.x);
      return (Math.min(...xs) + Math.max(...xs)) / 2;
    },
    largeur() {
      const xs = membres.map((p) => p.x);
      return Math.max(...xs) - Math.min(...xs) + 2 * DEMI_LONGUEUR_M * pxm;
    },
  };
  return troupe;
}
