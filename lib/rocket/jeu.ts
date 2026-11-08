/**
 * Rocket Muche : la boucle du jeu (le SEUL module qui assemble tout, avec three, le DOM et l'horloge).
 *
 * Montée par `import("@/lib/rocket/jeu")` depuis `Agroparc3D.tsx` (jamais d'import statique : ni three ni le jeu n'entrent dans le premier
 * chargement de la page du menu). Elle crée le renderer, le décor d'Agroparc autour du stade (sans le mobilier posé sur le stade),
 * le rendu filaire du stade (`rendu.ts`), les sons, les entrées, la caméra, les cerveaux des bots, et fait tourner :
 *
 *   image (rAF) → entrées → accumulateur de pas fixes (120 Hz, au plus 6 pas, ralenti ×0,5 pendant la célébration d'un but)
 *               → cerveaux des bots + `pasMonde` → événements (HUD, sons, rendu, vibrations, secousse)
 *               → caméra (état INTERPOLÉ de la voiture : sinon elle tremble par rapport à la voiture dessinée) → rendu → bloom.
 *
 * Pause : Échap (ou perte de focus, onglet masqué, Start de la manette). Échap n'ENTRE en pause qu'ici ; en pause c'est le menu React
 * (« Reprendre ») qui la quitte par `pause(false)`, pour qu'une seule touche ne fasse pas l'aller-retour. À la reprise l'accumulateur est
 * remis à zéro (aucun rattrapage du temps perdu). Mouvement réduit (`prefers-reduced-motion`) : pas de secousse, pas de vibration,
 * point de vue fixe pendant la célébration, rendu sans public ni flash.
 *
 * Crochet de développement (hors production) : `window.__rocket` (type `CrochetRocket` du contrat) pour les captures et l'e2e.
 *
 * EN LIGNE (`opts.enLigne`, spec 2026-11-08-rocket-en-ligne-design.md § 9.4) : la même boucle, mais le monde vient du prédicteur (`reseau/prediction.ts`) au
 * lieu de l'accumulateur local. Aucun cerveau local, aucune pause (le menu ouvert ou l'onglet masqué rendent les commandes neutres, la partie continue),
 * l'affichage lit le monde AFFICHÉ (corrections visuelles et garde de phase), le HUD réseau remonte par `hudReseau`, `recommencer()` vote la revanche.
 * Le jeu écoute lui-même le client : une seconde `debut` (revanche, reprise) recrée le prédicteur, renderer conservé, et il envoie TOUJOURS `pret`.
 * Toute la logique qui ne touche ni three ni le DOM est dans `jeu-en-ligne.ts` (testée). Crochet de développement : `window.__rocketReseau`.
 * Spec : docs/superpowers/specs/2026-11-06-rocket-agroparc-design.md (§ 8, § 10, § 11 F)
 */
import * as THREE from "three";
import type { SceneData } from "../agroparc3d/types";
import { C, construireDecor, qualiteParDefaut } from "../agroparc3d/decor";
import { creerPostTraitement, type PostTraitement } from "../fps/rendu";
import {
  MATCH,
  PAS_S,
  boitesExclusionSite,
  type BanniereHud,
  type Cerveau,
  type ConfigMatch,
  type CreerJeuRocket,
  type CrochetRocket,
  type EntreesCamera,
  type EntreesVoiture,
  type EtatBalle,
  type EtatCamera,
  type EtatVoiture,
  type EvenementMatch,
  type HudRocket,
  type JeuRocketHandle,
  type LigneClassement,
  type MondeRocket,
  type OptionsJeuRocket,
  type PoseCamera,
  type ReglagesRocket,
  type RenduRocket,
  type ResultatMatch,
  type SonsRocket,
} from "./contrat";
import { avancerAccumulateur, creerAccumulateur } from "./boucle";
import { ajouterSecousse, creerEtatCamera, majCamera, majCameraBut } from "./camera";
import { BOUTON_MANETTE, creerSourceEntrees, entreesJoueurNulles, type SourceEntreesEtendue } from "./entrees";
import { creerArene } from "./arene";
import { creerMonde, pasMonde, resultatMatch } from "./match";
import { creerCerveau } from "./bots";
import { replacerVoiture } from "./voiture";
import { creerRenduRocket } from "./rendu";
import { creerSonsRocket } from "./sons";
import {
  choisirSource, creerCanalDegrade, creerEmetteurHudReseau, creerSourceEnLigne, creerSuiviPresence, creerSuiviRevanche, construireHudReseau, entreesEffectives, etatCommandes,
  type SourceMonde,
} from "./jeu-en-ligne";
import { creerHorloge } from "./reseau/horloge";
import { creerPredicteur } from "./reseau/prediction";
import { RESEAU, type CrochetRocketReseau, type HudReseau, type MessageServeur, type OptionsJeuRocketAvecLigne, type PredicteurRocket } from "./reseau/protocole";
import type { ClientRocketEtendu } from "./reseau/client";
import { affecter, affecterBase, distance, melanger, norme, reorthonormaliser, type Base, type Vec3 } from "./vec";

/** Poignée rendue par `creerJeuRocket` : le contrat (`JeuRocketHandle`) plus deux accès pour l'interface et les tests. */
export interface JeuRocketHandleEtendu extends JeuRocketHandle {
  /** dernier état du HUD envoyé à l'interface (null avant la première image) */
  etat(): HudRocket | null;
  /** abonne un écouteur aux événements du match (annonces vocales, journal) ; rend la fonction de désabonnement */
  surEvenement(cb: (e: Readonly<EvenementMatch>) => void): () => void;
  /** alias français de `dispose` */
  detruire(): void;
}

/** Écart entre deux envois du HUD (s) : 20 Hz. */
const ECART_HUD_S = 0.05;
/** Durée pendant laquelle l'aide des touches reste affichée (s). */
const AIDE_S = 8;
/** Durée d'une ligne du fil d'événements (s) et nombre de lignes. */
const FIL_DUREE_S = 5;
const FIL_LIGNES = 6;
/** Délai avant d'afficher l'écran de fin (la caméra de célébration a le temps de tourner) (s). */
const DELAI_RESULTAT_S = 2.5;
/** Un déplacement plus grand que cela entre deux pas est une téléportation (réapparition, coup d'envoi) : pas d'interpolation (m). */
const SEUIL_TELEPORT_M = 3;
/** Nombre d'erreurs consécutives dans la boucle avant d'abandonner la partie. */
const ERREURS_MAX = 3;

const copierConfig = (c: Readonly<ConfigMatch>): ConfigMatch => ({ ...c, nomsEquipes: { ...c.nomsEquipes } });
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Base interpolée entre deux pas (petits angles : interpolation linéaire des axes puis réorthonormalisation). */
function interpolerBase(a: Readonly<Base>, b: Readonly<Base>, t: number): Base {
  return reorthonormaliser({ avant: melanger(a.avant, b.avant, t), droite: melanger(a.droite, b.droite, t), haut: melanger(a.haut, b.haut, t) });
}

/** Copie la position du pas courant dans `precedent` (plus d'interpolation sur ce pas : voiture ou balle téléportée). */
function aligner(m: MondeRocket, idVoiture?: number): void {
  m.voitures.forEach((v, i) => {
    if (idVoiture !== undefined && i !== idVoiture) return;
    const pr = m.precedent.voitures[i];
    if (!pr) return;
    affecter(pr.p, v.p);
    affecterBase(pr.base, v.base);
  });
  if (idVoiture === undefined) affecter(m.precedent.balle.p, m.balle.p);
}

/**
 * Jeu inerte rendu quand le démarrage échoue (le message est déjà parti par `opts.erreur`) : toutes les méthodes sont des no-op sûrs.
 */
function jeuInerte(): JeuRocketHandleEtendu {
  const rien = () => {};
  return {
    dispose: rien, detruire: rien, pause: rien, estEnPause: () => false, recommencer: rien, reglages: rien, basculerBalleCam: rien,
    afficherClassement: rien, etat: () => null, surEvenement: () => rien,
  };
}

/**
 * Crée la partie sur `canvas` (déjà monté par la vue, sans autre contexte). `data` est la scène d'Agroparc (le décor autour du stade).
 * Aucune exception ne sort : un échec (WebGL absent, contexte perdu) appelle `opts.erreur` et rend un jeu inerte.
 */
export function creerJeuRocket(canvas: HTMLCanvasElement, data: SceneData, opts: OptionsJeuRocketAvecLigne): JeuRocketHandleEtendu {
  let reglages: ReglagesRocket = opts.reglages;
  let config: ConfigMatch = copierConfig(opts.config);
  /** partie en ligne (null : jeu local contre des bots, comportement historique) */
  const enLigne = choisirSource(opts) === "ligne" ? opts.enLigne ?? null : null;
  const reduit = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- rendu three ----------
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  } catch (err) {
    opts.erreur("Votre navigateur ne peut pas afficher la 3D (WebGL indisponible).");
    if (process.env.NODE_ENV !== "production") console.error("rocket : WebGL", err);
    return jeuInerte();
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(C.ground, 1);
  const sceneThree = new THREE.Scene();
  sceneThree.fog = new THREE.FogExp2(C.ground, 0.0013);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 3000);
  sceneThree.add(camera);

  // Tout ce qui suit peut lever (géométries, nuanceurs) : en cas d'échec on libère le renderer et on rend la main sans exception.
  let decor: THREE.Group | null = null;
  let post: PostTraitement | null = null;
  let rendu: RenduRocket | null = null;
  let sons: SonsRocket | null = null;
  let source: SourceEntreesEtendue | null = null;
  const liberer = () => {
    sons?.dispose();
    source?.dispose();
    rendu?.dispose();
    decor?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    post?.dispose();
    renderer.dispose();
    // rend le contexte WebGL tout de suite (Chrome n'en garde que 16 actifs)
    renderer.forceContextLoss();
  };

  const arene = creerArene();
  const horloge = enLigne ? creerHorloge() : null;
  const sansRendu = !!enLigne?.sansRendu;
  let predicteur: PredicteurRocket | null = null;
  if (enLigne && horloge) {
    try {
      predicteur = creerPredicteur({ horloge, debut: enLigne.debut, arene });
    } catch (err) {
      liberer();
      opts.erreur("La partie en ligne n'a pas pu démarrer.");
      if (process.env.NODE_ENV !== "production") console.error("rocket : prédicteur", err);
      return jeuInerte();
    }
  }
  let monde: MondeRocket = predicteur ? predicteur.monde : creerMonde(config, arene);
  let cerveaux: (Cerveau | null)[] = [];
  /** surcharge des entrées d'une voiture par le crochet de développement (null = entrées normales) */
  const surcharges: (EntreesVoiture | null)[] = [];

  function creerCerveaux(): (Cerveau | null)[] {
    // en ligne, les bots tournent sur le serveur : le client ne simule jamais un cerveau
    if (enLigne) return [];
    return monde.voitures.map((v) => (v.humain
      ? null
      : creerCerveau(v.equipe === config.equipeJoueur ? config.niveauAllies : config.niveauAdversaires, (Math.imul(config.graine, 2654435761) + v.id * 40503 + 1) >>> 0)));
  }

  try {
    decor = new THREE.Group();
    sceneThree.add(decor);
    // le mobilier, les haies, les pelouses et les places sont retirés dans le rectangle du stade (+ gradins) ; routes, bâtiments et arbres restent
    construireDecor(decor, data, { fantomes: false, ambiance: "complete", qualite: qualiteParDefaut(), exclure: boitesExclusionSite() });
    post = creerPostTraitement(renderer, sceneThree, camera);
    const s: SonsRocket = creerSonsRocket();
    sons = s;
    s.volume(reglages.volume);
    s.activer();
    cerveaux = creerCerveaux();
    source = creerSourceEntrees(window, () => reglages.touches, () => reglages);
  } catch (err) {
    liberer();
    opts.erreur("Le jeu n'a pas pu démarrer.");
    if (process.env.NODE_ENV !== "production") console.error("rocket : démarrage", err);
    return jeuInerte();
  }
  const postOk: PostTraitement = post;
  const sonsOk: SonsRocket = sons;
  const sourceOk: SourceEntreesEtendue = source;

  function monterRendu(): void {
    if (rendu) {
      camera.removeFromParent();
      sceneThree.remove(rendu.racine);
      rendu.dispose();
    }
    const r: RenduRocket = creerRenduRocket(monde, { qualite: qualiteParDefaut(), mouvementReduit: reduit, nomsEquipes: config.nomsEquipes });
    rendu = r;
    sceneThree.add(r.racine);
    // la caméra est un enfant de la racine : elle se place directement dans le repère LOCAL du stade
    r.racine.add(camera);
    r.synchroniser(monde, 1, 0);
  }
  try {
    monterRendu();
  } catch (err) {
    liberer();
    opts.erreur("Le stade n'a pas pu être construit.");
    if (process.env.NODE_ENV !== "production") console.error("rocket : rendu", err);
    return jeuInerte();
  }

  // ---------- état de la boucle ----------
  const acc = creerAccumulateur();
  let alpha = 1;
  let disposed = false;
  let enPause = false;
  let gele = false;
  let raf = 0;
  let derniereT: number | null = null;
  /** la première image après une reprise ne verse pas de temps */
  let reprise = false;
  /** temps réel de l'image courante (s) */
  let tReel = 0;
  let tDebut: number | null = null;
  let tFini: number | null = null;
  let erreursConsecutives = 0;
  let classementOuvert = false;
  let balleCam = false;
  let balleCamPrecedent = false;
  let klaxonPrecedent = false;
  let startPrecedent = false;
  let retourPrecedent = false;
  let etatCam: EtatCamera = creerEtatCamera(monde.voitures[monde.idHumain], monde.balle, false);
  let resultatCache: ResultatMatch | null = null;
  /** EN LIGNE : résultat envoyé par le serveur (message `fin`) ; le monde prédit ne décide jamais de la fin */
  let resultatServeur: ResultatMatch | null = null;
  let dernierHud: HudRocket | null = null;
  let tHud = -1;
  let hudSale = true;
  let idBanniere = 0;
  let banniere: (BanniereHud & { fin: number }) | null = null;
  let idFil = 0;
  let fil: { id: number; texte: string; equipe: "bleue" | "orange" | null; fin: number }[] = [];
  const journal: EvenementMatch[] = [];
  const abonnes = new Set<(e: Readonly<EvenementMatch>) => void>();
  const entreesPas: EntreesVoiture[] = [];
  /** dernières entrées de l'humain (le pas du crochet `avancer` les réutilise) */
  let entreesHumain: EntreesVoiture = entreesJoueurNulles().voiture;
  /** état affiché de la voiture et de la balle (interpolé) */
  let moiAffichee: EtatVoiture = monde.voitures[monde.idHumain];
  let balleAffichee: EtatBalle = monde.balle;
  const matriceVue = new THREE.Matrix4();
  const oeil = new THREE.Vector3(), visee = new THREE.Vector3(), haut = new THREE.Vector3();

  const nomVoiture = (id: number | null): string => (id === null ? "" : monde.voitures[id]?.nom ?? "");
  const moi = (): EtatVoiture => monde.voitures[monde.idHumain];
  /** la partie est finie (fonction : `pasUnique` change la phase sous les yeux du compilateur) */
  const finie = (): boolean => monde.phase === "fini";

  // ---------- HUD ----------
  function annoncer(texte: string, dureeS: number, sousTexte?: string, equipe?: "bleue" | "orange" | null): void {
    banniere = { id: ++idBanniere, texte, sousTexte, equipe: equipe ?? null, dureeS, fin: tReel + dureeS };
    hudSale = true;
  }
  function ecrireFil(texte: string, equipe: "bleue" | "orange" | null): void {
    fil.push({ id: ++idFil, texte, equipe, fin: tReel + FIL_DUREE_S });
    if (fil.length > FIL_LIGNES * 2) fil = fil.slice(-FIL_LIGNES * 2);
    hudSale = true;
  }
  const lignesClassement = (): LigneClassement[] =>
    monde.voitures.map((v) => ({ id: v.id, nom: v.nom, equipe: v.equipe, humain: v.humain, stats: { ...v.stats } }));

  function construireHud(): HudRocket {
    const m = moi();
    // le résultat n'apparaît qu'après la première célébration de la fin
    let resultat: ResultatMatch | null;
    if (enLigne) {
      if (resultatServeur && tFini !== null && tReel - tFini >= DELAI_RESULTAT_S) resultatCache ??= resultatServeur;
      resultat = resultatCache;
    } else {
      if (monde.phase === "fini" && tFini !== null && tReel - tFini >= DELAI_RESULTAT_S) resultatCache ??= resultatMatch(monde);
      resultat = monde.phase === "fini" ? resultatCache : null;
    }
    return {
      phase: monde.phase,
      score: { ...monde.score },
      nomsEquipes: { ...config.nomsEquipes },
      tempsRestant: Math.max(0, Math.ceil(monde.tempsRestant)),
      prolongation: monde.prolongation,
      decompte: monde.phase === "decompte" ? Math.min(3, Math.max(1, Math.ceil(MATCH.decompteS - monde.tempsPhase))) : null,
      boost: Math.round(m.boost),
      vitesseKmh: Math.round(norme(m.v) * 3.6),
      supersonique: m.supersonique,
      demolie: m.demolie,
      reapparitionDans: m.demolie ? Math.max(0, m.reapparitionDans) : 0,
      equipeJoueur: enLigne ? m.equipe : config.equipeJoueur,
      balleCam: balleCam || m.demolie,
      banniere: banniere && banniere.fin > tReel ? { id: banniere.id, texte: banniere.texte, sousTexte: banniere.sousTexte, equipe: banniere.equipe, dureeS: banniere.dureeS } : null,
      fil: fil.filter((l) => l.fin > tReel).slice(-FIL_LIGNES).map(({ id, texte, equipe }) => ({ id, texte, equipe })),
      enPause,
      manette: sourceOk.manetteConnectee(),
      aide: !aideMasquee && (tDebut === null || tReel - tDebut < AIDE_S) && !enPause && monde.phase !== "fini",
      classement: classementOuvert || resultat ? lignesClassement() : [],
      resultat,
    };
  }
  function envoyerHud(force: boolean): void {
    // envoi immédiat sur changement (événement, pause…), sinon au plus 20 Hz
    if (!force && !hudSale && tReel - tHud < ECART_HUD_S) return;
    tHud = tReel;
    hudSale = false;
    dernierHud = construireHud();
    try { opts.hud(dernierHud); } catch (err) { if (process.env.NODE_ENV !== "production") console.error("rocket : hud", err); }
  }

  // ---------- événements ----------
  function vibrer(intensite: number, dureeMs: number): void {
    if (reduit || !reglages.vibrations) return;
    sourceOk.vibrer(intensite, dureeMs);
  }

  function traiter(e: EvenementMatch): void {
    journal.push(e);
    if (journal.length > 200) journal.shift();
    rendu?.evenement(e, monde);
    sonsOk.evenement(e, monde.idHumain);
    for (const cb of abonnes) cb(e);
    const mien = monde.idHumain;
    switch (e.t) {
      case "decompte":
        annoncer(String(e.n), 0.9);
        break;
      case "coupDEnvoi":
        annoncer("GO !", 0.8);
        balleCam = reglages.balleCamParDefaut;
        break;
      case "toucheBalle":
        if (e.idVoiture === mien) {
          ajouterSecousse(etatCam, Math.min(0.14, e.force * 0.006));
          if (e.force > 6) vibrer(Math.min(1, e.force / 30), 90);
        }
        break;
      case "but": {
        const buteur = nomVoiture(e.idMarqueur);
        const passe = nomVoiture(e.idPasse);
        const equipe = config.nomsEquipes[e.equipe];
        annoncer("BUT !", MATCH.celebrationS - 0.5, buteur ? (passe ? `${buteur} · passe : ${passe}` : buteur) : equipe, e.equipe);
        ecrireFil(`BUT ! ${buteur || equipe}${passe ? ` (passe : ${passe})` : ""} · ${Math.round(e.vitesseKmh)} km/h`, e.equipe);
        ajouterSecousse(etatCam, 0.2);
        vibrer(0.8, 250);
        break;
      }
      case "demolition": {
        ecrireFil(`${nomVoiture(e.auteur)} démolit ${nomVoiture(e.victime)}`, monde.voitures[e.auteur]?.equipe ?? null);
        if (e.auteur === mien) { annoncer("DÉMOLITION", 1.4, nomVoiture(e.victime), monde.voitures[mien].equipe); vibrer(0.7, 200); }
        if (e.victime === mien) { ajouterSecousse(etatCam, 0.25); vibrer(1, 300); }
        break;
      }
      case "reapparition":
        if (e.idVoiture === mien) {
          // retour à la ball cam voulue et caméra remise derrière la voiture (elle vient d'être déplacée)
          balleCam = reglages.balleCamParDefaut;
          etatCam = creerEtatCamera(moi(), monde.balle, balleCam);
        }
        // en ligne le prédicteur a déjà placé `precedent` (il lisse lui-même les corrections)
        if (!enLigne) aligner(monde, e.idVoiture);
        break;
      case "bump":
        if (e.idVoiture === mien || e.autre === mien) { ajouterSecousse(etatCam, 0.06); vibrer(0.4, 80); }
        break;
      case "atterrissage":
        if (e.idVoiture === mien && e.vitesse > 4) vibrer(0.3, 80);
        break;
      case "prolongation":
        annoncer("PROLONGATION", 3);
        ecrireFil("Prolongation : le prochain but gagne", null);
        break;
      case "fin":
        ecrireFil(e.vainqueur ? `Victoire : ${config.nomsEquipes[e.vainqueur]}` : "Match nul", e.vainqueur);
        break;
      default:
        break;
    }
  }

  // ---------- un pas de physique ----------
  function pasUnique(humain: Readonly<EntreesVoiture>, sortie?: EvenementMatch[]): void {
    const n = monde.voitures.length;
    entreesPas.length = n;
    for (let i = 0; i < n; i++) {
      const v = monde.voitures[i];
      entreesPas[i] = surcharges[i] ?? (v.humain ? (humain as EntreesVoiture) : cerveaux[i]?.decider(monde, v, PAS_S) ?? entreesJoueurNulles().voiture);
    }
    const phaseAvant = monde.phase;
    const resteAvant = monde.tempsRestant;
    const evs = pasMonde(monde, entreesPas);
    for (const e of evs) { traiter(e); sortie?.push(e); }
    apresPas(phaseAvant, resteAvant);
  }

  /** Suites d'un pas (ou, en ligne, d'une image) : changement de phase, annonce des 30 dernières secondes. */
  function apresPas(phaseAvant: MondeRocket["phase"], resteAvant: number): void {
    if (monde.phase !== phaseAvant) {
      if (monde.phase === "decompte") {
        // nouveau coup d'envoi : tout a été replacé, plan fixe en car cam, plus aucune interpolation
        balleCam = false;
        if (!enLigne) aligner(monde);
        etatCam = creerEtatCamera(moi(), monde.balle, false);
        hudSale = true;
      } else if (monde.phase === "fini") {
        // en ligne la fin vient du serveur (`fin`) : `tFini` y est posé à sa réception
        if (!enLigne) tFini = tReel;
        hudSale = true;
      } else hudSale = true;
    }
    if (monde.phase === "enJeu" && !monde.prolongation && resteAvant > 30 && monde.tempsRestant <= 30) annoncer("PLUS QUE 30 SECONDES", 2.5);
  }

  // ---------- caméra ----------
  function etatAffiche(): void {
    const v = moi();
    const pr = monde.precedent.voitures[v.id];
    const a = clamp01(alpha);
    if (pr && distance(pr.p, v.p) < SEUIL_TELEPORT_M) {
      moiAffichee = { ...v, p: melanger(pr.p, v.p, a), base: interpolerBase(pr.base, v.base, a) };
    } else moiAffichee = v;
    const pb = monde.precedent.balle.p;
    balleAffichee = distance(pb, monde.balle.p) < SEUIL_TELEPORT_M ? { ...monde.balle, p: melanger(pb, monde.balle.p, a) } : monde.balle;
  }

  let aideMasquee = false;
  let boutonAPrecedent = false;
  let enCameraBut = false;
  let tempsCameraBut = 0;
  let marqueurCameraBut: EtatVoiture | null = null;

  function placerCamera(dt: number, entree: { regard: readonly [number, number]; arriere: boolean }): PoseCamera {
    const aspect = camera.aspect > 0 ? camera.aspect : 1;
    let pose: PoseCamera;
    if (monde.phase === "but" || monde.phase === "fini") {
      // `monde.tempsPhase` retombe à 0 (et y reste) en « fini » : la caméra a son propre chronomètre, qui court du premier but
      // jusqu'au retour en jeu, pour que l'orbite continue de tourner et ne saute pas quand le dernier but fait passer en « fini »
      if (!enCameraBut) { enCameraBut = true; tempsCameraBut = 0; marqueurCameraBut = null; }
      tempsCameraBut += dt;
      if (monde.phase === "but" && monde.dernierBut?.idMarqueur != null) marqueurCameraBut = monde.voitures[monde.dernierBut.idMarqueur] ?? null;
      pose = majCameraBut(etatCam, reglages.camera, balleAffichee, marqueurCameraBut, arene, tempsCameraBut, dt, aspect, reduit);
    } else {
      enCameraBut = false;
      const ec: EntreesCamera = { balleCam: balleCam || moiAffichee.demolie, regard: entree.regard, arriere: entree.arriere };
      pose = majCamera(etatCam, reglages.camera, ec, moiAffichee, balleAffichee, arene, dt, aspect, reduit);
    }
    // la caméra est un enfant de la racine du stade : position et orientation sont déjà dans le repère local
    oeil.set(pose.position[0], pose.position[1], pose.position[2]);
    visee.set(pose.cible[0], pose.cible[1], pose.cible[2]);
    haut.set(pose.haut[0], pose.haut[1], pose.haut[2]);
    camera.position.copy(oeil);
    matriceVue.lookAt(oeil, visee, haut);
    camera.quaternion.setFromRotationMatrix(matriceVue);
    if (Math.abs(camera.fov - pose.fovVertical) > 1e-3) { camera.fov = pose.fovVertical; camera.updateProjectionMatrix(); }
    return pose;
  }

  // ---------- taille ----------
  function redimensionner(): void {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    postOk.redimensionner(w, h);
    rendu?.redimensionner(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  redimensionner();
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(redimensionner) : null;
  ro?.observe(canvas);

  // ---------- pause ----------
  function pause(actif: boolean): void {
    if (disposed || actif === enPause) return;
    enPause = actif;
    sourceOk.relacher();
    classementOuvert = false;
    // en ligne le « menu pause » ne gèle rien (la partie continue pour les autres) : ni son coupé, ni temps à ne pas rattraper
    if (!enLigne) {
      sonsOk.suspendre(actif);
      // à la reprise : aucun rattrapage du temps passé en pause
      reprise = true;
      acc.reste = 0;
    }
    canvas.style.cursor = actif ? "" : "none";
    hudSale = true;
    envoyerHud(true);
  }

  // ---------- écouteurs ----------
  const surKeyDown = (e: KeyboardEvent) => {
    const cible = e.target as Partial<HTMLElement> | null;
    const interactif = !!cible && typeof cible.tagName === "string" && /^(input|textarea|select)$/i.test(cible.tagName);
    if (interactif || e.repeat) return;
    if (reglages.touches.pause.includes(e.code) && !enPause) { pause(true); return; }
    if (e.code === "Tab" && !enPause) { e.preventDefault(); classementOuvert = true; hudSale = true; }
  };
  const surKeyUp = (e: KeyboardEvent) => {
    if (e.code === "Tab" && classementOuvert) { e.preventDefault(); classementOuvert = false; hudSale = true; }
  };
  // en ligne, perdre le focus ou masquer l'onglet ne met rien en pause : les commandes deviennent neutres (voir `etatCommandes`) et la partie continue
  const surBlur = () => { if (!enLigne && !enPause && monde.phase !== "fini") pause(true); };
  const surVisibilite = () => { if (!enLigne && document.visibilityState === "hidden" && !enPause) pause(true); };
  /** le contexte audio ne démarre qu'après un geste : on le relance au premier appui (clavier ou souris) */
  const surGeste = () => {
    sonsOk.activer();
    window.removeEventListener("pointerdown", surGeste);
    window.removeEventListener("keydown", surGeste);
  };
  const surContexteWebGLPerdu = (e: Event) => {
    e.preventDefault();
    arreterBoucle();
    opts.erreur("Le contexte graphique a été perdu. Quittez puis relancez la partie.");
  };
  window.addEventListener("keydown", surKeyDown);
  window.addEventListener("keyup", surKeyUp);
  window.addEventListener("blur", surBlur);
  window.addEventListener("pointerdown", surGeste);
  window.addEventListener("keydown", surGeste);
  document.addEventListener("visibilitychange", surVisibilite);
  canvas.addEventListener("webglcontextlost", surContexteWebGLPerdu);
  canvas.style.cursor = "none";

  // ---------- en ligne : source de monde, messages du serveur, HUD réseau, crochet d'essai ----------
  /** commandes neutres parce que l'onglet est masqué simulé par le crochet d'essai (le vrai masquage se lit dans `document.visibilityState`) */
  let masqueSimule = false;
  const ongletMasque = (): boolean => masqueSimule || (typeof document !== "undefined" && document.visibilityState === "hidden");
  let surchargeMoi: EntreesVoiture | null = null;
  let snapsRecus = 0;
  let trames = 0;
  let derniereAvance = 0;
  let debutCourant = enLigne ? enLigne.debut : null;
  let hudReseauCourant: HudReseau | null = null;
  let phasePrecedente: MondeRocket["phase"] = monde.phase;
  let restePrecedent = monde.tempsRestant;
  const maintenantMs = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const canal = creerCanalDegrade({ maintenant: maintenantMs, setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) });
  const nomDeJoueur = (j: number): string => debutCourant?.voitures.find((v) => v.joueur === j)?.nom ?? "Joueur";
  const suiviPresence = creerSuiviPresence(nomDeJoueur);
  const suiviRevanche = creerSuiviRevanche();
  const emetteurReseau = creerEmetteurHudReseau((h) => {
    hudReseauCourant = h;
    try { enLigne?.hudReseau(h); } catch (err) { if (process.env.NODE_ENV !== "production") console.error("rocket : hud réseau", err); }
  });
  let sourceMonde: (SourceMonde & ReturnType<typeof creerSourceEnLigne>) | null = null;
  const fabriquerSource = (p: PredicteurRocket) => creerSourceEnLigne({ predicteur: p, envoyerTrame: (t) => { trames++; canal.sortir(() => enLigne?.client.envoyerTrame(t)); } });
  if (enLigne && predicteur) sourceMonde = fabriquerSource(predicteur);

  /** Messages du serveur qui concernent la partie (le lobby, lui, est servi par le hook de l'interface). */
  function surMessage(m: MessageServeur): void {
    if (disposed || !enLigne || !sourceMonde) return;
    const t = maintenantMs();
    switch (m.t) {
      case "pong": horloge?.echantillonPong(m.c, t, m.tick, m.ralenti); break;
      case "ev": sourceMonde.recevoirEvenements(m.evenements); break;
      case "presence": suiviPresence.appliquer(m, t); break;
      case "salon": suiviRevanche.appliquer(m.salon, t); break;
      case "fin":
        resultatServeur = m.resultat;
        if (tFini === null) tFini = tReel;
        hudSale = true;
        break;
      case "debut": nouvelleDebut(m); break;
      default: break;
    }
  }

  /**
   * Seconde `debut` (revanche, reprise après une coupure) : nouveau monde et nouveau prédicteur, mémoire d'événements et d'horloge remises à zéro, renderer
   * conservé. Le serveur attend `pret` pour démarrer le décompte.
   */
  function nouvelleDebut(m: Extract<MessageServeur, { t: "debut" }>): void {
    if (!enLigne || !horloge) return;
    debutCourant = m;
    config = copierConfig(m.config);
    horloge.reinitialiser();
    predicteur = creerPredicteur({ horloge, debut: m, arene });
    sourceMonde = fabriquerSource(predicteur);
    monde = predicteur.monde;
    // ni les absents ni le vote de revanche ne sont remis à zéro : une reprise pendant l'écran de fin reçoit `salon` (vote) AVANT ce `debut`, et le
    // message `presence` d'un joueur coupé n'est envoyé qu'une fois ; `suiviRevanche` se recale à chaque `salon` de toute façon
    emetteurReseau.reinitialiser();
    // un menu pause resté ouvert (Échap à l'écran de fin, chrono tombé à zéro) ne doit pas s'ouvrir seul sur le match suivant
    pause(false);
    resultatServeur = null;
    resultatCache = null;
    tFini = null;
    tDebut = tReel;
    aideMasquee = false;
    fil = [];
    banniere = null;
    classementOuvert = false;
    journal.length = 0;
    balleCam = false;
    monterRendu();
    etatCam = creerEtatCamera(moi(), monde.balle, false);
    alpha = 1;
    phasePrecedente = monde.phase;
    restePrecedent = monde.tempsRestant;
    redimensionner();
    hudSale = true;
    envoyerHud(true);
    enLigne.client.envoyer({ t: "pret" });
  }

  let desabonner: () => void = () => {};
  if (enLigne && sourceMonde) {
    const src = sourceMonde;
    desabonner = enLigne.client.ecouter({
      message: (m) => canal.entrer(() => surMessage(m)),
      snap: (s) => canal.entrer(() => { snapsRecus++; derniereAvance = s.avance; sourceMonde?.recevoirSnap(s, maintenantMs()); }),
    });
    // la scène chargeait pendant que le serveur attendait `pret` : l'instantané reçu entre-temps est confié au prédicteur, puis la partie peut démarrer
    if (enLigne.snapEnAttente) src.recevoirSnap(enLigne.snapEnAttente, maintenantMs());
    enLigne.client.envoyer({ t: "pret" });
  }

  /** Une image en ligne : commandes (neutres si menu ouvert ou onglet masqué), prédiction, trame d'entrées, événements, monde affiché, HUD réseau. */
  function imageEnLigne(dt: number, brutes: Readonly<EntreesVoiture>): void {
    const src = sourceMonde;
    if (!enLigne || !src) return;
    const t = maintenantMs();
    const commandes = etatCommandes(enPause, ongletMasque());
    entreesHumain = surchargeMoi ? { ...surchargeMoi } : entreesEffectives(brutes, commandes);
    if (!gele) {
      const r = src.avancer(dt, entreesHumain, t);
      alpha = r.alpha;
      monde = src.mondeAffiche(t);
      for (const e of r.evenements) traiter(e);
      apresPas(phasePrecedente, restePrecedent);
    } else monde = src.mondeAffiche(t);
    phasePrecedente = monde.phase;
    restePrecedent = monde.tempsRestant;
    if (!horloge) return;
    emetteurReseau.pousser(construireHudReseau({
      etat: enLigne.client.etat(), horloge, commandes, absents: suiviPresence.absents(t), revanche: suiviRevanche.revanche(t),
    }), t);
  }

  // ---------- boucle ----------
  function arreterBoucle(): void {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  function image(tMs: number): void {
    if (disposed) return;
    raf = requestAnimationFrame(image);
    try {
      boucle(tMs / 1000);
      erreursConsecutives = 0;
    } catch (err) {
      erreursConsecutives++;
      if (process.env.NODE_ENV !== "production") console.error("rocket : boucle", err);
      if (erreursConsecutives >= ERREURS_MAX) {
        arreterBoucle();
        opts.erreur("Le jeu s'est arrêté à cause d'une erreur.");
      }
    }
  }

  function boucle(t: number): void {
    // onglet masqué simulé (essais) : aucune image, comme quand le navigateur suspend `requestAnimationFrame`
    if (enLigne && masqueSimule) return;
    tReel = t;
    if (tDebut === null) tDebut = t;
    let dt = derniereT === null ? 0 : Math.max(0, Math.min(t - derniereT, enLigne ? RESEAU.imageMaxEnLigneS : 0.1));
    derniereT = t;
    if (reprise) { dt = 0; reprise = false; }

    // entrées : une seule lecture par image, partagée par tous les pas de l'image
    const entree = sourceOk.echantillonner();
    entreesHumain = entree.voiture;
    // l'aide masque le terrain au coup d'envoi : elle s'efface dès que le joueur touche aux commandes en jeu
    if (!aideMasquee && monde.phase === "enJeu") {
      const ev = entree.voiture;
      if (ev.accel !== 0 || ev.direction !== 0 || ev.saut || ev.boost || ev.tangage !== 0 || ev.lacet !== 0 || ev.roulis !== 0) { aideMasquee = true; hudSale = true; }
    }
    if (entree.basculerBalleCam && !balleCamPrecedent && !enPause) { balleCam = !balleCam; hudSale = true; }
    balleCamPrecedent = entree.basculerBalleCam;
    if (entree.klaxon && !klaxonPrecedent && !enPause && !moi().demolie) {
      // en ligne le klaxon passe par le serveur (limité à un toutes les 2 s) qui le rediffuse à tous, nous compris
      if (enLigne) canal.sortir(() => enLigne.client.envoyer({ t: "klaxon" }));
      else traiter({ t: "klaxon", idVoiture: monde.idHumain });
    }
    klaxonPrecedent = entree.klaxon;
    // la manette met en pause et reprend elle-même ; au clavier Échap n'entre que dans `surKeyDown`
    const start = sourceOk.boutonManette(BOUTON_MANETTE.start);
    // en ligne Start ouvre aussi le menu (qui ne gèle rien : commandes neutres, la partie continue) : seul chemin à la manette pour quitter pendant le match
    if (start && !startPrecedent) pause(!enPause);
    startPrecedent = start;
    const retour = sourceOk.boutonManette(BOUTON_MANETTE.retour);
    if (retour && !retourPrecedent && (enPause || monde.phase === "fini")) opts.sortir();
    retourPrecedent = retour;
    // écran de fin à la manette : A (front montant, seulement une fois le résultat affiché) rejoue
    const boutonA = sourceOk.boutonManette(BOUTON_MANETTE.a);
    if (boutonA && !boutonAPrecedent && monde.phase === "fini" && resultatCache !== null && !enPause) { boutonAPrecedent = true; recommencer(); return; }
    boutonAPrecedent = boutonA;

    // physique
    if (enLigne) imageEnLigne(dt, entree.voiture);
    else if (!enPause && !gele) {
      if (finie()) alpha = 1;
      else {
        const r = avancerAccumulateur(acc, dt, monde.phase === "but" ? MATCH.ralentiCelebration : 1);
        for (let i = 0; i < r.pas && !finie(); i++) pasUnique(entreesHumain);
        alpha = r.alpha;
      }
    }

    // affichage
    etatAffiche();
    const dtImage = (enPause && !enLigne) || gele ? 0 : dt;
    placerCamera(enPause && !enLigne ? 0 : dt, entree);
    if (!sansRendu) rendu?.synchroniser(monde, alpha, dtImage);
    sonsOk.maj(monde, monde.idHumain, dtImage);
    if (!sansRendu) postOk.rendre();
    envoyerHud(false);
  }

  // ---------- redémarrage ----------
  function recommencer(): void {
    if (disposed) return;
    if (enLigne) {
      // en ligne « Rejouer » est un vote de revanche : le serveur relance tout le monde d'un coup (nouvelle `debut`)
      enLigne.client.envoyer({ t: "revanche", oui: true });
      return;
    }
    config = { ...copierConfig(config), graine: (Math.imul(config.graine, 1664525) + 1013904223) >>> 0 };
    monde = creerMonde(config, arene);
    cerveaux = creerCerveaux();
    surcharges.length = 0;
    monterRendu();
    balleCam = false;
    etatCam = creerEtatCamera(moi(), monde.balle, false);
    acc.reste = 0;
    alpha = 1;
    resultatCache = null;
    tFini = null;
    tDebut = tReel;
    aideMasquee = false;
    fil = [];
    banniere = null;
    classementOuvert = false;
    journal.length = 0;
    pause(false);
    redimensionner();
    hudSale = true;
    envoyerHud(true);
  }

  // ---------- crochet de développement ----------
  const crochet: CrochetRocket = {
    etat() {
      const m = monde;
      return {
        tick: m.tick, temps: m.temps, phase: m.phase, tempsPhase: m.tempsPhase, tempsRestant: m.tempsRestant, prolongation: m.prolongation,
        attenteSolBalle: m.attenteSolBalle, score: { ...m.score }, idHumain: m.idHumain, vainqueur: m.vainqueur, dernierBut: m.dernierBut,
        balle: { p: [...m.balle.p], v: [...m.balle.v], w: [...m.balle.w], dernierToucheur: m.balle.dernierToucheur },
        voitures: m.voitures.map((v) => ({
          id: v.id, equipe: v.equipe, humain: v.humain, nom: v.nom, p: [...v.p], v: [...v.v], w: [...v.w], avant: [...v.base.avant], haut: [...v.base.haut],
          boost: v.boost, rouesContact: v.rouesContact, auSol: v.auSol, supersonique: v.supersonique, demolie: v.demolie, figee: v.figee,
          reapparitionDans: v.reapparitionDans, saut: { ...v.saut }, flip: { ...v.flip }, stats: { ...v.stats },
        })),
        plotsActifs: m.plots.filter((p) => p.actif).length,
        camera: { balleCam, melange: etatCam.melange, position: [...etatCam.position] },
        enPause, gele, manette: sourceOk.manetteConnectee(), entrees: { ...entreesHumain },
      };
    },
    // en ligne, le monde du crochet est le monde PRÉDIT (physique), pas le monde affiché
    monde: () => (predicteur ? predicteur.monde : monde),
    avancer(n: number) {
      const evs: EvenementMatch[] = [];
      // la physique en ligne appartient au serveur et au prédicteur : on ne fait pas avancer le monde à la main
      if (enLigne) return evs;
      for (let i = 0; i < n && !finie(); i++) pasUnique(entreesHumain, evs);
      alpha = 1;
      etatAffiche();
      placerCamera(0, { regard: [0, 0], arriere: false });
      rendu?.synchroniser(monde, 1, 0);
      postOk.rendre();
      envoyerHud(true);
      return evs;
    },
    geler(actif: boolean) { gele = actif; },
    entrees(i: number, e: EntreesVoiture | null) { surcharges[i] = e; },
    teleporter(i: number, p: Vec3, cap = 0) {
      const v = monde.voitures[i];
      if (!v || enLigne) return;
      replacerVoiture(v, p, cap, v.boost);
      aligner(monde, i);
    },
    balle(p: Vec3, v: Vec3 = [0, 0, 0]) {
      if (enLigne) return;
      affecter(monde.balle.p, p);
      affecter(monde.balle.v, v);
      affecter(monde.balle.w, [0, 0, 0]);
      affecter(monde.precedent.balle.p, p);
    },
    evenements: () => journal.slice(),
    hud: () => dernierHud,
    pause,
  };
  if (process.env.NODE_ENV !== "production") window.__rocket = crochet;

  // crochet des essais en ligne (`window.__rocketReseau`) : mesures, entrées scriptées, réseau dégradé, onglet masqué, coupure de socket
  const crochetReseau: CrochetRocketReseau | null = enLigne && horloge ? {
    stats: () => ({
      ...(predicteur ? predicteur.stats() : { tickLocal: 0, tickSnap: -1, rollbacks: 0, snapsExacts: 0, profondeurMoyenne: 0, profondeurMax: 0, ecartMaxM: 0, resyncs: 0, dernierRollbackMs: 0, maxRollbackMs: 0 }),
      rttMs: horloge.rttMs(), gigueMs: horloge.gigueMs(), margeTicks: horloge.margeTicks(), avance: derniereAvance, snapsRecus, trames,
    }),
    hud: () => hudReseauCourant ?? construireHudReseau({ etat: enLigne.client.etat(), horloge, commandes: etatCommandes(enPause, ongletMasque()), absents: [], revanche: null }),
    moi: () => (debutCourant ? debutCourant.moi : monde.idHumain),
    entrees: (e) => { surchargeMoi = e ? { ...e } : null; },
    autoritaire: () => (predicteur ? predicteur.etatAutoritaire() : null),
    latence: (sortantMs, entrantMs) => canal.latence(sortantMs, entrantMs),
    retenir: (ms) => canal.retenir(ms),
    masquer: (actif) => { masqueSimule = actif; hudSale = true; },
    // coupure du réseau SANS quitter : la socket meurt (code non volontaire), le client tente la reprise
    couper: () => { (enLigne.client as Partial<ClientRocketEtendu>).couperSocket?.(); },
    dev: (a) => { enLigne.client.envoyer({ t: "dev", ...a }); },
  } : null;
  if (process.env.NODE_ENV !== "production" && crochetReseau) window.__rocketReseau = crochetReseau;

  envoyerHud(true);
  raf = requestAnimationFrame(image);

  function dispose(): void {
    {
      if (disposed) return;
      disposed = true;
      arreterBoucle();
      ro?.disconnect();
      window.removeEventListener("keydown", surKeyDown);
      window.removeEventListener("keyup", surKeyUp);
      window.removeEventListener("blur", surBlur);
      window.removeEventListener("pointerdown", surGeste);
      window.removeEventListener("keydown", surGeste);
      document.removeEventListener("visibilitychange", surVisibilite);
      canvas.removeEventListener("webglcontextlost", surContexteWebGLPerdu);
      canvas.style.cursor = "";
      if (window.__rocket === crochet) delete window.__rocket;
      if (crochetReseau && window.__rocketReseau === crochetReseau) delete window.__rocketReseau;
      desabonner();
      canal.vider();
      abonnes.clear();
      camera.removeFromParent();
      liberer();
    }
  }

  return {
    dispose,
    detruire: dispose,
    pause,
    estEnPause: () => enPause,
    recommencer,
    reglages(r: ReglagesRocket) {
      reglages = r;
      sonsOk.volume(r.volume);
      hudSale = true;
    },
    basculerBalleCam() { balleCam = !balleCam; hudSale = true; },
    afficherClassement(actif: boolean) { classementOuvert = actif; hudSale = true; },
    etat: () => dernierHud,
    surEvenement(cb) { abonnes.add(cb); return () => { abonnes.delete(cb); }; },
  };
}

// Vérifie à la compilation que la fonction respecte le contrat.
const _verif: CreerJeuRocket = creerJeuRocket;
void _verif;
