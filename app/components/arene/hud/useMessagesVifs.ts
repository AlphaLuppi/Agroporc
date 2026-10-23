"use client";

/**
 * Alimente la région vive (`ZoneVive`) et le toast central à partir de l'état du HUD (§5.1, §5.8, §12) : « Éliminé par X », PV aux seuils
 * 50 et 25 (« PV critiques » en `assertive`, une fois par passage), « Bouclier N » / « Bouclier détruit », annonces d'Elsa, bonus ramassé,
 * « Chargeur bas » (une fois par passage sous le seuil), « Réserve épuisée » d'une arme spéciale, « Match terminé », paliers de minuterie.
 * Rien n'est annoncé au premier rendu ni au retour de la mort (les valeurs sont recalées sans bruit). La file anti-bavardage (un message
 * toutes les 2 s) est dans `useFileVive`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { STATS } from "@/lib/fps/armes";
import { niveauMunitions, parseSlots, PRIORITE_VIVE, texteBonus } from "@/lib/fps/hud-modele";
import type { HudEtat } from "@/lib/fps/jeu-types";
import type { ArmeSpecialeId, InfoMatch } from "@/lib/fps/protocole";
import type { Annonce, Bonus, DerniereMort } from "../contrats";
import { libelleCause } from "../armesInfo";

const DUREE_TOAST_MS = 2500;

export interface EntreesMessagesVifs {
  hud: HudEtat | null;
  derniereMort: DerniereMort | null;
  annonces: readonly Annonce[];
  bonus: Bonus | null;
  match: InfoMatch | null;
  /** libellé de la touche de l'arme spéciale (« 4 »), vide si aucune */
  toucheSpeciale: string;
  pousser(texte: string, priorite: number, assertif?: boolean): void;
}

export function useMessagesVifs(p: EntreesMessagesVifs): { toast: string | null; surPalier(secondes: number): void; afficher(texte: string): void } {
  const { hud, derniereMort, annonces, bonus, match, toucheSpeciale, pousser } = p;
  const [toast, setToast] = useState<{ id: number; texte: string } | null>(null);
  const idToast = useRef(0);
  const minuteurToast = useRef<ReturnType<typeof setTimeout> | null>(null);
  const afficherToast = useCallback((texte: string) => {
    const id = ++idToast.current;
    setToast({ id, texte });
    if (minuteurToast.current) clearTimeout(minuteurToast.current);
    minuteurToast.current = setTimeout(() => setToast((t) => (t?.id === id ? null : t)), DUREE_TOAST_MS);
  }, []);
  useEffect(() => () => { if (minuteurToast.current) clearTimeout(minuteurToast.current); }, []);

  const mort = hud?.mort ?? false;
  const pv = hud?.pv ?? 100;
  const bouclier = hud?.bouclier ?? 0;
  const arme = hud?.arme ?? null;
  const munitions = hud?.munitions ?? 0;
  const chargeur = hud?.chargeur ?? 0;
  const tireInterdit = hud?.tireInterdit ?? false;
  const slots = hud?.slots ?? "";
  const phase = match?.phase ?? null;

  /** vrai pendant la mort et jusqu'à la fin du rendu qui la suit : les valeurs sont recalées sans rien annoncer */
  const mortPrecedente = useRef(mort);

  // éliminé
  const derniereAnnoncee = useRef<DerniereMort | null>(null);
  useEffect(() => {
    if (!derniereMort || derniereAnnoncee.current === derniereMort) return;
    derniereAnnoncee.current = derniereMort;
    pousser(derniereMort.cause === "arme" ? `Éliminé par ${derniereMort.par}` : libelleCause(derniereMort.arme, derniereMort.cause, derniereMort.par), PRIORITE_VIVE.elimine);
  }, [derniereMort, pousser]);
  useEffect(() => { if (!derniereMort) derniereAnnoncee.current = null; }, [derniereMort]);

  // PV : seuils 50 et 25, une fois par passage
  const seuil50 = useRef(false);
  const seuil25 = useRef(false);
  useEffect(() => {
    if (mort || pv <= 0) return;
    if (pv > 50) seuil50.current = false;
    if (pv > 25) seuil25.current = false;
    if (pv <= 25 && !seuil25.current) {
      seuil25.current = true;
      seuil50.current = true;
      pousser("PV critiques", PRIORITE_VIVE.critique, true);
    } else if (pv <= 50 && pv > 25 && !seuil50.current) {
      seuil50.current = true;
      pousser("Moins de 50 PV", PRIORITE_VIVE.bouclier);
    }
  }, [pv, mort, pousser]);

  // bouclier : pris (≥ 10 d'un coup), détruit
  const bouclierPrecedent = useRef(bouclier);
  useEffect(() => {
    const avant = bouclierPrecedent.current;
    bouclierPrecedent.current = bouclier;
    if (mort || mortPrecedente.current) return;
    if (bouclier >= avant + 10) pousser(`Bouclier ${Math.round(bouclier)}`, PRIORITE_VIVE.bouclier);
    else if (avant > 0 && bouclier === 0) pousser("Bouclier détruit", PRIORITE_VIVE.bouclier);
  }, [bouclier, mort, pousser]);

  // annonces du fil (Elsa, refus d'un siège, tigres), celles des tigres (largage, tigre abattu, sort) passent aussi en toast
  const dernierIdAnnonce = useRef(0);
  useEffect(() => {
    for (const a of annonces) {
      if (a.id <= dernierIdAnnonce.current) continue;
      dernierIdAnnonce.current = a.id;
      pousser(a.texte, a.genre === "elsa" || a.genre === "tigre" ? PRIORITE_VIVE.elsa : PRIORITE_VIVE.info);
      if (a.genre === "tigre") afficherToast(a.texte);
    }
  }, [annonces, pousser, afficherToast]);

  // cadeau d'Elsa ramassé : toast + annonce
  const dernierBonus = useRef(0);
  useEffect(() => {
    if (!bonus || bonus.id === dernierBonus.current) return;
    dernierBonus.current = bonus.id;
    const texte = texteBonus(bonus.genre, bonus.arme, toucheSpeciale);
    afficherToast(texte);
    pousser(texte, PRIORITE_VIVE.bouclier);
  }, [bonus, toucheSpeciale, afficherToast, pousser]);

  // chargeur bas : une seule fois par passage sous le seuil (la rangée repart à « normal » après le rechargement)
  const suiviChargeur = useRef<{ arme: string | null; bas: boolean }>({ arme, bas: false });
  useEffect(() => {
    const s = suiviChargeur.current;
    const niveau = arme && arme !== "couteau" && !tireInterdit ? niveauMunitions(munitions, chargeur) : "normal";
    const bas = niveau !== "normal";
    if (s.arme !== arme) { suiviChargeur.current = { arme, bas }; return; }
    if (bas && !s.bas && !mort && !mortPrecedente.current) pousser("Chargeur bas", PRIORITE_VIVE.info);
    s.bas = bas;
  }, [arme, munitions, chargeur, tireInterdit, mort, pousser]);

  // arme spéciale épuisée : elle quitte le rack
  const speciale = useRef<ArmeSpecialeId | null>(null);
  useEffect(() => {
    const maintenant = parseSlots(slots).find((s) => s.slot === "speciale")?.arme ?? null;
    const avant = speciale.current;
    speciale.current = maintenant as ArmeSpecialeId | null;
    if (avant && !maintenant && !mort && !mortPrecedente.current) {
      afficherToast(`${STATS[avant].nom} épuisé`);
      pousser(`Réserve épuisée : ${STATS[avant].nom}`, PRIORITE_VIVE.bouclier);
    }
  }, [slots, mort, afficherToast, pousser]);

  // fin de match
  const phasePrecedente = useRef(phase);
  useEffect(() => {
    if (phasePrecedente.current === "jeu" && phase === "entracte") pousser("Match terminé", PRIORITE_VIVE.match);
    phasePrecedente.current = phase;
  }, [phase, pousser]);

  // ferme la fenêtre de silence une fois les effets ci-dessus passés (les effets d'un même rendu s'exécutent dans l'ordre)
  useEffect(() => {
    mortPrecedente.current = mort;
  }, [mort]);

  const surPalier = useCallback((s: number) => pousser(`${s} secondes restantes`, PRIORITE_VIVE.match), [pousser]);
  return { toast: toast?.texte ?? null, surPalier, afficher: afficherToast };
}
