/**
 * Contrôleur de la killcam côté client (PUR, ni three ni DOM) : tampons longs de joueurs, de voitures et d'événements (5 s), gelés
 * `KILLCAM.gelApresMortMs` après `mort`, machine `Killcam` ancrée sur `mort.ts`, caméra du tueur recalée sur ses tirs, joueurs tels que le
 * tueur les voyait (son ping + l'interpolation plus tôt), voitures rejouées et événements (tirs, coups, dégâts, morts) à rejouer à
 * l'instant où le tueur les a vécus (`vue-joueur.ts`). Appelé par `jeu.ts` (lot J1).
 *
 * Horloge : le contrôleur n'a pas d'horloge propre. Le délai de gel (150 ms après la RÉCEPTION de `mort`) se compte avec les `maj(dtS)`
 * reçus depuis `surMort`, comme la machine `Killcam` elle-même (J1 appelle `maj` à chaque image, y compris pendant la mort).
 * Le rejeu échantillonne le tampon long à `tempsRejeuServeur` (horodatage serveur, jamais l'horloge courante) : voir `killcam.ts`.
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§2.5, §5.20)
 */
import type { EtatJoueurSnap, InfoTueur, MessageServeur, VehiculeSnap, Vec3 } from "./protocole";
import {
  KILLCAM, avancerKillcam, cameraTueur, debutRejeu, demarrerKillcam, passerKillcam, progressionKillcam, tempsRejeuServeur, touchePasserPermise, tueurPresent,
  type Killcam, type PhaseKillcam,
} from "./killcam";
import { Interpolateur } from "./reseau";
import { InterpolateurVehicules } from "./interpolation-vehicules";
import { JournalEvenements, VueJoueur, type EvenementVue } from "./vue-joueur";

/** Comment le tueur voyait le monde : son ping (aller-retour, ms), l'interpolation de son client et l'écart entre deux snaps. */
export interface OptionsVueTueur { pingMs?: number; decalageMs?: number; largeurMs?: number }

export class ControleurKillcam {
  private readonly joueurs = new Interpolateur(KILLCAM.tamponMs);
  private readonly vehicules = new InterpolateurVehicules(KILLCAM.tamponMs);
  private readonly journal = new JournalEvenements(KILLCAM.tamponMs);
  private vue = new VueJoueur(50);
  private pingMs = 0;
  private decalageMs = 0;
  private k: Killcam | null = null;
  /** ms écoulées (somme des `maj`) depuis la réception de `mort` ; sert au gel du tampon */
  private depuisMortMs = 0;
  private gele = false;
  /** échantillons du tampon à l'instant rejoué, recalculés seulement quand quelque chose a bougé */
  private cacheEchantillon: Map<string, EtatJoueurSnap> | null = null;
  private cacheJoueurs: Map<string, EtatJoueurSnap> | null = null;
  private cacheVehicules: Map<number, VehiculeSnap> | null = null;
  private cacheJoueursFiges: Map<string, EtatJoueurSnap> | null = null;
  private cacheVehiculesFiges: Map<number, VehiculeSnap> | null = null;

  /** Alimente les tampons longs (joueurs + véhicules) ; sans effet une fois gelé (150 ms après `mort`). À appeler pour CHAQUE snap. */
  alimenter(ts: number, joueurs: readonly EtatJoueurSnap[], vehicules: readonly VehiculeSnap[] | undefined): void {
    if (this.gele || !Number.isFinite(ts)) return;
    this.joueurs.ajouter({ ts, j: joueurs.slice() });
    // `vehicules` absent du snap : aucune information, le tampon garde son dernier état (il n'est pas vidé)
    if (vehicules) this.vehicules.ajouter(ts, vehicules);
    this.invalider();
  }

  /** Tir, coup, dégâts ou mort (horodatés au serveur) : rejoués pendant la killcam ; sans effet une fois gelé. À appeler pour CHAQUE événement. */
  alimenterEvenement(e: EvenementVue): void {
    if (this.gele) return;
    this.journal.ajouter(e);
  }

  /**
   * Ma mort : démarre la machine avec `m.ts`, `m.tueur` ; programme le gel du tampon. Ne fait rien si ce n'est pas moi. `vue` : comment le
   * tueur voyait le monde (sans : aucun décalage, snaps à 20 Hz).
   */
  surMort(m: Extract<MessageServeur, { t: "mort" }>, moiId: string, vue: OptionsVueTueur = {}): void {
    if (m.cible !== moiId) return;
    const tueurId = m.par;
    // la présence se mesure au DÉBUT du rejeu : c'est le premier instant que le spectateur verra
    const debut = this.joueurs.echantillon(debutRejeu(m.ts));
    this.k = demarrerKillcam({ tueurId, tueur: m.tueur, tMortServeur: m.ts, tueurDansTampon: tueurPresent(debut, tueurId) });
    this.pingMs = vue.pingMs ?? 0;
    this.decalageMs = vue.decalageMs ?? 0;
    this.vue = new VueJoueur(vue.largeurMs ?? 50);
    // les événements d'avant le premier instant rejoué ne sont pas joués (pas de tir « fantôme » à la première image)
    this.vue.repartir(debutRejeu(m.ts));
    this.depuisMortMs = 0;
    this.gele = false;
    this.invalider();
  }

  maj(dtS: number): void {
    if (!this.k) return;
    const ms = Number.isFinite(dtS) && dtS > 0 ? dtS * 1000 : 0;
    this.k = avancerKillcam(this.k, dtS);
    if (!this.gele) {
      this.depuisMortMs += ms;
      if (this.depuisMortMs >= KILLCAM.gelApresMortMs) this.geler();
    }
    this.invalider();
  }

  /** Vrai de `surMort` à `terminer` : la carte du tueur reste affichée jusqu'à la réapparition (pas de trou si `apparition` tarde). */
  actif(): boolean {
    return this.k !== null;
  }

  /** "" hors killcam. Jamais "termine" : la carte reste la phase jusqu'à `terminer()`. Sans rejeu (repli), c'est "carte" dès le début (voir `avecRejeu`). */
  phase(): PhaseKillcam | "" {
    if (!this.k) return "";
    return this.k.phase === "termine" ? "carte" : this.k.phase;
  }

  /** Le rejeu à la première personne a lieu (tueur trouvé dans le tampon). Faux hors killcam et en repli. */
  avecRejeu(): boolean {
    return this.k?.avecRejeu ?? false;
  }

  /** La touche « passer » peut sauter le rejeu (pas pendant sa première seconde, cf. `touchePasserPermise`). */
  touchePasserPermise(): boolean {
    return !!this.k && touchePasserPermise(this.k);
  }

  /** saute le rejeu → carte */
  passer(): void {
    if (!this.k) return;
    this.k = passerKillcam(this.k);
    this.invalider();
  }

  /** −1 hors killcam, sinon 0..1 */
  progression(): number {
    return this.k ? progressionKillcam(this.k) : -1;
  }

  info(): InfoTueur | null {
    return this.k?.tueur ?? null;
  }

  tueurId(): string | null {
    return this.k && this.k.tueurId !== "" ? this.k.tueurId : null;
  }

  /** Horodatage serveur rejoué (pour les voitures PNJ aussi) ; null hors rejeu. */
  tempsServeur(): number | null {
    return this.k && this.k.phase === "rejeu" ? tempsRejeuServeur(this.k) : null;
  }

  /**
   * Caméra du tueur (œil via `oeilDe`, siège compris), recalée sur l'œil et l'axe EXACTS de ses tirs (la visée interpolée des snaps peut
   * être à plusieurs degrés d'un tir rapide) ; null hors rejeu ou repli.
   */
  camera(): { pos: Vec3; lacet: number; tangage: number } | null {
    if (!this.k || this.k.phase !== "rejeu") return null;
    if (!this.echantillonRejeu(tempsRejeuServeur(this.k)).has(this.k.tueurId)) return null;
    return this.vue.camera(this.joueurs, this.journal, this.k.tueurId, tempsRejeuServeur(this.k));
  }

  /** État du tueur à l'instant rejoué (arme en main, visée, recharge, vitesse) ; null hors rejeu ou s'il manque. */
  tueurRejoue(): EtatJoueurSnap | null {
    const t = this.tempsServeur();
    if (t === null || !this.k) return null;
    return this.echantillonRejeu(t).get(this.k.tueurId) ?? null;
  }

  /**
   * Événements que le tueur a vécus depuis l'image précédente du rejeu (ses tirs et coups à leur instant, le reste un aller-retour plus
   * tard), chacun une fois ; vide hors rejeu. « Passer » saute ceux du rejeu restant.
   */
  evenementsAJouer(): EvenementVue[] {
    const t = this.tempsServeur();
    if (t === null || !this.k) return [];
    return this.vue.aJouer(this.journal, this.k.tueurId, this.pingMs, t);
  }

  /**
   * Dernier point de vue du tueur, à `tMort`, pour la carte qui suit un rejeu (« caméra figée sur son dernier état », §2.5).
   * Ajout hors contrat : `camera()` reste nul hors rejeu. Null sans rejeu ni pendant le rejeu lui-même.
   */
  cameraFigee(): { pos: Vec3; lacet: number; tangage: number } | null {
    if (!this.k || !this.k.avecRejeu || this.k.phase === "rejeu") return null;
    const tueur = this.joueurs.echantillon(this.finRejeu()).get(this.k.tueurId);
    return tueur ? cameraTueur(tueur) : null;
  }

  /**
   * Joueurs rejoués à `tempsServeur()` (dont moi, SANS le tueur : on est dans sa tête), à l'instant où le TUEUR les voyait (son retard de
   * vue plus tôt : c'est sur eux qu'il visait). Vide hors rejeu. Ne pas modifier la Map.
   */
  joueursRejoues(): Map<string, EtatJoueurSnap> {
    const t = this.tempsServeur();
    if (t === null || !this.k) return new Map();
    if (!this.cacheJoueurs) this.cacheJoueurs = this.vue.autres(this.joueurs, this.k.tueurId, t, this.decalageMs);
    return this.cacheJoueurs;
  }

  /** Voitures conduisibles à `tempsServeur()` (dont celle que conduisait le tueur). Vide hors rejeu. Ne pas modifier la Map. */
  vehiculesRejoues(): Map<number, VehiculeSnap> {
    const t = this.tempsServeur();
    if (t === null) return new Map();
    if (!this.cacheVehicules) this.cacheVehicules = this.vehicules.echantillon(t);
    return this.cacheVehicules;
  }

  /** Vrai pendant la carte qui suit un rejeu : le monde reste figé à la dernière image du rejeu. */
  private figee(): boolean {
    return !!this.k && this.k.avecRejeu && this.k.phase !== "rejeu";
  }

  /** Horodatage serveur du monde figé de la carte (dernière image du rejeu) ; null hors carte-après-rejeu. */
  tempsFige(): number | null {
    return this.figee() ? this.finRejeu() : null;
  }

  private finRejeu(): number {
    return this.k ? debutRejeu(this.k.tMortServeur) + KILLCAM.rejeuMs : 0;
  }

  /**
   * Joueurs à la dernière image du rejeu, sans le tueur (comme `joueursRejoues`), pour la carte qui suit un rejeu : le monde ne disparaît pas
   * derrière la caméra figée. Vide hors carte-après-rejeu. Ne pas modifier la Map.
   */
  joueursFiges(): Map<string, EtatJoueurSnap> {
    const t = this.tempsFige();
    if (t === null || !this.k) return new Map();
    if (!this.cacheJoueursFiges) this.cacheJoueursFiges = this.vue.autres(this.joueurs, this.k.tueurId, t, this.decalageMs);
    return this.cacheJoueursFiges;
  }

  /** Voitures conduisibles à la dernière image du rejeu (carte après rejeu). Vide ailleurs. Ne pas modifier la Map. */
  vehiculesFiges(): Map<number, VehiculeSnap> {
    const t = this.tempsFige();
    if (t === null) return new Map();
    if (!this.cacheVehiculesFiges) this.cacheVehiculesFiges = this.vehicules.echantillon(t);
    return this.cacheVehiculesFiges;
  }

  /** `apparition`, changement d'id de client ou dispose : vide les tampons, dégèle. */
  terminer(): void {
    this.k = null;
    this.depuisMortMs = 0;
    this.gele = false;
    this.joueurs.vider();
    this.vehicules.vider();
    this.journal.vider();
    this.invalider();
  }

  private invalider(): void {
    this.cacheEchantillon = null;
    this.cacheJoueurs = null;
    this.cacheVehicules = null;
    this.cacheJoueursFiges = null;
    this.cacheVehiculesFiges = null;
  }

  /** Tampon long à l'instant rejoué, tueur compris (la caméra en a besoin). */
  private echantillonRejeu(t: number): Map<string, EtatJoueurSnap> {
    if (!this.cacheEchantillon) this.cacheEchantillon = this.joueurs.echantillon(t);
    return this.cacheEchantillon;
  }

  /**
   * Fin de la fenêtre de `gelApresMortMs` : plus aucun `ajouter`. Le tueur peut avoir quitté entre-temps ; l'`Interpolateur` retire les joueurs
   * absents du DERNIER snap, le rejeu n'aurait alors plus de sujet : on le rétrograde en repli (carte seule) plutôt que de caméra sur rien.
   */
  private geler(): void {
    this.gele = true;
    const k = this.k;
    if (k && k.avecRejeu && !tueurPresent(this.joueurs.echantillon(debutRejeu(k.tMortServeur)), k.tueurId)) {
      this.k = { ...k, avecRejeu: false, phase: k.ecouleMs >= KILLCAM.rejeuMs + KILLCAM.carteMs ? "termine" : "carte" };
    }
  }
}
