/**
 * Boucle de jeu de l'arène FPS : vue à la première personne sur le canvas de la vue Palantir.
 * Assemble les modules purs (mouvement prédit, armes, équipement, tir, couteau, véhicules, killcam, monde dynamique, visibilité,
 * interpolation) et le rendu three.js (décor de lib/agroparc3d/decor.ts, avatars, arme en main, effets, monde dynamique, bloom) + les sons.
 * `jeu.ts` ORCHESTRE : la logique vit dans les modules purs testés (`jeu-equipement`, `jeu-killcam`, `jeu-monde`, `jeu-tigres`,
 * `jeu-vehicule`, `jeu-visee`, `jeu-radar`, `visibilite`, `melee`, `tir`…). Les tigres et l'avion (v3) sont dessinés par `rendu-tigres.ts`.
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
 * Mode zombies (v5, `opts.mode`) : même boucle, autres règles : monde de la carte « Cour des Restos », tigres interpolés (`jeu-zombies.ts`) et
 * dessinés (`rendu-zombies.ts`), tirs et coups d'épée sur les tigres (`z<n>`), achats et relèves à la touche E, joueurs ni cibles ni obstacles,
 * ni voitures ni Elsa ni killcam ; le joueur à terre garde la caméra au sol.
 *
 * Les types du contrat avec l'hôte (HudEtat, JeuEvenement, JeuCallbacks, JeuHandle…) sont dans `jeu-types.ts` et réexportés ici.
 * Spec : docs/superpowers/specs/2026-10-22-agroparc-fps-design.md, 2026-10-22-arene-v2-design.md (§6.2, §13),
 * 2026-10-23-arene-hud-design.md (§3), 2026-10-23-arene-tigres-design.md (Rendu, Sort d'invocation, Réseau)
 */
import * as THREE from "three";
import type { SceneData } from "../agroparc3d/types";
import { C, construireDecor, creerEtatDestruction } from "../agroparc3d/decor";
import { construireMonde, detruireBatiment, normaleImpact, poserBreche, releverBatiment, type Creux, type Monde } from "./collision";
import { FOCUS_ZOMBIES, PLAFOND_INTERIEUR_M, construireMondeZombies, donneesZombies } from "./zombies-carte";
import { plafondBatimentsCreux } from "./grenades";
import { creerControleurGrenades, type LancerDemande } from "./jeu-grenades";
import { creerRenduGrenades } from "./rendu-grenades";
import { CorpsTigres } from "./corps-tigres";
import { ZOMBIES, echelleZombie, type TypeZombie } from "./zombies-vagues";
import {
  MondeZombies, Rugissements, decisionMaintien, inviteZombies, segmentsPortesFermees, sonGriffe, toucheTruckClient, trouverZombieTouche, trouverZombiesMelee, trouverZombiesTouches,
  INVITE_VIDE, type InviteZombies,
} from "./jeu-zombies";
import { sonExplosion, voixDuBonus, type IdVoix } from "./sons-echantillons";
import { creerRenduZombies, type MortZombie } from "./rendu-zombies";
import { collisionsDuMonde, impulsionMort } from "./ragdoll-tigre";
import { creerRenduInterieurs } from "./rendu-interieurs";
import { creerRenduObjetsZombies } from "./rendu-objets-zombies";
import { creerModeleTruckMuche } from "./rendu-monde";
import { objectifZombies } from "./zombies-lore";
import { ACHATS, NOTES, achatDeId, fenetreDeId, fenetrePlusProche } from "./zombies-carte";
import { NOMS_BONUS } from "./zombies-vagues";
import { profilZombie, nomZombie } from "./armes";
import { creerImpactsBalles } from "./rendu-impacts";
import { creerDebris } from "./rendu-debris";
import { creerTracesPneus, glissementLateral, rouesArriere } from "./rendu-traces";
import { construireCircuits, flotte } from "./circulation";
import { coteMurDe, etape, etatInitial, hauteurOeil, postureDe, type Entrees, type EtatMouvement } from "./mouvement";
import { MELEE, STATS, degatsPlomb, delaiRecul, devier, directionsTir, dispersionTir, niveauZoomDefaut, niveauxZoom, retourRecul, vitesseArme } from "./armes";
import { tracer, type Cible } from "./tir";
import { trouverCiblesMelee } from "./melee";
import {
  CIBLE_TIGRE, CIBLE_TITAN, JEU, OEIL_SIEGE, OEIL_TITAN, SILHOUETTE, estIdZombie, estMelee, oeilDe,
  type ArmeFeuId, type ArmeId, type ArmeMeleeId, type EtatJoueurSnap, type EtatPartieZombies, type JoueurPublic, type MessageServeur, type RaisonAchat, type Siege, type Slot, type Vec3, type VehiculeSnap, type Zone,
} from "./protocole";
import type { EquipementJeu, EtatZombiesHud, HudEtat, HudLive, JeuCallbacks, JeuHandle, JeuOptions } from "./jeu-types";
import { ajouterEcho, ajouterPorte, creerRadarFrame, definirElsa, ajouterVoiture, ajouterVoiturePnj, purgerEchos, viderRadarFrame, type RadarFrame } from "./radar";
import { SuiviRadar, type JoueurRadarEntree } from "./jeu-radar";
import { Interpolateur, gardePosition, type ClientArene } from "./reseau";
import { codeSouris, indexTouches, lireTouches, stockageNavigateur, type Action, type ConfigTouches } from "./touches";
import {
  creerArmeEnMain, creerAvatar, creerEffets, creerPostTraitement, type ArmeEnMain, type AvatarJoueur,
} from "./rendu";
import { creerMondeDynamique, type MondeDynamique } from "./rendu-monde";
import { creerRenduTigres } from "./rendu-tigres";
import { MondeTigres, coupDeMonTigre, tracerTigres, trouverTigreCouteau, type TigreClient } from "./jeu-tigres";
import { hitboxTigre } from "./tigre-arene";
import { creerFeux, type SourceFeu } from "./rendu-feux";
import { creerChatVocal } from "./voix-rtc";
import { creerSons, type PositionSon } from "./sons";
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
import { ControleurTitan, MondeMonstres } from "./jeu-monstres";
import { ECHELLE_TIGRE, TITAN, toucheTigre } from "./monstres";
import { creerRenduMonstres } from "./rendu-monstres";

// ---------------------------------------------------------------------------------------------
// Contrat avec l'hôte
// ---------------------------------------------------------------------------------------------

export type { EquipementJeu, EtatMonstresHud, EtatZombiesHud, HudEtat, HudLive, JeuCallbacks, JeuEvenement, JeuHandle, JeuOptions } from "./jeu-types";

// ---------------------------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------------------------

export const CLE_SENSIBILITE = "pdj-fps-sensibilite";
/** Radians par pixel de souris à sensibilité 1, pour un champ de 90°. */
const SENS_RAD_PX = 0.0022;
const FOV_H = 90;
const FOV_H_VISEE = 78;
const PORTEE_EFFETS_M = 400;
/** (zombies) seuls les corps des tigres à moins de cette distance (m) sont des obstacles du mouvement (un pas de 0,25 s au plus vite) */
const PORTEE_CORPS_TIGRES_M = 8;
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
/** (v4) Foulée (m) d'un pas lourd du tigre robot et du titan, et distance (m) à laquelle une explosion de monstre secoue la caméra. */
const FOULEE_LOURDE_M = 4.5;
const SECOUSSE_MONSTRE_M = 40;
/** (v3) Durée (s) de l'effondrement d'un bâtiment et intervalle (s) entre deux coups de klaxon du Truck Muche fou. */
const DUREE_EFFONDREMENT_S = 1.1;
/** Durée (s) de l'ouverture animée d'une brèche. */
const DUREE_BRECHE_S = 0.5;
/** Aucune source de feu permanente en zombies (pas de voitures) : seules les explosions passent par `feux`. */
const SANS_FEUX: readonly SourceFeu[] = [];
const KLAXON_TRUCK_S = { min: 2.2, max: 3.6 } as const;

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

/** Monde dynamique du mode zombies : aucune voiture, aucun Truck, aucune Elsa. */
function mondeDynamiqueVide(): MondeDynamique {
  return {
    majVoituresPnj() {}, majEpaves() {}, majVoituresJoueurs() {}, majElsa() {},
    elsaTete: () => [0, -1000, 0], afficherPseudoElsa() {}, dispose() {},
  };
}

/** Équipement de départ de la salle zombies (celui du serveur, `EQUIPEMENT_DEPART_ZOMBIES`) : pistolet et couteau, pas d'arme principale. */
const DEPART_ZOMBIES = { principale: "mitraillette", secondaire: "pistolet", speciale: null, sansPrincipale: true } as const;

/**
 * `equip` : l'équipement choisi (lobby, écran de mort, pause) ; on entre avec l'arme principale en main.
 * `opts.mode` : "arene" (défaut, comportement historique) ou "zombies" (v5) : monde de la carte « Cour des Restos » (mêmes données que le
 * serveur), tigres zombies interpolés et dessinés, aucun truck / voiture / PNJ / Elsa / circulation, pas de killcam ni de réentrée, joueurs
 * ni cibles ni obstacles pour les tirs et la mêlée (pas de tir allié), achats et relèves à la touche E.
 */
export function lancerJeu(canvas: HTMLCanvasElement, sceneBrute: SceneData, client: ClientArene, equip: EquipementJeu, cb: JeuCallbacks, opts: JeuOptions = {}): JeuHandle {
  const modeZ = opts.mode === "zombies";
  /** données de la scène du jeu : la scène brute, ou en zombies la copie aux pièces synthétiques (même fonction que le serveur) */
  const donneesZ = modeZ ? donneesZombies(sceneBrute) : null;
  const data: SceneData = donneesZ ? donneesZ.data : sceneBrute;
  let equipSuivant: EquipementJeu = equip.melee === "epee"
    ? { principale: equip.principale, secondaire: equip.secondaire, melee: "epee" }
    : { principale: equip.principale, secondaire: equip.secondaire };
  const monde: Monde = modeZ ? construireMondeZombies(sceneBrute) : construireMonde(data);
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
  // bâtiments effondrables (v3) : le tigre robot et le titan les écrasent ; l'effondrement est animé par le nuanceur
  const destruction = creerEtatDestruction(data.buildings.length);
  construireDecor(decor, data, { fantomes: false, destruction });
  /** effondrements en cours : id → instant (s, horloge locale) du début */
  const effondrements = new Map<number, number>();
  /** brèches qui s'ouvrent : id → instant du début et cercles de départ et d'arrivée (le rayon grandit en `DUREE_BRECHE_S`) */
  const ouvertures = new Map<number, { t0: number; de: Creux; vers: Creux }>();
  let sonBrecheT = -Infinity;
  const debris = creerDebris(scene, C.cyan);
  /** demi-diagonale de la boîte d'une emprise (m) */
  const emprise = (r: readonly (readonly [number, number])[]) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    return Math.hypot(x1 - x0, z1 - z0) / 2;
  };
  const impactsBalles = creerImpactsBalles(scene);
  // traces de pneus des voitures et du Truck fou qui dérapent (v3)
  const tracesPneus = creerTracesPneus(scene);
  const precedentsTraces = new Map<string, { x: number; z: number }>();
  /** Une image d'un véhicule : glisse s'il est imposé (`force`), sinon si sa vitesse latérale mesurée dépasse 3 m/s à plus de 6 m/s. */
  function suivreTraces(cle: string, p: Vec3, cap: number, v: number, dt: number, demiVoie: number, recul: number, force?: boolean) {
    const av = precedentsTraces.get(cle);
    precedentsTraces.set(cle, { x: p[0], z: p[2] });
    let glisse = force ?? false;
    if (force === undefined && av && dt > 0) glisse = Math.abs(v) > 6 && glissementLateral(cap, p[0] - av.x, p[2] - av.z, dt) > 3;
    tracesPneus.roues(cle, rouesArriere(p, cap, demiVoie, recul), glisse && p[1] < 0.6);
  }
  const effets = creerEffets(scene);
  const post = creerPostTraitement(renderer, scene, camera);
  const sons = creerSons();
  // (zombies) effets échantillonnés et annonces : téléchargés dès l'entrée, décodés au premier geste (pas d'attente au premier chef)
  if (modeZ) sons.prechargerZombies();
  const interp = new Interpolateur();
  /** chat vocal de proximité (v3 §5) : activé par l'hôte (menu pause), volumes réglés à chaque image d'après les positions */
  const voix = creerChatVocal((m) => client.envoyer(m));

  // ---------- monde dynamique (voitures PNJ et conduisibles, Elsa) ----------
  const nbPnj = flotte(construireCircuits()).length;
  const mondeJeu = new MondeJeu(data, monde);
  // zombies : ni Truck, ni voitures, ni PNJ, ni Elsa (le monde dynamique est une coquille vide qui ne dessine rien)
  const dyn: MondeDynamique = modeZ ? mondeDynamiqueVide() : creerMondeDynamique(scene, { nbPnj, nbVehicules: EMPLACEMENTS_VOITURES.length, truck: placeTruck(data) });
  /** fumées, flammes et explosions des voitures (v3 §4) */
  const feux = creerFeux(scene);
  const visib = new VisibilitePseudos(monde);
  const suiviRadar = new SuiviRadar(monde);
  const kc = new ControleurKillcam();
  const vehicule = new ControleurVehicule(monde);
  // ---------- événements (v3) : Truck Muche fou, tigre robot, titan tigre ----------
  const jm = new MondeMonstres();
  const rm = creerRenduMonstres(scene);
  // ---------- mode zombies (v5) : tigres interpolés et dessinés, rugissements, état de la partie ----------
  const mz = new MondeZombies();
  /** (zombies) corps des tigres proches, obstacles du mouvement */
  const corpsTigres = new CorpsTigres();
  // (v8) les cadavres sont des ragdolls : ils tombent sur le sol et les tables, et rebondissent sur les murs du monde des zombies (portes ouvertes comprises)
  const rz = modeZ ? creerRenduZombies(scene, collisionsDuMonde(monde)) : null;
  // (v7) intérieurs des bâtiments creusés, objets de la carte (craie, distributeurs, boîte, planches, bonus…), Truck Muche des livraisons
  const rInterieurs = donneesZ ? creerRenduInterieurs(scene, data, donneesZ.pieces) : null;
  const rObjets = modeZ ? creerRenduObjetsZombies(scene) : null;
  const truckZ = modeZ ? creerModeleTruckMuche() : null;
  if (truckZ) { truckZ.group.visible = false; scene.add(truckZ.group); }
  // (v8) grenades : la main du joueur (cuisson), les grenades prédites et diffusées (trajectoires du serveur), leur rendu
  const grenades = modeZ ? creerControleurGrenades(monde, plafondBatimentsCreux(monde, PLAFOND_INTERIEUR_M)) : null;
  const rGrenades = modeZ ? creerRenduGrenades(scene) : null;
  /** dernier instant serveur dont les rebonds ont été joués ; dernier claquement de cymbales (s, horloge locale) */
  let rebondsVusT = 0;
  let cymbalesT = 0;
  const rugissements = new Rugissements();
  let imageNum = 0;
  const titan = new ControleurTitan();
  /** monstres interpolés de l'image (cibles des tirs, rendu) */
  let monstresImage: ReturnType<MondeMonstres["a"]> = {};
  let distTigre = 0;
  /** s avant le prochain coup de klaxon du Truck Muche fou */
  let klaxonDans = 0.6;
  let distTitan = 0;

  // ---------- tigres et avion (v3) ----------
  const mondeTigres = new MondeTigres();
  const renduTigres = creerRenduTigres(scene);
  /** tigres interpolés à l'instant du rendu : cibles des tirs et des coups de couteau, sons */
  let tigresVus = new Map<string, TigreClient>();
  /** tigres de la dernière image dessinée (crochet de test : mesures du GLB comparées à la hitbox du même instant) */
  let tigresDessines = tigresVus;
  /** orange des giclées sur un tigre */
  const COULEUR_TIGRE = "#ff9a3c";

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
  const armes = modeZ
    ? new ControleurArmes({ ...DEPART_ZOMBIES }, "secondaire", {
      reserveChargeurs: ZOMBIES.ravitaillementChargeurs, reserveChargeursAmeliore: ZOMBIES.ravitaillementChargeursAmeliore, zombies: true,
    })
    : new ControleurArmes({ principale: equip.principale, secondaire: equip.secondaire, speciale: null }, "principale");
  /** cadence locale par arme (le serveur garde la sienne) */
  const prochains = new Map<ArmeId, number>();
  let delaiApparitionT = 0;
  /** instant du dernier tir et son arme (le recul ne retombe qu'un moment après) */
  let dernierTirT = -Infinity;
  let dernierTirArme: ArmeFeuId = modeZ ? "pistolet" : equip.principale;
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
  // ---- état du mode zombies ----
  let argentZ = 0;
  let mancheVue = 0;
  let partieZ: EtatPartieZombies | null = null;
  let aTerreZ = false;
  let elimineZ = false;
  let terreFinTZ = 0;
  let gainZ: EtatZombiesHud["gain"] = null;
  let nGainZ = 0;
  let sonPieceT = -Infinity;
  let refusZ: EtatZombiesHud["refus"] = null;
  let nRefusZ = 0;
  let achatsZ = 0;
  /** E maintenu sur un coéquipier à terre : id du coéquipier et instant (horloge locale, s) du début */
  let reanimCible: string | null = null;
  let reanimDebutT = 0;
  /** (v7) note de lore ouverte (id) ; annonce du HUD ; arme déjà gratinée une fois (objectif) ; fenêtre dont je repose les planches */
  let noteZ: number | null = null;
  let annonceZ: { n: number; texte: string; genre: string } | null = null;
  let nAnnonceZ = 0;
  let papUtilise = false;
  let reparFenetre: string | null = null;
  /** Annonce du HUD, et dite par l'annonceur si `voix` est donnée (au plus tôt `auPlusTotS` s plus tard, après une fanfare par exemple). */
  const annoncer = (texte: string, genre = "info", voix?: IdVoix, auPlusTotS = 0) => {
    annonceZ = { n: ++nAnnonceZ, texte, genre };
    if (voix) sons.voix(voix, auPlusTotS);
  };
  /** Souffle d'un tir explosif en zombies : vraie explosion de grenade, ou pouf synthétisé pour les petits rayons (pistolet à rayons). */
  const sonSouffle = (rayon: number, p: Vec3) => {
    const s = sonExplosion(rayon);
    if (s.genre === "grenade") sons.explosionGrenade(positionSon(p), s.force);
    else sons.explosionMonstre(s.force, positionSon(p));
  };
  const mesAtouts = (): readonly string[] => partieZ?.joueurs.find((x) => x.id === client.id)?.atouts ?? [];
  /** PV max (le Gratin Dauphinois en zombies) et délai de régénération de la salle */
  const pvMaxMoi = (): number => (modeZ && mesAtouts().includes("gratin") ? ZOMBIES.pvMaxGratin : JEU.pvMax);
  const regenDelaiS = (): number => (modeZ ? ZOMBIES.regenDelaiMs : JEU.regenDelaiMs) / 1000;
  /** portes encore fermées (segments), recalculées à chaque état de partie reçu */
  let portesFermees: { id: string; p: [number, number]; q: [number, number] }[] = [];
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
  /** (v3) Maj pressée : dash du titan */
  let dashDemande = false;
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
  /** (v3) je pilote le titan tigre */
  const pilote = () => titan.actif();
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
    return estMelee(a) ? null : a;
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
    armeMain.recharger(STATS[a].rechargeS * (modeZ && mesAtouts().includes("expresso") ? 0.5 : 1));
    sons.recharge(a);
  }

  function cibles(): Cible[] {
    const r: Cible[] = [];
    // zombies : pas de tir allié, les joueurs ne sont ni cibles ni obstacles pour les balles et la mêlée
    if (modeZ) return r;
    for (const [id, e] of etats) {
      if (id === client.id || e.titan) continue;
      r.push({ id, p: e.p, vivant: e.vivant, accroupi: !!e.accroupi || !!e.vehicule });
    }
    return r;
  }

  /**
   * (v3) Rayon de tir pour les EFFETS : `tracer` (joueurs, murs, toits) complété par le sol (y = 0), que `tracer` ne connaît pas : la
   * balle qui part vers le bas s'arrête au sol, avec son étincelle et sa trace. Les touches déclarées au serveur ne changent pas.
   */
  function tracerEffets(o: Vec3, d: Vec3, portee: number, liste: ReturnType<typeof cibles>, ignore: string) {
    const imp = tracer(monde, o, d, portee, liste, ignore);
    if (imp.cible || d[1] >= -1e-4 || o[1] <= 0) return imp;
    const tSol = -o[1] / d[1];
    if (tSol >= imp.distance) return imp;
    return { cible: null, zone: null, distance: tSol, point: [o[0] + d[0] * tSol, 0, o[2] + d[2] * tSol] as Vec3 };
  }

  const _bouche = new THREE.Vector3();

  /**
   * Cibles d'un coup d'arme blanche : les joueurs (positions interpolées, aucun en zombies), le tigre largué le plus proche à portée (arène) et,
   * en zombies, les tigres (`z<n>`, formes de touche du serveur), le tout trié par distance et coupé à `nbCiblesMax`.
   */
  function ciblesDuCoup(o: Vec3, d: Vec3, arme: ArmeMeleeId): { cible: string; distance: number }[] {
    const joueurs = trouverCiblesMelee(monde, o, d, cibles(), client.id ?? "", arme);
    if (modeZ) {
      const tigres = trouverZombiesMelee(o, d, mz.zombies(), arme, monde, mz.nombre());
      return [...joueurs, ...tigres].sort((a, b) => a.distance - b.distance).slice(0, MELEE[arme].nbCiblesMax);
    }
    const largue = trouverTigreCouteau(monde, o, d, mondeTigres.cibles(tigresVus, client.id), arme);
    if (!largue) return joueurs;
    return [...joueurs, { cible: largue.id, distance: largue.distance }].sort((a, b) => a.distance - b.distance).slice(0, MELEE[arme].nbCiblesMax);
  }

  /**
   * Coup d'arme blanche (couteau ou épée) : `coup` au serveur (jamais `tir`), cadence propre de l'arme (le tir maintenu les enchaîne), pas
   * de recul ni de traçante. Les cibles sont celles de l'arc de l'arme (portée, cône, ligne de vue) : jusqu'à `nbCiblesMax` pour l'épée.
   */
  function coupMelee(arme: ArmeMeleeId): boolean {
    if (t < prochainDe("couteau")) return false;
    const o = oeil();
    const d = directionVisee(lacet, tangage, kick);
    const res = ciblesDuCoup(o, d, arme);
    client.envoyer({ t: "coup", o, d, cibles: res.map((r) => r.cible) });
    prochains.set("couteau", t + MELEE[arme].cadenceS);
    armeMain.coup();
    sons.coup(false, undefined, arme);
    return true;
  }

  /**
   * Un tir (aucune dispersion, v2 §13.1 : gerbe fixe pour le pompe), pile dans l'axe de la vue (§13.2.4). `_force` : outil de test (ignore la
   * souris). Renvoie vrai si le tir est parti. Le retour de touche (son, marqueur, giclée) attend le `degats` du serveur (§13.2.1).
   */
  /** (v3) Monstre touché par le rayon avant `limite` : le tigre, ou le titan d'un autre pilote. */
  function toucheMonstre(o: Vec3, d: Vec3, limite: number): { cible: string; zone: Zone; distance: number } | null {
    let r: { cible: string; zone: Zone; distance: number } | null = null;
    const tg = monstresImage.tigre;
    if (tg) {
      const h = toucheTigre(o, d, limite, tg.p, tg.cap, ECHELLE_TIGRE, monde);
      if (h) r = { cible: CIBLE_TIGRE, ...h };
    }
    const ti = monstresImage.titan;
    if (ti && ti.pilote !== client.id) {
      const h = toucheTigre(o, d, r ? r.distance : limite, ti.p, ti.cap, TITAN.echelle, monde);
      if (h) r = { cible: CIBLE_TITAN, ...h };
    }
    return r;
  }

  /** (zombies) Tigre touché par le rayon avant `limite` (premier mur) : même forme que `toucheMonstre`, pour N tigres. */
  function toucheZombies(o: Vec3, d: Vec3, limite: number): { cible: string; zone: Zone; distance: number } | null {
    return modeZ ? trouverZombieTouche(o, d, limite, mz.zombies(), monde, mz.nombre()) : null;
  }

  /** (v3) Canon du titan : rayon unique, cadence propre, déclaré au serveur (`canon`), qui le revalide. */
  function tirerCanon(): boolean {
    if (t < prochainDe("couteau") || !peutAgir() || entracte) return false;
    // vue à la 1ʳᵉ personne depuis le cockpit : le canon tire dans l'axe du réticule
    const o = oeil();
    const d = directionVisee(lacet, tangage, 0);
    const imp = tracerEffets(o, d, TITAN.canon.portee, cibles(), client.id ?? "");
    const touches: { cible: string; zone: Zone }[] = imp.cible && imp.zone ? [{ cible: imp.cible, zone: imp.zone }] : [];
    client.envoyer({ t: "canon", o, d, touches });
    effets.traçante([o[0] + d[0] * 2, o[1] - 0.9, o[2] + d[2] * 2], imp.point, "minigun");
    if (!imp.cible && imp.distance < TITAN.canon.portee - 0.01) {
      effets.impact(imp.point, [-d[0], -d[1], -d[2]], couleurMoi());
      impactsBalles.ajouter(imp.point, normaleImpact(monde, imp.point, o));
    }
    prochains.set("couteau", t + TITAN.canon.cadenceS);
    sons.canon();
    kick += 0.012;
    return true;
  }

  function tirer(_force = false): boolean {
    if (pilote()) return tirerCanon();
    if (!peutAgir() || entracte || enKillcam() || tireInterdit()) return false;
    if (armes.degainage(ms())) return false;
    const arme = armes.armeEnMain();
    if (estMelee(arme)) return coupMelee(arme);
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
    const listeTigres = mondeTigres.cibles(tigresVus, client.id);
    const tsVoitures = client.maintenantServeur();
    const vehiculesVus = [...vehiculesAffichees().values()];
    const maVoiture = vehicule.actif()?.vehicule ?? null;

    armeMain.positionBouche(_bouche);
    const depart: Vec3 = lunette
      ? [o[0] + regard[0] * 0.8, o[1] + regard[1] * 0.8 - 0.08, o[2] + regard[2] * 0.8]
      : [_bouche.x, _bouche.y, _bouche.z];
    let impactsAffiches = 0;
    // (v7, zombies) arme améliorée qui perce ; distance du premier impact du plomb central (souffle d'une arme explosive)
    const amelioreeZ = modeZ && (armes.equipement().ameliorees?.includes(arme) ?? false);
    const profilZ = modeZ ? profilZombie(arme, amelioreeZ) : null;
    const perceZ = profilZ?.perce === true;
    let impactExplosif: number | null = null;
    dirs.forEach((d, i) => {
      const imp = tracerEffets(o, d, Math.min(a.portee, PORTEE_EFFETS_M), liste, client.id ?? "");
      // un tigre largué devant le joueur, le mur ou la portée prend la balle (mes tigres alliés ne sont pas des cibles)
      const tg = tracerTigres(o, d, imp.distance, listeTigres);
      const limite = tg ? tg.distance : imp.distance;
      // (v7, zombies) une balle qui perce compte pour tous les tigres alignés avant le mur ; le Truck Muche arrête la balle s'il est devant
      if (modeZ && perceZ) {
        const tous = trouverZombiesTouches(o, d, limite, mz.zombies(), monde, mz.nombre());
        if (tous.length) {
          const fin: Vec3 = [o[0] + d[0] * limite, o[1] + d[1] * limite, o[2] + d[2] * limite];
          effets.traçante(depart, fin, arme);
          for (const h of tous) touchesDecl.push({ cible: h.cible, zone: h.zone, plomb: i });
          impactExplosif = impactExplosif ?? tous[0].distance;
          return;
        }
      }
      const truckTouche = modeZ ? toucheTruckClient(o, d, limite, mz.truck()) : null;
      // (v3) le tigre robot ou un titan devant le premier joueur, tigre largué ou mur touché ; (zombies) un tigre devant le premier mur
      const monstre = toucheMonstre(o, d, truckTouche ? truckTouche.distance : limite) ?? toucheZombies(o, d, truckTouche ? truckTouche.distance : limite)
        ?? (truckTouche ? { ...truckTouche, zone: "corps" as Zone } : null);
      if (monstre) {
        const fin: Vec3 = [o[0] + d[0] * monstre.distance, o[1] + d[1] * monstre.distance, o[2] + d[2] * monstre.distance];
        effets.traçante(depart, fin, arme);
        touchesDecl.push({ cible: monstre.cible, zone: monstre.zone, plomb: i });
        if (impactsAffiches < 5) { impactsAffiches++; effets.impact(fin, [-d[0], -d[1], -d[2]], estIdZombie(monstre.cible) ? "#ff8a1c" : "#ffb347"); }
        if (i === 0) impactExplosif = monstre.distance;
        return;
      }
      // une voiture plus proche que le joueur (ou le mur) visé arrête la balle (v3 §4) ; l'occupant d'une voiture reste touchable à travers elle
      const v = mondeJeu.impactVoiture(o, d, limite, tsVoitures, vehiculesVus, maVoiture);
      const occupantDe = (vid: number) => !tg && !!imp.cible && etats.get(imp.cible)?.vehicule?.id === vid;
      if (v && !(v.genre === "vehicule" && occupantDe(v.id))) {
        const fin: Vec3 = [o[0] + d[0] * v.distance, o[1] + d[1] * v.distance, o[2] + d[2] * v.distance];
        effets.traçante(depart, fin, arme);
        voituresDecl.push({ genre: v.genre, id: v.id, plomb: i });
        if (impactsAffiches < 5) { impactsAffiches++; effets.impact(fin, [-d[0], -d[1], -d[2]], "#ffd9a0"); }
        return;
      }
      if (tg) {
        effets.traçante(depart, [o[0] + d[0] * tg.distance, o[1] + d[1] * tg.distance, o[2] + d[2] * tg.distance], arme);
        touchesDecl.push({ cible: tg.id, zone: tg.zone, plomb: i });
        const dg = degatsPlomb(arme, tg.zone, tg.distance);
        const c = cumul.get(tg.id);
        if (c) { c.degats += dg; if (tg.zone === "tete") c.zone = "tete"; }
        else cumul.set(tg.id, { degats: dg, zone: tg.zone });
        return;
      }
      const fin = imp.point;
      effets.traçante(depart, fin, arme);
      if (i === 0 && impactExplosif === null && imp.distance < a.portee - 0.01) impactExplosif = imp.distance;
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
        // trace durable (20 s) seulement sur un mur ou un toit (pas en l'air au bout de la portée)
        if (imp.distance < Math.min(a.portee, PORTEE_EFFETS_M) - 0.01) impactsBalles.ajouter(fin, normaleImpact(monde, fin, o));
      }
    });

    client.envoyer({ t: "tir", arme, o, d: dirs, touches: touchesDecl, ...(voituresDecl.length ? { voitures: voituresDecl } : {}) });
    if (voituresDecl.length) sons.tole();
    // (v7) souffle d'une arme explosive (pistolet gratiné, pistolet à rayons) : boule de feu verte ou ambre au premier impact
    if (profilZ?.explosion && impactExplosif !== null) {
      const d0 = dirs[0];
      const c: Vec3 = [o[0] + d0[0] * impactExplosif, Math.max(0.2, o[1] + d0[1] * impactExplosif), o[2] + d0[2] * impactExplosif];
      feux.explosion(c);
      sonSouffle(profilZ.explosion.rayon, c);
    }

    // estimation locale (le HUD l'ignore : seul `confirme`, reçu du serveur, compte, HUD §3.4) ; ni son ni marqueur ici
    for (const [id, c] of cumul) cb.evenement({ type: "touche", cible: id, zone: c.zone, degats: c.degats });

    // cadence (rattrape le retard d'une image, borné : onglet gelé = on repart de maintenant)
    const prevu = prochainDe(arme);
    // (v7, zombies) le Double Ristretto tire 1,33 fois plus vite
    const cadenceS = a.cadenceS * (modeZ && mesAtouts().includes("ristretto") ? 1 / 1.33 : 1);
    prochains.set(arme, t - prevu < RATTRAPAGE_CADENCE_S ? prevu + cadenceS : t + cadenceS);
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
    viseMaintenu = viseMaintenu && !estMelee(armes.armeEnMain());
  }
  const peutChangerArme = () => peutAgir() && !enKillcam() && !pilote();
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
    client.envoyer({ t: "rejoindre", ...choixEquipement() });
  }

  /** Équipement de la prochaine apparition (immédiat si mort). `melee` omis = l'arme blanche déjà choisie. */
  function equiper(principale: EquipementJeu["principale"], secondaire: EquipementJeu["secondaire"], melee: ArmeMeleeId | undefined = equipSuivant.melee) {
    equipSuivant = melee === "epee" ? { principale, secondaire, melee } : { principale, secondaire };
    client.envoyer({ t: "equiper", ...choixEquipement() });
  }

  /** Champs d'équipement de `rejoindre` / `equiper` (l'arme blanche n'est envoyée que pour l'épée : absent = couteau). */
  function choixEquipement(): { principale: EquipementJeu["principale"]; secondaire: EquipementJeu["secondaire"]; melee?: ArmeMeleeId } {
    const { principale, secondaire, melee } = equipSuivant;
    return melee === "epee" ? { principale, secondaire, melee } : { principale, secondaire };
  }

  // ---------- véhicules ----------
  function attendreReponseVehicule() {
    embarquementFin = t + EMBARQUEMENT_MAX_S;
  }

  // ---------- zombies : achats et relève (E) ----------
  /** Invite courante (zombies) : relève d'un coéquipier à terre à ≤ 2,5 m, sinon l'achat le plus proche. Vide hors zombies / à terre. */
  function inviteZ(): InviteZombies {
    if (!modeZ || !peutAgir()) return INVITE_VIDE;
    const aTerre: { id: string; pseudo: string; p: Vec3 }[] = [];
    for (const j of partieZ?.joueurs ?? []) {
      if (j.etat !== "terre" || j.id === client.id) continue;
      const e = etats.get(j.id);
      if (e) aTerre.push({ id: j.id, pseudo: j.pseudo, p: e.p });
    }
    return inviteZombies({
      pos: [moi.p[0], moi.p[2]], argent: argentZ, portesOuvertes: (partieZ?.portes ?? []).filter((x) => x.ouverte).map((x) => x.id),
      equip: armes.equipement(), enMain: armes.armeEnMain(), pv, aTerre, partie: partieZ, atouts: mesAtouts() as never, moi: client.id ?? "",
      solo: (partieZ?.joueurs.filter((x) => x.admis).length ?? 1) <= 1, maintenant: client.maintenantServeur(),
    });
  }

  /** Arrête la relève en cours (touche relâchée, coéquipier relevé ou trop loin, je tombe) : le serveur est prévenu. Arrête aussi la repose de planches. */
  function arreterReanimation() {
    if (reparFenetre !== null) { reparFenetre = null; client.envoyer({ t: "reparer", fenetre: null }); }
    if (reanimCible === null) return;
    reanimCible = null;
    client.envoyer({ t: "reanimer", cible: null });
  }

  /**
   * Début d'un maintien de E : relève d'un coéquipier à terre, ou repose des planches (le serveur en repose une toutes les 0,9 s tant qu'on
   * reste devant la fenêtre). Envoyé une seule fois par maintien ; rend faux si l'invite n'est ni l'une ni l'autre.
   */
  function demarrerMaintien(inv: InviteZombies): boolean {
    if (inv.invite === "reanimer" && inv.cible) {
      if (reanimCible === inv.cible) return true;
      reanimCible = inv.cible;
      reanimDebutT = t;
      client.envoyer({ t: "reanimer", cible: inv.cible });
      return true;
    }
    if (inv.invite === "reparer" && inv.id) {
      if (reparFenetre === inv.id) return true;
      reparFenetre = inv.id;
      client.envoyer({ t: "reparer", fenetre: inv.id });
      return true;
    }
    return false;
  }

  /** E en zombies : relève (à maintenir) d'un coéquipier à terre, sinon achat de l'invite courante (le serveur reste juge). */
  function interagirZombies() {
    if (!peutAgir()) return;
    const inv = inviteZ();
    if (demarrerMaintien(inv)) {
      // maintien en cours (relève ou planches) : `decisionMaintien` l'arrêtera
    } else if (inv.invite === "note") {
      const id = Number(inv.id.slice(5));
      noteZ = noteZ === id ? null : id;
      sons.ramassage("soin");
    } else if (inv.id && !inv.bloque) {
      client.envoyer({ t: "acheter", id: inv.id });
    } else if (inv.bloque) {
      sons.achat(false);
    }
  }

  /** E : monter dans la voiture à portée, ou en descendre. Le serveur attribue le siège ; on attend sa réponse (≤ 1 s). */
  function interagir() {
    if (modeZ) { interagirZombies(); return; }
    if (!peutAgir() || enKillcam() || embarquementFin > 0 || pilote()) return;
    if (vehicule.actif()) {
      client.envoyer({ t: "descendre" });
      attendreReponseVehicule();
      return;
    }
    const inv = mondeJeu.invite(moi.p, null, client.maintenantServeur());
    if (inv.invite === "monter" && inv.vehicule !== null) {
      client.envoyer({ t: "monter", vehicule: inv.vehicule });
      attendreReponseVehicule();
      return;
    }
    if (monstresImage?.bus && monstresImage.bus.actif) {
      const dx = moi.p[0] - monstresImage.bus.p[0];
      const dz = moi.p[2] - monstresImage.bus.p[2];
      if (Math.hypot(dx, dz) < 8) {
        monterBus();
      }
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

  // ---------- sort d'invocation ----------
  /** Lance le sort (touche « invoquer ») : il faut une charge, être vivant, à pied et hors entracte. Le serveur revalide tout. */
  function invoquer(): boolean {
    // le pilote du titan ne lance pas le sort (le serveur le refuse aussi)
    if (!peutAgir() || enKillcam() || entracte || vehicule.actif() || pilote() || !mondeTigres.aCharge()) return false;
    client.envoyer({ t: "invoquer" });
    return true;
  }

  function lancerFrappe(cible: Vec3) {
    if (!peutAgir() || enKillcam() || entracte) return;
    client.envoyer({ t: "lancerFrappe", cible });
    sons.sireneFrappe();
  }

  function lancerFumigene() {
    if (!peutAgir() || enKillcam() || entracte || vehicule.actif() || pilote()) return;
    const o = oeil();
    const dir = directionVisee(lacet, tangage, 0);
    const v: Vec3 = [dir[0] * 18, dir[1] * 18 + 4, dir[2] * 18];
    client.envoyer({ t: "lancerFumigene", p: [o[0], o[1], o[2]], v });
    sons.fumigene();
  }

  // ---------- grenades (v8, zombies) ----------
  /** Ce qu'il me reste (dernier `zombies{etat}`, moins mes lancers pas encore confirmés). */
  function stockGrenades(genre: "frag" | "remontoir"): number {
    const z = partieZ?.joueurs.find((x) => x.id === client.id);
    const n = genre === "frag" ? z?.grenades ?? 0 : z?.remontoirs ?? 0;
    return Math.max(0, n - (grenades?.enAttente(genre) ?? 0));
  }
  const peutLancerGrenade = () => modeZ && peutAgir() && !aTerreZ && !elimineZ && !enKillcam();
  /** Lancer parti : message au serveur (œil, visée, cuisson), prédiction locale dessinée tout de suite, son. */
  function envoyerGrenade(d: LancerDemande) {
    if (!grenades) return;
    const o = oeil();
    const dir = directionVisee(lacet, tangage, 0);
    const oc: Vec3 = [o[0], o[1], o[2]];
    client.envoyer({ t: "lancerGrenade", genre: d.genre, o: oc, d: [dir[0], dir[1], dir[2]], cuissonMs: d.cuissonMs });
    grenades.predire(d.genre, oc, dir, client.maintenantServeur(), d.cuissonMs, client.id ?? "");
    sons.grenadeLancer();
  }
  function presserGrenade(genre: "frag" | "remontoir") {
    if (!grenades || !peutLancerGrenade()) return;
    const d = grenades.presser(genre, t * 1000, stockGrenades(genre));
    if (d) envoyerGrenade(d);
  }
  function relacherGrenade(genre: "frag" | "remontoir") {
    const d = grenades?.relacher(genre, t * 1000);
    if (d && peutLancerGrenade()) envoyerGrenade(d);
  }
  /** À chaque image : bips et lancer forcé de la cuisson, grenades dessinées, rebonds et cymbales entendus. */
  function majGrenades() {
    if (!grenades || !rGrenades) return;
    if (!peutLancerGrenade()) grenades.annuler(); // à terre ou mort en pleine cuisson : la grenade reste dans la poche
    const c = grenades.majCuisson(t * 1000);
    if (c.bip) sons.grenadeBip();
    if (c.lancer && peutLancerGrenade()) envoyerGrenade(c.lancer);
    const ts = client.maintenantServeur();
    const liste = grenades.affichees(ts);
    rGrenades.maj(liste, t);
    for (const r of grenades.rebonds(rebondsVusT, ts)) sons.grenadeRebond(r.force, positionSon(r.p));
    rebondsVusT = ts;
    if (t - cymbalesT > 0.32) {
      const pose = liste.find((g) => g.genre === "remontoir" && g.posee);
      if (pose) { cymbalesT = t; sons.remontoir(positionSon(pose.p)); }
    }
  }

  function monterBus() {
    if (!peutAgir() || enKillcam() || entracte || vehicule.actif() || pilote()) return;
    client.envoyer({ t: "monterBus" });
  }

  /** Position d'un son par rapport à la caméra (distance et panoramique). */
  function placeSon(p: Vec3): PositionSon {
    const dx = p[0] - camPos[0], dz = p[2] - camPos[2];
    return { distance: Math.hypot(dx, p[1] - camPos[1], dz), pan: panSon(camLacet, dx, dz) };
  }

  /** Messages des tigres (v3) : sons, giclées, retour de touche de mes tirs sur un tigre, effondrement à la mort, fumée de l'invocation. */
  function recevoirTigre(m: Extract<MessageServeur, { t: "tigre" }>) {
    switch (m.evenement) {
      case "apparu":
        if (m.genre === "allie" && !enReplay) renduTigres.fumee(m.p);
        break;
      case "alerte":
        if (!enReplay) sons.rugissement(placeSon(m.p));
        break;
      case "touche":
        if (!enReplay && m.par) {
          const e = tigresVus.get(m.id);
          const p = e?.p ?? m.p;
          effets.eclaboussure([p[0], p[1] + (m.zone === "tete" ? 1.0 : 0.75), p[2]], COULEUR_TIGRE);
        }
        // retour de touche CONFIRMÉ, comme un `degats` (§13.2.1) : le serveur donne les dégâts réellement subis et les PV restants
        if (m.par && m.par === client.id && m.degats !== undefined) {
          sons.touche(m.zone === "tete");
          cb.evenement({ type: "confirme", cible: m.id, degats: m.degats, absorbe: 0, zone: m.zone ?? "corps", tue: (m.pv ?? 1) <= 0 });
        }
        break;
      case "mort":
        renduTigres.mourir(m.id);
        if (!enReplay) sons.plainte(placeSon(m.p));
        if (m.par && m.par === client.id) sons.kill();
        break;
      default:
        break;
    }
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
    sons.derapage(0);
    if (etaitAssis || p) {
      // à la descente l'œil part de la hauteur du siège et se relève jusqu'à 1,95 m (lissage)
      moi = etatInitial(p ?? [moi.p[0], moi.p[1], moi.p[2]]);
      hauteurOeilLissee = OEIL_SIEGE;
    }
  }

  // ---------- titan (v3) ----------
  function entrerTitan(p: Vec3, cap: number) {
    quitterVehicule();
    titan.entrer(p, cap);
    moi = etatInitial([p[0], 0, p[2]]);
    lacet = cap;
    tangage = 0;
    viseMaintenu = false;
    accroupiBascTenu = false;
    sons.mur(false);
    sons.glisse(false);
  }
  function quitterTitan(p: Vec3) {
    if (!titan.actif()) return;
    titan.sortir();
    // l'œil redescend de la tête du titan jusqu'à hauteur d'homme (lissage)
    moi = etatInitial([p[0], 0, p[2]]);
    hauteurOeilLissee = OEIL_TITAN;
    prochains.clear();
  }

  /** Position d'un son distant par rapport à ma vue. */
  function positionSon(p: Vec3) {
    const cam = oeil();
    const dx = p[0] - cam[0], dz = p[2] - cam[2];
    return { distance: Math.hypot(dx, p[1] - cam[1], dz), pan: panSon(lacet, dx, dz) };
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
    if (estIdZombie(id)) {
      const v = mz.parId(Number(id.slice(1)));
      return v ? [v.x, (zone === "tete" ? 0.5 : 0.33) * v.echelle, v.z] : null;
    }
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
    const deboutLocal = apparu && vivant;
    aTerreZ = false;
    elimineZ = false;
    terreFinTZ = 0;
    reanimCible = null;
    terminerKillcam();
    quitterVehicule();
    titan.sortir();
    // (v8) relève ou reprise : on reste où l'on est, regard compris (le serveur a suivi nos états) ; sinon téléportation
    if (!gardePosition(m, moi.p, deboutLocal)) {
      moi = etatInitial(m.p);
      lacet = m.lacet;
      tangage = 0;
    }
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

  /**
   * Je tombe (mort en arène, à terre ou éliminé en zombies) : plus de visée ni de tir, éjecté du véhicule, sons de boucle coupés. Le reste
   * (killcam, événement « mort ») appartient à la mort de l'arène, le HUD des zombies lit `aTerre` / `elimine`.
   */
  function tomber() {
    vivant = false;
    pv = 0;
    bouclier = 0;
    mortT = 0;
    mortSigne = Math.random() < 0.5 ? -1 : 1;
    viseMaintenu = false;
    tirMaintenu = false;
    accroupiBascTenu = false;
    // l'occupant d'un véhicule en est éjecté à sa mort
    vehicule.sortir();
    embarquementFin = 0;
    sons.moteur(null);
    sons.derapage(0);
    sons.mur(false);
    arreterReanimation();
    if (modeZ) {
      // à terre : on s'effondre sur place (plus d'élan qui ferait glisser le corps d'un mètre au sprint) ; la chute verticale continue
      moi.v[0] = 0;
      moi.v[2] = 0;
      moi.glisse = null;
    }
  }

  /** `degats` dont je suis l'auteur : retour de touche CONFIRMÉ par le serveur (zone et dégâts du serveur, §13.2.1). */
  function toucheConfirmee(m: Extract<MessageServeur, { t: "degats" }>) {
    sons.touche(m.zone === "tete");
    cb.evenement({ type: "confirme", cible: m.cible, degats: m.degats, absorbe: m.absorbe ?? 0, zone: m.zone, tue: m.pv <= 0 });
  }

  /**
   * (v8) Le cadavre d'un tigre zombie : un ragdoll lancé selon la façon dont il est mort (arme, zone, origine du coup du message ; repli sur
   * la position du tueur, ou sur ma caméra, quand le serveur ne la donne pas).
   */
  function mortZombie(m: Extract<MessageServeur, { t: "zombieMort" }>, essai?: { cap: number; type: TypeZombie }) {
    const id = Number(m.id.slice(1));
    const cause: MortZombie = m.cause === "explosion" || m.cause === "nuke" ? m.cause : m.zone === "tete" ? "tete" : m.cause === "melee" ? "melee" : "corps";
    const tueur = m.par === client.id ? null : etats.get(m.par);
    const repli: Vec3 = tueur ? [tueur.p[0], tueur.p[1] + SILHOUETTE.oeil, tueur.p[2]] : [camPos[0], camPos[1], camPos[2]];
    const impulsion = impulsionMort({ cause, arme: m.arme, ameliore: m.ameliore, src: m.src, p: m.p, graine: id }, repli);
    if (essai) rz?.cadavreEssai({ x: m.p[0], z: m.p[2], cap: essai.cap, type: essai.type, echelle: echelleZombie(essai.type) }, cause, impulsion);
    else rz?.mort(id, cause, impulsion);
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
          quitterVehicule();
          arreterReanimation();
          // le serveur a retiré la charge du sort à la sortie de l'arène, son annonce peut ne jamais nous parvenir
          mondeTigres.perdreCharge();
          if (modeZ) {
            // zombies : retiré par le serveur (partie finie, retour au lobby ; plus d'éviction pour inactivité depuis la v8) : pas de réentrée, l'hôte ramène au lobby
            cb.sortir();
            break;
          }
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
        kc.alimenter(m.ts, m.j, m.vehicules);
        mondeJeu.alimenterVehicules(m.ts, m.vehicules);
        mondeTigres.alimenter(m.ts, m.tigres);
        jm.alimenter(m.ts, m.monstres);
        if (modeZ) mz.alimenter(m.ts, m.zombies);
        const s = m.j.find((x) => x.id === client.id);
        if (s && vivant) {
          // des PV qui remontent sans cadeau d'Elsa : la régénération tourne (le délai de 5 s est donc écoulé)
          if (s.pv > pv && s.pv < pvMaxMoi()) {
            dernierDegatT = Math.min(dernierDegatT, t - regenDelaiS());
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
        if (modeZ && m.ravitaille === "tout") annoncer("Munitions max !", "bonus");
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
          const imp = tracerEffets(m.o, d, Math.min(a.portee, PORTEE_EFFETS_M), liste, m.id);
          const v = mondeJeu.impactVoiture(m.o, d, imp.distance, tsV, vus, etats.get(m.id)?.vehicule?.id ?? null);
          if (v && !imp.cible) {
            const fin: Vec3 = [m.o[0] + d[0] * v.distance, m.o[1] + d[1] * v.distance, m.o[2] + d[2] * v.distance];
            effets.traçante(depart, fin, m.arme);
            effets.impact(fin, [-d[0], -d[1], -d[2]], "#ffd9a0");
            continue;
          }
          effets.traçante(depart, imp.point, m.arme);
          if (!imp.cible && imp.distance < a.portee - 0.01) {
            effets.impact(imp.point, [-d[0], -d[1], -d[2]], couleurDe(m.id));
            if (imp.distance < Math.min(a.portee, PORTEE_EFFETS_M) - 0.01) impactsBalles.ajouter(imp.point, normaleImpact(monde, imp.point, m.o));
          }
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
        sons.coup(false, { distance: Math.hypot(dx, m.o[1] - cam[1], dz), pan: panSon(lacet, dx, dz) }, m.arme);
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
          // zombies : à 0 PV on tombe tout de suite (l'état « à terre » ou « éliminé » du serveur le confirme ensuite)
          if (modeZ && m.pv <= 0 && vivant) { aTerreZ = true; tomber(); }
        } else {
          if (!enReplay) {
            const c = posTouche(m.cible, m.zone);
            // un tigre touché saigne orange, un joueur dans sa couleur
            if (c) effets.eclaboussure(c, estIdZombie(m.cible) ? "#ff8a1c" : couleurDe(m.cible));
            distants.get(m.cible)?.avatar.toucher();
          }
          // (v7) un tigre zombie touché recule (la tête à la tête)
          if (estIdZombie(m.cible) && m.pv > 0) rz?.touche(Number(m.cible.slice(1)), m.zone === "tete");
          // les coups de patte de mon tigre allié me sont crédités (`par` = moi) : ce ne sont pas des touches de mes armes
          if (m.par === client.id && !coupDeMonTigre(m.src, oeil(), tigresVus, client.id)) toucheConfirmee(m);
        }
        break;
      }
      case "mort": {
        if (m.cible === client.id) {
          reapparitionFin = t + m.delai / 1000;
          tomber();
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
      case "avion":
        mondeTigres.recevoir(m, client.id);
        break;
      case "tigre":
        mondeTigres.recevoir(m, client.id);
        recevoirTigre(m);
        break;
      case "sort":
        // sort gagné : carillon de l'arme ramassée (l'icône du sort apparaît au HUD)
        if (mondeTigres.recevoir(m, client.id) && m.evenement === "gagne") sons.ramassage("arme");
        break;
      case "evenement":
        jm.majEvenement(m);
        if (m.phase === "annonce") sons.alerte(m.type);
        break;
      case "laser":
        jm.ajouterLaser(m);
        sons.laser(positionSon(m.de));
        break;
      case "batiments": {
        if (m.complet) {
          // état entier (nouveau match, arrivée) : ce qui n'y figure pas est debout et intact, sans animation
          const ruines = new Set(m.detruits);
          const br = new Map(m.breches.map((x) => [x[0], x] as const));
          for (let id = 0; id < data.buildings.length; id++) {
            const pr = monde.prismes[id];
            if (!pr) continue;
            effondrements.delete(id);
            ouvertures.delete(id);
            if (ruines.has(id)) { detruireBatiment(monde, id); destruction.poser(id, 1); }
            else if ((pr.h === 0 && pr.hOrigine > 0) || pr.creux) { releverBatiment(monde, id); destruction.poser(id, 0); }
            const x = br.get(id);
            if (x && !ruines.has(id)) { poserBreche(monde, id, { x: x[1], z: x[2], r: x[3] }); destruction.breche(id, x[1], x[2], x[3]); }
            else destruction.breche(id, 0, 0, 0);
          }
          if (!m.detruits.length && !m.breches.length) { impactsBalles.vider(); tracesPneus.vider(); debris.vider(); }
          break;
        }
        // changements : effondrement complet ou brèche qui s'ouvre, animés, avec débris
        for (const id of m.detruits) {
          const pr = monde.prismes[id];
          if (!pr || pr.h === 0) continue;
          detruireBatiment(monde, id);
          ouvertures.delete(id);
          if (enReplay) { destruction.poser(id, 1); continue; }
          effondrements.set(id, t);
          const b = data.buildings[id];
          const r = emprise(b.r);
          rm.explosion([b.c[0], b.h * 0.4, b.c[1]], Math.min(14, 4 + b.h * 0.6));
          sons.effondrement(positionSon([b.c[0], 0, b.c[1]]));
          debris.projeter(b.c[0], b.c[1], r * 0.8, b.h * 0.7, Math.round(Math.min(40, 12 + r * 1.5)));
        }
        for (const [id, x, z, r] of m.breches) {
          const pr = monde.prismes[id];
          if (!pr || pr.h === 0) continue;
          const avant = pr.creux;
          poserBreche(monde, id, { x, z, r });
          if (enReplay) { destruction.breche(id, x, z, r); continue; }
          ouvertures.set(id, { t0: t, de: avant ? { ...avant } : { x, z, r: 0 }, vers: { x, z, r } });
          const neuf = r - (avant?.r ?? 0);
          debris.projeter(x, z, Math.min(r, 8), pr.hOrigine * 0.6, Math.round(Math.min(26, 5 + neuf * 2)), avant?.x, avant?.z);
          if (t - sonBrecheT > 0.4) { sonBrecheT = t; sons.effondrement(positionSon([x, 0, z])); }
        }
        break;
      }
      case "onde":
        // saut du tigre : anneau d'impact au sol, rugissement
        jm.ajouterOnde(m);
        sons.alerte("tigre");
        break;
      case "explosionMonstre": {
        rm.explosion(m.p, m.rayon);
        const pos = positionSon(m.p);
        sons.explosionMonstre(Math.min(1, m.rayon / 9), pos);
        const portee = Math.max(SECOUSSE_MONSTRE_M, m.rayon * 3);
        if (pos.distance < portee && !reduit) secousse = 0.07 * (1 - pos.distance / portee) * (Math.random() < 0.5 ? -1 : 1);
        break;
      }
      case "titan":
        jm.majTitan(m);
        if (m.pilote === client.id) {
          if (m.phase === "fin") quitterTitan(m.p);
          else if (vivant) entrerTitan(m.p, m.cap);
        }
        break;
      case "zombies": {
        const avant = partieZ;
        partieZ = m.etat;
        rInterieurs?.majCourant(m.etat.courant);
        if (avant && avant.phase === "manche" && m.etat.phase === "pause") { sons.finManche(); }
        if (avant && avant.phase !== "fin" && m.etat.phase === "fin") sons.voix("partie_perdue", 1.2);
        if (m.etat.pap.etat === "cuisson" && m.etat.pap.joueur === client.id) papUtilise = true;
        portesFermees = segmentsPortesFermees(m.etat.portes.filter((x) => x.ouverte).map((x) => x.id));
        const me = m.etat.joueurs.find((x) => x.id === client.id);
        if (me) {
          elimineZ = me.etat === "elimine";
          aTerreZ = me.etat === "terre";
          terreFinTZ = me.etat === "terre" ? me.terreFinT ?? 0 : 0;
          if ((aTerreZ || elimineZ) && vivant) tomber();
        }
        // nouvelle manche : coup de tambour (sirène pour une livraison du Truck Muche)
        if (m.etat.phase === "manche" && m.etat.manche !== mancheVue) {
          mancheVue = m.etat.manche;
          // livraison (les manches des chiens de BO1) : coup de tonnerre, sirène, annonce, puis le Truck Muche rit
          if (m.etat.mancheTruck) {
            sons.tonnerre();
            sons.mancheTruck();
            annoncer("Livraison du Truck Muche !", "truck", "truck", 0.7);
            sons.rireTruck(undefined, 3.2);
          } else sons.manche();
        }
        if (m.etat.phase === "lobby") { mancheVue = 0; papUtilise = false; noteZ = null; grenades?.vider(); }
        break;
      }
      case "zevt": {
        const e = m.e;
        switch (e.e) {
          case "planche": {
            rObjets?.planche(e.fenetre, e.arrachee);
            const f = fenetreDeId(e.fenetre);
            if (f) sons.planche(e.arrachee, positionSon([f.milieu[0], 1.5, f.milieu[1]]));
            break;
          }
          case "bonusLache": sons.bonus(false, positionSon([e.p[0], 1, e.p[2]])); break;
          case "bonus": {
            sons.bonus(true, positionSon([e.p[0], 1, e.p[2]]));
            // l'annonceur parle sur la fin de la fanfare ; « Munitions max » s'affiche à la réception de l'équipement ravitaillé
            if (e.genre !== "munitions") annoncer(`${NOMS_BONUS[e.genre]} !`, "bonus", voixDuBonus(e.genre), 0.35);
            else sons.voix("munitions", 0.35);
            if (e.genre === "menuisier") {
              // toutes les planches reviennent en volant ; les coups de marteau de la fenêtre la plus proche
              rObjets?.toutReposer();
              const f = fenetrePlusProche(moi.p[0], moi.p[2]);
              if (f) sons.planche(false, positionSon([f.milieu[0], 1.5, f.milieu[1]]));
            }
            break;
          }
          case "nuke": feux.explosion([moi.p[0], 4, moi.p[2]]); secousse = 0.09; break;
          case "courant": sons.courant(); annoncer("Courant rétabli : distributeurs et Micro-ondes en marche", "courant", "courant", 0.6); break;
          case "peluche": {
            const a = achatDeId(`boite:B${e.de + 1}`);
            sons.boite("peluche", a ? positionSon([a.position[0], 1, a.position[1]]) : undefined);
            annoncer("La boîte s'envole…", "info");
            break;
          }
          case "atout": if (e.joueur === client.id) sons.jingleAtout(e.atout); break;
          case "pap": {
            const a = ACHATS.find((x) => x.genre === "pap")!;
            sons.microondes(e.pret, positionSon([a.position[0], 1.3, a.position[1]]));
            if (e.pret && e.joueur === client.id) annoncer(`${nomZombie(e.arme, true)} servi !`, "pap");
            break;
          }
          case "truck":
            if (e.quoi === "explosion") { feux.explosion(e.p); sons.explosion(positionSon(e.p)); annoncer("Truck Muche explosé : +500 $", "truck"); }
            else sons.klaxonCamion(positionSon(e.p));
            break;
          case "explosion": feux.explosion(e.p); sonSouffle(e.rayon, e.p); break;
          case "grenade": {
            grenades?.exploser(e.id);
            feux.explosion(e.p);
            sons.grenadeExplosion(positionSon(e.p));
            const d = Math.hypot(e.p[0] - moi.p[0], e.p[1] - moi.p[1], e.p[2] - moi.p[2]);
            if (d < e.rayon * 2) secousse = Math.max(secousse, 0.07 * (1 - d / (e.rayon * 2)));
            break;
          }
          case "ingredient": annoncer(`Ingrédient trouvé (${partieZ?.quete.ingredients.length ?? 0} / 3)`, "quete"); break;
          case "cuisson":
            annoncer(e.fin ? "La Recette ultime est servie !" : "La Recette ultime cuit… tenez 30 s !", "quete", e.fin ? "recette_servie" : "recette_cuit");
            break;
          case "manche": break;
          case "autoReleve": if (e.joueur === client.id) annoncer("Pause Café : vous vous relevez", "info"); break;
        }
        break;
      }
      case "argent":
        argentZ = m.solde;
        if (m.delta !== 0) {
          gainZ = { n: ++nGainZ, delta: m.delta, motif: m.motif };
          if (m.delta > 0 && t - sonPieceT > 0.08) { sonPieceT = t; sons.piece(); }
        }
        break;
      case "achat":
        if (m.ok) {
          achatsZ++;
          sons.achat(true);
          if (m.id.startsWith("boite:") && partieZ?.boite.etat === "fermee") {
            const a = achatDeId(m.id);
            sons.boite("tirage", a ? positionSon([a.position[0], 1, a.position[1]]) : undefined);
          }
        } else {
          refusZ = { n: ++nRefusZ, id: m.id, raison: m.raison as RaisonAchat };
          sons.achat(false);
        }
        break;
      case "zombieMort": {
        if (enReplay) break;
        // un tigre tombe : gerbe orange et cri qui s'effondre ; mon ding si c'est moi qui l'ai abattu (jamais dans le fil des éliminations)
        const c: Vec3 = [m.p[0], 0.8, m.p[2]];
        effets.eclaboussure(c, "#ff8a1c");
        effets.eclaboussure([c[0], 1.4, c[2]], "#ffd9a0");
        sons.rugissementTigre(positionSon(c), true);
        if (m.par === client.id) sons.kill();
        mortZombie(m);
        break;
      }
      case "canon": {
        if (m.id === client.id || enReplay) break;
        const imp = tracerEffets(m.o, m.d, TITAN.canon.portee, cibles(), m.id);
        effets.traçante([m.o[0], m.o[1] - 0.9, m.o[2]], imp.point, "minigun");
        if (!imp.cible && imp.distance < TITAN.canon.portee - 0.01) impactsBalles.ajouter(imp.point, normaleImpact(monde, imp.point, m.o));
        sons.canon(positionSon(m.o));
        break;
      }
      case "busC3":
        sons.klaxonBus();
        break;
      case "frappe":
        sons.sireneFrappe();
        if (m.evenement === "lancee" && m.joueur === client.id) sons.alerte("tigre");
        break;
      case "fumigene":
        sons.fumigene();
        break;
      case "grenade": {
        // (v8) une grenade part : sa trajectoire (celle du serveur) remplace ma prédiction, celle d'un autre s'entend
        if (!grenades) break;
        grenades.recevoir(m, client.id ?? "");
        if (m.par !== client.id) sons.grenadeLancer(positionSon(m.o));
        break;
      }
      case "ramassageArme":
        if (m.id === client.id) sons.ramassage("arme");
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
        case "sprint": dashDemande = true; break;
        case "recharger": demarrerRecharge(); break;
        case "tir": if (vivant) { tirMaintenu = true; tirPresse = t; tirConsomme = false; } break;
        case "visee": viseMaintenu = !estMelee(armes.armeEnMain()); break; // pas de visée avec une arme blanche
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
        case "invoquer": if (!modeZ) invoquer(); break;
        case "fumigene": if (!modeZ) lancerFumigene(); break;
        case "frappeAerienne": break;
        // (v8) zombies : G tire la goupille (maintenir : cuire), B lance le tigre à remontoir
        case "grenade": if (modeZ) presserGrenade("frag"); break;
        case "remontoir": if (modeZ) presserGrenade("remontoir"); break;
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
      else if (a === "interagir" && !actionActive("interagir")) arreterReanimation();
      else if (a === "grenade" && !actionActive("grenade")) relacherGrenade("frag");
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
    arreterReanimation();
    grenades?.annuler();
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
    else if (evince && !modeZ) reentrer();
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
  const live: HudLive = { recharge: 0, vitesse: 0, vitesseKmh: 0, regenDelai: 1, reanimation: 0 };
  const radarFrame: RadarFrame = creerRadarFrame();
  let dernierHud: HudEtat | null = null;
  let accHud = ECART_HUD_S;
  /** régénération en cours : PV manquants et délai sans dégâts écoulé */
  const regenEnCours = () => vivant && pv < pvMaxMoi() && t - dernierDegatT >= regenDelaiS();
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
    const a = estMelee(arme) ? null : STATS[arme];
    const info = vehicule.actif();
    const lunette = lunetteActive();
    const af = armeFeu();
    const invZ = modeZ ? inviteZ() : INVITE_VIDE;
    const inv = modeZ
      ? { invite: invZ.invite, detail: invZ.bloque ? `${invZ.detail} · ${invZ.bloque}` : invZ.detail, vehicule: null }
      : peutAgir() && !enKillcam()
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
      equipSuivant: `${equipSuivant.principale}|${equipSuivant.secondaire}${equipSuivant.melee === "epee" ? "|epee" : ""}`,
      munitions: estMelee(arme) ? 0 : Math.max(0, armes.munitions()),
      chargeur: armes.chargeur(),
      // spéciale d'Elsa (munitions totales, retirée à 0) : aucune réserve ; les autres armes ont une réserve illimitée (limitée en zombies)
      reserve: a?.sansRecharge ? 0 : armes.reserveEnMain(),
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
      bonusVitesse: estMelee(arme) ? MELEE[arme].vitesse : 1,
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
      sort: vivant && mondeTigres.aCharge(),
      titan: pilote(),
      ...(modeZ ? {
        mode: "zombies" as const, argent: argentZ, manche: partieZ?.manche ?? 0, restants: mz.restants(), aTerre: aTerreZ, elimine: elimineZ,
        invitePrix: invZ.prix, inviteAssez: invZ.bloque ? true : invZ.assez, reanime: reanimCible !== null || reparFenetre !== null,
      } : {}),
      dansFumee: vivant && (monstresImage?.fumigenes?.some((f) => Math.hypot(moi.p[0] - f.p[0], moi.p[2] - f.p[2]) <= 12) ?? false),
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
    radarFrame.modeZombies = modeZ;
    if (modeZ) {
      // tigres VUS (pas de wallhack) et portes encore fermées ; ni PNJ, ni voitures, ni Elsa
      suiviRadar.majZombies(radarFrame, t, dt, camPos, directionVisee(camLacet, camTangage, 0), mz.zombies(), mz.nombre());
      for (const p of portesFermees) ajouterPorte(radarFrame, p.p[0], p.p[1], p.q[0], p.q[1]);
      purgerEchos(radarFrame, dt);
      return;
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

    // Bus C3, fumigènes et frappes aériennes sur la carte
    if (monstresImage?.bus && monstresImage.bus.actif) {
      radarFrame.bus = { x: monstresImage.bus.p[0], z: monstresImage.bus.p[2], cap: monstresImage.bus.cap, actif: true };
    } else {
      radarFrame.bus = null;
    }
    if (monstresImage?.fumigenes && monstresImage.fumigenes.length > 0) {
      radarFrame.fumigenes = monstresImage.fumigenes.map((f) => ({ x: f.p[0], z: f.p[2], r: 12 }));
    } else {
      radarFrame.fumigenes = [];
    }
    if (monstresImage?.frappes && monstresImage.frappes.length > 0) {
      const f = monstresImage.frappes[0];
      radarFrame.frappeZone = { x: f.cible[0], z: f.cible[2], r: 18 };
    } else {
      radarFrame.frappeZone = null;
    }
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
      if ((id === client.id && !enReplay) || e.titan) continue;
      const d = distants.get(id) ?? creerAvatarDistant(id);
      d.avatar.maj(e, dt);
    }
    for (const id of [...distants.keys()]) {
      if (!etatsRendu.has(id) || (id === client.id && !enReplay) || etatsRendu.get(id)?.titan) retirerAvatar(id);
    }
    // pseudos : seulement si le joueur est VU (distance, champ de vision, ligne de vue), jamais pendant le rejeu
    listeVisible.length = 0;
    for (const [id, e] of etatsRendu) {
      if (id === client.id || e.titan) continue;
      listeVisible.push({ id, p: e.p, accroupi: !!e.accroupi || !!e.vehicule, vivant: e.vivant });
    }
    if (!modeZ) {
      const te = dyn.elsaTete();
      listeVisible.push({ id: "elsa", p: [te[0], te[1] - SILHOUETTE.tete.y, te[2]], vivant: true });
    }
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
    // zombies : ni voitures ni Elsa, mais les explosions (grenades, Truck, armes explosives) passent par les feux
    if (modeZ) { feux.maj(dt, SANS_FEUX); return; }
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
    if (!enReplay) {
      const mienne = vehicule.estConducteur() ? vehicule.actif()?.vehicule : undefined;
      for (const v of liste) suivreTraces(`v${v.id}`, v.p, v.cap, v.v, dt, 0.8, 1.5, v.id === mienne ? vehicule.derapage() > 0.15 : undefined);
    }
    tracesPneus.maj(dt);
  }

  /** (v3) Monstres : interpolés comme les joueurs ; mon titan est à l'état local (sans retard). Pas lourds du tigre et du titan. */
  function majMonstres(dt: number) {
    const tsServeur = client.maintenantServeur();
    monstresImage = jm.a(tsServeur - JEU.interpolationMs);
    const local = titan.etat();
    if (local && monstresImage.titan && client.id) monstresImage.titan = { ...monstresImage.titan, p: local.p, cap: local.cap, v: local.v };
    const ti = monstresImage.titan;
    rm.maj(enReplay ? {} : monstresImage, enReplay ? [] : jm.lasers(tsServeur), t, tsServeur, dt, ti ? couleurDe(ti.pilote) : "#9be9ff", pilote());
    // Truck Muche fou : coups de klaxon réguliers, entendus de loin
    const tr = monstresImage.truck;
    if (tr && !enReplay) suivreTraces("truck", tr.p, tr.cap, tr.v, dt, 1.2, 1.9);
    if (tr && !enReplay) {
      klaxonDans -= dt;
      if (klaxonDans <= 0) {
        klaxonDans = KLAXON_TRUCK_S.min + Math.random() * (KLAXON_TRUCK_S.max - KLAXON_TRUCK_S.min);
        sons.klaxonCamion(positionSon(tr.p));
      }
    } else klaxonDans = 0.6;
    // effondrements en cours (le nuanceur écrase la hauteur), traces d'impact
    for (const [id, t0] of effondrements) {
      const k = Math.min(1, (t - t0) / DUREE_EFFONDREMENT_S);
      destruction.poser(id, k * k);
      if (k >= 1) effondrements.delete(id);
    }
    for (const [id, o] of ouvertures) {
      const k = Math.min(1, (t - o.t0) / DUREE_BRECHE_S);
      const e = 1 - (1 - k) * (1 - k);
      destruction.breche(id, o.de.x + (o.vers.x - o.de.x) * e, o.de.z + (o.vers.z - o.de.z) * e, o.de.r + (o.vers.r - o.de.r) * e);
      if (k >= 1) ouvertures.delete(id);
    }
    debris.maj(dt);
    impactsBalles.maj(dt);
    const tg = monstresImage.tigre;
    if (tg && !enReplay) {
      distTigre += Math.abs(tg.v) * dt;
      if (distTigre > FOULEE_LOURDE_M) { distTigre = 0; sons.pasLourd(positionSon(tg.p)); }
    }
    if (ti && !enReplay) {
      distTitan += Math.abs(ti.v) * dt;
      if (distTitan > FOULEE_LOURDE_M * TITAN.echelle) { distTitan = 0; sons.pasLourd(ti.pilote === client.id ? undefined : positionSon(ti.p)); }
    }
  }

  /** (zombies) Tigres interpolés à l'instant du rendu, dessinés (culling, LOD), griffes et rugissements entendus. */
  function majZombies(dt: number) {
    if (!modeZ || !rz) return;
    imageNum++;
    const n = mz.nombre(); // échantillonnés avant le mouvement
    const zs = mz.zombies();
    const regardX = -Math.sin(camLacet), regardZ = -Math.cos(camLacet);
    rz.maj(zs, n, camPos, regardX, regardZ, dt, imageNum, {
      // le chef (gros tigre rouge) a son propre coup de patte, calé sur le contact ; les autres gardent la griffe synthétisée
      surGriffe: (v) => (sonGriffe(v.type) === "chef" ? sons.griffeChef(positionSon([v.x, 1, v.z])) : sons.griffe(positionSon([v.x, 1, v.z]))),
      // coups de patte dans les planches (simulés ici) : seul le chef s'entend, les autres ne font que le craquement du bois du serveur
      surArrachage: (v) => { if (sonGriffe(v.type) === "chef") sons.griffeChef(positionSon([v.x, 1.4, v.z])); },
    });
    const id = rugissements.maj(dt, zs, n, camPos, Math.random);
    if (id !== null) {
      const v = mz.parId(id);
      if (v && sonGriffe(v.type) === "chef") sons.grognementChef(positionSon([v.x, 1, v.z]));
      else if (v) sons.rugissementTigre(positionSon([v.x, 1, v.z]));
    }
    // maintien de E (relève, planches) : il s'arrête si j'ai lâché E ou si l'invite ne le propose plus, et démarre E TENUE (BO1 : on peut
    // arriver devant la fenêtre la touche déjà enfoncée)
    const dm = decisionMaintien(actionActive("interagir"), peutAgir(), inviteZ(), { cible: reanimCible, fenetre: reparFenetre });
    if (dm?.action === "arreter") arreterReanimation();
    else if (dm?.action === "demarrer") demarrerMaintien(dm.invite);
    // (v7) objets de la carte, intérieurs, Truck Muche des livraisons
    rObjets?.maj(partieZ, t, client.maintenantServeur(), dt);
    rInterieurs?.maj(t, dt);
    majGrenades();
    const tr = mz.truck();
    if (truckZ) {
      truckZ.group.visible = tr !== null;
      if (tr) {
        truckZ.group.position.set(tr.x, 0, tr.z);
        truckZ.group.rotation.y = tr.cap;
        // l'épave fume et s'assombrit
        truckZ.materiaux.ligne.color.set(tr.phase === 3 ? 0x5a3a20 : 0xffb35c);
      }
    }
    // une note ouverte se referme si l'on s'en éloigne
    if (noteZ !== null) {
      const n = NOTES.find((x) => x.id === noteZ);
      if (!n || Math.hypot(n.position[0] - moi.p[0], n.position[1] - moi.p[2]) > 3) noteZ = null;
    }
  }

  /**
   * Tigres (interpolés comme les joueurs) et avion (à l'horloge serveur, sa trajectoire est connue d'avance) : rendu, sons des actions et
   * moteur de l'avion. Pendant le rejeu de la killcam, rien du présent ne se superpose au passé : tigres, avion et leurs sons sont coupés.
   */
  function majTigres(dt: number) {
    const tsServeur = client.maintenantServeur();
    const ts = tsServeur - JEU.interpolationMs;
    tigresVus = mondeTigres.tigresA(ts);
    tigresDessines = tigresVus;
    const av = mondeTigres.avionA(tsServeur);
    renduTigres.maj(tigresVus, av, ts, dt, couleurDe, pseudoDe, !enReplay);
    const sonsTigres = mondeTigres.sons(tigresVus);
    if (enReplay) { sons.avion(null); return; }
    for (const s of sonsTigres) {
      if (s.son === "rugissement") sons.rugissement(placeSon(s.p));
      else sons.patte(placeSon(s.p));
    }
    sons.avion(av ? placeSon(av.p) : null);
  }

  function reconnexion() {
    // la connexion a été refaite (coupure réseau) : nouvel identifiant, plus dans l'arène
    if (client.id !== null && client.id !== idConnu) {
      const premier = idConnu === null;
      idConnu = client.id;
      if (premier) return;
      // zombies : nouvel id = reprise refusée (coupure de plus de 20 s, cf. `bonjour.reprise`) : on repart dans l'arène, la partie est perdue pour nous
      if (modeZ) { apparu = false; vivant = false; arreterReanimation(); cb.sortir(); return; }
      apparu = false;
      vivant = false;
      interp.vider();
      for (const id of [...distants.keys()]) retirerAvatar(id);
      // aucun état résiduel de l'ancienne session : voiture, killcam, pseudos, radar, Elsa
      terminerKillcam();
      quitterVehicule();
      titan.sortir();
      jm.reinitialiser();
      mondeJeu.reinitialiser();
      mondeTigres.reinitialiser();
      visib.vider();
      suiviRadar.vider();
      client.envoyer({ t: "rejoindre", ...choixEquipement() });
    } else if (client.id !== null) {
      idConnu = client.id;
    }
  }

  /**
   * Message d'état du joueur (à pied, ou passager d'une voiture) ; le conducteur envoie `conduite`. En zombies, le corps à terre continue
   * d'envoyer sa position (le serveur la suit) : la relève garde ainsi la position du client, sans téléportation.
   */
  function envoyerEtat() {
    if (!apparu || (!vivant && !(modeZ && aTerreZ && !elimineZ))) return;
    const vue = tangageDeVue(tangage, kick);
    if (pilote()) {
      const m = titan.message(lacet, vue);
      if (m) client.envoyer(m);
      return;
    }
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
      // en attente de la première apparition : survol de l'arène, centré sur le rond-point (zombies : sur la cour de départ)
      const fx = modeZ ? FOCUS_ZOMBIES[0] : cx, fz = modeZ ? FOCUS_ZOMBIES[1] : cz;
      camera.position.set(fx, 70, fz + 90);
      camera.rotation.set(-0.5, 0, 0);
      camPos[0] = fx; camPos[1] = 70; camPos[2] = fz + 90;
      camLacet = 0;
      camTangage = -0.5;
    } else if (vivant) {
      const assis = vehicule.actif() !== null;
      const cible = pilote() ? OEIL_TITAN : assis ? OEIL_SIEGE : hauteurOeil(moi.accroupi);
      hauteurOeilLissee += (cible - hauteurOeilLissee) * lissage(LISSAGE_OEIL, dt);
      const bob = reduit || assis ? 0 : pilote()
        ? Math.abs(Math.sin(t * 4.2)) * 0.12 * Math.min(1, Math.abs(titan.etat()?.v ?? 0) / 5)
        : Math.sin(t * 11) * 0.025 * Math.min(1, vh / 9) * (moi.auSol && !moi.glisse ? 1 : 0);
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
    {
      // (v7) camouflage du Pack-a-Punch sur l'arme en main
      const enMain = armes.armeEnMain();
      armeMain.ameliorer(modeZ && !estMelee(enMain) && (armes.equipement().ameliorees?.includes(enMain) ?? false));
    }
    if (embarquementFin > 0 && t >= embarquementFin) embarquementFin = 0;

    // --- mouvement ---
    // (zombies) tigres interpolés AVANT le mouvement : le joueur bute sur les corps qu'il voit (même instant que le rendu et les tirs)
    if (modeZ) mz.echantillon(client.maintenantServeur() - JEU.interpolationMs);
    const aVerrou = verrouille();
    const en = entrees();
    const actif = vivant && apparu && !enReplay && (aVerrou || forceActif);
    const arme = armes.armeEnMain();
    const a = estMelee(arme) ? null : STATS[arme];
    const info = vehicule.actif();
    // Le fusil à lunette ne vise pas pendant le rechargement : l'arme reste visible et le champ normal
    // (sinon, clic droit tenu, l'arme disparaissait sans lunette ni animation de rechargement).
    const vise = viseMaintenu && peutAgir() && !!a && !(a.zoom !== null && armes.rechargeEnCours()) && !enKillcam() && !pilote();
    if (pilote()) {
      // titan : simulé en local, le joueur est à ses pieds (l'œil est à OEIL_TITAN)
      const avantDash = titan.etat()?.dash ?? 0, avantSol = titan.etat()?.auSol ?? true;
      titan.maj(dt, actif ? { avant: en.avant, droite: en.droite, lacet, dash: dashDemande, saut: sautDemande } : { avant: 0, droite: 0, lacet }, monde);
      dashDemande = false;
      const te = titan.etat();
      if (te) {
        // dash : souffle ; saut : pas lourd (l'atterrissage écrase : le serveur annonce l'explosion)
        if ((te.dash ?? 0) > avantDash + 1e-3) sons.coup(false);
        if (avantSol && te.auSol === false && (te.vy ?? 0) > 0) sons.pasLourd();
        moi.p = [te.p[0], te.p[1], te.p[2]];
        moi.v = [-Math.sin(te.cap) * te.v, 0, -Math.cos(te.cap) * te.v];
        moi.auSol = true;
      }
    } else if (info) {
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
        // vitesse du monde : axe de la caisse + glissade latérale (dérapage)
        const vl = ve.vl ?? 0;
        moi.v = [-Math.sin(ve.cap) * ve.v + Math.cos(ve.cap) * vl, 0, -Math.cos(ve.cap) * ve.v - Math.sin(ve.cap) * vl];
        moi.auSol = true;
      }
      const choc = vehicule.choc();
      if (choc > CHOC_SEUIL && t - dernierChocT > 0.3) { dernierChocT = t; sons.choc(borne(choc / 12, 0, 1)); }
    } else if (apparu) {
      const entreesUtiles: Entrees = actif ? en : { avant: 0, droite: 0, saut: false, sprint: false, accroupi: false, lacet };
      const mult = vitesseArme(arme) * (vise ? 0.8 : 1);
      const obstacles = modeZ ? corpsTigres.maj(mz.zombies(), mz.nombre(), moi.p[0], moi.p[2], PORTEE_CORPS_TIGRES_M) : undefined;
      moi = etape(moi, entreesUtiles, dt, monde, mult, obstacles);
    }
    sautDemande = false;

    // --- tir (boucle bornée : les armes rapides tirent plus d'une fois par image) ---
    if (actif) {
      // le canon du titan tire en continu tant que le bouton est tenu
      const auto = pilote() || a === null ? true : a.auto;
      // arme blanche : maintenue elle enchaîne les coups, mais un clic bref (ou donné juste avant la fin de la cadence, 0,85 s à l'épée)
      // est mémorisé 0,12 s comme pour une arme semi-automatique, sinon il se perd entre deux images
      const tampon = !pilote() && a === null;
      const veutTirer = auto ? tirMaintenu || (tampon && !tirConsomme && tirPresse > t - 0.12) : !tirConsomme && tirPresse > t - 0.12;
      let n = 0;
      while (veutTirer && n < TIRS_PAR_IMAGE_MAX && tirer()) {
        n++;
        if (tampon) tirConsomme = true;
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
    const vh = info || pilote() ? 0 : vitesseH();
    if (apparu && vivant && !info && moi.auSol && vh > 1.5 && !moi.glisse) {
      distPas += vh * dt;
      if (distPas > FOULEE_M) { distPas = 0; sons.pas(); }
    } else distPas = 0;
    const surMur = apparu && vivant && !!moi.mur && !info;
    if (surMur !== murActif) { murActif = surMur; sons.mur(surMur); }
    const glisse = apparu && vivant && !!moi.glisse && !info;
    if (glisse !== glisseSon) { glisseSon = glisse; sons.glisse(glisse); }
    const ve = vehicule.etat();
    const roule = !!info && !!ve && vivant && !enReplay;
    sons.moteur(roule ? Math.abs(ve!.v) : null);
    sons.derapage(roule ? vehicule.derapage() : 0);

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
      const dv = directionVisee(lacet, tangage, kick);
      const imp = tracer(monde, o, dv, a.portee, cibles(), client.id ?? "");
      const tg = tracerTigres(o, dv, imp.distance, mondeTigres.cibles(tigresVus, client.id));
      const dist = tg ? tg.distance : imp.distance;
      distanceVisee = dist < a.portee - 0.01 ? Math.round(dist) : -1;
    } else distanceVisee = -1;

    // --- joueurs distants, monde dynamique et effets ---
    majDistants(dt);
    majMondeDynamique(dt);
    majTigres(dt);
    majVoix();
    majMonstres(dt);
    majZombies(dt);
    effets.maj(dt);

    porteArme.visible = apparu && (vivant || enReplay) && !(info && tireInterdit()) && !pilote();
    armeMain.maj(dt, { vitesseH: vh, auSol: moi.auSol, vise: vise && !enReplay });

    remplirRadar(dt);
    post.rendre();

    // --- valeurs continues du HUD (60 Hz, hors React) ---
    live.recharge = armes.rechargeEnCours() ? Math.max(0.001, armes.rechargeProgression(ms())) : 0;
    live.vitesse = info && ve ? Math.abs(ve.v) : vh;
    live.vitesseKmh = info ? vehicule.vitesseKmh() : 0;
    live.regenDelai = !vivant || pv >= pvMaxMoi() ? 1 : borne((t - dernierDegatT) / regenDelaiS(), 0, 1);
    live.reanimation = reanimCible !== null ? borne((t - reanimDebutT) / ZOMBIES.reanimationS, 0, 1) : 0;
    accHud += dt;
    if (accHud >= ECART_HUD_S) { accHud = 0; emettreHud(); }
  }
  raf = requestAnimationFrame(frame);

  client.envoyer({ t: "rejoindre", ...choixEquipement() });
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
    monstres() {
      const ti = monstresImage.titan, tg = monstresImage.tigre, enCours = jm.titan();
      return {
        evenement: jm.evenement(),
        tigre: tg ? { pv: tg.pv, pvMax: tg.pvMax, rage: !!tg.rage } : null,
        titan: ti && enCours ? {
          pilote: ti.pilote, pv: ti.pv, pvMax: ti.pvMax, finT: enCours.finT,
          dash: 1 - Math.min(1, (titan.etat()?.recharge ?? 0) / (TITAN.dash.rechargeMs / 1000)),
          vitesse: Math.abs(ti.v), altitude: ti.p[1], cap: ti.pilote === client.id ? lacet : ti.cap,
        } : null,
      };
    },
    zombies() {
      return {
        argent: argentZ, manche: partieZ?.manche ?? 0, restants: mz.restants(), vivants: mz.vivants(), gain: gainZ, refus: refusZ, achats: achatsZ,
        reanimation: reanimCible !== null ? { cible: reanimCible, progression: borne((t - reanimDebutT) / ZOMBIES.reanimationS, 0, 1) } : null,
        aTerre: aTerreZ, elimine: elimineZ, terreFinT: terreFinTZ, partie: partieZ,
        pvMax: pvMaxMoi(), note: noteZ, annonce: annonceZ, serveurT: client.maintenantServeur(),
        objectif: partieZ ? objectifZombies(partieZ, papUtilise) : "",
        reparation: reparFenetre,
        grenades: stockGrenades("frag"), remontoirs: stockGrenades("remontoir"), cuisson: grenades?.cuisson(t * 1000) ?? null,
      };
    },
    lancerFrappe(cible) { lancerFrappe(cible); },
    lancerFumigene() { lancerFumigene(); },
    monterBus() { monterBus(); },
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
      sons.avion(null);
      sons.dispose();
      voix.dispose();
      terminerKillcam();
      visib.vider();
      suiviRadar.vider();
      for (const id of [...distants.keys()]) retirerAvatar(id);
      reanimCible = null; // `quitter` est déjà parti : rien à annoncer au serveur
      dyn.dispose();
      renduTigres.dispose();
      feux.dispose();
      rm.dispose();
      rz?.dispose();
      rInterieurs?.dispose();
      rObjets?.dispose();
      rGrenades?.dispose();
      grenades?.vider();
      truckZ?.dispose();
      impactsBalles.dispose();
      tracesPneus.dispose();
      debris.dispose();
      destruction.dispose();
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
          mode: modeZ ? "zombies" : "arene", argent: argentZ, manche: partieZ?.manche ?? 0, restants: mz.restants(), aTerre: aTerreZ, elimine: elimineZ,
          zombies: modeZ ? mz.zombies().slice(0, mz.nombre()).map((v) => ({ id: v.id, x: v.x, z: v.z, type: v.type, griffe: v.griffe, mode: v.mode, cap: v.cap })) : [],
          rugissements: rz ? { pret: rz.pret(), affiches: rz.affiches(), ragdolls: rz.ragdollsActifs() } : null,
          // (v8) grenades en poche et en vol
          grenades: grenades ? {
            frag: stockGrenades("frag"), remontoirs: stockGrenades("remontoir"), cuisson: grenades.cuisson(t * 1000),
            vol: grenades.affichees(client.maintenantServeur()).map((g) => ({ id: g.id, genre: g.genre, p: g.p, posee: g.posee })),
          } : null,
          distants: [...etats.entries()].filter(([id]) => id !== client.id).map(([id, e]) => ({
            id, p: e.p, vivant: e.vivant, protege: e.protege, arme: e.arme, accroupi: !!e.accroupi, glisse: !!e.glisse, vehicule: e.vehicule ?? null,
            pseudoAlpha: visib.alpha(id),
          })),
        };
      },
      teleporter(p) { moi = etatInitial(p); },
      regarder(l, tg) { lacet = l; tangage = borne(tg, -TANGAGE_MAX, TANGAGE_MAX); },
      tirerVers(id) {
        if (!peutAgir()) return false;
        const o = oeil();
        // tigres échantillonnés à l'instant du tir, comme un joueur à 60 images par seconde. Sous un rendu lent (tests sans GPU), ceux
        // de la dernière image dateraient de plusieurs centaines de ms : un tigre qui court serait visé hors de la fenêtre de
        // compensation du serveur (`REWIND_MAX_MS`), et tous les tirs rejetés
        tigresVus = mondeTigres.tigresA(client.maintenantServeur() - JEU.interpolationMs);
        // tigre : centre de la tête de sa silhouette de touche (pose courante)
        const tg = tigresVus.get(id);
        if (tg) {
          const h = hitboxTigre(tg);
          const r = anglesVers(h.c[0] - o[0], h.c[1] - o[1], h.c[2] - o[2]);
          lacet = r.lacet;
          tangage = r.tangage;
          kick = 0;
          // tir en lunette, comme un joueur qui vise : le sniper sans lunette se disperse depuis la v3 (`dispersionTir`)
          const vise = viseMaintenu;
          viseMaintenu = true;
          const parti = tirer(true);
          viseMaintenu = vise;
          return parti;
        }
        const e = etats.get(id);
        if (!e) return false;
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
          traces: tracesPneus.nombre(),
          sieges: [...vehiculesAffichees().keys()].map((id) => ({ id, sieges: [...mondeJeu.siegesDe(id)] })),
          elsa: mondeJeu.elsa(),
          invite: mondeJeu.invite(moi.p, assisSiege(), ts),
          radar: { joueurs: radarFrame.nJoueurs, pnj: radarFrame.nPnj, voitures: radarFrame.nVoitures, echos: radarFrame.nEchos },
          monstres: monstresImage, evenement: jm.evenement(), titan: jm.titan(), pilote: pilote(),
        };
      },
      tigres(mesures = false) {
        const ts = client.maintenantServeur();
        // avec les mesures du GLB : les tigres de l'image dessinée (`tirerVers` a pu rééchantillonner `tigresVus` depuis)
        return {
          tigres: [...(mesures ? tigresDessines : tigresVus).values()].map((tg) => {
            const h = hitboxTigre(tg);
            return {
              id: tg.id, genre: tg.genre, lanceur: tg.lanceur ?? null, p: tg.p, cap: tg.cap, etat: tg.etat, pose: tg.pose, pv: tg.pv,
              action: tg.action ?? null, v: tg.v, centre: [(h.a[0] + h.b[0]) / 2, (h.a[1] + h.b[1]) / 2, (h.a[2] + h.b[2]) / 2],
              hitbox: h, rendu: mesures ? renduTigres.mesures(tg.id) : null,
            };
          }),
          avion: mondeTigres.avionA(ts),
          charge: mondeTigres.aCharge(),
          modele: renduTigres.modeleCharge(),
        };
      },
      invoquer() { forceActif = true; return invoquer(); },
      tuerZombie(id, o = {}) {
        // (zombies) mort jouée côté client seulement, comme à la réception de `zombieMort` : le serveur garde le tigre (captures du ragdoll)
        // `o.p` : un tigre d'essai qui court là (cap `o.cap`, type `o.type`), sans tigre du serveur
        const v = o.p ? null : mz.parId(id);
        if ((!v && !o.p) || !rz || (o.p && !rz.pret())) return false;
        mortZombie({
          t: "zombieMort", id: `z${id}`, p: v ? [v.x, 0, v.z] : o.p!, par: client.id ?? "", zone: o.zone ?? "corps", ...(o.cause ? { cause: o.cause } : {}),
          ...(o.arme ? { arme: o.arme } : {}), ...(o.ameliore ? { ameliore: true as const } : {}), src: o.src ?? [camPos[0], camPos[1], camPos[2]],
        }, o.p ? { cap: o.cap ?? 0, type: o.type ?? 0 } : undefined);
        return true;
      },
    },
  };
}
