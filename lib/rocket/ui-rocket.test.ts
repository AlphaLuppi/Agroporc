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
    // 13 actions de clavier hors pause (un seul emplacement libre pour la pause) ; 19 actions de manette
    const emplacements = html.match(/aria-pressed="false"/g) ?? [];
    expect(emplacements.length).toBe((13 * 2 + 1) + (18 * 2 + 1));
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
