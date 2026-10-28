import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BlocArmes from "../../app/components/arene/hud/BlocArmes";
import Lunette from "../../app/components/arene/hud/Lunette";
import Viseur from "../../app/components/arene/hud/Viseur";

/** (v8, retour 5) Le HUD dit clairement qu'une arme est améliorée : nouveau nom, teinte « gratinée », icône ; viseurs des armes améliorées. */

const refDiv = createRef<HTMLDivElement>();
const refSpan = createRef<HTMLSpanElement>();
const SLOTS = "principale:sniper:8:8|secondaire:pistolet:12:12|couteau:couteau:0:0";

const armes = (p: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(BlocArmes, {
    arme: "pistolet", slot: "secondaire", slots: SLOTS, munitions: 12, chargeur: 12, reserve: 60, recharge: false, degainage: false,
    tireInterdit: false, bonusVitesse: 1, toucheP: "1", toucheS: "2", toucheC: "3", toucheSp: "4", refBarre: refDiv, refTemps: refSpan, ...p,
  } as never));

describe("BlocArmes : arme améliorée au Micro-ondes", () => {
  it("sans amélioration : le nom de base, aucune marque", () => {
    const html = armes();
    expect(html).toContain("Pistolet");
    expect(html).not.toContain("data-ameliore");
    expect(html).not.toContain("Micro-ondes");
  });

  it("arme en main améliorée : son nouveau nom, la marque « gratinée », l'icône et le texte pour les lecteurs d'écran", () => {
    const html = armes({ ameliorees: "pistolet", munitions: 12, chargeur: 12, munitionsG: 6 });
    expect(html).toContain("Moutarde &amp; Sally");
    expect(html).toMatch(/data-ameliore="oui"[^>]*>.*<svg/);
    expect(html).toContain("améliorée au Micro-ondes");
    // rack : le nom court amélioré, la ligne marquée ; l'arme non améliorée garde le sien
    expect(html).toContain("MOUTARDE");
    expect(html).toContain("SNIPER");
    expect(html).not.toContain("EN CROÛTE");
    expect(html.match(/<li[^>]*data-ameliore="oui"/g)).toHaveLength(1);
  });

  it("autre arme améliorée dans le rack seulement : marquée dans le rack, pas dans le nom en main", () => {
    const html = armes({ ameliorees: "sniper" });
    expect(html).toContain("EN CROÛTE");
    expect(html).toMatch(/<p[^>]*>Pistolet<\/p>/);
  });

  it("paire akimbo : chargeur de chaque main", () => {
    const html = armes({ ameliorees: "pistolet", munitions: 9, chargeur: 12, munitionsG: 4 });
    expect(html).toContain("G 4");
    expect(html).toContain("D 5");
    expect(armes({ munitionsG: -1 })).not.toContain("main gauche");
  });
});

describe("viseurs des armes améliorées", () => {
  const viseur = (p: Record<string, unknown> = {}) =>
    renderToStaticMarkup(createElement(Viseur, { protege: false, conduite: false, couteau: false, recharge: false, refAnneau: refDiv, ...p } as never));
  it("point rouge et holographique remplacent les quatre traits ; la mire ordinaire sinon", () => {
    expect(viseur()).not.toContain("data-optique");
    expect(viseur({ optique: "point_rouge" })).toContain('data-optique="point_rouge"');
    expect(viseur({ optique: "holo" })).toContain('data-optique="holo"');
    expect(viseur({ optique: "holo", couteau: true })).not.toContain("data-optique");
  });

  it("lunette thermique : marquée et annoncée", () => {
    const html = renderToStaticMarkup(createElement(Lunette, { zoomX: 3, distanceVisee: 20, thermique: true }));
    expect(html).toContain('data-thermique="oui"');
    expect(html).toContain("THERMIQUE");
    expect(renderToStaticMarkup(createElement(Lunette, { zoomX: 3, distanceVisee: 20 }))).not.toContain("THERMIQUE");
  });
});
