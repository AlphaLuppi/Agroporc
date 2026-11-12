import { describe, expect, it } from "vitest";
import { LIAISONS_DEFAUT, LIAISONS_MANETTE_DEFAUT, type LigneChat, type LigneClassement, type MenuChatHud, type ResultatMatch, type StatsVoiture } from "./contrat";
import {
  FORMES_QUALITE, GRADUATIONS_BOOST, annonceBut, annonceLigneChat, libelleChatBloque, libelleEntreeChat, lignesMenuChat, annonceFin, chronoUrgent, classementParEquipe, equipeMiseEnAvant, estMoi, formaterChrono, graduationsAllumees, libelleAbsent,
  libelleChrono, libelleCommandes, libellePastilleReseau, libelleRevanche, ligneMvp, resultatPourEquipe, titreResultat, vitesseAffichee,
} from "./hud-modele";

const noms = { bleue: "Les Trèfles", orange: "Les Tigres" };
const stats = (points: number): StatsVoiture => ({ buts: 0, passes: 0, arrets: 0, tirs: 0, demolitions: 0, demolie: 0, touches: 0, points });
const ligne = (id: number, equipe: "bleue" | "orange", points: number): LigneClassement => ({ id, nom: `J${id}`, equipe, humain: id === 0, stats: stats(points) });
const resultat = (vainqueur: ResultatMatch["vainqueur"], over: Partial<ResultatMatch> = {}): ResultatMatch => ({
  vainqueur, score: { bleue: 2, orange: 1 }, prolongation: false, equipeJoueur: "bleue",
  classement: [ligne(0, "bleue", 300), ligne(1, "orange", 120)], mvp: 0, ...over,
});

describe("minuteur", () => {
  it("formate en m:ss, arrondi à la seconde supérieure", () => {
    expect(formaterChrono(300)).toBe("5:00");
    expect(formaterChrono(299.2)).toBe("5:00");
    expect(formaterChrono(61)).toBe("1:01");
    expect(formaterChrono(9.01)).toBe("0:10");
    expect(formaterChrono(0)).toBe("0:00");
  });
  it("valeurs absurdes : 0:00", () => {
    expect(formaterChrono(-5)).toBe("0:00");
    expect(formaterChrono(Number.NaN)).toBe("0:00");
  });
  it("prolongation à la place du temps", () => {
    expect(libelleChrono({ tempsRestant: 0, prolongation: true })).toBe("PROLONGATION");
    expect(libelleChrono({ tempsRestant: 125, prolongation: false })).toBe("2:05");
  });
  it("ambre sous 30 s seulement, ni en prolongation ni à 0 ni à la fin", () => {
    expect(chronoUrgent({ tempsRestant: 30, prolongation: false, phase: "enJeu" })).toBe(true);
    expect(chronoUrgent({ tempsRestant: 31, prolongation: false, phase: "enJeu" })).toBe(false);
    expect(chronoUrgent({ tempsRestant: 0, prolongation: false, phase: "enJeu" })).toBe(false);
    expect(chronoUrgent({ tempsRestant: 10, prolongation: true, phase: "enJeu" })).toBe(false);
    expect(chronoUrgent({ tempsRestant: 10, prolongation: false, phase: "fini" })).toBe(false);
  });
});

describe("jauge de boost", () => {
  it("allume une graduation par point, bornée à 0..100", () => {
    expect(GRADUATIONS_BOOST).toBe(100);
    expect(graduationsAllumees(0)).toBe(0);
    expect(graduationsAllumees(33.33)).toBe(33);
    expect(graduationsAllumees(33.5)).toBe(34);
    expect(graduationsAllumees(100)).toBe(100);
    expect(graduationsAllumees(140)).toBe(100);
    expect(graduationsAllumees(-3)).toBe(0);
    expect(graduationsAllumees(Number.NaN)).toBe(0);
  });
  it("vitesse arrondie, jamais négative", () => {
    expect(vitesseAffichee(82.6)).toBe(83);
    expect(vitesseAffichee(-4)).toBe(0);
    expect(vitesseAffichee(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("classement par équipe", () => {
  it("trie chaque équipe par points décroissants, id croissant à égalité", () => {
    const c = classementParEquipe([ligne(3, "orange", 50), ligne(1, "bleue", 100), ligne(0, "bleue", 100), ligne(2, "orange", 80), ligne(4, "bleue", 10)]);
    expect(c.bleue.map((l) => l.id)).toEqual([0, 1, 4]);
    expect(c.orange.map((l) => l.id)).toEqual([2, 3]);
  });
  it("ne modifie pas l'entrée", () => {
    const entree = [ligne(1, "bleue", 5), ligne(0, "bleue", 50)];
    classementParEquipe(entree);
    expect(entree.map((l) => l.id)).toEqual([1, 0]);
  });
});

describe("annonces vocales", () => {
  it("annonce le but de l'équipe dont le score a augmenté", () => {
    expect(annonceBut({ bleue: 0, orange: 0 }, { bleue: 1, orange: 0 }, noms)).toBe("But pour Les Trèfles. Les Trèfles 1, Les Tigres 0.");
    expect(annonceBut({ bleue: 1, orange: 0 }, { bleue: 1, orange: 1 }, noms)).toBe("But pour Les Tigres. Les Trèfles 1, Les Tigres 1.");
  });
  it("rien quand le score ne monte pas (remise à zéro d'un match relancé comprise)", () => {
    expect(annonceBut({ bleue: 2, orange: 1 }, { bleue: 2, orange: 1 }, noms)).toBeNull();
    expect(annonceBut({ bleue: 2, orange: 1 }, { bleue: 0, orange: 0 }, noms)).toBeNull();
  });
  it("annonce la fin du match", () => {
    expect(annonceFin(resultat("bleue"), noms)).toBe("Match terminé : Victoire. Les Trèfles 2 - 1 Les Tigres.");
    expect(annonceFin(resultat("orange"), noms)).toBe("Match terminé : Défaite. Les Trèfles 2 - 1 Les Tigres.");
  });
});

describe("résultat", () => {
  it("victoire, défaite et égalité du point de vue du joueur", () => {
    expect(titreResultat(resultat("bleue"), noms)).toEqual({ issue: "victoire", titre: "Victoire !", sousTitre: "Les Trèfles 2 - 1 Les Tigres" });
    expect(titreResultat(resultat("orange"), noms).issue).toBe("defaite");
    expect(titreResultat(resultat("orange", { equipeJoueur: "orange" }), noms).issue).toBe("victoire");
    expect(titreResultat(resultat(null), noms)).toMatchObject({ issue: "egalite", titre: "Égalité" });
  });
  it("mentionne la prolongation", () => {
    expect(titreResultat(resultat("bleue", { prolongation: true }), noms).sousTitre).toContain("après prolongation");
  });
  it("MVP et équipe mise en avant", () => {
    expect(ligneMvp(resultat("bleue"))?.nom).toBe("J0");
    expect(ligneMvp(resultat("bleue", { mvp: null }))).toBeNull();
    expect(ligneMvp(resultat("bleue", { mvp: 99 }))).toBeNull();
    expect(equipeMiseEnAvant(resultat("orange"))).toBe("orange");
    expect(equipeMiseEnAvant(resultat(null, { equipeJoueur: "orange" }))).toBe("orange");
  });
});

describe("mode en ligne : identité et résultat", () => {
  it("« moi » : l'id de ma voiture en ligne, le drapeau `humain` hors ligne", () => {
    const l = (id: number, humain: boolean) => ({ id, humain });
    expect(estMoi(l(0, true))).toBe(true);
    expect(estMoi(l(1, false))).toBe(false);
    // en ligne deux humains : seule ma voiture est « moi »
    expect(estMoi(l(0, true), 3)).toBe(false);
    expect(estMoi(l(3, true), 3)).toBe(true);
    expect(estMoi(l(3, false), 3)).toBe(true);
    expect(estMoi(l(0, false), 0)).toBe(true);
  });
  it("le résultat brut du serveur est relu du point de vue de chaque équipe", () => {
    const brut = resultat("orange", { equipeJoueur: "bleue" });
    const pourOrange = resultatPourEquipe(brut, "orange");
    expect(titreResultat(brut, noms).issue).toBe("defaite");
    expect(titreResultat(pourOrange, noms).issue).toBe("victoire");
    expect(annonceFin(pourOrange, noms)).toContain("Victoire");
    expect(brut.equipeJoueur).toBe("bleue");
    expect(resultatPourEquipe(resultat(null), "orange")).toMatchObject({ equipeJoueur: "orange", vainqueur: null });
  });
});

describe("mode en ligne : pastille réseau", () => {
  it("ping et qualité écrits ; les états sans mesure disent ce qui se passe", () => {
    expect(libellePastilleReseau({ etat: "ouverte", rttMs: 42.4, qualite: "bonne" })).toBe("42 ms · Bonne");
    expect(libellePastilleReseau({ etat: "ouverte", rttMs: 190, qualite: "mauvaise" })).toBe("190 ms · Mauvaise");
    expect(libellePastilleReseau({ etat: "ouverte", rttMs: 0, qualite: "bonne" })).toBe("Mesure du ping…");
    expect(libellePastilleReseau({ etat: "reconnexion", rttMs: 50, qualite: "bonne" })).toBe("Reconnexion…");
    expect(libellePastilleReseau({ etat: "fermee", rttMs: 0, qualite: "mauvaise" })).toBe("Connexion perdue");
    expect(libellePastilleReseau({ etat: "refusee", rttMs: 0, qualite: "mauvaise" })).toBe("Connexion refusée");
    expect(libellePastilleReseau({ etat: "connexion", rttMs: 0, qualite: "bonne" })).toBe("Connexion…");
  });
  it("chaque qualité a sa forme propre (jamais la couleur seule)", () => {
    expect(new Set(Object.values(FORMES_QUALITE)).size).toBe(3);
  });
  it("commandes suspendues : dites seulement quand elles le sont", () => {
    expect(libelleCommandes("actives")).toBeNull();
    expect(libelleCommandes("menu")).toContain("menu");
    expect(libelleCommandes("masque")).toContain("onglet masqué");
  });
  it("joueur coupé : compte à rebours arrondi au-dessus, jamais négatif", () => {
    expect(libelleAbsent({ joueur: 1, nom: "Léa", restantMs: 13_200 })).toBe("Léa : connexion perdue, reprise possible dans 14 s");
    expect(libelleAbsent({ joueur: 1, nom: "Léa", restantMs: -50 })).toContain("dans 0 s");
  });
  it("bouton de revanche : le compte n'apparaît qu'avec un premier vote", () => {
    expect(libelleRevanche(0, 2)).toBe("Revanche");
    expect(libelleRevanche(1, 2)).toBe("Revanche · 1/2");
  });
});

describe("réactions rapides : menu et fil", () => {
  const menu: MenuChatHud = {
    categorie: "reactions", titre: "Réactions",
    choix: [
      { direction: "haut", id: "tie-un-tigre", texte: "Tié un tigre ?!", equipeSeule: false },
      { direction: "gauche", id: "trefle", texte: "Ça sent le trèfle à 4 feuilles", equipeSeule: false },
      { direction: "droite", id: "en-marche", texte: "En marche ! Mais vers où ?", equipeSeule: false },
      { direction: "bas", id: "rugissement", texte: "RRRROAAAR !", equipeSeule: false },
    ],
  };
  it("touche réelle du joueur, puis bouton de la manette quand elle est branchée", () => {
    expect(libelleEntreeChat("haut", LIAISONS_DEFAUT, null)).toBe("1");
    expect(libelleEntreeChat("bas", LIAISONS_DEFAUT, LIAISONS_MANETTE_DEFAUT)).toBe("4 · Croix ↓");
    expect(libelleEntreeChat("gauche", { ...LIAISONS_DEFAUT, chatGauche: [] }, null)).toBe("—");
    expect(libelleEntreeChat("droite", { ...LIAISONS_DEFAUT, chatDroite: ["KeyU"] }, null)).toBe("U");
  });
  it("lignes du menu : flèche, entrée, texte", () => {
    const l = lignesMenuChat(menu, LIAISONS_DEFAUT, LIAISONS_MANETTE_DEFAUT);
    expect(l.map((x) => x.fleche)).toEqual(["↑", "←", "→", "↓"]);
    expect(l.map((x) => x.entree)).toEqual(["1 · Croix ↑", "2 · Croix ←", "3 · Croix →", "4 · Croix ↓"]);
    expect(l[0].texte).toBe("Tié un tigre ?!");
  });
  it("annonce d'une ligne du fil et chat bloqué", () => {
    const base: LigneChat = { id: 1, nom: "Alice", texte: "J'ai la balle !", equipe: "bleue", equipeSeule: true, moi: false };
    expect(annonceLigneChat(base)).toBe("Alice, à l'équipe : J'ai la balle !");
    expect(annonceLigneChat({ ...base, equipeSeule: false, texte: "RRRROAAAR !" })).toBe("Alice : RRRROAAAR !");
    expect(libelleChatBloque(0)).toBeNull();
    expect(libelleChatBloque(3)).toBe("Chat bloqué : 3 s");
  });
});
