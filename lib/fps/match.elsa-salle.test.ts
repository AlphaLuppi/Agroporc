import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Building, SceneData, Vec2 } from "../agroparc3d/types";
import { construireMonde } from "./collision";
import { Salle } from "./match";
import type { JoueurSalle, Sortie } from "./match-contexte";
import type { MessageServeur } from "./protocole";

/** Salle RÉELLE avec le vrai service Elsa (match.v2.test.ts le remplace par un faux) : le slot de retour d'une spéciale épuisée. */
const scene = JSON.parse(readFileSync("public/agroparc/scene.json", "utf8")) as SceneData;
const bat: Building = { h: 12, r: [[0, 0], [10, 0], [10, 10], [0, 10]], c: [5, 5] };
const monde = construireMonde({ ...scene, buildings: [bat], pois: [] } as SceneData);
const POINTS: Vec2[] = [[-15, -15], [28, 28], [-15, 28], [28, -15]];
const T0 = 1_000_000;

const j = (s: Salle, id: string) => s.inspecter(id) as JoueurSalle;
function messages<T extends MessageServeur["t"]>(sorties: Sortie[], t: T): Extract<MessageServeur, { t: T }>[] {
  return sorties.filter((x) => x.m.t === t).map((x) => x.m as Extract<MessageServeur, { t: T }>);
}

/** Un joueur qui tient `main` à l'apparition, Elsa à (−5, −5) avec une offre d'ARME dès T0 + 1 s ; renvoie la salle après le ramassage. */
function apresRamassage(main: "principale" | "secondaire") {
  const s = new Salle(monde, POINTS, () => 0.9, T0, { elsa: { x: -5, z: -5, intervalle: { minMs: 1000, maxMs: 1000 } } });
  s.connecter("a", "Alice", T0);
  s.recevoir("a", { t: "rejoindre", principale: "pompe", secondaire: "pistolet" }, T0);
  if (main === "secondaire") s.recevoir("a", { t: "main", slot: "secondaire" }, T0 + 10);
  expect(j(s, "a").main).toBe(main);
  j(s, "a").p = [-5, 0, -5];
  j(s, "a").etatT = T0 + 1000; // pas d'éviction pour inactivité
  const sorties = s.tic(T0 + 1000);
  expect(messages(sorties, "ramassage")).toHaveLength(1);
  expect(j(s, "a").main).toBe("speciale");
  return s;
}

describe("spéciale d'Elsa épuisée : retour sur le slot tenu avant l'offre", () => {
  it("principale en main au ramassage (précédent d'apparition = secondaire) : le serveur retombe sur la principale, comme le client", () => {
    const s = apresRamassage("principale");
    j(s, "a").munSpeciale = 2;
    expect(s["consommerSpeciale"](j(s, "a"), T0 + 4000)).toEqual([]); // il reste une munition : rien ne change
    const fin = s["consommerSpeciale"](j(s, "a"), T0 + 5000);
    expect(messages(fin, "equipement")[0]).toMatchObject({ main: "principale", munSpeciale: 0 });
    expect(j(s, "a")).toMatchObject({ main: "principale" });
  });

  it("secondaire en main au ramassage : retour sur la secondaire", () => {
    const s = apresRamassage("secondaire");
    j(s, "a").munSpeciale = 1;
    const fin = s["consommerSpeciale"](j(s, "a"), T0 + 5000);
    expect(messages(fin, "equipement")[0]).toMatchObject({ main: "secondaire" });
  });
});
