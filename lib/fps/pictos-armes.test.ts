import { describe, expect, it } from "vitest";
import { ARMES, ARMES_MELEE, CAUSES_MORT } from "./protocole";
import { STATS } from "./armes";
import { nomPictoFil } from "./hud-modele";
import { ARMES_AVEC_PICTO, CAUSES_AVEC_PICTO, HAUTEUR_PICTO, PICTO_GENERIQUE, PICTO_TETE, pictoArme, pictoCause } from "./pictos-armes";

describe("pictogrammes du fil des éliminations", () => {
  it("chaque arme à feu et chaque arme blanche a son pictogramme (jamais le repli)", () => {
    for (const a of [...ARMES, ...ARMES_MELEE]) {
      const p = pictoArme(a);
      expect(p, a).not.toBe(PICTO_GENERIQUE);
      expect(p.id, a).toBe(a);
      expect(ARMES_AVEC_PICTO).toContain(a);
    }
    expect(ARMES_AVEC_PICTO.length).toBe(ARMES.length + ARMES_MELEE.length);
  });

  it("chaque cause de mort du protocole a un pictogramme, et une cause « arme » renvoie celui de l'arme", () => {
    for (const c of CAUSES_MORT) {
      expect(CAUSES_AVEC_PICTO, c).toContain(c);
      if (c === "arme") expect(pictoCause(c, "sniper")).toBe(pictoArme("sniper"));
      else expect(pictoCause(c, "couteau"), c).not.toBe(pictoArme("couteau"));
    }
  });

  it("une arme ou une cause inconnue (serveur plus récent) retombe sur le réticule générique", () => {
    expect(pictoArme("arme_du_futur")).toBe(PICTO_GENERIQUE);
    expect(pictoCause("cause_du_futur", "arme_du_futur")).toBe(PICTO_GENERIQUE);
  });

  it("le kill d'un tigre (allié ou sauvage) montre la patte, jamais le couteau que le message porte par convention", () => {
    expect(pictoCause("tigre", "couteau").id).toBe("patte");
    expect(pictoCause("grenade", "couteau").id).toBe("grenade");
  });

  it("tracés valides : boîte de 20 de haut, largeur positive, nombres finis, commandes SVG connues, ids uniques", () => {
    const tous = [...ARMES, ...ARMES_MELEE].map(pictoArme).concat(CAUSES_MORT.map((c) => pictoCause(c, "couteau")), [PICTO_TETE, PICTO_GENERIQUE]);
    expect(HAUTEUR_PICTO).toBe(20);
    for (const p of tous) {
      expect(p.largeur, p.id).toBeGreaterThan(4);
      expect(p.chemins.length, p.id).toBeGreaterThan(0);
      for (const d of p.chemins) {
        expect(d, p.id).toMatch(/^M[-\d.]/);
        expect(d, p.id).not.toMatch(/NaN|Infinity|undefined/);
        expect(d.replace(/[MmLlHhVvAaZzCcQq\s\d.,-]/g, ""), p.id).toBe("");
        // aucune coordonnée absolue hors de la boîte (marge d'un demi-point pour les arcs)
        const absolus = d.match(/[MLHV]-?[\d.]+(?:[ ,]-?[\d.]+)?/g) ?? [];
        for (const seg of absolus) for (const x of seg.slice(1).split(/[ ,]/)) expect(Number(x), `${p.id} ${seg}`).toBeGreaterThanOrEqual(-0.5);
      }
    }
    // deux silhouettes distinctes par arme ; la voiture sert deux causes (circulation, véhicule conduit)
    const armes = new Set([...ARMES, ...ARMES_MELEE].map((a) => pictoArme(a).id));
    expect(armes.size).toBe(ARMES.length + ARMES_MELEE.length);
    const causes = new Set(CAUSES_MORT.filter((c) => c !== "arme").map((c) => pictoCause(c, "couteau").id));
    expect(causes.size).toBe(CAUSES_MORT.length - 2);
  });

  it("le nom du pictogramme (aria-label) est le nom complet de l'arme, ou la cause en toutes lettres", () => {
    expect(nomPictoFil("fusil_assaut", "arme", "Lea")).toBe(STATS.fusil_assaut.nom);
    expect(nomPictoFil("epee", "arme", "Lea")).toBe("Épée");
    expect(nomPictoFil("couteau", "police", "")).toBe("Écrasé par la police");
    expect(nomPictoFil("couteau", "tigre", "Lea")).toBe("Tigre");
    expect(nomPictoFil("couteau", "tempete", "")).toBe("Tué par la tempête");
    // avec un tueur, son pseudo est déjà lu avant le pictogramme : pas de répétition
    expect(nomPictoFil("couteau", "ecrase_vehicule", "Lea")).toBe("Renversé");
    expect(nomPictoFil("couteau", "frappe_aerienne", "Lea")).toBe("Frappe aérienne");
    expect(nomPictoFil("couteau", "titan", "Lea")).toBe("Titan tigre");
    expect(nomPictoFil("couteau", "explosion", "Lea")).toBe("Explosion de voiture");
  });
});
