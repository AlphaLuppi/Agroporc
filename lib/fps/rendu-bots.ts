/**
 * Rendu des bots du Battle Royale : un TIGRE BIPÈDE ARMÉ (three, WebGL). Implémente `AvatarJoueur` (`rendu.ts`) : `jeu.ts` en crée un par id `b<n>`
 * (`estIdBot`) à la place du fil de fer humanoïde, sans toucher aux autres sites d'appel (pseudos, tirs, touches, killcam).
 *
 * Un POOL de tigres complets (clones du GLB du thème Tigre : `chargerModele` / `creerTigre`, jamais `libererModele`, copie privée de la
 * géométrie et de la texture pour que three ne garde pas le renderer, donc le contexte WebGL, après la sortie de l'arène) est partagé entre
 * les bots : `POOL_COMPLETS` (12) emplacements aux bots les plus proches (`attribuerEmplacements`, hystérésis), créés `CREATIONS_PAR_IMAGE` (2) par
 * image ; les autres bots, et tous tant que le GLB n'est pas prêt (ou s'il ne charge pas), gardent l'avatar fil de fer de `creerAvatar`.
 * Pose : `bot-tigre-anim.ts` (moteur du corps du tigre, couche « debout armé »), recalculée selon la distance (chaque image sous 40 m, une sur
 * deux sous 80 m, une sur quatre au-delà : `animerCetteImage`). L'arme (`creerArmeBot`, arêtes de 2 px) est posée dans le groupe du bot (non mise à
 * l'échelle, hors des os) à la poignée calculée par l'animation ; les pattes avant la tiennent par cinématique inverse.
 * Mort : ragdoll du squelette (`ragdoll-tigre.ts`, au plus `RAGDOLL.actifsMax` éveillés), sinon chute rigide en arrière ; le cadavre reste
 * `DUREE_CADAVRE_S`, puis l'emplacement est rendu. Parachute : `creerParachute`, bras levés, jambes pendantes.
 * Aucun test vitest (three, WebGL) : la logique est dans `bot-tigre-anim.ts` (pure, testée), les régressions se voient aux captures
 * (`scripts/fps/captures_bots.mjs`).
 * Spec : docs/superpowers/specs/2026-10-29-pause-parties-bots-design.md (§1.5)
 */
import * as THREE from "three";
import { chargerModele, creerTigre, type ModeleTigre, type Tigre } from "../tigre3d/modele";
import { creerMonde, squelette } from "../tigre3d/squelette";
import {
  ECHELLE_ARME_BOT, ECHELLE_BOT, attribuerEmplacements, avancerBot, creerCorpsBot, dirVersGroupe, origineXBot, versRepereGroupe,
  type ArmeBot, type BotAnim, type CandidatEmplacement,
} from "./bot-tigre-anim";
import { animerCetteImage } from "./jeu-zombies";
import type { ArmeId, EtatJoueurSnap, Vec3 } from "./protocole";
import { creerRagdoll, impulsionMort, osDeLaPose, ragdollPermis, type CollisionsRagdoll, type Ragdoll } from "./ragdoll-tigre";
import { creerArmeBot, creerAvatar, sansHalo, texturePseudo, type ArmeBotRendu, type AvatarJoueur, type CouleurEntree } from "./rendu";
import { creerParachute, type ParachuteFilDeFer } from "./rendu-avion";
import { STATS } from "./armes";
import { hauteurPlaquePx } from "./visibilite";

/**
 * Tigres complets simultanés (au-delà, fil de fer). Mesure en navigateur (`captures_bots.mjs`, 12 bots qui marchent et tirent, rendu logiciel) :
 * ≈ 0,7 ms de CPU par image pour les bots avec 6 tigres, ≈ 1,1 ms avec 12 (budget : 3 ms) : le pool est de 12, au plus à 110 m de la caméra.
 */
export const POOL_COMPLETS = 12;
/** Clones créés par image (étale le coût du chargement). */
export const CREATIONS_PAR_IMAGE = 2;
/** Un cadavre reste à l'écran cette durée (s), la dernière seconde à s'enfoncer. */
export const DUREE_CADAVRE_S = 4;
/** Hauteur de la plaque du pseudo (m) : tête de la silhouette de touche (2,0) + 0,5. */
export const Y_PLAQUE_BOT = 2.5;
/** Suffixe de l'affichage d'un bot (jamais dans le pseudo du serveur, qui sert de clé). */
export const SUFFIXE_BOT = " [BOT]";
/** Période de la réattribution des emplacements (s). */
const PERIODE_ARBITRAGE_S = 0.25;
/** Hauteur d'attache du parachute au-dessus des pieds (m) : au-dessus des pattes levées. */
const ATTACHE_PARACHUTE_BOT = 2.1;
/** Durée de l'éclat blanc d'un tir reçu (s). */
const ECLAT_S = 0.14;
const BLANC = new THREE.Color(0xffffff);

export interface OptionsFabriqueBots {
  /** emplacements de tigres complets (défaut `POOL_COMPLETS`) */
  poolMax?: number;
  /** position de la caméra (monde) : sert à choisir les bots proches et au LOD d'animation */
  positionCamera?: () => readonly [number, number, number];
  /** sol, tables et murs du monde pour le ragdoll (absent : chute rigide) */
  collisions?: CollisionsRagdoll | null;
}

interface Emplacement {
  tigre: Tigre;
  maillages: THREE.SkinnedMesh[];
  materiau: THREE.MeshBasicMaterial;
  proprietaire: AvatarBotInterne | null;
}

/** Ce que la fabrique sait d'un avatar de bot (arbitrage des emplacements). */
interface AvatarBotInterne {
  id: string | null;
  distance: number;
  mort: boolean;
  slot: Emplacement | null;
  ragdoll: Ragdoll | null;
  prendre(e: Emplacement): void;
  rendre(): void;
}

const _bouche = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _vx = new THREE.Vector3(), _vy = new THREE.Vector3(), _vz = new THREE.Vector3();

export class FabriqueBots {
  private modele: ModeleTigre | null = null;
  private echec = false;
  private detruite = false;
  private readonly slots: Emplacement[] = [];
  private carte: THREE.Texture | null = null;
  private readonly geos = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  private readonly aLiberer: { dispose(): void }[] = [];
  private readonly avatars = new Set<AvatarBotInterne>();
  private tArbitrage = 0;
  private aArbitrer = true;
  private collisions: CollisionsRagdoll | null;
  private poolMax: number;
  private readonly positionCamera: (() => readonly [number, number, number]) | null;
  private readonly osMort = creerMonde(squelette());
  /** groupe racine des tigres complets : un seul parent pour les emplacements libres */
  private readonly reserve = new THREE.Group();

  /**
   * `renderer` n'est pas utilisé aujourd'hui (les arêtes épaisses règlent leur résolution seules) : il garde la signature de la spec pour un
   * réglage futur (pixel ratio). `chargeur` est `chargerModele`, injectable.
   */
  constructor(_renderer: unknown = null, chargeur: () => Promise<ModeleTigre> = chargerModele, opts: OptionsFabriqueBots = {}) {
    this.poolMax = opts.poolMax ?? POOL_COMPLETS;
    this.positionCamera = opts.positionCamera ?? null;
    this.collisions = opts.collisions ?? null;
    this.reserve.name = "bots-reserve";
    chargeur().then((m) => {
      if (this.detruite) return;
      this.modele = m;
      // UNE copie privée de la texture, partagée par les matériaux des emplacements
      const origine = m.maillages[0]?.material as THREE.MeshBasicMaterial | undefined;
      if (origine?.map) { this.carte = origine.map.clone(); this.carte.needsUpdate = true; this.aLiberer.push(this.carte); }
    }).catch(() => { this.echec = true; });
  }

  /** Sol, tables et murs du monde pour les ragdolls (le monde peut ne pas exister encore à la création de la fabrique). */
  definirCollisions(c: CollisionsRagdoll | null): void { this.collisions = c; }

  /** (essais) change la taille du pool : la mesure en navigateur compare 6 et 12 tigres complets au budget de 3 ms par image. */
  definirPoolMax(n: number): void { this.poolMax = Math.max(0, Math.floor(n)); this.aArbitrer = true; }

  /** Le modèle est chargé et le pool est complet (essais, captures). */
  pret(): boolean { return this.modele !== null && this.slots.length >= this.poolMax; }
  /** Tigres complets en service / créés (essais : budget du pool). */
  emplacements(): { crees: number; occupes: number; max: number } {
    return { crees: this.slots.length, occupes: this.slots.filter((s) => s.proprietaire).length, max: this.poolMax };
  }

  /** Avatar d'un bot : fil de fer tant qu'il n'a pas d'emplacement, tigre bipède armé ensuite. */
  creerAvatarBot(couleur: number, pseudo: string): AvatarJoueur {
    return creerAvatarBot(this, couleur, pseudo.endsWith(SUFFIXE_BOT) ? pseudo : pseudo + SUFFIXE_BOT);
  }

  // ---- interne : appelé par les avatars ----
  /** @internal */ enregistrer(a: AvatarBotInterne): void { this.avatars.add(a); this.aArbitrer = true; }
  /** @internal */ oublier(a: AvatarBotInterne): void { a.rendre(); this.avatars.delete(a); this.aArbitrer = true; }
  /** @internal */ get modeleCharge(): ModeleTigre | null { return this.modele; }
  /** @internal */ get tigresPossibles(): boolean { return this.modele !== null && !this.echec && !this.detruite; }
  /** @internal */ distanceA(p: readonly number[]): number {
    const c = this.positionCamera?.();
    return c ? Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) : 0;
  }
  /** @internal */ get collisionsRagdoll(): CollisionsRagdoll | null { return this.collisions; }
  /** @internal */ get monde() { return this.osMort; }
  /** @internal un ragdoll de plus peut-il être lancé (plafond des ragdolls éveillés) ? */
  ragdollAutorise(): boolean {
    return ragdollPermis([...this.avatars].map((a) => a.ragdoll));
  }
  /** @internal */ get parent(): THREE.Group { return this.reserve; }

  /**
   * Travail de l'image, fait par le premier avatar enregistré : crée au plus `CREATIONS_PAR_IMAGE` emplacements, et réattribue les emplacements
   * toutes les `PERIODE_ARBITRAGE_S` (ou dès qu'un avatar arrive ou part).
   * @internal
   */
  travailler(maitre: AvatarBotInterne, dt: number): void {
    if (this.detruite || this.avatars.values().next().value !== maitre) return;
    if (this.modele && !this.echec) {
      for (let k = 0; k < CREATIONS_PAR_IMAGE && this.slots.length < this.poolMax; k++) { this.creerEmplacement(this.modele); this.aArbitrer = true; }
    }
    this.tArbitrage += dt;
    if (!this.aArbitrer && this.tArbitrage < PERIODE_ARBITRAGE_S) return;
    this.tArbitrage = 0;
    this.aArbitrer = false;
    this.arbitrer();
  }

  private arbitrer(): void {
    if (this.slots.length === 0) return;
    // un mort garde son emplacement jusqu'à la fin de son cadavre : il n'entre pas dans l'attribution
    const vivants: AvatarBotInterne[] = [];
    let tenusParMorts = 0;
    for (const a of this.avatars) {
      if (a.mort) { if (a.slot) tenusParMorts++; } else if (a.id) vivants.push(a);
    }
    const candidats: CandidatEmplacement[] = vivants.map((a) => ({ id: a.id!, distance: a.distance, actuel: a.slot !== null }));
    const gagnants = attribuerEmplacements(candidats, this.slots.length - tenusParMorts);
    for (const a of vivants) if (a.slot && !gagnants.has(a.id!)) a.rendre();
    for (const a of vivants) {
      if (a.slot || !gagnants.has(a.id!)) continue;
      const libre = this.slots.find((s) => s.proprietaire === null);
      if (libre) a.prendre(libre);
    }
  }

  /** @internal */ teinter(e: Emplacement, couleur: THREE.Color): void { e.materiau.color.copy(couleur); }

  private geometriePrivee(orig: THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.geos.get(orig);
    if (!g) {
      g = orig.clone();
      // la main humaine du thème Tigre n'a rien à faire ici : ni cibles de déformation, ni attribut dédié
      g.morphAttributes = {};
      g.morphTargetsRelative = false;
      if (g.getAttribute("mainHumaine")) g.deleteAttribute("mainHumaine");
      this.geos.set(orig, g);
      this.aLiberer.push(g);
    }
    return g;
  }

  private creerEmplacement(m: ModeleTigre): void {
    const tigre = creerTigre(m);
    const maillages: THREE.SkinnedMesh[] = [];
    tigre.groupe.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) maillages.push(o as THREE.SkinnedMesh); });
    // un matériau par emplacement : la teinte du joueur et l'éclat des tirs reçus lui sont propres
    const materiau = new THREE.MeshBasicMaterial({ color: 0xffffff });
    if (this.carte) materiau.map = this.carte;
    sansHalo(materiau);
    for (const mesh of maillages) {
      mesh.geometry = this.geometriePrivee(mesh.geometry);
      mesh.material = materiau;
      if (mesh.morphTargetInfluences?.length) mesh.morphTargetInfluences[0] = 0;
      mesh.frustumCulled = false;
    }
    tigre.ombre.visible = false;
    tigre.groupe.scale.setScalar(ECHELLE_BOT);
    tigre.groupe.visible = false;
    this.reserve.add(tigre.groupe);
    this.slots.push({ tigre, maillages, materiau, proprietaire: null });
  }

  dispose(): void {
    this.detruite = true;
    for (const a of [...this.avatars]) a.rendre();
    this.avatars.clear();
    for (const s of this.slots) {
      for (const mesh of s.maillages) mesh.skeleton.dispose();
      s.tigre.groupe.removeFromParent();
      s.tigre.dispose();
      s.materiau.dispose();
    }
    this.slots.length = 0;
    for (const x of this.aLiberer) x.dispose();
    this.aLiberer.length = 0;
    this.reserve.removeFromParent();
  }
}

function borne(x: number, a = 0, b = 1): number { return Math.min(b, Math.max(a, x)); }

/** Avatar d'un bot (voir l'en-tête). `fab` crée les emplacements et choisit qui en a un. */
function creerAvatarBot(fab: FabriqueBots, couleurEntree: CouleurEntree, pseudo: string): AvatarJoueur {
  const couleur = new THREE.Color(couleurEntree);
  const teinte = couleur.clone().lerp(BLANC, 0.55);
  const filDeFer = creerAvatar(couleurEntree, pseudo);
  const racine = new THREE.Group();
  racine.add(filDeFer.group);
  // le tigre complet : groupe non mis à l'échelle (mètres du monde) orienté comme le corps ; le clone du pool y est ajouté tant qu'il en a un
  const holder = new THREE.Group();
  holder.visible = false;
  racine.add(holder);

  // plaque du pseudo du tigre (la plaque du fil de fer est dans son propre groupe, caché quand le tigre est là)
  const { tex, ratio } = texturePseudo(pseudo, couleur);
  const matPseudo = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true, toneMapped: false });
  const plaque = new THREE.Sprite(matPseudo);
  plaque.position.y = Y_PLAQUE_BOT;
  plaque.renderOrder = 10;
  plaque.frustumCulled = false;
  const _pw = new THREE.Vector3(), _pc = new THREE.Vector3();
  let alphaPseudo = 1, distancePseudo = 0, pilote = false;
  plaque.onBeforeRender = (renderer, _scene, camera) => {
    const cam = camera as THREE.PerspectiveCamera;
    plaque.getWorldPosition(_pw);
    _pc.setFromMatrixPosition(cam.matrixWorld);
    const d = Math.max(_pw.distanceTo(_pc), 0.5);
    const hPx = (renderer.domElement as HTMLCanvasElement).clientHeight || 800;
    const h = (hauteurPlaquePx(pilote ? distancePseudo : d) / hPx) * 2 * d * Math.tan(((cam.fov || 90) * Math.PI) / 360);
    plaque.scale.set(h * ratio, h, 1);
    plaque.updateMatrixWorld();
  };
  holder.add(plaque);

  const anim: BotAnim = creerCorpsBot(1);
  const armes = new Map<ArmeId, ArmeBotRendu>();
  let arme: ArmeBotRendu | null = null;
  let idArme: ArmeId | null = null;
  let parachute: ParachuteFilDeFer | null = null;
  let t = 0, image = 0, dtAcc = 0, eclat = 0, tirEnAttente = false, rechargePrec = false;
  let ageMort = 0, mortDebut = false, posePoseeMort = false;
  let phase = 0;
  /** cadavre fini : plus rien n'est dessiné tant que le snap garde ce bot mort */
  let cadavreFini = false;

  const interne: AvatarBotInterne = {
    id: null, distance: 0, mort: false, slot: null, ragdoll: null,
    prendre(e) {
      this.slot = e;
      e.proprietaire = interne;
      e.tigre.groupe.visible = true;
      holder.add(e.tigre.groupe);
      fab.teinter(e, teinte);
      holder.visible = true;
      filDeFer.group.visible = false;
      // le moteur reprend où le bot en est : le corps est recalculé au premier maj
      dtAcc = 0.05;
    },
    rendre() {
      const e = this.slot;
      if (!e) return;
      e.proprietaire = null;
      e.tigre.groupe.visible = false;
      fab.parent.add(e.tigre.groupe);
      this.slot = null;
      this.ragdoll = null;
      holder.visible = false;
      filDeFer.group.visible = true;
      if (arme) arme.group.visible = false;
    },
  };

  /** Arme en main (créée à la demande, une seule visible). */
  function choisirArme(id: ArmeId): void {
    if (arme) arme.group.visible = false;
    let m = armes.get(id);
    if (!m) {
      try { m = creerArmeBot(id, couleurEntree); } catch { m = undefined; }
      if (m) { m.group.scale.setScalar(ECHELLE_ARME_BOT); holder.add(m.group); armes.set(id, m); }
    }
    arme = m ?? null;
    idArme = id;
  }
  const armeBot = (): ArmeBot | null => (arme ? { prise: arme.prise, garde: arme.garde, deuxMains: arme.deuxMains } : null);

  /** Pose le modèle de l'arme à la prise calculée par l'animation. */
  function poserArme(): void {
    const pr = anim.prise;
    if (!arme || !pr) return;
    const o = versRepereGroupe(pr.origine);
    arme.group.position.set(o[0], o[1], o[2]);
    const x = dirVersGroupe(pr.base.x), y = dirVersGroupe(pr.base.y), z = dirVersGroupe(pr.base.z);
    _m4.makeBasis(_vx.set(x[0], x[1], x[2]), _vy.set(y[0], y[1], y[2]), _vz.set(z[0], z[1], z[2]));
    arme.group.quaternion.setFromRotationMatrix(_m4);
  }

  /** Début de la mort du tigre : ragdoll à partir de la pose affichée si le plafond le permet, sinon chute rigide. */
  function commencerMort(etat: EtatJoueurSnap): void {
    mortDebut = true;
    ageMort = 0;
    posePoseeMort = false;
    interne.mort = true;
    if (arme) arme.group.visible = false;
    const c = fab.collisionsRagdoll;
    if (!c || !fab.ragdollAutorise()) return;
    const sq = squelette();
    const id = Number(String(interne.id).replace(/\D/g, "")) || 1;
    // le coup est supposé venir de l'avant du bot (la direction réelle n'est pas dans le snap)
    const avant: [number, number] = [-Math.sin(anim.cap), -Math.cos(anim.cap)];
    const src: [number, number, number] = [etat.p[0] + avant[0] * 5, 1.4, etat.p[2] + avant[1] * 5];
    const r = creerRagdoll(sq, osDeLaPose(sq, anim.corps.pose, fab.monde), { x: etat.p[0], z: etat.p[2], cap: anim.cap, echelle: ECHELLE_BOT, origineX: origineXBot(anim.corps.x) }, c, {
      vitesse: [etat.v[0] * 0.5, 0, etat.v[2] * 0.5], graine: id,
    });
    r.impulsion(impulsionMort({ cause: "corps", p: [etat.p[0], 0, etat.p[2]], graine: id }, src));
    interne.ragdoll = r;
  }

  function majMort(etat: EtatJoueurSnap, dt: number): void {
    const e = interne.slot!;
    if (!mortDebut) commencerMort(etat);
    const r = interne.ragdoll;
    if (r) {
      const enfonce = Math.max(0, ageMort - (DUREE_CADAVRE_S - 1)) * 0.9;
      holder.position.set(r.repere.x, -enfonce, r.repere.z);
      holder.rotation.set(0, r.repere.cap + Math.PI / 2, 0);
      const dormait = r.endormi();
      const simule = r.pas(dt);
      ageMort += dormait ? dt : simule;
      if (!dormait || !posePoseeMort) { e.tigre.appliquer(r.pose(), r.repere.origineX); posePoseeMort = dormait; }
    } else {
      ageMort += dt;
      const k = borne(ageMort / 0.45);
      const enfonce = Math.max(0, ageMort - (DUREE_CADAVRE_S - 1)) * 0.9;
      holder.position.set(etat.p[0], etat.p[1] - enfonce - 0.1 * k, etat.p[2]);
      holder.rotation.set(0, anim.cap + Math.PI / 2, 1.45 * (1 - (1 - k) * (1 - k)));
    }
    if (ageMort >= DUREE_CADAVRE_S) { cadavreFini = true; interne.mort = false; interne.rendre(); holder.visible = false; filDeFer.group.visible = false; }
  }

  function majTigre(etat: EtatJoueurSnap, dt: number): void {
    const e = interne.slot!;
    if (etat.arme !== idArme) choisirArme(etat.arme);
    holder.position.set(etat.p[0], etat.p[1], etat.p[2]);
    holder.rotation.set(0, anim.cap + Math.PI / 2, 0);
    if (arme) arme.group.visible = true;
    dtAcc += dt;
    if (!anim.initialise || animerCetteImage(interne.distance, image, phase)) {
      avancerBot(anim, {
        vitesse: [etat.v[0], etat.v[2]], lacet: etat.lacet, tangage: etat.tangage, tir: tirEnAttente, recharge: !!etat.recharge, posture: etat.posture,
        chute: etat.chute, arme: armeBot(), dtS: dtAcc,
      });
      tirEnAttente = false;
      dtAcc = 0;
      e.tigre.appliquer(anim.corps.pose, origineXBot(anim.corps.x));
      holder.rotation.y = anim.cap + Math.PI / 2;
    }
    if (arme) {
      if (!!etat.recharge && !rechargePrec) arme.recharger((STATS as Record<string, { rechargeS: number } | undefined>)[etat.arme]?.rechargeS ?? 1.5);
      rechargePrec = !!etat.recharge;
      arme.maj(dt);
      poserArme();
    }
    // teinte, éclat des tirs reçus
    if (eclat > 0) { eclat = Math.max(0, eclat - dt); fab.teinter(e, eclat > 0 ? BLANC : teinte); if (eclat === 0) fab.teinter(e, teinte); }
    // parachute au-dessus de la tête, seulement sous voile
    if (etat.chute === "voile") {
      if (!parachute) { parachute = creerParachute(ATTACHE_PARACHUTE_BOT); holder.add(parachute.groupe); }
      parachute.groupe.visible = true;
      parachute.balancer(t, phase * 0.7);
    } else if (parachute) parachute.groupe.visible = false;
    plaque.visible = alphaPseudo > 0.01;
  }

  return {
    group: racine,
    tirer() { tirEnAttente = true; arme?.tirer(); filDeFer.tirer(); },
    coup() { filDeFer.coup(); },
    toucher() { eclat = ECLAT_S; filDeFer.toucher(); },
    afficherPseudo(alpha, distance) {
      pilote = true;
      alphaPseudo = borne(alpha);
      distancePseudo = Math.max(distance, 0);
      matPseudo.opacity = alphaPseudo;
      filDeFer.afficherPseudo(alpha, distance);
    },
    positionBouche() {
      if (!interne.slot || !arme) return filDeFer.positionBouche();
      arme.group.updateWorldMatrix(true, false);
      _bouche.copy(arme.bouche);
      arme.group.localToWorld(_bouche);
      return [_bouche.x, _bouche.y, _bouche.z];
    },
    maj(etat, dt) {
      dt = borne(dt, 0, 0.1);
      t += dt;
      image++;
      if (interne.id === null) {
        interne.id = etat.id;
        phase = Number(etat.id.replace(/\D/g, "")) || 0;
        fab.enregistrer(interne);
      }
      interne.distance = fab.distanceA(etat.p);
      const mort = !etat.vivant || etat.posture === "mort";
      if (!mort) { cadavreFini = false; if (interne.mort) { interne.mort = false; mortDebut = false; } }
      if (cadavreFini) return;
      if (mort && !interne.slot && !interne.mort) interne.mort = true; // le fil de fer gère sa mort lui-même
      fab.travailler(interne, dt);
      if (interne.slot) {
        holder.visible = true;
        filDeFer.group.visible = false;
        if (mort) majMort(etat, dt); else majTigre(etat, dt);
        // le fil de fer n'est plus dessiné mais garde ses états de mort/éclat à jour à bas coût
      } else {
        holder.visible = false;
        filDeFer.group.visible = true;
        filDeFer.maj(etat, dt);
      }
    },
    dispose() {
      fab.oublier(interne);
      parachute?.dispose();
      for (const a of armes.values()) a.dispose();
      armes.clear();
      filDeFer.dispose();
      matPseudo.dispose();
      tex.dispose();
      racine.removeFromParent();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Crochet de développement : `window.__arene.avatarBot(id, opts)`
// ---------------------------------------------------------------------------------------------

/** Un bot local posé dans la scène du jeu (captures, mesure du coût CPU) : il n'existe que dans ce navigateur, le serveur n'en sait rien. */
export interface OptionsBotLocal {
  p?: Vec3;
  lacet?: number;
  tangage?: number;
  arme?: ArmeId;
  /** vitesse horizontale (m/s) : le bot avance de cette vitesse à chaque image */
  vitesse?: [number, number];
  recharge?: boolean;
  /** un tir toutes les `tirToutesLesS` secondes (0 ou absent : aucun) */
  tirToutesLesS?: number;
  vivant?: boolean;
  chute?: "libre" | "voile";
  couleur?: number;
  pseudo?: string;
  /** taille du pool de tigres complets de la fabrique (essais : 12 par défaut) */
  poolMax?: number;
}

interface BotLocal { avatar: AvatarJoueur; etat: EtatJoueurSnap; opts: OptionsBotLocal; tirT: number }

/**
 * Installe `window.__arene.avatarBot(id, opts | null)` (hors production) : pose, met à jour (fusion des options) ou retire (`null`) un bot local ;
 * sans argument, rend le bilan (`emplacements` du pool, coût CPU moyen des mises à jour des bots par image, ms). Les bots locaux sont mis à jour par
 * leur propre boucle `requestAnimationFrame`. Rend la fonction qui retire le crochet et les bots.
 */
export function installerCrochetBots(scene: THREE.Scene, fabrique: () => FabriqueBots): () => void {
  if (typeof window === "undefined") return () => {};
  const w = window as unknown as { __arene?: Record<string, unknown> };
  const locaux = new Map<string, BotLocal>();
  let raf = 0, dernier = 0, cpuTotal = 0, cpuImages = 0, fab: FabriqueBots | null = null;
  const boucle = (maintenant: number) => {
    raf = requestAnimationFrame(boucle);
    const dt = dernier ? Math.min(0.1, (maintenant - dernier) / 1000) : 0.016;
    dernier = maintenant;
    // le crochet de la page (`window.__arene`) est refait par un rechargement à chaud : on y remet le nôtre
    if (w.__arene && w.__arene.avatarBot !== crochet) w.__arene.avatarBot = crochet;
    if (locaux.size === 0) return;
    const t0 = performance.now();
    for (const b of locaux.values()) {
      const e = b.etat, o = b.opts;
      const v = o.vitesse ?? [0, 0];
      e.p = [e.p[0] + v[0] * dt, e.p[1], e.p[2] + v[1] * dt];
      e.v = [v[0], 0, v[1]];
      e.lacet = o.lacet ?? 0;
      e.tangage = o.tangage ?? 0;
      e.recharge = !!o.recharge;
      e.vivant = o.vivant !== false;
      e.posture = e.vivant ? "sol" : "mort";
      e.chute = o.chute;
      if (o.arme) e.arme = o.arme;
      if (o.tirToutesLesS && o.tirToutesLesS > 0) {
        b.tirT += dt;
        if (b.tirT >= o.tirToutesLesS) { b.tirT = 0; b.avatar.tirer(); }
      }
      b.avatar.maj(e, dt);
      b.avatar.afficherPseudo(1, 10);
    }
    cpuTotal += performance.now() - t0;
    cpuImages++;
  };
  let crochet: (id?: string, opts?: OptionsBotLocal | null) => unknown;
  raf = requestAnimationFrame(boucle);
  crochet = (id?: string, opts?: OptionsBotLocal | null) => {
    if (id === undefined) {
      return { bots: locaux.size, emplacements: fab?.emplacements() ?? null, pret: fab?.pret() ?? false, cpuMsParImage: cpuImages ? cpuTotal / cpuImages : 0, cpuTotalMs: cpuTotal, images: cpuImages };
    }
    if (opts === null) {
      const b = locaux.get(id);
      if (b) { scene.remove(b.avatar.group); b.avatar.dispose(); locaux.delete(id); }
      return null;
    }
    if (opts?.poolMax) (fab ??= fabrique()).definirPoolMax(opts.poolMax);
    let b = locaux.get(id);
    if (!b) {
      fab ??= fabrique();
      const avatar = fab.creerAvatarBot(opts?.couleur ?? 0x9be9ff, opts?.pseudo ?? `Bot${id}`);
      scene.add(avatar.group);
      const etat: EtatJoueurSnap = {
        id, p: opts?.p ?? [0, 0, 0], v: [0, 0, 0], lacet: 0, tangage: 0, posture: "sol", mur: 0, arme: opts?.arme ?? "fusil_assaut", pv: 100,
        vivant: true, protege: false,
      };
      b = { avatar, etat, opts: {}, tirT: 0 };
      locaux.set(id, b);
    }
    b.opts = { ...b.opts, ...opts };
    if (opts?.p) b.etat.p = [...opts.p];
    return null;
  };
  w.__arene = w.__arene ?? {};
  w.__arene.avatarBot = crochet;
  return () => {
    cancelAnimationFrame(raf);
    for (const b of locaux.values()) { scene.remove(b.avatar.group); b.avatar.dispose(); }
    locaux.clear();
    if (w.__arene?.avatarBot === crochet) delete w.__arene.avatarBot;
  };
}
