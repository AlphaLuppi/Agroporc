/**
 * Boucle de jeu de l'arène FPS : vue à la première personne sur le canvas de la vue Palantir.
 * Assemble les modules purs (mouvement prédit, armes, tir, collision, interpolation) et le rendu
 * three.js (décor de lib/agroparc3d/decor.ts, avatars, arme en main, effets, bloom) + les sons.
 *
 * Le mouvement est autoritaire côté client (prédiction, aucune réconciliation) : l'état est envoyé
 * à `JEU.etatHz`, le serveur borne la vitesse. Les tirs sont tracés ici contre les avatars
 * INTERPOLÉS (ce que le tireur voit) puis déclarés au serveur, qui les revalide.
 * Les messages du serveur arrivent par `JeuHandle.recevoir` (l'hôte les relaie tous).
 *
 * Contrat d'intégration (hôte React : app/components/Agroparc3D.tsx) :
 *  - le canvas doit être NEUF : un canvas dont le contexte a été perdu (vue aérienne disposée) ne peut
 *    plus créer de contexte ; l'hôte change donc de `<canvas key>` à chaque bascule ;
 *  - `lancerJeu` envoie lui-même `rejoindre` ; `dispose` envoie `quitter` ;
 *  - juste après la création, l'hôte relaie la dernière `presence` (pseudos et couleurs des avatars) ;
 *  - Tab (tableau des scores) et le menu pause sont dans l'UI React ; Échap libère simplement la souris.
 * Spec : docs/superpowers/specs/2026-10-22-agroparc-fps-design.md
 */
import * as THREE from "three";
import type { SceneData } from "../agroparc3d/types";
import { C, construireDecor } from "../agroparc3d/decor";
import { construireMonde, type Monde } from "./collision";
import { etape, etatInitial, coteMurDe, postureDe, type Entrees, type EtatMouvement } from "./mouvement";
import { STATS, apresTir, degatsPlomb, delaiRecul, delaiRefroidissement, directionsTir, dispersionCourante, refroidir, retourRecul } from "./armes";
import { tracer, type Cible } from "./tir";
import {
  ARMES, JEU, SILHOUETTE,
  type ArmeId, type EtatJoueurSnap, type JoueurPublic, type MessageServeur, type Vec3, type Zone,
} from "./protocole";
import { Interpolateur, type ClientArene } from "./reseau";
import { creerArmeEnMain, creerAvatar, creerEffets, creerPostTraitement, type ArmeEnMain, type AvatarJoueur } from "./rendu";
import { creerSons } from "./sons";
import { angleRelatif, anglesVers, directionRegard, fovVerticalDeg, lissage, panSon } from "./vue";

// ---------------------------------------------------------------------------------------------
// Contrat avec l'hôte
// ---------------------------------------------------------------------------------------------

export interface HudEtat {
  pv: number;
  arme: ArmeId;
  /** arme de la prochaine apparition (choisie avec 1 à 4) */
  armeSuivante: ArmeId;
  munitions: number;
  chargeur: number;
  /** avancement du rechargement, 0 = rien */
  recharge: number;
  vise: boolean;
  /** lunette du sniper en place (cache noir et réticule) */
  lunette: boolean;
  /** vitesse horizontale, m/s */
  vitesse: number;
  /** wall-run en cours */
  mur: boolean;
  mort: boolean;
  /** s avant la réapparition (0 = en attente du serveur) */
  reapparitionDans: number;
  protege: boolean;
  /** pointer lock actif */
  verrouille: boolean;
  /** demi-angle du cône de dispersion, rad */
  dispersion: number;
  /** champ de vision vertical courant, ° */
  fov: number;
  /** connexion au serveur vivante */
  connecte: boolean;
  /** entracte (classement affiché, plus de tirs) */
  entracte: boolean;
}

export type JeuEvenement =
  /** j'ai touché quelqu'un (estimation locale, immédiate) */
  | { type: "touche"; cible: string; zone: Zone; degats: number }
  /** j'ai tué quelqu'un */
  | { type: "kill"; cible: string; zone: Zone; arme: ArmeId }
  /** je suis mort */
  | { type: "mort"; par: string; arme: ArmeId; zone: Zone; delai: number }
  /** j'ai pris des dégâts ; `angle` relatif à ma vue (0 = devant, + = à droite) */
  | { type: "degat"; par: string; degats: number; angle: number };

export interface JeuCallbacks {
  /** ≈ 15 Hz, seulement quand quelque chose a changé */
  hud(e: HudEtat): void;
  evenement(e: JeuEvenement): void;
  /** le joueur a quitté l'arène (ou le rendu est devenu inutilisable) */
  sortir(): void;
  /** problème technique à montrer au joueur (contexte WebGL perdu) */
  erreur?(message: string): void;
}

export interface JeuHandle {
  /** Arme de la prochaine apparition (immédiate si mort). */
  choisirArme(a: ArmeId): void;
  /** Message du serveur (tous types, l'hôte relaie tout). */
  recevoir(m: MessageServeur): void;
  /** Redemande la souris (bouton « Reprendre » du menu pause). */
  verrouiller(): void;
  /** Sensibilité de la souris (1 = défaut). */
  sensibilite(x: number): void;
  dispose(): void;
  /** Crochet de test (window.__arene en développement). */
  debug: {
    etat(): Record<string, unknown>;
    teleporter(p: Vec3): void;
    regarder(lacet: number, tangage: number): void;
    /** Vise le centre de la cible et tire sans dispersion ; false si le tir n'est pas possible. */
    tirerVers(id: string): boolean;
    /** Appuie ou relâche une touche (code KeyboardEvent) sans clavier. */
    touche(code: string, appuyee: boolean): void;
  };
}

// ---------------------------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------------------------

export const CLE_SENSIBILITE = "pdj-fps-sensibilite";
/** Radians par pixel de souris à sensibilité 1, pour un champ de 90°. */
const SENS_RAD_PX = 0.0022;
const FOV_H = 90;
const FOV_H_VISEE = 78;
const PORTEE_EFFETS_M = 400;
const ECART_HUD_S = 1 / 15;
const TOUCHES_BLOQUEES = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space",
  "ShiftLeft", "ShiftRight", "KeyR",
]);
const NUM_ARME: Record<string, number> = {
  Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3,
};

function lireSensibilite(): number {
  try {
    const v = Number(localStorage.getItem(CLE_SENSIBILITE));
    return Number.isFinite(v) && v >= 0.2 && v <= 3 ? v : 1;
  } catch {
    return 1;
  }
}

function dansUnChamp(cible: EventTarget | null): boolean {
  const el = cible as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

const borne = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const TANGAGE_MAX = Math.PI / 2 - 0.01;

interface Distant {
  avatar: AvatarJoueur;
  pseudo: string;
  couleur: string;
}

// ---------------------------------------------------------------------------------------------
// Jeu
// ---------------------------------------------------------------------------------------------

export function lancerJeu(canvas: HTMLCanvasElement, data: SceneData, client: ClientArene, arme: ArmeId, cb: JeuCallbacks): JeuHandle {
  const monde: Monde = construireMonde(data);
  const reduit = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- rendu ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(C.ground, 1);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(C.ground, 0.0013);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.08, 3000);
  camera.rotation.order = "YXZ";
  scene.add(camera);
  const decor = new THREE.Group();
  scene.add(decor);
  construireDecor(decor, data, { fantomes: false });
  const effets = creerEffets(scene);
  const post = creerPostTraitement(renderer, scene, camera);
  const sons = creerSons();
  const interp = new Interpolateur();

  // ---------- état du joueur ----------
  const [fx, fz] = data.focus;
  let moi: EtatMouvement = etatInitial([fx, 0, fz]);
  let lacet = 0;
  let tangage = 0;
  let apparu = false;
  let vivant = false;
  let pv: number = JEU.pvMax;
  let protege = false;
  let armeId: ArmeId = arme;
  let armeSuivante: ArmeId = arme;
  let munitions = STATS[arme].chargeur;
  let rechargeDebut = 0;
  let rechargeFin = 0;
  let prochainTir = 0;
  let chaleur = 0;
  /** instant du dernier tir (la chaleur et le recul ne retombent qu'un moment après) */
  let dernierTirT = -Infinity;
  /** recul de tangage (rad) ajouté par les tirs et pas encore revenu ni compensé à la souris */
  let reculAcc = 0;
  let kick = 0;
  let fovH = FOV_H;
  let fovV = 60;
  let reapparitionFin = 0;
  let mortT = 0;
  let mortSigne = 1;
  let entracte = false;
  let sensibilite = lireSensibilite();
  let idConnu: string | null = client.id;
  let sorti = false;
  let disposed = false;
  /** retiré de l'arène par le serveur (inactivité) et pas encore rentré */
  let evince = false;

  // ---------- entrées ----------
  const touches = new Set<string>();
  let tirMaintenu = false;
  let viseMaintenu = false;
  let tirPresse = -Infinity;
  let tirConsomme = true;
  let sautDemande = false;
  /** crochet de test : joue sans pointer lock (navigateur sans écran) */
  let forceActif = false;

  const verrouille = () => document.pointerLockElement === canvas;
  const demanderVerrou = () => {
    try {
      const r = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === "function") r.catch(() => { /* refusé : le menu pause reste affiché */ });
    } catch { /* idem */ }
  };

  // ---------- joueurs distants ----------
  const infos = new Map<string, JoueurPublic>();
  const distants = new Map<string, Distant>();
  let etats = new Map<string, EtatJoueurSnap>();
  let t = 0; // horloge locale, s

  const couleurDe = (id: string) => infos.get(id)?.couleur ?? "#9be9ff";
  const pseudoDe = (id: string) => infos.get(id)?.pseudo ?? "Agent";

  function couleurMoi(): string {
    return client.id ? couleurDe(client.id) : "#bfefff";
  }

  // ---------- arme en main ----------
  // `armeMain.maj` règle elle-même la visibilité de son groupe (lunette du sniper) : l'arme est donc
  // posée dans un groupe à nous, qu'on masque quand on est mort ou pas encore apparu.
  const porteArme = new THREE.Group();
  porteArme.visible = false;
  camera.add(porteArme);
  let armeMain: ArmeEnMain = creerArmeEnMain(armeId, couleurMoi());
  porteArme.add(armeMain.group);
  function changerArmeMain(id: ArmeId) {
    porteArme.remove(armeMain.group);
    armeMain.dispose();
    armeMain = creerArmeEnMain(id, couleurMoi());
    porteArme.add(armeMain.group);
  }

  // ---------- utilitaires de jeu ----------
  const oeil = (): Vec3 => [moi.p[0], moi.p[1] + SILHOUETTE.oeil, moi.p[2]];
  const vitesseH = () => Math.hypot(moi.v[0], moi.v[2]);
  const peutAgir = () => apparu && vivant;

  function demarrerRecharge() {
    if (!peutAgir() || rechargeFin > 0 || munitions >= STATS[armeId].chargeur) return;
    const a = STATS[armeId];
    rechargeDebut = t;
    rechargeFin = t + a.rechargeS;
    armeMain.recharger(a.rechargeS);
    sons.recharge(armeId);
  }

  function annulerRecharge() {
    rechargeFin = 0;
    rechargeDebut = 0;
  }

  function cibles(): Cible[] {
    const r: Cible[] = [];
    for (const [id, e] of etats) {
      if (id === client.id) continue;
      r.push({ id, p: e.p, vivant: e.vivant });
    }
    return r;
  }

  const _bouche = new THREE.Vector3();

  /** Un tir. `force` : outil de test (ignore la souris, aucune dispersion). Renvoie vrai si le tir est parti. */
  function tirer(force = false): boolean {
    if (!peutAgir() || entracte || rechargeFin > 0) return false;
    if (munitions <= 0) { demarrerRecharge(); return false; }
    if (t < prochainTir) return false;
    const a = STATS[armeId];
    const o = oeil();
    const regard = directionRegard(lacet, tangage);
    const vise = viseMaintenu;
    const disp = force ? 0 : dispersionCourante(armeId, { vitesseH: vitesseH(), auSol: moi.auSol, vise, chaleur });
    const dirs = directionsTir(armeId, regard, disp, Math.random);
    const lunette = vise && a.zoom !== null;
    const touchesDecl: { cible: string; zone: Zone; plomb: number }[] = [];
    const cumul = new Map<string, { degats: number; zone: Zone }>();
    const liste = cibles();

    armeMain.positionBouche(_bouche);
    const depart: Vec3 = lunette
      ? [o[0] + regard[0] * 0.8, o[1] + regard[1] * 0.8 - 0.08, o[2] + regard[2] * 0.8]
      : [_bouche.x, _bouche.y, _bouche.z];
    let impactsAffiches = 0;
    dirs.forEach((d, i) => {
      const imp = tracer(monde, o, d, Math.min(a.portee, PORTEE_EFFETS_M), liste, client.id ?? "");
      const fin = imp.point;
      effets.traçante(depart, fin, couleurMoi());
      if (imp.cible && imp.zone) {
        const e = etats.get(imp.cible);
        if (e && !e.protege) {
          touchesDecl.push({ cible: imp.cible, zone: imp.zone, plomb: i });
          const dg = degatsPlomb(armeId, imp.zone, imp.distance);
          const c = cumul.get(imp.cible);
          if (c) { c.degats += dg; if (imp.zone === "tete") c.zone = "tete"; }
          else cumul.set(imp.cible, { degats: dg, zone: imp.zone });
        }
        effets.eclaboussure(fin, couleurDe(imp.cible));
      } else if (imp.distance < a.portee - 0.01 && impactsAffiches < 5) {
        impactsAffiches++;
        effets.impact(fin, [-d[0], -d[1], -d[2]], couleurMoi());
      }
    });

    client.envoyer({ t: "tir", arme: armeId, o, d: dirs, touches: touchesDecl });

    // retour immédiat : l'estimation locale ne dépend pas de l'aller-retour réseau
    for (const [id, c] of cumul) {
      sons.touche();
      cb.evenement({ type: "touche", cible: id, zone: c.zone, degats: c.degats });
    }

    // cadence (rattrape le retard d'une image pour ne pas perdre de cadence à 60 Hz)
    prochainTir = t - prochainTir < 0.02 ? prochainTir + a.cadenceS : t + a.cadenceS;
    munitions--;
    chaleur = apresTir(armeId, chaleur);
    armeMain.tirer();
    sons.tir(armeId);
    const k = vise ? 0.6 : 1;
    const monte = a.recul.tangage * k * (0.8 + 0.4 * Math.random());
    const avant = tangage;
    tangage = borne(tangage + monte, -TANGAGE_MAX, TANGAGE_MAX);
    reculAcc += tangage - avant;
    dernierTirT = t;
    lacet += (Math.random() - 0.5) * 2 * a.recul.lacet * k;
    kick += a.recul.tangage * 0.9;
    if (munitions <= 0) prochainTir = Math.max(prochainTir, t + 0.15);
    return true;
  }

  function reentrer() {
    evince = false;
    client.envoyer({ t: "rejoindre", arme: armeSuivante });
  }

  function choisirArme(a: ArmeId) {
    if (!ARMES.includes(a)) return;
    armeSuivante = a;
    client.envoyer({ t: "arme", arme: a });
  }

  // ---------- messages du serveur ----------
  function creerAvatarDistant(id: string): Distant {
    const pseudo = pseudoDe(id), couleur = couleurDe(id);
    const avatar = creerAvatar(couleur, pseudo);
    scene.add(avatar.group);
    const d = { avatar, pseudo, couleur };
    distants.set(id, d);
    return d;
  }

  function retirerAvatar(id: string) {
    const d = distants.get(id);
    if (!d) return;
    scene.remove(d.avatar.group);
    d.avatar.dispose();
    distants.delete(id);
  }

  function majInfos(liste: JoueurPublic[]) {
    infos.clear();
    for (const j of liste) infos.set(j.id, j);
    // pseudo ou couleur changés : l'avatar est recréé à la prochaine image
    for (const [id, d] of [...distants]) {
      const j = infos.get(id);
      if (!j || j.pseudo !== d.pseudo || j.couleur !== d.couleur) retirerAvatar(id);
    }
  }

  function posCentre(id: string): Vec3 | null {
    const e = etats.get(id);
    return e ? [e.p[0], e.p[1] + 1.1, e.p[2]] : null;
  }

  function apparaitre(m: Extract<MessageServeur, { t: "apparition" }>) {
    moi = etatInitial(m.p);
    lacet = m.lacet;
    tangage = 0;
    kick = 0;
    reculAcc = 0;
    dernierTirT = -Infinity;
    apparu = true;
    evince = false;
    vivant = true;
    pv = m.pv;
    protege = true;
    if (m.arme !== armeId) { armeId = m.arme; changerArmeMain(armeId); }
    munitions = STATS[armeId].chargeur;
    annulerRecharge();
    chaleur = 0;
    prochainTir = t + 0.3;
    viseMaintenu = false;
    mortT = 0;
    // un tir maintenu pendant la mort ne doit pas partir tout seul à l'apparition (il ferait perdre la
    // protection d'apparition) : mitraillette comprise, il faut relâcher puis réappuyer
    tirConsomme = true;
    tirMaintenu = false;
  }

  function recevoir(m: MessageServeur) {
    if (disposed) return;
    switch (m.t) {
      case "bienvenue":
        majInfos(m.joueurs);
        entracte = m.match.phase === "entracte";
        break;
      case "presence": {
        majInfos(m.joueurs);
        // Le serveur nous a retiré de l'arène (aucun état reçu pendant trop longtemps : onglet gelé) :
        // on redemande à entrer plutôt que de rester un joueur local que personne ne voit.
        const moiInfo = client.id ? infos.get(client.id) : undefined;
        if (apparu && moiInfo && !moiInfo.enJeu) {
          apparu = false;
          vivant = false;
          evince = true;
          // onglet caché : on attend son retour, sinon on réapparaîtrait en cible immobile toutes les 20 s
          if (!document.hidden) reentrer();
        }
        break;
      }
      case "match":
        entracte = m.match.phase === "entracte";
        break;
      case "snap": {
        interp.ajouter({ ts: m.ts, j: m.j });
        const s = m.j.find((x) => x.id === client.id);
        if (s && vivant) { pv = s.pv; protege = s.protege; }
        break;
      }
      case "apparition":
        if (m.id === client.id) apparaitre(m);
        break;
      case "tir": {
        if (m.id === client.id) break;
        const a = STATS[m.arme];
        const liste = cibles();
        for (const d of m.d) {
          const imp = tracer(monde, m.o, d, Math.min(a.portee, PORTEE_EFFETS_M), liste, m.id);
          effets.traçante(m.o, imp.point, couleurDe(m.id));
          if (!imp.cible && imp.distance < a.portee - 0.01) effets.impact(imp.point, [-d[0], -d[1], -d[2]], couleurDe(m.id));
        }
        distants.get(m.id)?.avatar.tirer();
        const cam = oeil();
        const dx = m.o[0] - cam[0], dz = m.o[2] - cam[2];
        sons.tir(m.arme, { distance: Math.hypot(dx, m.o[1] - cam[1], dz), pan: panSon(lacet, dx, dz) });
        break;
      }
      case "degats": {
        if (m.cible === client.id) {
          pv = m.pv;
          if (vivant) {
            sons.degat();
            kick += 0.025;
            const par = etats.get(m.par);
            const ang = par ? angleRelatif(lacet, par.p[0] - moi.p[0], par.p[2] - moi.p[2]) : 0;
            cb.evenement({ type: "degat", par: m.par, degats: m.degats, angle: ang });
          }
        } else {
          const c = posCentre(m.cible);
          if (c) effets.eclaboussure(c, couleurDe(m.cible));
          distants.get(m.cible)?.avatar.toucher();
        }
        break;
      }
      case "mort": {
        if (m.cible === client.id) {
          vivant = false;
          pv = 0;
          mortT = 0;
          mortSigne = Math.random() < 0.5 ? -1 : 1;
          reapparitionFin = t + m.delai / 1000;
          viseMaintenu = false;
          tirMaintenu = false;
          annulerRecharge();
          sons.mur(false);
          cb.evenement({ type: "mort", par: m.par, arme: m.arme, zone: m.zone, delai: m.delai });
        } else if (m.par === client.id) {
          sons.kill();
          cb.evenement({ type: "kill", cible: m.cible, zone: m.zone, arme: m.arme });
        }
        break;
      }
      default:
        break;
    }
  }

  // ---------- entrées : événements ----------
  const surKeyDown = (e: KeyboardEvent) => {
    if (dansUnChamp(e.target)) return;
    const num = NUM_ARME[e.code];
    if (num !== undefined) {
      if (!e.repeat) choisirArme(ARMES[num]);
      e.preventDefault();
      return;
    }
    if (!verrouille()) return;
    if (TOUCHES_BLOQUEES.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    touches.add(e.code);
    if (e.code === "Space") sautDemande = true;
    if (e.code === "KeyR") demarrerRecharge();
  };
  const surKeyUp = (e: KeyboardEvent) => {
    touches.delete(e.code);
  };
  const toutRelacher = () => {
    touches.clear();
    tirMaintenu = false;
    viseMaintenu = false;
  };
  const surMouseDown = (e: MouseEvent) => {
    if (!verrouille()) { demanderVerrou(); return; }
    e.preventDefault();
    if (e.button === 0) { if (vivant) { tirMaintenu = true; tirPresse = t; tirConsomme = false; } }
    else if (e.button === 2) viseMaintenu = true;
  };
  const surMouseUp = (e: MouseEvent) => {
    if (e.button === 0) tirMaintenu = false;
    else if (e.button === 2) viseMaintenu = false;
  };
  const surMouseMove = (e: MouseEvent) => {
    if (!verrouille()) return;
    const dx = borne(e.movementX || 0, -250, 250), dy = borne(e.movementY || 0, -250, 250);
    // à fort zoom, la souris tourne moins vite (même déplacement à l'écran)
    const echelle = Math.tan((fovH * Math.PI) / 360) / Math.tan(Math.PI / 4);
    const s = SENS_RAD_PX * sensibilite * echelle;
    if (vivant || !apparu) {
      lacet -= dx * s;
      tangage = borne(tangage - dy * s, -TANGAGE_MAX, TANGAGE_MAX);
      // ce que le joueur redescend à la main n'est plus à rattraper tout seul (sinon la vue plongerait)
      if (dy > 0) reculAcc = Math.max(0, reculAcc - dy * s);
    }
  };
  const surVerrou = () => {
    if (!verrouille()) toutRelacher();
    emettreHud(true);
  };
  const surContexte = (e: Event) => e.preventDefault();
  const surVisibilite = () => {
    if (document.hidden) toutRelacher();
    else if (evince) reentrer();
  };
  const surContexteWebGLPerdu = (e: Event) => {
    e.preventDefault();
    cb.erreur?.("Le rendu 3D a été interrompu (contexte WebGL perdu).");
    cb.sortir();
  };

  window.addEventListener("keydown", surKeyDown);
  window.addEventListener("keyup", surKeyUp);
  window.addEventListener("blur", toutRelacher);
  window.addEventListener("mouseup", surMouseUp);
  window.addEventListener("mousemove", surMouseMove);
  document.addEventListener("pointerlockchange", surVerrou);
  document.addEventListener("visibilitychange", surVisibilite);
  canvas.addEventListener("mousedown", surMouseDown);
  canvas.addEventListener("contextmenu", surContexte);
  canvas.addEventListener("webglcontextlost", surContexteWebGLPerdu);

  // ---------- taille ----------
  function redimensionner() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    post.redimensionner(w, h);
    camera.aspect = w / h;
    appliquerFov();
  }
  function appliquerFov() {
    const v = fovVerticalDeg(fovH, camera.aspect);
    if (Math.abs(v - camera.fov) > 1e-3) { camera.fov = v; camera.updateProjectionMatrix(); }
    fovV = v;
  }
  redimensionner();
  const ro = new ResizeObserver(redimensionner);
  ro.observe(canvas);

  // ---------- HUD ----------
  let dernierHud: HudEtat | null = null;
  let accHud = ECART_HUD_S;
  function etatHud(): HudEtat {
    const a = STATS[armeId];
    const lunette = viseMaintenu && a.zoom !== null && peutAgir() && rechargeFin === 0;
    return {
      pv: Math.max(0, Math.round(pv)),
      arme: armeId,
      armeSuivante,
      munitions,
      chargeur: a.chargeur,
      recharge: rechargeFin > 0 ? borne((t - rechargeDebut) / Math.max(0.001, rechargeFin - rechargeDebut), 0.001, 1) : 0,
      vise: viseMaintenu && peutAgir(),
      lunette,
      vitesse: Math.round(vitesseH() * 10) / 10,
      mur: !!moi.mur && vivant,
      mort: !vivant,
      reapparitionDans: vivant ? 0 : Math.max(0, Math.round((reapparitionFin - t) * 10) / 10),
      protege: protege && vivant,
      verrouille: verrouille(),
      dispersion: Math.round(dispersionCourante(armeId, { vitesseH: vitesseH(), auSol: moi.auSol, vise: viseMaintenu, chaleur }) * 10000) / 10000,
      fov: Math.round(fovV * 10) / 10,
      connecte: client.id !== null,
      entracte,
    };
  }
  function emettreHud(force = false) {
    const e = etatHud();
    const d = dernierHud;
    if (!force && d) {
      let identique = true;
      for (const k of Object.keys(e) as (keyof HudEtat)[]) if (e[k] !== d[k]) { identique = false; break; }
      if (identique) return;
    }
    dernierHud = e;
    cb.hud(e);
  }

  // ---------- boucle ----------
  let raf = 0;
  let dernierT = performance.now();
  let accEtat = 0;
  let seq = 0;
  let distPas = 0;
  let murActif = false;

  function entrees(): Entrees {
    const k = (c: string) => (touches.has(c) ? 1 : 0);
    return {
      avant: k("KeyW") + k("ArrowUp") - k("KeyS") - k("ArrowDown"),
      droite: k("KeyD") + k("ArrowRight") - k("KeyA") - k("ArrowLeft"),
      saut: touches.has("Space") || sautDemande,
      sprint: touches.has("ShiftLeft") || touches.has("ShiftRight"),
      lacet,
    };
  }

  function majDistants(dt: number) {
    etats = interp.echantillon(client.maintenantServeur() - JEU.interpolationMs);
    for (const [id, e] of etats) {
      if (id === client.id) continue;
      const d = distants.get(id) ?? creerAvatarDistant(id);
      d.avatar.maj(e, dt);
    }
    for (const id of [...distants.keys()]) if (!etats.has(id) || id === client.id) retirerAvatar(id);
  }

  function reconnexion() {
    // la connexion a été refaite (coupure réseau) : nouvel identifiant, plus dans l'arène
    if (client.id !== null && client.id !== idConnu) {
      const premier = idConnu === null;
      idConnu = client.id;
      if (premier) return;
      apparu = false;
      vivant = false;
      interp.vider();
      for (const id of [...distants.keys()]) retirerAvatar(id);
      client.envoyer({ t: "rejoindre", arme: armeSuivante });
    } else if (client.id !== null) {
      idConnu = client.id;
    }
  }

  function frame(maintenant: number) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = borne((maintenant - dernierT) / 1000, 0, 0.1);
    dernierT = maintenant;
    t += dt;
    reconnexion();

    // --- recharge ---
    if (rechargeFin > 0 && t >= rechargeFin) {
      munitions = STATS[armeId].chargeur;
      annulerRecharge();
    }
    if (peutAgir() && munitions <= 0 && rechargeFin === 0 && t >= prochainTir) demarrerRecharge();

    // --- mouvement ---
    const aVerrou = verrouille();
    const en = entrees();
    const actif = vivant && apparu && (aVerrou || forceActif);
    const a = STATS[armeId];
    // Le fusil à lunette ne vise pas pendant le rechargement : l'arme reste visible et le champ normal
    // (sinon, clic droit tenu, l'arme disparaissait sans lunette ni animation de rechargement).
    const vise = viseMaintenu && peutAgir() && !(a.zoom !== null && rechargeFin > 0);
    if (apparu) {
      const entreesUtiles: Entrees = actif ? en : { avant: 0, droite: 0, saut: false, sprint: false, lacet };
      const mult = a.vitesse * (vise ? 0.8 : 1);
      moi = etape(moi, entreesUtiles, dt, monde, mult);
    }
    sautDemande = false;

    // --- tir ---
    if (actif) {
      const veutTirer = a.auto ? tirMaintenu : !tirConsomme && tirPresse > t - 0.12;
      if (veutTirer && tirer() && !a.auto) tirConsomme = true;
    }
    // La chaleur (dispersion) et le recul ne retombent qu'un instant après le dernier tir : pendant
    // une rafale ils s'accumulent ; ensuite la vue revient d'elle-même sur ce que le recul a soulevé
    // (le fusil à pompe, qui tire toutes les 0,85 s, retrouve sa visée avant le tir suivant).
    const depuisTir = t - dernierTirT;
    if (depuisTir > delaiRefroidissement(armeId)) chaleur = refroidir(armeId, chaleur, dt);
    if (reculAcc > 0 && vivant && depuisTir > delaiRecul(armeId)) {
      const rendu = retourRecul(reculAcc, dt);
      tangage = borne(tangage - rendu, -TANGAGE_MAX, TANGAGE_MAX);
      reculAcc -= rendu;
    }

    // --- sons de déplacement ---
    const vh = vitesseH();
    if (apparu && vivant && moi.auSol && vh > 1.5) {
      distPas += vh * dt;
      if (distPas > 2.4) { distPas = 0; sons.pas(); }
    } else distPas = 0;
    const surMur = apparu && vivant && !!moi.mur;
    if (surMur !== murActif) { murActif = surMur; sons.mur(surMur); }

    // --- envoi de l'état ---
    accEtat += dt;
    if (accEtat >= 1 / JEU.etatHz) {
      accEtat = 0;
      if (apparu && vivant) {
        client.envoyer({
          t: "etat", seq: ++seq, p: [moi.p[0], moi.p[1], moi.p[2]], v: [moi.v[0], moi.v[1], moi.v[2]],
          lacet, tangage, posture: postureDe(moi), mur: coteMurDe(moi),
        });
      }
    }

    // --- joueurs distants et effets ---
    majDistants(dt);
    effets.maj(dt);

    // --- caméra ---
    const lunette = vise && a.zoom !== null && rechargeFin === 0;
    const cibleFov = lunette && a.zoom !== null ? a.zoom : vise ? FOV_H_VISEE : FOV_H;
    fovH += (cibleFov - fovH) * lissage(14, dt);
    appliquerFov();
    kick *= Math.exp(-11 * dt);

    if (!apparu) {
      // en attente de la première apparition : survol de l'arène
      camera.position.set(fx, 70, fz + 90);
      camera.rotation.set(-0.5, 0, 0);
    } else if (vivant) {
      const bob = reduit ? 0 : Math.sin(t * 11) * 0.025 * Math.min(1, vh / 7) * (moi.auSol ? 1 : 0);
      camera.position.set(moi.p[0], moi.p[1] + SILHOUETTE.oeil + bob, moi.p[2]);
      camera.rotation.set(tangage + kick, lacet, -moi.inclinaison);
    } else {
      // mort : la caméra s'effondre et bascule sur le côté
      mortT += dt;
      const k = borne(mortT / 0.7, 0, 1);
      const e = 1 - (1 - k) * (1 - k);
      camera.position.set(moi.p[0], moi.p[1] + SILHOUETTE.oeil + (0.3 - SILHOUETTE.oeil) * e, moi.p[2]);
      camera.rotation.set(tangage + (-0.35 - tangage) * e, lacet, mortSigne * 1.15 * e);
    }

    porteArme.visible = apparu && vivant;
    armeMain.maj(dt, { vitesseH: vh, auSol: moi.auSol, vise });

    post.rendre();

    accHud += dt;
    if (accHud >= ECART_HUD_S) { accHud = 0; emettreHud(); }
  }
  raf = requestAnimationFrame(frame);

  client.envoyer({ t: "rejoindre", arme });
  emettreHud(true);

  // ---------- poignée ----------
  return {
    choisirArme,
    recevoir,
    verrouiller: demanderVerrou,
    sensibilite(x) { sensibilite = borne(x, 0.2, 3); },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("keydown", surKeyDown);
      window.removeEventListener("keyup", surKeyUp);
      window.removeEventListener("blur", toutRelacher);
      window.removeEventListener("mouseup", surMouseUp);
      window.removeEventListener("mousemove", surMouseMove);
      document.removeEventListener("pointerlockchange", surVerrou);
      document.removeEventListener("visibilitychange", surVisibilite);
      canvas.removeEventListener("mousedown", surMouseDown);
      canvas.removeEventListener("contextmenu", surContexte);
      canvas.removeEventListener("webglcontextlost", surContexteWebGLPerdu);
      if (!sorti) { sorti = true; client.envoyer({ t: "quitter" }); }
      if (verrouille()) document.exitPointerLock();
      sons.mur(false);
      sons.dispose();
      for (const id of [...distants.keys()]) retirerAvatar(id);
      porteArme.remove(armeMain.group);
      camera.remove(porteArme);
      armeMain.dispose();
      effets.dispose();
      decor.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      post.dispose();
      renderer.dispose();
      // Rend le contexte WebGL tout de suite (Chrome n'en garde que 16 actifs), comme scene.ts.
      renderer.forceContextLoss();
    },
    debug: {
      etat() {
        return {
          id: client.id, apparu, vivant, pv, protege, arme: armeId, armeSuivante, munitions, recharge: rechargeFin > 0,
          p: [...moi.p], v: [...moi.v], auSol: moi.auSol, posture: postureDe(moi), mur: coteMurDe(moi),
          lacet, tangage, verrouille: verrouille(), entracte, fov: fovV,
          distants: [...etats.entries()].filter(([id]) => id !== client.id).map(([id, e]) => ({ id, p: e.p, vivant: e.vivant, protege: e.protege })),
        };
      },
      teleporter(p) { moi = etatInitial(p); },
      regarder(l, tg) { lacet = l; tangage = borne(tg, -TANGAGE_MAX, TANGAGE_MAX); },
      tirerVers(id) {
        const e = etats.get(id);
        if (!e || !peutAgir()) return false;
        const o = oeil();
        const r = anglesVers(e.p[0] - o[0], e.p[1] + 1.2 - o[1], e.p[2] - o[2]);
        lacet = r.lacet;
        tangage = r.tangage;
        return tirer(true);
      },
      touche(code, appuyee) {
        forceActif = true;
        if (appuyee) { touches.add(code); if (code === "Space") sautDemande = true; }
        else touches.delete(code);
      },
    },
  };
}
