/**
 * Gel du client pendant une suspension de la partie de zombies (v11) : logique PURE, testée, que `jeu.ts` n'a plus qu'à brancher (la régression « les
 * tigres piétinent pendant la pause » doit être attrapée par vitest et non seulement par l'e2e en rendu logiciel).
 *
 * Le serveur fige son horloge virtuelle (`suspension.ts`) ; côté client, `HorlogeServeur.figer` (reseau.ts) fige `maintenantServeur()`, donc tout ce
 * qui est daté du serveur (tigres interpolés, projectiles, grenades en vol, Truck, cadran du secret, effets, comptes à rebours du HUD) s'arrête sans
 * rien changer. Reste ce qui avance au pas de l'image : `dt` du jeu (mis à 0, donc aussi son horloge locale `t` et toutes les cuissons de grenade, les
 * animations, la recharge), les états envoyés, les entrées du joueur.
 */

/** Message `zpause` (forme réduite, celle que le client mémorise). */
export interface ZpauseMessage { actif: boolean; par?: string; pseudo?: string; compte?: number }
/** Ce que `ClientArene.suspension()` rend : le dernier `zpause` actif de la salle, avec la fin du compte à rebours en horloge LOCALE. */
export interface SuspensionMemorisee { actif: boolean; par?: string; pseudo?: string; compteFinLocal: number | null }

export class GelPartie {
  private actif = false;
  private parId = "";
  private parPseudo = "";
  private compteFinLocal: number | null = null;

  /** vrai tant que la partie est suspendue (compte à rebours compris) */
  get gele(): boolean {
    return this.actif;
  }
  get par(): string {
    return this.parId;
  }
  get pseudo(): string {
    return this.parPseudo;
  }

  /** Un `zpause` du serveur reçu à l'instant local `localMs` (ms). */
  appliquer(m: ZpauseMessage, localMs: number): void {
    if (!m.actif) { this.reinitialiser(); return; }
    this.actif = true;
    this.parId = m.par ?? "";
    this.parPseudo = m.pseudo ?? "";
    this.compteFinLocal = m.compte !== undefined ? localMs + m.compte : null;
  }

  /** Le jeu est créé APRÈS un `zpause` (pause pendant le chargement 3D, ou entre le `bienvenue` et la création) : il se fige dès sa création. */
  depuisMemoire(s: SuspensionMemorisee | null | undefined): void {
    if (!s || !s.actif) { this.reinitialiser(); return; }
    this.actif = true;
    this.parId = s.par ?? "";
    this.parPseudo = s.pseudo ?? "";
    this.compteFinLocal = s.compteFinLocal;
  }

  /** `bienvenue` (nouvelle salle, reconnexion), `quitter`, `dispose` : jamais figé par erreur. */
  reinitialiser(): void {
    this.actif = false;
    this.parId = "";
    this.parPseudo = "";
    this.compteFinLocal = null;
  }

  /** Durée à faire avancer le jeu pour une image de `dt` secondes : nulle gelé. L'horloge locale du jeu (`t += dtEffectif(dt)`) et toutes les minuteries calées dessus (cuisson de grenade, recharge, animations) s'arrêtent d'elles-mêmes. */
  dtEffectif(dt: number): number {
    return this.actif ? 0 : dt;
  }

  /** Le joueur peut-il émettre un `etat` / `conduite` / `pilotage` ? Non : le serveur les jetterait, et un budget de distance ne doit pas se remplir de vide. */
  peutEmettreEtat(): boolean {
    return !this.actif;
  }

  /** Tir, recharge, changement d'arme, interaction (E), grenade, saut, mouvement : aucune action tant que c'est figé. */
  actionsAutorisees(): boolean {
    return !this.actif;
  }

  /** La souris ne tourne plus la vue (figée) ; le menu pause reste utilisable. */
  peutRegarder(): boolean {
    return !this.actif;
  }

  /** Secondes entières restantes du compte à rebours de reprise (arrondi au-dessus), 0 sans compte à rebours. */
  compteRestantS(localMs: number): number {
    if (!this.actif || this.compteFinLocal === null) return 0;
    return Math.max(0, Math.ceil((this.compteFinLocal - localMs) / 1000));
  }

  /** Un compte à rebours est-il en cours (le jeu est encore figé, les joueurs reprennent la souris) ? */
  enCompte(): boolean {
    return this.actif && this.compteFinLocal !== null;
  }

  /** Champs scalaires du HUD (`HudEtat`) : `suspendue`, `suspenduePar` (pseudo), `compteS`. */
  hud(localMs: number): { suspendue: boolean; suspenduePar: string; compteS: number } {
    return { suspendue: this.actif, suspenduePar: this.parPseudo, compteS: this.compteRestantS(localMs) };
  }
}

/**
 * La perte de la souris suspend-t-elle la partie toute seule (solo) ? Seulement pour un joueur seul admis (`admisCount` ≤ 1, comme le décide le serveur), en
 * partie (pause entre manches ou manche), ni avant la première prise de souris (« Prêt ? »), ni déjà figé, ni à la fin de partie, ni pendant la killcam ou
 * déconnecté. À plusieurs, Échap ne suspend jamais (un alt-tab ou un clic perdu gèlerait les autres) : il faut la demande explicite (bouton ou touche P).
 */
export function doitAutoSuspendre(e: {
  zombies: boolean; phase: string | null; admisCount: number; dejaVerrouille: boolean; gele: boolean; connecte: boolean; killcam: boolean;
}): boolean {
  if (!e.zombies || e.gele || !e.connecte || e.killcam || !e.dejaVerrouille) return false;
  if (e.phase !== "pause" && e.phase !== "manche") return false;
  return e.admisCount <= 1;
}

/** Texte du refus d'une pause (`refus{pause}`) ; `""` : rien à dire (la décision « plusieurs » est silencieuse, le menu habituel suffit). */
export function texteRefusPause(raison: string): string {
  switch (raison) {
    case "limite": return "Pause indisponible : limite atteinte";
    case "lobby": return "Pause indisponible : la partie n'est pas encore en cours";
    case "inconnu": return "Pause indisponible : vous n'êtes pas dans la partie";
    default: return "";
  }
}
