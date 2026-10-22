/**
 * Orchestration de l'easter egg « macron », sans React ni three (pur, testé par
 * lib/macron3d/declencheur.test.ts) : app/components/MacronEasterEgg.tsx s'en sert.
 *
 *   - `creerDeclencheur` : un seul passage à la fois (retaper « macron » pendant un passage ne
 *     relance rien), et rien quand le passage est impossible (prefers-reduced-motion, pas de
 *     WebGL, fenêtre modale ouverte) ;
 *   - `jouerPassage` : crée la scène (import dynamique de three), précharge le GLB, lance ; tout
 *     échec (GLB introuvable, contexte WebGL perdu) finit le passage SANS bruit ; l'annulation
 *     (démontage) libère la scène, et aucune scène n'est créée si elle arrive pendant l'import.
 */

export interface Declencheur {
  /** Démarre un passage s'il n'y en a pas déjà un ; `force` ignore `possible` (crochet de dev). */
  declencher(force?: boolean): boolean;
  /** Le passage est fini (ou abandonné) : le suivant pourra partir. */
  liberer(): void;
  enCours(): boolean;
}

export function creerDeclencheur(possible: () => boolean, demarrer: () => void): Declencheur {
  let enCours = false;
  return {
    declencher(force = false) {
      if (enCours) return false;
      if (!force && !possible()) return false;
      enCours = true;
      demarrer();
      return true;
    },
    liberer() { enCours = false; },
    enCours: () => enCours,
  };
}

/** Ce dont `jouerPassage` a besoin d'une scène (cf. SceneMacron dans scene.ts). */
export interface ScenePassage {
  precharger(): Promise<void>;
  dispose(): void;
}

export interface EtapesPassage<S extends ScenePassage, F> {
  /** Import dynamique du module de scène (three compris). */
  importer(): Promise<F>;
  /**
   * Crée la scène (renderer WebGL) ; `perte` : contexte WebGL perdu. Jamais appelé après une
   * annulation : en développement, React monte / démonte / remonte, et une scène créée puis
   * libérée ferait perdre son contexte au canvas que le second montage réutilise.
   */
  creer(module: F, perte: () => void): S;
  /** Modèle prêt : démarre la course (la scène appellera `fin` quand le coureur sera sorti). */
  lancer(scene: S): void;
  /** Passage fini ou abandonné (appelé au plus une fois, jamais après l'annulation). */
  fin(): void;
}

/** Joue un passage ; retourne l'annulation (démontage), qui libère tout. */
export function jouerPassage<S extends ScenePassage, F>(e: EtapesPassage<S, F>): () => void {
  let annule = false, fini = false;
  let scene: S | null = null;
  const fin = () => {
    if (annule || fini) return;
    fini = true;
    e.fin();
  };
  (async () => {
    const module = await e.importer();
    if (annule) return;
    const s = e.creer(module, fin);
    scene = s;
    await s.precharger();
    if (annule || fini) return;
    e.lancer(s);
  })().catch(fin);
  return () => {
    annule = true;
    scene?.dispose();
    scene = null;
  };
}
