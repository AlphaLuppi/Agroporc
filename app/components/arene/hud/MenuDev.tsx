"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ModeSalle } from "@/lib/fps/protocole";
import { EVENEMENTS_ARENE, FREQUENCES, LIBELLES_EVENEMENTS, LIBELLES_FREQUENCES, type FrequenceEvenements, type IdEvenementArene, type ReglagesArene } from "@/lib/fps/reglages-arene";
import {
  BORNES_DEV, CHAMPS_DEV_PAR_MODE, MONTANTS_ARGENT_DEV, NOMS_BONUS_DEV, libelleMult, type ActionDev, type ReglesDev,
} from "@/lib/fps/regles-dev";
import { FileEnvoiDev, type MessageDev } from "@/lib/fps/regles-dev-envoi";
import { GENRES_BONUS } from "@/lib/fps/zombies-vagues";
import styles from "./MenuDev.module.css";

/**
 * Menu de développement (touche F9, `menuDev`) : règles de la partie modifiables EN DIRECT. Le serveur valide, borne, applique et annonce à toute la partie
 * (« Alice : gravité ×0,5 ») ; ce panneau n'est que la télécommande : il affiche l'état que le serveur a publié (`regles`, `evenements`), jamais ses propres
 * hypothèses. Réservé à l'hôte (tout joueur en jeu dans le hall partagé, `hote` = « * »). Les envois passent par une file (`FileEnvoiDev`) qui regroupe les
 * réglages rapprochés : le serveur refuse deux messages à moins de 300 ms. Arène : curseurs, cases, événements (cases, fréquence, « Lancer ») ; zombies :
 * curseurs, argent, courant, bonus, manche ; Battle Royale : curseurs et la police.
 */
export interface PropsMenuDev {
  mode: ModeSalle;
  monId: string | null;
  regles: ReglesDev;
  /** qui peut régler : « * » ou l'id de l'hôte ; "" tant que le serveur n'a pas répondu */
  hote: string;
  evenements: ReglagesArene | null;
  /** texte du dernier refus du serveur, vide sinon */
  refus: string;
  surReglesDev(msg?: MessageDev): void;
  /** referme le panneau et rend la souris au jeu */
  surFermer(): void;
}

/** Curseur : la valeur suit le doigt, le message part au relâchement (une rafale de `change` ne devient pas une rafale de messages). */
function Curseur(p: { nom: string; borne: { min: number; max: number; pas: number }; valeur: number; format: (v: number) => string; actif: boolean; surValider(v: number): void }) {
  const [v, setV] = useState(p.valeur);
  useEffect(() => setV(p.valeur), [p.valeur]);
  const valider = () => { if (v !== p.valeur) p.surValider(v); };
  return (
    <label className={styles.ligne}>
      <span>{p.nom} <b>{p.format(v)}</b></span>
      <input
        type="range" min={p.borne.min} max={p.borne.max} step={p.borne.pas} value={v} disabled={!p.actif}
        onChange={(e) => setV(Number(e.target.value))} onPointerUp={valider} onKeyUp={valider} onBlur={valider}
      />
    </label>
  );
}

export default function MenuDev(p: PropsMenuDev) {
  const { mode, regles, evenements } = p;
  const champs = CHAMPS_DEV_PAR_MODE[mode];
  const autorise = p.hote === "*" || (p.hote !== "" && p.hote === p.monId);
  const surReglesDev = useRef(p.surReglesDev);
  surReglesDev.current = p.surReglesDev;

  // file d'envoi : un message par intervalle du serveur, les réglages rapprochés fusionnés
  const file = useRef<FileEnvoiDev | null>(null);
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vider = useCallback(() => {
    minuteur.current = null;
    const f = file.current;
    if (!f) return;
    const m = f.suivant(Date.now());
    if (m) surReglesDev.current(m);
    const attente = f.attenteMs(Date.now());
    if (Number.isFinite(attente)) minuteur.current = setTimeout(vider, attente);
  }, []);
  const envoyer = useCallback((msg: MessageDev) => {
    (file.current ??= new FileEnvoiDev()).pousser(msg);
    if (minuteur.current === null) vider();
  }, [vider]);
  // à l'ouverture : l'état courant (et donc l'hôte) est redemandé ; à la fermeture : la file est abandonnée
  useEffect(() => {
    surReglesDev.current();
    return () => {
      if (minuteur.current !== null) clearTimeout(minuteur.current);
      minuteur.current = null;
      file.current?.vider();
    };
  }, []);

  const regle = (patch: Partial<ReglesDev>) => envoyer({ regles: patch });
  const action = (a: ActionDev) => envoyer({ action: a });
  // cases d'événements : brouillon local (deux clics rapprochés se cumulent), recalé sur l'état publié par le serveur à chaque réponse
  const publies: readonly IdEvenementArene[] = evenements?.evenements ?? [];
  const [evtActifs, setEvtActifs] = useState<readonly IdEvenementArene[]>(publies);
  useEffect(() => setEvtActifs(publies), [evenements]); // eslint-disable-line react-hooks/exhaustive-deps
  const bascule = (e: IdEvenementArene) => {
    const suite = EVENEMENTS_ARENE.filter((x) => (x === e ? !evtActifs.includes(x) : evtActifs.includes(x)));
    setEvtActifs(suite);
    envoyer({ evenements: { evenements: [...suite] } });
  };
  const a = (c: keyof ReglesDev) => champs.includes(c);
  const enSecondes = (v: number) => `${String(v / 1000).replace(".", ",")} s`;

  return (
    <div className={styles.fond} onClick={(e) => { if (e.target === e.currentTarget) p.surFermer(); }}>
      <div className={styles.panneau} role="group" aria-label="Règles en direct">
        <h2>Règles en direct</h2>
        <p className={styles.sous}>
          {autorise ? "Chaque changement est annoncé à toute la partie." : p.hote === "" ? "Chargement…" : "Réservé à l'hôte de la partie."}
        </p>
        {p.refus && <p className={styles.refus} role="alert">{p.refus}</p>}

        <fieldset className={styles.groupe} disabled={!autorise}>
          <legend>Règles</legend>
          {a("degats") && <Curseur nom="Dégâts" borne={BORNES_DEV.degats} valeur={regles.degats} format={libelleMult} actif={autorise} surValider={(v) => regle({ degats: v })} />}
          {a("vitesse") && <Curseur nom="Vitesse" borne={BORNES_DEV.vitesse} valeur={regles.vitesse} format={libelleMult} actif={autorise} surValider={(v) => regle({ vitesse: v })} />}
          {a("gravite") && <Curseur nom="Gravité" borne={BORNES_DEV.gravite} valeur={regles.gravite} format={libelleMult} actif={autorise} surValider={(v) => regle({ gravite: v })} />}
          {a("reapparitionMs") && <Curseur nom="Réapparition" borne={BORNES_DEV.reapparitionMs} valeur={regles.reapparitionMs} format={enSecondes} actif={autorise} surValider={(v) => regle({ reapparitionMs: v })} />}
          {a("munitionsInfinies") && (
            <label className={styles.case}>
              <input type="checkbox" checked={regles.munitionsInfinies} onChange={(e) => regle({ munitionsInfinies: e.target.checked })} />
              <span>Munitions infinies</span>
            </label>
          )}
          {a("regeneration") && (
            <label className={styles.case}>
              <input type="checkbox" checked={regles.regeneration} onChange={(e) => regle({ regeneration: e.target.checked })} />
              <span>Régénération des PV</span>
            </label>
          )}
        </fieldset>

        {mode === "arene" && (
          <fieldset className={styles.groupe} disabled={!autorise}>
            <legend>Événements</legend>
            {evenements === null ? <p className={styles.sous}>Réglages indisponibles sur ce serveur.</p> : (
              <>
                <ul className={styles.liste}>
                  {EVENEMENTS_ARENE.map((e) => (
                    <li key={e}>
                      <label className={styles.case}>
                        <input type="checkbox" checked={evtActifs.includes(e)} onChange={() => bascule(e)} />
                        <span>{LIBELLES_EVENEMENTS[e].nom}</span>
                      </label>
                      <button type="button" className={styles.petit} disabled={!evtActifs.includes(e)} onClick={() => action({ k: "forcer", evenement: e })}>Lancer</button>
                    </li>
                  ))}
                </ul>
                <div className={styles.choix} role="radiogroup" aria-label="Fréquence des événements">
                  {FREQUENCES.map((f: FrequenceEvenements) => (
                    <label key={f} className={styles.case}>
                      <input type="radio" name="dev-frequence" checked={evenements.frequence === f} onChange={() => envoyer({ evenements: { frequence: f } })} />
                      <span>{LIBELLES_FREQUENCES[f]}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </fieldset>
        )}

        {mode === "br" && (
          <fieldset className={styles.groupe} disabled={!autorise}>
            <legend>Événement</legend>
            <button type="button" className={styles.petit} onClick={() => action({ k: "forcer", evenement: "police" })}>Lancer la police</button>
          </fieldset>
        )}

        {mode === "zombies" && (
          <fieldset className={styles.groupe} disabled={!autorise}>
            <legend>Partie</legend>
            <div className={styles.boutons}>
              {MONTANTS_ARGENT_DEV.map((m) => (
                <button key={m} type="button" className={styles.petit} onClick={() => action({ k: "argent", montant: m })}>+{m.toLocaleString("fr-FR")} $</button>
              ))}
              <button type="button" className={styles.petit} onClick={() => action({ k: "courant" })}>Courant</button>
              <button type="button" className={styles.petit} onClick={() => action({ k: "passerManche" })}>Passer la manche</button>
            </div>
            <p className={styles.sous}>Bonus à vos pieds</p>
            <div className={styles.boutons}>
              {GENRES_BONUS.map((g) => (
                <button key={g} type="button" className={styles.petit} onClick={() => action({ k: "bonus", genre: g })}>{NOMS_BONUS_DEV[g]}</button>
              ))}
            </div>
          </fieldset>
        )}

        <div className={styles.pied}>
          <button type="button" className={styles.secondaire} disabled={!autorise} onClick={() => action({ k: "reinitialiser" })}>Réinitialiser</button>
          <button type="button" className={styles.principal} autoFocus onClick={p.surFermer}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
