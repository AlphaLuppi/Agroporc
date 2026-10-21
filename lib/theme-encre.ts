// Changement de thème « tache d'encre » : le nouveau thème part du bouton
// cliqué et s'étale jusqu'à couvrir toute la page (View Transitions API +
// masque SVG aux bords irréguliers). Repli instantané sans l'API ou en
// mouvement réduit.

/** Le blob du masque (viewBox 200) : rayon garanti couvert = 0,3 × taille. */
export const COUVERTURE_BLOB = 0.3;
export const DUREE_ENCRE_MS = 750;

/** Distance du point (x, y) au coin le plus éloigné de la fenêtre. */
export function rayonCouvrant(x: number, y: number, largeur: number, hauteur: number): number {
  return Math.hypot(Math.max(x, largeur - x), Math.max(y, hauteur - y));
}

/** Taille finale du masque (px) pour que le blob couvre tout l'écran. */
export function tailleMasque(rayon: number): number {
  return Math.ceil(rayon / COUVERTURE_BLOB) + 2;
}

/** Image de masque : disque déformé par du bruit + gouttelettes projetées. */
export function blobSvg(graine: number): string {
  const gouttes = [
    [100, 18, 5], [176, 84, 4], [150, 168, 6], [34, 152, 4], [26, 62, 5], [122, 186, 3],
  ]
    .map(([cx, cy, r]) => `<circle cx='${cx}' cy='${cy}' r='${r}'/>`)
    .join("");
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'>` +
    `<filter id='e' x='-20%' y='-20%' width='140%' height='140%'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='0.03' numOctaves='3' seed='${graine}'/>` +
    `<feDisplacementMap in='SourceGraphic' scale='22' xChannelSelector='R' yChannelSelector='G'/>` +
    `</filter>` +
    `<g filter='url(#e)'><circle cx='100' cy='100' r='70'/>${gouttes}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

type DocumentAvecVT = Document & {
  startViewTransition?: (maj: () => void) => { ready: Promise<void>; finished: Promise<void> };
};

/** Applique `maj` (qui pose le nouveau thème) en tache d'encre depuis `origine`. */
export function changerThemeEncre(origine: HTMLElement, maj: () => void): void {
  const doc = document as DocumentAvecVT;
  const reduit = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!doc.startViewTransition || reduit) {
    maj();
    return;
  }

  const r = origine.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const taille = tailleMasque(rayonCouvrant(x, y, window.innerWidth, window.innerHeight));
  const racine = document.documentElement;
  racine.style.setProperty("--pdj-encre", blobSvg(Math.floor(Math.random() * 1000)));
  racine.classList.add("pdj-encre");

  const transition = doc.startViewTransition(maj);
  transition.ready
    .then(() => {
      racine.animate(
        {
          maskSize: ["0px 0px", `${taille}px ${taille}px`],
          maskPosition: [`${x}px ${y}px`, `${x - taille / 2}px ${y - taille / 2}px`],
        },
        {
          duration: DUREE_ENCRE_MS,
          easing: "cubic-bezier(.22, .8, .3, 1)",
          fill: "forwards",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    })
    .catch(() => {});
  transition.finished.finally(() => racine.classList.remove("pdj-encre")).catch(() => {});
}
