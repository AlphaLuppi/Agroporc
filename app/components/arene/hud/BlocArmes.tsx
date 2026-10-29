"use client";

import { memo, type RefObject } from "react";
import { MELEE, STATS, nomAffiche, nomCourtZombie } from "@/lib/fps/armes";
import { formatNombre, niveauMunitions, parseSlots } from "@/lib/fps/hud-modele";
import { estMelee, type ArmeId, type Slot } from "@/lib/fps/protocole";
import { GRENADES, INVENTAIRE_GRENADES } from "@/lib/fps/grenades";
import Chargeur, { libelleBonusVitesse } from "./Chargeur";
import styles from "../HudArene.module.css";

/**
 * Bloc armes (bas-droite, §5.1) : nom de l'arme en main, munitions fixes (`Chargeur`), rack de slots `> [1] FUSIL 23/30`, `[2] PISTOLET 12/12`,
 * `[3] COUTEAU VITESSE +30 %` (ou `[3] ÉPÉE VITESSE +20 %`), `[4] RAILGUN 4` (étiquette « SPÉCIALE », présent seulement s'il est porté). Les noms courts restent complets en
 * permanence ; l'actif porte un cadre ambre et `aria-current="true"` ; pendant le dégainage (350 ms) la ligne du slot se remplit.
 * Conducteur : bloc lisible mais en `--ag-ink-dim`, avec la ligne « TIR IMPOSSIBLE ». Scalaires uniquement.
 * (v8, zombies) Sous le rack : `[G] GRENADES ●●○○` (4 au plus, la mèche qui court pendant la cuisson) et `[B] REMONTOIR ×n` s'il en reste.
 * (v8, zombies) Arme passée au Micro-ondes (Pack-a-Punch, `ameliorees`) : son NOUVEAU nom (« Moutarde & Sally »), en magenta « gratiné »
 * (`--ag-gratin`) avec l'icône du Micro-ondes et un liseré qui ondule ; dans le rack, son nom court amélioré (« MOUTARDE ») et le même
 * liseré ; texte réservé aux lecteurs d'écran « améliorée au Micro-ondes ». Paire akimbo : une ligne `G 6 · D 6` (chargeur de chaque main).
 */
export interface PropsBlocArmes {
  arme: ArmeId;
  slot: Slot;
  /** chaîne `HudEtat.slots` */
  slots: string;
  munitions: number;
  chargeur: number;
  reserve: number;
  recharge: boolean;
  degainage: boolean;
  /** conducteur : l'arme est indisponible */
  tireInterdit: boolean;
  bonusVitesse: number;
  /** touche réellement assignée à chaque slot (« 1 », « 2 »…), vide si aucune */
  toucheP: string;
  toucheS: string;
  toucheC: string;
  toucheSp: string;
  refBarre: RefObject<HTMLDivElement | null>;
  refTemps: RefObject<HTMLSpanElement | null>;
  /** (v8, zombies) grenades et tigres à remontoir en poche ; absents en arène (aucune ligne) */
  grenades?: number;
  remontoirs?: number;
  /** grenade en cuisson : part de la mèche écoulée 0..1 (null sinon) */
  cuisson?: number | null;
  toucheGrenade?: string;
  toucheRemontoir?: string;
  /** (v8, zombies) armes améliorées jointes par « | » (`HudEtat.ameliorees`), absent ou "" = aucune */
  ameliorees?: string;
  /** (v8, zombies) munitions de la main gauche d'une paire akimbo, −1 ou absent = arme seule */
  munitionsG?: number;
}

/** Icône du Micro-ondes (Pack-a-Punch) : la porte vitrée, le cadran, des ondes de chaleur. Décorative. */
function IconeGratin({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 16" width="24" height="16" aria-hidden="true" focusable="false">
      <rect x="1" y="2" width="22" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3.5" y="4.5" width="12" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="19" cy="6.5" r="1.4" fill="currentColor" />
      <path d="M7 1.2c1-1 0-1.2 1-2M11 1.2c1-1 0-1.2 1-2" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M17.5 10.5h3M17.5 12.5h3" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

/** Grenades au plus (BO1) et mèche (s) : pour les pastilles et le décompte de la cuisson. */
const GRENADES_MAX = INVENTAIRE_GRENADES.fragMax;
const MECHE_S = GRENADES.frag.mecheMs / 1000;
const pastilles = (n: number) => "●".repeat(Math.max(0, Math.min(GRENADES_MAX, n))) + "○".repeat(Math.max(0, GRENADES_MAX - n));

const LIBELLE_SLOT: Record<Slot, string> = { principale: "Principale", secondaire: "Secondaire", couteau: "Arme blanche", speciale: "Spéciale" };

function BlocArmesBrut(p: PropsBlocArmes) {
  const slots = parseSlots(p.slots);
  const touches: Record<Slot, string> = { principale: p.toucheP, secondaire: p.toucheS, couteau: p.toucheC, speciale: p.toucheSp };
  const couteau = estMelee(p.arme);
  const ameliorees = p.ameliorees ? p.ameliorees.split("|") : [];
  const gratinee = !couteau && ameliorees.includes(p.arme);
  const munG = p.munitionsG ?? -1;
  return (
    <section className={`${styles.plaque} ${styles.armes}`} data-indisponible={p.tireInterdit ? "oui" : "non"} aria-label="Armes et munitions">
      <p className={styles.armeNom} data-ameliore={gratinee ? "oui" : undefined}>
        {gratinee && <IconeGratin className={styles.iconeGratin} />}
        {nomAffiche(p.arme, ameliorees)}
        {gratinee && <span className={styles.srSeul}> (améliorée au Micro-ondes)</span>}
      </p>
      {munG >= 0 && (
        <p className={styles.paireAkimbo}>
          <span>G {formatNombre(munG)}</span><span aria-hidden="true"> · </span><span>D {formatNombre(Math.max(0, p.munitions - munG))}</span>
          <span className={styles.srSeul}> (main gauche, main droite)</span>
        </p>
      )}
      {p.tireInterdit ? (
        <p className={styles.tirImpossible}>TIR IMPOSSIBLE</p>
      ) : null}
      <Chargeur
        munitions={p.munitions}
        chargeur={p.chargeur}
        reserve={p.reserve}
        sansRecharge={!estMelee(p.arme) && STATS[p.arme].sansRecharge}
        recharge={p.recharge}
        rechargeS={estMelee(p.arme) ? 0 : STATS[p.arme].rechargeS}
        couteau={couteau}
        bonusVitesse={p.bonusVitesse}
        refBarre={p.refBarre}
        refTemps={p.refTemps}
      />
      <ul className={styles.rack} aria-label="Équipement">
        {slots.map((s) => {
          const actif = s.slot === p.slot;
          const amel = !estMelee(s.arme) && ameliorees.includes(s.arme);
          const nomCourt = estMelee(s.arme) ? MELEE[s.arme].nomCourt : nomCourtZombie(s.arme, amel);
          const niveau = s.slot === "couteau" ? "normal" : niveauMunitions(s.munitions, s.chargeur);
          return (
            <li
              key={s.slot}
              className={`${styles.slot} ${actif ? styles.slotActif : ""}`}
              aria-current={actif ? "true" : undefined}
              data-degainage={actif && p.degainage ? "oui" : "non"}
              data-niveau={niveau}
              data-ameliore={amel ? "oui" : undefined}
            >
              <span className={styles.slotTouche}>{touches[s.slot] ? `[${touches[s.slot]}]` : ""}</span>
              <span className={styles.slotNom}>
                {nomCourt.toUpperCase()}
                {s.slot === "speciale" && <em> SPÉCIALE</em>}
                {amel && <span className={styles.srSeul}> (améliorée)</span>}
                <span className={styles.srSeul}> ({LIBELLE_SLOT[s.slot]})</span>
              </span>
              <span className={styles.slotMun}>
                {s.slot === "couteau"
                  ? `VITESSE ${libelleBonusVitesse(estMelee(s.arme) ? MELEE[s.arme].vitesse : 1)}`
                  : s.slot === "speciale"
                    ? formatNombre(s.munitions)
                    : `${formatNombre(s.munitions)}/${formatNombre(s.chargeur)}`}
              </span>
            </li>
          );
        })}
      </ul>
      {p.grenades !== undefined && (
        <ul className={styles.rack} aria-label="Grenades">
          <li className={styles.slot} data-niveau={p.cuisson != null ? "critique" : p.grenades === 0 ? "vide" : "normal"}>
            <span className={styles.slotTouche}>{p.toucheGrenade ? `[${p.toucheGrenade}]` : ""}</span>
            <span className={styles.slotNom}>{p.cuisson != null ? "MÈCHE" : "GRENADES"}</span>
            <span className={styles.slotMun}>
              {p.cuisson != null
                ? `${Math.max(0, MECHE_S * (1 - p.cuisson)).toFixed(1).replace(".", ",")} s`
                : <><span aria-hidden="true" className={styles.pastilles}>{pastilles(p.grenades)}</span><span className={styles.srSeul}>{p.grenades} sur {GRENADES_MAX}</span></>}
            </span>
          </li>
          {(p.remontoirs ?? 0) > 0 && (
            <li className={styles.slot} data-niveau="normal">
              <span className={styles.slotTouche}>{p.toucheRemontoir ? `[${p.toucheRemontoir}]` : ""}</span>
              <span className={styles.slotNom}>REMONTOIR<span className={styles.srSeul}> (tigre à remontoir)</span></span>
              <span className={styles.slotMun}>×{p.remontoirs}</span>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

const BlocArmes = memo(BlocArmesBrut);
export default BlocArmes;
