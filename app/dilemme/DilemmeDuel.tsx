"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type Ref } from "react";
import RestoBadge from "../components/RestoBadge";
import SelecteurVotant, { GrilleVotants } from "../components/SelecteurVotant";
import { useVotant } from "../components/useVotant";
import ResultatsCote from "./ResultatsCote";
import VisuelPlat from "./VisuelPlat";
import { formatDate } from "@/lib/format";
import { libelleService, libelleTotalVotants } from "@/lib/dilemme-libelles";
import { ecrireVotant } from "@/lib/votant";
import type { Cote } from "@/lib/dilemme";
import type { EtatDuel, PlatDuel } from "@/lib/dilemme-serveur";
import styles from "./dilemme.module.css";

const COTES: Cote[] = ["a", "b"];

function messageErreur(corps: unknown, repli: string): string {
  if (corps && typeof corps === "object" && "erreur" in corps && typeof corps.erreur === "string") return corps.erreur;
  return repli;
}

function hrefJour(jour: string, aujourdhui: boolean): string {
  return aujourdhui ? "/dilemme" : `/dilemme?jour=${jour}`;
}

function CarteDuel({
  cote, plat, etat, masque, monVote, enCours, onVoter, boutonRef,
}: {
  cote: Cote;
  plat: PlatDuel;
  etat: EtatDuel;
  /** Résultats cachés : avant l'hydratation, ou duel ouvert sans vote ni demande de les voir. */
  masque: boolean;
  monVote: Cote | null;
  enCours: Cote | null;
  onVoter: (cote: Cote) => void;
  boutonRef: Ref<HTMLButtonElement>;
}) {
  const { resume, ouvert } = etat;
  const voix = cote === "a" ? resume.a : resume.b;
  const pct = cote === "a" ? resume.pctA : resume.pctB;
  const votants = etat.votes.filter((v) => v.choix === cote).map((v) => v.votant);
  const titreId = `plat-${cote}`;

  let badge: string | null = null;
  if (!masque && resume.total > 0) {
    if (resume.gagnant === "egalite") badge = "Égalité";
    else if (resume.gagnant === cote) badge = ouvert ? "En tête" : "Vainqueur";
  }
  const service = libelleService(plat.nbServices, null, plat.derniere);
  const aVote = monVote === cote;

  return (
    <article className={styles.cote} aria-labelledby={titreId} aria-busy={enCours === cote || undefined}>
      <VisuelPlat src={plat.image?.src ?? null} nom={plat.nom} />
      <div className={styles.coteTete}>
        <RestoBadge nom={plat.restaurant} variante="chip" complet />
        <span className={styles.badges}>
          {badge && <span className={styles.badge}>{badge}</span>}
          {!ouvert && aVote && <span className={`${styles.badge} ${styles.badgeVote}`}>Ton vote</span>}
        </span>
      </div>
      <h2 id={titreId} className={styles.nomPlat}>{plat.nom}</h2>
      {service && <p className={styles.meta}>{service}</p>}
      <div className={`${styles.coteResultats} ${ouvert ? styles.coteReserve : ""}`} aria-live="polite">
        {!masque && <ResultatsCote voix={voix} pct={pct} votants={votants} />}
      </div>
      {ouvert && (
        <button
          ref={boutonRef}
          type="button"
          className={styles.vote}
          aria-pressed={aVote}
          // aria-disabled et non disabled : un bouton désactivé perd le focus clavier (voter() ignore les clics en cours d'envoi).
          aria-disabled={enCours !== null || undefined}
          onClick={() => onVoter(cote)}
        >
          {aVote ? "Ton vote" : "Voter pour ce plat"}
          <span className="sr-only"> : {plat.nom}</span>
        </button>
      )}
    </article>
  );
}

/**
 * Le duel du jour : deux plats, un vote « en tant que » un personnage, résultats en direct.
 * Les décomptes viennent toujours du serveur (pas de mise à jour optimiste). Les résultats d'un
 * duel ouvert restent masqués tant qu'on n'a pas voté ou demandé à les voir : secret d'interface
 * seulement, le serveur renvoie tout.
 */
export default function DilemmeDuel({
  etatInitial, affichageDuJour, precedent, suivant, aujourdhui,
}: {
  etatInitial: EtatDuel;
  affichageDuJour: boolean;
  precedent: string | null;
  suivant: string | null;
  aujourdhui: string;
}) {
  const router = useRouter();
  const stocke = useVotant();
  // Le stockage peut refuser l'écriture : le personnage choisi reste alors en mémoire pour cette session.
  const [force, setForce] = useState<string | null>(null);
  const votant = force ?? stocke;

  const [etat, setEtat] = useState<EtatDuel>(etatInitial);
  const [enCours, setEnCours] = useState<Cote | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [voirResultats, setVoirResultats] = useState(false);
  const [grille, setGrille] = useState(false);
  const [attente, setAttente] = useState<Cote | null>(null);
  const zoneQui = useRef<HTMLElement>(null);
  const boutons = useRef<Record<Cote, HTMLButtonElement | null>>({ a: null, b: null });
  // Bouton de vote qui a ouvert la grille « Qui es-tu ? » : il récupère le focus à sa fermeture.
  const retour = useRef<Cote | null>(null);
  // Faux au rendu serveur et à l'hydratation : le votant (localStorage) n'est pas encore connu.
  const pret = useSyncExternalStore(() => () => {}, () => true, () => false);

  const monVote: Cote | null = votant ? (etat.votes.find((v) => v.votant === votant)?.choix ?? null) : null;
  // Duel ouvert : résultats cachés tant que le votant n'est pas connu (pas de flash au rendu serveur),
  // puis tant qu'il n'a ni voté ni demandé à les voir. Le texte de suspense n'apparaît qu'après l'hydratation.
  const masque = etat.ouvert && (!pret || (!monVote && !voirResultats));
  const suspense = masque && pret;

  // Valeurs lues par l'écouteur de focus sans le réabonner à chaque rendu.
  const courant = useRef({ votant, jour: etat.jour, enCours });
  useEffect(() => {
    courant.current = { votant, jour: etat.jour, enCours };
  });

  const envoyer = useCallback(
    async (nom: string, cote: Cote) => {
      setEnCours(cote);
      setErreur(null);
      try {
        const res = await fetch("/api/dilemme/vote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ votant: nom, choix: cote, jour: etat.jour }),
        });
        let corps: unknown = null;
        try {
          corps = await res.json();
        } catch {
          /* corps vide ou illisible */
        }
        if (res.ok && corps && typeof corps === "object" && "dilemme" in corps) {
          setEtat(corps as EtatDuel);
          setVoirResultats(true);
        } else {
          setErreur(messageErreur(corps, "Le vote n'a pas pu être enregistré. Réessaie dans un instant."));
          // Duel clos pendant que la page restait ouverte : on charge le nouveau duel.
          if (res.status === 409) router.refresh();
        }
      } catch {
        setErreur("Connexion impossible. Réessaie dans un instant.");
      } finally {
        setEnCours(null);
      }
    },
    [etat.jour, router],
  );

  function voter(cote: Cote) {
    if (!etat.ouvert || enCours || cote === monVote) return;
    if (!votant) {
      setAttente(cote);
      retour.current = cote;
      setGrille(true);
      return;
    }
    void envoyer(votant, cote);
  }

  function choisirVotant(nom: string) {
    setForce(ecrireVotant(nom) ? null : nom);
    setGrille(false); // le focus revient au bouton de vote (`retour`, posé à l'ouverture de la grille)
    const enAttente = attente;
    setAttente(null);
    if (enAttente && etat.ouvert) void envoyer(nom, enAttente);
  }

  // La grille fermée (choix, Annuler) rend le focus au bouton de vote qui l'avait ouverte.
  useEffect(() => {
    if (grille || !retour.current) return;
    boutons.current[retour.current]?.focus();
    retour.current = null;
  }, [grille]);

  // La grille s'ouvre sous le duel : on l'amène à l'écran et le focus y entre.
  useEffect(() => {
    if (!grille) return;
    const zone = zoneQui.current;
    zone?.scrollIntoView({ block: "nearest" });
    zone?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  }, [grille]);

  // Retour sur l'onglet : décomptes à jour, et nouveau duel si minuit est passé. Pas de polling.
  useEffect(() => {
    if (!affichageDuJour) return;
    const surFocus = async () => {
      const c = courant.current;
      if (c.enCours) return;
      try {
        const qs = c.votant ? `?votant=${encodeURIComponent(c.votant)}` : "";
        const res = await fetch(`/api/dilemme${qs}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as EtatDuel;
        if (!data?.dilemme || courant.current.enCours) return;
        if (data.jour !== c.jour) router.refresh();
        else setEtat(data);
      } catch {
        /* hors ligne : on garde l'état affiché */
      }
    };
    window.addEventListener("focus", surFocus);
    return () => window.removeEventListener("focus", surFocus);
  }, [affichageDuJour, router]);

  const credit = [etat.dilemme.a.image?.credit, etat.dilemme.b.image?.credit].find(Boolean);
  const nomEnAttente = attente ? etat.dilemme[attente].nom : null;

  return (
    <section className={styles.section} aria-label="Le duel">
      <div className={styles.duelTete}>
        <p className={styles.dateDuel}>{formatDate(etat.jour)}</p>
        <div className={styles.voisins}>
          {precedent && (
            <Link href={hrefJour(precedent, precedent === aujourdhui)} className={styles.lienDuel}>← Duel précédent</Link>
          )}
          {suivant && (
            <Link href={hrefJour(suivant, suivant === aujourdhui)} className={styles.lienDuel}>Duel suivant →</Link>
          )}
          {!affichageDuJour && <Link href="/dilemme" className={styles.lienDuel}>Retour au duel du jour</Link>}
        </div>
      </div>

      {etat.ouvert && (
        // Ligne toujours réservée (40 px) : l'apparition du votant après l'hydratation ne décale pas les cartes.
        <div className={styles.votantLigne}>
          {votant && (
            <>
              <span>Je vote en tant que</span>
              <SelecteurVotant votant={votant} onChoisir={choisirVotant} />
            </>
          )}
        </div>
      )}

      <div className={styles.duel}>
        <CarteDuel cote="a" plat={etat.dilemme.a} etat={etat} masque={masque} monVote={monVote} enCours={enCours} onVoter={voter} boutonRef={(el) => { boutons.current.a = el; }} />
        <span className={styles.contre} aria-hidden="true">contre</span>
        <CarteDuel cote="b" plat={etat.dilemme.b} etat={etat} masque={masque} monVote={monVote} enCours={enCours} onVoter={voter} boutonRef={(el) => { boutons.current.b = el; }} />
      </div>

      {etat.ouvert && masque && (
        // Place réservée dès le rendu serveur (le texte arrive après l'hydratation) : pas de saut de mise en page.
        <div className={styles.suspense} aria-hidden={!suspense || undefined}>
          {suspense && (
            <>
              <p>{libelleTotalVotants(etat.resume.total)} Les résultats s&apos;affichent après ton vote.</p>
              <button type="button" className={styles.lienBouton} onClick={() => setVoirResultats(true)}>
                Voir les résultats sans voter
              </button>
            </>
          )}
        </div>
      )}

      {erreur && <p className={styles.erreur} role="alert">{erreur}</p>}

      {grille && (
        <section ref={zoneQui} className={styles.qui} aria-labelledby="qui-titre">
          <h2 id="qui-titre">Qui es-tu ?</h2>
          <p>
            {nomEnAttente ? (
              <>Choisis qui tu es pour voter pour <strong>{nomEnAttente}</strong>.</>
            ) : (
              "Choisis qui tu es pour voter."
            )}
          </p>
          <GrilleVotants votant={votant} onChoisir={choisirVotant} />
          <button type="button" className={styles.annuler} onClick={() => { setGrille(false); setAttente(null); }}>
            Annuler
          </button>
        </section>
      )}

      {!etat.ouvert && <p className={styles.info}>Ce duel est terminé : les votes sont fermés.</p>}
      {credit && <p className={styles.credit}>Image : {credit}</p>}

      <noscript>
        Voter demande JavaScript. Le duel et ses résultats restent lisibles ici : {etat.dilemme.a.nom}{" "}
        {etat.resume.pctA} % ({etat.resume.a} voix) contre {etat.dilemme.b.nom} {etat.resume.pctB} % ({etat.resume.b} voix).
      </noscript>
    </section>
  );
}
