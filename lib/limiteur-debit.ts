/** Limiteur de débit en mémoire, à fenêtre fixe par clé (IP, votant…). Pur : l'horloge est injectable. */
export interface Limiteur {
  /** true = autorisé (et compté), false = plafond atteint pour la fenêtre en cours. */
  essayer(cle: string): boolean;
  /** Nombre de clés suivies (après purge), pour les tests. */
  taille(): number;
}

export function creerLimiteur(max: number, fenetreMs: number, maintenant: () => number = Date.now): Limiteur {
  const entrees = new Map<string, { n: number; fin: number }>();
  return {
    essayer(cle) {
      const t = maintenant();
      // Purge paresseuse : pas de setInterval (qui garderait le processus et les tests en vie).
      for (const [k, e] of entrees) if (t >= e.fin) entrees.delete(k);
      const e = entrees.get(cle);
      if (!e) {
        if (max <= 0) return false;
        entrees.set(cle, { n: 1, fin: t + fenetreMs });
        return true;
      }
      if (e.n >= max) return false;
      e.n++;
      return true;
    },
    taille() {
      return entrees.size;
    },
  };
}

/** IP du client derrière le proxy : premier `x-forwarded-for`, sinon `x-real-ip`, sinon « unknown ». */
export function ipDeRequete(headers: { get(nom: string): string | null }): string {
  const xff = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (xff) return xff;
  const reel = headers.get("x-real-ip")?.trim();
  return reel || "unknown";
}
