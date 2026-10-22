"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CLE_PSEUDO, PSEUDO_MAX, type LigneClassement } from "@/lib/tigre-scores";
import styles from "./Agroparc3D.module.css";

/** Message d'échec commun : réseau, base indisponible, limite de débit. */
export const CLASSEMENT_INDISPONIBLE = "Classement indisponible pour le moment";

function lirePseudo(): string {
  try { return localStorage.getItem(CLE_PSEUDO) ?? ""; } catch { return ""; }
}

/**
 * Bouton « Enregistrer mon score » puis formulaire pseudo (prérempli avec le dernier pseudo).
 * Échap dans le champ ferme le formulaire, pas la vue.
 */
export function EnregistrerScore({ score, tigres, surEnregistre, surEchec }: {
  score: number;
  tigres: number;
  surEnregistre(rang: number): void;
  surEchec(): void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [pseudo, setPseudo] = useState("");
  const [website, setWebsite] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const boutonRef = useRef<HTMLButtonElement>(null);

  const ouvrir = () => { setPseudo(lirePseudo()); setOuvert(true); };
  const fermer = () => {
    setOuvert(false);
    // Le focus revient sur le bouton qui a ouvert le formulaire (rendu au tour suivant).
    requestAnimationFrame(() => boutonRef.current?.focus());
  };

  async function envoyer(e: FormEvent) {
    e.preventDefault();
    const p = pseudo.trim();
    if (!p || envoi) return;
    setEnvoi(true);
    try {
      const r = await fetch("/api/tigre-scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pseudo: p, score, tigres, website }),
      });
      const corps = (await r.json().catch(() => null)) as { ok?: boolean; rang?: number } | null;
      if (!r.ok || !corps?.ok || typeof corps.rang !== "number") throw new Error(String(r.status));
      try { localStorage.setItem(CLE_PSEUDO, p); } catch { /* stockage indisponible : pseudo non retenu */ }
      setOuvert(false);
      surEnregistre(corps.rang);
    } catch {
      surEchec();
    } finally {
      setEnvoi(false);
    }
  }

  if (!ouvert) {
    return <button ref={boutonRef} type="button" className={styles.action} onClick={ouvrir}>Enregistrer mon score</button>;
  }
  return (
    <form className={styles.pseudoForm} onSubmit={envoyer}>
      <label htmlFor="palantir-pseudo">Pseudo</label>
      <input
        id="palantir-pseudo"
        type="text"
        value={pseudo}
        onChange={(e) => setPseudo(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          fermer();
        }}
        maxLength={PSEUDO_MAX}
        autoComplete="nickname"
        autoFocus
        required
      />
      {/* Champ caché anti-robots (honeypot), comme le formulaire de commentaires. */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        autoComplete="off"
        tabIndex={-1}
        aria-hidden="true"
        className={styles.piege}
      />
      <button type="submit" className={styles.action} disabled={envoi || !pseudo.trim()}>{envoi ? "Envoi…" : "Valider"}</button>
      <button type="button" className={styles.close} onClick={fermer}>Annuler</button>
    </form>
  );
}

const fmtJour = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

/** Panneau des 10 meilleurs scores, rechargé à chaque ouverture et après un enregistrement (`version`). */
export function PanneauClassement({ version, surFermer }: { version: number; surFermer(): void }) {
  // undefined = chargement, null = indisponible
  const [lignes, setLignes] = useState<LigneClassement[] | null | undefined>(undefined);

  useEffect(() => {
    let annule = false;
    setLignes(undefined);
    fetch("/api/tigre-scores")
      .then((r) => (r.ok ? (r.json() as Promise<{ scores: LigneClassement[] }>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (!annule) setLignes(d.scores); })
      .catch(() => { if (!annule) setLignes(null); });
    return () => { annule = true; };
  }, [version]);

  return (
    <aside className={`${styles.panel} ${styles.classement}`} aria-label="Classement de la chasse au tigre">
      <p className={`${styles.eyebrow} ${styles.panelHead}`}>
        <span>Chasse au tigre</span>
        <button type="button" className={styles.close} onClick={surFermer}>Fermer</button>
      </p>
      <h2>Classement</h2>
      {lignes === undefined && <p className={`${styles.empty} ${styles.carteEtat}`}>Chargement du classement…</p>}
      {lignes === null && <p className={`${styles.empty} ${styles.carteEtat}`}>{CLASSEMENT_INDISPONIBLE}.</p>}
      {lignes && lignes.length === 0 && <p className={`${styles.empty} ${styles.carteEtat}`}>Aucun score enregistré.</p>}
      {lignes && lignes.length > 0 && (
        <table className={styles.tableScores}>
          <thead>
            <tr><th scope="col">#</th><th scope="col">Pseudo</th><th scope="col">Score</th><th scope="col">Tigres</th><th scope="col">Date</th></tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={`${l.rang}-${l.date}`}>
                <td>{l.rang}</td>
                <td className={styles.pseudo}>{l.pseudo}</td>
                <td><b>{l.score}</b></td>
                <td>{l.tigres}</td>
                <td>{fmtJour(l.date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </aside>
  );
}
