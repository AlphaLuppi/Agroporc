/**
 * Service Elsa de la salle (PUR) : apparition / expiration de l'offre, ramassage automatique par le premier joueur à portée (soin
 * complet ou arme spéciale), messages `elsa`, `ramassage`, `equipement`. Ne voit la salle que par `ContexteSalle`.
 * Spec : docs/superpowers/specs/2026-10-22-arene-v2-design.md (§2.7, §5.19, §6.1bis)
 */
import { avancerElsa, munitionsOffertes, peutRamasser, prendre, reinitialiserElsa, intervalleAleatoire } from "./elsa";
import type { EtatElsa, IntervalleElsa } from "./elsa";
import type { ContexteSalle, JoueurSalle, ServiceElsa, Sortie } from "./match-contexte";
import { JEU, type EtatElsaMsg } from "./protocole";
import { soinComplet } from "./sante";

export interface OptionsServiceElsa {
  x: number;
  z: number;
  intervalle?: IntervalleElsa;
  /**
   * Horloge de la salle à la création (ms) : arme le minuteur tout de suite. Sans elle, le minuteur est armé au premier `tic`
   * (la fabrique n'a pas d'horloge) : la première offre arrive alors un intervalle après ce tic.
   */
  maintenant?: number;
  /**
   * Le joueur est-il à pied ? (Elsa ne donne rien à un occupant de véhicule : sa position est celle du siège.) La salle passe
   * `(j) => !vehicules?.occupation(j.id)` ; par défaut tout joueur compte comme étant à pied.
   */
  aPied?: (j: JoueurSalle) => boolean;
}

export function creerServiceElsa(ctx: ContexteSalle, opts: OptionsServiceElsa): ServiceElsa {
  const { intervalle } = opts;
  // minuteur non armé (échéance infinie) tant qu'aucune horloge n'est connue
  const etat: EtatElsa = { x: opts.x, z: opts.z, prochaineT: Infinity, offre: null, compteur: 0 };
  let arme = false;
  const armer = (maintenant: number) => {
    etat.prochaineT = maintenant + intervalleAleatoire(ctx.alea, intervalle);
    arme = true;
  };
  if (opts.maintenant !== undefined) armer(opts.maintenant);
  /** nouveau match avec une offre en cours : tous les clients doivent apprendre qu'elle n'existe plus (envoyé au prochain tic) */
  let aDiffuser = false;

  const message = (): EtatElsaMsg => ({
    x: etat.x, z: etat.z,
    offre: etat.offre ? { id: etat.offre.id, genre: etat.offre.genre, ...(etat.offre.arme ? { arme: etat.offre.arme } : {}), finT: etat.offre.finT } : null,
  });
  const aPied = opts.aPied ?? (() => true);

  return {
    tic(maintenant) {
      const sorties: Sortie[] = [];
      if (aDiffuser) {
        aDiffuser = false;
        sorties.push({ a: "tous", m: { t: "elsa", evenement: "etat", elsa: message() } });
      }
      if (!arme) armer(maintenant);
      const phaseJeu = ctx.enPhaseJeu();
      const enArene = ctx.joueursEnJeu();
      const ev = avancerElsa(etat, maintenant, ctx.alea, phaseJeu && enArene.length >= 1, intervalle);
      if (ev?.type === "apparue") sorties.push({ a: "tous", m: { t: "elsa", evenement: "apparue", elsa: message() } });
      else if (ev?.type === "expiree") sorties.push({ a: "tous", m: { t: "elsa", evenement: "expiree", elsa: message() } });
      if (!etat.offre || !phaseJeu) return sorties;

      // premier joueur vivant, à pied et à portée (ordre de la salle) ; aucun message client : le serveur est l'autorité
      const j = enArene.find((c) => c.vivant && aPied(c) && peutRamasser(etat, c.p, maintenant));
      if (!j) return sorties;
      const offre = prendre(etat, maintenant, ctx.alea, intervalle);
      if (!offre) return sorties;
      sorties.push({ a: "tous", m: { t: "elsa", evenement: "prise", elsa: message() } });
      sorties.push({
        a: "tous",
        m: { t: "ramassage", offre: offre.id, par: j.id, genre: offre.genre, ...(offre.arme ? { arme: offre.arme } : {}) },
      });
      if (offre.genre === "arme" && offre.arme) {
        // l'arme spéciale remplace la précédente et passe en main ; elle sort avec le délai de dégainage normal
        ctx.memoriserPrecedent(j); // le retour à 0 munition se fait sur le slot tenu avant l'offre, comme côté client
        j.equip.speciale = offre.arme;
        j.munSpeciale = munitionsOffertes(offre.arme);
        j.main = "speciale";
        j.arme = offre.arme;
        delete j.cadenceArme[offre.arme];
        j.sortieJusqua = maintenant + JEU.degainageMs;
        sorties.push({ a: j.id, m: { t: "equipement", equip: { ...j.equip }, main: j.main, munSpeciale: j.munSpeciale } });
      } else {
        // PV et bouclier à 100 (le snap suivant porte les nouvelles valeurs)
        soinComplet(j);
      }
      return sorties;
    },

    reinitialiser(maintenant) {
      if (etat.offre) aDiffuser = true;
      reinitialiserElsa(etat, maintenant, ctx.alea, intervalle);
      arme = true;
    },

    synchro(idDest) {
      return [{ a: idDest, m: { t: "elsa", evenement: "etat", elsa: message() } }];
    },
  };
}
