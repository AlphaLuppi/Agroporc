import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as THREE from "three";
import { STATS } from "./armes";
import { ARMES_MELEE } from "./protocole";
import {
  ETAT_TUILE_INITIAL, VITRINE, aideBarreArmes, armeSuivante, armesDeLaBarre, aspectTuile, cadrageGl, choixApres, distanceCamera, distanceCameraTuile, equipementApresTouche, groupesBarre,
  lacetTuile, pasTuile, rectVisible, tailleRelative, tuileVoisine, type ChoixBarre,
} from "./barre-armes";
import { boiteDesFaces } from "./rendu-armes-apercu";
import { creerArmeBot } from "./rendu";
import BarreArmes from "../../app/components/arene/BarreArmes";

const base: ChoixBarre = { principale: "mitraillette", secondaire: "pistolet" };

describe("groupes de la barre", () => {
  it("trois groupes : principales et secondaires de l'arène (rien des zombies), armes blanches couteau puis épée", () => {
    const g = groupesBarre(base);
    expect(g.map((x) => x.cle)).toEqual(["principale", "secondaire", "melee"]);
    for (const grp of g.slice(0, 2)) {
      for (const t of grp.tuiles) {
        expect(STATS[t.id as keyof typeof STATS].zombiesSeulement).toBeUndefined();
        expect(STATS[t.id as keyof typeof STATS].categorie).toBe(grp.cle);
      }
    }
    expect(g[2].tuiles.map((t) => t.id)).toEqual([...ARMES_MELEE]);
    expect(armesDeLaBarre("principale")).toContain("sniper");
    expect(armesDeLaBarre("secondaire")).not.toContain("rayon");
  });

  it("exactement une arme choisie par groupe ; l'arme blanche absente vaut le couteau", () => {
    for (const eq of [base, { ...base, melee: "epee" as const }, { principale: "sniper" as const, secondaire: "revolver" as const }]) {
      for (const grp of groupesBarre(eq)) expect(grp.tuiles.filter((t) => t.choisie)).toHaveLength(1);
    }
    expect(groupesBarre(base)[2].tuiles.find((t) => t.choisie)?.id).toBe("couteau");
    expect(groupesBarre({ ...base, melee: "epee" })[2].tuiles.find((t) => t.choisie)?.id).toBe("epee");
  });
});

describe("choix et cycle des touches", () => {
  it("choisir une arme ne change que son groupe, l'arme blanche est toujours rendue", () => {
    expect(choixApres(base, "pompe")).toEqual(["pompe", "pistolet", "couteau"]);
    expect(choixApres(base, "revolver")).toEqual(["mitraillette", "revolver", "couteau"]);
    expect(choixApres({ ...base, melee: "epee" }, "mitrailleuse")).toEqual(["mitrailleuse", "pistolet", "epee"]);
    expect(choixApres(base, "epee")).toEqual(["mitraillette", "pistolet", "epee"]);
  });

  it("une pression de la touche d'un groupe passe à l'arme d'après, circulairement", () => {
    const principales = armesDeLaBarre("principale");
    expect(armeSuivante(base, "principale")).toBe(principales[1]);
    const derniere: ChoixBarre = { ...base, principale: principales[principales.length - 1] as ChoixBarre["principale"] };
    expect(armeSuivante(derniere, "principale")).toBe(principales[0]);
    expect(equipementApresTouche(base, "melee")).toEqual(["mitraillette", "pistolet", "epee"]);
    expect(equipementApresTouche({ ...base, melee: "epee" }, "melee")).toEqual(["mitraillette", "pistolet", "couteau"]);
    const sec = armesDeLaBarre("secondaire");
    expect(equipementApresTouche(base, "secondaire")[1]).toBe(sec[(sec.indexOf("pistolet") + 1) % sec.length]);
  });

  it("flèches : tuile voisine sans boucle, arme inconnue repart de la première", () => {
    const toutes = groupesBarre(base).flatMap((g) => g.tuiles.map((t) => t.id));
    expect(tuileVoisine(base, toutes[0], -1)).toBe(toutes[0]);
    expect(tuileVoisine(base, toutes[0], 1)).toBe(toutes[1]);
    expect(tuileVoisine(base, toutes[toutes.length - 1], 1)).toBe(toutes[toutes.length - 1]);
    expect(tuileVoisine(base, "rayon", 1)).toBe(toutes[0]);
  });

  it("aide : touches réelles du joueur, jamais de touche absente", () => {
    expect(aideBarreArmes("1", "2", "3")).toBe("1 2 3 : arme suivante · Échap : menu");
    expect(aideBarreArmes("&", "—", "non assignée")).toBe("& : arme suivante · Échap : menu");
    expect(aideBarreArmes("", "", "")).toBe("Échap : menu");
  });
});

describe("vitrine animée", () => {
  const repos = { actif: false, choisie: false, mouvementReduit: false };

  it("au repos : balancement lent borné par l'amplitude de repos", () => {
    let e = { ...ETAT_TUILE_INITIAL };
    let max = 0;
    for (let i = 0; i < 600; i++) { e = pasTuile(e, 1 / 60, repos); max = Math.max(max, Math.abs(lacetTuile(e) - VITRINE.lacetBase)); }
    expect(max).toBeLessThanOrEqual(VITRINE.amplitudeRepos + 1e-9);
    expect(max).toBeGreaterThan(VITRINE.amplitudeRepos * 0.9);
  });

  it("actif : l'amplitude monte vers le tour complet sans à-coup, l'échelle grandit, puis tout redescend", () => {
    let e = { ...ETAT_TUILE_INITIAL };
    let precedent = e.amplitude;
    for (let i = 0; i < 180; i++) {
      e = pasTuile(e, 1 / 60, { actif: true, choisie: false, mouvementReduit: false });
      expect(e.amplitude - precedent).toBeLessThan(0.15); // jamais de saut d'une image à l'autre
      precedent = e.amplitude;
    }
    expect(e.amplitude).toBeGreaterThan(VITRINE.amplitudeActive * 0.95);
    expect(e.echelle).toBeGreaterThan(VITRINE.echelleActive * 0.97);
    for (let i = 0; i < 300; i++) e = pasTuile(e, 1 / 60, { ...repos, choisie: true });
    expect(e.amplitude).toBeCloseTo(VITRINE.amplitudeRepos, 1);
    expect(e.echelle).toBeCloseTo(VITRINE.echelleChoisie, 2);
  });

  it("mouvement réduit : plus aucune rotation (phase figée, amplitude nulle), seule l'échelle signale l'état", () => {
    let e = { ...ETAT_TUILE_INITIAL };
    for (let i = 0; i < 300; i++) e = pasTuile(e, 1 / 60, { actif: true, choisie: false, mouvementReduit: true });
    expect(e.phase).toBe(0);
    expect(e.amplitude).toBeCloseTo(0, 3);
    expect(e.echelle).toBeGreaterThan(1.1);
    expect(lacetTuile(e)).toBeCloseTo(VITRINE.lacetBase, 3);
  });

  it("un très grand pas de temps (onglet caché) ne fait pas exploser l'état", () => {
    const e = pasTuile(ETAT_TUILE_INITIAL, 120, { actif: true, choisie: true, mouvementReduit: false });
    expect(Number.isFinite(e.phase) && Number.isFinite(e.amplitude) && Number.isFinite(e.echelle)).toBe(true);
    expect(e.phase).toBeLessThan(VITRINE.vitesseActive * 0.25 + 1e-9);
  });

  it("taille relative : l'arme la plus longue remplit la tuile, les petites restent lisibles", () => {
    expect(tailleRelative(1, 1)).toBe(1);
    expect(tailleRelative(0.2, 1)).toBeGreaterThanOrEqual(0.35);
    expect(tailleRelative(0.2, 1)).toBeLessThan(tailleRelative(0.6, 1));
    expect(tailleRelative(0, 1)).toBe(1);
    expect(tailleRelative(2, 1)).toBe(1);
  });

  it("distance de la caméra : la sphère tient, plus loin quand la tuile est étroite", () => {
    const large = distanceCamera(0.5, 28, 1.6), etroite = distanceCamera(0.5, 28, 0.5);
    expect(large).toBeGreaterThan(0.5 / Math.sin((28 * Math.PI) / 360) - 1e-9);
    expect(etroite).toBeGreaterThan(large);
  });

  it("distance pour une tuile large et basse : l'arme (plate) remplit la largeur, bien plus près que la sphère englobante", () => {
    const aspect = 92 / 56, fov = 28;
    // fusil : emprise au sol de rayon 0,5, haut de 0,25 en tout
    const d = distanceCameraTuile(0.5, 0.125, fov, aspect);
    const t = Math.tan((fov * Math.PI) / 360);
    const largeurVisible = 2 * d * t * aspect;
    // l'arme (diamètre 1 au sol) occupe l'essentiel de la largeur, jamais plus
    expect(1 / largeurVisible).toBeGreaterThan(0.8);
    expect(1 / largeurVisible).toBeLessThanOrEqual(1);
    expect(d).toBeLessThan(distanceCamera(0.5, fov, aspect));
    // une arme haute (pistolet de profil) est limitée par la hauteur
    const haut = distanceCameraTuile(0.3, 0.5, fov, aspect);
    expect(haut).toBeGreaterThan(distanceCameraTuile(0.3, 0.05, fov, aspect));
  });
});

describe("découpage dans le canvas partagé", () => {
  it("rectVisible : intersection avec la zone, null si hors champ ou trop petit", () => {
    const zone = { x: 100, y: 500, w: 400, h: 100 };
    expect(rectVisible({ x: 120, y: 510, w: 90, h: 60 }, zone)).toEqual({ x: 120, y: 510, w: 90, h: 60 });
    expect(rectVisible({ x: 450, y: 510, w: 90, h: 60 }, zone)).toEqual({ x: 450, y: 510, w: 50, h: 60 });
    expect(rectVisible({ x: 600, y: 510, w: 90, h: 60 }, zone)).toBeNull();
    expect(rectVisible({ x: 498, y: 510, w: 90, h: 60 }, zone)).toBeNull(); // 2 px : rien à dessiner
  });

  it("cadrageGl : origine en bas à gauche, viewport de la tuile entière, scissor de la partie visible", () => {
    const canvas = { x: 10, y: 400, w: 800, h: 200 };
    const tuile = { x: 710, y: 450, w: 120, h: 80 };
    const visible = rectVisible(tuile, { x: 10, y: 400, w: 800, h: 200 })!;
    const g = cadrageGl(tuile, visible, canvas);
    expect(g.viewport).toEqual({ x: 700, y: 200 - (50 + 80), w: 120, h: 80 });
    expect(g.scissor).toEqual({ x: 700, y: 70, w: 100, h: 80 });
    expect(aspectTuile(tuile)).toBeCloseTo(1.5);
    expect(aspectTuile({ x: 0, y: 0, w: 5, h: 0 })).toBe(1);
  });
});

describe("modèles 3D de la vitrine", () => {
  it("chaque arme de la barre a une boîte de faces non vide, de taille d'arme (mètres), sans que les arêtes épaisses la gonflent", () => {
    for (const g of groupesBarre(base)) {
      for (const t of g.tuiles) {
        const arme = creerArmeBot(t.id, 0x9be9ff);
        const taille = boiteDesFaces(arme.group).getSize(new THREE.Vector3());
        const longueur = Math.max(taille.x, taille.y, taille.z);
        expect(longueur, t.id).toBeGreaterThan(0.1);
        expect(longueur, t.id).toBeLessThan(1.6);
        arme.dispose();
      }
    }
  });
});

describe("BarreArmes (rendu serveur)", () => {
  const html = renderToStaticMarkup(createElement(BarreArmes, { equipement: { principale: "pompe", secondaire: "revolver", melee: "epee" }, surChoisir: () => {}, aide: "1 2 3 : arme suivante · Échap : menu" }));

  it("une radio native par arme dans trois groupes nommés, la choisie cochée", () => {
    const nb = groupesBarre(base).reduce((n, g) => n + g.tuiles.length, 0);
    expect(html.match(/type="radio"/g)).toHaveLength(nb);
    expect(html.match(/<fieldset/g)).toHaveLength(3);
    expect(html.match(/checked=""/g)).toHaveLength(3);
    expect(html).toContain(">Principale<");
    expect(html).toContain(">Blanche<");
    expect(html).toContain("Armes de la prochaine apparition");
    expect(html).toContain("Échap : menu");
  });

  it("la 3D est décorative : canvas et vitrines masqués aux lecteurs d'écran, le nom de l'arme reste lu", () => {
    expect(html).toContain('<canvas');
    expect(html.match(/aria-hidden="true"/g)!.length).toBeGreaterThanOrEqual(1 + groupesBarre(base).reduce((n, g) => n + g.tuiles.length, 0));
    expect(html).toContain("Fusil à pompe");
  });

  it("emplacement de réglage par arme : rendu sous chaque groupe avec l'arme choisie", () => {
    const vus: string[] = [];
    renderToStaticMarkup(createElement(BarreArmes, {
      equipement: { principale: "sniper", secondaire: "revolver" }, surChoisir: () => {},
      reglageArme: (arme) => { vus.push(arme); return null; },
    }));
    expect(vus).toEqual(["sniper", "revolver", "couteau"]);
  });
});
