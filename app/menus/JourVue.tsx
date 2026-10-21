import type { PdjEntry } from "@/lib/db";
import type { Mode } from "@/lib/carte-tri";
import { casseLisible, indexOrpheline, macrosTuile, NOM_LONG, platsAffiches, platsAVenir, recoDuMode, restosSansPlat, type PlatAffiche } from "@/lib/menus-vue";
import { imageDuPlat, type ImagePlat, type ImagesPlats } from "@/lib/plat-image";
import type { Selection } from "./DetailPanneau";
import RestoBadge from "@/app/components/RestoBadge";
import PlatImage from "./PlatImage";
import { couleur, fmtNote, fmtPrix, Pastille } from "./ui";
import styles from "./menus.module.css";

function Meta({ p }: { p: PlatAffiche }) {
  const kcal = p.variante.nutrition_estimee?.calories;
  return (
    <span className={styles.meta}>
      <b>{fmtPrix(p.plat.prix)}</b>
      {kcal ? ` · ${Math.round(kcal)} kcal` : ""}
    </span>
  );
}

/** Macros en chiffres, sans couleur (le vert/ambre/rouge est réservé aux notes) ; protéines en avant en Sportif. */
function Macros({ p, mode }: { p: PlatAffiche; mode: Mode }) {
  const macros = macrosTuile(p.variante.nutrition_estimee);
  if (!macros) return null;
  return (
    <span className={styles.macros} title={macros.map((m) => `${m.long} ${m.grammes} g`).join(" · ")}>
      {macros.map((m) => (
        <span key={m.cle} className={mode === "sportif" && m.cle === "proteines" ? styles.fort : undefined}>
          <b>{m.grammes} g</b> {m.court}
        </span>
      ))}
    </span>
  );
}

function Tuile({ p, mode, image, pleine, onOpen }: { p: PlatAffiche; mode: Mode; image?: ImagePlat; pleine?: boolean; onOpen: () => void }) {
  const nom = casseLisible(p.variante.plat);
  const note = (
    <span className={`${styles.grosseNote} ${couleur(p.note)}`}>
      {fmtNote(p.note)}
      <small>/10</small>
    </span>
  );
  return (
    <button type="button" className={`${styles.tuile} ${pleine || nom.length > NOM_LONG ? styles.large : ""}`} onClick={onOpen}>
      {image && <PlatImage key={image.src} src={image.src} nom={nom} format="tuile" />}
      <span className={styles.tuileHaut}>
        {note}
        <RestoBadge nom={p.plat.restaurant} variante="chip" />
      </span>
      <span className={styles.nom}>{nom}</span>
      <Meta p={p} />
      <Macros p={p} mode={mode} />
    </button>
  );
}

function Hero({ p, raison, image, onOpen }: { p: PlatAffiche; raison?: string; image?: ImagePlat; onOpen: () => void }) {
  const n = p.variante.nutrition_estimee;
  return (
    <button type="button" className={`${styles.hero} ${image ? styles.heroPhoto : ""}`} onClick={onOpen}>
      {image && <PlatImage key={image.src} src={image.src} nom={casseLisible(p.variante.plat)} format="hero" />}
      <Pastille note={p.note} />
      <span className={styles.heroTexte}>
        <span><span className={styles.tagReco}>Reco du jour</span></span>
        <span className={styles.heroNom}>{casseLisible(p.variante.plat)}</span>
        <span className={styles.meta}>
          <RestoBadge nom={p.plat.restaurant} complet /> · <b>{fmtPrix(p.plat.prix)}</b>
        </span>
        {raison && <span className={styles.raison}>{raison}</span>}
        {n && (
          <span className={styles.macrosLigne}>
            <span><b>{Math.round(n.calories)}</b> kcal</span>
            <span>Protéines <b>{Math.round(n.proteines_g)}</b> g</span>
            <span>Glucides <b>{Math.round(n.glucides_g)}</b> g</span>
            <span>Lipides <b>{Math.round(n.lipides_g)}</b> g</span>
          </span>
        )}
      </span>
    </button>
  );
}

/** Vue Jour : la reco du mode en grand, puis les autres plats en tuiles, triés par note. */
export default function JourVue({ pdj, mode, images, onOpen }: { pdj: PdjEntry; mode: Mode; images?: ImagesPlats; onOpen: (s: Selection) => void }) {
  if (pdj.ferie) {
    return <div className={styles.message}>Jour férié, {pdj.ferie}. Les restaurants sont fermés.</div>;
  }
  if (pdj.erreur) {
    return <div className={styles.message}>{pdj.erreur}</div>;
  }

  const plats = platsAffiches(pdj, mode);
  const reco = recoDuMode(pdj, mode);
  const [premier, ...autres] = plats;
  const hero = premier?.reco ? premier : null;
  const tuiles = hero ? autres : plats;
  const ouvrir = (p: PlatAffiche) => () => onOpen({ kind: "plat", date: pdj.date, platIndex: p.platIndex, variante: p.variante.plat });
  const aVenir = platsAVenir(pdj);
  const sans = restosSansPlat(pdj);
  const image = (p: PlatAffiche) => imageDuPlat(images, p.plat.restaurant, p.variante.plat);
  const orpheline = indexOrpheline(tuiles);

  return (
    <div className={styles.grille}>
      {hero && <Hero p={hero} raison={reco?.raison} image={image(hero)} onOpen={ouvrir(hero)} />}
      {tuiles.map((p, i) => (
        <Tuile key={`${p.platIndex}::${p.variante.plat}`} p={p} mode={mode} image={image(p)} pleine={i === orpheline} onOpen={ouvrir(p)} />
      ))}
      {(aVenir.length > 0 || sans.length > 0) && (
        <div className={styles.puces}>
          {/* Un groupe par intitulé : « Sans plat » ne se retrouve jamais en fin de ligne après une puce d'un autre groupe. */}
          {aVenir.length > 0 && (
            <div className={styles.pucesGroupe}>
              <span className={styles.pucesTitre}>Dévoilé le matin même</span>
              {aVenir.map((p) => (
                <button key={p.restaurant} type="button" onClick={() => onOpen({ kind: "resto", date: pdj.date, nom: p.restaurant })}>
                  <RestoBadge nom={p.restaurant} complet />
                </button>
              ))}
            </div>
          )}
          {sans.length > 0 && (
            <div className={styles.pucesGroupe}>
              <span className={styles.pucesTitre}>Sans plat</span>
              {sans.map((r) => (
                <button key={r.slug} type="button" onClick={() => onOpen({ kind: "resto", date: pdj.date, nom: r.nom })}>
                  <RestoBadge nom={r.nom} complet />
                  {r.type === "lien" && <span>· salades</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
