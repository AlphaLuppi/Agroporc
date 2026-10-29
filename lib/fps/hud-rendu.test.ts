import { describe, expect, it } from "vitest";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BarreMatch from "../../app/components/arene/hud/BarreMatch";
import BlocArmes from "../../app/components/arene/hud/BlocArmes";
import BlocVehicule from "../../app/components/arene/hud/BlocVehicule";
import BlocVie from "../../app/components/arene/hud/BlocVie";
import Chargeur from "../../app/components/arene/hud/Chargeur";
import CoinHud, { contenuCoin } from "../../app/components/arene/hud/CoinHud";
import FilEliminations from "../../app/components/arene/hud/FilEliminations";
import InvitesAction from "../../app/components/arene/hud/InvitesAction";
import Lunette from "../../app/components/arene/hud/Lunette";
import RetoursTouche, { texteChiffre } from "../../app/components/arene/hud/RetoursTouche";
import Viseur from "../../app/components/arene/hud/Viseur";
import ZoneVive from "../../app/components/arene/hud/ZoneVive";
import Killcam from "../../app/components/arene/Killcam";
import { commandes, toucheDe } from "../../app/components/arene/hud/AideCommandes";
import BarreBR from "../../app/components/arene/hud/BarreBR";
import BlocInventaire from "../../app/components/arene/hud/BlocInventaire";
import BlocVol from "../../app/components/arene/hud/BlocVol";
import BlocZone from "../../app/components/arene/hud/BlocZone";
import EcranMort from "../../app/components/arene/hud/EcranMort";
import EcranSpectateur, { CarteEliminationBr } from "../../app/components/arene/hud/EcranSpectateur";
import FinDePartieBR, { TableauPartieBr } from "../../app/components/arene/hud/FinDePartieBR";
import MenuPause from "../../app/components/arene/hud/MenuPause";
import TableauStatsBr from "../../app/components/arene/hud/TableauStatsBr";
import HudArene from "../../app/components/arene/HudArene";
import { libelleCause } from "../../app/components/arene/armesInfo";
import { touchesParDefaut } from "./touches";
import {
  NBSP, annoncesBr, formatChrono, libelleDistanceBord, libelleEnVie, libelleFil, libellePlaceBr, libelleZoneBr, memeEtatBrHud, texteHorsZone,
} from "./hud-modele";
import { formatSurvie, lignesBilanBR, lignesPalmaresBr, resumeFinBr } from "./classement";
import type { EtatBrHud, HudEtat, HudLive } from "./jeu-types";
import type { BilanBr, EtatPartieBr, LigneStatsBr, ZoneBr } from "./protocole";
import { REGLAGES_HUD_DEFAUT, type CoinMinimap } from "./reglages-hud";

const SLOTS = "principale:fusil_assaut:23:30|secondaire:pistolet:12:12|couteau:couteau:0:0|speciale:railgun:4:6";
const refDiv = createRef<HTMLDivElement>();
const refSpan = createRef<HTMLSpanElement>();

const armes = (p: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(BlocArmes, {
    arme: "fusil_assaut", slot: "principale", slots: SLOTS, munitions: 23, chargeur: 30, reserve: -1, recharge: false, degainage: false,
    tireInterdit: false, bonusVitesse: 1, toucheP: "1", toucheS: "2", toucheC: "3", toucheSp: "4", refBarre: refDiv, refTemps: refSpan, ...p,
  } as never));

const vie = (p: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(BlocVie, {
    pv: 87, bouclier: 62, regen: false, accroupi: false, glisse: false, mur: false, protegeRestant: 0, rupture: false, refTraitRegen: refDiv, ...p,
  } as never));

describe("BlocArmes", () => {
  it("rack : slot actif en aria-current, noms courts complets, spéciale étiquetée", () => {
    const html = armes();
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="true"[^>]*>.*FUSIL/);
    for (const nom of ["FUSIL", "PISTOLET", "COUTEAU", "RAILGUN"]) expect(html).toContain(nom);
    expect(html).toContain("SPÉCIALE");
    expect(html).toContain("23/30");
    expect(html).toContain("12/12");
    expect(html).toContain("[1]");
    expect(html).toContain("[4]");
  });

  it("réserve infinie : « RÉSERVE ∞ » avec aria-label réserve illimitée", () => {
    const html = armes();
    expect(html).toContain("RÉSERVE ∞");
    expect(html).toContain('aria-label="réserve illimitée"');
  });

  it("arme spéciale d'Elsa (sans rechargement) : « SANS RECHARGE », jamais « RÉSERVE ∞ » (régression)", () => {
    const html = armes({ arme: "railgun", slot: "speciale", munitions: 4, chargeur: 6, reserve: 0 });
    expect(html).toContain("SANS RECHARGE");
    expect(html).not.toContain("RÉSERVE ∞");
    expect(html).not.toContain("réserve illimitée");
  });

  it("réserve finie, ou absente : le slot spécial n'est pas listé", () => {
    expect(armes({ reserve: 90 })).toContain("RÉSERVE 90");
    const sans = armes({ slots: "principale:fusil_assaut:23:30|secondaire:pistolet:12:12|couteau:couteau:0:0" });
    expect(sans).not.toContain("RAILGUN");
  });

  it("le nom court d'une arme longue n'est jamais tronqué", () => {
    const html = armes({ arme: "mitrailleuse", slots: "principale:mitrailleuse:60:60|secondaire:pistolet:12:12|couteau:couteau:0:0", munitions: 60, chargeur: 60 });
    expect(html).toContain("M. LOURDE");
  });

  it("conducteur : bloc indisponible avec la ligne « TIR IMPOSSIBLE »", () => {
    const html = armes({ tireInterdit: true });
    expect(html).toContain('data-indisponible="oui"');
    expect(html).toContain("TIR IMPOSSIBLE");
    expect(armes()).not.toContain("TIR IMPOSSIBLE");
  });

  it("dégainage : seul le slot actif se remplit", () => {
    const html = armes({ degainage: true });
    expect(html.match(/data-degainage="oui"/g)).toHaveLength(1);
  });

  it("couteau en main : pas de chiffres, puce « VITESSE +30 % »", () => {
    const html = armes({ arme: "couteau", slot: "couteau", munitions: 0, chargeur: 0, bonusVitesse: 1.3 });
    expect(html).toContain("VITESSE +30 %");
    expect(html).not.toContain("RÉSERVE");
  });
});

describe("BlocArmes : épée", () => {
  const SLOTS_EPEE = "principale:fusil_assaut:23:30|secondaire:pistolet:12:12|couteau:epee:0:0";

  it("le slot 3 porte le nom de l'épée et sa vitesse de course (+20 %)", () => {
    const html = armes({ slots: SLOTS_EPEE });
    expect(html).toContain("ÉPÉE");
    expect(html).not.toContain("COUTEAU");
    expect(html).toContain("VITESSE +20 %");
    expect(html).toContain("(Arme blanche)");
  });

  it("épée en main : nom de l'arme, puce de vitesse, pas de chiffres", () => {
    const html = armes({ arme: "epee", slot: "couteau", slots: SLOTS_EPEE, munitions: 0, chargeur: 0, bonusVitesse: 1.2 });
    expect(html).toContain("Épée");
    expect(html).toContain("VITESSE +20 %");
    expect(html).not.toContain("RÉSERVE");
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
  });
});

describe("Chargeur", () => {
  const rendre = (p: Record<string, unknown>) =>
    renderToStaticMarkup(createElement(Chargeur, { munitions: 23, chargeur: 30, reserve: -1, recharge: false, rechargeS: 2.2, couteau: false, bonusVitesse: 1, refBarre: refDiv, refTemps: refSpan, ...p } as never));

  it("niveaux : normal, bas (≤ 25 %), critique (≤ 10 %), vide", () => {
    expect(rendre({})).toContain('data-niveau="normal"');
    expect(rendre({ munitions: 7 })).toContain('data-niveau="bas"');
    expect(rendre({ munitions: 3 })).toContain('data-niveau="critique"');
    const vide = rendre({ munitions: 0 });
    expect(vide).toContain('data-niveau="vide"');
    expect(vide).toContain("VIDE");
  });

  it("un cran de pip par balle jusqu'à 30, pleins puis vides", () => {
    const html = rendre({ munitions: 23 });
    expect(html.match(/<i class="pipPlein"/g) ?? html.match(/pipPlein/g)).toHaveLength(23);
    expect(html.match(/pipVide/g)).toHaveLength(7);
  });

  it("rechargement : barre de progression à la place des pips, avec libellé et durée", () => {
    const html = rendre({ recharge: true });
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("RECHARGEMENT");
    expect(html).toContain('data-duree="2.2"');
    expect(html).not.toContain("pipPlein");
  });
});

describe("BlocVie", () => {
  it("écrit « BOUCLIER 62 » et les PV", () => {
    const html = vie();
    expect(html).toContain("BOUCLIER 62");
    expect(html).toContain(">87<");
    expect(html).not.toContain("PV BAS");
  });

  it("« PV BAS » à 30 PV ou moins, niveau selon les seuils", () => {
    expect(vie({ pv: 30 })).toContain("PV BAS");
    expect(vie({ pv: 31 })).not.toContain("PV BAS");
    expect(vie({ pv: 25 })).toContain('data-niveau="bas"');
    expect(vie({ pv: 40 })).toContain('data-niveau="moyen"');
    expect(vie({ pv: 90 })).toContain('data-niveau="normal"');
  });

  it("la ligne du bouclier disparaît à 0, sauf pendant le flash de rupture", () => {
    expect(vie({ bouclier: 0 })).not.toContain("BOUCLIER");
    expect(vie({ bouclier: 0, rupture: true })).toContain("BOUCLIER 0");
  });

  it("régénération écrite, puces d'état dans l'ordre", () => {
    expect(vie({ pv: 80, regen: true })).toContain("RÉGÉNÉRATION +20/s");
    expect(vie({ pv: 100, regen: true })).not.toContain("RÉGÉNÉRATION");
    const html = vie({ accroupi: true, glisse: true, mur: true, protegeRestant: 2.5 });
    const ordre = ["ACCROUPI", "GLISSE", "WALL-RUN", `PROTÉGÉ 2,5${NBSP}s`].map((x) => html.indexOf(x));
    expect(ordre.every((i) => i >= 0)).toBe(true);
    expect([...ordre].sort((a, b) => a - b)).toEqual(ordre);
    expect(vie()).not.toContain("ACCROUPI");
  });
});

describe("CoinHud : ordre d'empilement pour les cinq positions", () => {
  const rendre = (coin: "hg" | "hd" | "bg" | "bd", coinMinimap: CoinMinimap) =>
    renderToStaticMarkup(createElement(CoinHud, { coin, coinMinimap, miniMap: createElement("i", { id: "carte" }), children: createElement("b", { id: "bloc" }) }));

  it("la mini-map passe avant le bloc du coin, dans son coin seulement", () => {
    for (const coin of ["hg", "hd", "bg", "bd"] as const) {
      const html = rendre(coin, coin);
      expect(html.indexOf('id="carte"')).toBeGreaterThanOrEqual(0);
      expect(html.indexOf('id="carte"')).toBeLessThan(html.indexOf('id="bloc"'));
      for (const autre of (["hg", "hd", "bg", "bd"] as const).filter((c) => c !== coin)) {
        expect(rendre(autre, coin)).not.toContain('id="carte"');
      }
    }
  });

  it("masquée : jamais de mini-map, mais le bloc vital reste à sa place", () => {
    for (const coin of ["hd", "bg", "bd"] as const) {
      const html = rendre(coin, "off");
      expect(html).not.toContain('id="carte"');
      expect(html).toContain('id="bloc"');
    }
  });

  it("un coin sans carte ni bloc est vide (hg sans mini-map)", () => {
    expect(renderToStaticMarkup(createElement(CoinHud, { coin: "hg", coinMinimap: "bd", miniMap: createElement("i") }))).toBe("");
    expect(contenuCoin({ coin: "hg", coinMinimap: "hg", miniMap: null })).toEqual([]);
  });

  it("chaque coin a son attribut", () => {
    expect(rendre("bg", "off")).toContain('data-coin="bg"');
  });
});

describe("BarreMatch", () => {
  const base = {
    rang: 3, exAequo: false, mesKills: 12, serie: 0, leaderPseudo: "Lea", leaderCouleur: "#aabbcc", leaderKills: 18, jeMene: false, egalite: false, ecart: 6,
    pointDeMatch: false, objectif: 30, progressionLeader: 0.6, maProgression: 0.4, fin: null, maintenantServeur: () => 0,
  };
  const rendre = (p: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(BarreMatch, { ...base, ...p } as never));

  it("rang, kills, leader, objectif", () => {
    const html = rendre();
    expect(html).toContain("3e");
    expect(html).toContain(`12${NBSP}K`);
    expect(html).toContain("Lea");
    expect(html).toContain(`PREMIER À 30${NBSP}K`);
    expect(html).toContain("—:——");
  });

  it("« POINT DE MATCH », « TU MÈNES », égalité, série", () => {
    expect(rendre({ pointDeMatch: true })).toContain("POINT DE MATCH");
    expect(rendre({ jeMene: true, ecart: 3 })).toContain("TU MÈNES +3");
    expect(rendre({ egalite: true })).toContain("ÉGALITÉ EN TÊTE");
    expect(rendre({ serie: 3 })).toContain("SÉRIE ×3");
    expect(rendre({ serie: 2 })).not.toContain("SÉRIE");
  });

  it("minuterie : libellé écrit sous 60 s et sous 10 s (jamais la couleur seule)", () => {
    const horloge = () => 0;
    expect(rendre({ fin: 120_000, maintenantServeur: horloge })).not.toContain("DERNIÈRE");
    expect(rendre({ fin: 45_000, maintenantServeur: horloge })).toContain("DERNIÈRE MINUTE");
    const critique = rendre({ fin: 9_000, maintenantServeur: horloge });
    expect(critique).toContain("DERNIÈRES SECONDES");
    expect(critique).toContain('data-etat="critique"');
    expect(critique).toContain("0:09");
  });

  it("hors classement : tiret", () => {
    expect(rendre({ rang: 0 })).toContain("Pas classé");
  });
});

describe("FilEliminations", () => {
  const e = (p: Record<string, unknown>) => ({ id: 1, par: "Lea", parCouleur: "#112233", cible: "Max", cibleCouleur: "#445566", arme: "fusil_assaut", cause: "arme", tete: false, moi: false, ...p });
  const rendre = (fil: unknown[], annonces: unknown[] = []) => renderToStaticMarkup(createElement(FilEliminations, { fil, annonces } as never));

  it("rien à afficher : rien", () => {
    expect(rendre([])).toBe("");
  });

  it("ligne d'arme : pseudos en texte, arme en nom court, tête marquée en texte", () => {
    const html = rendre([e({ tete: true })]);
    expect(html).toContain("<b>Lea</b>");
    expect(html).toContain("<b>Max</b>");
    expect(html).toContain("Fusil");
    expect(html).toContain("◎");
    expect(html).toContain('aria-label="tir à la tête"');
    expect(html).toContain('aria-live="off"');
  });

  it("la couleur du serveur n'est jamais appliquée au texte (pastille seulement)", () => {
    const html = rendre([e({})]);
    expect(html).not.toMatch(/<b[^>]*style=/);
    expect(html).toContain("background:#112233");
  });

  it("mort par circulation ou voiture : cause en toutes lettres", () => {
    const pnj = rendre([e({ cause: "ecrase_pnj", par: "", arme: "couteau" })]);
    expect(pnj).toContain("Écrasé par la circulation");
    expect(pnj).toContain("<b>Max</b>");
    const voiture = rendre([e({ cause: "ecrase_vehicule" })]);
    expect(voiture).toContain("Renversé par Lea");
  });

  it("mes lignes sont marquées ; annonces et éliminations par ordre d'arrivée", () => {
    const html = rendre([e({ id: 5, moi: true }), e({ id: 2, cible: "Zoe" })], [{ id: 3, texte: "Elsa : soin complet", genre: "elsa" }]);
    expect(html).toContain("filMoi");
    expect(html.indexOf("Zoe")).toBeLessThan(html.indexOf("Elsa : soin complet"));
    expect(html.indexOf("Elsa : soin complet")).toBeLessThan(html.indexOf("filMoi"));
  });
});

describe("Viseur, Lunette, RetoursTouche", () => {
  it("viseur statique : quatre traits et un point, cyan protégé, anneau seulement en rechargement", () => {
    const rendre = (p: Record<string, unknown>) => renderToStaticMarkup(createElement(Viseur, { protege: false, conduite: false, couteau: false, recharge: false, refAnneau: refDiv, ...p } as never));
    const html = rendre({});
    expect(html).toContain('aria-hidden="true"');
    expect(html.match(/<i /g)).toHaveLength(5);
    expect(html).not.toContain("anneau");
    expect(rendre({ recharge: true })).toContain("anneau");
    expect(rendre({ protege: true })).toContain("viseurProtege");
    expect(html).not.toContain("--ecart");
  });

  it("conducteur : ( + ) et libellé écrit ; couteau : chevron", () => {
    const rendre = (p: Record<string, unknown>) => renderToStaticMarkup(createElement(Viseur, { protege: false, conduite: false, couteau: false, recharge: false, refAnneau: refDiv, ...p } as never));
    const c = rendre({ conduite: true });
    expect(c).toContain("( + )");
    expect(c).toContain("CONDUITE : TIR IMPOSSIBLE");
    expect(rendre({ couteau: true })).toContain("chevronPortee");
  });

  it("lunette : zoom et distance seulement si connus", () => {
    const rendre = (p: Record<string, unknown>) => renderToStaticMarkup(createElement(Lunette, p as never));
    const html = rendre({ zoomX: 4, distanceVisee: 112 });
    expect(html).toContain("×4");
    expect(html).toContain(`112${NBSP}m`);
    const sans = rendre({ zoomX: 4, distanceVisee: -1 });
    expect(sans).toContain("×4");
    expect(sans).not.toContain(" m<");
  });

  it("chiffres de dégâts : trois codages sans la couleur seule", () => {
    expect(texteChiffre({ degats: 34, tete: false, bouclier: false })).toBe("−34");
    expect(texteChiffre({ degats: 34, tete: false, bouclier: true })).toBe("[34]");
    expect(texteChiffre({ degats: 34, tete: true, bouclier: false })).toBe("◎ −34");
    expect(texteChiffre({ degats: 34, tete: true, bouclier: true })).toBe("◎ [34]");
  });

  it("retours de touche : décoratifs, marqueur et X de kill relancés par leur id", () => {
    const html = renderToStaticMarkup(createElement(RetoursTouche, {
      chiffres: [{ id: 1, cible: "a", degats: 34, absorbe: 34, tete: false, bouclier: true, tue: false, debut: 0, dernier: 0, nb: 1 }],
      marqueur: { id: 1, tete: true }, kill: 4,
    }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("[34]");
    expect(html).toContain("chiffreBouclier");
    expect(html).toContain("marqueurTete");
    expect(html).toContain("+1");
    const vide = renderToStaticMarkup(createElement(RetoursTouche, { chiffres: [], marqueur: null, kill: null }));
    expect(vide).not.toContain("marqueur");
    expect(vide).not.toContain("killX");
  });
});

describe("InvitesAction", () => {
  const rendre = (p: Record<string, unknown>) => renderToStaticMarkup(createElement(InvitesAction, { invite: "", inviteDetail: "", toucheInteragir: "E", inviteRecharge: false, toucheRecharger: "R", ...p } as never));

  it("Elsa : sans touche (cadeau automatique) avec la distance", () => {
    const html = rendre({ invite: "elsa", inviteDetail: `12${NBSP}m` });
    expect(html).toContain(`Avance vers Elsa (12${NBSP}m)`);
    expect(html).not.toContain("<kbd>");
  });

  it("monter / descendre avec la touche réellement assignée, ou « touche non assignée »", () => {
    expect(rendre({ invite: "monter", inviteDetail: "2/4" })).toMatch(/<kbd>E<\/kbd> Monter \(2\/4\)/);
    expect(rendre({ invite: "descendre" })).toMatch(/<kbd>E<\/kbd> Descendre/);
    expect(rendre({ invite: "monter", inviteDetail: "2/4", toucheInteragir: "" })).toContain("touche non assignée");
  });

  it("recharger quand le chargeur est critique, sinon rien", () => {
    expect(rendre({ inviteRecharge: true })).toContain("RECHARGER");
    expect(rendre({})).toBe("");
    expect(rendre({ invite: "monter", inviteDetail: "1/4", inviteRecharge: true })).not.toContain("RECHARGER");
  });
});

describe("BlocVehicule", () => {
  const joueurs = [
    { id: "a", pseudo: "Lea", couleur: "#111111", enJeu: true, kills: 0, morts: 0, ping: 30 },
    { id: "b", pseudo: "Zoe", couleur: "#222222", enJeu: true, kills: 0, morts: 0, ping: 30 },
  ];
  const rendre = (p: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(BlocVehicule, {
    siege: 0, vehiculeId: 2, sieges: [{ id: 2, sieges: ["a", "b", null, null] }], joueurs, monId: "a", toucheInteragir: "E", toucheSiege: "F", refKmh: createRef(), ...p,
  } as never));

  it("rôle écrit, quatre places, mon siège marqué « (vous) », places libres", () => {
    const html = rendre();
    expect(html).toContain("CONDUCTEUR");
    expect(html).toContain("place 1/4");
    expect(html).toContain("VOUS");
    expect(html).toContain("(vous)");
    expect(html).toContain("<b>Zoe</b>");
    expect(html.match(/libre/g)).toHaveLength(2);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain("km/h");
  });

  it("passager et rappel des touches assignées", () => {
    const html = rendre({ siege: 1, monId: "b" });
    expect(html).toContain("PASSAGER");
    expect(html).toContain("<kbd>F</kbd> place");
    expect(html).toContain("<kbd>E</kbd> descendre");
    expect(rendre({ toucheSiege: "", toucheInteragir: "" })).not.toContain("<kbd>");
  });
});

describe("ZoneVive", () => {
  it("polie par défaut, assertive seulement pour un message critique", () => {
    const poli = renderToStaticMarkup(createElement(ZoneVive, { message: { id: 1, texte: "Bouclier 100", priorite: 2 } }));
    expect(poli).toMatch(/aria-live="polite"[^>]*>Bouclier 100</);
    expect(poli).toMatch(/aria-live="assertive"[^>]*><\/p>/);
    const critique = renderToStaticMarkup(createElement(ZoneVive, { message: { id: 2, texte: "PV critiques", priorite: 5, assertif: true } }));
    expect(critique).toMatch(/aria-live="assertive"[^>]*>PV critiques</);
    expect(critique).toMatch(/aria-live="polite"[^>]*><\/p>/);
  });
});

describe("Killcam", () => {
  const tueur = { id: "t", pseudo: "Lea", couleur: "#abcdef", p: [0, 0, 0] as [number, number, number], lacet: 0, tangage: 0, arme: "fusil_assaut" as const, pv: 54, bouclier: 25, distance: 47.2 };
  const rendre = (p: Record<string, unknown>) => renderToStaticMarkup(createElement(Killcam, { phase: "rejeu", progression: 0.3, tueur, derniereMort: null, surPasser: () => {}, ...p } as never));

  it("la pastille du bouton Passer suit la touche de l'action `passer` (remappable)", () => {
    expect(rendre({ touchePasser: "P" })).toMatch(/<button[^>]*>Passer <kbd>P<\/kbd><\/button>/);
    expect(rendre({ touchePasser: "" })).not.toContain("<kbd>");
  });

  it("rejeu : légende, bouton Passer (Espace), barre de progression, titre Éliminé en status", () => {
    const html = rendre({ reapparitionDans: 3.1 });
    expect(html).toContain("Rejeu");
    expect(html).toContain("vue de");
    expect(html).toContain("<b>Lea</b>");
    expect(html).toContain(`Fusil d&#x27;assaut · 47${NBSP}m`);
    expect(html).toMatch(/<button[^>]*>Passer <kbd>Espace<\/kbd><\/button>/);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="30"');
    expect(html).toMatch(/role="status"[^>]*>Éliminé</);
    expect(html).toContain(`réapparition dans 3,1${NBSP}s`);
  });

  it("tueur inconnu : « Agent » sans pastille", () => {
    const html = rendre({ tueur: null });
    expect(html).toContain("<b>Agent</b>");
    expect(html).not.toContain("pastille");
  });

  it("carte : bandes et progression, sans légende, bouton ni role=status ; les enfants sont posés entre les bandes", () => {
    const html = rendre({ phase: "carte", children: createElement("i", { id: "enfant" }) });
    expect(html).not.toContain("Rejeu");
    expect(html).not.toContain("Passer");
    expect(html).not.toContain('role="status"');
    expect(html).toContain('role="progressbar"');
    expect(html.indexOf("bandeHaut")).toBeLessThan(html.indexOf('id="enfant"'));
    expect(html.indexOf('id="enfant"')).toBeLessThan(html.indexOf("bandeBas"));
  });
});

describe("aide des commandes", () => {
  it("lit les touches réelles du joueur et ignore les actions sans touche", () => {
    const cfg = touchesParDefaut();
    cfg.recharger = [null, null];
    const c = commandes(cfg, null);
    expect(c.find(([, v]) => v === "Recharger")?.[0]).toBe("");
    expect(c.find(([, v]) => v === "Tirer (maintenir : rafale)")?.[0]).toBe("Clic gauche");
    expect(toucheDe(cfg, "recharger")).toBe("");
    expect(toucheDe(cfg, "avant")).toBe("W");
    expect(c.length).toBeGreaterThanOrEqual(11);
  });
});


// ---------- Battle Royale (v8) : HUD ----------

const zone = (plus: Partial<ZoneBr> = {}): ZoneBr => ({
  palier: 2, nbPaliers: 6, phase: "attente", t0: 100_000, t1: 142_000, t2: 187_000, c0: [0, 0], r0: 250, c1: [10, 10], r1: 150, degats: 4, ...plus,
});
const partie = (plus: Partial<EtatPartieBr> = {}): EtatPartieBr => ({
  phase: "jeu", hote: "j1", capacite: 50, minJoueurs: 2, debutT: 0, finT: 0, avion: null, zone: zone(), vivants: 37, total: 50, ...plus,
});
const ebr = (plus: Partial<EtatBrHud> = {}): EtatBrHud => ({
  partie: partie(), avion: null, zone: zone(), phaseVol: "sol", serveurT: 110_000, distanceBord: -85, capCentre: 0, bandage: 3, potion: 1, usage: null, proches: [], suivi: null, place: null, ...plus,
});
const bilan = (): BilanBr => ({
  vainqueurs: ["j1"], dureeMs: 605_000,
  lignes: [
    { id: "j3", pseudo: "Zoé", couleur: "#112233", place: 3, kills: 0, degats: 40, survieS: 180 },
    { id: "j1", pseudo: "Lea", couleur: "#aabbcc", place: 1, kills: 4, degats: 612, survieS: 605 },
    { id: "j2", pseudo: "Marc", couleur: "#ccbbaa", place: 2, kills: 2, degats: 300, survieS: 400 },
  ],
});
const finPartie = (plus: Partial<EtatPartieBr> = {}): EtatPartieBr => partie({ phase: "fin", vivants: 1, total: 3, zone: null, bilan: bilan(), finT: 130_000, ...plus });

describe("modèle du HUD Battle Royale", () => {
  it("chrono « m:ss » arrondi au-dessus, jamais négatif", () => {
    expect(formatChrono(42_000)).toBe("0:42");
    expect(formatChrono(41_100)).toBe("0:42");
    expect(formatChrono(125_000)).toBe("2:05");
    expect(formatChrono(-500)).toBe("0:00");
  });

  it("libellé de la zone : attente, rétrécissement, fermée", () => {
    expect(libelleZoneBr(zone(), 100_000)).toEqual({ titre: "LA ZONE SE FERME DANS", chrono: "0:42", palier: "PALIER 2/6", phase: "attente" });
    expect(libelleZoneBr(zone({ phase: "retrecit" }), 150_000)).toMatchObject({ titre: "RÉTRÉCISSEMENT", chrono: "0:37" });
    expect(libelleZoneBr(zone({ phase: "fermee", palier: 6 }), 190_000)).toMatchObject({ titre: "ZONE FERMÉE", chrono: "", palier: "PALIER 6/6" });
  });

  it("hors zone en toutes lettres avec un vrai moins ; distance au bord", () => {
    expect(texteHorsZone(4)).toBe(`HORS ZONE : \u22124${NBSP}PV/s`);
    expect(texteHorsZone(1.5)).toContain("\u22121,5");
    expect(libelleDistanceBord(120.4)).toBe(`120${NBSP}m hors de la zone`);
    expect(libelleDistanceBord(-85)).toBe(`Bord de la zone à 85${NBSP}m`);
    expect(libelleDistanceBord(0.2)).toBe("Sur le bord de la zone");
  });

  it("en vie et place à l'écran de mort", () => {
    expect(libelleEnVie(37)).toBe(`37${NBSP}EN${NBSP}VIE`);
    expect(libelleEnVie(1)).toBe(`1${NBSP}EN${NBSP}VIE`);
    expect(libellePlaceBr(12, 37)).toBe("Éliminé · place #12 sur 37");
    expect(libellePlaceBr(null, 37)).toBe("Éliminé");
  });

  it("fil et cause : tempête et abandon en toutes lettres", () => {
    expect(libelleFil("couteau", "tempete", "")).toBe("Tué par la tempête");
    expect(libelleFil("couteau", "abandon", "")).toBe("A quitté la partie");
    expect(libelleCause("couteau", "tempete", "")).toBe("Tué par la tempête");
    expect(libelleCause("couteau", "abandon", "")).toBe("A quitté la partie");
    // inchangé pour les autres causes
    expect(libelleFil("pistolet", "arme", "Lea")).toBe("Pistolet");
  });

  it("annonces : rien au premier état, avion, phases de la zone, joueurs restants", () => {
    expect(annoncesBr(null, partie())).toEqual([]);
    expect(annoncesBr(partie({ phase: "decompte", zone: null }), partie({ phase: "vol", zone: zone({ palier: 1, t0: 0, t1: 120_000 }) }))).toEqual([
      { texte: "L'avion décolle", genre: "info" },
      { texte: "La zone se resserre dans 2:00", genre: "zone" },
    ]);
    expect(annoncesBr(partie({ zone: zone({ phase: "attente" }) }), partie({ zone: zone({ phase: "retrecit" }) }))).toEqual([{ texte: "La zone se resserre !", genre: "zone" }]);
    expect(annoncesBr(partie({ zone: zone({ phase: "retrecit" }) }), partie({ zone: zone({ palier: 3, phase: "attente", t0: 0, t1: 45_000 }) }))).toEqual([
      { texte: "La zone se resserre dans 0:45", genre: "zone" },
    ]);
    expect(annoncesBr(partie({ zone: zone({ phase: "retrecit", palier: 5 }) }), partie({ zone: zone({ phase: "fermee", palier: 6 }) }))).toEqual([
      { texte: "La zone est fermée", genre: "zone" },
    ]);
    // un état identique n'annonce rien (le battement de 1 Hz)
    expect(annoncesBr(partie(), partie())).toEqual([]);
    // joueurs restants : sous 10 à chaque mort, sinon toutes les dizaines ; pas à 1 (la fin parle)
    expect(annoncesBr(partie({ vivants: 8 }), partie({ vivants: 7 }))).toEqual([{ texte: "7 joueurs restants", genre: "info" }]);
    expect(annoncesBr(partie({ vivants: 31 }), partie({ vivants: 30 }))).toEqual([{ texte: "30 joueurs restants", genre: "info" }]);
    expect(annoncesBr(partie({ vivants: 38 }), partie({ vivants: 37 }))).toEqual([]);
    expect(annoncesBr(partie({ vivants: 2 }), partie({ vivants: 1 }))).toEqual([]);
    expect(annoncesBr(partie({ phase: "lobby", zone: null }), partie({ phase: "lobby", zone: null, annule: true }))).toEqual([{ texte: "Départ annulé : pas assez de joueurs", genre: "info" }]);
  });

  it("memeEtatBrHud : seuls les champs affichés comptent (temps serveur, mètres, 3°)", () => {
    const a = ebr();
    expect(memeEtatBrHud(a, a)).toBe(true);
    expect(memeEtatBrHud(null, null)).toBe(true);
    expect(memeEtatBrHud(a, null)).toBe(false);
    expect(memeEtatBrHud(a, { ...a, serveurT: a.serveurT + 5000 })).toBe(true);
    expect(memeEtatBrHud(a, { ...a, distanceBord: -85.3 })).toBe(true);
    expect(memeEtatBrHud(a, { ...a, distanceBord: -86 })).toBe(false);
    expect(memeEtatBrHud(a, { ...a, capCentre: 0.01 })).toBe(true);
    expect(memeEtatBrHud(a, { ...a, capCentre: 0.2 })).toBe(false);
    expect(memeEtatBrHud(a, { ...a, bandage: 2 })).toBe(false);
    expect(memeEtatBrHud(a, { ...a, usage: { objet: "bandage", finT: 5 } })).toBe(false);
    expect(memeEtatBrHud(a, { ...a, suivi: "j2" })).toBe(false);
    expect(memeEtatBrHud(a, { ...a, place: 12 })).toBe(false);
    expect(memeEtatBrHud(a, { ...a, phaseVol: "libre" })).toBe(false);
    expect(memeEtatBrHud(a, { ...a, partie: partie() })).toBe(false);
    const objet = { id: 4, genre: "arme" as const, ref: "pompe" as const, p: [0, 0, 0] as [number, number, number] };
    expect(memeEtatBrHud({ ...a, proches: [objet] }, { ...a, proches: [{ ...objet }] })).toBe(true);
    expect(memeEtatBrHud({ ...a, proches: [objet] }, { ...a, proches: [{ ...objet, id: 5 }] })).toBe(false);
  });

  it("bilan : lignes par place, résumé TOP 1 / place, survie", () => {
    const l = lignesBilanBR(bilan(), "j2");
    expect(l.map((x) => x.place)).toEqual([1, 2, 3]);
    expect(l.map((x) => x.moi)).toEqual([false, true, false]);
    expect(l[0].vainqueur).toBe(true);
    expect(lignesBilanBR(undefined, "j1")).toEqual([]);
    expect(resumeFinBr(bilan(), "j1")).toMatchObject({ titre: "TOP 1", sousTitre: "Victoire", top1: true, place: 1, total: 3, kills: 4 });
    expect(resumeFinBr(bilan(), "j2")).toMatchObject({ titre: "#2 sur 3", sousTitre: "Lea remporte la partie", top1: false, place: 2, kills: 2 });
    expect(resumeFinBr(bilan(), "inconnu")).toMatchObject({ titre: "Partie terminée", place: null });
    expect(formatSurvie(605)).toBe(`10${NBSP}min 05${NBSP}s`);
    expect(formatSurvie(48)).toBe(`48${NBSP}s`);
  });

  it("palmarès : rang, meilleure place en tiret sans partie, ma ligne ajoutée hors du top", () => {
    const l = (cle: string, plus: Partial<LigneStatsBr> = {}): LigneStatsBr => ({ cle, pseudo: cle, top1: 1, parties: 2, kills: 5, meilleurePlace: 1, derniereT: 1, ...plus });
    const rows = lignesPalmaresBr([l("zoe"), l("marc", { meilleurePlace: 0 })], l("lea", { top1: 0 }));
    expect(rows.map((r) => r.rang)).toEqual([1, 2, null]);
    expect(rows.map((r) => r.moi)).toEqual([false, false, true]);
    expect(rows.map((r) => r.meilleure)).toEqual(["#1", "—", "#1"]);
    // ma ligne déjà dans le top : pas de doublon
    const dedans = lignesPalmaresBr([l("zoe"), l("lea")], l("lea"));
    expect(dedans).toHaveLength(2);
    expect(dedans[1].moi).toBe(true);
  });
});

describe("BarreBR", () => {
  const rendre = (p: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(BarreBR, { phase: "jeu", vivants: 37, total: 50, kills: 3, palier: 2, nbPaliers: 6, ...p } as never));

  it("« 37 EN VIE », mes éliminations, partants et palier", () => {
    const html = rendre();
    expect(html).toContain(`37${NBSP}EN${NBSP}VIE`);
    expect(html).toContain(`3${NBSP}K`);
    expect(html).toContain("50 partants");
    expect(html).toContain("PALIER 2/6");
    expect(html).toContain('aria-label="3 éliminations"');
  });

  it("avant la zone : « LARGAGE » ; une seule élimination au singulier", () => {
    const html = rendre({ phase: "vol", palier: 0, nbPaliers: 0, kills: 1 });
    expect(html).toContain("LARGAGE");
    expect(html).not.toContain("PALIER");
    expect(html).toContain('aria-label="1 élimination"');
  });
});

describe("BlocZone", () => {
  const rendre = (p: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(BlocZone, {
    zone: zone(), maintenantServeur: () => 100_000, distanceBord: -85, capCentre: 0.5, horsZone: false, ...p,
  } as never));

  it("attente : « LA ZONE SE FERME DANS 0:42 », distance au bord, palier et flèche vers le centre", () => {
    const html = rendre();
    expect(html).toContain("LA ZONE SE FERME DANS");
    expect(html).toContain(">0:42<");
    expect(html).toContain(`Bord de la zone à 85${NBSP}m`);
    expect(html).toContain("PALIER 2/6");
    expect(html).toContain("rotate(0.5rad)");
    expect(html).not.toContain("HORS ZONE");
  });

  it("rétrécissement et zone fermée", () => {
    expect(rendre({ zone: zone({ phase: "retrecit" }), maintenantServeur: () => 150_000 })).toContain("RÉTRÉCISSEMENT");
    const fermee = rendre({ zone: zone({ phase: "fermee", palier: 6 }) });
    expect(fermee).toContain("ZONE FERMÉE");
    expect(fermee).not.toContain("zoneChrono");
  });

  it("hors zone : l'alerte est écrite en toutes lettres avec les dégâts du palier", () => {
    const html = rendre({ horsZone: true, distanceBord: 120 });
    expect(html).toContain(`HORS ZONE : \u22124${NBSP}PV/s`);
    expect(html).toContain(`120${NBSP}m hors de la zone`);
    expect(html).toContain('data-hors="oui"');
  });

  it("sans zone : rien", () => {
    expect(rendre({ zone: null })).toBe("");
  });
});

describe("BlocInventaire", () => {
  const refUsage = createRef<HTMLDivElement>();
  const rendre = (p: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(BlocInventaire, {
    bandage: 3, potion: 0, usage: "", toucheBandage: "H", touchePotion: "J", toucheLacher: "U", refUsage, ...p,
  } as never));

  it("bandages et potions avec la touche réelle, ce que chacun rend ; vide marqué", () => {
    const html = rendre();
    expect(html).toContain("[H]");
    expect(html).toContain("[J]");
    expect(html).toContain("BANDAGE");
    expect(html).toContain("×3");
    expect(html).toContain("×0");
    expect(html).toContain("+20 PV");
    expect(html).toContain("sous 75 PV");
    expect(html).toContain("+50 bouclier");
    expect(html.match(/data-vide="oui"/g)).toHaveLength(1);
    expect(html).toContain("<kbd>U</kbd>");
    expect(html).not.toContain('role="progressbar"');
  });

  it("usage en cours : barre de progression écrite et nom du soin ; sans touche assignée, pas de crochets", () => {
    const html = rendre({ usage: "potion", potion: 2 });
    expect(html).toContain("Potion de bouclier en cours…");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('data-usage="oui"');
    const sans = rendre({ toucheBandage: "", toucheLacher: "" });
    expect(sans).not.toContain("[H]");
    expect(sans).not.toContain("lâcher");
  });
});

describe("BlocVol", () => {
  const rendre = (p: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(BlocVol, { phaseVol: "avion", altitude: 350, vitesseChute: 0, toucheSaut: "Espace", ...p } as never));

  it("avion : invite de saut avec la touche réelle, sans télémétrie", () => {
    const html = rendre();
    expect(html).toMatch(/<kbd>Espace<\/kbd> Sauter de l&#x27;avion/);
    expect(html).not.toContain("ALTITUDE");
  });

  it("chute libre : ouvrir le parachute, altitude et vitesse de chute", () => {
    const html = rendre({ phaseVol: "libre", altitude: 245, vitesseChute: 38 });
    expect(html).toContain("Ouvrir le parachute");
    expect(html).toContain(`245${NBSP}m`);
    expect(html).toContain(`38${NBSP}m/s`);
  });

  it("voile, atterrissage attendu, sol : texte d'état ou rien ; touche non assignée dite", () => {
    expect(rendre({ phaseVol: "voile" })).toContain("PARACHUTE OUVERT");
    expect(rendre({ phaseVol: "attenteAtterri" })).toContain("Atterrissage…");
    expect(rendre({ phaseVol: "sol" })).toBe("");
    expect(rendre({ phaseVol: "" })).toBe("");
    expect(rendre({ toucheSaut: "" })).toContain("touche non assignée");
  });
});

describe("InvitesAction : ramasser (BR)", () => {
  const rendre = (p: Record<string, unknown>) => renderToStaticMarkup(createElement(InvitesAction, { invite: "", inviteDetail: "", toucheInteragir: "E", inviteRecharge: false, toucheRecharger: "R", ...p } as never));

  it("« [E] Ramasser Fusil d'assaut (rare) » avec la touche réelle", () => {
    const html = rendre({ invite: "ramasser", inviteDetail: "Ramasser Fusil d'assaut (rare)" });
    expect(html).toMatch(/<kbd>E<\/kbd> Ramasser Fusil d&#x27;assaut \(rare\)/);
    expect(html).toContain('data-assez="oui"');
    expect(html).not.toContain("Argent insuffisant");
  });

  it("objet refusé : plaque en danger, le détail dit pourquoi ; touche non assignée", () => {
    const html = rendre({ invite: "ramasser", inviteDetail: "Boîte de cartouches (aucune arme compatible)", assez: false });
    expect(html).toContain('data-assez="non"');
    expect(html).toContain("aucune arme compatible");
    expect(html).not.toContain("Argent insuffisant");
    expect(rendre({ invite: "ramasser", inviteDetail: "Ramasser Pompe", toucheInteragir: "" })).toContain("touche non assignée");
  });
});

describe("BlocVie sans régénération (BR)", () => {
  it("regenParS 0 : ni délai de régénération, ni ligne « RÉGÉNÉRATION »", () => {
    const html = vie({ pv: 60, regen: true, pvMax: 100, regenParS: 0 });
    expect(html).not.toContain("RÉGÉNÉRATION");
    expect(html).not.toContain("delaiRegen");
    // l'arène garde son comportement
    expect(vie({ pv: 60, regen: true })).toContain("RÉGÉNÉRATION +");
    expect(vie({ pv: 60 })).toContain("delaiRegen");
  });
});

describe("FilEliminations : tempête, abandon, annonces de zone (BR)", () => {
  const e = (plus: Record<string, unknown>) => ({ id: 1, par: "", parCouleur: "", cible: "Marc", cibleCouleur: "#abcdef", arme: "couteau", cause: "tempete", tete: false, moi: false, ...plus });
  const rendre = (fil: unknown[], annonces: unknown[] = []) => renderToStaticMarkup(createElement(FilEliminations, { fil, annonces } as never));

  it("mort par la tempête et abandon en toutes lettres, sans nom de tueur", () => {
    const html = rendre([e({}), e({ id: 2, cause: "abandon", cible: "Zoé" })]);
    expect(html).toContain("Tué par la tempête");
    expect(html).toContain("A quitté la partie");
    expect(html).toContain("<b>Marc</b>");
  });

  it("un kill à l'arme garde sa forme normale ; une annonce de zone porte son genre", () => {
    expect(rendre([e({ cause: "arme", par: "Lea", parCouleur: "#aabbcc", arme: "pompe" })])).toContain("<b>Lea</b>");
    const html = rendre([], [{ id: 5, texte: "La zone se resserre !", genre: "zone" }]);
    expect(html).toContain('data-genre="zone"');
    expect(html).toContain("La zone se resserre !");
  });
});

describe("EcranSpectateur et mort définitive (BR)", () => {
  const mort = { par: "Lea", parCouleur: "#aabbcc", arme: "pompe" as const, cause: "arme" as const, zone: "corps" as const, tueur: null };
  const tueur = { id: "j1", pseudo: "Lea", couleur: "#aabbcc", p: [0, 0, 0] as [number, number, number], lacet: 0, tangage: 0, arme: "pompe" as const, pv: 80, bouclier: 0, distance: 31.4 };
  const joueurs = [{ id: "j1", pseudo: "Lea", couleur: "#aabbcc" }, { id: "j2", pseudo: "Marc", couleur: "#ccbbaa" }];
  const spectateur = (p: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(EcranSpectateur, {
    derniereMort: mort, place: 12, total: 37, suiviId: "j1", joueurs, toucheSuivant: "→", touchePrecedent: "←", ...p,
  } as never));

  it("bandeau : place, cause, joueur suivi, touches réelles, aucun bouton mort (la souris est prise) ; Quitter passe par Échap", () => {
    const html = spectateur();
    expect(html).toContain("Éliminé · place #12 sur 37");
    expect(html).toContain("Éliminé par Lea");
    expect(html).toContain("Vous suivez");
    expect(html).toContain("<b>Lea</b>");
    expect(html).not.toContain("<button");
    expect(html).toContain("<kbd>←</kbd> joueur précédent");
    expect(html).toContain("<kbd>→</kbd> joueur suivant");
    expect(html).toContain("<kbd>Clic</kbd>");
    expect(html).toContain("<kbd>Échap</kbd> menu (Quitter)");
  });

  it("touches non assignées : le clic et Échap restent rappelés ; personne à suivre ; tempête sans tueur", () => {
    const html = spectateur({ suiviId: null, toucheSuivant: "", touchePrecedent: "", derniereMort: { ...mort, par: "", cause: "tempete" } });
    expect(html).not.toContain("<button");
    expect(html).not.toContain("joueur précédent");
    expect(html).toContain("<kbd>Clic</kbd> joueur suivant");
    expect(html).toContain("Personne à suivre");
    expect(html).toContain("Tué par la tempête");
    expect(html).not.toContain("Éliminé par");
  });

  it("carte d'élimination de la killcam : tueur, arme et distance, place provisoire, jamais de réapparition", () => {
    const html = renderToStaticMarkup(createElement(CarteEliminationBr, { derniereMort: mort, killcamInfo: tueur, place: 12, total: 37 }));
    expect(html).toContain("Éliminé par");
    expect(html).toContain("Lea");
    expect(html).toContain(`Fusil à pompe · 31${NBSP}m`);
    expect(html).toContain("Éliminé · place #12 sur 37");
    expect(html).not.toMatch(/Réapparition/i);
    expect(renderToStaticMarkup(createElement(CarteEliminationBr, { derniereMort: { ...mort, cause: "abandon" as const }, killcamInfo: null, place: 5, total: 9 }))).toContain("A quitté la partie");
  });

  const hudBr = (plus: Partial<HudEtat> = {}): HudEtat => ({ ...HUD_BR, ...plus });
  const ecran = (plus: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(EcranMort, {
    hud: hudBr({ mort: true, killcamPhase: "" }), derniereMort: mort, killcamInfo: tueur, degatsAuTueur: 0, touches: touchesParDefaut(),
    equipement: { principale: "mitraillette", secondaire: "pistolet" }, surEquipement: () => {}, surPasserKillcam: () => {},
    br: { place: 12, total: 37, suiviId: "j1", joueurs, toucheSuivant: "→", touchePrecedent: "←" }, ...plus,
  } as never));

  it("EcranMort en BR : rejeu sans choix d'équipement, carte d'élimination sans réapparition, puis bandeau du spectateur", () => {
    const rejeu = ecran({ hud: hudBr({ mort: true, killcamPhase: "rejeu", killcam: 0.2 }) });
    expect(rejeu).toContain("Rejeu");
    expect(rejeu).not.toContain("Équipement");
    const carte = ecran({ hud: hudBr({ mort: true, killcamPhase: "carte", killcam: 0.8, reapparitionDans: 2 }) });
    expect(carte).toContain("Éliminé par");
    expect(carte).not.toMatch(/réapparition/i);
    expect(carte).not.toContain("Équipement");
    const spect = ecran();
    expect(spect).toContain("Éliminé · place #12 sur 37");
    expect(spect).toContain("Vous suivez");
    expect(spect).not.toMatch(/réapparition|Apparition…/i);
  });

  it("EcranMort sans `br` ou vivant : comportement de l'arène / rien", () => {
    expect(ecran({ hud: hudBr({ mort: false }) })).toBe("");
    expect(ecran({ br: undefined, hud: hudBr({ mort: true, mode: "arene", killcamPhase: "", reapparitionDans: 2.5 }) })).toContain("Réapparition");
  });
});

describe("TableauStatsBr", () => {
  const l = (cle: string, plus: Partial<LigneStatsBr> = {}): LigneStatsBr => ({ cle, pseudo: cle[0].toUpperCase() + cle.slice(1), top1: 2, parties: 5, kills: 11, meilleurePlace: 1, derniereT: 1, ...plus });

  it("chargement, vide, puis tableau avec ma ligne marquée et ajoutée hors du top", () => {
    expect(renderToStaticMarkup(createElement(TableauStatsBr, { lignes: null }))).toContain("en cours de chargement");
    expect(renderToStaticMarkup(createElement(TableauStatsBr, { lignes: [] }))).toContain("Aucun TOP 1");
    const html = renderToStaticMarkup(createElement(TableauStatsBr, { lignes: [l("zoe"), l("marc", { top1: 1, meilleurePlace: 0 })], moi: l("lea", { top1: 0, parties: 1, meilleurePlace: 4 }) }));
    expect(html).toContain("<caption");
    expect(html).toContain("TOP 1 cumulés");
    expect(html).toContain("Zoe");
    expect(html).toContain("#4");
    expect(html).toContain("—");
    expect(html.match(/data-moi="oui"/g)).toHaveLength(1);
    expect(html).toContain("Lea</span><em> (vous)</em>");
  });
});

describe("FinDePartieBR", () => {
  const stats = { lignes: [{ cle: "lea", pseudo: "Lea", top1: 3, parties: 8, kills: 21, meilleurePlace: 1, derniereT: 1 }], moi: { cle: "lea", pseudo: "Lea", top1: 3, parties: 8, kills: 21, meilleurePlace: 1, derniereT: 1 } };
  const rendre = (p: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(FinDePartieBR, {
    partie: finPartie(), monId: "j1", statsBr: stats, maintenantServeur: () => 100_000, surRejouer: () => {}, surQuitter: () => {}, ...p,
  } as never));

  it("TOP 1 : titre, victoire, éliminations, durée, classement par place et palmarès cumulé", () => {
    const html = rendre();
    expect(html).toContain(">TOP 1<");
    expect(html).toContain("Victoire");
    expect(html).toContain("Vos éliminations : <b>4</b>");
    expect(html).toContain(`Durée de la partie : 10${NBSP}min 05${NBSP}s`);
    expect(html.indexOf("Lea<em>")).toBeLessThan(html.indexOf("Marc"));
    expect(html.indexOf("Marc")).toBeLessThan(html.indexOf("Zoé"));
    expect(html).toContain("612");
    expect(html).toContain("TOP 1 cumulés");
    expect(html).toContain('data-moi="oui"');
    expect(html).not.toContain("non comptée");
  });

  it("perdant : « #2 sur 3 » et le vainqueur nommé ; retour automatique et boutons", () => {
    const html = rendre({ monId: "j2" });
    expect(html).toContain(">#2 sur 3<");
    expect(html).toContain("Lea remporte la partie");
    expect(html).toContain("Retour automatique au lobby dans <b>30</b>");
    expect(html).toMatch(/<button[^>]*>Rejouer<\/button>/);
    expect(html).toMatch(/<button[^>]*>Quitter<\/button>/);
  });

  it("partie non comptée : écrit ; pseudo « Agent » : le nom à choisir est rappelé ; palmarès pas encore reçu", () => {
    const html = rendre({ partie: finPartie({ nonComptee: true }), statsBr: null });
    expect(html).toContain("Partie trop courte : non comptée");
    expect(html).toContain("en cours de chargement");
    const agent = finPartie({ bilan: { ...bilan(), lignes: bilan().lignes.map((x) => (x.id === "j1" ? { ...x, pseudo: "Agent3" } : x)) } });
    expect(rendre({ partie: agent })).toContain("Choisissez un nom pour compter vos TOP 1.");
  });

  it("tableau des scores de la partie (Tab) : joueurs en jeu par éliminations, le mien marqué", () => {
    const joueurs = [
      { id: "j1", pseudo: "Lea", couleur: "#aabbcc", enJeu: true, kills: 1, morts: 0, ping: 10 },
      { id: "j2", pseudo: "Marc", couleur: "#ccbbaa", enJeu: true, kills: 4, morts: 0, ping: 10 },
      { id: "j3", pseudo: "Zoé", couleur: "#112233", enJeu: false, kills: 9, morts: 0, ping: 10 },
    ];
    const html = renderToStaticMarkup(createElement(TableauPartieBr, { joueurs, monId: "j1", vivants: 2, total: 3 }));
    expect(html).toContain("Battle Royale · 2 en vie sur 3");
    expect(html.indexOf("Marc")).toBeLessThan(html.indexOf("Lea"));
    expect(html).not.toContain("Zoé");
    expect(html).toContain("Lea</span><em> (vous)</em>");
  });
});

describe("MenuPause et aide en Battle Royale", () => {
  const rendre = (plus: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(MenuPause, {
    premiereFois: false, surReprendre: () => {}, surQuitter: () => {}, equipement: { principale: "mitraillette", secondaire: "pistolet" }, surEquipement: () => {},
    pseudo: "Lea", surPseudo: () => {}, sensibilite: 1, surSensibilite: () => {}, accroupiBascule: false, surAccroupiBascule: () => {},
    voix: { actif: false, mode: "appuyer" }, surVoix: () => {}, voixErreur: "", toucheParler: "T", actionsSansTouche: [], touches: touchesParDefaut(), surTouches: () => {},
    reglagesHud: REGLAGES_HUD_DEFAUT, surReglagesHud: () => {}, ...plus,
  } as never));

  it("pas de chat vocal ni de choix d'équipement ; quitter est un abandon tant qu'on vit", () => {
    const html = rendre({ mode: "br" });
    expect(html).not.toContain("Chat vocal de proximité");
    expect(html).not.toContain("Équipement de la prochaine apparition");
    expect(html).toContain("la tempête et les autres joueurs ne s&#x27;arrêtent pas");
    expect(html).toContain("compte comme un abandon");
    expect(html).toContain("Quitter la partie");
    expect(rendre({ mode: "br", elimine: true })).not.toContain("abandon");
    // l'arène garde son chat vocal et son équipement
    const arene = rendre();
    expect(arene).toContain("Chat vocal de proximité");
    expect(arene).toContain("Équipement de la prochaine apparition");
  });

  it("aide des commandes : saut de l'avion, ramassage, soins et lâcher avec les touches réelles", () => {
    const c = commandes(touchesParDefaut(), null, "br");
    expect(c.find(([, v]) => v.startsWith("Sauter de l'avion"))?.[0]).toBe("Espace");
    expect(c.find(([, v]) => v === "Ramasser l'objet au sol")?.[0]).toBe("E");
    expect(c.find(([, v]) => v === "Utiliser un bandage")?.[0]).toBe("H");
    expect(c.find(([, v]) => v === "Boire une potion de bouclier")?.[0]).toBe("J");
    expect(c.find(([, v]) => v === "Lâcher l'arme en main")?.[0]).toBe("U");
    expect(c.some(([, v]) => /voiture/i.test(v))).toBe(false);
  });
});

const HUD_BR: HudEtat = {
  pv: 100, bouclier: 0, arme: "couteau", slot: "couteau", slots: "couteau:couteau:0:0", equipSuivant: "mitraillette|pistolet",
  munitions: 0, chargeur: 0, reserve: -1, recharge: false, degainage: false, vise: false, lunette: false, zoomX: 0, zoomNiveau: -1, zoomNiveaux: 0, ecartViseur: 0,
  distanceVisee: -1, mur: false, mort: false, reapparitionDans: 0, protege: false, protegeRestant: 0, verrouille: true, connecte: true, entracte: false, accroupi: false,
  glisse: false, regen: false, bonusVitesse: 1.3, invite: "", inviteDetail: "", vehicule: false, vehiculeId: -1, siege: -1, tireInterdit: false, embarquement: false,
  killcam: -1, killcamPhase: "", sort: false, voix: "", voixParlants: "", titan: false, mode: "br", phaseVol: "sol", altitude: 0, vitesseChute: 0, bandages: 3, potions: 1,
  usageSoin: "", horsZone: false, spectateur: false, spectateurCible: "",
};

describe("HudArene en Battle Royale", () => {
  const live: HudLive = { recharge: 0, vitesse: 0, vitesseKmh: 0, regenDelai: 1, usage: 0 };
  const props = (hud: HudEtat, plus: Record<string, unknown> = {}) => ({
    hud, monId: "j1",
    joueurs: [
      { id: "j1", pseudo: "Lea", couleur: "#aabbcc", enJeu: true, kills: 3, morts: 0, ping: 10, serie: 5 },
      { id: "j2", pseudo: "Marc", couleur: "#ccbbaa", enJeu: true, kills: 0, morts: 0, ping: 10 },
    ],
    match: { numero: 1, fin: null, objectif: 0, phase: "jeu", prochain: null }, classement: null, fil: [], evenements: [], derniereMort: null,
    maintenantServeur: () => 100_000, sensibilite: 1, surSensibilite: () => {}, touches: touchesParDefaut(), surTouches: () => {}, actionsSansTouche: [],
    pseudo: "Lea", surPseudo: () => {}, surReprendre: () => {}, surQuitter: () => {},
    equipement: { principale: "mitraillette", secondaire: "pistolet" }, surEquipement: () => {}, elsa: null, annonces: [], sieges: [], bonus: null,
    accroupiBascule: false, surAccroupiBascule: () => {}, voix: { actif: false, mode: "appuyer" }, surVoix: () => {}, voixErreur: "", killcamInfo: null, surPasserKillcam: () => {},
    stats: new Map(), surVueScores: () => {}, live, radar: () => ({}), reglagesHud: { ...REGLAGES_HUD_DEFAUT, minimap: { ...REGLAGES_HUD_DEFAUT.minimap, coin: "off" } },
    surReglagesHud: () => {}, degatsAuTueur: 0, scene: null, br: partie(), statsBr: null, etatBr: () => ebr(), ...plus,
  });
  const rendre = (hud: HudEtat, plus: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(HudArene, props(hud, plus) as never));

  it("au sol : barre, zone, inventaire, vie sans régénération ; ni barre de match, ni frappe aérienne (série de 5)", () => {
    const html = rendre(HUD_BR);
    expect(html).toContain(`37${NBSP}EN${NBSP}VIE`);
    expect(html).toContain("Tempête");
    expect(html).toContain("Soins en stock");
    expect(html).toContain("Santé");
    expect(html).not.toContain("RÉGÉNÉRATION");
    expect(html).not.toContain("FRAPPE AÉRIENNE");
    expect(html).not.toContain("Match");
  });

  it("dans l'avion : invite de saut, ni viseur, ni armes, ni inventaire", () => {
    const html = rendre({ ...HUD_BR, phaseVol: "avion" });
    expect(html).toContain("Sauter de l&#x27;avion");
    expect(html).not.toContain("Armes et munitions");
    expect(html).not.toContain("Soins en stock");
    const libre = rendre({ ...HUD_BR, phaseVol: "libre", altitude: 200, vitesseChute: 40 });
    expect(libre).toContain("Ouvrir le parachute");
    expect(libre).not.toContain("COURSE");
  });

  it("hors zone : alerte écrite", () => {
    expect(rendre({ ...HUD_BR, horsZone: true })).toContain("HORS ZONE");
    expect(rendre(HUD_BR)).not.toContain("HORS ZONE");
  });

  it("mort : spectateur avec place, joueur suivi, rappel des commandes ; le HUD de combat disparaît mais barre et zone restent", () => {
    const html = rendre({ ...HUD_BR, mort: true, killcamPhase: "" }, {
      etatBr: () => ebr({ suivi: "j2", place: 12 }),
      derniereMort: { par: "Marc", parCouleur: "#ccbbaa", arme: "pompe", cause: "arme", zone: "corps", tueur: null },
    });
    expect(html).toContain("Éliminé · place #12 sur 50");
    expect(html).toContain("Vous suivez");
    expect(html).toContain("joueur précédent");
    expect(html).toContain(`37${NBSP}EN${NBSP}VIE`);
    expect(html).toContain("Tempête");
    expect(html).not.toContain("Soins en stock");
    expect(html).not.toContain("Équipement de la prochaine apparition");
  });

  it("fin de partie : l'écran de fin remplace le menu pause même souris libre", () => {
    const html = rendre({ ...HUD_BR, verrouille: false }, { br: finPartie(), etatBr: () => ebr({ partie: finPartie() }) });
    expect(html).toContain("Fin de partie");
    expect(html).toContain(">TOP 1<");
    expect(html).not.toContain("Menu pause");
    // souris libre en cours de partie : menu pause BR sans chat vocal
    const pause = rendre({ ...HUD_BR, verrouille: false });
    expect(pause).toContain("Menu pause");
    expect(pause).not.toContain("Chat vocal de proximité");
  });

  it("l'arène n'est pas touchée : pas de bloc BR", () => {
    const html = rendre({ ...HUD_BR, mode: "arene" }, { br: null, etatBr: undefined });
    expect(html).not.toContain("Tempête");
    expect(html).not.toContain("EN VIE");
  });
});
