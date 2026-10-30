import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Arene from "../../app/components/arene/Arene";
import ListeParties from "../../app/components/arene/ListeParties";
import LobbyBR from "../../app/components/arene/LobbyBR";
import ReglagesEvenementsArene from "../../app/components/arene/ReglagesArene";
import {
  CHOIX_FREQUENCES, CLE_POLICE_BR, CLE_REGLAGES_ARENE, TEXTE_ARENE_LIMITE, TEXTE_ARENE_PERSO_LIMITE, TEXTE_PARTIES_LIMITE, TEXTE_REGLAGES_IGNORES, aucunEvenement, avecEvenement, avecFrequence,
  ecrirePoliceBr, ecrireReglagesArene, lignePoliceBr, messageChoixMode, lignesParties, lirePoliceBr, lireReglagesArene, reglagesDeMaPartie, reglagesIgnores, resumeCreation, texteRefus,
  tousLesEvenements, type PartieListee,
} from "../../app/components/arene/lobby-modele";
import { PARTIE_AUTO, PARTIE_NOUVELLE, type EtatPartieBr, type JoueurPublic, type ResumePartie } from "./protocole";
import { EVENEMENTS_ARENE, REGLAGES_DEFAUT, type ReglagesArene } from "./reglages-arene";
import { REGLAGES_HUD_DEFAUT } from "./reglages-hud";
import { touchesParDefaut } from "./touches";

/** Interface des réglages d'événements d'une arène et de la descente de police du BR (couche C de `2026-10-30-arene-police-evenements-design.md`). */

/** Faux `localStorage` : un dictionnaire, ou un stockage qui jette. */
const faux = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
};
const casse = { getItem: () => { throw new Error("interdit"); }, setItem: () => { throw new Error("interdit"); } };

const ar = (id: string, joueurs: number, enJeu: number, reglages?: ReglagesArene): ResumePartie => ({ id, mode: "arene", phase: "arene", joueurs, capacite: 16, enJeu, ...(reglages ? { reglages } : {}) });
const sansPolice: ReglagesArene = { evenements: ["elsa", "avion", "bus", "truck", "tigre"], frequence: "calme" };

describe("réglages mémorisés", () => {
  it("rien, JSON illisible, stockage qui jette : les réglages par défaut (tous les événements, Normal)", () => {
    expect(lireReglagesArene(faux())).toEqual(REGLAGES_DEFAUT);
    expect(lireReglagesArene(faux({ [CLE_REGLAGES_ARENE]: "{pas du json" }))).toEqual(REGLAGES_DEFAUT);
    expect(lireReglagesArene(casse)).toEqual(REGLAGES_DEFAUT);
    expect(lireReglagesArene(null)).toEqual(REGLAGES_DEFAUT);
  });

  it("aller-retour, et jamais confiance : une valeur douteuse passe par `normaliserReglages`", () => {
    const s = faux();
    ecrireReglagesArene(s, sansPolice);
    expect(lireReglagesArene(s)).toEqual(sansPolice);
    expect(lireReglagesArene(faux({ [CLE_REGLAGES_ARENE]: JSON.stringify({ evenements: ["truck", "pirate", 3, "truck"], frequence: "enfer" }) })))
      .toEqual({ evenements: ["truck"], frequence: "normal" });
    // « aucun événement » est un choix valide et mémorisé comme tel
    const vide = faux();
    ecrireReglagesArene(vide, aucunEvenement(REGLAGES_DEFAUT));
    expect(lireReglagesArene(vide).evenements).toEqual([]);
    expect(() => ecrireReglagesArene(casse, sansPolice)).not.toThrow();
  });
});

describe("édition des réglages", () => {
  it("cocher / décocher garde l'ordre canonique et ne touche pas la fréquence", () => {
    const r = avecEvenement(avecEvenement(REGLAGES_DEFAUT, "tigre", false), "police", false);
    expect(r.evenements).toEqual(["elsa", "avion", "bus", "truck"]);
    expect(avecEvenement(r, "tigre", true).evenements).toEqual(["elsa", "avion", "bus", "truck", "tigre"]);
    expect(avecEvenement(r, "elsa", true)).toEqual(r);
    expect(avecEvenement({ evenements: [], frequence: "chaos" }, "police", true)).toEqual({ evenements: ["police"], frequence: "chaos" });
  });

  it("« Tout cocher » et « Aucun événement » gardent la fréquence ; la fréquence garde les événements", () => {
    expect(tousLesEvenements({ evenements: [], frequence: "calme" })).toEqual({ evenements: [...EVENEMENTS_ARENE], frequence: "calme" });
    expect(aucunEvenement(sansPolice)).toEqual({ evenements: [], frequence: "calme" });
    expect(avecFrequence(sansPolice, "chaos")).toEqual({ ...sansPolice, frequence: "chaos" });
  });

  it("les trois fréquences s'affichent dans l'ordre Calme / Normal / Chaos, Chaos = rythme d'origine", () => {
    expect(CHOIX_FREQUENCES.map((f) => f.nom)).toEqual(["Calme", "Normal", "Chaos"]);
    expect(CHOIX_FREQUENCES[2].aide).toContain("rythme d'origine");
  });

  it("résumé de création en direct", () => {
    expect(resumeCreation(REGLAGES_DEFAUT)).toBe("Cette arène : Tous les événements · Normal");
    expect(resumeCreation(aucunEvenement(REGLAGES_DEFAUT))).toBe("Cette arène : Aucun événement");
    expect(resumeCreation({ evenements: ["elsa", "avion", "bus", "truck"], frequence: "calme" })).toBe("Cette arène : Sans tigre géant, sans police · Calme");
  });
});

describe("serveur d'avant et réglages de ma partie", () => {
  it("réglages ignorés : demandés non par défaut et écho sans réglages", () => {
    expect(reglagesIgnores(sansPolice, undefined)).toBe(true);
    expect(reglagesIgnores(sansPolice, sansPolice)).toBe(false);
    expect(reglagesIgnores(REGLAGES_DEFAUT, undefined)).toBe(false);
    expect(reglagesIgnores(null, undefined)).toBe(false);
  });

  it("réglages de ma partie : la liste d'abord (1 Hz), l'écho de `mode` tant que la liste ne la connaît pas", () => {
    const liste: PartieListee[] = [ar("ar1", 3, 0, REGLAGES_DEFAUT), ar("ar2", 1, 1, sansPolice)];
    expect(reglagesDeMaPartie(liste, "ar2", null)).toEqual(sansPolice);
    expect(reglagesDeMaPartie(liste, "ar3", sansPolice)).toEqual(sansPolice);
    expect(reglagesDeMaPartie(liste, "ar1", sansPolice)).toEqual(REGLAGES_DEFAUT);
    expect(reglagesDeMaPartie(liste, null, null)).toBeNull();
    // un serveur qui ne publie pas les réglages : rien à dire
    expect(reglagesDeMaPartie([ar("ar1", 3, 0)], "ar1", null)).toBeNull();
    expect(reglagesDeMaPartie(null, "ar1", null)).toBeNull();
  });
});

describe("message `mode`", () => {
  it("les réglages partent pour créer une arène seulement, normalisés ; ailleurs le message reste celui d'avant", () => {
    expect(messageChoixMode("arene", PARTIE_NOUVELLE, sansPolice)).toEqual({ t: "mode", mode: "arene", partie: PARTIE_NOUVELLE, reglages: sansPolice });
    expect(messageChoixMode("arene", PARTIE_NOUVELLE, { evenements: ["tigre", "elsa", "pirate"], frequence: "chaos" } as never).reglages)
      .toEqual({ evenements: ["elsa", "tigre"], frequence: "chaos" });
    expect(messageChoixMode("arene", PARTIE_NOUVELLE)).toEqual({ t: "mode", mode: "arene", partie: PARTIE_NOUVELLE });
    expect(messageChoixMode("arene", "ar2", sansPolice)).toEqual({ t: "mode", mode: "arene", partie: "ar2" });
    expect(messageChoixMode("arene", PARTIE_AUTO, sansPolice)).toEqual({ t: "mode", mode: "arene", partie: PARTIE_AUTO });
    expect(messageChoixMode("zombies", PARTIE_NOUVELLE, sansPolice)).toEqual({ t: "mode", mode: "zombies", partie: PARTIE_NOUVELLE });
    expect(messageChoixMode("br")).toEqual({ t: "mode", mode: "br" });
  });
});

describe("liste des parties : événements actifs", () => {
  it("chaque arène dit ses événements ; sans réglages publiés (ancien serveur), pas de ligne ; les autres modes jamais", () => {
    const l = lignesParties("arene", [ar("ar1", 3, 0, REGLAGES_DEFAUT), ar("ar2", 1, 1, sansPolice), ar("ar3", 0, 0)], "ar1");
    expect(l.map((x) => x.evenements)).toEqual(["Tous les événements · Normal", "Sans police · Calme", undefined]);
    const z = lignesParties("zombies", [{ id: "z1", phase: "lobby", joueurs: 1, mode: "zombies" } as ResumePartie], null);
    expect(z[0].evenements).toBeUndefined();
  });

  it("un réglage douteux du serveur est normalisé avant d'être affiché", () => {
    const douteux = { id: "ar2", mode: "arene", phase: "arene", joueurs: 1, capacite: 16, enJeu: 1, reglages: { evenements: ["pirate"], frequence: 7 } } as unknown as ResumePartie;
    expect(lignesParties("arene", [douteux], null)[0].evenements).toBe("Aucun événement");
  });

  it("ListeParties écrit « Événements : … » sous le nom, et le bouton de création annonce son panneau (`aria-expanded`, `aria-controls`)", () => {
    const lignes = lignesParties("arene", [ar("ar1", 3, 0, REGLAGES_DEFAUT), ar("ar2", 1, 1, sansPolice)], "ar1");
    const html = renderToStaticMarkup(createElement(ListeParties, {
      mode: "arene", lignes, surRejoindre: () => {}, surCreer: () => {}, creationOuverte: false, idCreation: "p1", idTitre: "t",
    }));
    expect(html).toContain("Événements : Tous les événements · Normal");
    expect(html).toContain("Événements : Sans police · Calme");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="p1"');
    expect(html).toContain(">Créer une arène</button>");
    // zombies / BR : bouton ordinaire, aucun attribut de panneau
    const z = renderToStaticMarkup(createElement(ListeParties, { mode: "zombies", lignes: [], surRejoindre: () => {}, surCreer: () => {}, idTitre: "t" }));
    expect(z).not.toContain("aria-expanded");
  });
});

describe("refus de création d'arène", () => {
  it("plafond d'arènes ou création trop rapprochée : texte propre à l'arène ; zombies inchangé", () => {
    expect(texteRefus("mode", "limite", "arene")).toBe(TEXTE_ARENE_LIMITE);
    expect(TEXTE_ARENE_LIMITE).toContain("rejoignez une arène de la liste");
    expect(texteRefus("mode", "limite", "zombies")).toBe(TEXTE_PARTIES_LIMITE);
    // déjà dans une arène personnalisée : le texte désigne la vraie cause (elle occupe la place) et la sortie (revenir à l'arène principale)
    expect(texteRefus("mode", "limite", "arene", true)).toBe(TEXTE_ARENE_PERSO_LIMITE);
    expect(TEXTE_ARENE_PERSO_LIMITE).toContain("arène principale");
    expect(texteRefus("mode", "limite", "zombies", true)).toBe(TEXTE_PARTIES_LIMITE);
    expect(texteRefus("mode", "plein", "arene", true)).not.toBe(TEXTE_ARENE_PERSO_LIMITE);
  });
});

describe("panneau « Créer une arène »", () => {
  const rendre = (plus: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(ReglagesEvenementsArene, { surCreer: () => {}, surAnnuler: () => {}, id: "reg", ...plus } as never));
  const entree = (html: string, e: string) => new RegExp(`<input type="checkbox" name="reg-evenement"[^>]*value="${e}"[^>]*>`).exec(html)?.[0] ?? "";
  const coche = (html: string, e: string) => entree(html, e).includes('checked=""');

  it("une case native par événement, dans l'ordre, cochées par défaut ; fieldset / legend natifs ; libellés français", () => {
    const html = rendre();
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(EVENEMENTS_ARENE.length);
    for (const e of EVENEMENTS_ARENE) expect(coche(html, e)).toBe(true);
    const ordre = EVENEMENTS_ARENE.map((e) => html.indexOf(`value="${e}"`));
    expect([...ordre].sort((a, b) => a - b)).toEqual(ordre);
    expect(html).toContain("<legend>Événements</legend>");
    expect(html).toContain("<legend>Fréquence</legend>");
    expect(html).toContain("Tigre robot géant (et titan)");
    expect(html).toContain("Descente de police");
    expect(html).toContain("Avion et tigres largués (donne le sort d&#x27;invocation)");
    expect(html).toContain("Les événements d&#x27;une arène sont fixés à sa création");
  });

  it("radios natifs de fréquence, celui des réglages de départ coché", () => {
    const html = rendre({ initial: sansPolice });
    expect((html.match(/type="radio"/g) ?? []).length).toBe(3);
    expect(/<input type="radio" name="reg-frequence"[^>]*value="calme"[^>]*>/.exec(html)?.[0]).toContain('checked=""');
    expect(/<input type="radio" name="reg-frequence"[^>]*value="normal"[^>]*>/.exec(html)?.[0]).not.toContain("checked");
    expect(html).toContain("Chaos</b> : rythme d&#x27;origine");
  });

  it("réglages de départ : décochés, boutons « Tout cocher » / « Aucun événement » selon l'état, résumé en `role=status`", () => {
    const html = rendre({ initial: sansPolice });
    expect(coche(html, "police")).toBe(false);
    expect(coche(html, "elsa")).toBe(true);
    expect(html).toContain("Cette arène : Sans police · Calme");
    expect(html).toMatch(/role="status" aria-live="polite">Cette arène/);
    expect(html).toContain("Ce choix est gardé pour la prochaine arène");
    // tout coché : « Tout cocher » grisé ; rien : « Aucun événement » grisé, fréquence grisée avec son explication
    expect(rendre()).toMatch(/disabled=""[^>]*>Tout cocher/);
    expect(rendre()).not.toMatch(/disabled=""[^>]*>Aucun événement/);
    const aucun = rendre({ initial: aucunEvenement(REGLAGES_DEFAUT) });
    expect(aucun).toMatch(/disabled=""[^>]*>Aucun événement/);
    expect(aucun).toContain("<fieldset class=\"");
    expect(aucun).toMatch(/<fieldset[^>]*disabled=""[^>]*aria-describedby="reg-sans"/);
    expect(aucun).toContain("La fréquence ne sert à rien");
    expect(aucun).toContain("Cette arène : Aucun événement");
  });

  it("« Créer cette arène » grisé hors connexion ; « Annuler » toujours là", () => {
    expect(rendre({ desactive: true })).toMatch(/disabled=""[^>]*>Créer cette arène/);
    expect(rendre()).not.toMatch(/disabled=""[^>]*>Créer cette arène/);
    expect(rendre()).toContain(">Annuler</button>");
  });
});

describe("panneau Arène", () => {
  const joueurs: JoueurPublic[] = [{ id: "j1", pseudo: "Lea", couleur: "#fff", enJeu: false, kills: 0, morts: 0, ping: 0 }];
  const rendreA = (plus: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(Arene, {
    etat: "ouvert", monId: "j1", joueurs, match: null, pseudo: "Lea", surPseudo: () => {}, equipement: { principale: "mitraillette", secondaire: "pistolet" },
    surEquipement: () => {}, touches: touchesParDefaut(), reglagesHud: REGLAGES_HUD_DEFAUT, surReglagesHud: () => {}, surEntrer: () => {}, surFermer: () => {},
    erreur: null, tactile: false, ...plus,
  } as never));
  const parties = [ar("ar1", 3, 0, REGLAGES_DEFAUT), ar("ar2", 1, 1, sansPolice)];

  it("l'en-tête dit les événements de MON arène ; rien sans réglages publiés ; le panneau de création reste fermé tant qu'on ne l'ouvre pas", () => {
    const html = rendreA({ parties, partieActuelle: "ar2", reglagesPartie: sansPolice, surCreerPartie: () => {}, surRejoindrePartie: () => {} });
    expect(html).toContain("Événements de cette arène : <b>Sans police · Calme</b>");
    expect(html).not.toContain("fixés à sa création");
    expect(html).toContain('aria-expanded="false"');
    expect(rendreA({ parties, partieActuelle: "ar2", surCreerPartie: () => {} })).not.toContain("Événements de cette arène");
  });

  it("serveur d'avant : message dédié quand les réglages demandés n'ont pas été appliqués", () => {
    expect(rendreA({ reglagesIgnores: true })).toContain(TEXTE_REGLAGES_IGNORES.replaceAll("'", "&#x27;"));
    expect(rendreA()).not.toContain("n&#x27;applique pas encore");
  });

  it("ancien serveur (aucune liste) ou tactile : ni « Créer une arène » ni panneau", () => {
    expect(rendreA({ surCreerPartie: () => {} })).not.toContain("Créer une arène");
    expect(rendreA({ tactile: true, parties, surCreerPartie: () => {} })).not.toContain("Créer une arène");
  });
});

describe("lobby Battle Royale : descente de police", () => {
  const partieBr = (plus: Partial<EtatPartieBr> = {}): EtatPartieBr => ({
    phase: "lobby", capacite: 50, minJoueurs: 2, hote: "j1", joueurs: [
      { id: "j1", pseudo: "Lea", couleur: "#fff", admis: false, vivant: false, aBord: false, kills: 0, place: null },
      { id: "j2", pseudo: "Zoe", couleur: "#eee", admis: false, vivant: false, aBord: false, kills: 0, place: null },
    ],
    vivants: 0, total: 2, ...plus,
  } as unknown as EtatPartieBr);
  const rendreB = (plus: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(LobbyBR, {
    etat: "ouvert", monId: "j1", partie: partieBr(), pseudo: "Lea", surPseudo: () => {}, touches: touchesParDefaut(), reglagesHud: REGLAGES_HUD_DEFAUT, surReglagesHud: () => {},
    surLancer: () => {}, surFermer: () => {}, erreur: null, tactile: false, ...plus,
  } as never));

  it("l'hôte hors partie en cours voit la case, cochée par défaut", () => {
    const html = rendreB();
    expect(html).toContain("Descente de police");
    expect(html).toMatch(/<input type="checkbox" checked=""/);
    expect(html).toContain("fonce sur l&#x27;ennemi le plus proche");
  });

  it("ni un non-hôte (ligne en lecture seule), ni l'hôte en cours de partie, ni le tactile ne voient la case", () => {
    const nonHote = rendreB({ monId: "j2", partie: partieBr({ police: false }) });
    expect(nonHote).not.toContain('type="checkbox"');
    expect(nonHote).toContain("Descente de police : désactivée");
    expect(rendreB({ monId: "j2", partie: partieBr({ police: true }) })).toContain("Descente de police : activée");
    expect(rendreB({ monId: "j2" })).not.toContain("Descente de police");
    expect(rendreB({ partie: partieBr({ phase: "jeu", joueurs: undefined, vivants: 5, total: 9 }) })).not.toContain('type="checkbox"');
    expect(rendreB({ tactile: true })).not.toContain('type="checkbox"');
  });

  it("mémorisation : activée tant que rien n'est écrit ou illisible, `off` la coupe", () => {
    expect(lirePoliceBr(faux())).toBe(true);
    expect(lirePoliceBr(casse)).toBe(true);
    expect(lirePoliceBr(null)).toBe(true);
    const s = faux();
    ecrirePoliceBr(s, false);
    expect(s.m.get(CLE_POLICE_BR)).toBe("off");
    expect(lirePoliceBr(s)).toBe(false);
    ecrirePoliceBr(s, true);
    expect(lirePoliceBr(s)).toBe(true);
    expect(() => ecrirePoliceBr(casse, false)).not.toThrow();
  });

  it("ligne en lecture seule : vide quand le serveur ne publie pas le réglage", () => {
    expect(lignePoliceBr(undefined)).toBeNull();
    expect(lignePoliceBr(true)).toBe("Descente de police : activée");
    expect(lignePoliceBr(false)).toBe("Descente de police : désactivée");
  });
});
