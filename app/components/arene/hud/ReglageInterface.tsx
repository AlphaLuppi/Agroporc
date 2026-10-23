"use client";

import { useId, type ReactNode } from "react";
import {
  ECHELLES_HUD, RAYONS_MINIMAP, TAILLES_MINIMAP, orientationEffective, type EchelleHud, type EffetsHud, type OrientationMinimap,
  type RayonMinimap, type ReglagesHud, type TailleMinimap,
} from "@/lib/fps/reglages-hud";
import SelecteurCoin from "./SelecteurCoin";
import { useMouvementReduit } from "./useMouvementReduit";
import styles from "./ReglageInterface.module.css";

/**
 * Section « Interface » du menu pause et du lobby (§5.9) : mini-map (coin, taille, orientation, rayon), taille de l'interface, effets.
 * Au-dessus de `ReglageTouches`. Effet immédiat (l'hôte garde les réglages et les mémorise). `replie` (lobby) : section repliable,
 * fermée au départ ; sinon toujours ouverte (menu pause). Radios natives (flèches du clavier), cibles de 40 px.
 * Spec : docs/superpowers/specs/2026-10-23-arene-hud-design.md
 */
export interface PropsReglageInterface {
  reglages: ReglagesHud;
  surReglages(r: ReglagesHud): void;
  /** repliable (lobby) */
  replie?: boolean;
}

interface Choix<T> { valeur: T; libelle: string }

const NBSP = " ";
const TAILLES: Choix<TailleMinimap>[] = TAILLES_MINIMAP.map((t) => ({ valeur: t, libelle: t.toUpperCase() }));
const ORIENTATIONS: Choix<OrientationMinimap>[] = [
  { valeur: "regard", libelle: "Suit ma vue" },
  { valeur: "nord", libelle: "Nord en haut" },
];
const RAYONS: Choix<RayonMinimap>[] = RAYONS_MINIMAP.map((r) => ({ valeur: r, libelle: `${r}${NBSP}m` }));
const ECHELLES: Choix<EchelleHud>[] = ECHELLES_HUD.map((e) => ({ valeur: e, libelle: `${Math.round(e * 100)}${NBSP}%` }));
const EFFETS: Choix<EffetsHud>[] = [
  { valeur: "auto", libelle: "Auto" },
  { valeur: "reduits", libelle: "Réduits" },
];

/** Groupe de radios natives présentées en segments. */
function Segments<T extends string | number>({ legende, nom, choix, courant, surChoix }: {
  legende: string; nom: string; choix: readonly Choix<T>[]; courant: T; surChoix(v: T): void;
}) {
  return (
    <fieldset className={styles.bloc}>
      <legend>{legende}</legend>
      <div className={styles.segments}>
        {choix.map((c) => (
          <label key={String(c.valeur)} className={styles.segment}>
            <input type="radio" name={nom} value={String(c.valeur)} checked={courant === c.valeur} onChange={() => surChoix(c.valeur)} />
            <span>{c.libelle}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function ReglageInterface({ reglages, surReglages, replie }: PropsReglageInterface) {
  const id = useId();
  const mouvementReduit = useMouvementReduit();
  const m = reglages.minimap;
  const ifc = reglages.interface;
  const orientation = orientationEffective(m, mouvementReduit);
  const majMinimap = (patch: Partial<Omit<typeof m, "v">>) => surReglages({ ...reglages, minimap: { ...m, ...patch } });
  const majInterface = (patch: Partial<Omit<typeof ifc, "v">>) => surReglages({ ...reglages, interface: { ...ifc, ...patch } });

  const corps: ReactNode = (
    <div className={styles.corps}>
      <p className={styles.aide}>Le changement est immédiat. Grande carte : maintenir la touche de la carte (M par défaut).</p>
      <div className={styles.mini}>
        <SelecteurCoin coin={m.coin} surChange={(coin) => majMinimap({ coin })} idGroupe={`${id}-iface`} />
        <div className={styles.reglagesMini}>
          <Segments legende="Taille de la mini-carte" nom={`${id}-taille`} choix={TAILLES} courant={m.taille} surChoix={(taille) => majMinimap({ taille })} />
          <Segments legende="Orientation" nom={`${id}-orientation`} choix={ORIENTATIONS} courant={orientation} surChoix={(o) => majMinimap({ orientation: o })} />
          <Segments legende="Rayon" nom={`${id}-rayon`} choix={RAYONS} courant={m.rayon} surChoix={(rayon) => majMinimap({ rayon })} />
        </div>
      </div>
      <div className={styles.ligne}>
        <Segments legende="Taille de l'interface" nom={`${id}-echelle`} choix={ECHELLES} courant={ifc.echelle} surChoix={(echelle) => majInterface({ echelle })} />
        <Segments legende="Effets" nom={`${id}-effets`} choix={EFFETS} courant={ifc.effets} surChoix={(effets) => majInterface({ effets })} />
      </div>
    </div>
  );

  if (replie) {
    return (
      <details className={styles.interface}>
        <summary>Interface</summary>
        {corps}
      </details>
    );
  }
  return (
    <section className={styles.interface} aria-labelledby={`${id}-titre`}>
      <h3 id={`${id}-titre`} className={styles.titre}>Interface</h3>
      {corps}
    </section>
  );
}
