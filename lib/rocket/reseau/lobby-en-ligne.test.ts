import { describe, expect, it } from "vitest";
import { CLE_REPRISE, CLE_SANS_RENDU, RESEAU, REGLAGES_SALON_DEFAUT, type EtatSalon, type JoueurSalon, type MessageServeur, type ResumeSalle } from "./protocole";
import {
  CLE_MODE_ROCKET, CLE_REGLAGES_LIGNE, appliquerConnexion, appliquerMessage, attendre, codePret, ecranLobby, ecrireModeRocket, ecrireReglagesSalon, ecrireReprise,
  effacerReprise, etatLobbyInitial, libelleChargement, libelleConnexion, libelleErreur, libelleLancer, libelleRefus, lignesParties, lireModeRocket, lireReglagesSalon,
  lireReprise, normaliserReglagesSalon, quitterSalonLocalement, reessayable, resumeEffectifsSalon, resumeRevanche, saisirCode, sansRenduActif, vueSalon,
} from "./lobby-en-ligne";

/** Stockage factice (le vrai peut être absent ou refuser). */
function stockage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
}
const casse = { getItem: () => { throw new Error("refus"); }, setItem: () => { throw new Error("refus"); }, removeItem: () => { throw new Error("refus"); } };

const joueur = (id: number, equipe: "bleue" | "orange", over: Partial<JoueurSalon> = {}): JoueurSalon =>
  ({ id, nom: `J${id}`, equipe, hote: id === 0, connecte: true, charge: false, ...over });
const salon = (over: Partial<EtatSalon> = {}): EtatSalon => ({
  code: "BCDF", phase: "salon", reglages: REGLAGES_SALON_DEFAUT(), joueurs: [joueur(0, "bleue")], placesParEquipe: 1, lancable: false, raisonNonLancable: "Il manque un joueur.", ...over,
});

describe("mémoire locale", () => {
  it("le mode retenu est hors ligne par défaut, quel que soit l'état du stockage", () => {
    expect(lireModeRocket(null)).toBe("local");
    expect(lireModeRocket(casse)).toBe("local");
    expect(lireModeRocket(stockage({ [CLE_MODE_ROCKET]: "n'importe quoi" }))).toBe("local");
  });
  it("aller-retour du mode, sans jamais lever", () => {
    const s = stockage();
    ecrireModeRocket("ligne", s);
    expect(lireModeRocket(s)).toBe("ligne");
    expect(() => ecrireModeRocket("ligne", casse)).not.toThrow();
    expect(() => ecrireModeRocket("ligne", null)).not.toThrow();
  });
  it("réglages d'hôte : valeurs hors liste ramenées aux défauts", () => {
    const d = REGLAGES_SALON_DEFAUT();
    expect(normaliserReglagesSalon(null)).toEqual(d);
    expect(normaliserReglagesSalon({ format: "9v9", dureeS: 17, niveauBots: "dieu", visible: "oui" })).toEqual(d);
    expect(normaliserReglagesSalon({ format: "3v3", dureeS: 600, niveauBots: "allstar", visible: false })).toEqual({ format: "3v3", dureeS: 600, niveauBots: "allstar", visible: false });
  });
  it("réglages d'hôte : aller-retour, JSON illisible = défauts", () => {
    const s = stockage();
    ecrireReglagesSalon({ format: "2v2", dureeS: 420, niveauBots: "debutant", visible: false }, s);
    expect(lireReglagesSalon(s)).toEqual({ format: "2v2", dureeS: 420, niveauBots: "debutant", visible: false });
    expect(lireReglagesSalon(stockage({ [CLE_REGLAGES_LIGNE]: "{pas du json" }))).toEqual(REGLAGES_SALON_DEFAUT());
    expect(lireReglagesSalon(casse)).toEqual(REGLAGES_SALON_DEFAUT());
  });
});

describe("reprise dans sessionStorage", () => {
  const jeton = "0123456789abcdef0123456789abcdef";
  const session = { code: "BCDF", joueur: 3, jeton };

  it("une session récente est reprise", () => {
    const s = stockage();
    ecrireReprise(session, 100_000, s);
    expect(lireReprise(s, 100_000 + 5000)).toEqual(session);
    expect(lireReprise(s, 100_000 + RESEAU.repriseMs)).toEqual(session);
  });
  it("au-delà de 20 s la place est celle d'un bot : aucune tentative", () => {
    const s = stockage();
    ecrireReprise(session, 100_000, s);
    expect(lireReprise(s, 100_000 + RESEAU.repriseMs + 1)).toBeNull();
  });
  it("horloge qui recule, contenu mal formé ou stockage hostile : null", () => {
    const s = stockage();
    ecrireReprise(session, 100_000, s);
    expect(lireReprise(s, 50_000)).toBeNull();
    for (const brut of ["", "{", "[]", "null", JSON.stringify({ ...session, coupeA: 1, jeton: "court" }), JSON.stringify({ ...session, coupeA: 1, code: "AEIO" }),
      JSON.stringify({ ...session, coupeA: -1 }), JSON.stringify({ ...session, joueur: 1.5, coupeA: 1 })]) {
      expect(lireReprise(stockage({ [CLE_REPRISE]: brut }), 1000), brut).toBeNull();
    }
    expect(lireReprise(casse, 0)).toBeNull();
    expect(lireReprise(null, 0)).toBeNull();
  });
  it("effacer supprime la reprise (ou la périme si le stockage n'a pas removeItem)", () => {
    const s = stockage();
    ecrireReprise(session, 100_000, s);
    effacerReprise(s);
    expect(lireReprise(s, 100_000)).toBeNull();
    const sansRemove = { getItem: s.getItem, setItem: s.setItem };
    ecrireReprise(session, 100_000, sansRemove);
    effacerReprise(sansRemove);
    expect(lireReprise(sansRemove, 100_000)).toBeNull();
    expect(() => effacerReprise(casse)).not.toThrow();
  });
});

describe("drapeau « sans rendu » des essais", () => {
  it("lu hors production seulement", () => {
    const s = stockage({ [CLE_SANS_RENDU]: "1" });
    expect(sansRenduActif(s, false)).toBe(true);
    expect(sansRenduActif(s, true)).toBe(false);
  });
  it("absent, vide, « 0 » ou « false » : rendu normal ; stockage hostile aussi", () => {
    expect(sansRenduActif(stockage(), false)).toBe(false);
    for (const v of ["", "0", "false", "FALSE"]) expect(sansRenduActif(stockage({ [CLE_SANS_RENDU]: v }), false), v).toBe(false);
    expect(sansRenduActif(stockage({ [CLE_SANS_RENDU]: "true" }), false)).toBe(true);
    expect(sansRenduActif(casse, false)).toBe(false);
    expect(sansRenduActif(null, false)).toBe(false);
  });
});

describe("saisie du code", () => {
  it("majuscules, alphabet des codes, quatre lettres au plus", () => {
    expect(saisirCode("bcdf")).toBe("BCDF");
    expect(saisirCode(" b-c d1f ")).toBe("BCDF");
    expect(saisirCode("BCDFGHJK")).toBe("BCDF");
    expect(saisirCode("aeiou")).toBe("");
    expect(saisirCode("bc")).toBe("BC");
  });
  it("seul un code complet est prêt à partir", () => {
    expect(codePret("BC")).toBeNull();
    expect(codePret("bcdf")).toBe("BCDF");
    expect(codePret("AEIO")).toBeNull();
  });
});

describe("libellés", () => {
  it("chaque état de connexion a un texte, et les échecs sont graves", () => {
    expect(libelleConnexion("ouverte", null)).toEqual({ texte: "Connecté", gravite: "ok" });
    expect(libelleConnexion("connexion", null).gravite).toBe("attente");
    expect(libelleConnexion("reconnexion", null).texte).toContain("reconnexion");
    expect(libelleConnexion("fermee", "injoignable")).toMatchObject({ gravite: "erreur", texte: expect.stringContaining("Serveur injoignable") });
    expect(libelleConnexion("fermee", "remplacee").texte).toContain("autre onglet");
    expect(libelleConnexion("refusee", "version").texte).toContain("rechargez");
    expect(libelleConnexion("refusee", "plein").texte).toContain("complet");
  });
  it("seules les connexions mortes se relancent à la main", () => {
    expect(reessayable("fermee")).toBe(true);
    expect(reessayable("refusee")).toBe(true);
    expect(reessayable("ouverte")).toBe(false);
    expect(reessayable("reconnexion")).toBe(false);
  });
  it("les refus sont écrits en français, un code inconnu se distingue d'une partie disparue", () => {
    expect(libelleRefus("rejoindre", "inconnue")).toBe("Aucune partie ne porte ce code.");
    expect(libelleRefus("lancer", "inconnue")).toContain("n'existe plus");
    expect(libelleRefus("rejoindre", "pleine")).toBe("La partie est complète.");
    expect(libelleRefus("rejoindre", "limite")).toContain("essais");
    expect(libelleRefus("creer", "limite")).toContain("limite");
    expect(libelleRefus("equipe", "equipe-pleine")).toContain("complète");
    expect(libelleRefus("lancer", "joueurs")).toContain("deux joueurs");
    expect(libelleErreur("version")).toContain("rechargez");
  });
  it("aucun refus ne rend un texte vide", () => {
    const raisons = ["inconnue", "pleine", "en-cours", "hote", "limite", "format", "joueurs", "equipe-pleine", "code", "phase", "deja-dans-salle", "invalide", "dev", "serveur-plein"] as const;
    for (const r of raisons) for (const a of ["rejoindre", "creer", "lancer", "equipe"] as const) expect(libelleRefus(a, r).length, `${a}/${r}`).toBeGreaterThan(5);
    for (const c of ["version", "bonjour", "flood", "format", "serveur"] as const) expect(libelleErreur(c).length).toBeGreaterThan(5);
  });
});

describe("liste des parties ouvertes", () => {
  const p = (code: string, over: Partial<ResumeSalle> = {}): ResumeSalle => ({ code, hote: "Léa", format: "1v1", dureeS: 300, niveauBots: "pro", humains: 1, places: 2, ...over });
  it("triée par code (clés stables), bouton nommé par le code", () => {
    const l = lignesParties([p("TVWX"), p("BCDF"), p("MNPQ", { humains: 2 })]);
    expect(l.map((x) => x.code)).toEqual(["BCDF", "MNPQ", "TVWX"]);
    expect(l.map((x) => x.cle)).toEqual(["BCDF", "MNPQ", "TVWX"]);
    expect(l[0].libelleBouton).toBe("Rejoindre la partie BCDF");
    expect(l[0].occupation).toBe("1/2");
    expect(l[0].description).toBe("1v1 · Pro · 5 min");
    expect(l[1].complete).toBe(true);
    expect(l[0].complete).toBe(false);
  });
  it("ne modifie pas la liste reçue", () => {
    const src = [p("TVWX"), p("BCDF")];
    lignesParties(src);
    expect(src.map((x) => x.code)).toEqual(["TVWX", "BCDF"]);
  });
  it("aucun bouton de ligne ne s'appelle exactement « Rejoindre »", () => {
    for (const l of lignesParties([p("BCDF")])) expect(l.libelleBouton).not.toBe("Rejoindre");
  });
});

describe("vue du salon", () => {
  it("1v1 seul : deux colonnes, une place libre dans l'équipe adverse, pas lançable", () => {
    const v = vueSalon(salon(), 0);
    expect(v.code).toBe("BCDF");
    expect(v.codeEpele).toBe("B C D F");
    expect(v.estHote).toBe(true);
    expect(v.equipes.map((e) => e.nom)).toEqual(["Les Trèfles", "Les Tigres"]);
    expect(v.equipes[0].joueurs).toHaveLength(1);
    expect(v.equipes[0].libres).toBe(0);
    expect(v.equipes[1].libres).toBe(1);
    expect(v.equipes[1].peutRejoindre).toBe(true);
    expect(v.equipes[0].peutRejoindre).toBe(false);
    expect(v.equipes[0].mienne).toBe(true);
    expect(v.lancable).toBe(false);
    expect(v.raisonNonLancable).toBe("Il manque un joueur.");
    expect(v.resume).toBe("Vous contre 1 bot");
  });
  it("à deux dans des équipes opposées : « Vous contre 1 joueur », lançable pour l'hôte", () => {
    const e = salon({ joueurs: [joueur(0, "bleue"), joueur(1, "orange")], lancable: true, raisonNonLancable: undefined });
    const v = vueSalon(e, 0);
    expect(v.resume).toBe("Vous contre 1 joueur");
    expect(v.lancable).toBe(true);
    expect(v.raisonNonLancable).toBe("");
    expect(v.noteBots).toBe("");
    expect(libelleLancer(v)).toBe("Lancer la partie");
  });
  it("l'invité voit le même salon mais n'a pas de raison de grisé à lire ni de bouton de lancement", () => {
    const e = salon({ joueurs: [joueur(0, "bleue"), joueur(1, "orange")], lancable: true });
    const v = vueSalon(e, 1);
    expect(v.estHote).toBe(false);
    expect(v.moi?.id).toBe(1);
    expect(v.raisonNonLancable).toBe("");
    expect(libelleLancer(v)).toBe("En attente de l'hôte");
    expect(v.equipes[1].mienne).toBe(true);
  });
  it("2v2 : coéquipier humain et bots comptés pour chaque camp", () => {
    const e = salon({
      reglages: { ...REGLAGES_SALON_DEFAUT(), format: "2v2", niveauBots: "allstar" }, placesParEquipe: 2,
      joueurs: [joueur(0, "bleue"), joueur(1, "bleue")], lancable: true,
    });
    const v = vueSalon(e, 0);
    expect(v.resume).toBe("Vous et 1 joueur contre 2 bots");
    expect(v.noteBots).toContain("2 places libres seront tenues par des bots niveau All-Star");
    expect(v.equipes[0].libres).toBe(0);
    expect(v.equipes[1].libres).toBe(2);
    expect(v.equipes[1].peutRejoindre).toBe(true);
  });
  it("3v3 : un humain par camp, quatre bots, singulier et pluriel justes", () => {
    const e = salon({ reglages: { ...REGLAGES_SALON_DEFAUT(), format: "3v3" }, placesParEquipe: 3, joueurs: [joueur(0, "bleue"), joueur(1, "orange")] });
    expect(resumeEffectifsSalon(e, 0)).toBe("Vous et 2 bots contre 1 joueur et 2 bots");
    expect(vueSalon(e, 0).noteBots).toContain("4 places libres seront tenues par des bots");
  });
  it("équipe complète : on ne peut plus la rejoindre ; hors phase « salon » non plus", () => {
    const e = salon({ joueurs: [joueur(0, "bleue"), joueur(1, "orange")] });
    expect(vueSalon(e, 0).equipes[1].peutRejoindre).toBe(false);
    const enJeu = salon({ phase: "match", joueurs: [joueur(0, "bleue")] });
    expect(vueSalon(enJeu, 0).equipes[1].peutRejoindre).toBe(false);
  });
  it("chargement : décompte des joueurs connectés prêts", () => {
    const e = salon({ phase: "chargement", joueurs: [joueur(0, "bleue", { charge: true }), joueur(1, "orange"), joueur(2, "orange", { connecte: false })] });
    expect(vueSalon(e, 0).chargement).toEqual({ prets: 1, total: 2 });
    expect(libelleChargement({ prets: 1, total: 2 })).toBe("Chargement… 1/2 prêt");
    expect(libelleChargement({ prets: 2, total: 2 })).toBe("Chargement… 2/2 prêts");
    expect(vueSalon(salon(), 0).chargement).toBeNull();
  });
  it("un joueur inconnu de la liste (id périmé) ne casse rien", () => {
    const v = vueSalon(salon(), 99);
    expect(v.moi).toBeNull();
    expect(v.estHote).toBe(false);
    expect(v.equipes.every((e) => !e.peutRejoindre)).toBe(true);
  });
  it("revanche : votes comptés, mon vote reconnu, secondes arrondies au-dessus", () => {
    expect(resumeRevanche({ votes: { 0: true, 1: false }, restantMs: 14_200 }, 2, 0)).toEqual({ oui: 1, attendus: 2, aVote: true, restantS: 15 });
    expect(resumeRevanche({ votes: { 0: true }, restantMs: 0 }, 2, 1).aVote).toBe(false);
    expect(resumeRevanche(null, 2, 0)).toEqual({ oui: 0, attendus: 2, aVote: false, restantS: 0 });
    expect(resumeRevanche(undefined, 0, null).attendus).toBe(1);
  });
});

describe("état du lobby reconstitué par les messages", () => {
  const ouvert = () => appliquerConnexion(etatLobbyInitial(), "ouverte");
  const session: MessageServeur = { t: "session", code: "BCDF", joueur: 4, jeton: "0123456789abcdef0123456789abcdef" };
  const debut = (numero = 1): MessageServeur => ({
    t: "debut", numero, moi: 0, voitures: [],
    config: { format: "1v1", equipeJoueur: "bleue", niveauAllies: "pro", niveauAdversaires: "pro", dureeS: 300, graine: 1, nomsEquipes: { bleue: "Les Trèfles", orange: "Les Tigres" }, nomJoueur: "J" },
  });

  it("état initial : inactif, tout vide", () => {
    const e = etatLobbyInitial();
    expect(e).toMatchObject({ connexion: "inactif", salon: null, session: null, parties: null, debut: null, message: null, attente: null });
    expect(ecranLobby(e)).toBe("connexion");
  });
  it("bienvenue donne mon id ; le parcours création → session → salon → accueil du salon", () => {
    let e = appliquerMessage(ouvert(), { t: "bienvenue", v: 1, joueur: 4, maintenantMs: 0 });
    expect(e.joueur).toBe(4);
    expect(ecranLobby(e)).toBe("accueil");
    e = attendre(e, "creer");
    expect(e.attente).toBe("creer");
    e = appliquerMessage(e, session);
    expect(e.session).toEqual({ code: "BCDF", joueur: 4, jeton: "0123456789abcdef0123456789abcdef" });
    expect(e.attente).toBeNull();
    e = appliquerMessage(e, { t: "salon", salon: salon() });
    expect(e.salon?.code).toBe("BCDF");
    expect(ecranLobby(e)).toBe("salon");
  });
  it("chargement puis début : l'écran passe à « chargement », debut mémorisé", () => {
    let e = appliquerMessage(ouvert(), { t: "salon", salon: salon({ phase: "chargement" }) });
    expect(ecranLobby(e)).toBe("chargement");
    e = appliquerMessage(e, debut(7));
    expect(e.debut?.numero).toBe(7);
  });
  it("le retour au salon (revanche refusée, retour de l'hôte) efface le début", () => {
    let e = appliquerMessage(ouvert(), debut());
    e = appliquerMessage(e, { t: "salon", salon: salon({ phase: "match" }) });
    expect(e.debut).not.toBeNull();
    e = appliquerMessage(e, { t: "salon", salon: salon({ phase: "fin" }) });
    expect(e.debut).not.toBeNull();
    e = appliquerMessage(e, { t: "salon", salon: salon({ phase: "salon" }) });
    expect(e.debut).toBeNull();
  });
  it("une seconde `debut` (revanche, reprise) remplace la première", () => {
    let e = appliquerMessage(ouvert(), debut(1));
    e = appliquerMessage(e, debut(2));
    expect(e.debut?.numero).toBe(2);
  });
  it("salon nul : accusé de départ silencieux, expiration et fermeture expliquées, tout est remis à zéro", () => {
    let e = appliquerMessage(appliquerMessage(ouvert(), session), { t: "salon", salon: salon() });
    const quitte = appliquerMessage(e, { t: "salon", salon: null, raison: "quitte" });
    expect(quitte).toMatchObject({ salon: null, session: null, debut: null, message: null });
    expect(appliquerMessage(e, { t: "salon", salon: null, raison: "expire" }).message?.texte).toContain("inactif");
    expect(appliquerMessage(e, { t: "salon", salon: null, raison: "ferme" }).message?.texte).toContain("fermé");
    const expulse = appliquerMessage(e, { t: "salon", salon: null, raison: "expulse" }).message;
    expect(expulse).toMatchObject({ genre: "erreur" });
    e = quitte;
    expect(ecranLobby(e)).toBe("accueil");
  });
  it("refus et erreur : message en français, demande en attente levée", () => {
    let e = attendre(ouvert(), "rejoindre");
    e = appliquerMessage(e, { t: "refus", action: "rejoindre", raison: "inconnue" });
    expect(e.attente).toBeNull();
    expect(e.message).toEqual({ genre: "erreur", texte: "Aucune partie ne porte ce code." });
    e = appliquerMessage(attendre(ouvert(), "creer"), { t: "erreur", code: "serveur", message: "interne" });
    expect(e.message?.genre).toBe("erreur");
    expect(e.attente).toBeNull();
  });
  it("une nouvelle demande efface l'ancien message d'erreur", () => {
    let e = appliquerMessage(ouvert(), { t: "refus", action: "creer", raison: "limite" });
    expect(e.message).not.toBeNull();
    e = attendre(e, "creer");
    expect(e.message).toBeNull();
  });
  it("reprise refusée : la session est oubliée ; acceptée : message d'information", () => {
    const avec = appliquerMessage(ouvert(), session);
    expect(appliquerMessage(avec, { t: "reprise", code: null }).session).toBeNull();
    const ok = appliquerMessage(avec, { t: "reprise", code: "BCDF" });
    expect(ok.session).not.toBeNull();
    expect(ok.message?.genre).toBe("info");
  });
  it("la liste des parties est gardée telle quelle", () => {
    const parties: ResumeSalle[] = [{ code: "BCDF", hote: "Léa", format: "1v1", dureeS: 300, niveauBots: "pro", humains: 1, places: 2 }];
    expect(appliquerMessage(ouvert(), { t: "liste", parties }).parties).toEqual(parties);
  });
  it("les messages de jeu ne touchent pas au lobby (même objet)", () => {
    const e = ouvert();
    for (const m of [{ t: "pong", c: 1, tick: 2, ralenti: false }, { t: "ev", evenements: [] }, { t: "presence", joueur: 1, etat: "coupe" }] as MessageServeur[]) {
      expect(appliquerMessage(e, m)).toBe(e);
    }
  });
  it("ne modifie jamais l'état reçu", () => {
    const e = ouvert();
    const copie = JSON.stringify(e);
    appliquerMessage(e, session);
    appliquerMessage(e, { t: "salon", salon: salon() });
    quitterSalonLocalement(e);
    expect(JSON.stringify(e)).toBe(copie);
  });
  it("fermeture ou refus de version : le salon affiché est retiré, la raison gardée", () => {
    let e = appliquerMessage(appliquerMessage(ouvert(), session), { t: "salon", salon: salon() });
    e = appliquerConnexion(e, "fermee", "injoignable");
    expect(e).toMatchObject({ connexion: "fermee", fermeture: "injoignable", salon: null, session: null, parties: null });
    expect(ecranLobby(e)).toBe("connexion");
    const r = appliquerConnexion(ouvert(), "refusee", "version");
    expect(r.fermeture).toBe("version");
  });
  it("reconnexion : le salon reste affiché (la reprise est tentée), puis la raison est effacée", () => {
    let e = appliquerMessage(appliquerMessage(ouvert(), session), { t: "salon", salon: salon() });
    e = appliquerConnexion(e, "reconnexion");
    expect(e.salon).not.toBeNull();
    expect(ecranLobby(e)).toBe("salon");
    e = appliquerConnexion({ ...e, fermeture: "coupure" }, "ouverte");
    expect(e.fermeture).toBeNull();
  });
  it("départ volontaire : accusé local sans attendre le serveur", () => {
    const e = quitterSalonLocalement(appliquerMessage(appliquerMessage(ouvert(), session), { t: "salon", salon: salon() }));
    expect(e).toMatchObject({ salon: null, session: null, debut: null });
    expect(e.connexion).toBe("ouverte");
  });
});
