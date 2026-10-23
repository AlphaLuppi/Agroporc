import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData } from "../agroparc3d/types";
import { construireMonde } from "./collision";
import { SuiviRadar, type JoueurRadarEntree } from "./jeu-radar";
import type { Vec3 } from "./protocole";
import { SILHOUETTE } from "./protocole";
import { RADAR_DUREES, creerRadarFrame, viderRadarFrame } from "./radar";
import { directionRegard } from "./vue";

const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;

function rect(x0: number, z0: number, x1: number, z1: number, h: number): Building {
  return { h, r: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], c: [(x0 + x1) / 2, (z0 + z1) / 2] };
}
const mondeAvec = (...b: Building[]) => construireMonde({ ...scene, buildings: b, pois: [] });

const OEIL: Vec3 = [0, SILHOUETTE.oeil, 0];
const DEVANT = directionRegard(0, 0);

const joueur = (id: string, p: Vec3, s: Partial<JoueurRadarEntree> = {}): JoueurRadarEntree => ({
  id, p, lacet: 0.3, couleur: "#ff00ff", vivant: true, enVoiture: false, dansMonVehicule: false, ...s,
});

/** Une image du suivi : remet le frame à zéro puis évalue. */
function image(suivi: SuiviRadar, f: ReturnType<typeof creerRadarFrame>, t: number, dt: number, liste: JoueurRadarEntree[], regard = DEVANT) {
  viderRadarFrame(f);
  suivi.maj(f, t, dt, OEIL, regard, liste);
}

describe("SuiviRadar : pas de wallhack", () => {
  it("un joueur en ligne de vue et dans le champ est dessiné, quelle que soit sa distance", () => {
    const suivi = new SuiviRadar(mondeAvec());
    const f = creerRadarFrame();
    image(suivi, f, 1, 0.016, [joueur("a", [0, 0, -300])]);
    expect(f.nJoueurs).toBe(1);
    expect(f.joueurs[0]).toMatchObject({ id: "a", x: 0, z: -300, cap: 0.3, etat: "pied", vu: 1 });
  });

  it("un joueur derrière un bâtiment n'est jamais dessiné", () => {
    const suivi = new SuiviRadar(mondeAvec(rect(-20, -40, 20, -30, 60)));
    const f = creerRadarFrame();
    for (let i = 0; i < 40; i++) image(suivi, f, 1 + i * 0.016, 0.016, [joueur("a", [0, 0, -60])]);
    expect(f.nJoueurs).toBe(0);
  });

  it("un joueur derrière moi (hors du champ) n'est pas dessiné", () => {
    const suivi = new SuiviRadar(mondeAvec());
    const f = creerRadarFrame();
    image(suivi, f, 1, 0.016, [joueur("a", [0, 0, 50])]);
    expect(f.nJoueurs).toBe(0);
  });

  it("`vu` redescend en 0,6 s quand le joueur sort de la vue, puis il disparaît", () => {
    const suivi = new SuiviRadar(mondeAvec());
    const f = creerRadarFrame();
    const a = joueur("a", [0, 0, -30]);
    image(suivi, f, 1, 0.016, [a]);
    expect(f.joueurs[0].vu).toBe(1);
    // je me retourne : plus dans le champ
    const dos = directionRegard(Math.PI, 0);
    image(suivi, f, 1.3, 0.3, [a], dos);
    expect(f.nJoueurs).toBe(1);
    expect(f.joueurs[0].vu).toBeCloseTo(0.5, 6);
    image(suivi, f, 1.6, 0.3, [a], dos);
    expect(f.nJoueurs).toBe(0);
    expect(RADAR_DUREES.fonduVuS).toBe(0.6);
  });

  it("un joueur de mon véhicule est toujours montré, même sans ligne de vue", () => {
    const suivi = new SuiviRadar(mondeAvec(rect(-20, -40, 20, -30, 60)));
    const f = creerRadarFrame();
    image(suivi, f, 1, 0.016, [joueur("a", [0, 0, 80], { dansMonVehicule: true, enVoiture: true })]);
    expect(f.nJoueurs).toBe(1);
    expect(f.joueurs[0]).toMatchObject({ etat: "voiture", vu: 1 });
  });

  it("un joueur en voiture qui n'est pas dans la mienne reste soumis à la ligne de vue", () => {
    const suivi = new SuiviRadar(mondeAvec(rect(-20, -40, 20, -30, 60)));
    const f = creerRadarFrame();
    for (let i = 0; i < 30; i++) image(suivi, f, 1 + i * 0.016, 0.016, [joueur("a", [0, 0, -60], { enVoiture: true })]);
    expect(f.nJoueurs).toBe(0);
  });

  it("un mort vu reste en croix 3 s puis disparaît", () => {
    const suivi = new SuiviRadar(mondeAvec());
    const f = creerRadarFrame();
    const mort = joueur("a", [0, 0, -20], { vivant: false });
    image(suivi, f, 10, 0.016, [mort]);
    expect(f.joueurs[0]).toMatchObject({ etat: "mort", age: 0 });
    image(suivi, f, 12, 0.016, [mort]);
    expect(f.nJoueurs).toBe(1);
    expect(f.joueurs[0].age).toBeCloseTo(2, 6);
    image(suivi, f, 13.1, 0.016, [mort]);
    expect(f.nJoueurs).toBe(0);
  });

  it("un joueur qui disparaît de la liste est oublié (pas de fuite)", () => {
    const suivi = new SuiviRadar(mondeAvec());
    const f = creerRadarFrame();
    image(suivi, f, 1, 0.016, [joueur("a", [0, 0, -20])]);
    expect(suivi.vu("a")).toBe(1);
    image(suivi, f, 1.1, 0.016, []);
    expect(suivi.vu("a")).toBe(0);
  });
});
