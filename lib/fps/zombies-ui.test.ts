import { beforeEach, describe, expect, it } from "vitest";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ChoixMode from "../../app/components/arene/ChoixMode";
import LobbyZombies from "../../app/components/arene/LobbyZombies";
import Arene from "../../app/components/arene/Arene";
import BandeauManche from "../../app/components/arene/hud/BandeauManche";
import BarreVague from "../../app/components/arene/hud/BarreVague";
import BlocArgent from "../../app/components/arene/hud/BlocArgent";
import BlocArmes from "../../app/components/arene/hud/BlocArmes";
import EcranMort from "../../app/components/arene/hud/EcranMort";
import FinDePartieZombies from "../../app/components/arene/hud/FinDePartieZombies";
import InvitesAction from "../../app/components/arene/hud/InvitesAction";
import MenuPause from "../../app/components/arene/hud/MenuPause";
import TableauZombies from "../../app/components/arene/hud/TableauZombies";
import { commandes } from "../../app/components/arene/hud/AideCommandes";
import {
  CARTES_MODE, REGLES_ZOMBIES, TEXTE_MODE_INDISPONIBLE, TEXTE_PARTIE_EN_COURS, TEXTE_ZOMBIES, commandesLobbyZombies, compteurMode, etiquetteEtatZombies, flecheReserveeAuChamp, situationLobbyZombies, texteEffectif,
} from "../../app/components/arene/lobby-modele";
import type { Salons } from "../../app/components/arene/contrats";
import {
  CLE_RECORD_ZOMBIES, NBSP, RECORD_ZOMBIES_VIDE, ZONE_PORTE, annoncesZombies, evaluerRecordZombies, formatArgent, formatDecimal, libelleGain, libelleTigres, libelleVague, lireRecordZombies,
  majRecordZombies, manqueInvite, memeEtatZombiesHud, secondesAvant, texteRefusAchat,
} from "./hud-modele";
import { formatDureePartie, lignesBilanZombies, totauxBilanZombies } from "./classement";
import type { HudEtat, EtatZombiesHud } from "./jeu-types";
import type { EtatPartieZombies, JoueurZombies } from "./protocole";
import { REGLAGES_HUD_DEFAUT } from "./reglages-hud";
import { touchesParDefaut, type Stockage } from "./touches";
import { ZOMBIES } from "./zombies-vagues";

// ---------- fabriques ----------

const joueur = (id: string, pseudo: string, plus: Partial<JoueurZombies> = {}): JoueurZombies => ({
  id, pseudo, couleur: "#aabbcc", etat: "attente", admis: false, kills: 0, gagne: 0, reanimations: 0, atouts: [], autoReleves: 3, ...plus,
});
const partie = (plus: Partial<EtatPartieZombies> = {}): EtatPartieZombies => ({
  phase: "lobby", manche: 0, hote: "j1", capacite: 8, debutT: 0, finT: 0,
  joueurs: [joueur("j1", "Lea"), joueur("j2", "Marc")], portes: [{ id: "D1", ouverte: false }, { id: "D2", ouverte: false }],
  difficulte: "plat", courant: false, boite: { emplacement: 0, etat: "fermee", finT: 0, utilisations: 0 }, pap: { etat: "libre" }, fenetres: [],
  bonus: [], effets: { instakillFinT: 0, doubleFinT: 0, soldesFinT: 0 },
  secret: { etape: 0, pendules: 0, pendulesT: 0, periodeMidiMs: 300_000, ardoise: [0, 1, 2, 3], casseroles: 0, marmite: 0, billot: 0, postits: [1, 2, 3, 4, 5, 6, 7, 8], ecrans: 0 },
  mancheTruck: false, truck: null, murs: [], ...plus,
});
const salons: Salons = { arene: { joueurs: 5, enJeu: 3 }, zombies: { phase: "lobby", joueurs: 2, manche: 0 } };

function stockageFaux(initial: Record<string, string> = {}): Stockage & { magasin: Record<string, string> } {
  const magasin = { ...initial };
  return {
    magasin,
    getItem: (k) => magasin[k] ?? null,
    setItem: (k, v) => { magasin[k] = v; },
    removeItem: (k) => { delete magasin[k]; },
  };
}

const HUD: HudEtat = {
  pv: 100, bouclier: 0, arme: "pistolet", slot: "secondaire", slots: "secondaire:pistolet:12:12:60|couteau:couteau:0:0", equipSuivant: "mitraillette|pistolet",
  munitions: 12, chargeur: 12, reserve: 60, recharge: false, degainage: false, vise: false, lunette: false, zoomX: 0, zoomNiveau: -1, zoomNiveaux: 0, viseur: "fer", ameliorees: "", munitionsG: -1, ecartViseur: 0,
  distanceVisee: -1, mur: false, mort: false, reapparitionDans: 0, protege: false, protegeRestant: 0, verrouille: true, connecte: true, entracte: false, accroupi: false,
  glisse: false, regen: false, bonusVitesse: 1, invite: "", inviteDetail: "", vehicule: false, vehiculeId: -1, siege: -1, tireInterdit: false, embarquement: false,
  killcam: -1, killcamPhase: "", sort: false, voix: "", voixParlants: "", titan: false, mode: "zombies", argent: 500, manche: 3, restants: 12, aTerre: false, elimine: false,
  invitePrix: 0, inviteAssez: true, reanime: false,
};
const hud = (plus: Partial<HudEtat> = {}): HudEtat => ({ ...HUD, ...plus });

describe("formatArgent et libellés", () => {
  it("« 1 250 $ » avec espaces insécables, jamais coupé", () => {
    const t = formatArgent(1250);
    expect(t).toMatch(/^1[  ]250 \$$/);
    expect(formatArgent(0)).toBe(`0${NBSP}$`);
    expect(formatArgent(499.6)).toBe(`500${NBSP}$`);
  });

  it("tigres restants : pluriel, singulier, aucun", () => {
    expect(libelleTigres(12)).toBe(`12${NBSP}TIGRES`);
    expect(libelleTigres(1)).toBe(`1${NBSP}TIGRE`);
    expect(libelleTigres(0)).toBe("AUCUN TIGRE");
    expect(libelleTigres(-3)).toBe("AUCUN TIGRE");
  });

  it("libellé de vague par phase : manche, pause avec décompte, fin, lobby", () => {
    expect(libelleVague("manche", 7, 12, 0)).toEqual({ titre: "MANCHE 7", detail: `12${NBSP}TIGRES`, pause: false });
    const pause = libelleVague("pause", 8, 0, 7);
    expect(pause.titre).toBe("MANCHE 8");
    expect(pause.detail).toBe(`PAUSE · DÉPART DANS 7${NBSP}s`);
    expect(pause.pause).toBe(true);
    expect(libelleVague("fin", 7, 0, 0).detail).toBe("PARTIE PERDUE");
    expect(libelleVague("lobby", 0, 0, 0).titre).toBe("ZOMBIES");
  });

  it("décompte entier arrondi au-dessus, jamais négatif", () => {
    expect(secondesAvant(10_000, 2_100)).toBe(8);
    expect(secondesAvant(10_000, 9_999)).toBe(1);
    expect(secondesAvant(10_000, 12_000)).toBe(0);
  });

  it("gain d'argent : signe, montant et motif écrits", () => {
    expect(libelleGain(60, "kill")).toBe(`+60${NBSP}$ · kill`);
    expect(libelleGain(-950, "achat")).toBe(`−950${NBSP}$ · achat`);
    expect(libelleGain(10, "touche")).toBe(`+10${NBSP}$ · touche`);
    expect(libelleGain(225, "manche")).toBe(`+225${NBSP}$ · fin de manche`);
    expect(libelleGain(0, "kill")).toBe("");
    expect(libelleGain(5, "inconnu")).toBe(`+5${NBSP}$`);
  });

  it("refus d'achat : un texte pour chaque raison (jamais la couleur seule)", () => {
    expect(texteRefusAchat("argent")).toBe("Argent insuffisant");
    for (const r of ["argent", "loin", "deja", "verrou", "partie"] as const) expect(texteRefusAchat(r).length).toBeGreaterThan(5);
    expect(new Set((["argent", "loin", "deja", "verrou", "partie"] as const).map(texteRefusAchat)).size).toBe(5);
  });

  it("précision d'invite : « Argent insuffisant » sauf si le détail dit déjà pourquoi", () => {
    expect(manqueInvite("Pompe — 900 $", false)).toBe("Argent insuffisant");
    expect(manqueInvite("Pompe — 900 $", true)).toBe("");
    expect(manqueInvite("Porte verrouillée — 1 250 $", false)).toBe("");
    expect(manqueInvite("Soin — prêt dans 12 s", false)).toBe("");
  });
});

describe("état du HUD des zombies", () => {
  const base: EtatZombiesHud = {
    argent: 500, manche: 2, restants: 8, vivants: 4, gain: null, refus: null, achats: 0, reanimation: null, aTerre: false, elimine: false, terreFinT: 0, partie: null,
    pvMax: 100, note: null, annonce: null, serveurT: 0, objectif: "", reparation: null,
  };

  it("même état : pas de rendu ; un champ affiché qui change : rendu", () => {
    expect(memeEtatZombiesHud(base, { ...base })).toBe(true);
    expect(memeEtatZombiesHud(null, null)).toBe(true);
    expect(memeEtatZombiesHud(base, null)).toBe(false);
    expect(memeEtatZombiesHud(base, { ...base, argent: 510 })).toBe(false);
    expect(memeEtatZombiesHud(base, { ...base, restants: 7 })).toBe(false);
    expect(memeEtatZombiesHud(base, { ...base, gain: { n: 1, delta: 10, motif: "touche" } })).toBe(false);
    expect(memeEtatZombiesHud(base, { ...base, refus: { n: 1, id: "P1", raison: "argent" } })).toBe(false);
    expect(memeEtatZombiesHud(base, { ...base, partie: partie() })).toBe(false);
  });

  it("la relève ne rend que par pas de 5 %", () => {
    const a = { ...base, reanimation: { cible: "j2", progression: 0.51 } };
    expect(memeEtatZombiesHud(a, { ...a, reanimation: { cible: "j2", progression: 0.52 } })).toBe(true);
    expect(memeEtatZombiesHud(a, { ...a, reanimation: { cible: "j2", progression: 0.6 } })).toBe(false);
    expect(memeEtatZombiesHud(a, { ...a, reanimation: { cible: "j3", progression: 0.51 } })).toBe(false);
    expect(memeEtatZombiesHud(a, { ...a, reanimation: null })).toBe(false);
  });
});

describe("record local", () => {
  it("lecture : absent, illisible ou mal formé = record vide", () => {
    expect(lireRecordZombies(null)).toEqual(RECORD_ZOMBIES_VIDE);
    expect(lireRecordZombies(stockageFaux())).toEqual(RECORD_ZOMBIES_VIDE);
    expect(lireRecordZombies(stockageFaux({ [CLE_RECORD_ZOMBIES]: "pas du json" }))).toEqual(RECORD_ZOMBIES_VIDE);
    expect(lireRecordZombies(stockageFaux({ [CLE_RECORD_ZOMBIES]: JSON.stringify({ manche: -4, kills: "x" }) }))).toEqual(RECORD_ZOMBIES_VIDE);
    expect(lireRecordZombies(stockageFaux({ [CLE_RECORD_ZOMBIES]: JSON.stringify({ manche: 7, kills: 52 }) }))).toEqual({ manche: 7, kills: 52 });
  });

  it("battu seulement par une manche plus haute, ou autant de manches et plus de tigres", () => {
    const ancien = { manche: 7, kills: 50 };
    expect(evaluerRecordZombies(ancien, 8, 1)).toEqual({ record: { manche: 8, kills: 1 }, battu: true });
    expect(evaluerRecordZombies(ancien, 7, 51).battu).toBe(true);
    expect(evaluerRecordZombies(ancien, 7, 50).battu).toBe(false);
    expect(evaluerRecordZombies(ancien, 6, 99)).toEqual({ record: ancien, battu: false });
    expect(evaluerRecordZombies(RECORD_ZOMBIES_VIDE, 0, 0).battu).toBe(false);
    expect(evaluerRecordZombies(RECORD_ZOMBIES_VIDE, 3, 10).battu).toBe(true);
    // aucun tigre abattu : pas de record, même au premier essai
    expect(evaluerRecordZombies(RECORD_ZOMBIES_VIDE, 1, 0)).toEqual({ record: RECORD_ZOMBIES_VIDE, battu: false });
  });

  it("l'enregistrement n'écrit que si le record est battu ; un stockage qui refuse est toléré", () => {
    const s = stockageFaux();
    expect(majRecordZombies(s, 4, 20).battu).toBe(true);
    expect(JSON.parse(s.magasin[CLE_RECORD_ZOMBIES])).toEqual({ manche: 4, kills: 20 });
    expect(majRecordZombies(s, 3, 99).battu).toBe(false);
    expect(JSON.parse(s.magasin[CLE_RECORD_ZOMBIES])).toEqual({ manche: 4, kills: 20 });
    const casse: Stockage = { getItem: () => null, setItem: () => { throw new Error("quota"); }, removeItem: () => {} };
    expect(() => majRecordZombies(casse, 5, 1)).not.toThrow();
    expect(() => majRecordZombies(null, 5, 1)).not.toThrow();
  });
});

describe("annonces entre deux états de la partie", () => {
  it("aucune annonce au premier état", () => {
    expect(annoncesZombies(null, partie({ phase: "manche", manche: 1 }), "j1")).toEqual([]);
  });

  it("début de manche, une fois par manche", () => {
    const pause = partie({ phase: "pause", manche: 2 });
    const manche = partie({ phase: "manche", manche: 2 });
    expect(annoncesZombies(pause, manche, "j1")).toEqual(["Manche 2"]);
    expect(annoncesZombies(manche, partie({ phase: "manche", manche: 2 }), "j1")).toEqual([]);
  });

  it("porte ouverte, avec son nom", () => {
    const avant = partie({ phase: "manche", manche: 2 });
    const apres = partie({ phase: "manche", manche: 2, portes: [{ id: "D1", ouverte: true }, { id: "D2", ouverte: false }] });
    expect(annoncesZombies(avant, apres, "j1")).toEqual([`Ouverture : ${ZONE_PORTE.D1}`]);
    expect(ZONE_PORTE.D1).toBe("Porte de la salle de pause");
  });

  it("à terre, relevé, éliminé, retour : moi et les autres", () => {
    const debout = partie({ phase: "manche", manche: 3, joueurs: [joueur("j1", "Lea", { etat: "debout", admis: true }), joueur("j2", "Marc", { etat: "debout", admis: true })] });
    const terre = partie({ phase: "manche", manche: 3, joueurs: [joueur("j1", "Lea", { etat: "terre", admis: true }), joueur("j2", "Marc", { etat: "debout", admis: true })] });
    expect(annoncesZombies(debout, terre, "j1")).toEqual(["Vous êtes à terre : un coéquipier peut vous relever"]);
    expect(annoncesZombies(debout, terre, "j2")).toEqual(["Lea est à terre"]);
    expect(annoncesZombies(terre, debout, "j2")).toEqual(["Lea a été relevé"]);
    expect(annoncesZombies(terre, debout, "j1")).toEqual(["Vous avez été relevé"]);
    const elimine = partie({ phase: "manche", manche: 3, joueurs: [joueur("j1", "Lea", { etat: "elimine", admis: true }), joueur("j2", "Marc", { etat: "debout", admis: true })] });
    expect(annoncesZombies(terre, elimine, "j1")).toEqual(["Vous êtes éliminé : retour à la prochaine pause"]);
    expect(annoncesZombies(terre, elimine, "j2")).toEqual(["Lea est éliminé"]);
    expect(annoncesZombies(elimine, debout, "j1")).toEqual(["Vous revenez en jeu"]);
  });

  it("partie perdue : la manche atteinte", () => {
    const avant = partie({ phase: "manche", manche: 7 });
    const apres = partie({ phase: "fin", manche: 7, bilan: { manche: 7, dureeMs: 600_000 } });
    expect(annoncesZombies(avant, apres, "j1")).toEqual(["Partie perdue : manche 7"]);
  });
});

describe("bilan par joueur", () => {
  const joueurs = [
    joueur("j1", "Lea", { admis: true, etat: "debout", kills: 10, gagne: 1000, reanimations: 1 }),
    joueur("j2", "Marc", { admis: true, etat: "terre", kills: 25, gagne: 2500 }),
    joueur("j3", "Zoe", { admis: false, etat: "attente" }),
    joueur("j4", "Ana", { admis: true, etat: "debout", kills: 10, gagne: 1000, reanimations: 3 }),
  ];

  it("seuls les participants, triés par tigres tués, argent gagné, relèves puis pseudo", () => {
    const l = lignesBilanZombies(joueurs, "j4");
    expect(l.map((x) => x.pseudo)).toEqual(["Marc", "Ana", "Lea"]);
    expect(l.find((x) => x.moi)?.id).toBe("j4");
  });

  it("totaux de l'équipe", () => {
    expect(totauxBilanZombies(lignesBilanZombies(joueurs, null))).toEqual({ kills: 45, gagne: 4500, reanimations: 4 });
    expect(totauxBilanZombies([])).toEqual({ kills: 0, gagne: 0, reanimations: 0 });
  });

  it("durée de partie lisible", () => {
    expect(formatDureePartie(48_000)).toBe(`48${NBSP}s`);
    expect(formatDureePartie(725_000)).toBe(`12${NBSP}min 05${NBSP}s`);
    expect(formatDureePartie(-5)).toBe(`0${NBSP}s`);
  });
});

describe("modèle du lobby des zombies", () => {
  it("deux cartes de mode, l'arène d'abord", () => {
    expect(CARTES_MODE.map((c) => c.mode)).toEqual(["arene", "zombies"]);
    expect(CARTES_MODE.map((c) => c.titre)).toEqual(["Arène", "Zombies tigres"]);
  });

  it("compteurs : tiret sans message, effectifs, manche, salle pleine", () => {
    expect(compteurMode("arene", null)).toBe("—");
    expect(compteurMode("arene", salons)).toBe("5 en ligne · 3 en jeu");
    expect(compteurMode("zombies", salons)).toBe("Lobby · 2/8");
    expect(compteurMode("zombies", { ...salons, zombies: { phase: "manche", joueurs: 3, manche: 4 } })).toBe("Manche 4 · 3/8");
    expect(compteurMode("zombies", { ...salons, zombies: { phase: "fin", joueurs: 3, manche: 4 } })).toBe("Bilan · 3/8");
    expect(compteurMode("zombies", { ...salons, zombies: { phase: "manche", joueurs: 8, manche: 4 } })).toBe("Salle pleine · 8/8");
  });

  it("décimales à la française dans les règles (2,5 m, jamais 2.5)", () => {
    expect(formatDecimal(2.5)).toBe("2,5");
    expect(formatDecimal(3)).toBe("3");
    expect(REGLES_ZOMBIES.join(" ")).toContain("à moins de 2,5 m");
    expect(REGLES_ZOMBIES.join(" ")).not.toMatch(/\d\.\d/);
  });

  it("textes dérivés des constantes du jeu", () => {
    expect(TEXTE_ZOMBIES).toContain(formatArgent(ZOMBIES.argentDepart));
    expect(REGLES_ZOMBIES.join(" ")).toContain(`${ZOMBIES.ravitaillementChargeurs} chargeurs`);
    expect(REGLES_ZOMBIES.join(" ")).toContain(`${Math.round(ZOMBIES.terreMs / 1000)} s`);
    expect(REGLES_ZOMBIES.length).toBeGreaterThanOrEqual(4);
  });

  it("commandes : la touche d'action achète, ouvre et réanime ; le reste est celui de l'arène", () => {
    const z = commandesLobbyZombies(touchesParDefaut());
    expect(z.find((c) => c.libelle.startsWith("Acheter"))?.touches).toBe("E");
    expect(z.some((c) => /voiture/i.test(c.libelle))).toBe(false);
    expect(z.length).toBe(commandes(touchesParDefaut(), null).length - 3);
    expect(z.at(-1)).toEqual({ touches: "G", libelle: "Grenade (maintenir : cuire la mèche)" });
  });

  it("aide en partie : la touche d'action zombies", () => {
    const ligne = (m: "arene" | "zombies") => commandes(touchesParDefaut(), null, m).find(([k]) => k === "E")?.[1] ?? "";
    expect(ligne("zombies")).toMatch(/Acheter.*réanimer/);
    expect(ligne("arene")).toMatch(/voiture/);
    expect(commandes(touchesParDefaut(), null)).toEqual(commandes(touchesParDefaut(), null, "arene"));
  });

  it("situation : hôte, joueur, partie en cours, fin, hors ligne", () => {
    const lobby = partie();
    expect(situationLobbyZombies(lobby, "j1", true)).toMatchObject({ hote: true, peutLancer: true, enCours: false, joueurs: 2, capacite: 8 });
    expect(situationLobbyZombies(lobby, "j2", true)).toMatchObject({ hote: false, peutLancer: false, message: "En attendant l'hôte…" });
    expect(situationLobbyZombies(lobby, "j1", false).peutLancer).toBe(false);
    expect(situationLobbyZombies(null, "j1", true).message).toBe("Connexion à la salle…");
    expect(situationLobbyZombies(partie({ phase: "manche", manche: 3 }), "j1", true)).toMatchObject({ enCours: true, peutLancer: false, message: TEXTE_PARTIE_EN_COURS });
    expect(situationLobbyZombies(partie({ phase: "fin" }), "j1", true).peutLancer).toBe(false);
  });

  it("étiquettes d'état et effectif", () => {
    expect(["attente", "debout", "terre", "elimine"].map((e) => etiquetteEtatZombies(e as never))).toEqual(["attente", "en jeu", "à terre", "éliminé"]);
    expect(texteEffectif(1, 8)).toBe("1 joueur · 1/8");
    expect(texteEffectif(3, 8)).toBe("3 joueurs · 3/8");
  });
});

describe("ChoixMode", () => {
  const rendre = (plus: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(ChoixMode, { mode: "arene", salons, surChoisir: () => {}, ...plus } as never));

  it("deux radios natives dans un groupe, la carte demandée cochée", () => {
    const html = rendre({ mode: "zombies" });
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toMatch(/value="zombies"[^>]*checked=""|checked=""[^>]*value="zombies"/);
    expect(html).toContain("Mode de jeu");
  });

  it("noms et compteurs écrits sur chaque carte", () => {
    const html = rendre();
    expect(html).toContain("Arène");
    expect(html).toContain("Zombies tigres");
    expect(html).toContain("5 en ligne · 3 en jeu");
    expect(html).toContain("Lobby · 2/8");
    expect(rendre({ salons: null })).toContain("—");
  });

  it("hors connexion : le groupe est désactivé", () => {
    expect(rendre({ desactive: true })).toMatch(/<fieldset[^>]*disabled/);
    expect(rendre()).not.toMatch(/<fieldset[^>]*disabled/);
  });

  it("écran tactile : la radio des zombies est désactivée et le dit, l'arène reste choisissable", () => {
    const html = rendre({ indisponibles: ["zombies"] });
    expect(html).toMatch(/<input[^>]*value="zombies"[^>]*disabled|<input[^>]*disabled[^>]*value="zombies"/);
    expect(html).not.toMatch(/<input[^>]*value="arene"[^>]*disabled|<input[^>]*disabled[^>]*value="arene"/);
    expect(html).toContain(TEXTE_MODE_INDISPONIBLE);
    expect(html).not.toContain("Lobby · 2/8");
    expect(rendre()).not.toContain(TEXTE_MODE_INDISPONIBLE);
  });
});

describe("LobbyZombies", () => {
  const rendre = (plus: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(LobbyZombies, {
    etat: "ouvert", monId: "j1", partie: partie(), pseudo: "Lea", surPseudo: () => {}, touches: touchesParDefaut(), reglagesHud: REGLAGES_HUD_DEFAUT, surReglagesHud: () => {},
    surLancer: () => {}, surFermer: () => {}, erreur: null, tactile: false, ...plus,
  } as never));
  /** le <button> qui porte « Lancer la partie » */
  const boutonLancer = (html: string) => [...html.matchAll(/<button[^>]*>[^<]*Lancer la partie/g)].map((m) => m[0])[0];

  it("l'aside « Zombies », le champ « Nom de joueur » et le titre", () => {
    const html = rendre();
    expect(html).toContain('aria-label="Zombies"');
    expect(html).toContain("Nom de joueur");
    expect(html).toContain("Zombies tigres");
    expect(html).not.toContain('aria-label="Arène"');
  });

  it("hôte : « Lancer la partie » actif", () => {
    const html = rendre();
    expect(boutonLancer(html)).toBeDefined();
    expect(boutonLancer(html)).not.toMatch(/disabled/);
    expect(html).toContain("Vous êtes l&#x27;hôte");
  });

  it("joueur qui n'est pas l'hôte : bouton désactivé et « En attendant l'hôte… »", () => {
    const html = rendre({ monId: "j2" });
    expect(boutonLancer(html)).toMatch(/disabled/);
    expect(html).toContain("En attendant l&#x27;hôte…");
  });

  it("nom trop court : même l'hôte ne peut pas lancer, la raison est écrite", () => {
    const html = rendre({ pseudo: "L" });
    expect(boutonLancer(html)).toMatch(/disabled/);
    expect(html).toContain("Au moins 2 lettres ou chiffres.");
  });

  it("liste par ordre d'arrivée : puces de couleur, badge hôte, état, « (vous) »", () => {
    const complet = rendre({ monId: "j2", pseudo: "Marc" });
    const html = complet.slice(complet.indexOf('aria-label="Joueurs'));
    expect(html.indexOf("Lea")).toBeLessThan(html.indexOf("Marc"));
    expect(html.match(/>hôte</g)).toHaveLength(1);
    expect(html.indexOf(">hôte<")).toBeLessThan(html.indexOf("Marc"));
    expect(html).toContain("(vous)");
    expect(html).toContain("--couleur:#aabbcc");
    expect(html).toContain(">attente<");
  });

  it("capacité X/8", () => {
    expect(rendre()).toContain("</b>/8 joueurs");
    expect(rendre()).toContain("2 joueurs · 2/8");
  });

  it("partie en cours : le nouvel arrivant attend la prochaine pause, sans pouvoir lancer", () => {
    const html = rendre({ partie: partie({ phase: "manche", manche: 4, joueurs: [joueur("j1", "Lea", { etat: "debout", admis: true }), joueur("j2", "Marc")] }), monId: "j2" });
    expect(html).toContain("Partie en cours : vous entrerez à la prochaine pause.");
    expect(boutonLancer(html)).toMatch(/disabled/);
    expect(html).toContain(">en jeu<");
  });

  it("règles et commandes (touche d'action : acheter, ouvrir, réanimer)", () => {
    const html = rendre();
    expect(html).toContain("Règles");
    for (const r of REGLES_ZOMBIES) expect(html).toContain(r.replace(/'/g, "&#x27;"));
    expect(html).toContain("Acheter, ouvrir une porte, réanimer (maintenir)");
    expect(html).not.toContain("Monter dans une voiture");
  });

  it("avant le premier état de la salle : « Connexion à la salle… », rien ne se lance", () => {
    const html = rendre({ partie: null });
    expect(html).toContain("Connexion à la salle…");
    expect(boutonLancer(html)).toMatch(/disabled/);
    expect(html).toContain("Personne pour l&#x27;instant.");
  });

  it("tactile : message d'indisponibilité, pas de bouton", () => {
    const html = rendre({ tactile: true });
    expect(html).toContain("clavier et à la souris");
    expect(html).not.toContain("Lancer la partie");
  });

  it("serveur injoignable ou erreur : écrits", () => {
    expect(rendre({ etat: "erreur", monId: null })).toContain("Serveur injoignable");
    expect(rendre({ erreur: "La partie de zombies est pleine." })).toContain('role="alert"');
  });

  it("le choix du mode se pose sous le titre ; l'arène le reçoit aussi (props optionnels)", () => {
    const choix = createElement("div", { id: "choix-mode" });
    const html = rendre({ choixMode: choix });
    expect(html.indexOf("Zombies tigres")).toBeLessThan(html.indexOf('id="choix-mode"'));
    const arene = renderToStaticMarkup(createElement(Arene, {
      etat: "ouvert", monId: "j1", joueurs: [], match: null, pseudo: "Lea", surPseudo: () => {}, equipement: { principale: "fusil_assaut", secondaire: "revolver" },
      surEquipement: () => {}, touches: touchesParDefaut(), reglagesHud: REGLAGES_HUD_DEFAUT, surReglagesHud: () => {}, surEntrer: () => {}, surFermer: () => {},
      erreur: null, tactile: false, choixMode: choix,
    }));
    expect(arene).toContain('id="choix-mode"');
    expect(arene).toContain('aria-label="Arène"');
    expect(arene).toContain("Entrer dans l&#x27;arène");
  });
});

describe("BarreVague", () => {
  const rendre = (plus: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(BarreVague, {
    phase: "manche", manche: 7, restants: 12, finT: 0, maintenantServeur: () => 0, ...plus,
  } as never));

  it("« MANCHE 7 » et « 12 TIGRES »", () => {
    const html = rendre();
    expect(html).toContain("MANCHE 7");
    expect(html).toContain(`12${NBSP}TIGRES`);
    expect(html).toContain('aria-label="Vague"');
    expect(html).toContain('data-pause="non"');
  });

  it("pause : décompte écrit d'après l'horloge serveur", () => {
    const html = rendre({ phase: "pause", manche: 8, restants: 0, finT: 10_000, maintenantServeur: () => 3_200 });
    expect(html).toContain("MANCHE 8");
    expect(html).toContain(`DÉPART DANS 7${NBSP}s`);
    expect(html).toContain('data-pause="oui"');
  });

  it("derniers tigres : état de fin signalé en plus du texte", () => {
    expect(rendre({ restants: 2 })).toContain('data-etat="fin"');
    expect(rendre({ restants: 9 })).toContain('data-etat="normal"');
    expect(rendre({ restants: 1 })).toContain(`1${NBSP}TIGRE<`);
  });
});

describe("BandeauManche", () => {
  it("manche suivante : le nombre de tigres, avec le bon accord", () => {
    expect(renderToStaticMarkup(createElement(BandeauManche, { manche: 7, restants: 12 }))).toContain(`12${NBSP}TIGRES ARRIVENT`);
    expect(renderToStaticMarkup(createElement(BandeauManche, { manche: 7, restants: 1 }))).toContain("1 TIGRE ARRIVE");
    expect(renderToStaticMarkup(createElement(BandeauManche, { manche: 7, restants: 0 }))).toContain("LES TIGRES ARRIVENT");
  });
  it("première manche : les consignes", () => {
    const html = renderToStaticMarkup(createElement(BandeauManche, { manche: 1, restants: 6 }));
    expect(html).toContain("MANCHE 1");
    expect(html).toContain("Achetez des armes aux murs");
  });
});

describe("BlocArgent", () => {
  const rendre = (plus: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(BlocArgent, {
    argent: 1250, gain: null, cleGain: 0, gainPositif: false, refus: null, ...plus,
  } as never));

  it("montant formaté, libellé « ARGENT » écrit", () => {
    const html = rendre();
    expect(html).toMatch(/1[  ]250 \$/);
    expect(html).toContain("ARGENT");
    expect(html).toContain('aria-label="Argent"');
    expect(html).not.toContain("argentGain");
  });

  it("dernier gain relancé par sa clé, signe porté par un attribut", () => {
    const html = rendre({ gain: `+60${NBSP}$ · kill`, cleGain: 4, gainPositif: true });
    expect(html).toContain("+60");
    expect(html).toContain('data-signe="plus"');
    expect(rendre({ gain: "−950", cleGain: 5, gainPositif: false })).toContain('data-signe="moins"');
  });

  it("achat refusé : motif écrit en dessous (jamais la couleur seule)", () => {
    const html = rendre({ refus: "Argent insuffisant" });
    expect(html).toMatch(/role="status"[^>]*>Argent insuffisant</);
    expect(rendre()).not.toContain("Argent insuffisant");
  });
});

describe("InvitesAction étendue (zombies)", () => {
  const base = { invite: "", inviteDetail: "", toucheInteragir: "E", inviteRecharge: false, toucheRecharger: "R" };
  const rendre = (plus: Record<string, unknown>) => renderToStaticMarkup(createElement(InvitesAction, { ...base, ...plus } as never));

  it("achat d'une arme : touche, nom et prix du détail", () => {
    const html = rendre({ invite: "acheter", inviteDetail: `Pompe — 900${NBSP}$`, assez: true });
    expect(html).toContain("<kbd>E</kbd>");
    expect(html).toContain("Pompe — 900");
    expect(html).toContain('data-assez="oui"');
    expect(html).not.toContain("insuffisant");
  });

  it("argent manquant : la raison est écrite et l'invite marquée", () => {
    const html = rendre({ invite: "porte", inviteDetail: `Ouvrir la porte — 1${NBSP}250${NBSP}$`, assez: false });
    expect(html).toContain("Argent insuffisant");
    expect(html).toContain('data-assez="non"');
  });

  it("porte verrouillée : le détail dit pourquoi, pas de doublon « Argent insuffisant »", () => {
    const html = rendre({ invite: "porte", inviteDetail: `Porte verrouillée — 1${NBSP}250${NBSP}$`, assez: false });
    expect(html).toContain("Porte verrouillée");
    expect(html).not.toContain("Argent insuffisant");
  });

  it("boîte et soin : mêmes invites", () => {
    expect(rendre({ invite: "boite", inviteDetail: "Boîte mystère — 950 $" })).toContain("Boîte mystère");
    expect(rendre({ invite: "soin", inviteDetail: "Soin — 400 $" })).toContain("Soin — 400");
  });

  it("relève : « Réanimer Léa », à maintenir, barre seulement une fois la touche tenue", () => {
    const attente = rendre({ invite: "reanimer", inviteDetail: "Réanimer Marc", reanime: false });
    expect(attente).toContain("Réanimer Marc");
    expect(attente).toContain("maintenir");
    expect(attente).not.toContain('role="progressbar"');
    const tenue = rendre({ invite: "reanimer", inviteDetail: "Réanimer Marc", reanime: true, refReanim: createRef() });
    expect(tenue).toContain('role="progressbar"');
    expect(tenue).toContain('aria-label="Réanimation"');
  });

  it("touche d'action sans assignation : le dit", () => {
    expect(rendre({ invite: "acheter", inviteDetail: "Pompe — 900 $", toucheInteragir: "" })).toContain("touche non assignée");
  });

  it("l'arène est inchangée : monter, recharger, rien", () => {
    expect(rendre({ invite: "monter", inviteDetail: "2/4" })).toContain("Monter (2/4)");
    expect(rendre({ inviteRecharge: true })).toContain("RECHARGER");
    expect(rendre({})).toBe("");
  });
});

describe("EcranMort en zombies", () => {
  const rendre = (h: HudEtat, plus: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(EcranMort, {
    hud: h, derniereMort: null, killcamInfo: null, degatsAuTueur: 0, touches: touchesParDefaut(), equipement: { principale: "fusil_assaut", secondaire: "pistolet" },
    surEquipement: () => {}, surPasserKillcam: () => {}, ...plus,
  } as never));

  it("à terre : titre, consigne de relève et barre de saignement avec le temps écrit", () => {
    const html = rendre(hud({ mort: true, aTerre: true }), { terreFinT: 45_000, maintenantServeur: () => 13_000 });
    expect(html).toMatch(/role="status"[^>]*>À terre</);
    expect(html).toContain("Un coéquipier peut vous relever");
    expect(html).toContain("à moins de 2,5 m pendant 3 s");
    expect(html).toContain(`Éliminé dans <b>32${NBSP}s</b>`);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="71"');
  });

  it("à terre sans échéance connue : le dit, sans barre", () => {
    const html = rendre(hud({ mort: true, aTerre: true }));
    expect(html).toContain("Sans relève, vous serez éliminé.");
    expect(html).not.toContain('role="progressbar"');
  });

  it("éliminé : retour à la prochaine pause", () => {
    const html = rendre(hud({ mort: true, elimine: true }));
    expect(html).toMatch(/role="status"[^>]*>Éliminé</);
    expect(html).toContain("Retour à la prochaine pause");
  });

  it("ni killcam, ni carte du tueur, ni choix d'équipement", () => {
    for (const h of [hud({ mort: true, aTerre: true }), hud({ mort: true, elimine: true }), hud({ mort: true, killcamPhase: "rejeu", killcam: 0.4 })]) {
      const html = rendre(h);
      expect(html).not.toContain("Rejeu");
      expect(html).not.toContain("Passer");
      expect(html).not.toContain("Équipement de la prochaine apparition");
      expect(html).not.toContain("Éliminé par");
    }
  });

  it("avant la première apparition : « Apparition… »", () => {
    expect(rendre(hud({ mort: true }))).toContain("Apparition…");
  });

  it("vivant : rien", () => {
    expect(rendre(hud({ mort: false }))).toBe("");
  });
});

describe("FinDePartieZombies", () => {
  const perdue = partie({
    phase: "fin", manche: 8, finT: 25_000, bilan: { manche: 7, dureeMs: 725_000 },
    joueurs: [
      joueur("j1", "Lea", { etat: "terre", admis: true, kills: 12, gagne: 1800, reanimations: 1 }),
      joueur("j2", "Marc", { etat: "elimine", admis: true, kills: 30, gagne: 2950, reanimations: 0 }),
      joueur("j3", "Zoe"),
    ],
  });
  const rendre = (plus: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(FinDePartieZombies, {
    partie: perdue, monId: "j1", maintenantServeur: () => 10_000, surRejouer: () => {}, surQuitter: () => {}, recordAvant: { manche: 5, kills: 40 }, ...plus,
  } as never));

  it("manche atteinte (celle du bilan), durée et titre", () => {
    const html = rendre();
    expect(html).toContain("Partie perdue");
    expect(html).toMatch(/Manche atteinte : <b>7<\/b>/);
    expect(html).toContain(`12${NBSP}min 05${NBSP}s`);
    expect(html).toContain('aria-label="Fin de partie"');
  });

  it("tableau par joueur : tigres tués, argent gagné, relèves, triés, moi marqué, total d'équipe", () => {
    const html = rendre();
    expect(html).toContain("Tigres tués");
    expect(html).toContain("Argent gagné");
    expect(html).toContain("Relèves");
    expect(html.indexOf("Marc")).toBeLessThan(html.indexOf("Lea"));
    expect(html).not.toContain("Zoe");
    expect(html).toContain('data-moi="oui"');
    expect(html).toMatch(/2[  ]950 \$/);
    expect(html).toContain("Équipe");
    expect(html).toContain(">42<");
  });

  it("record battu : mis en avant ; sinon rappelé", () => {
    expect(rendre()).toContain("NOUVEAU RECORD");
    expect(rendre()).toContain('data-battu="oui"');
    const html = rendre({ recordAvant: { manche: 9, kills: 100 } });
    expect(html).toContain("Record : manche 9");
    expect(html).toContain('data-battu="non"');
    expect(html).not.toContain("NOUVEAU RECORD");
    // aucun record encore (partie sans tigre abattu) : pas de « Record : manche 0 »
    const sans = rendre({ recordAvant: { manche: 0, kills: 0 }, partie: partie({ phase: "fin", manche: 1, bilan: { manche: 1, dureeMs: 60_000 }, joueurs: [joueur("j1", "Lea", { admis: true, etat: "elimine" })] }) });
    expect(sans).not.toContain("manche 0");
    expect(sans).toContain("Pas encore de record");
  });

  it("compte à rebours du retour automatique, Rejouer (lobby) et Quitter", () => {
    const html = rendre();
    expect(html).toContain("Retour automatique au lobby dans <b>15</b>");
    expect(html).toMatch(/<button[^>]*>Rejouer<\/button>/);
    expect(html).toMatch(/<button[^>]*>Quitter<\/button>/);
    expect(html).toContain("retour au lobby");
  });

  it("personne n'a joué : le dit", () => {
    expect(rendre({ partie: partie({ phase: "fin", manche: 1, joueurs: [joueur("j1", "Lea")] }) })).toContain("Personne n&#x27;a joué.");
  });
});

describe("TableauZombies", () => {
  it("manche, joueurs, état, tigres tués et argent gagné", () => {
    const html = renderToStaticMarkup(createElement(TableauZombies, {
      monId: "j1",
      partie: partie({ phase: "manche", manche: 3, joueurs: [joueur("j1", "Lea", { etat: "debout", admis: true, kills: 4, gagne: 340 }), joueur("j2", "Marc", { etat: "terre", admis: true, kills: 2, gagne: 120 })] }),
    }));
    expect(html).toContain("manche 3");
    expect(html).toContain("Lea");
    expect(html).toContain(">à terre<");
    expect(html).toContain(">en jeu<");
    expect(html).toContain('aria-label="Tableau des scores"');
  });
});

describe("BlocArmes sans arme principale (départ des zombies)", () => {
  const refDiv = createRef<HTMLDivElement>();
  const refSpan = createRef<HTMLSpanElement>();
  const rendre = (plus: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(BlocArmes, {
    arme: "pistolet", slot: "secondaire", slots: HUD.slots, munitions: 12, chargeur: 12, reserve: 60, recharge: false, degainage: false, tireInterdit: false, bonusVitesse: 1,
    toucheP: "1", toucheS: "2", toucheC: "3", toucheSp: "4", refBarre: refDiv, refTemps: refSpan, ...plus,
  } as never));

  it("deux lignes seulement (pistolet, couteau), le pistolet actif, aucune ligne principale", () => {
    const html = rendre();
    expect(html.match(/<li /g)).toHaveLength(2);
    expect(html).toContain("PISTOLET");
    expect(html).toContain("COUTEAU");
    expect(html).not.toContain("(Principale)");
    expect(html).toMatch(/aria-current="true"[^>]*>.*PISTOLET/);
    expect(html).toContain("[2]");
    expect(html).toContain("[3]");
    expect(html).not.toContain("[1]");
  });

  it("réserve limitée : le chiffre, pas l'infini", () => {
    const html = rendre();
    expect(html).toContain("RÉSERVE 60");
    expect(html).not.toContain("RÉSERVE ∞");
  });

  it("l'épée achetée au mur occupe le slot de l'arme blanche", () => {
    const html = rendre({ slots: "secondaire:pistolet:12:12:60|couteau:epee:0:0" });
    expect(html).toContain("ÉPÉE");
    expect(html).toContain("VITESSE +20 %");
  });

  it("(v8) grenades : pastilles sur 4 sous le rack, remontoirs s'il en reste, mèche qui court pendant la cuisson ; rien en arène", () => {
    expect(rendre()).not.toContain("GRENADES");
    const html = rendre({ grenades: 2, remontoirs: 0, cuisson: null, toucheGrenade: "G", toucheRemontoir: "B" });
    expect(html).toContain('aria-label="Grenades"');
    expect(html).toContain("[G]");
    expect(html).toContain("●●○○");
    expect(html).toContain("2 sur 4");
    expect(html).not.toContain("REMONTOIR");
    const avec = rendre({ grenades: 0, remontoirs: 3, toucheGrenade: "G", toucheRemontoir: "B" });
    expect(avec).toContain("○○○○");
    expect(avec).toContain('data-niveau="vide"');
    expect(avec).toContain("REMONTOIR");
    expect(avec).toContain("×3");
    expect(avec).toContain("[B]");
    const cuit = rendre({ grenades: 1, cuisson: 0.5, toucheGrenade: "G" });
    expect(cuit).toContain("MÈCHE");
    expect(cuit).toContain("1,8 s");
  });

  it("après l'achat d'une principale, la ligne apparaît", () => {
    const html = rendre({ slots: "principale:pompe:6:6:30|secondaire:pistolet:12:12:60|couteau:couteau:0:0", arme: "pompe", slot: "principale", munitions: 6, chargeur: 6, reserve: 30 });
    expect(html.match(/<li /g)).toHaveLength(3);
    expect(html).toContain("POMPE");
  });
});

describe("MenuPause en zombies", () => {
  const rendre = (mode?: "zombies" | "arene") => renderToStaticMarkup(createElement(MenuPause, {
    premiereFois: false, surReprendre: () => {}, surQuitter: () => {}, equipement: { principale: "fusil_assaut", secondaire: "pistolet" }, surEquipement: () => {},
    pseudo: "Lea", surPseudo: () => {}, sensibilite: 1, surSensibilite: () => {}, accroupiBascule: false, surAccroupiBascule: () => {},
    voix: { actif: false, mode: "appuyer" }, surVoix: () => {}, voixErreur: "", toucheParler: "T", actionsSansTouche: [], touches: touchesParDefaut(), surTouches: () => {},
    reglagesHud: REGLAGES_HUD_DEFAUT, surReglagesHud: () => {}, ...(mode ? { mode } : {}),
  } as never));

  it("la partie continue, pas d'équipement à choisir, « Quitter la partie »", () => {
    const html = rendre("zombies");
    expect(html).toContain("les tigres ne s&#x27;arrêtent pas");
    expect(html).not.toContain("Équipement de la prochaine apparition");
    expect(html).toContain("Quitter la partie");
    expect(html).not.toContain("Quitter l&#x27;arène");
  });

  it("arène inchangée", () => {
    for (const html of [rendre(), rendre("arene")]) {
      expect(html).toContain("Équipement de la prochaine apparition");
      expect(html).toContain("Quitter l&#x27;arène");
      expect(html).toContain("vous êtes toujours dans l&#x27;arène");
    }
  });
});

beforeEach(() => {
  // les composants lisent `localStorage` seulement dans des effets : le rendu statique ne doit jamais en avoir besoin
  expect(typeof (globalThis as { localStorage?: unknown }).localStorage).toBe("undefined");
});

describe("flèches réservées aux champs (choix du mode au clavier)", () => {
  it("une flèche sur une radio, un champ de texte ou une liste ne déplace pas la carte", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) expect(flecheReserveeAuChamp("ArrowDown", { tagName })).toBe(true);
    expect(flecheReserveeAuChamp("ArrowLeft", { tagName: "DIV", isContentEditable: true })).toBe(true);
  });
  it("hors champ, ou pour une autre touche, la carte garde les flèches", () => {
    expect(flecheReserveeAuChamp("ArrowUp", { tagName: "DIV" })).toBe(false);
    expect(flecheReserveeAuChamp("ArrowUp", { tagName: "BUTTON" })).toBe(false);
    expect(flecheReserveeAuChamp("ArrowUp", null)).toBe(false);
    expect(flecheReserveeAuChamp("KeyW", { tagName: "INPUT" })).toBe(false);
  });
});
