import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CarteTueur from "../../app/components/arene/hud/CarteTueur";
import EcranMort from "../../app/components/arene/hud/EcranMort";
import FinDeMatch from "../../app/components/arene/hud/FinDeMatch";
import Killcam from "../../app/components/arene/Killcam";
import ReglageInterface from "../../app/components/arene/hud/ReglageInterface";
import SelecteurCoin from "../../app/components/arene/hud/SelecteurCoin";
import TableauScores from "../../app/components/arene/hud/TableauScores";
import type { DerniereMort } from "../../app/components/arene/contrats";
import type { HudEtat } from "./jeu-types";
import type { InfoMatch, InfoTueur, JoueurPublic, LigneClassement, LigneStats } from "./protocole";
import { REGLAGES_HUD_DEFAUT } from "./reglages-hud";
import { touchesParDefaut } from "./touches";

const NBSP = " ";
const joueur = (id: string, kills: number, morts: number, plus: Partial<JoueurPublic> = {}): JoueurPublic => ({
  id, pseudo: id, couleur: "#ffb35c", enJeu: true, kills, morts, ping: 40, ...plus,
});
const match = (plus: Partial<InfoMatch> = {}): InfoMatch => ({ numero: 14, fin: 300_000, objectif: 30, phase: "jeu", prochain: null, ...plus });
const stat = (id: string, plus: Partial<LigneStats> = {}): LigneStats => ({
  id, serie: 0, serieMax: 0, tirs: 0, touches: 0, tetes: 0, degats: 0, armeFav: null, vivant: true, vehicule: false, ...plus,
});
const equipement = { principale: "fusil_assaut" as const, secondaire: "pistolet" as const };
const rien = () => undefined;

const sixJoueurs = [
  joueur("lea", 30, 7), joueur("zoe", 24, 9), joueur("max", 19, 10), joueur("moi", 12, 8), joueur("tom", 9, 12), joueur("eve", 7, 11),
];

const tableau = (plus: Partial<Parameters<typeof TableauScores>[0]> = {}) =>
  renderToStaticMarkup(createElement(TableauScores, {
    joueurs: sixJoueurs, stats: new Map(), classement: null, monId: "moi", match: match(), maintenantServeur: () => 0, largeur: 1200, ...plus,
  }));

const compte = (html: string, motif: RegExp) => (html.match(motif) ?? []).length;

describe("TableauScores (rendu statique)", () => {
  it("vrai <table> avec caption, en-têtes scope=col et ma ligne en aria-current", () => {
    const html = tableau();
    expect(html).toContain("<table");
    expect(html).toMatch(/<caption[^>]*>Tableau des scores, match 14<\/caption>/);
    expect(compte(html, /<th scope="col"/g)).toBe(11);
    expect(compte(html, /aria-current="true"/g)).toBe(1);
    expect(html).toMatch(/<tr data-id="moi" aria-current="true"/);
    expect(html).toContain(">Vous<");
  });

  it("toutes les colonnes à 1100 px et plus", () => {
    const html = tableau({ largeur: 1100 });
    expect(compte(html, /<th scope="col"/g)).toBe(11);
    expect(html).toContain("Arme fav.");
  });

  it("colonnes repliées selon la largeur : 800 à 1099 px sans TÊTE, DÉG ni ARME", () => {
    const html = tableau({ largeur: 900 });
    expect(compte(html, /<th scope="col"/g)).toBe(8);
    expect(html).not.toContain("Arme fav.");
    expect(html).not.toContain(">Dég<");
    expect(html).toContain(">Préc<");
  });

  it("sous 800 px : rang, agent, K, M, K/D, ping", () => {
    const html = tableau({ largeur: 700 });
    expect(compte(html, /<th scope="col"/g)).toBe(6);
    expect(html).not.toContain(">Préc<");
    expect(html).not.toContain(">Sér<");
  });

  it("sans statistiques : « — » dans les cellules de stats, pas d'erreur", () => {
    const html = tableau();
    // précision, têtes, dégâts, arme favorite de chacun des six joueurs
    expect(compte(html, />—<\/td>/g)).toBe(6 * 4);
  });

  it("avec les statistiques du message `scores` : valeurs, éliminé, en véhicule", () => {
    const stats = new Map([
      ["lea", stat("lea", { tirs: 100, touches: 41, tetes: 9, degats: 2310, armeFav: "fusil_assaut", vivant: false })],
      ["zoe", stat("zoe", { vehicule: true })],
    ]);
    const html = tableau({ stats });
    expect(html).toContain(`41${NBSP}%`);
    expect(html).toContain("éliminé");
    expect(html).toContain("en véhicule");
    expect(html).toContain("Fusil");
  });

  it("classement : tri par kills, leader étoilé et étiqueté", () => {
    const html = tableau();
    expect(html.indexOf('data-id="lea"')).toBeLessThan(html.indexOf('data-id="zoe"'));
    expect(html.indexOf('data-id="moi"')).toBeLessThan(html.indexOf('data-id="tom"'));
    expect(compte(html, />Leader</g)).toBe(1);
  });

  it("phrase de situation, présence et minuterie", () => {
    const html = tableau({ joueurs: [...sixJoueurs, joueur("spec", 0, 0, { enJeu: false })], match: match({ fin: 272_000 }), maintenantServeur: () => 0 });
    expect(html).toContain("Vous êtes 4e, à 18 kills du leader");
    expect(html).toContain("6 en jeu + 1 spectateur");
    expect(html).toContain("4:32");
    expect(html).toContain("Premier à 30 kills");
  });

  it("minuterie critique : les secondes sont écrites", () => {
    const html = tableau({ match: match({ fin: 8_000 }) });
    expect(html).toContain('data-niveau="critique"');
    expect(html).toContain(`8${NBSP}s`);
  });

  it("point de match annoncé à 3 kills de l'objectif", () => {
    expect(tableau({ joueurs: [joueur("lea", 27, 1), joueur("moi", 5, 5)] })).toContain("Point de match");
    expect(tableau({ joueurs: [joueur("lea", 26, 1), joueur("moi", 5, 5)] })).not.toContain("Point de match");
  });

  it("records en pied avec les minimums, rappel de la touche", () => {
    const stats = new Map([
      ["zoe", stat("zoe", { tirs: 50, touches: 26, tetes: 3, serieMax: 3 })],
      ["max", stat("max", { tirs: 9, touches: 9, tetes: 4 })],
    ]);
    const html = tableau({ stats, toucheScores: "Tab" });
    expect(html).toContain(`précision zoe 52${NBSP}%`);
    expect(html).toContain("série zoe ×3");
    expect(html).toContain(`têtes max 44${NBSP}%`);
    // max : 9 tirs (< 10) et 9 touches dont 4 têtes (44 %) : la précision de 100 % ne compte pas, les têtes si
    expect(html).not.toContain("précision max");
    expect(html).toContain("<kbd>Tab</kbd>");
  });

  it("personne en jeu : une ligne d'explication, sans erreur", () => {
    expect(tableau({ joueurs: [] })).toContain("Personne en jeu.");
  });

  it("tableau d'entracte : « Terminé » à la place de la minuterie", () => {
    expect(tableau({ match: match({ fin: null, phase: "entracte", prochain: 9000 }) })).toContain(">Terminé<");
  });
});

describe("FinDeMatch (rendu statique)", () => {
  const classement: LigneClassement[] = sixJoueurs.map((j) => ({ id: j.id, pseudo: j.pseudo, couleur: j.couleur, kills: j.kills, morts: j.morts }));
  const fin = (plus: Partial<Parameters<typeof FinDeMatch>[0]> = {}) =>
    renderToStaticMarkup(createElement(FinDeMatch, {
      joueurs: sixJoueurs, stats: new Map(), classement, monId: "moi", match: match({ fin: null, phase: "entracte", prochain: 9_000 }),
      maintenantServeur: () => 0, equipement, surEquipement: rien, ...plus,
    }));

  it("titre, raison de la fin et vainqueur", () => {
    const html = fin();
    expect(html).toContain("Match terminé");
    expect(html).toContain("lea remporte la partie");
    expect(html).toContain("lea a atteint 30 kills");
  });

  it("podium : 1er, 2e, 3e, disposés 2-1-3 (positions 1, 2, 3 dans l'ordre du DOM)", () => {
    const html = fin();
    const marches = [...html.matchAll(/<li[^>]*data-position="(\d)"[^>]*>.*?<\/li>/g)];
    expect(marches.map((m) => m[1])).toEqual(["1", "2", "3"]);
    expect(html).toMatch(/>1er<[\s\S]*>2e<[\s\S]*>3e</);
    expect(html).toContain('aria-label="Podium"');
    expect(html).toContain("30 K · 7 M");
    expect(html).toContain("K/D 4,3");
  });

  it("moins de trois joueurs : le podium s'adapte", () => {
    const html = fin({ classement: classement.slice(0, 2), joueurs: sixJoueurs.slice(0, 2), monId: "lea" });
    expect(compte(html, /data-position=/g)).toBe(2);
    expect(html).toContain("Pas d&#x27;autres joueurs.");
  });

  it("« Ton match » avec mon rang, classement de la 4e place avec ma ligne, distinctions", () => {
    const html = fin();
    expect(html).toContain("Ton match (4e/6)");
    expect(html).toContain('aria-label="Classement"');
    expect(html).toMatch(/<tr data-id="moi" aria-current="true"/);
    expect(html).not.toMatch(/<tr data-id="lea"/);
    expect(html).toContain("Distinctions");
    expect(html).toContain("Précision");
  });

  it("compte à rebours et choix d'équipement compact", () => {
    const html = fin();
    expect(html).toMatch(/Prochain match dans <b>9<\/b>/);
    expect(html).toContain('aria-pressed="true"');
  });

  it("Tab maintenu : le tableau complet remplace le podium", () => {
    const html = fin({ tableauOuvert: true });
    expect(html).toContain('aria-label="Tableau des scores"');
    expect(html).not.toContain("Podium");
  });

  it("je ne suis pas dans le classement : message sans erreur", () => {
    expect(fin({ monId: "inconnu" })).toContain("Tu n&#x27;as pas joué ce match.");
  });
});

describe("CarteTueur / EcranMort / Killcam (rendu statique)", () => {
  const tueur: InfoTueur = {
    id: "lea", pseudo: "Lea", couleur: "#9be9ff", p: [0, 0, 0], lacet: 0, tangage: 0, arme: "fusil_assaut", pv: 54, bouclier: 25, distance: 38.4,
  };
  const mort = (plus: Partial<DerniereMort> = {}): DerniereMort => ({ par: "Lea", parCouleur: "#9be9ff", arme: "fusil_assaut", cause: "arme", zone: "tete", tueur, ...plus });
  const hud = (plus: Partial<HudEtat> = {}) => ({ mort: true, reapparitionDans: 1.4, killcam: 0.7, killcamPhase: "carte", ...plus }) as unknown as HudEtat;

  it("carte du tueur : pseudo, arme, distance, tir à la tête, PV, bouclier, dégâts rendus, réapparition", () => {
    const html = renderToStaticMarkup(createElement(CarteTueur, { tueur, derniereMort: mort(), degatsAuTueur: 46, reapparitionDans: 1.4, kmTueur: { kills: 18, morts: 7 } }));
    expect(html).toContain("Éliminé par");
    expect(html).toContain(">Lea<");
    expect(html).toContain(`Fusil d&#x27;assaut · 38${NBSP}m`);
    expect(html).toContain("tir à la tête");
    expect(html).toContain("18 K · 7 M ce match");
    expect(html).toContain(">54<");
    expect(html).toContain(">25<");
    expect(html).toContain("Vous lui avez infligé <b>46</b> dégâts");
    expect(html).toContain(`Réapparition dans <b>1,4</b>${NBSP}s`);
    expect(html).toContain('role="status"');
  });

  it("carte du tueur : aucun dégât rendu, sans tir à la tête", () => {
    const html = renderToStaticMarkup(createElement(CarteTueur, { tueur, derniereMort: mort({ zone: "corps" }), degatsAuTueur: 0, reapparitionDans: 0 }));
    expect(html).toContain("Vous ne l&#x27;avez pas touché");
    expect(html).not.toContain("tir à la tête");
    expect(html).toContain("Réapparition…");
  });

  it("repli sans tueur joueur : le titre est libelleCause", () => {
    const circulation = renderToStaticMarkup(createElement(CarteTueur, {
      tueur: null, derniereMort: mort({ cause: "ecrase_pnj", par: "", tueur: null }), degatsAuTueur: 0, reapparitionDans: 2,
    }));
    expect(circulation).toContain("Écrasé par la circulation");
    expect(circulation).not.toContain("Éliminé par");
    expect(circulation).not.toContain("PV");
    const renverse = renderToStaticMarkup(createElement(CarteTueur, {
      tueur: null, derniereMort: mort({ cause: "ecrase_vehicule", par: "Max", tueur: null }), degatsAuTueur: 0, reapparitionDans: 2,
    }));
    expect(renverse).toContain("Renversé par Max");
  });

  it("tueur déconnecté sans photographie : pseudo et arme repris de la mort", () => {
    const html = renderToStaticMarkup(createElement(CarteTueur, { tueur: null, derniereMort: mort({ tueur: null }), degatsAuTueur: 0, reapparitionDans: 2 }));
    expect(html).toContain("Éliminé par");
    expect(html).toContain("Fusil d&#x27;assaut");
    expect(html).not.toContain("Bouclier");
  });

  const ecran = (h: HudEtat, plus: Partial<Parameters<typeof EcranMort>[0]> = {}) =>
    renderToStaticMarkup(createElement(EcranMort, {
      hud: h, derniereMort: mort(), killcamInfo: tueur, degatsAuTueur: 12, touches: touchesParDefaut(), equipement, surEquipement: rien, surPasserKillcam: rien, ...plus,
    }));

  it("rien hors mort", () => {
    expect(ecran(hud({ mort: false }))).toBe("");
  });

  it("rejeu : bandes, légende, bouton Passer, titre ÉLIMINÉ en status, pas de carte", () => {
    const html = ecran(hud({ killcamPhase: "rejeu", killcam: 0.3 }));
    expect(html).toContain("Rejeu");
    expect(html).toContain("vue de");
    expect(html).toContain(`Fusil d&#x27;assaut · 38${NBSP}m`);
    expect(html).toMatch(/<button[^>]*>Passer <kbd>Espace<\/kbd><\/button>/);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="30"');
    expect(html).toMatch(/<p[^>]*role="status"[^>]*>Éliminé<\/p>/);
    expect(html).not.toContain("Éliminé par");
    expect(html).toContain('aria-pressed="true"');
  });

  it("carte : la carte du tueur entre les bandes, sans bouton Passer", () => {
    const html = ecran(hud({ killcamPhase: "carte" }), { joueurs: [{ id: "lea", kills: 18, morts: 7 }] });
    expect(html).toContain("Éliminé par");
    expect(html).toContain("18 K · 7 M ce match");
    expect(html).not.toContain("Passer");
    expect(html).toContain('role="progressbar"');
    // un seul role=status pendant la carte
    expect(compte(html, /role="status"/g)).toBe(1);
  });

  it("repli sans rejeu : la carte seule, sans bandes ni barre", () => {
    const html = ecran(hud({ killcamPhase: "", killcam: -1 }));
    expect(html).toContain("Éliminé par");
    expect(html).not.toContain("progressbar");
  });

  it("rien de connu et pas de délai : « Apparition… »", () => {
    const html = ecran(hud({ killcamPhase: "", reapparitionDans: 0 }), { derniereMort: null, killcamInfo: null });
    expect(html).toContain("Apparition…");
  });

  it("Killcam seule : légende du rejeu, sans pseudo si le tueur est inconnu", () => {
    const html = renderToStaticMarkup(createElement(Killcam, { phase: "rejeu", progression: 0.5, tueur: null, derniereMort: null, surPasser: rien }));
    expect(html).toContain("vue de");
    expect(html).toContain(">Agent<");
    expect(html).toContain("Passer");
  });
});

describe("SelecteurCoin / ReglageInterface (rendu statique)", () => {
  it("sélecteur de coin : radiogroup, cinq radios, un seul coché et dans l'ordre de tabulation", () => {
    const html = renderToStaticMarkup(createElement(SelecteurCoin, { coin: "bd", surChange: rien, idGroupe: "t" }));
    expect(html).toContain('role="radiogroup"');
    expect(compte(html, /role="radio"/g)).toBe(5);
    expect(compte(html, /aria-checked="true"/g)).toBe(1);
    expect(compte(html, /tabindex="0"/g)).toBe(1);
    expect(html).toMatch(/data-coin="bd"[^>]*>/);
    for (const nom of ["Haut-gauche", "Haut-droite", "Bas-gauche", "Bas-droite", "Masquée"]) expect(html).toContain(nom);
  });

  it("masquée cochée", () => {
    const html = renderToStaticMarkup(createElement(SelecteurCoin, { coin: "off", surChange: rien, idGroupe: "t" }));
    expect(html).toMatch(/aria-checked="true"[^>]*>Masquée</);
  });

  it("interface dépliée : coin, taille, orientation, rayon, échelle, effets", () => {
    const html = renderToStaticMarkup(createElement(ReglageInterface, { reglages: REGLAGES_HUD_DEFAUT, surReglages: rien }));
    expect(html).toContain("<section");
    expect(html).toContain("Taille de la mini-carte");
    expect(html).toContain("Suit ma vue");
    expect(html).toContain(`100${NBSP}m`);
    expect(html).toContain(`115${NBSP}%`);
    expect(html).toContain("Réduits");
    // M, regard (défaut), 100 m, 100 %, auto : un radio coché par groupe
    expect(compte(html, /type="radio"[^>]*checked=""/g)).toBe(5);
  });

  it("interface repliée (lobby) : <details> fermé", () => {
    const html = renderToStaticMarkup(createElement(ReglageInterface, { reglages: REGLAGES_HUD_DEFAUT, surReglages: rien, replie: true }));
    expect(html).toMatch(/^<details/);
    expect(html).not.toContain(" open");
    expect(html).toContain("<summary>Interface</summary>");
  });
});
