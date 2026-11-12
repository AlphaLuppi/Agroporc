import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAUT_CONFIG, REGLAGES_DEFAUT, type ConfigMatch, type HudRocket, type LigneClassement, type ResultatMatch, type StatsVoiture } from "./contrat";
import FinRocket from "../../app/components/rocket/FinRocket";
import HudRocketUi, { JaugeBoost } from "../../app/components/rocket/HudRocket";
import LobbyRocket from "../../app/components/rocket/LobbyRocket";
import MenuPauseRocket from "../../app/components/rocket/MenuPauseRocket";
import PanneauReglagesRocket from "../../app/components/rocket/PanneauReglagesRocket";
import TableauRocket from "../../app/components/rocket/TableauRocket";
import HudReseauRocket from "../../app/components/rocket/HudReseauRocket";
import LobbyRocketEnLigne from "../../app/components/rocket/LobbyRocketEnLigne";
import PanneauRocket from "../../app/components/rocket/PanneauRocket";
import type { ActionsSalonRocket } from "../../app/components/rocket/useSalonRocket";
import { appliquerConnexion, appliquerMessage, etatLobbyInitial, type EtatLobbyEnLigne } from "./reseau/lobby-en-ligne";
import { REGLAGES_SALON_DEFAUT, type EtatSalon, type HudReseau, type JoueurSalon, type ResumeSalle } from "./reseau/protocole";

/** Rendu serveur de l'interface de Rocket Muche (comme `lib/resto-badge.test.ts`) : rôles, radios natives, jauge, dialogues. */

const rien = () => {};
const noms = { bleue: "Les Trèfles", orange: "Les Tigres" };
const stats = (points: number, buts = 0): StatsVoiture => ({ buts, passes: 0, arrets: 0, tirs: 0, demolitions: 0, demolie: 0, touches: 0, points });
const ligne = (id: number, equipe: "bleue" | "orange", points: number, nom = `J${id}`): LigneClassement => ({ id, nom, equipe, humain: id === 0, stats: stats(points) });
const resultat = (over: Partial<ResultatMatch> = {}): ResultatMatch => ({
  vainqueur: "bleue", score: { bleue: 3, orange: 2 }, prolongation: false, equipeJoueur: "bleue",
  classement: [ligne(0, "bleue", 320, "Agent"), ligne(1, "bleue", 100, "Bot A"), ligne(2, "orange", 210, "Bot B")], mvp: 0, ...over,
});
const hud = (over: Partial<HudRocket> = {}): HudRocket => ({
  phase: "enJeu", score: { bleue: 1, orange: 2 }, nomsEquipes: noms, tempsRestant: 125.4, prolongation: false, decompte: null, boost: 64.4, vitesseKmh: 82.6,
  supersonique: false, demolie: false, reapparitionDans: 0, equipeJoueur: "bleue", balleCam: true, banniere: null, fil: [], enPause: false, manette: false,
  aide: false, classement: [], resultat: null, ...over,
});

const lobby = (over: Partial<Parameters<typeof LobbyRocket>[0]> = {}, config: Partial<ConfigMatch> = {}) =>
  renderToStaticMarkup(createElement(LobbyRocket, {
    config: { ...DEFAUT_CONFIG(), ...config }, surConfig: rien, reglages: REGLAGES_DEFAUT(), surReglages: rien, surLancer: rien, surFermer: rien, tactile: false, manette: false, ...over,
  }));
const hudHtml = (h: HudRocket | null, over: Partial<Parameters<typeof HudRocketUi>[0]> = {}) =>
  renderToStaticMarkup(createElement(HudRocketUi, {
    hud: h, reglages: REGLAGES_DEFAUT(), surReglages: rien, surReprendre: rien, surRecommencer: rien, surQuitter: rien, surQuitterVue: rien, ...over,
  }));
const radios = (html: string, nom: string) => Array.from(html.matchAll(new RegExp(`<input[^>]*type="radio"[^>]*name="[^"]*-${nom}"[^>]*>`, "g"))).map((m) => m[0]);

describe("LobbyRocket", () => {
  it("formats, équipes, niveaux et durées sont des radios natives dans des fieldset", () => {
    const html = lobby();
    expect(html).toContain('aria-label="Rocket Muche"');
    expect(radios(html, "format")).toHaveLength(3);
    expect(radios(html, "equipe")).toHaveLength(2);
    expect(radios(html, "allies")).toHaveLength(3);
    expect(radios(html, "adversaires")).toHaveLength(3);
    expect(radios(html, "duree")).toHaveLength(4);
    for (const l of ["Format", "Votre équipe", "Niveau de vos coéquipiers", "Niveau des adversaires", "Durée"]) expect(html).toMatch(new RegExp(`<legend>${l}</legend>`));
    for (const t of ["1v1", "2v2", "3v3", "Débutant", "Pro", "All-Star", "Les Trèfles", "Les Tigres", "3 min", "5 min", "7 min", "10 min"]) expect(html).toContain(t);
  });

  it("coche la valeur courante de chaque groupe", () => {
    const html = lobby({}, { format: "3v3", equipeJoueur: "orange", niveauAdversaires: "allstar", dureeS: 420 });
    expect(radios(html, "format").filter((r) => r.includes("checked")).map((r) => /value="([^"]+)"/.exec(r)![1])).toEqual(["3v3"]);
    expect(radios(html, "equipe").filter((r) => r.includes("checked")).map((r) => /value="([^"]+)"/.exec(r)![1])).toEqual(["orange"]);
    expect(radios(html, "adversaires").filter((r) => r.includes("checked")).map((r) => /value="([^"]+)"/.exec(r)![1])).toEqual(["allstar"]);
    expect(radios(html, "duree").filter((r) => r.includes("checked")).map((r) => /value="([^"]+)"/.exec(r)![1])).toEqual(["420"]);
  });

  it("en 1v1 il n'y a pas de coéquipier à régler", () => {
    const html = lobby({}, { format: "1v1" });
    expect(radios(html, "allies")).toHaveLength(0);
    expect(html).toContain("Niveau de l&#x27;adversaire");
    expect(html).toContain("Vous contre 1 bot");
  });

  it("« Lancer » porte la configuration dans son libellé et dans son infobulle", () => {
    const html = lobby();
    expect(html).toMatch(/<button[^>]*title="2v2 · Pro · 5 min"[^>]*>Lancer<span> · 2v2 · Pro · 5 min<\/span><\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Lancer/);
  });

  it("tactile sans manette : lancement bloqué et raison écrite ; avec une manette il est permis", () => {
    const bloque = lobby({ tactile: true, manette: false });
    expect(bloque).toMatch(/<button[^>]*disabled=""[^>]*>Lancer/);
    expect(bloque).toContain("clavier ou à la manette");
    const permis = lobby({ tactile: true, manette: true });
    expect(permis).not.toMatch(/<button[^>]*disabled=""[^>]*>Lancer/);
    expect(permis).not.toContain("branchez une manette");
  });

  it("le nom de joueur est un champ étiqueté, bornés à 16 caractères", () => {
    const html = lobby({}, { nomJoueur: "Léa" });
    expect(html).toMatch(/<label for="[^"]+-nom">Nom de joueur<\/label>/);
    expect(html).toMatch(/<input[^>]*maxLength="16"[^>]*value="Léa"|<input[^>]*value="Léa"[^>]*maxLength="16"/);
  });

  it("réglages et aide sont repliés (aucun details ouvert) et l'aide donne les touches du joueur", () => {
    const html = lobby();
    expect(html.match(/<details/g)!.length).toBe(2);
    expect(html).not.toContain("<details open");
    expect(html).toContain("<summary>Réglages</summary>");
    expect(html).toContain("<summary>Aide</summary>");
    expect(html).toContain("<kbd>Espace</kbd>");
    expect(html).toContain("<kbd>W A S D</kbd>");
  });

  it("le message d'erreur du dernier lancement est annoncé", () => {
    expect(lobby({ erreur: "WebGL indisponible" })).toMatch(/<p[^>]*role="alert"[^>]*>WebGL indisponible<\/p>/);
    expect(lobby()).not.toContain('role="alert"');
  });
});

describe("PanneauReglagesRocket : liaisons", () => {
  const panneau = (r = REGLAGES_DEFAUT()) => renderToStaticMarkup(createElement(PanneauReglagesRocket, { reglages: r, surReglages: rien }));
  it("liste les touches et les boutons de la manette, une zone d'état annoncée et des boutons natifs", () => {
    const html = panneau();
    expect(html).toMatch(/<p[^>]*role="status"[^>]*aria-live="polite"|<p[^>]*aria-live="polite"[^>]*role="status"/);
    expect(html).toContain("<legend>Clavier et souris</legend>");
    expect(html).toContain("<legend>Boutons de la manette</legend>");
    // 17 actions de clavier hors pause (un seul emplacement libre pour la pause) ; 23 actions de manette
    const emplacements = html.match(/aria-pressed="false"/g) ?? [];
    expect(emplacements.length).toBe((17 * 2 + 1) + (22 * 2 + 1));
    expect(html).toContain('aria-label="Sauter, double saut, flip, entrée 1 : Espace. Changer"');
    expect(html).toContain('aria-label="Boost (maintenu), entrée 1 : Maj gauche. Changer"');
    expect(html).toContain('aria-label="Sauter, double saut, flip, entrée 1 : A. Changer"');
    expect(html).toContain('aria-label="Accélérer, entrée 1 : RT. Changer"');
    expect(html).toContain('aria-label="Volant à gauche (en l&#x27;air : lacet), entrée 1 : Stick gauche ←. Changer"');
    expect(html).toContain('aria-label="Regard libre (maintenu, puis bouger la souris), entrée 1 : Clic milieu. Changer"');
    // un emplacement vide est dit vide
    expect(html).toContain("entrée 2 : aucune. Changer");
  });
  it("Échap et Start sont affichés, fixes, sur la pause", () => {
    const html = panneau();
    expect(html).toMatch(/<span[^>]*title="Échap ouvre toujours la pause"[^>]*>Échap<\/span>/);
    expect(html).toMatch(/<span[^>]*title="Start ouvre toujours la pause"[^>]*>Start<\/span>/);
  });
  it("les boutons de rétablissement sont grisés aux défauts, actifs sinon", () => {
    const html = panneau();
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Rétablir les touches par défaut/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Rétablir la manette par défaut/);
    const r = REGLAGES_DEFAUT();
    r.touches = { ...r.touches, saut: ["KeyJ"] };
    r.liaisonsManette = { ...r.liaisonsManette, saut: ["B5"], klaxon: [] };
    const html2 = panneau(r);
    expect(html2).not.toMatch(/<button[^>]*disabled=""[^>]*>Rétablir les touches par défaut/);
    expect(html2).not.toMatch(/<button[^>]*disabled=""[^>]*>Rétablir la manette par défaut/);
    expect(html2).toContain('aria-label="Sauter, double saut, flip, entrée 1 : J. Changer"');
    expect(html2).toContain('aria-label="Sauter, double saut, flip, entrée 1 : RB. Changer"');
    expect(html2).toContain("Sans entrée : Klaxon.");
  });
  it("une action sans touche est signalée", () => {
    const r = REGLAGES_DEFAUT();
    r.touches = { ...r.touches, klaxon: [] };
    expect(panneau(r)).toContain("Sans touche : Klaxon.");
    expect(panneau()).not.toContain("Sans touche");
  });
});

describe("PanneauReglagesRocket", () => {
  it("expose les sept curseurs de la caméra de Rocket League, dans ses unités", () => {
    const html = renderToStaticMarkup(createElement(PanneauReglagesRocket, { reglages: REGLAGES_DEFAUT(), surReglages: rien }));
    expect((html.match(/type="range"/g) ?? []).length).toBe(7 + 1 + 1);
    for (const l of ["Champ de vision", "Distance", "Hauteur", "Angle", "Rigidité", "Vitesse du regard", "Vitesse de transition", "Volume", "Zone morte des sticks"]) expect(html).toContain(l);
    expect(html).toContain('aria-valuetext="110°"');
    expect(html).toContain('aria-valuetext="270"');
    expect(html).toContain('aria-valuetext="100"');
    expect(html).toContain('aria-valuetext="-4°"');
    expect(html).toContain('aria-valuetext="0,45"');
    expect(html).toContain('aria-valuetext="70 %"');
  });
  it("le bouton de rétablissement est grisé quand la caméra est celle de Rocket League", () => {
    const html = renderToStaticMarkup(createElement(PanneauReglagesRocket, { reglages: REGLAGES_DEFAUT(), surReglages: rien }));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Rétablir la caméra/);
    const r = REGLAGES_DEFAUT();
    r.camera = { ...r.camera, fov: 90 };
    expect(renderToStaticMarkup(createElement(PanneauReglagesRocket, { reglages: r, surReglages: rien }))).not.toMatch(/<button[^>]*disabled=""[^>]*>Rétablir la caméra/);
  });
});

describe("PanneauReglagesRocket : réactions rapides", () => {
  it("une case à cocher native pour les réactions des adversaires, cochée par défaut", () => {
    const html = renderToStaticMarkup(createElement(PanneauReglagesRocket, { reglages: REGLAGES_DEFAUT(), surReglages: rien }));
    expect(html).toContain("<legend>Réactions rapides</legend>");
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""[^>]*\/>\s*Afficher les réactions des adversaires/);
    const off = renderToStaticMarkup(createElement(PanneauReglagesRocket, { reglages: { ...REGLAGES_DEFAUT(), reactionsAdversaires: false }, surReglages: rien }));
    expect(off).not.toMatch(/<input[^>]*type="checkbox"[^>]*checked=""[^>]*\/>\s*Afficher les réactions des adversaires/);
  });
  it("les quatre réactions sont des emplacements de liaison, clavier et manette", () => {
    const html = renderToStaticMarkup(createElement(PanneauReglagesRocket, { reglages: REGLAGES_DEFAUT(), surReglages: rien }));
    expect(html).toContain("Infos d&#x27;équipe (haut)");
    expect(html).toContain("Excuses (bas)");
    expect(html).toContain("Croix ↑");
  });
});

describe("HudRocket : réactions rapides", () => {
  const chat = (over: Partial<NonNullable<HudRocket["chat"]>> = {}): NonNullable<HudRocket["chat"]> => ({ menu: null, lignes: [], bloqueS: 0, ...over });
  const menu = {
    categorie: "reactions", titre: "Réactions",
    choix: [
      { direction: "haut" as const, id: "tie-un-tigre", texte: "Tié un tigre ?!", equipeSeule: false },
      { direction: "gauche" as const, id: "trefle", texte: "Ça sent le trèfle à 4 feuilles", equipeSeule: false },
      { direction: "droite" as const, id: "en-marche", texte: "En marche ! Mais vers où ?", equipeSeule: false },
      { direction: "bas" as const, id: "rugissement", texte: "RRRROAAAR !", equipeSeule: false },
    ],
  };
  it("une région vivante polie est toujours là, vide tant que personne n'a parlé ; pas de menu fermé", () => {
    const html = hudHtml(hud({ chat: chat() }));
    expect(html).toMatch(/<ul[^>]*role="log"[^>]*aria-live="polite"/);
    expect(html).not.toContain('role="group" aria-label="Réactions rapides');
  });
  it("le menu ouvert montre les quatre messages avec les touches réelles du joueur", () => {
    const html = hudHtml(hud({ chat: chat({ menu }) }));
    expect(html).toContain('aria-label="Réactions rapides : Réactions"');
    for (const t of ["Tié un tigre ?!", "Ça sent le trèfle à 4 feuilles", "RRRROAAAR !"]) expect(html).toContain(t);
    for (const k of ["<kbd", ">1<", ">2<", ">3<", ">4<"]) expect(html).toContain(k);
    expect(html).not.toContain("Croix");
    expect(hudHtml(hud({ manette: true, chat: chat({ menu }) }))).toContain("1 · Croix ↑");
  });
  it("le fil colore le nom par équipe et marque les infos d'équipe ; le lecteur d'écran a une phrase complète", () => {
    const html = hudHtml(hud({
      chat: chat({ lignes: [
        { id: 1, nom: "Alice", texte: "J'ai la balle !", equipe: "bleue", equipeSeule: true, moi: false },
        { id: 2, nom: "Bot A", texte: "RRRROAAAR !", equipe: "orange", equipeSeule: false, moi: false },
      ] }),
    }));
    expect(html).toMatch(/<li[^>]*data-equipe="bleue"/);
    expect(html).toMatch(/<li[^>]*data-equipe="orange"/);
    expect(html).toContain("Alice, à l&#x27;équipe : J&#x27;ai la balle !");
    expect(html).toContain("(équipe)");
  });
  it("le chat bloqué est annoncé ; rien à l'écran de fin ; un HUD sans `chat` (ancien) reste valide", () => {
    expect(hudHtml(hud({ chat: chat({ bloqueS: 3 }) }))).toContain("Chat bloqué : 3 s");
    expect(hudHtml(hud({ chat: chat({ lignes: [{ id: 1, nom: "A", texte: "x", equipe: "bleue", equipeSeule: false, moi: false }] }), resultat: resultat() }))).not.toContain('role="log"');
    expect(() => hudHtml(hud())).not.toThrow();
  });
  it("l'aide brève des 8 premières secondes cite les réactions", () => {
    expect(hudHtml(hud({ aide: true }))).toContain("Réactions rapides");
  });
});

describe("HudRocket", () => {
  it("avant la première image : message de chargement annoncé", () => {
    expect(hudHtml(null)).toMatch(/role="status"[^>]*>Chargement du stade/);
  });

  it("score, noms d'équipes et minuteur", () => {
    const html = hudHtml(hud());
    expect(html).toMatch(/role="group" aria-label="Score"/);
    expect(html).toMatch(/data-equipe="bleue"[^>]*><b[^>]*>1<\/b><span[^>]*>Les Trèfles<\/span>/);
    expect(html).toMatch(/data-equipe="orange"[^>]*><b[^>]*>2<\/b><span[^>]*>Les Tigres<\/span>/);
    expect(html).toMatch(/role="timer" aria-label="Temps restant">2:06</);
  });

  it("minuteur ambre sous 30 s, PROLONGATION en mort subite", () => {
    expect(hudHtml(hud({ tempsRestant: 12 }))).toContain('data-urgent="oui"');
    expect(hudHtml(hud({ tempsRestant: 120 }))).not.toContain("data-urgent");
    const p = hudHtml(hud({ tempsRestant: 0, prolongation: true }));
    expect(p).toContain("PROLONGATION");
    expect(p).toContain('data-prolongation="oui"');
  });

  it("jauge de boost : role=meter 0..100, 100 graduations dont 64 allumées, chiffre au centre", () => {
    const html = renderToStaticMarkup(createElement(JaugeBoost, { boost: 64.4, equipe: "bleue" }));
    expect(html).toMatch(/role="meter"[^>]*aria-label="Boost"[^>]*aria-valuemin="0"[^>]*aria-valuemax="100"[^>]*aria-valuenow="64"/);
    expect((html.match(/<line /g) ?? []).length).toBe(100);
    const classes = Array.from(html.matchAll(/<line [^>]*class="([^"]*)"/g)).map((m) => m[1]);
    expect(new Set(classes).size).toBeLessThanOrEqual(2);
    expect(html).toMatch(/<b[^>]*>64<\/b>/);
  });
  it("jauge vide : valeur 0 et marqueur", () => {
    const html = renderToStaticMarkup(createElement(JaugeBoost, { boost: 0, equipe: "orange" }));
    expect(html).toContain('aria-valuenow="0"');
    expect(html).toContain('data-vide="oui"');
  });
  it("jauge : valeurs hors bornes ramenées dans 0..100", () => {
    expect(renderToStaticMarkup(createElement(JaugeBoost, { boost: 250, equipe: "bleue" }))).toContain('aria-valuenow="100"');
    expect(renderToStaticMarkup(createElement(JaugeBoost, { boost: Number.NaN, equipe: "bleue" }))).toContain('aria-valuenow="0"');
  });

  it("vitesse en km/h et supersonique", () => {
    expect(hudHtml(hud())).toMatch(/<b>83<\/b> km\/h/);
    expect(hudHtml(hud({ supersonique: true }))).toContain("supersonique");
  });

  it("bannière : texte, sous-texte, équipe ; masquée aux lecteurs d'écran (l'annonce vocale la double)", () => {
    const html = hudHtml(hud({ banniere: { id: 7, texte: "BUT !", sousTexte: "Agent · passe de Bot A", equipe: "bleue", dureeS: 3 } }));
    expect(html).toMatch(/aria-hidden="true"[^>]*>|data-equipe="bleue"[^>]*aria-hidden="true"/);
    expect(html).toContain("BUT !");
    expect(html).toContain("Agent · passe de Bot A");
  });
  it("décompte : repli sur la valeur du HUD quand aucune bannière n'est envoyée", () => {
    const html = hudHtml(hud({ phase: "decompte", decompte: 3 }));
    expect(html).toMatch(/data-decompte="oui"/);
    expect(html).toMatch(/>3<\/span>/);
  });

  it("région d'annonce vocale polie, vide au départ", () => {
    expect(hudHtml(hud())).toMatch(/<p[^>]*role="status" aria-live="polite" aria-atomic="true"><\/p>/);
  });

  it("fil d'évènements, indicateur de caméra et manette", () => {
    const html = hudHtml(hud({ fil: [{ id: 1, texte: "Agent a marqué", equipe: "bleue" }, { id: 2, texte: "Démolition !", equipe: null }], balleCam: false, manette: true }));
    expect(html).toContain('aria-label="Évènements du match"');
    expect(html).toContain("Agent a marqué");
    expect(html).toContain("Démolition !");
    expect(html).toContain("VOITURE");
    expect(html).toContain("Manette connectée");
    expect(hudHtml(hud({ balleCam: true }))).toContain("BALLE");
  });

  it("voiture démolie : réapparition annoncée", () => {
    expect(hudHtml(hud({ demolie: true, reapparitionDans: 1.4 }))).toContain("Démolie · réapparition dans 2 s");
    expect(hudHtml(hud())).not.toContain("Démolie");
  });

  it("aide des touches seulement pendant les 8 premières secondes, avec les touches du joueur", () => {
    const html = hudHtml(hud({ aide: true }));
    expect(html).toContain('aria-label="Aide des touches"');
    expect(html).toContain("<kbd>Espace</kbd>");
    expect(hudHtml(hud({ aide: false }))).not.toContain('aria-label="Aide des touches"');
    expect(hudHtml(hud({ aide: true, enPause: true }))).not.toContain('aria-label="Aide des touches"');
  });

  it("tableau (Tab) : un vrai tableau, par équipe, mais pas sous le menu pause ni à la fin", () => {
    const c = [ligne(0, "bleue", 120), ligne(1, "orange", 60)];
    const html = hudHtml(hud({ classement: c }));
    expect(html).toContain("<table");
    expect(html).toContain("Les Trèfles (votre équipe)");
    expect(hudHtml(hud())).not.toContain("<table");
    expect(hudHtml(hud({ classement: c, enPause: true }))).not.toContain('aria-label="Classement des joueurs"');
  });

  it("bouton Pause : seulement si le parent le permet, en partie, hors pause", () => {
    expect(hudHtml(hud(), { surPause: rien })).toMatch(/<button[^>]*>Pause<\/button>/);
    expect(hudHtml(hud())).not.toMatch(/<button[^>]*>Pause<\/button>/);
    expect(hudHtml(hud({ enPause: true }), { surPause: rien })).not.toMatch(/<button[^>]*>Pause<\/button>/);
  });

  it("en pause : dialogue modal avec Reprendre, Recommencer, Quitter", () => {
    const html = hudHtml(hud({ enPause: true }));
    expect(html).toMatch(/role="dialog" aria-modal="true" aria-labelledby="[^"]+"/);
    expect(html).toContain(">Pause</h2>");
    for (const b of ["Reprendre", "Recommencer", "Réglages", "Aide des touches", "Quitter", "Quitter vers Agroparc"]) expect(html).toMatch(new RegExp(`<button[^>]*>${b}</button>`));
  });

  it("fin de match : dialogue avec Rejouer et Quitter, pas de menu pause", () => {
    const html = hudHtml(hud({ phase: "fini", resultat: resultat(), enPause: true }));
    expect(html).toMatch(/role="dialog" aria-modal="true"/);
    expect(html).toContain(">Victoire !</h2>");
    expect(html).toMatch(/<button[^>]*>Rejouer<\/button>/);
    expect(html).toMatch(/<button[^>]*>Quitter<\/button>/);
    expect(html).not.toContain(">Pause</h2>");
    expect(html).not.toMatch(/<button[^>]*>Pause<\/button>/);
  });
});

describe("MenuPauseRocket", () => {
  it("note Échap = reprendre, et Start si une manette est branchée", () => {
    const rendre = (manette: boolean) => renderToStaticMarkup(createElement(MenuPauseRocket, {
      reglages: REGLAGES_DEFAUT(), surReglages: rien, surReprendre: rien, surRecommencer: rien, surQuitter: rien, surQuitterVue: rien, manette,
    }));
    expect(rendre(false)).toContain("Échap reprend la partie.");
    expect(rendre(false)).not.toContain("Start");
    expect(rendre(true)).toContain("Start sur la manette");
  });
});

describe("FinRocket", () => {
  const rendre = (r: ResultatMatch) => renderToStaticMarkup(createElement(FinRocket, { resultat: r, nomsEquipes: noms, surRejouer: rien, surQuitter: rien }));
  it("victoire : score, MVP et tableau complet", () => {
    const html = rendre(resultat());
    expect(html).toContain("Victoire !");
    expect(html).toMatch(/<b>3<\/b> Les Trèfles/);
    expect(html).toMatch(/<b>2<\/b> Les Tigres/);
    expect(html).toContain("Meilleur joueur");
    expect(html).toContain("<b>Agent</b>");
    expect(html).toContain("320 points");
    expect(html).toContain("Bot B");
    expect(html).toContain('data-issue="victoire"');
  });
  it("défaite, prolongation et égalité", () => {
    expect(rendre(resultat({ vainqueur: "orange" }))).toContain(">Défaite</h2>");
    expect(rendre(resultat({ prolongation: true }))).toContain("Décidé en prolongation");
    expect(rendre(resultat({ vainqueur: null }))).toContain(">Égalité</h2>");
    expect(rendre(resultat({ mvp: null }))).not.toContain("Meilleur joueur");
  });
});

describe("TableauRocket", () => {
  it("en-têtes de colonnes accessibles, joueurs triés par points dans leur équipe", () => {
    const html = renderToStaticMarkup(createElement(TableauRocket, {
      lignes: [ligne(1, "bleue", 50, "Petit"), ligne(0, "bleue", 90, "Grand"), ligne(2, "orange", 10, "Tigre")], nomsEquipes: noms, equipeJoueur: "bleue",
    }));
    for (const l of ["Points", "Buts", "Passes décisives", "Arrêts", "Tirs cadrés", "Démolitions"]) expect(html).toContain(`aria-label="${l}"`);
    expect(html.indexOf("Grand")).toBeLessThan(html.indexOf("Petit"));
    expect(html.indexOf("Les Trèfles")).toBeLessThan(html.indexOf("Les Tigres"));
    expect(html).toContain("(vous)");
  });
  it("n'affiche pas une équipe sans joueur", () => {
    const html = renderToStaticMarkup(createElement(TableauRocket, { lignes: [ligne(0, "bleue", 5)], nomsEquipes: noms, equipeJoueur: "bleue" }));
    expect(html).not.toContain("Les Tigres");
  });
});

describe("chargement : rien de lourd dans le premier chargement du menu", () => {
  const racine = join(__dirname, "..", "..");
  /** imports statiques « valeur » d'un fichier (les `import type` sont effacés à la compilation) */
  const importsStatiques = (src: string): string[] =>
    Array.from(src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)).map((m) => m[1]);

  it("Agroparc3D.tsx ne charge le jeu que par import() dynamique", () => {
    const src = readFileSync(join(racine, "app/components/Agroparc3D.tsx"), "utf8");
    const statiques = importsStatiques(src);
    expect(statiques.filter((i) => /lib\/rocket\/(jeu|rendu|sons|camera|entrees)/.test(i))).toEqual([]);
    expect(statiques).not.toContain("three");
    expect(src).toContain('import("@/lib/rocket/jeu")');
  });

  it("les composants de app/components/rocket n'importent ni three ni le jeu", () => {
    const dossier = join(racine, "app/components/rocket");
    const fichiers = readdirSync(dossier).filter((f) => /\.(tsx?|ts)$/.test(f));
    expect(fichiers.length).toBeGreaterThanOrEqual(8);
    for (const f of fichiers) {
      const imports = importsStatiques(readFileSync(join(dossier, f), "utf8"));
      expect(imports.filter((i) => i === "three" || i.startsWith("three/")), f).toEqual([]);
      expect(imports.filter((i) => /lib\/rocket\/(jeu|rendu|rendu-\w+|sons|camera|entrees|match|bots|voiture|contacts|balle|arene)$/.test(i)), f).toEqual([]);
    }
  });

  it("ChoixMode et le protocole ne connaissent pas Rocket Muche (ModeSalle inchangé)", () => {
    for (const f of ["app/components/arene/ChoixMode.tsx", "lib/fps/protocole.ts"]) {
      expect(readFileSync(join(racine, f), "utf8").toLowerCase(), f).not.toContain("rocket");
    }
  });
});

// ============================================================================================================================
// Mode en ligne
// ============================================================================================================================

const jSalon = (id: number, equipe: "bleue" | "orange", over: Partial<JoueurSalon> = {}): JoueurSalon => ({ id, nom: `J${id}`, equipe, hote: id === 0, connecte: true, charge: false, ...over });
const unSalon = (over: Partial<EtatSalon> = {}): EtatSalon => ({
  code: "BCDF", phase: "salon", reglages: REGLAGES_SALON_DEFAUT(), joueurs: [jSalon(0, "bleue")], placesParEquipe: 1, lancable: false, raisonNonLancable: "Il manque un joueur.", ...over,
});
const ouvert = (): EtatLobbyEnLigne => appliquerConnexion(etatLobbyInitial(), "ouverte");
/** état d'un joueur `moi` dans le salon `s` */
const dansSalon = (s: EtatSalon, moi = 0): EtatLobbyEnLigne => appliquerMessage(appliquerMessage(ouvert(), { t: "bienvenue", v: 1, joueur: moi, maintenantMs: 0 }), { t: "salon", salon: s });
const actions: ActionsSalonRocket = { creer: rien, rejoindre: rien, quitter: rien, choisirEquipe: rien, regler: rien, lancer: rien, retourSalon: rien, actualiser: rien, reessayer: rien };
const ligneEnLigne = (etat: EtatLobbyEnLigne, over: Partial<Parameters<typeof LobbyRocketEnLigne>[0]> = {}) =>
  renderToStaticMarkup(createElement(LobbyRocketEnLigne, {
    etat, actions, nom: "Léa", surNom: rien, reglages: REGLAGES_SALON_DEFAUT(), surReglages: rien, surFermer: rien, tactile: false, manette: false, ...over,
  }));
const hudRes = (over: Partial<HudReseau> = {}): HudReseau => ({ etat: "ouverte", rttMs: 42, gigueMs: 3, qualite: "bonne", commandes: "actives", absents: [], revanche: null, ...over });

describe("LobbyRocketEnLigne : sans salon", () => {
  const partie = (code: string, over: Partial<ResumeSalle> = {}): ResumeSalle => ({ code, hote: "Max", format: "1v1", dureeS: 300, niveauBots: "pro", humains: 1, places: 2, ...over });

  it("contrat DOM : Créer une partie, champ « Code de la partie » étiqueté, bouton « Rejoindre » exact", () => {
    const html = ligneEnLigne(ouvert());
    expect(html).toContain('aria-label="Rocket Muche en ligne"');
    expect(html).toMatch(/<button[^>]*>Créer une partie<\/button>/);
    expect(html).toMatch(/<label for="([^"]+)">Code de la partie<\/label>/);
    const id = /<label for="([^"]+)">Code de la partie<\/label>/.exec(html)![1];
    expect(html).toMatch(new RegExp(`<input[^>]*id="${id.replace(/[:]/g, "\\:")}"[^>]*maxLength="4"|<input[^>]*maxLength="4"[^>]*id="${id.replace(/[:]/g, "\\:")}"`));
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Rejoindre<\/button>/);
  });
  it("le nom de joueur est un champ étiqueté borné à 16", () => {
    const html = ligneEnLigne(ouvert());
    expect(html).toMatch(/<label for="[^"]+">Nom de joueur<\/label>/);
    expect(html).toMatch(/maxLength="16"/);
    expect(html).toContain('value="Léa"');
  });
  it("« Rejoindre » du champ est grisé tant que le code est incomplet ; les boutons de liste s'appellent « Rejoindre la partie ABCD »", () => {
    const etat = appliquerMessage(ouvert(), { t: "liste", parties: [partie("TVWX"), partie("BCDF")] });
    const html = ligneEnLigne(etat);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*type="submit"[^>]*>Rejoindre<\/button>|<button[^>]*type="submit"[^>]*disabled=""[^>]*>Rejoindre<\/button>/);
    expect(html).toContain('aria-label="Rejoindre la partie BCDF"');
    expect(html).toContain('aria-label="Rejoindre la partie TVWX"');
    // aucun bouton de la liste n'a pour nom accessible exactement « Rejoindre »
    for (const m of html.matchAll(/<button[^>]*aria-label="([^"]+)"/g)) expect(m[1]).not.toBe("Rejoindre");
    expect(html.indexOf("BCDF")).toBeLessThan(html.indexOf("TVWX"));
    expect(html).toContain("Parties ouvertes");
  });
  it("la liste n'est pas dans une région vivante et chaque ligne a une clé stable", () => {
    const etat = appliquerMessage(ouvert(), { t: "liste", parties: [partie("BCDF")] });
    const html = ligneEnLigne(etat);
    const liste = html.slice(html.indexOf('aria-labelledby'), html.indexOf("</section>", html.indexOf('aria-labelledby')));
    expect(liste).not.toContain("aria-live");
    expect(liste).not.toContain('role="status"');
    expect(html).toContain('data-rocket-partie="BCDF"');
  });
  it("liste vide ou pas encore reçue : message neutre", () => {
    expect(ligneEnLigne(ouvert())).toContain("Recherche des parties…");
    expect(ligneEnLigne(appliquerMessage(ouvert(), { t: "liste", parties: [] }))).toContain("Aucune partie ouverte");
  });
  it("une partie pleine ne peut pas être rejointe", () => {
    const html = ligneEnLigne(appliquerMessage(ouvert(), { t: "liste", parties: [partie("BCDF", { humains: 2 })] }));
    expect(html).toMatch(/<button[^>]*aria-label="Rejoindre la partie BCDF"[^>]*disabled=""|<button[^>]*disabled=""[^>]*aria-label="Rejoindre la partie BCDF"/);
  });
  it("tactile sans manette : création et entrée bloquées, raison écrite", () => {
    const html = ligneEnLigne(ouvert(), { tactile: true });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Créer une partie/);
    expect(html).toContain("clavier ou à la manette");
    expect(ligneEnLigne(ouvert(), { tactile: true, manette: true })).not.toMatch(/<button[^>]*disabled=""[^>]*>Créer une partie/);
  });
  it("une demande en cours grise Créer", () => {
    expect(ligneEnLigne({ ...ouvert(), attente: "creer" })).toMatch(/<button[^>]*disabled=""[^>]*>Créer une partie/);
  });
});

describe("LobbyRocketEnLigne : états d'erreur", () => {
  it("serveur injoignable : texte, alerte vocale pour le statut, bouton Réessayer", () => {
    const html = ligneEnLigne(appliquerConnexion(etatLobbyInitial(), "fermee", "injoignable"));
    expect(html).toContain("Serveur injoignable");
    expect(html).toMatch(/<button[^>]*>Réessayer<\/button>/);
    expect(html).not.toContain("Créer une partie");
    expect(html).toMatch(/role="status"/);
  });
  it("version refusée : demande de recharger la page", () => {
    const html = ligneEnLigne(appliquerConnexion(etatLobbyInitial(), "refusee", "version"));
    expect(html).toContain("rechargez la page");
    expect(html).toMatch(/<button[^>]*>Réessayer<\/button>/);
  });
  it("connexion en cours ou reconnexion : pas de bouton, texte d'attente", () => {
    expect(ligneEnLigne(appliquerConnexion(etatLobbyInitial(), "connexion"))).toContain("Connexion au serveur…");
    const re = ligneEnLigne(appliquerConnexion(etatLobbyInitial(), "reconnexion"));
    expect(re).toContain("reconnexion");
    expect(re).not.toContain("Réessayer");
  });
  it("code inconnu, salle pleine : message d'alerte du refus", () => {
    let e = appliquerMessage(ouvert(), { t: "refus", action: "rejoindre", raison: "inconnue" });
    expect(ligneEnLigne(e)).toMatch(/<p[^>]*role="alert"[^>]*>Aucune partie ne porte ce code\.<\/p>/);
    e = appliquerMessage(ouvert(), { t: "refus", action: "rejoindre", raison: "pleine" });
    expect(ligneEnLigne(e)).toContain("La partie est complète.");
  });
  it("le message d'information d'un salon refermé n'est pas une alerte", () => {
    const e = appliquerMessage(dansSalon(unSalon()), { t: "salon", salon: null, raison: "expire" });
    const html = ligneEnLigne(e);
    expect(html).toContain("Le salon a été fermé");
    expect(html).not.toContain('role="alert"');
  });
  it("l'erreur de lancement du jeu (WebGL) reste annoncée", () => {
    expect(ligneEnLigne(ouvert(), { erreur: "WebGL indisponible" })).toMatch(/role="alert"[^>]*>WebGL indisponible/);
  });
});

describe("LobbyRocketEnLigne : dans un salon", () => {
  it("contrat DOM : code en grand, lignes de joueurs, Lancer la partie (hôte), radios de format", () => {
    const html = ligneEnLigne(dansSalon(unSalon()));
    expect(html).toMatch(/<strong[^>]*data-rocket-code=""[^>]*>BCDF<\/strong>/);
    expect(html).toMatch(/data-rocket-joueur=""/);
    expect((html.match(/data-rocket-joueur=""/g) ?? []).length).toBe(1);
    expect(html).toMatch(/<button[^>]*>Lancer la partie<\/button>/);
    const formats = radios(html, "format");
    expect(formats).toHaveLength(3);
    for (const f of ["1v1", "2v2", "3v3"]) expect(html).toContain(f);
    expect(formats.filter((r) => r.includes("checked")).map((r) => /value="([^"]+)"/.exec(r)![1])).toEqual(["1v1"]);
    expect(html).toContain("Copier le code");
  });
  it("code épelé pour les lecteurs d'écran, hors de l'élément du contrat (son texte reste le code seul)", () => {
    const html = ligneEnLigne(dansSalon(unSalon()));
    expect(html).toContain("épelé : B C D F");
    expect(html).not.toMatch(/data-rocket-code=""[^>]*>[^<]*[ ,][^<]*</);
  });
  it("hôte seul : Lancer grisé avec sa raison, deux équipes, une place libre tenue par un bot", () => {
    const html = ligneEnLigne(dansSalon(unSalon()));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Lancer la partie<\/button>/);
    expect(html).toContain("Il manque un joueur.");
    expect(html).toContain("Les Trèfles");
    expect(html).toContain("Les Tigres");
    expect(html).toContain("Place libre · bot");
    expect(html).toContain("Passer dans cette équipe");
    expect(html).toContain("Vous contre 1 bot");
    expect(html).toMatch(/<button[^>]*>Quitter le salon<\/button>/);
  });
  it("à deux : Lancer devient possible, « Vous contre 1 joueur »", () => {
    const html = ligneEnLigne(dansSalon(unSalon({ joueurs: [jSalon(0, "bleue"), jSalon(1, "orange")], lancable: true, raisonNonLancable: undefined })));
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Lancer la partie/);
    expect(html).toContain("Vous contre 1 joueur");
    expect((html.match(/data-rocket-joueur=""/g) ?? []).length).toBe(2);
    expect(html).toContain(">vous<");
    expect(html).toContain(">hôte<");
  });
  it("l'invité ne voit ni Lancer ni les radios : réglages en lecture seule et attente de l'hôte", () => {
    const e = dansSalon(unSalon({ joueurs: [jSalon(0, "bleue"), jSalon(1, "orange")], lancable: true }), 1);
    const html = ligneEnLigne(e);
    expect(html).not.toMatch(/<button[^>]*>Lancer la partie<\/button>/);
    expect(html).toContain("En attente de l&#x27;hôte");
    expect(radios(html, "format")).toHaveLength(0);
    expect(html).toContain("Réglages choisis par l&#x27;hôte : 1v1 · Pro · 5 min");
    expect(html).toMatch(/<button[^>]*>Quitter le salon<\/button>/);
  });
  it("2v2 : places libres des deux camps et note sur les bots", () => {
    const s = unSalon({ reglages: { ...REGLAGES_SALON_DEFAUT(), format: "2v2" }, placesParEquipe: 2 });
    const html = ligneEnLigne(dansSalon(s));
    expect((html.match(/Place libre · bot/g) ?? []).length).toBe(3);
    expect(html).toContain("3 places libres seront tenues par des bots");
  });
  it("radios natives dans des fieldset, durée et niveau des bots, case de visibilité", () => {
    const html = ligneEnLigne(dansSalon(unSalon()));
    for (const l of ["Format", "Niveau des bots", "Durée"]) expect(html).toMatch(new RegExp(`<legend>${l}</legend>`));
    expect(radios(html, "niveau")).toHaveLength(3);
    expect(radios(html, "duree")).toHaveLength(4);
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""|<input[^>]*checked=""[^>]*type="checkbox"/);
    expect(html).toContain("Visible dans la liste des parties ouvertes");
  });
  it("chargement : progression des joueurs prêts, pas de bouton Lancer", () => {
    const s = unSalon({ phase: "chargement", joueurs: [jSalon(0, "bleue", { charge: true }), jSalon(1, "orange")], lancable: true });
    const html = ligneEnLigne(dansSalon(s));
    expect(html).toMatch(/role="status"[^>]*>Chargement… 1\/2 prêt</);
    expect(html).not.toContain("Lancer la partie");
    expect(html).toContain("data-rocket-code");
  });
  it("joueur déconnecté signalé", () => {
    const html = ligneEnLigne(dansSalon(unSalon({ joueurs: [jSalon(0, "bleue"), jSalon(1, "orange", { connecte: false })] })));
    expect(html).toContain("déconnecté");
  });
});

describe("PanneauRocket", () => {
  const enLigne = { etat: ouvert(), actions, nom: "Léa", surNom: rien, reglages: REGLAGES_SALON_DEFAUT(), surReglages: rien, surFermer: rien, tactile: false, manette: false };
  const panneau = (mode: "local" | "ligne") => renderToStaticMarkup(createElement(PanneauRocket, { mode, surMode: rien, enLigne }, createElement("aside", { "data-lobby-local": "oui" }, "Lobby local")));

  it("deux radios natives « Hors ligne » et « En ligne » ; la valeur courante est cochée", () => {
    const html = panneau("local");
    const r = radios(html, "mode");
    expect(r).toHaveLength(2);
    expect(html).toContain("Hors ligne");
    expect(html).toContain("En ligne");
    expect(r.filter((x) => x.includes("checked")).map((x) => /value="([^"]+)"/.exec(x)![1])).toEqual(["local"]);
    expect(radios(panneau("ligne"), "mode").filter((x) => x.includes("checked")).map((x) => /value="([^"]+)"/.exec(x)![1])).toEqual(["ligne"]);
  });
  it("hors ligne : le lobby historique est rendu tel quel, au-dessous du commutateur", () => {
    const html = panneau("local");
    expect(html).toContain('data-lobby-local="oui"');
    expect(html.indexOf("Hors ligne")).toBeLessThan(html.indexOf("data-lobby-local"));
  });
  it("le lobby historique n'est pas modifié : mêmes radios et même bouton Lancer qu'avant", () => {
    const html = renderToStaticMarkup(createElement(PanneauRocket, { mode: "local", surMode: rien, enLigne }, createElement(LobbyRocket, {
      config: DEFAUT_CONFIG(), surConfig: rien, reglages: REGLAGES_DEFAUT(), surReglages: rien, surLancer: rien, surFermer: rien, tactile: false, manette: false,
    })));
    expect(radios(html, "format")).toHaveLength(3);
    expect(html).toMatch(/<button[^>]*>Lancer<span> · 2v2 · Pro · 5 min<\/span><\/button>/);
  });
});

describe("HudReseauRocket", () => {
  it("contrat DOM : [data-rocket-reseau] avec ping, état et commandes", () => {
    const html = renderToStaticMarkup(createElement(HudReseauRocket, { reseau: hudRes({ rttMs: 41.6, commandes: "menu" }) }));
    expect(html).toContain('data-rocket-reseau=""');
    expect(html).toContain('data-ping="42"');
    expect(html).toContain('data-etat="ouverte"');
    expect(html).toContain('data-commandes="menu"');
    expect(html).toContain("42 ms · Bonne");
  });
  it("la qualité a une forme en plus de la couleur", () => {
    const f = (q: HudReseau["qualite"]) => renderToStaticMarkup(createElement(HudReseauRocket, { reseau: hudRes({ qualite: q }) }));
    expect(f("bonne")).toContain("●●●");
    expect(f("moyenne")).toContain("●●○");
    expect(f("mauvaise")).toContain("●○○");
  });
  it("commandes suspendues : dites en texte, dans une région vivante polie", () => {
    const html = renderToStaticMarkup(createElement(HudReseauRocket, { reseau: hudRes({ commandes: "masque" }) }));
    expect(html).toContain("Commandes suspendues : onglet masqué");
    expect(html).toMatch(/role="status" aria-live="polite"/);
    expect(renderToStaticMarkup(createElement(HudReseauRocket, { reseau: hudRes() }))).not.toContain("Commandes suspendues");
  });
  it("reconnexion et connexion perdue annoncées sans ping", () => {
    expect(renderToStaticMarkup(createElement(HudReseauRocket, { reseau: hudRes({ etat: "reconnexion" }) }))).toContain("Reconnexion…");
    expect(renderToStaticMarkup(createElement(HudReseauRocket, { reseau: hudRes({ etat: "fermee" }) }))).toContain("Connexion perdue");
  });
  it("joueur coupé : bandeau avec son nom, compte à rebours muet pour les lecteurs d'écran", () => {
    const html = renderToStaticMarkup(createElement(HudReseauRocket, { reseau: hudRes({ absents: [{ joueur: 1, nom: "Max", restantMs: 13_200 }] }) }));
    expect(html).toContain("Max : connexion perdue");
    expect(html).toMatch(/aria-hidden="true">, reprise possible dans 14 s</);
  });
  it("avant la première mesure : la pastille existe quand même", () => {
    const html = renderToStaticMarkup(createElement(HudReseauRocket, { reseau: null }));
    expect(html).toContain("data-rocket-reseau");
    expect(html).toContain('data-etat="connexion"');
  });
});

describe("HudRocket et fin de match en ligne", () => {
  const enLigneProps = (over: Record<string, unknown> = {}) => ({ reseau: hudRes(), humains: 2, hote: true, surRetourSalon: rien, ...over });
  const lignes = [ligne(0, "bleue", 100, "Léa"), ligne(1, "orange", 80, "Max"), ligne(2, "orange", 10, "Bot")].map((l) => ({ ...l, humain: l.id < 2 }));

  it("hors ligne (aucune prop en ligne) : aucune pastille réseau, HUD inchangé", () => {
    expect(hudHtml(hud())).not.toContain("data-rocket-reseau");
  });
  it("en ligne : la pastille réseau est montée", () => {
    const html = hudHtml(hud(), { enLigne: enLigneProps(), moi: 0 });
    expect(html).toContain("data-rocket-reseau");
    expect(html).toContain("42 ms · Bonne");
  });
  it("« (vous) » suit l'id de ma voiture : avec deux humains, seul moi est désigné", () => {
    const c = hud({ classement: lignes });
    const pour = (moi: number) => hudHtml(c, { enLigne: enLigneProps(), moi });
    const moi1 = pour(1);
    expect((moi1.match(/\(vous\)/g) ?? []).length).toBe(1);
    expect(moi1).toMatch(/Max \(vous\)/);
    expect(moi1).not.toMatch(/Léa \(vous\)/);
    expect(hudHtml(c)).toMatch(/Léa \(vous\)/);
  });
  it("menu pause en ligne : le jeu continue, pas de « Recommencer », « Quitter la partie »", () => {
    const html = hudHtml(hud({ enPause: true }), { enLigne: enLigneProps({ reseau: hudRes({ commandes: "menu" }) }), moi: 0 });
    expect(html).toContain("Le jeu continue en ligne. Vos commandes sont suspendues.");
    expect(html).not.toMatch(/<button[^>]*>Recommencer<\/button>/);
    expect(html).toMatch(/<button[^>]*>Quitter la partie<\/button>/);
    expect(html).toMatch(/<button[^>]*>Reprendre<\/button>/);
    expect(html).toMatch(/<button[^>]*>Réglages<\/button>/);
    expect(html).toContain("data-commandes=\"menu\"");
  });
  it("menu pause hors ligne : inchangé (Recommencer, Quitter)", () => {
    const html = hudHtml(hud({ enPause: true }));
    expect(html).toMatch(/<button[^>]*>Recommencer<\/button>/);
    expect(html).toMatch(/<button[^>]*>Quitter<\/button>/);
    expect(html).not.toContain("Le jeu continue en ligne");
  });
  it("fin de match en ligne : Revanche, Retour au salon pour l'hôte, Quitter", () => {
    const html = hudHtml(hud({ phase: "fini", resultat: resultat({ classement: lignes }) }), { enLigne: enLigneProps(), moi: 0 });
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Revanche/);
    expect(html).toMatch(/<button[^>]*>Retour au salon<\/button>/);
    expect(html).toMatch(/<button[^>]*>Quitter<\/button>/);
    expect(html).not.toMatch(/<button[^>]*>Rejouer<\/button>/);
  });
  it("l'invité n'a pas « Retour au salon »", () => {
    const html = hudHtml(hud({ phase: "fini", resultat: resultat({ classement: lignes }) }), { enLigne: enLigneProps({ hote: false }), moi: 1 });
    expect(html).not.toContain("Retour au salon");
    expect(html).toMatch(/<button[^>]*>Revanche/);
  });
  it("revanche : compte des votes, mon vote reconnu", () => {
    const reseau = hudRes({ revanche: { votes: { 0: true }, restantMs: 30_000 } });
    const html = hudHtml(hud({ phase: "fini", resultat: resultat({ classement: lignes }) }), { enLigne: enLigneProps({ reseau }), moi: 0 });
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Revanche/);
    expect(html).toContain(" 1/2");
    expect(html).toContain("Revanche demandée : 1/2 joueurs, 30 s pour décider.");
    const autre = hudHtml(hud({ phase: "fini", resultat: resultat({ classement: lignes }) }), { enLigne: enLigneProps({ reseau }), moi: 1 });
    expect(autre).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Revanche/);
    expect(autre).toContain("1/2 joueurs veulent une revanche, 30 s pour décider.");
  });
  it("l'issue est relue pour MON équipe : le résultat brut du serveur donne la victoire à l'orange", () => {
    const brut = resultat({ vainqueur: "orange", equipeJoueur: "bleue", classement: lignes });
    expect(hudHtml(hud({ phase: "fini", resultat: brut, equipeJoueur: "orange" }), { enLigne: enLigneProps(), moi: 1 })).toContain(">Victoire !</h2>");
    expect(hudHtml(hud({ phase: "fini", resultat: brut, equipeJoueur: "bleue" }), { enLigne: enLigneProps(), moi: 0 })).toContain(">Défaite</h2>");
  });
  it("fin de match hors ligne : Rejouer et Quitter comme avant", () => {
    const html = hudHtml(hud({ phase: "fini", resultat: resultat() }));
    expect(html).toMatch(/<button[^>]*>Rejouer<\/button>/);
    expect(html).not.toContain("Revanche");
  });
});

describe("chargement : le mode en ligne n'entre pas dans le premier chargement du menu", () => {
  const racine = join(__dirname, "..", "..");
  const importsStatiques = (src: string): string[] =>
    Array.from(src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)).map((m) => m[1]);
  /** seuls modules de lib/rocket/reseau/ importables statiquement par l'interface (liste blanche) */
  const AUTORISES = ["lobby-en-ligne", "protocole"];
  const reseauDe = (imports: string[]) => imports.filter((i) => /rocket\/reseau\//.test(i)).map((i) => i.replace(/^.*rocket\/reseau\//, ""));

  it("Agroparc3D.tsx : de lib/rocket/reseau/ seulement lobby-en-ligne et protocole", () => {
    const imports = importsStatiques(readFileSync(join(racine, "app/components/Agroparc3D.tsx"), "utf8"));
    const reseau = reseauDe(imports);
    expect(reseau.length).toBeGreaterThan(0);
    for (const m of reseau) expect(AUTORISES, m).toContain(m);
  });
  it("les composants de app/components/rocket : même liste blanche, jamais le client, le codec, la prédiction ni la salle", () => {
    const dossier = join(racine, "app/components/rocket");
    for (const f of readdirSync(dossier).filter((x) => /\.(tsx?|ts)$/.test(x))) {
      const src = readFileSync(join(dossier, f), "utf8");
      for (const m of reseauDe(importsStatiques(src))) expect(AUTORISES, `${f} importe ${m}`).toContain(m);
      for (const m of ["client", "serialisation", "salle", "registre", "horloge", "prediction", "monde-ligne", "limiteur", "validation", "outils-reseau"]) {
        expect(importsStatiques(src).some((i) => i.endsWith(`reseau/${m}`)), `${f} : import statique de ${m}`).toBe(false);
      }
    }
  });
  it("le client réseau n'est chargé que par import() dans le hook", () => {
    const hook = readFileSync(join(racine, "app/components/rocket/useSalonRocket.ts"), "utf8");
    expect(hook).toContain('import("@/lib/rocket/reseau/client")');
    expect(importsStatiques(hook).some((i) => i.includes("reseau/client"))).toBe(false);
  });
  it("le lobby en ligne passe par next/dynamic depuis PanneauRocket", () => {
    const panneau = readFileSync(join(racine, "app/components/rocket/PanneauRocket.tsx"), "utf8");
    expect(panneau).toContain("next/dynamic");
    expect(panneau).toContain('import("./LobbyRocketEnLigne")');
    expect(importsStatiques(panneau).some((i) => i.includes("LobbyRocketEnLigne"))).toBe(false);
  });
  it("jeu.ts reste le seul module qui importe le client réseau, le codec et la prédiction", () => {
    const jeu = importsStatiques(readFileSync(join(racine, "lib/rocket/jeu.ts"), "utf8"));
    expect(jeu.some((i) => i.endsWith("reseau/prediction"))).toBe(true);
    expect(jeu.some((i) => i.endsWith("reseau/client"))).toBe(false);
  });
});
