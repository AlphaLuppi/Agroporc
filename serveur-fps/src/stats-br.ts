/**
 * Persistance des statistiques du Battle Royale (I/O fichier : la logique des stats est dans lib/fps/br-stats.ts, pure).
 * Fichier JSON `{ version: 1, joueurs }` ; lecture synchrone au démarrage (absent : vide ; illisible : renommé `.corrompu-<horodatage>` puis vide),
 * écriture atomique ASYNCHRONE et sérialisée (fichier temporaire du MÊME dossier, `fsync`, `rename`) : un `fsync` synchrone bloquerait la boucle
 * de tic partagée par les trois salles. Seul `arreter()` (SIGTERM) écrit en synchrone. Une écriture qui échoue est journalisée sans bloquer la
 * partie : les stats restent en mémoire et la suivante réécrit l'ensemble.
 * Spec : docs/superpowers/specs/2026-10-28-battle-royale-design.md, section « Statistiques persistées ».
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { appliquerPartie, lireStatsBr, statsVides, type PersistanceBr, type ResultatPartieBr, type StatsBr } from "../../lib/fps/br-stats";

/** `PersistanceBr` (lire / enregistrer, injectée dans le service BR) plus ce que le serveur Node en fait. */
export interface PersistanceBrFichier extends PersistanceBr {
  /** Résolue quand toutes les écritures demandées jusqu'ici sont terminées (réussies ou journalisées). */
  vider(): Promise<void>;
  /** Écrit tout de suite et en synchrone ce qui n'est pas encore sur disque ; après quoi chaque `enregistrer` écrit lui aussi en synchrone. */
  arreter(): void;
}

/** Texte JSON des stats (indenté : le fichier se lit et se corrige à la main). */
const serialiser = (stats: StatsBr): string => `${JSON.stringify(stats, null, 2)}\n`;

/** Lit le fichier ; illisible (JSON invalide, structure absurde) : renommé à côté pour ne rien perdre, puis départ à vide. */
function charger(fichier: string): StatsBr {
  if (!existsSync(fichier)) return statsVides();
  let brut: unknown;
  try {
    brut = JSON.parse(readFileSync(fichier, "utf8"));
  } catch (e) {
    return mettreDeCote(fichier, e);
  }
  if (typeof brut !== "object" || brut === null || Array.isArray(brut) || typeof (brut as { joueurs?: unknown }).joueurs !== "object") {
    return mettreDeCote(fichier, new Error("structure inattendue"));
  }
  return lireStatsBr(brut);
}

function mettreDeCote(fichier: string, cause: unknown): StatsBr {
  const cible = `${fichier}.corrompu-${Date.now()}`;
  try {
    renameSync(fichier, cible);
    console.error(`stats BR : ${fichier} illisible (${cause instanceof Error ? cause.message : cause}), conservé dans ${cible}`);
  } catch (e) {
    console.error(`stats BR : ${fichier} illisible et impossible à mettre de côté :`, e);
  }
  return statsVides();
}

/**
 * Persistance dans `fichier`. Le dossier est créé s'il manque. Tout échec disque est journalisé, jamais propagé : la salle de jeu n'attend rien
 * d'ici. `enregistrer` met les stats à jour en mémoire tout de suite (le bilan de fin les relit aussitôt) et planifie l'écriture.
 */
export function creerPersistanceBr(fichier: string): PersistanceBrFichier {
  try { mkdirSync(dirname(fichier), { recursive: true }); } catch (e) { console.error("stats BR : dossier non créé :", e); }
  let stats = charger(fichier);
  /** numéro de la dernière modification en mémoire, et de la dernière écrite sur disque */
  let version = 0;
  let ecrite = 0;
  let arrete = false;
  let serie = 0;
  /** file des écritures : une seule à la fois, la suivante s'enchaîne sur la promesse précédente (jamais rejetée) */
  let chaine: Promise<void> = Promise.resolve();

  const temporaire = (): string => `${fichier}.${process.pid}.${++serie}.tmp`;

  async function ecrireAtomique(): Promise<void> {
    if (arrete || ecrite >= version) return;
    const versionEcrite = version;
    const texte = serialiser(stats);
    const tmp = temporaire();
    try {
      await mkdir(dirname(fichier), { recursive: true });
      const f = await open(tmp, "w");
      try {
        await f.writeFile(texte, "utf8");
        await f.sync();
      } finally {
        await f.close();
      }
      // arreter() a pu écrire un état plus récent pendant ce temps : ne pas le remplacer par celui-ci
      if (arrete) { await unlink(tmp).catch(() => {}); return; }
      await rename(tmp, fichier);
      ecrite = Math.max(ecrite, versionEcrite);
    } catch (e) {
      console.error("stats BR : écriture impossible (les stats restent en mémoire) :", e);
      await unlink(tmp).catch(() => {});
    }
  }

  function ecrireSynchrone(): void {
    if (ecrite >= version) return;
    const tmp = temporaire();
    try {
      mkdirSync(dirname(fichier), { recursive: true });
      const fd = openSync(tmp, "w");
      try {
        writeSync(fd, serialiser(stats));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, fichier);
      ecrite = version;
    } catch (e) {
      console.error("stats BR : écriture finale impossible :", e);
      try { unlinkSync(tmp); } catch { /* le temporaire n'existe pas forcément */ }
    }
  }

  return {
    lire: () => stats,
    enregistrer(partie: ResultatPartieBr): StatsBr {
      stats = appliquerPartie(stats, partie);
      version++;
      if (arrete) ecrireSynchrone();
      else chaine = chaine.then(ecrireAtomique);
      return stats;
    },
    vider: () => chaine,
    arreter(): void {
      arrete = true;
      ecrireSynchrone();
    },
  };
}
