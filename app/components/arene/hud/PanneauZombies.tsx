"use client";

import { memo, useEffect, useState, type ReactElement } from "react";
import type { AtoutId, EffetsZombies } from "@/lib/fps/protocole";
import { ATOUTS } from "@/lib/fps/zombies-carte";
import { INTRO_ZOMBIES, noteLore } from "@/lib/fps/zombies-lore";
import styles from "../HudArene.module.css";

/**
 * HUD du mode zombies v7, façon Black Ops 1 : manche à la craie rouge (bâtons jusqu'à 5, puis chiffres), atouts bus (pastilles de la couleur
 * du distributeur, nom écrit), bonus à durée avec leur minuteur, objectif du lore, annonces (bonus ramassé, courant, livraison…), lecture
 * d'une note, texte d'introduction. Les couleurs des atouts viennent de leurs données (variable CSS), jamais d'une valeur en dur du module.
 * Spec : docs/superpowers/specs/2026-10-28-zombies-bo1-design.md (« Rendu et sons »)
 */

/** Bâtons de craie d'une manche de 1 à 5 (le cinquième barre les quatre premiers). */
function Batons({ n }: { n: number }) {
  const traits: ReactElement[] = [];
  for (let i = 0; i < Math.min(4, n); i++) {
    const x = 8 + i * 14;
    traits.push(<path key={i} d={`M${x} ${6 + (i % 2)} L${x + 2} ${58 - (i % 3)}`} />);
  }
  if (n >= 5) traits.push(<path key="barre" d="M2 44 L66 18" />);
  return (
    <svg viewBox="0 0 70 64" className={styles.craieBatons} aria-hidden="true">
      {traits}
    </svg>
  );
}

function MancheCraieBrute({ manche, truck }: { manche: number; truck: boolean }) {
  if (manche <= 0) return null;
  return (
    <section className={styles.mancheCraie} data-truck={truck ? "oui" : "non"} aria-label={`Manche ${manche}${truck ? ", livraison du Truck Muche" : ""}`}>
      {manche <= 5 ? <Batons n={manche} /> : <b className={styles.craieChiffre} aria-hidden="true">{manche}</b>}
    </section>
  );
}
export const MancheCraie = memo(MancheCraieBrute);

function AtoutsZombiesBrut({ atouts }: { atouts: readonly AtoutId[] }) {
  if (!atouts.length) return null;
  return (
    <ul className={styles.atouts} aria-label="Atouts">
      {atouts.map((a) => (
        <li key={a} style={{ ["--atout" as string]: ATOUTS[a].couleur }} title={`${ATOUTS[a].nom} : ${ATOUTS[a].description}`}>
          <i aria-hidden="true">{ATOUTS[a].nom.charAt(0)}</i>
          <span>{ATOUTS[a].nom}</span>
        </li>
      ))}
    </ul>
  );
}
export const AtoutsZombies = memo(AtoutsZombiesBrut);

const BONUS_A_DUREE: { cle: keyof EffetsZombies; nom: string }[] = [
  { cle: "instakillFinT", nom: "INSTA-KILL" },
  { cle: "doubleFinT", nom: "DOUBLE POINTS" },
  { cle: "soldesFinT", nom: "HAPPY HOUR" },
];

function BonusActifsBrut({ effets, maintenantServeur }: { effets: EffetsZombies; maintenantServeur(): number }) {
  const [, setTick] = useState(0);
  const actifs = BONUS_A_DUREE.filter((b) => effets[b.cle] > maintenantServeur());
  useEffect(() => {
    if (!actifs.length) return;
    const i = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(i);
  }, [actifs.length]);
  if (!actifs.length) return null;
  const now = maintenantServeur();
  return (
    <ul className={styles.bonusActifs} aria-label="Bonus actifs">
      {actifs.map((b) => {
        const s = Math.max(0, Math.ceil((effets[b.cle] - now) / 1000));
        return <li key={b.cle} data-fin={s <= 5 ? "oui" : "non"}><b>{b.nom}</b> <span>{s} s</span></li>;
      })}
    </ul>
  );
}
export const BonusActifs = memo(BonusActifsBrut);

function ObjectifZombiesBrut({ texte }: { texte: string }) {
  if (!texte) return null;
  return <p className={styles.objectifZ}><span>OBJECTIF</span> {texte}</p>;
}
export const ObjectifZombies = memo(ObjectifZombiesBrut);

function AnnonceZombiesBrute({ texte, genre }: { texte: string; genre: string }) {
  return <p className={styles.annonceZ} data-genre={genre} role="status">{texte}</p>;
}
export const AnnonceZombies = memo(AnnonceZombiesBrute);

function NoteZombiesBrute({ id, touche }: { id: number; touche: string }) {
  const n = noteLore(id);
  if (!n) return null;
  return (
    <section className={styles.noteZ} aria-label={n.titre}>
      <h3>{n.titre}</h3>
      <p className={styles.noteTexte}>{n.texte}</p>
      <p className={styles.noteAuteur}>{n.auteur}</p>
      <p className={styles.noteFermer}>[{touche || "E"}] fermer · s&apos;éloigner</p>
    </section>
  );
}
export const NoteZombies = memo(NoteZombiesBrute);

function IntroZombiesBrute() {
  return (
    <section className={styles.introZ} aria-label="Introduction">
      <p className={styles.introLieu}>{INTRO_ZOMBIES.lieu}</p>
      <p className={styles.introHeure}>{INTRO_ZOMBIES.heure}</p>
      <p className={styles.introTexte}>{INTRO_ZOMBIES.texte}</p>
    </section>
  );
}
export const IntroZombies = memo(IntroZombiesBrute);

/**
 * (v8) Courte « cinématique » du grand secret servi : bandes noires qui se referment puis se rouvrent, voile doré qui s'éteint, sans un mot
 * (`k` : avancée 0..1). Décorative : aucun texte, rien pour les lecteurs d'écran.
 */
function CinematiqueZombiesBrute({ k }: { k: number }) {
  const bandes = Math.min(1, k * 5, (1 - k) * 4);
  const voile = Math.max(0, 1 - k * 1.4);
  return (
    <div className={styles.cinemaZ} aria-hidden="true" style={{ ["--bandes" as string]: bandes.toFixed(3), ["--voile" as string]: voile.toFixed(3) }}>
      <span className={styles.cinemaVoile} />
      <span className={styles.cinemaHaut} />
      <span className={styles.cinemaBas} />
    </div>
  );
}
export const CinematiqueZombies = memo(CinematiqueZombiesBrute);
