"use client";

import { useState } from "react";
import { meilleursCandidats, type Criteres } from "@/lib/quiz-engine";
import { platsCompatibles, compterBranche } from "@/lib/quiz-arbre";
import { type PoolPlat, type Mode } from "@/lib/quiz-plats";
import { choisirDessert, type DessertConnu, type SaveurDessert, type Lourdeur } from "@/lib/desserts";
import { noteClass } from "@/lib/format";
import { casseLisible } from "@/lib/menus-vue";
import { fmtPrix } from "../menus/ui";
import styles from "./quiz.module.css";

interface Choix {
  key: string;
  label: string;
  emoji: string;
}

type Cle = "mode" | "menu" | "envie" | "cuisine" | "lourdeur" | "budget" | "saveur" | "lourdeurDessert";

interface Etape {
  cle: Cle;
  /** Nom court de la colonne dans l'arbre. */
  court: string;
  titre: string;
  choix: Choix[];
  /** Critère du moteur : la branche affiche le nombre de plats compatibles. */
  critere?: keyof Criteres;
  /** N'apparaît que pour « plat + dessert ». */
  dessert?: boolean;
}

const PEU: Choix = { key: "peu_importe", label: "Peu importe", emoji: "🤷" };

const ETAPES: Etape[] = [
  {
    cle: "mode", court: "Mode", titre: "Tu manges plutôt malin ou plaisir aujourd'hui ?",
    choix: [
      { key: "sportif", label: "Sportif (équilibré)", emoji: "🥗" },
      { key: "goulaf", label: "Goulaf (plaisir)", emoji: "😋" },
    ],
  },
  {
    cle: "menu", court: "Formule", titre: "Tu veux juste un plat, ou un plat + un dessert ?",
    choix: [
      { key: "plat", label: "Un plat seul", emoji: "🍽️" },
      { key: "menu", label: "Un plat + un dessert", emoji: "🍰" },
    ],
  },
  {
    cle: "envie", court: "Envie", titre: "Qu'est-ce qui te tente ?", critere: "envie",
    choix: [
      { key: "poulet", label: "Poulet / volaille", emoji: "🍗" },
      { key: "boeuf", label: "Bœuf", emoji: "🐄" },
      { key: "porc", label: "Porc", emoji: "🐖" },
      { key: "veau", label: "Veau / agneau", emoji: "🐑" },
      { key: "poisson", label: "Poisson / fruits de mer", emoji: "🐟" },
      { key: "vege", label: "Végé (sans viande ni poisson)", emoji: "🥦" },
      PEU,
    ],
  },
  {
    cle: "cuisine", court: "Cuisine", titre: "Plutôt quel style de cuisine ?", critere: "cuisine",
    choix: [
      { key: "mijote", label: "Mijoté / réconfortant", emoji: "🍲" },
      { key: "asiatique", label: "Asiatique", emoji: "🥢" },
      { key: "mediterraneen", label: "Méditerranéen", emoji: "🫒" },
      { key: "streetfood", label: "Burger / streetfood", emoji: "🍔" },
      { key: "froid", label: "Salade / froid", emoji: "🥗" },
      PEU,
    ],
  },
  {
    cle: "lourdeur", court: "Lourdeur", titre: "Léger ou copieux ?", critere: "lourdeur",
    choix: [
      { key: "leger", label: "Léger", emoji: "🍃" },
      { key: "copieux", label: "Copieux", emoji: "🍛" },
      PEU,
    ],
  },
  {
    cle: "budget", court: "Budget", titre: "Quel budget pour le plat ?", critere: "budget",
    choix: [
      { key: "eco", label: "Éco (≤ 10€)", emoji: "💰" },
      { key: "standard", label: "Standard", emoji: "💳" },
      PEU,
    ],
  },
  {
    cle: "saveur", court: "Dessert", titre: "Côté dessert, tu pars sur quoi ?", dessert: true,
    choix: [
      { key: "fruite", label: "Fruité", emoji: "🍓" },
      { key: "chocolate", label: "Chocolaté", emoji: "🍫" },
      { key: "creme_lacte", label: "Crémeux / lacté", emoji: "🥛" },
      { key: "patissier", label: "Pâtissier", emoji: "🥧" },
      PEU,
    ],
  },
  {
    cle: "lourdeurDessert", court: "Dessert", titre: "Le dessert, léger ou bien gourmand ?", dessert: true,
    choix: [
      { key: "leger", label: "Léger", emoji: "🍃" },
      { key: "gourmand", label: "Gourmand", emoji: "🤤" },
      PEU,
    ],
  },
];

type Reponses = Partial<Record<Cle, string>>;

const opt = <T extends string>(k?: string): T | undefined => (k === undefined || k === "peu_importe" ? undefined : (k as T));

function criteresDe(r: Reponses): Criteres {
  return { envie: opt(r.envie), cuisine: opt(r.cuisine), lourdeur: opt(r.lourdeur), budget: opt(r.budget) };
}

const noteDe = (p: PoolPlat, mode: Mode) => (mode === "sportif" ? p.note : p.note_goulaf ?? p.note);
const parNote = (mode: Mode) => (a: PoolPlat, b: PoolPlat) => (noteDe(b, mode) ?? -1) - (noteDe(a, mode) ?? -1);

function Pastille({ note }: { note?: number }) {
  const cls = note == null ? styles.none : styles[noteClass(note)];
  return (
    <span className={`${styles.pastille} ${cls}`}>
      {note == null ? "?" : String(note).replace(".", ",")}
      <small>/10</small>
    </span>
  );
}

function LignePlat({ p, mode }: { p: PoolPlat; mode: Mode }) {
  return (
    <div className={styles.ligne}>
      <Pastille note={noteDe(p, mode)} />
      <span className={styles.ligneTexte}>
        <span className={styles.ligneNom}>{casseLisible(p.plat)}</span>
        <span className={styles.meta}>
          {p.restaurant} · <b>{fmtPrix(p.prix)}</b>
        </span>
      </span>
    </div>
  );
}

export default function QuizClient({ pool, desserts, hasJour }: { pool: PoolPlat[]; desserts: DessertConnu[]; hasJour: boolean }) {
  const [rep, setRep] = useState<Reponses>({});

  const etapes = ETAPES.filter((e) => !e.dessert || rep.menu === "menu");
  const courante = etapes.find((e) => rep[e.cle] === undefined);
  const mode: Mode = rep.mode === "goulaf" ? "goulaf" : "sportif";
  const criteres = criteresDe(rep);
  const restants = platsCompatibles(pool, criteres).sort(parNote(mode));

  const repondre = (cle: Cle, key: string) =>
    setRep((r) => {
      const n = { ...r, [cle]: key };
      if (cle === "menu" && key === "plat") {
        delete n.saveur;
        delete n.lourdeurDessert;
      }
      return n;
    });
  // Fil d'Ariane mobile : revenir sur une réponse efface aussi les suivantes.
  const revenir = (cle: Cle) =>
    setRep((r) => {
      const n = { ...r };
      ETAPES.slice(ETAPES.findIndex((e) => e.cle === cle)).forEach((e) => delete n[e.cle]);
      return n;
    });
  const recommencer = () => setRep({});

  const compte = (e: Etape, key: string): number | null =>
    e.critere ? compterBranche(pool, criteres, e.critere, opt(key)) : null;
  const libelle = (e: Etape) => e.choix.find((c) => c.key === rep[e.cle])?.label ?? "";

  const resultat = courante ? null : (
    <Resultat pool={pool} criteres={criteres} mode={mode} rep={rep} desserts={desserts} onReset={recommencer} />
  );

  return (
    <div className={styles.root}>
      <header className={styles.entete}>
        <h1>Aide-moi à choisir</h1>
        <p>Quelques questions, et on te trouve le plat idéal du jour.</p>
        {!hasJour && <p className={styles.note}>Pas encore de plats du jour publiés : on cherche dans les cartes.</p>}
      </header>

      {/* ── Mobile : une question à la fois ── */}
      <div className={styles.mobile}>
        <div className={styles.progression} aria-hidden="true">
          {etapes.map((e) => (
            <i key={e.cle} className={rep[e.cle] !== undefined ? styles.fait : undefined} />
          ))}
        </div>
        {etapes.some((e) => rep[e.cle] !== undefined) && (
          <div className={styles.fil} aria-label="Tes réponses (touche pour modifier)">
            {etapes
              .filter((e) => rep[e.cle] !== undefined)
              .map((e) => (
                <button key={e.cle} type="button" onClick={() => revenir(e.cle)}>
                  {libelle(e)}
                </button>
              ))}
          </div>
        )}
        {courante ? (
          <>
            <h2 className={styles.question}>{courante.titre}</h2>
            <div className={styles.choix}>
              {courante.choix.map((c, i) => {
                const n = compte(courante, c.key);
                const seul = courante.choix.length % 2 === 1 && i === courante.choix.length - 1;
                return (
                  <button
                    key={c.key}
                    type="button"
                    className={[seul ? styles.seul : "", n === 0 ? styles.zero : ""].join(" ")}
                    onClick={() => repondre(courante.cle, c.key)}
                  >
                    <span className={styles.emoji} aria-hidden="true">{c.emoji}</span>
                    {c.label}
                    {n !== null && <span className={styles.compte} aria-label={`${n} plats`}>{n}</span>}
                  </button>
                );
              })}
            </div>
            <div className={styles.apercu} aria-live="polite">
              <span className={styles.meta}>
                {restants.length} plat{restants.length > 1 ? "s" : ""} possible{restants.length > 1 ? "s" : ""}
              </span>
              {restants.slice(0, 2).map((p) => (
                <LignePlat key={`${p.restaurant}::${p.plat}`} p={p} mode={mode} />
              ))}
            </div>
          </>
        ) : (
          resultat
        )}
      </div>

      {/* ── Desktop : l'arbre entier ── */}
      <div className={styles.barre}>
        <span className={styles.meta}>Clique une branche dans n&apos;importe quelle colonne. Les chiffres = plats encore possibles.</span>
        {Object.keys(rep).length > 0 && (
          <button type="button" className={styles.recommencer} onClick={recommencer}>↻ Recommencer</button>
        )}
      </div>
      <div className={styles.arbre} style={{ "--colonnes": etapes.length } as React.CSSProperties}>
        {etapes.map((e) => {
          const index = etapes.indexOf(e);
          const iCourante = courante ? etapes.indexOf(courante) : etapes.length;
          return (
            <div
              key={e.cle}
              role="group"
              aria-label={e.titre}
              className={[styles.colonne, e === courante ? styles.courante : "", index > iCourante ? styles.apres : ""].join(" ")}
            >
              <h2>
                {e.court}
                {rep[e.cle] !== undefined && <span aria-hidden="true">✓</span>}
              </h2>
              {e.choix.map((c) => {
                const n = compte(e, c.key);
                return (
                  <button
                    key={c.key}
                    type="button"
                    aria-pressed={rep[e.cle] === c.key}
                    className={`${styles.noeud} ${n === 0 ? styles.zero : ""}`}
                    onClick={() => repondre(e.cle, c.key)}
                  >
                    <span aria-hidden="true">{c.emoji}</span>
                    {c.label}
                    {n !== null && <span className={styles.compte} aria-label={`${n} plats`}>{n}</span>}
                  </button>
                );
              })}
            </div>
          );
        })}
        <div className={styles.panneau} aria-live="polite">
          {courante ? (
            <>
              <h2>
                {restants.length} plat{restants.length > 1 ? "s" : ""} possible{restants.length > 1 ? "s" : ""}
              </h2>
              {restants.length === 0 && <p className={styles.texte}>Aucun plat ne coche tout : on te proposera le plus proche.</p>}
              {restants.map((p) => (
                <LignePlat key={`${p.restaurant}::${p.plat}`} p={p} mode={mode} />
              ))}
              <p className={styles.meta}>Prochaine question : {courante.titre}</p>
            </>
          ) : (
            resultat
          )}
        </div>
      </div>
    </div>
  );
}

function Resultat({
  pool,
  criteres,
  mode,
  rep,
  desserts,
  onReset,
}: {
  pool: PoolPlat[];
  criteres: Criteres;
  mode: Mode;
  rep: Reponses;
  desserts: DessertConnu[];
  onReset: () => void;
}) {
  const { candidats, nbCriteres, scoreMax } = meilleursCandidats(pool, criteres, mode);
  // Aucun plat ne correspond aux critères exprimés → on propose le plus proche.
  const auPlusProche = nbCriteres > 0 && scoreMax === 0;
  const [premier, ...autres] = candidats;
  const dessert =
    rep.menu === "menu"
      ? choisirDessert(desserts, { saveur: opt<SaveurDessert>(rep.saveur), lourdeur: opt<Lourdeur>(rep.lourdeurDessert) })
      : null;
  const justif = premier ? (mode === "sportif" ? premier.justification : premier.justification_goulaf ?? premier.justification) : undefined;

  return (
    <div className={styles.resultat}>
      <h3>
        {auPlusProche
          ? "Rien ne colle pile, voici le plus proche"
          : candidats.length > 1
            ? `${candidats.length} plats collent, du mieux noté au moins bien noté`
            : "Ton plat idéal aujourd'hui"}
      </h3>
      {premier ? (
        <div className={styles.gagnant}>
          <div className={styles.gagnantTete}>
            <Pastille note={noteDe(premier, mode)} />
            <div>
              <div className={styles.gagnantNom}>{casseLisible(premier.plat)}</div>
              <div className={styles.meta}>
                {premier.restaurant} · <b>{fmtPrix(premier.prix)}</b>
              </div>
            </div>
          </div>
          {justif && <p className={styles.texte}>{justif}</p>}
        </div>
      ) : (
        <p className={styles.texte}>Aucun plat trouvé aujourd&apos;hui. Reviens un peu plus tard !</p>
      )}
      {autres.length > 0 && (
        <div>
          {autres.map((p) => (
            <LignePlat key={`${p.restaurant}::${p.plat}`} p={p} mode={mode} />
          ))}
        </div>
      )}
      {rep.menu === "menu" && (
        <div className={styles.dessert}>
          <span className={styles.meta}>Et le dessert</span>
          {dessert ? (
            <>
              <span className={styles.ligneNom}>{dessert.nom}</span>
              <span className={styles.meta}>
                {dessert.restaurant} · ≈ {dessert.proba}% de chances de l&apos;avoir aujourd&apos;hui
                {dessert.proba < 100 && ", à vérifier sur place"}
              </span>
            </>
          ) : (
            <span className={styles.texte}>Pas de dessert correspondant dans nos infos.</span>
          )}
        </div>
      )}
      <button type="button" className={styles.recommencer} onClick={onReset}>↻ Recommencer</button>
    </div>
  );
}
