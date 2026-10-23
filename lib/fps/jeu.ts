/**
 * Boucle de jeu de l'arène FPS : vue à la première personne sur le canvas de la vue Palantir.
 * Assemble les modules purs (mouvement prédit, armes, équipement, tir, couteau, véhicules, killcam, monde dynamique, visibilité,
 * interpolation) et le rendu three.js (décor de lib/agroparc3d/decor.ts, avatars, arme en main, effets, monde dynamique, bloom) + les sons.
 * `jeu.ts` ORCHESTRE : la logique vit dans les modules purs testés (`jeu-equipement`, `jeu-killcam`, `jeu-monde`, `jeu-vehicule`,
 * `jeu-visee`, `jeu-radar`, `visibilite`, `melee`, `tir`…).
 *
 * Le mouvement est autoritaire côté client (prédiction, aucune réconciliation, voiture comprise pour son conducteur) : l'état est envoyé
 * à `JEU.etatHz` (`conduite` à la place d'`etat` pour le conducteur, `etat` à `JEU.etatPassagerHz` pour un passager), le serveur borne
 * la vitesse. Les tirs sont tracés ici contre les avatars INTERPOLÉS (ce que le tireur voit) puis déclarés au serveur, qui les revalide.
 * Aucune dispersion (v2 §13.1) : le tir part exactement de l'axe de la vue, et la caméra regarde exactement la même direction
 * (`jeu-visee.ts`, §13.2.4) ; seule exception, le sniper sans lunette (v3 §1, `dispersionTir`). La lunette a plusieurs niveaux de zoom
 * (action `zoomLunette`, molette en lunette), retenus par arme le temps de la partie. Le retour de touche (son, marqueur, chiffre) ne part QU'À LA RÉCEPTION du `degats` du serveur (§13.2.1).
 * Les messages du serveur arrivent par `JeuHandle.recevoir` (l'hôte les relaie tous).
 *
 * Contrat d'intégration (hôte React : app/components/Agroparc3D.tsx) :
 *  - le canvas doit être NEUF : un canvas dont le contexte a été perdu (vue aérienne disposée) ne peut
 *    plus créer de contexte ; l'hôte change donc de `<canvas key>` à chaque bascule ;
 *  - `lancerJeu` envoie lui-même `rejoindre` ; `dispose` envoie `quitter` ;
 *  - juste après la création, l'hôte relaie la dernière `presence` (pseudos et couleurs des avatars) ;
 *  - Tab (tableau des scores, `vueScores`), M (grande carte) et le menu pause sont dans l'UI React ; Échap libère simplement la souris ;
 *  - les valeurs continues du HUD sont dans `JeuHandle.live` (60 Hz, hors React) et la mini-map lit `JeuHandle.radar()`.
 *
 * Les types du contrat avec l'hôte (HudEtat, JeuEvenement, JeuCallbacks, JeuHandle…) sont dans `jeu-types.ts` et réexportés ici.
 * Spec : docs/superpowers/specs/2026-10-22-agroparc-fps-design.md, 2026-10-22-arene-v2-design.md (§6.2, §13),
 * 2026-10-23-arene-hud-design.md (§3)
 */
import * as THREE from "three";
import type { SceneData } from "../agroparc3d/types";
import { C, construireDecor } from "../agroparc3d/decor";
import { construireMonde, type Monde } from "./collision";
import { construireCircuits, flotte } from "./circulation";
import { coteMurDe, etape, etatInitial, hauteurOeil, postureDe, type Entrees, type EtatMouvement } from "./mouvement";
import { COUTEAU, STATS, degatsPlomb, delaiRecul, devier, directionsTir, dispersionTir, niveauZoomDefaut, niveauxZoom, retourRecul, vitesseArme } from "./armes";
import { tracer, type Cible } from "./tir";
import { trouverCibleCouteau } from "./melee";
import {
  JEU, OEIL_SIEGE, SILHOUETTE, oeilDe,
  type ArmeFeuId, type ArmeId, type EtatJoueurSnap, type JoueurPublic, type MessageServeur, type Siege, type Slot, type Vec3, type VehiculeSnap, type Zone,
} from "./protocole";
import type { EquipementJeu, HudEtat, HudLive, JeuCallbacks, JeuHandle } from "./jeu-types";
import { ajouterEcho, creerRadarFrame, definirElsa, ajouterVoiture, ajouterVoiturePnj, purgerEchos, viderRadarFrame, type RadarFrame } from "./radar";
import { SuiviRadar, type JoueurRadarEntree } from "./jeu-radar";
import { Interpolateur, type ClientArene } from "./reseau";
import { codeSouris, indexTouches, lireTouches, stockageNavigateur, type Action, type ConfigTouches } from "./touches";
import {
  creerArmeEnMain, creerAvatar, creerEffets, creerPostTraitement, type ArmeEnMain, type AvatarJoueur,
} from "./rendu";
import { creerMondeDynamique, type MondeDynamique } from "./rendu-monde";
import { creerFeux, type SourceFeu } from "./rendu-feux";
import { creerChatVocal } from "./voix-rtc";
import { creerSons } from "./sons";
import { angleRelatif, anglesVers, fovVerticalDeg, lissage, panSon } from "./vue";
import { TANGAGE_MAX, directionVisee, rotationCamera, tangageDeVue } from "./jeu-visee";
import { ControleurArmes } from "./jeu-equipement";
import { serialiserSlots } from "./equipement";
import { ControleurKillcam } from "./jeu-killcam";
import { MondeJeu } from "./jeu-monde";
import { ControleurVehicule, commandesDepuisEntrees, recalerOccupants } from "./jeu-vehicule";
import { CONDUCTEUR_TIRE } from "./garage";
import type { EtatVehicule } from "./vehicule";
import { VisibilitePseudos, type JoueurVisible } from "./visibilite";
import { placeTruck, ROND_POINT, EMPLACEMENTS_VOITURES } from "./zones";

// ---------------------------------------------------------------------------------------------
// Contrat avec l'hôte
// ---------------------------------------------------------------------------------------------

export type { EquipementJeu, HudEtat, HudLive, JeuCallbacks, JeuEvenement, JeuHandle } from "./jeu-types";

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
/** Tirs au plus par image (minigun à 25 tirs/s et 30 images/s : un coup par image plafonnerait la cadence, v2 §2.4). */
const TIRS_PAR_IMAGE_MAX = 3;
/** Retard maximal (s) rattrapé sur la cadence : au-delà (onglet gelé), on repart de maintenant plutôt que de tirer en rafale. */
const RATTRAPAGE_CADENCE_S = 0.1;
/** Attente maximale (s) de la réponse du serveur à `monter` / `siege` / `descendre` (HUD `embarquement`). */
const EMBARQUEMENT_MAX_S = 1;
/** Écart minimal (s) entre deux crans de molette (les trackpads en envoient des dizaines). */
const MOLETTE_ECART_S = 0.15;
/** Lissage (1/s) de la hauteur de l'œil (accroupi, siège) : v2 §2.8. */
const LISSAGE_OEIL = 12;
/** Roulis (rad) de la secousse d'un dégât reçu : ne touche pas le tangage (v2 §13.2.4). */
const SECOUSSE_DEGAT = 0.03;
/** Distance (m) de pas : la foulée est plus longue depuis le sprint à 12,5 m/s. */
const FOULEE_M = 3.2;
/** Vitesse perdue au contact (m/s) à partir de laquelle un choc de voiture s'entend. */
const CHOC_SEUIL = 2;
/** Explosion d'une voiture : la caméra tremble en dessous de cette distance (m), d'autant plus fort qu'on est près (roulis, rad). */
const SECOUSSE_EXPLOSION_M = 30;
const SECOUSSE_EXPLOSION = 0.09;

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

interface Distant {
  avatar: AvatarJoueur;
  pseudo: string;
  couleur: string;
}

/** Slot appelé par chaque action d'arme. */
const SLOT_DE_L_ACTION: Partial<Record<Action, Slot>> = {
  armePrincipale: "principale", armeSecondaire: "secondaire", couteau: "couteau", armeSpeciale: "speciale",
};

// ---------------------------------------------------------------------------------------------
// Jeu
// ---------------------------------------------------------------------------------------------

/**
 * `equip` : l'équipement choisi (lobby, écran de mort, pause) ; on entre avec l'arme principale en main.
 */
export function lancerJeu(canvas: HTMLCanvasElement, data: SceneData, client: ClientArene, equip: EquipementJeu, cb: JeuCallbacks): JeuHandle {
  let equipSuivant: EquipementJeu = { principale: equip.principale, secondaire: equip.secondaire };
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
  /** chat vocal de proximité (v3 §5) : activé par l'hôte (menu pause), volumes réglés à chaque image d'après les positions */
  const voix = creerChatVocal((m) => client.envoyer(m));

  // ---------- monde dynamique (voitures PNJ et conduisibles, Elsa) ----------
  const nbPnj = flotte(construireCircuits()).length;
  const mondeJeu = new MondeJeu(data, monde);
  const dyn: MondeDynamique = creerMondeDynamique(scene, { nbPnj, nbVehicules: EMPLACEMENTS_VOITURES.length, truck: placeTruck(data) });
  /** fumées, flammes et explosions des voitures (v3 §4) */
  const feux = creerFeux(scene);
  const visib = new VisibilitePseudos(monde);
  const suiviRadar = new SuiviRadar(monde);
  const kc = new ControleurKillcam();
  const vehicule = new ControleurVehicule(monde);

  // ---------- état du joueur ----------
  const [cx, cz] = ROND_POINT.centre;
  let moi: EtatMouvement = etatInitial([cx, 0, cz]);
  let lacet = 0;
  let tangage = 0;
  let apparu = false;
  let vivant = false;
  let pv: number = JEU.pvMax;
  let bouclier = 0;
  let protege = false;
  let protegeFin = 0;
  /** instant (horloge locale, s) du dernier dégât reçu : la régénération démarre `JEU.regenDelaiMs` plus tard */
  let dernierDegatT = -Infinity;
  let dernierSonRegenT = -Infinity;
  /** équipement et munitions : `ControleurArmes` (dégainage, chargeurs par arme, recharge) */
  const armes = new ControleurArmes({ principale: equip.principale, secondaire: equip.secondaire, speciale: null }, "principale");
  /** cadence locale par arme (le serveur garde la sienne) */
  const prochains = new Map<ArmeId, number>();
  let delaiApparitionT = 0;
  /** instant du dernier tir et son arme (le recul ne retombe qu'un moment après) */
  let dernierTirT = -Infinity;
  let dernierTirArme: ArmeFeuId = equip.principale;
  /** recul de tangage (rad) ajouté par les tirs et pas encore revenu ni compensé à la souris */
  let reculAcc = 0;
  /** recul visuel (rad) : s'ajoute au tangage de la vue ET du tir, retombe vite (v2 §13.2.4) */
  let kick = 0;
  /** secousse des dégâts reçus : roulis de la caméra seulement, jamais le tangage */
  let secousse = 0;
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
  /** hauteur de l'œil au-dessus des pieds, lissée (accroupi : 1,30 m ; assis : OEIL_SIEGE) */
  let hauteurOeilLissee: number = SILHOUETTE.oeil;
  /** accroupi : true = bascule, false = maintenir (réglage de l'hôte) */
  let accroupiBascule = false;
  let accroupiBascTenu = false;
  let glisseSon = false;
  /** réponse du serveur à `monter` / `siege` / `descendre` attendue jusqu'à cet instant (0 = rien) */
  let embarquementFin = 0;
  let dernierChocT = -Infinity;
  let derniereMoletteT = -Infinity;
  let distanceVisee = -1;
  /** niveau de zoom de lunette choisi, par arme (index dans `niveauxZoom`) : retenu d'une visée à l'autre */
  const niveauZoom = new Map<ArmeFeuId, number>();
  /** caméra du tueur pendant le rejeu, gardée pour la carte (« caméra figée sur son dernier état ») */
  let camTueurCache: { pos: Vec3; lacet: number; tangage: number } | null = null;
  let tempsRejeuCache: number | null = null;
  let joueursRejouesCache: Map<string, EtatJoueurSnap> | null = null;
  let vehiculesRejouesCache: Map<number, VehiculeSnap> | null = null;
  /** caméra courante (monde), pour les pseudos et le radar */
  const camPos: Vec3 = [0, 0, 0];
  let camLacet = 0;
  let camTangage = 0;

  // ---------- entrées ----------
  // Touches du joueur (lib/fps/touches.ts) : codes clavier ET boutons de souris (`Souris0`…) passent
  // par la même table, on peut donc tirer au clavier ou sauter avec un bouton latéral.
  let config = lireTouches(stockageNavigateur());
  let index = indexTouches(config);
  /** codes physiquement enfoncés */
  const appuyees = new Set<string>();
  const actionActive = (a: Action) => config[a].some((c) => c !== null && appuyees.has(c));
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
  /** joueurs interpolés à l'instant du rendu (HORS rejeu) : cibles des tirs, positions des effets */
  let etats = new Map<string, EtatJoueurSnap>();
  /** joueurs dessinés cette image : `etats`, ou le tampon long pendant la killcam */
  let etatsRendu = new Map<string, EtatJoueurSnap>();
  let t = 0; // horloge locale, s
  const ms = () => t * 1000;

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
  const armeMain: ArmeEnMain = creerArmeEnMain(armes.armeEnMain(), couleurMoi());
  porteArme.add(armeMain.group);

  // ---------- utilitaires de jeu ----------
  const assisSiege = (): Siege | null => vehicule.actif()?.siege ?? null;
  const conducteur = () => assisSiege() === 0;
  const tireInterdit = () => conducteur() && !CONDUCTEUR_TIRE;
  const vitesseH = () => Math.hypot(moi.v[0], moi.v[2]);
  const peutAgir = () => apparu && vivant;
  /** killcam en cours : rien de ce que je fais n'a de sens (mort), les effets en direct sont coupés pendant le rejeu */
  const enKillcam = () => kc.actif();

  /** Rejeu à la première personne en cours (phase « rejeu » avec la caméra du tueur) ou carte figée sur son dernier état. */
  let enReplay = false;

  /** Œil du joueur (monde), debout, accroupi (lissé) ou assis. */
  function oeil(): Vec3 {
    const s = vehicule.positionSiege();
    if (s) return [s[0], s[1] + OEIL_SIEGE, s[2]];
    return [moi.p[0], moi.p[1] + hauteurOeilLissee, moi.p[2]];
  }

  /** Arme à feu en main (null pour le couteau). */
  const armeFeu = (): ArmeFeuId | null => {
    const a = armes.armeEnMain();
    return a === "couteau" ? null : a;
  };
  const prochainDe = (a: ArmeId) => Math.max(prochains.get(a) ?? 0, delaiApparitionT);

  /** Lunette réellement active : visée tenue, arme à lunette sortie, pas en rechargement ni en killcam. */
  function lunetteActive(): boolean {
    const a = armeFeu();
    return !!a && STATS[a].zoom !== null && viseMaintenu && peutAgir() && !armes.rechargeEnCours() && !enKillcam();
  }
  const indexZoom = (a: ArmeFeuId) => niveauZoom.get(a) ?? niveauZoomDefaut(a);
  /** Champ horizontal (°) de la lunette de l'arme au niveau choisi. */
  function fovLunette(a: ArmeFeuId): number {
    const n = niveauxZoom(a);
    return n.length ? n[Math.min(n.length - 1, indexZoom(a))] : FOV_H;
  }
  /** Change le niveau de zoom de l'arme en main : `sens` +1 = plus serré ; `boucle` revient au plus large après le plus serré (touche). */
  function changerZoom(sens: 1 | -1, boucle: boolean) {
    const a = armeFeu();
    if (!a) return;
    const n = niveauxZoom(a).length;
    if (n < 2) return;
    const i = indexZoom(a);
    const j = boucle ? (i + sens + n) % n : Math.min(n - 1, Math.max(0, i + sens));
    if (j === i) return;
    niveauZoom.set(a, j);
    sons.zoom();
  }

  function demarrerRecharge() {
    const a = armeFeu();
    if (!a || !peutAgir() || enKillcam()) return;
    if (!armes.demarrerRecharge(ms())) return;
    armeMain.recharger(STATS[a].rechargeS);
    sons.recharge(a);
  }

  function cibles(): Cible[] {
    const r: Cible[] = [];
    for (const [id, e] of etats) {
      if (id === client.id) continue;
      r.push({ id, p: e.p, vivant: e.vivant, accroupi: !!e.accroupi || !!e.vehicule });
    }
    return r;
  }

  const _bouche = new THREE.Vector3();

  /** Coup de couteau : `coup` au serveur (jamais `tir`), cadence de 0,5 s, pas de recul ni de traçante. */
  function coupCouteau(): boolean {
    if (t < prochainDe("couteau")) return false;
    const o = oeil();
    const d = directionVisee(lacet, tangage, kick);
    const res = trouverCibleCouteau(monde, o, d, cibles(), client.id ?? "");
    client.envoyer({ t: "coup", o, d, cible: res ? res.cible : null });
    prochains.set("couteau", t + COUTEAU.cadenceS);
    armeMain.coup();
    sons.coup(false);
    return true;
  }

  /**
   * Un tir (aucune dispersion, v2 §13.1 : gerbe fixe pour le pompe), pile dans l'axe de la vue (§13.2.4). `_force` : outil de test (ignore la
   * souris). Renvoie vrai si le tir est parti. Le retour de touche (son, marqueur, giclée) attend le `degats` du serveur (§13.2.1).
   */
  function tirer(_force = false): boolean {
    if (!peutAgir() || entracte || enKillcam() || tireInterdit()) return false;
    if (armes.degainage(ms())) return false;
    const arme = armes.armeEnMain();
    if (arme === "couteau") return coupCouteau();
    const a = STATS[arme];
    if (armes.rechargeEnCours()) return false;
    if (armes.munitions() <= 0) { demarrerRecharge(); return false; }
    if (t < prochainDe(arme)) return false;
    const o = oeil();
    const regard = directionVisee(lacet, tangage, kick);
    const vise = viseMaintenu;
    const lunette = vise && a.zoom !== null;
    // sniper sans lunette : cône aléatoire (v3 §1) ; toutes les autres armes, et le sniper en lunette, tirent pile dans l'axe
    const ecart = dispersionTir(arme, { lunette, vitesseH: vitesseH(), auSol: moi.auSol });
    const dirs = directionsTir(arme, ecart > 0 ? devier(regard, ecart, Math.random(), Math.random()) : regard);
    const touchesDecl: { cible: string; zone: Zone; plomb: number }[] = [];
    const voituresDecl: { genre: "pnj" | "vehicule"; id: number; plomb: number }[] = [];
    const cumul = new Map<string, { degats: number; zone: Zone }>();
    const liste = cibles();
    const tsVoitures = client.maintenantServeur();
    const vehiculesVus = [...vehiculesAffichees().values()];
    const maVoiture = vehicule.actif()?.vehicule ?? null;

    armeMain.positionBouche(_bouche);
    const depart: Vec3 = lunette
      ? [o[0] + regard[0] * 0.8, o[1] + regard[1] * 0.8 - 0.08, o[2] + regard[2] * 0.8]
      : [_bouche.x, _bouche.y, _bouche.z];
    let impactsAffiches = 0;
    dirs.forEach((d, i) => {
      const imp = tracer(monde, o, d, Math.min(a.portee, PORTEE_EFFETS_M), liste, client.id ?? "");
      // une voiture plus proche que le joueur (ou le mur) visé arrête la balle (v3 §4) ; l'occupant d'une voiture reste touchable à travers elle
      const v = mondeJeu.impactVoiture(o, d, imp.distance, tsVoitures, vehiculesVus, maVoiture);
      const occupantDe = (vid: number) => !!imp.cible && etats.get(imp.cible)?.vehicule?.id === vid;
      if (v && !(v.genre === "vehicule" && occupantDe(v.id))) {
        const fin: Vec3 = [o[0] + d[0] * v.distance, o[1] + d[1] * v.distance, o[2] + d[2] * v.distance];
        effets.traçante(depart, fin, arme);
        voituresDecl.push({ genre: v.genre, id: v.id, plomb: i });
        if (impactsAffiches < 5) { impactsAffiches++; effets.impact(fin, [-d[0], -d[1], -d[2]], "#ffd9a0"); }
        return;
      }
      const fin = imp.point;
      effets.traçante(depart, fin, arme);
      if (imp.cible && imp.zone) {
        const e = etats.get(imp.cible);
        if (e && !e.protege) {
          touchesDecl.push({ cible: imp.cible, zone: imp.zone, plomb: i });
          const dg = degatsPlomb(arme, imp.zone, imp.distance);
          const c = cumul.get(imp.cible);
          if (c) { c.degats += dg; if (imp.zone === "tete") c.zone = "tete"; }
          else cumul.set(imp.cible, { degats: dg, zone: imp.zone });
        }
        // la giclée sur la cible part à la réception de `degats` (§13.2.1), pas ici
      } else if (imp.distance < a.portee - 0.01 && impactsAffiches < 5) {
        impactsAffiches++;
        effets.impact(fin, [-d[0], -d[1], -d[2]], couleurMoi());
      }
    });

    client.envoyer({ t: "tir", arme, o, d: dirs, touches: touchesDecl, ...(voituresDecl.length ? { voitures: voituresDecl } : {}) });
    if (voituresDecl.length) sons.tole();

    // estimation locale (le HUD l'ignore : seul `confirme`, reçu du serveur, compte, HUD §3.4) ; ni son ni marqueur ici
    for (const [id, c] of cumul) cb.evenement({ type: "touche", cible: id, zone: c.zone, degats: c.degats });

    // cadence (rattrape le retard d'une image, borné : onglet gelé = on repart de maintenant)
    const prevu = prochainDe(arme);
    prochains.set(arme, t - prevu < RATTRAPAGE_CADENCE_S ? prevu + a.cadenceS : t + a.cadenceS);
    armes.tirEffectue();
    armeMain.tirer();
    sons.tir(arme);
    const k = vise ? 0.6 : 1;
    const monte = a.recul.tangage * k * (0.8 + 0.4 * Math.random());
    const avant = tangage;
    tangage = borne(tangage + monte, -TANGAGE_MAX, TANGAGE_MAX);
    reculAcc += tangage - avant;
    dernierTirT = t;
    dernierTirArme = arme;
    lacet += (Math.random() - 0.5) * 2 * a.recul.lacet * k;
    kick += a.recul.tangage * 0.9;
    if (armes.munitions() <= 0 && armes.armeEnMain() === arme) prochains.set(arme, Math.max(prochainDe(arme), t + 0.15));
    return true;
  }

  // ---------- équipement ----------
  /** Envoie `main` après un changement d'arme accepté localement (le dégainage et la recharge annulée sont gérés par le contrôleur). */
  function apresChangementArme(ok: boolean) {
    if (!ok) return;
    client.envoyer({ t: "main", slot: armes.slotActif() });
    viseMaintenu = viseMaintenu && armes.armeEnMain() !== "couteau";
  }
  const peutChangerArme = () => peutAgir() && !enKillcam();
  function changerSlot(slot: Slot) {
    if (!peutChangerArme()) return;
    apresChangementArme(armes.equiper(slot, ms()));
  }
  function molette(sens: 1 | -1) {
    if (!peutChangerArme()) return;
    apresChangementArme(armes.molette(sens, ms()));
  }

  function reentrer() {
    evince = false;
    client.envoyer({ t: "rejoindre", principale: equipSuivant.principale, secondaire: equipSuivant.secondaire });
  }

  /** Équipement de la prochaine apparition (immédiat si mort). */
  function equiper(principale: EquipementJeu["principale"], secondaire: EquipementJeu["secondaire"]) {
    equipSuivant = { principale, secondaire };
    client.envoyer({ t: "equiper", principale, secondaire });
  }

  // ---------- véhicules ----------
  function attendreReponseVehicule() {
    embarquementFin = t + EMBARQUEMENT_MAX_S;
  }

  /** E : monter dans la voiture à portée, ou en descendre. Le serveur attribue le siège ; on attend sa réponse (≤ 1 s). */
  function interagir() {
    if (!peutAgir() || enKillcam() || embarquementFin > 0) return;
    if (vehicule.actif()) {
      client.envoyer({ t: "descendre" });
      attendreReponseVehicule();
      return;
    }
    const inv = mondeJeu.invite(moi.p, null, client.maintenantServeur());
    if (inv.invite === "monter" && inv.vehicule !== null) {
      client.envoyer({ t: "monter", vehicule: inv.vehicule });
      attendreReponseVehicule();
    }
  }

  /** F : change de place dans la voiture (la prochaine place libre, sinon la suivante : le serveur répond `refus` si elle est prise). */
  function changerSiege() {
    const info = vehicule.actif();
    if (!info || !peutAgir() || enKillcam() || embarquementFin > 0) return;
    const occupants = mondeJeu.siegesDe(info.vehicule);
    let cible = ((info.siege + 1) % 4) as Siege;
    for (let k = 1; k <= 3; k++) {
      const s = ((info.siege + k) % 4) as Siege;
      if (occupants[s] == null) { cible = s; break; }
    }
    client.envoyer({ t: "siege", siege: cible });
    attendreReponseVehicule();
  }

  function entrerVehicule(id: number, siege: Siege, etat: EtatVehicule) {
    vehicule.entrer({ vehicule: id, siege }, etat);
    embarquementFin = 0;
    // à pied, rien ne reste en cours : glissade, accroupi, visée
    moi.glisse = null;
    moi.accroupi = false;
    accroupiBascTenu = false;
    viseMaintenu = false;
    sons.mur(false);
    const s = vehicule.positionSiege();
    if (s) { moi.p = [s[0], s[1], s[2]]; moi.v = [0, 0, 0]; }
  }

  /** Sort de la voiture. `p` (message `descente`) téléporte le joueur, même si le jeu ne se croyait plus assis. */
  function quitterVehicule(p?: Vec3) {
    const etaitAssis = vehicule.actif() !== null;
    vehicule.sortir();
    embarquementFin = 0;
    sons.moteur(null);
    if (etaitAssis || p) {
      // à la descente l'œil part de la hauteur du siège et se relève jusqu'à 1,95 m (lissage)
      moi = etatInitial(p ?? [moi.p[0], moi.p[1], moi.p[2]]);
      hauteurOeilLissee = OEIL_SIEGE;
    }
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
    visib.oublier(id);
  }

  function majInfos(liste: JoueurPublic[]) {
    infos.clear();
    for (const j of liste) infos.set(j.id, j);
    voix.presence(liste, client.id);
    // pseudo ou couleur changés : l'avatar est recréé à la prochaine image
    for (const [id, d] of [...distants]) {
      const j = infos.get(id);
      if (!j || j.pseudo !== d.pseudo || j.couleur !== d.couleur) retirerAvatar(id);
    }
  }

  function posTouche(id: string, zone: Zone): Vec3 | null {
    const e = etats.get(id);
    if (!e) return null;
    const s = e.accroupi || e.vehicule ? { tete: 1.3 - 0.1, centre: 0.8 } : { tete: SILHOUETTE.tete.y - 0.1, centre: SILHOUETTE.centreY };
    return [e.p[0], e.p[1] + (zone === "tete" ? s.tete : s.centre), e.p[2]];
  }

  function terminerKillcam() {
    kc.terminer();
    camTueurCache = null;
    tempsRejeuCache = null;
    joueursRejouesCache = null;
    vehiculesRejouesCache = null;
    enReplay = false;
  }

  function apparaitre(m: Extract<MessageServeur, { t: "apparition" }>) {
    terminerKillcam();
    quitterVehicule();
    moi = etatInitial(m.p);
    lacet = m.lacet;
    tangage = 0;
    kick = 0;
    secousse = 0;
    reculAcc = 0;
    dernierTirT = -Infinity;
    apparu = true;
    evince = false;
    vivant = true;
    pv = m.pv;
    bouclier = m.bouclier;
    protege = true;
    protegeFin = t + JEU.protectionMs / 1000;
    dernierDegatT = t;
    armes.appliquerServeur(m, ms());
    prochains.clear();
    delaiApparitionT = t + 0.3;
    hauteurOeilLissee = hauteurOeil(false);
    accroupiBascTenu = false;
    embarquementFin = 0;
    viseMaintenu = false;
    mortT = 0;
    // un tir maintenu pendant la mort ne doit pas partir tout seul à l'apparition (il ferait perdre la
    // protection d'apparition) : mitraillette comprise, il faut relâcher puis réappuyer
    tirConsomme = true;
    tirMaintenu = false;
  }

  /** `degats` dont je suis l'auteur : retour de touche CONFIRMÉ par le serveur (zone et dégâts du serveur, §13.2.1). */
  function toucheConfirmee(m: Extract<MessageServeur, { t: "degats" }>) {
    sons.touche(m.zone === "tete");
    cb.evenement({ type: "confirme", cible: m.cible, degats: m.degats, absorbe: m.absorbe ?? 0, zone: m.zone, tue: m.pv <= 0 });
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
          quitterVehicule();
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
        kc.alimenter(m.ts, m.j, m.vehicules);
        mondeJeu.alimenterVehicules(m.ts, m.vehicules);
        const s = m.j.find((x) => x.id === client.id);
        if (s && vivant) {
          // des PV qui remontent sans cadeau d'Elsa : la régénération tourne (le délai de 5 s est donc écoulé)
          if (s.pv > pv && s.pv < JEU.pvMax) {
            dernierDegatT = Math.min(dernierDegatT, t - JEU.regenDelaiMs / 1000);
            if (t - dernierSonRegenT > 0.25) { dernierSonRegenT = t; sons.regen(); }
          }
          pv = s.pv;
          bouclier = s.bouclier ?? 0;
          protege = s.protege;
        }
        break;
      }
      case "apparition":
        if (m.id === client.id) apparaitre(m);
        break;
      case "equipement":
        armes.appliquerServeur(m, ms());
        break;
      case "tir": {
        if (m.id === client.id) break;
        // écho de la mini-map : un tir entendu dont le tireur n'est pas à l'écran (HUD §3.3)
        ajouterEcho(radarFrame, m.o[0], m.o[2], suiviRadar.vu(m.id) > 0);
        // pendant le rejeu, rien du présent ne se superpose au passé (§2.5)
        if (enReplay) break;
        const a = STATS[m.arme];
        const liste = cibles();
        const avatar = distants.get(m.id)?.avatar;
        const depart: Vec3 = avatar ? avatar.positionBouche() : m.o;
        const vus = [...vehiculesAffichees().values()];
        const tsV = client.maintenantServeur();
        for (const d of m.d) {
          const imp = tracer(monde, m.o, d, Math.min(a.portee, PORTEE_EFFETS_M), liste, m.id);
          const v = mondeJeu.impactVoiture(m.o, d, imp.distance, tsV, vus, etats.get(m.id)?.vehicule?.id ?? null);
          if (v && !imp.cible) {
            const fin: Vec3 = [m.o[0] + d[0] * v.distance, m.o[1] + d[1] * v.distance, m.o[2] + d[2] * v.distance];
            effets.traçante(depart, fin, m.arme);
            effets.impact(fin, [-d[0], -d[1], -d[2]], "#ffd9a0");
            continue;
          }
          effets.traçante(depart, imp.point, m.arme);
          if (!imp.cible && imp.distance < a.portee - 0.01) effets.impact(imp.point, [-d[0], -d[1], -d[2]], couleurDe(m.id));
        }
        avatar?.tirer();
        const cam = oeil();
        const dx = m.o[0] - cam[0], dz = m.o[2] - cam[2];
        sons.tir(m.arme, { distance: Math.hypot(dx, m.o[1] - cam[1], dz), pan: panSon(lacet, dx, dz) });
        break;
      }
      case "coup": {
        if (m.id === client.id || enReplay) break;
        distants.get(m.id)?.avatar.coup();
        const cam = oeil();
        const dx = m.o[0] - cam[0], dz = m.o[2] - cam[2];
        sons.coup(false, { distance: Math.hypot(dx, m.o[1] - cam[1], dz), pan: panSon(lacet, dx, dz) });
        break;
      }
      case "degats": {
        if (m.cible === client.id) {
          pv = m.pv;
          bouclier = m.bouclier;
          dernierDegatT = t;
          if (vivant) {
            sons.degat();
            const sens = Math.random() < 0.5 ? -1 : 1;
            secousse = SECOUSSE_DEGAT * sens;
            let ang = 0;
            if (m.src) ang = angleRelatif(lacet, m.src[0] - moi.p[0], m.src[2] - moi.p[2]);
            else {
              const par = etats.get(m.par);
              if (par) ang = angleRelatif(lacet, par.p[0] - moi.p[0], par.p[2] - moi.p[2]);
            }
            cb.evenement({ type: "degat", par: m.par, degats: m.degats, angle: ang });
          }
        } else {
          if (!enReplay) {
            const c = posTouche(m.cible, m.zone);
            if (c) effets.eclaboussure(c, couleurDe(m.cible));
            distants.get(m.cible)?.avatar.toucher();
          }
          if (m.par === client.id) toucheConfirmee(m);
        }
        break;
      }
      case "mort": {
        if (m.cible === client.id) {
          vivant = false;
          pv = 0;
          bouclier = 0;
          mortT = 0;
          mortSigne = Math.random() < 0.5 ? -1 : 1;
          reapparitionFin = t + m.delai / 1000;
          viseMaintenu = false;
          tirMaintenu = false;
          accroupiBascTenu = false;
          // l'occupant d'un véhicule en est éjecté à sa mort
          vehicule.sortir();
          embarquementFin = 0;
          sons.moteur(null);
          sons.mur(false);
          kc.surMort(m, client.id);
          cb.evenement({ type: "mort", par: m.par, arme: m.arme, cause: m.cause, zone: m.zone, delai: m.delai, ts: m.ts, tueur: m.tueur });
        } else if (m.par === client.id) {
          sons.kill();
          cb.evenement({ type: "kill", cible: m.cible, zone: m.zone, arme: m.arme });
        }
        break;
      }
      case "elsa":
        mondeJeu.majElsa(m.elsa);
        break;
      case "ramassage":
        if (m.par === client.id) {
          sons.ramassage(m.genre);
          cb.evenement({ type: "bonus", genre: m.genre, arme: m.arme });
        }
        break;
      case "sieges":
        mondeJeu.majSieges(m.vehicules);
        break;
      case "voitures":
        mondeJeu.majVoitures(m.etats);
        break;
      case "voix":
        voix.recevoir(m.de, m.s);
        break;
      case "explosion": {
        ajouterEcho(radarFrame, m.p[0], m.p[2], false);
        if (enReplay) break;
        feux.explosion(m.p);
        const cam = oeil();
        const dx = m.p[0] - cam[0], dz = m.p[2] - cam[2];
        const dist = Math.hypot(dx, m.p[1] - cam[1], dz);
        sons.explosion({ distance: dist, pan: panSon(lacet, dx, dz) });
        if (vivant && dist < SECOUSSE_EXPLOSION_M) secousse = SECOUSSE_EXPLOSION * (1 - dist / SECOUSSE_EXPLOSION_M) * (Math.random() < 0.5 ? -1 : 1);
        break;
      }
      case "embarque":
        if (vivant) entrerVehicule(m.vehicule, m.siege, { p: m.p, cap: m.cap, v: 0 });
        break;
      case "refus":
        embarquementFin = 0;
        cb.evenement({ type: "refus", action: m.action, raison: m.raison });
        // arène pleine (16 agents en jeu) : on ne reste pas devant un rond-point vide à attendre une apparition qui n'arrivera pas
        if (m.action === "rejoindre") cb.sortir();
        break;
      case "descente":
        // sortie volontaire ou expulsion (nouveau match) : on se téléporte, sans toucher aux munitions
        quitterVehicule(m.p);
        break;
      default:
        break;
    }
  }

  // ---------- entrées : événements ----------
  /** Front montant d'une touche : déclenche les actions ponctuelles (saut, recharge, tir, armes, accroupi, véhicule). */
  const presser = (code: string) => {
    if (appuyees.has(code)) return;
    appuyees.add(code);
    for (const a of index.get(code) ?? []) {
      switch (a) {
        case "saut": sautDemande = true; break;
        case "recharger": demarrerRecharge(); break;
        case "tir": if (vivant) { tirMaintenu = true; tirPresse = t; tirConsomme = false; } break;
        case "visee": viseMaintenu = true; break;
        case "accroupi": if (accroupiBascule) accroupiBascTenu = !accroupiBascTenu; break;
        case "armePrincipale": case "armeSecondaire": case "couteau": case "armeSpeciale": {
          const s = SLOT_DE_L_ACTION[a];
          if (s) changerSlot(s);
          break;
        }
        case "armePrecedente": if (peutChangerArme()) apresChangementArme(armes.rapide(ms())); break;
        case "couteauRapide": if (peutChangerArme()) apresChangementArme(armes.couteauRapide(ms())); break;
        case "interagir": interagir(); break;
        case "siege": changerSiege(); break;
        case "passer": if (kc.actif() && kc.phase() === "rejeu") kc.passer(); break;
        case "zoomLunette": if (lunetteActive()) changerZoom(1, true); break;
        case "parler": voix.parler(true); break;
        default: break;
      }
    }
  };
  const relacher = (code: string) => {
    if (!appuyees.delete(code)) return;
    // une autre touche de la même action peut encore être enfoncée
    for (const a of index.get(code) ?? []) {
      if (a === "tir") tirMaintenu = tirMaintenu && actionActive("tir");
      else if (a === "visee") viseMaintenu = actionActive("visee");
      else if (a === "parler") voix.parler(actionActive("parler"));
    }
  };
  const surKeyDown = (e: KeyboardEvent) => {
    if (dansUnChamp(e.target)) return;
    if (!verrouille()) return;
    const actions = index.get(e.code);
    // l'action « passer » (Espace par défaut, remappable) saute le rejeu de la killcam ; elle partage Espace avec « saut », qui ne doit
    // pas partir pendant la mort (sinon un saut en attente suit le joueur à sa réapparition)
    if (actions?.includes("passer") && kc.actif() && kc.phase() === "rejeu") { e.preventDefault(); if (!e.repeat) kc.passer(); return; }
    // le tableau des scores (Tab par défaut) est géré par l'UI React, qui bloque elle-même le focus
    if (actions && !actions.includes("scores")) e.preventDefault();
    if (e.repeat) return;
    presser(e.code);
  };
  const surKeyUp = (e: KeyboardEvent) => {
    relacher(e.code);
  };
  const toutRelacher = () => {
    appuyees.clear();
    tirMaintenu = false;
    viseMaintenu = false;
    voix.parler(false);
  };
  const surMouseDown = (e: MouseEvent) => {
    if (!verrouille()) { demanderVerrou(); return; }
    e.preventDefault();
    presser(codeSouris(e.button));
  };
  const surMouseUp = (e: MouseEvent) => {
    relacher(codeSouris(e.button));
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
  /** Molette : slot suivant / précédent (comportement fixe, non remappable). */
  const surWheel = (e: WheelEvent) => {
    if (!verrouille()) return;
    e.preventDefault();
    if (Math.abs(e.deltaY) < 1 || t - derniereMoletteT < MOLETTE_ECART_S) return;
    derniereMoletteT = t;
    // en lunette, la molette règle le zoom (vers l'avant = plus serré) au lieu de changer d'arme
    if (lunetteActive()) { changerZoom(e.deltaY < 0 ? 1 : -1, false); return; }
    molette(e.deltaY > 0 ? 1 : -1);
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
  window.addEventListener("wheel", surWheel, { passive: false });
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
  /** Valeurs continues du HUD : objet stable, mis à jour à chaque image (lu en rAF par `useHudLive`, aucun rendu React). */
  const live: HudLive = { recharge: 0, vitesse: 0, vitesseKmh: 0, regenDelai: 1 };
  const radarFrame: RadarFrame = creerRadarFrame();
  let dernierHud: HudEtat | null = null;
  let accHud = ECART_HUD_S;
  /** régénération en cours : PV manquants et délai sans dégâts écoulé */
  const regenEnCours = () => vivant && pv < JEU.pvMax && t - dernierDegatT >= JEU.regenDelaiMs / 1000;
  /** Grossissement affiché en lunette (« ×6 ») : rapport des tangentes du demi-champ normal et du demi-champ zoomé. */
  const zoomX = (zoom: number | null) => (zoom === null ? 0 : Math.round(Math.tan((FOV_H * Math.PI) / 360) / Math.tan((zoom * Math.PI) / 360)));
  /** Rayon du cercle de dispersion (part de la demi-hauteur de l'écran, au centième), 0 sans dispersion. */
  function ecartViseur(): number {
    const a = armeFeu();
    if (!a || !peutAgir()) return 0;
    const ecart = dispersionTir(a, { lunette: lunetteActive(), vitesseH: vitesseH(), auSol: moi.auSol });
    if (ecart <= 0) return 0;
    return Math.round((Math.tan(ecart) / Math.tan((fovV * Math.PI) / 360)) * 100) / 100;
  }

  function etatHud(): HudEtat {
    const arme = armes.armeEnMain();
    const a = arme === "couteau" ? null : STATS[arme];
    const info = vehicule.actif();
    const lunette = lunetteActive();
    const af = armeFeu();
    const inv = peutAgir() && !enKillcam()
      ? mondeJeu.invite(moi.p, info ? info.siege : null, client.maintenantServeur())
      : { invite: "" as const, detail: "", vehicule: null };
    const kcActif = kc.actif();
    const phase = kcActif ? kc.phase() : "";
    const progression = kcActif ? kc.progression() : -1;
    return {
      pv: Math.max(0, Math.round(pv)),
      bouclier: Math.max(0, Math.round(bouclier)),
      arme,
      slot: armes.slotActif(),
      slots: serialiserSlots(armes.lignes()),
      equipSuivant: `${equipSuivant.principale}|${equipSuivant.secondaire}`,
      munitions: arme === "couteau" ? 0 : Math.max(0, armes.munitions()),
      chargeur: armes.chargeur(),
      // spéciale d'Elsa (munitions totales, retirée à 0) : aucune réserve ; les autres armes ont une réserve illimitée
      reserve: a?.sansRecharge ? 0 : -1,
      recharge: armes.rechargeEnCours(),
      degainage: armes.degainage(ms()),
      vise: viseMaintenu && peutAgir(),
      lunette,
      zoomX: lunette && af ? zoomX(fovLunette(af)) : 0,
      zoomNiveau: lunette && af ? indexZoom(af) : -1,
      zoomNiveaux: lunette && af ? niveauxZoom(af).length : 0,
      ecartViseur: ecartViseur(),
      distanceVisee: lunette ? distanceVisee : -1,
      mur: !!moi.mur && vivant,
      mort: !vivant,
      reapparitionDans: vivant ? 0 : Math.max(0, Math.round((reapparitionFin - t) * 10) / 10),
      protege: protege && vivant,
      protegeRestant: protege && vivant ? Math.max(0.5, Math.ceil((protegeFin - t) * 2) / 2) : 0,
      verrouille: verrouille(),
      connecte: client.id !== null,
      entracte,
      accroupi: vivant && moi.accroupi && !info,
      glisse: vivant && !!moi.glisse && !info,
      regen: regenEnCours(),
      bonusVitesse: arme === "couteau" ? COUTEAU.vitesse : 1,
      invite: inv.invite,
      inviteDetail: inv.detail,
      vehicule: !!info,
      vehiculeId: info ? info.vehicule : -1,
      siege: info ? info.siege : -1,
      tireInterdit: tireInterdit(),
      embarquement: embarquementFin > 0,
      killcam: progression < 0 ? -1 : Math.round(progression * 50) / 50,
      voix: !voix.actif() ? "" : voix.emet() ? "emet" : "pret",
      voixParlants: voix.actif() ? voix.parlants().map(pseudoDe).join(" · ") : "",
      killcamPhase: phase === "rejeu" || phase === "carte" ? phase : "",
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

  // ---------- radar (mini-map) ----------
  const listeRadar: JoueurRadarEntree[] = [];
  /** Remplit le `RadarFrame` unique : joueurs VUS seulement (pas de wallhack), voitures, échos, Elsa. Une fois par image. */
  function remplirRadar(dt: number) {
    const info = vehicule.actif();
    viderRadarFrame(radarFrame);
    const pos = vehicule.positionSiege() ?? moi.p;
    radarFrame.x = pos[0];
    radarFrame.z = pos[2];
    radarFrame.lacet = lacet;
    const ve = vehicule.etat();
    radarFrame.capVehicule = info && ve ? ve.cap : NaN;
    radarFrame.vitesse = info && ve ? Math.abs(ve.v) : vitesseH();
    // joueurs : évalués sur l'œil et le regard de la caméra courante
    listeRadar.length = 0;
    if (!enReplay) {
      for (const [id, e] of etatsRendu) {
        if (id === client.id) continue;
        const dansMonVehicule = !!info && !!e.vehicule && e.vehicule.id === info.vehicule;
        listeRadar.push({
          id, p: e.p, lacet: e.lacet, couleur: couleurDe(id), vivant: e.vivant, accroupi: !!e.accroupi,
          enVoiture: !!e.vehicule, dansMonVehicule,
        });
      }
      suiviRadar.maj(radarFrame, t, dt, camPos, directionVisee(camLacet, camTangage, 0), listeRadar);
    }
    // voitures PNJ (calculées à l'horloge serveur) et conduisibles
    const tsServeur = client.maintenantServeur();
    const pnj = mondeJeu.etatsPnj(tsServeur);
    for (let i = 0; i < pnj.length; i++) if (!mondeJeu.pnjDetruite(i)) ajouterVoiturePnj(radarFrame, pnj[i].p[0], pnj[i].p[2], pnj[i].cap);
    for (const v of vehiculesAffichees().values()) {
      const sieges = mondeJeu.siegesDe(v.id);
      let occupants = 0;
      for (const s of sieges) if (s != null) occupants++;
      ajouterVoiture(radarFrame, { id: v.id, x: v.p[0], z: v.p[2], cap: v.cap, occupants, places: 4, moi: !!info && info.vehicule === v.id });
    }
    // Elsa : losange fixe, cadeau fléché pendant l'offre
    const pe = mondeJeu.position();
    radarFrame.elsaPos.x = pe.x;
    radarFrame.elsaPos.z = pe.z;
    const offre = mondeJeu.elsa()?.offre ?? null;
    definirElsa(radarFrame, offre ? { genre: offre.genre, finT: offre.finT } : null);
    purgerEchos(radarFrame, dt);
  }

  // ---------- boucle ----------
  let raf = 0;
  let dernierT = performance.now();
  let accEtat = 0;
  let seq = 0;
  let distPas = 0;
  let murActif = false;

  function entrees(): Entrees {
    const k = (a: Action) => (actionActive(a) ? 1 : 0);
    return {
      avant: k("avant") - k("arriere"),
      droite: k("droite") - k("gauche"),
      saut: actionActive("saut") || sautDemande,
      sprint: actionActive("sprint"),
      accroupi: accroupiBascule ? accroupiBascTenu : actionActive("accroupi"),
      lacet,
    };
  }

  /** Voitures conduisibles interpolées à l'instant du rendu (calculées une fois par image) ; le tampon long en rejeu. */
  let baseVehicules = new Map<number, VehiculeSnap>();
  /** Voitures conduisibles à dessiner : interpolées, sauf la mienne quand je la conduis (état local, sans retard). */
  function vehiculesAffichees(): Map<number, VehiculeSnap> {
    const base = baseVehicules;
    const info = vehicule.actif();
    if (!info || !vehicule.estConducteur() || enReplay) return base;
    const e = vehicule.etat();
    if (!e) return base;
    const res = new Map(base);
    res.set(info.vehicule, { id: info.vehicule, p: [e.p[0], e.p[1], e.p[2]], cap: e.cap, v: e.v });
    return res;
  }

  const listeVisible: JoueurVisible[] = [];
  function majDistants(dt: number) {
    etats = interp.echantillon(client.maintenantServeur() - JEU.interpolationMs);
    {
      // conducteur : les occupants de ma voiture (dessinée à l'état local) suivent la caisse, sinon ils flottent 3 à 4 m derrière
      const info = vehicule.actif();
      const ev = info && vehicule.estConducteur() ? vehicule.etat() : null;
      if (info && ev) etats = recalerOccupants(etats, client.id, info.vehicule, ev);
    }
    etatsRendu = enReplay && joueursRejouesCache ? joueursRejouesCache : etats;
    // pendant le rejeu, notre propre avatar est dessiné (on se voit mourir) ; sinon jamais
    for (const [id, e] of etatsRendu) {
      if (id === client.id && !enReplay) continue;
      const d = distants.get(id) ?? creerAvatarDistant(id);
      d.avatar.maj(e, dt);
    }
    for (const id of [...distants.keys()]) {
      if (!etatsRendu.has(id) || (id === client.id && !enReplay)) retirerAvatar(id);
    }
    // pseudos : seulement si le joueur est VU (distance, champ de vision, ligne de vue), jamais pendant le rejeu
    listeVisible.length = 0;
    for (const [id, e] of etatsRendu) {
      if (id === client.id) continue;
      listeVisible.push({ id, p: e.p, accroupi: !!e.accroupi || !!e.vehicule, vivant: e.vivant });
    }
    const te = dyn.elsaTete();
    listeVisible.push({ id: "elsa", p: [te[0], te[1] - SILHOUETTE.tete.y, te[2]], vivant: true });
    const regard = directionVisee(camLacet, camTangage, 0);
    visib.maj(t, dt, camPos, regard, listeVisible);
    for (const [id, d] of distants) {
      const e = etatsRendu.get(id);
      if (!e) continue;
      const dist = Math.hypot(e.p[0] - camPos[0], e.p[1] - camPos[1], e.p[2] - camPos[2]);
      d.avatar.afficherPseudo(enReplay ? 0 : visib.alpha(id), dist);
    }
    dyn.afficherPseudoElsa(enReplay ? 0 : visib.alpha("elsa"));
  }

  const sourcesFeux: SourceFeu[] = [];
  /** positions des têtes des autres joueurs pour le chat vocal (réutilisée d'une image à l'autre) */
  const sourcesVoix = new Map<string, { p: Vec3; vivant: boolean }>();
  /** Chat vocal : on entend depuis sa propre tête (même pendant la killcam : le présent, pas le rejeu). */
  function majVoix() {
    if (!voix.actif()) return;
    sourcesVoix.clear();
    for (const [id, e] of etats) {
      if (id === client.id) continue;
      sourcesVoix.set(id, { p: [e.p[0], e.p[1] + oeilDe(e), e.p[2]], vivant: e.vivant });
    }
    voix.placer(oeil(), lacet, sourcesVoix);
  }
  /** Voitures PNJ, voitures conduisibles, épaves, feux et Elsa (rendu three), à l'horloge serveur ou, en rejeu, à l'instant rejoué. */
  function majMondeDynamique(dt: number) {
    const tsServeur = client.maintenantServeur();
    const tsPnj = enReplay && tempsRejeuCache !== null ? tempsRejeuCache : tsServeur;
    const pnj = mondeJeu.etatsPnj(tsPnj);
    dyn.majVoituresPnj(pnj, (i) => mondeJeu.pnjDetruite(i));
    dyn.majEpaves(mondeJeu.voituresAbimees());
    const affichees = vehiculesAffichees();
    // fumée et flammes : sur la voiture abîmée là où elle roule, sur l'épave là où elle a sauté
    sourcesFeux.length = 0;
    for (const e of mondeJeu.voituresAbimees()) {
      if (e.etat === "epave") { if (e.p) sourcesFeux.push({ p: e.p, niveau: "epave" }); continue; }
      const p = e.genre === "pnj" ? pnj[e.id]?.p : affichees.get(e.id)?.p;
      if (p) sourcesFeux.push({ p, niveau: e.etat });
    }
    feux.maj(dt, sourcesFeux);
    const liste = [...affichees.values()];
    const couleurs = new Map<number, string>();
    for (const v of liste) {
      const pilote = mondeJeu.siegesDe(v.id)[0];
      if (pilote) couleurs.set(v.id, couleurDe(pilote));
    }
    dyn.majVoituresJoueurs(liste, couleurs);
    dyn.majElsa(mondeJeu.elsa(), t);
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
      // aucun état résiduel de l'ancienne session : voiture, killcam, pseudos, radar, Elsa
      terminerKillcam();
      quitterVehicule();
      mondeJeu.reinitialiser();
      visib.vider();
      suiviRadar.vider();
      client.envoyer({ t: "rejoindre", principale: equipSuivant.principale, secondaire: equipSuivant.secondaire });
    } else if (client.id !== null) {
      idConnu = client.id;
    }
  }

  /** Message d'état du joueur (à pied, ou passager d'une voiture) ; le conducteur envoie `conduite`. */
  function envoyerEtat() {
    if (!apparu || !vivant) return;
    const vue = tangageDeVue(tangage, kick);
    const info = vehicule.actif();
    if (info) {
      if (vehicule.estConducteur()) {
        const m = vehicule.messageConduite(lacet, vue);
        if (m) client.envoyer(m);
      } else {
        const ve = vehicule.etat();
        const s = vehicule.positionSiege();
        if (!ve || !s) return;
        const av = [-Math.sin(ve.cap) * ve.v, 0, -Math.cos(ve.cap) * ve.v] as Vec3;
        client.envoyer({ t: "etat", seq: ++seq, p: [s[0], s[1], s[2]], v: av, lacet, tangage: vue, posture: "sol", mur: 0 });
      }
      return;
    }
    client.envoyer({
      t: "etat", seq: ++seq, p: [moi.p[0], moi.p[1], moi.p[2]], v: [moi.v[0], moi.v[1], moi.v[2]],
      lacet, tangage: vue, posture: postureDe(moi), mur: coteMurDe(moi),
      ...(moi.accroupi ? { accroupi: true } : {}),
      ...(moi.accroupi && moi.glisse ? { glisse: true } : {}),
    });
  }

  /** Place la caméra : survol avant la première apparition, première personne, rejeu du tueur ou caméra de mort. */
  function placerCamera(dt: number, vise: boolean, lunetteAct: boolean, vh: number) {
    const a = armeFeu();
    const cibleFov = lunetteAct && a ? fovLunette(a) : vise ? FOV_H_VISEE : FOV_H;
    fovH += (cibleFov - fovH) * lissage(14, dt);
    appliquerFov();
    kick *= Math.exp(-11 * dt);
    secousse *= Math.exp(-11 * dt);

    if (enReplay) {
      // vue du tueur : il est assis ou debout, ses angles sont ceux de son dernier snap rejoué
      const c = camTueurCache;
      if (c) {
        camera.position.set(c.pos[0], c.pos[1], c.pos[2]);
        camera.rotation.set(tangageDeVue(c.tangage, 0), c.lacet, 0);
        camPos[0] = c.pos[0]; camPos[1] = c.pos[1]; camPos[2] = c.pos[2];
        camLacet = c.lacet;
        camTangage = c.tangage;
      }
      return;
    }
    if (!apparu) {
      // en attente de la première apparition : survol de l'arène, centré sur le rond-point
      camera.position.set(cx, 70, cz + 90);
      camera.rotation.set(-0.5, 0, 0);
      camPos[0] = cx; camPos[1] = 70; camPos[2] = cz + 90;
      camLacet = 0;
      camTangage = -0.5;
    } else if (vivant) {
      const assis = vehicule.actif() !== null;
      const cible = assis ? OEIL_SIEGE : hauteurOeil(moi.accroupi);
      hauteurOeilLissee += (cible - hauteurOeilLissee) * lissage(LISSAGE_OEIL, dt);
      const bob = reduit || assis ? 0 : Math.sin(t * 11) * 0.025 * Math.min(1, vh / 9) * (moi.auSol && !moi.glisse ? 1 : 0);
      const o = oeil();
      camera.position.set(o[0], o[1] + bob, o[2]);
      const [rx, ry, rz] = rotationCamera(lacet, tangage, kick, assis ? 0 : moi.inclinaison, secousse);
      camera.rotation.set(rx, ry, rz);
      camPos[0] = o[0]; camPos[1] = o[1] + bob; camPos[2] = o[2];
      camLacet = lacet;
      camTangage = rx;
    } else {
      // mort sans rejeu (repli) : la caméra s'effondre et bascule sur le côté
      mortT += dt;
      const k = borne(mortT / 0.7, 0, 1);
      const e = 1 - (1 - k) * (1 - k);
      const base = vehicule.positionSiege() ?? moi.p;
      const haut = base[1] + hauteurOeilLissee + (0.3 - hauteurOeilLissee) * e;
      camera.position.set(base[0], haut, base[2]);
      camera.rotation.set(tangage + (-0.35 - tangage) * e, lacet, mortSigne * 1.15 * e);
      camPos[0] = base[0]; camPos[1] = haut; camPos[2] = base[2];
      camLacet = lacet;
      camTangage = tangage;
    }
  }

  function frame(maintenant: number) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = borne((maintenant - dernierT) / 1000, 0, 0.1);
    dernierT = maintenant;
    t += dt;
    reconnexion();

    // --- killcam : machine, rejeu ou carte figée ---
    if (kc.actif()) {
      kc.maj(dt);
      const phase = kc.phase();
      const cam = phase === "rejeu" ? kc.camera() : null;
      if (cam) {
        camTueurCache = cam;
        tempsRejeuCache = kc.tempsServeur();
        joueursRejouesCache = kc.joueursRejoues();
        vehiculesRejouesCache = kc.vehiculesRejoues();
      } else if (phase === "carte" && camTueurCache) {
        // carte du tueur : le monde reste figé à l'instant de la mort (jamais les Maps vides de `joueursRejoues`, hors rejeu)
        const ts = kc.tempsFige();
        if (ts !== null) {
          tempsRejeuCache = ts;
          joueursRejouesCache = kc.joueursFiges();
          vehiculesRejouesCache = kc.vehiculesFiges();
          camTueurCache = kc.cameraFigee() ?? camTueurCache;
        }
      }
      enReplay = (phase === "rejeu" || phase === "carte") && camTueurCache !== null;
    } else if (enReplay) {
      terminerKillcam();
    }

    baseVehicules = enReplay && vehiculesRejouesCache ? vehiculesRejouesCache : mondeJeu.vehiculesA(client.maintenantServeur() - JEU.interpolationMs);

    // --- état des armes : recharge, rechargement automatique, modèle en main ---
    armes.majRecharge(ms());
    {
      const a = armeFeu();
      if (a && peutAgir() && !enKillcam() && armes.munitions() <= 0 && !armes.rechargeEnCours() && t >= prochainDe(a)) demarrerRecharge();
    }
    armeMain.changer(enReplay ? (kc.info()?.arme ?? armes.armeEnMain()) : armes.armeEnMain());
    if (embarquementFin > 0 && t >= embarquementFin) embarquementFin = 0;

    // --- mouvement ---
    const aVerrou = verrouille();
    const en = entrees();
    const actif = vivant && apparu && !enReplay && (aVerrou || forceActif);
    const arme = armes.armeEnMain();
    const a = arme === "couteau" ? null : STATS[arme];
    const info = vehicule.actif();
    // Le fusil à lunette ne vise pas pendant le rechargement : l'arme reste visible et le champ normal
    // (sinon, clic droit tenu, l'arme disparaissait sans lunette ni animation de rechargement).
    const vise = viseMaintenu && peutAgir() && !!a && !(a.zoom !== null && armes.rechargeEnCours()) && !enKillcam();
    if (info) {
      // dans une voiture : le conducteur la simule, le passager la suit ; le joueur n'a plus de mouvement propre
      if (vehicule.estConducteur()) {
        vehicule.maj(dt, actif ? commandesDepuisEntrees({ avant: en.avant, droite: en.droite, saut: en.saut }) : { accel: 0, direction: 0, frein: false });
      } else {
        const v = vehiculesAffichees().get(info.vehicule);
        if (v) vehicule.suivre({ p: v.p, cap: v.cap, v: v.v });
      }
      const s = vehicule.positionSiege();
      const ve = vehicule.etat();
      if (s && ve) {
        moi.p = [s[0], s[1], s[2]];
        moi.v = [-Math.sin(ve.cap) * ve.v, 0, -Math.cos(ve.cap) * ve.v];
        moi.auSol = true;
      }
      const choc = vehicule.choc();
      if (choc > CHOC_SEUIL && t - dernierChocT > 0.3) { dernierChocT = t; sons.choc(borne(choc / 12, 0, 1)); }
    } else if (apparu) {
      const entreesUtiles: Entrees = actif ? en : { avant: 0, droite: 0, saut: false, sprint: false, accroupi: false, lacet };
      const mult = vitesseArme(arme) * (vise ? 0.8 : 1);
      moi = etape(moi, entreesUtiles, dt, monde, mult);
    }
    sautDemande = false;

    // --- tir (boucle bornée : les armes rapides tirent plus d'une fois par image) ---
    if (actif) {
      const auto = a === null ? true : a.auto;
      const veutTirer = auto ? tirMaintenu : !tirConsomme && tirPresse > t - 0.12;
      let n = 0;
      while (veutTirer && n < TIRS_PAR_IMAGE_MAX && tirer()) {
        n++;
        if (!auto) { tirConsomme = true; break; }
      }
    }
    // Le recul ne retombe qu'un instant après le dernier tir : pendant une rafale il s'accumule ; ensuite la vue
    // revient d'elle-même sur ce que le recul a soulevé (le fusil à pompe, qui tire toutes les 0,85 s, retrouve sa visée).
    const depuisTir = t - dernierTirT;
    if (reculAcc > 0 && vivant && depuisTir > delaiRecul(dernierTirArme)) {
      const rendu = retourRecul(reculAcc, dt);
      tangage = borne(tangage - rendu, -TANGAGE_MAX, TANGAGE_MAX);
      reculAcc -= rendu;
    }

    // --- sons de déplacement ---
    const vh = info ? 0 : vitesseH();
    if (apparu && vivant && !info && moi.auSol && vh > 1.5 && !moi.glisse) {
      distPas += vh * dt;
      if (distPas > FOULEE_M) { distPas = 0; sons.pas(); }
    } else distPas = 0;
    const surMur = apparu && vivant && !!moi.mur && !info;
    if (surMur !== murActif) { murActif = surMur; sons.mur(surMur); }
    const glisse = apparu && vivant && !!moi.glisse && !info;
    if (glisse !== glisseSon) { glisseSon = glisse; sons.glisse(glisse); }
    const ve = vehicule.etat();
    sons.moteur(info && ve && vivant && !enReplay ? Math.abs(ve.v) : null);

    // --- envoi de l'état ---
    accEtat += dt;
    const periodeEtat = info && !vehicule.estConducteur() ? 1 / JEU.etatPassagerHz : 1 / JEU.etatHz;
    if (accEtat >= periodeEtat) {
      accEtat = 0;
      envoyerEtat();
    }

    // --- caméra (avant les pseudos et le radar, qui s'évaluent depuis elle) ---
    const lunetteAct = vise && !!a && a.zoom !== null && !armes.rechargeEnCours();
    placerCamera(dt, vise, lunetteAct, vh);

    // --- télémétrie de la lunette : la distance de ce qui est sous le réticule (un rayon par image, seulement en lunette) ---
    if (lunetteAct && a) {
      const o = oeil();
      const imp = tracer(monde, o, directionVisee(lacet, tangage, kick), a.portee, cibles(), client.id ?? "");
      distanceVisee = imp.distance < a.portee - 0.01 ? Math.round(imp.distance) : -1;
    } else distanceVisee = -1;

    // --- joueurs distants, monde dynamique et effets ---
    majDistants(dt);
    majMondeDynamique(dt);
    majVoix();
    effets.maj(dt);

    porteArme.visible = apparu && (vivant || enReplay) && !(info && tireInterdit());
    armeMain.maj(dt, { vitesseH: vh, auSol: moi.auSol, vise: vise && !enReplay });

    remplirRadar(dt);
    post.rendre();

    // --- valeurs continues du HUD (60 Hz, hors React) ---
    live.recharge = armes.rechargeEnCours() ? Math.max(0.001, armes.rechargeProgression(ms())) : 0;
    live.vitesse = info && ve ? Math.abs(ve.v) : vh;
    live.vitesseKmh = info ? vehicule.vitesseKmh() : 0;
    live.regenDelai = !vivant || pv >= JEU.pvMax ? 1 : borne((t - dernierDegatT) / (JEU.regenDelaiMs / 1000), 0, 1);
    accHud += dt;
    if (accHud >= ECART_HUD_S) { accHud = 0; emettreHud(); }
  }
  raf = requestAnimationFrame(frame);

  client.envoyer({ t: "rejoindre", principale: equipSuivant.principale, secondaire: equipSuivant.secondaire });
  emettreHud(true);

  // ---------- poignée ----------
  return {
    equiper,
    recevoir,
    verrouiller: demanderVerrou,
    sensibilite(x) { sensibilite = borne(x, 0.2, 3); },
    accroupiBascule(b) {
      accroupiBascule = b;
      accroupiBascTenu = false;
    },
    passerKillcam() { if (kc.actif() && kc.phase() === "rejeu") kc.passer(); },
    voix: {
      activer: () => voix.activer(),
      desactiver() { voix.desactiver(); emettreHud(true); },
      mode(m) { voix.mode(m); },
    },
    live,
    radar() {
      // rempli à chaque image ; position et regard rafraîchis au cas où le HUD lit avant la prochaine image
      const pos = vehicule.positionSiege() ?? moi.p;
      radarFrame.x = pos[0];
      radarFrame.z = pos[2];
      radarFrame.lacet = lacet;
      return radarFrame;
    },
    touches(cfg: ConfigTouches) { config = cfg; index = indexTouches(cfg); toutRelacher(); },
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
      window.removeEventListener("wheel", surWheel);
      document.removeEventListener("pointerlockchange", surVerrou);
      document.removeEventListener("visibilitychange", surVisibilite);
      canvas.removeEventListener("mousedown", surMouseDown);
      canvas.removeEventListener("contextmenu", surContexte);
      canvas.removeEventListener("webglcontextlost", surContexteWebGLPerdu);
      if (!sorti) { sorti = true; client.envoyer({ t: "quitter" }); }
      if (verrouille()) document.exitPointerLock();
      sons.mur(false);
      sons.glisse(false);
      sons.moteur(null);
      sons.dispose();
      voix.dispose();
      terminerKillcam();
      visib.vider();
      suiviRadar.vider();
      for (const id of [...distants.keys()]) retirerAvatar(id);
      dyn.dispose();
      feux.dispose();
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
        const info = vehicule.actif();
        return {
          id: client.id, apparu, vivant, pv, bouclier, protege, arme: armes.armeEnMain(), slot: armes.slotActif(), slots: serialiserSlots(armes.lignes()),
          armeSuivante: equipSuivant.principale, equipSuivant: { ...equipSuivant }, munitions: armes.munitions(), recharge: armes.rechargeEnCours(),
          degainage: armes.degainage(ms()), accroupi: moi.accroupi, glisse: !!moi.glisse, regen: regenEnCours(),
          vehicule: info ? { ...info } : null, embarquement: embarquementFin > 0,
          killcam: kc.actif() ? { phase: kc.phase(), progression: kc.progression() } : null,
          p: [...moi.p], v: [...moi.v], auSol: moi.auSol, posture: postureDe(moi), mur: coteMurDe(moi),
          lacet, tangage, verrouille: verrouille(), entracte, fov: fovV, oeil: oeil(),
          distants: [...etats.entries()].filter(([id]) => id !== client.id).map(([id, e]) => ({
            id, p: e.p, vivant: e.vivant, protege: e.protege, arme: e.arme, accroupi: !!e.accroupi, glisse: !!e.glisse, vehicule: e.vehicule ?? null,
            pseudoAlpha: visib.alpha(id),
          })),
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
        kick = 0;
        return tirer(true);
      },
      touche(code, appuyee) {
        forceActif = true;
        if (appuyee) presser(code);
        else relacher(code);
      },
      slot(s) { changerSlot(s); },
      monter(id) {
        const v = mondeJeu.vehiculesA(client.maintenantServeur() - JEU.interpolationMs).get(id);
        if (!v || !peutAgir()) return;
        forceActif = true;
        // à 2,2 m à droite de la caisse, puis demande d'entrée
        moi = etatInitial([v.p[0] + Math.cos(v.cap) * 2.2, 0, v.p[2] - Math.sin(v.cap) * 2.2]);
        client.envoyer({ t: "monter", vehicule: id });
        attendreReponseVehicule();
      },
      killcam() {
        if (!kc.actif()) return null;
        return {
          phase: kc.phase(), progression: kc.progression(), tueur: kc.tueurId(), info: kc.info(), tempsServeur: kc.tempsServeur(),
          camera: kc.camera(), rejeu: enReplay,
        };
      },
      voix() {
        return { ...voix.diagnostic(), parlants: voix.parlants() };
      },
      monde() {
        const ts = client.maintenantServeur();
        return {
          pnj: mondeJeu.etatsPnj(ts).map((e) => ({ p: e.p, cap: e.cap, v: e.v })),
          vehicules: [...vehiculesAffichees().values()],
          sieges: [...vehiculesAffichees().keys()].map((id) => ({ id, sieges: [...mondeJeu.siegesDe(id)] })),
          elsa: mondeJeu.elsa(),
          invite: mondeJeu.invite(moi.p, assisSiege(), ts),
          radar: { joueurs: radarFrame.nJoueurs, pnj: radarFrame.nPnj, voitures: radarFrame.nVoitures, echos: radarFrame.nEchos },
        };
      },
    },
  };
}
