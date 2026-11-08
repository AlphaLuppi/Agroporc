/**
 * Registre des salles de Rocket Muche en ligne (lot SERVEUR, PUR : ni horloge ni IP globale, tout est passé en argument ; le hasard vient d'une
 * graine fournie par le serveur, jamais de `Math.random`). Il tient les codes de salon (4 consonnes, 160 000 codes), les plafonds (salles,
 * matchs, salles par adresse), la liste publique, le filtre des salles à faire tiquer et l'anti-énumération des codes. Il ne dépend pas de
 * `salle.ts` : la fabrique de salles est injectée (`creerSalle`). Spec § 4.1, § 7, § 13.
 */
import { RESEAU, normaliserCode } from "./protocole";
import type { CreerRegistreRocket, RegistreRocket, ResumeSalle, SalleRocket } from "./protocole";

/** Fenêtre de comptage des codes erronés (ms). */
const FENETRE_ESSAIS_MS = 60_000;

/** mulberry32 : générateur 32 bits à graine (le registre n'a besoin que de codes et de graines de salles, pas de qualité cryptographique). */
function generateur(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const creerRegistreRocket: CreerRegistreRocket = (opts) => {
  const alea = generateur(opts.graine);
  const essaisMax = opts.essaisCodeParMinute ?? RESEAU.essaisCodeParMinute;
  const reserveMs = opts.codeReserveMs ?? RESEAU.codeReserveMs;
  const salles = new Map<string, SalleRocket>();
  /** adresse du créateur de chaque salle (plafond `sallesParIp` ; une salle fermée libère sa place) */
  const ipDeSalle = new Map<string, string>();
  /** codes libérés : non réattribués avant l'instant indiqué (ms) */
  const reserves = new Map<string, number>();
  /** instants des codes erronés tentés par adresse, sur la dernière minute */
  const essais = new Map<string, number[]>();

  const purgerReserves = (maintenantMs: number): void => {
    for (const [code, fin] of reserves) if (fin <= maintenantMs) reserves.delete(code);
  };
  const tirerCode = (): string | null => {
    for (let k = 0; k < 500; k++) {
      let c = "";
      for (let i = 0; i < RESEAU.longueurCode; i++) c += RESEAU.alphabetCode[Math.floor(alea() * RESEAU.alphabetCode.length)];
      if (!salles.has(c) && !reserves.has(c)) return c;
    }
    return null;
  };
  const sallesDeLIp = (ip: string): number => {
    let n = 0;
    for (const x of ipDeSalle.values()) if (x === ip) n++;
    return n;
  };
  const retirerSalle = (code: string, maintenantMs: number): void => {
    if (!salles.delete(code)) return;
    ipDeSalle.delete(code);
    reserves.set(code, maintenantMs + reserveMs);
  };
  const essaisRecents = (ip: string, maintenantMs: number): number[] => {
    const recents = (essais.get(ip) ?? []).filter((t) => t > maintenantMs - FENETRE_ESSAIS_MS);
    if (recents.length > 0) essais.set(ip, recents); else essais.delete(ip);
    return recents;
  };

  const registre: RegistreRocket = {
    creer(hote, reglages, ip, maintenantMs) {
      purgerReserves(maintenantMs);
      if (salles.size >= opts.sallesMax || sallesDeLIp(ip) >= opts.sallesParIp) return { ok: false, raison: "limite" };
      const code = tirerCode();
      if (code === null) return { ok: false, raison: "limite" };
      const graine = Math.floor(alea() * 4294967296);
      const salle = opts.creerSalle({
        code, hote: { id: hote.id, nom: hote.nom }, reglages: { ...reglages }, graine, maintenantMs,
        ...(opts.dev !== undefined ? { dev: opts.dev } : {}),
        ...(opts.humainsMin !== undefined ? { humainsMin: opts.humainsMin } : {}),
        ...(opts.dureeForceeS !== undefined ? { dureeForceeS: opts.dureeForceeS } : {}),
      });
      salles.set(code, salle);
      ipDeSalle.set(code, ip);
      return { ok: true, salle };
    },

    trouver(code, ip, maintenantMs) {
      const recents = essaisRecents(ip, maintenantMs);
      if (recents.length >= essaisMax) return { ok: false, raison: "limite" };
      const c = normaliserCode(code);
      if (c === null) return { ok: false, raison: "code" };
      const salle = salles.get(c);
      if (!salle) {
        recents.push(maintenantMs);
        essais.set(ip, recents);
        return { ok: false, raison: "inconnue" };
      }
      return { ok: true, salle };
    },

    lister() {
      const liste: ResumeSalle[] = [];
      for (const s of salles.values()) {
        if (s.phase !== "salon" || !s.etat().reglages.visible) continue;
        const r = s.resume();
        if (r.humains < r.places) liste.push(r);
      }
      return liste;
    },

    actives() {
      const a: SalleRocket[] = [];
      for (const s of salles.values()) if (s.aEcheance()) a.push(s);
      return a;
    },

    nettoyer(maintenantMs) {
      purgerReserves(maintenantMs);
      for (const ip of Array.from(essais.keys())) essaisRecents(ip, maintenantMs);
      const retirees: SalleRocket[] = [];
      for (const s of salles.values()) {
        if (s.vide() || (s.phase === "salon" && maintenantMs - s.activiteMs() > RESEAU.salonInactifMs)) retirees.push(s);
      }
      for (const s of retirees) retirerSalle(s.code, maintenantMs);
      return retirees;
    },

    retirer(code, maintenantMs) {
      retirerSalle(code, maintenantMs);
    },

    nombre() {
      return salles.size;
    },

    nombreMatchs() {
      let n = 0;
      for (const s of salles.values()) if (s.enMatch()) n++;
      return n;
    },
  };
  return registre;
};
