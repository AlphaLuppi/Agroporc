/**
 * Validation de FORME des messages texte de Rocket Muche en ligne (lot SERVEUR, PUR, fuzzé en test). Le serveur fait confiance à rien de ce qui
 * vient du réseau : un message est reconstruit champ par champ (jamais recopié tel quel) et le moindre écart donne `null`, sans jamais lever.
 * La salle valide ensuite le FOND (hôte, phase, bornes). Spec § 7.
 */
import { EQUIPES, FORMATS, MATCH, NIVEAUX_BOT } from "../contrat";
import type { Equipe } from "../contrat";
import { RESEAU, normaliserCode } from "./protocole";
import type { LireMessageClient, MessageClient, NettoyerNom, ReglagesSalon } from "./protocole";

/** Bornes des essais `dev` (mètres, m/s, secondes) : très larges, pour écarter les non finis et les valeurs absurdes. */
const DEV_POSITION_MAX = 200;
const DEV_VITESSE_MAX = 200;
const DEV_CHRONO_MAX_S = 3600;
/** Jeton de reprise : 16 octets en hexadécimal minuscule (`crypto.randomBytes(16).toString("hex")`). */
const FORME_JETON = /^[0-9a-f]{32}$/;
/** Identifiant de joueur : entier positif de 31 bits. */
const idValide = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 0x7fffffff;

const estObjet = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const fini = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const equipeValide = (x: unknown): x is Equipe => typeof x === "string" && (EQUIPES as readonly string[]).includes(x);
const formatValide = (x: unknown): x is ReglagesSalon["format"] => typeof x === "string" && (FORMATS as readonly string[]).includes(x);
const niveauValide = (x: unknown): x is ReglagesSalon["niveauBots"] => typeof x === "string" && (NIVEAUX_BOT as readonly string[]).includes(x);
const dureeValide = (x: unknown): x is number => typeof x === "number" && MATCH.dureesPermisesS.includes(x);

/**
 * Nom de joueur : retire les caractères de contrôle ET de formatage Unicode (U+202E et autres bidirectionnels, U+200B, U+200D…), les caractères non
 * assignés, privés ou isolés, remplace tout séparateur (espaces, U+2028, U+2029, tabulations) par une espace, réduit les espaces, limite les
 * suites de signes combinants à trois (texte « zalgo »), puis tronque à `nomMaxCaracteres` POINTS DE CODE. Rend null si rien ne reste.
 */
export const nettoyerNom: NettoyerNom = (brut) => {
  if (typeof brut !== "string") return null;
  let s = brut.normalize("NFC").replace(/[\p{Z}\s]+/gu, " ").replace(/\p{C}+/gu, "");
  s = s.replace(/(\p{M}{3})\p{M}+/gu, "$1").replace(/ {2,}/g, " ").trim();
  const points = Array.from(s);
  if (points.length === 0) return null;
  return points.slice(0, RESEAU.nomMaxCaracteres).join("").trim() || null;
};

/** Réglages COMPLETS (création de salon) ; null au moindre écart. */
function reglagesComplets(brut: unknown): ReglagesSalon | null {
  if (!estObjet(brut)) return null;
  const { format, dureeS, niveauBots, visible } = brut;
  if (!formatValide(format) || !dureeValide(dureeS) || !niveauValide(niveauBots) || typeof visible !== "boolean") return null;
  return { format, dureeS, niveauBots, visible };
}

/** Réglages PARTIELS (changement par l'hôte) : un champ présent doit être valide, un champ absent est ignoré. */
function reglagesPartiels(brut: unknown): Partial<ReglagesSalon> | null {
  if (!estObjet(brut)) return null;
  const r: Partial<ReglagesSalon> = {};
  if (brut.format !== undefined) { if (!formatValide(brut.format)) return null; r.format = brut.format; }
  if (brut.dureeS !== undefined) { if (!dureeValide(brut.dureeS)) return null; r.dureeS = brut.dureeS; }
  if (brut.niveauBots !== undefined) { if (!niveauValide(brut.niveauBots)) return null; r.niveauBots = brut.niveauBots; }
  if (brut.visible !== undefined) { if (typeof brut.visible !== "boolean") return null; r.visible = brut.visible; }
  return r;
}

function vecteurBorne(brut: unknown, max: number): [number, number, number] | null {
  if (!Array.isArray(brut) || brut.length !== 3) return null;
  const [x, y, z] = brut as unknown[];
  if (!fini(x) || !fini(y) || !fini(z)) return null;
  if (Math.abs(x) > max || Math.abs(y) > max || Math.abs(z) > max) return null;
  return [x + 0, y + 0, z + 0];
}

/**
 * Valide la forme d'un message client déjà parsé (JSON). `t` dans la liste fermée de `MessageClient` ; les champs superflus sont ignorés (le
 * message rendu est neuf) ; null au moindre champ manquant, mal typé ou hors liste.
 */
export const lireMessageClient: LireMessageClient = (brut) => {
  if (!estObjet(brut)) return null;
  const t = brut.t;
  switch (t) {
    case "bonjour": {
      const v = brut.v;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 65_535) return null;
      const nom = nettoyerNom(brut.nom);
      if (nom === null) return null;
      if (brut.reprise === undefined || brut.reprise === null) return { t, v: v + 0, nom };
      const r = brut.reprise;
      if (!estObjet(r)) return null;
      const code = normaliserCode(r.code);
      if (code === null || !idValide(r.joueur) || typeof r.jeton !== "string" || !FORME_JETON.test(r.jeton)) return null;
      return { t, v: v + 0, nom, reprise: { code, joueur: r.joueur + 0, jeton: r.jeton } };
    }
    case "lister": case "quitter": case "lancer": case "pret": case "klaxon": case "retourSalon":
      return { t } as MessageClient;
    case "creer": {
      const reglages = reglagesComplets(brut.reglages);
      return reglages ? { t, reglages } : null;
    }
    case "rejoindre": {
      const code = normaliserCode(brut.code);
      if (code === null) return null;
      if (brut.equipe === undefined || brut.equipe === null) return { t, code };
      return equipeValide(brut.equipe) ? { t, code, equipe: brut.equipe } : null;
    }
    case "equipe":
      return equipeValide(brut.equipe) ? { t, equipe: brut.equipe } : null;
    case "reglages": {
      const reglages = reglagesPartiels(brut.reglages);
      return reglages ? { t, reglages } : null;
    }
    case "ping":
      return fini(brut.c) && Math.abs(brut.c) <= 1e15 ? { t, c: brut.c + 0 } : null;
    case "revanche":
      return typeof brut.oui === "boolean" ? { t, oui: brut.oui } : null;
    case "dev": {
      if (brut.action === "balle") {
        const p = vecteurBorne(brut.p, DEV_POSITION_MAX);
        const v = vecteurBorne(brut.v, DEV_VITESSE_MAX);
        return p && v ? { t, action: "balle", p, v } : null;
      }
      if (brut.action === "chrono") {
        const c = brut.tempsRestant;
        return fini(c) && c >= 0 && c <= DEV_CHRONO_MAX_S ? { t, action: "chrono", tempsRestant: c + 0 } : null;
      }
      return null;
    }
    default:
      return null;
  }
};

/** Types de message connus, pour répondre `refus{invalide}` à un message mal formé d'un type reconnaissable. */
export const TYPES_CLIENT: ReadonlySet<MessageClient["t"]> = new Set<MessageClient["t"]>([
  "bonjour", "lister", "creer", "rejoindre", "quitter", "equipe", "reglages", "lancer", "pret", "ping", "klaxon", "revanche", "retourSalon", "dev",
]);
