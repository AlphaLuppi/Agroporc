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
import { touchesParDefaut } from "./touches";
import { NBSP } from "./hud-modele";
import type { CoinMinimap } from "./reglages-hud";

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
