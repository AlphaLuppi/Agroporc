"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { JEU } from "@/lib/fps/protocole";
import type { Action } from "@/lib/fps/touches";
import { niveauMunitions, syntheseMatch } from "@/lib/fps/hud-modele";
import { LIBELLES_COINS, coinSuivant } from "@/lib/fps/reglages-hud";
import { useDisposition } from "./ReglageTouches";
import { aideChoixEquipement, armeSuivanteDuGroupe, groupePrincipale, groupeSecondaire } from "./lobby-modele";
import type { PropsHudArene } from "./contrats";
import AideCommandes, { toucheDe } from "./hud/AideCommandes";
import AnnoncesElsa from "./hud/AnnoncesElsa";
import BandeauEvenement from "./hud/BandeauEvenement";
import CockpitTitan from "./hud/CockpitTitan";
import BarreMatch from "./hud/BarreMatch";
import BlocArmes from "./hud/BlocArmes";
import BlocVehicule from "./hud/BlocVehicule";
import BlocVie from "./hud/BlocVie";
import CoinHud from "./hud/CoinHud";
import EcranMort from "./hud/EcranMort";
import FilEliminations from "./hud/FilEliminations";
import FinDeMatch from "./hud/FinDeMatch";
import GrandeCarte from "./hud/GrandeCarte";
import IconeSort from "./hud/IconeSort";
import InvitesAction from "./hud/InvitesAction";
import Lunette from "./hud/Lunette";
import BlocVoix from "./hud/BlocVoix";
import MenuPause from "./hud/MenuPause";
import MiniMap from "./hud/MiniMap";
import RetoursTouche from "./hud/RetoursTouche";
import TableauScores from "./hud/TableauScores";
import ToastCentre from "./hud/ToastCentre";
import Viseur from "./hud/Viseur";
import ZoneVive, { useFileVive } from "./hud/ZoneVive";
import { useHudLive } from "./hud/useHudLive";
import { useMessagesVifs } from "./hud/useMessagesVifs";
import { useRetoursTouche } from "./hud/useRetoursTouche";
import { useRupture } from "./hud/useRupture";
import { useToucheAppui, useToucheMaintenue } from "./hud/useToucheMaintenue";
import styles from "./HudArene.module.css";

const CLE_AIDE = "pdj-fps-aide-vue";
const AIDE_APRES_MS = 12000;

function lireAideVue(): boolean {
  try { return localStorage.getItem(CLE_AIDE) === "1"; } catch { return false; }
}

/**
 * HUD de l'arène : orchestrateur (spec HUD §7.1). Il choisit l'écran (jeu, lunette, mort / killcam, entracte, scores, pause) et passe des
 * SCALAIRES aux blocs mémoïsés ; aucun calcul à 60 Hz ici : la vitesse, la progression du rechargement et le délai de régénération sont écrits
 * hors React par `useHudLive`, la mini-map dessine dans son propre canvas. La minuterie bat dans `BarreMatch`.
 * Quatre zones fixes : match en haut au centre, vie en bas à gauche, armes en bas à droite, éliminations en haut à droite ; la mini-map
 * s'empile dans le coin choisi sans jamais déplacer les chiffres vitaux. Pendant la mort (rejeu, carte du tueur) et l'entracte le HUD de combat
 * n'est pas rendu (retiré de l'arbre d'accessibilité) ; la mini-map reste en entracte.
 */
export default function HudArene(p: PropsHudArene) {
  const { hud, monId, joueurs, match, derniereMort } = p;
  const disposition = useDisposition();
  const [aideVue, setAideVue] = useState(lireAideVue);
  const dejaVerrouille = useRef(false);

  // les fonctions de l'hôte changent à chaque rendu : les blocs mémoïsés reçoivent des versions stables
  const radarRef = useRef(p.radar);
  radarRef.current = p.radar;
  const radar = useCallback(() => radarRef.current(), []);
  const horlogeRef = useRef(p.maintenantServeur);
  horlogeRef.current = p.maintenantServeur;
  const maintenantServeur = useCallback(() => horlogeRef.current(), []);
  const vueScoresRef = useRef(p.surVueScores);
  vueScoresRef.current = p.surVueScores;

  // valeurs continues écrites hors React sur leurs éléments
  const refAnneau = useRef<HTMLDivElement | null>(null);
  const refBarre = useRef<HTMLDivElement | null>(null);
  const refTemps = useRef<HTMLSpanElement | null>(null);
  const refRegen = useRef<HTMLDivElement | null>(null);
  const refVitesse = useRef<HTMLSpanElement | null>(null);
  const refKmh = useRef<HTMLElement | null>(null);
  useHudLive(p.live, { anneauRecharge: refAnneau, barreRecharge: refBarre, tempsRecharge: refTemps, traitRegen: refRegen, vitesse: refVitesse, kmh: refKmh }, !!hud);

  // Tab = scores et M = grande carte, seulement souris prise (menu pause ouvert, il garde sa navigation au clavier)
  const verrouille = !!hud?.verrouille;
  const tab = useToucheMaintenue(verrouille, p.touches.scores);
  const carteMaintenue = useToucheMaintenue(verrouille, p.touches.carte);
  useEffect(() => {
    vueScoresRef.current(tab);
  }, [tab]);
  useEffect(() => () => vueScoresRef.current(false), []);

  const { chiffres, marqueur, kill } = useRetoursTouche(p.evenements);
  const rupture = useRupture(hud?.bouclier ?? 0, !hud?.mort);
  const vive = useFileVive();
  const { toast, surPalier, afficher } = useMessagesVifs({
    hud, derniereMort, annonces: p.annonces, bonus: p.bonus, match,
    toucheSpeciale: toucheDe(p.touches, "armeSpeciale", disposition), pousser: vive.pousser,
  });
  // Coin suivant de la mini-carte (action « minimapCoin ») : réglage enregistré par l'hôte + toast « Mini-carte : bas-gauche »
  const reglagesRef = useRef(p.reglagesHud);
  reglagesRef.current = p.reglagesHud;
  const surReglagesRef = useRef(p.surReglagesHud);
  surReglagesRef.current = p.surReglagesHud;
  useToucheAppui(verrouille, p.touches.minimapCoin, () => {
    const r = reglagesRef.current;
    const coin = coinSuivant(r.minimap.coin);
    surReglagesRef.current({ ...r, minimap: { ...r.minimap, coin } });
    afficher(coin === "off" ? "Mini-carte masquée" : `Mini-carte : ${LIBELLES_COINS[coin].toLowerCase()}`);
  });
  // Écran de mort et entracte : la souris est prise, les boutons du sélecteur d'équipement sont inatteignables ; les touches d'arme
  // principale / secondaire passent à l'arme suivante de leur catégorie (l'équipement est celui de la prochaine apparition).
  const equipRef = useRef({ equipement: p.equipement, sur: p.surEquipement });
  equipRef.current = { equipement: p.equipement, sur: p.surEquipement };
  const choixEquipementActif = verrouille && !!hud && (hud.mort || match?.phase === "entracte");
  useToucheAppui(choixEquipementActif, p.touches.armePrincipale, () => {
    const { equipement, sur } = equipRef.current;
    sur(armeSuivanteDuGroupe(groupePrincipale(), equipement.principale), equipement.secondaire);
  });
  useToucheAppui(choixEquipementActif, p.touches.armeSecondaire, () => {
    const { equipement, sur } = equipRef.current;
    sur(equipement.principale, armeSuivanteDuGroupe(groupeSecondaire(), equipement.secondaire));
  });
  const synthese = useMemo(() => syntheseMatch(joueurs, monId, match?.objectif ?? JEU.objectifKills), [joueurs, monId, match?.objectif]);

  if (hud?.verrouille) dejaVerrouille.current = true;
  // Aide des commandes au premier lancement : 12 s après la prise de la souris.
  useEffect(() => {
    if (aideVue || !verrouille) return;
    const t = setTimeout(() => {
      setAideVue(true);
      try { localStorage.setItem(CLE_AIDE, "1"); } catch { /* stockage indisponible */ }
    }, AIDE_APRES_MS);
    return () => clearTimeout(t);
  }, [aideVue, verrouille]);

  if (!hud) return null;

  const t = (a: Action) => toucheDe(p.touches, a, disposition);
  const entracte = match?.phase === "entracte";
  const aideEquipement = aideChoixEquipement(t("armePrincipale"), t("armeSecondaire"));
  const pause = !hud.verrouille;
  const premiereFois = pause && !dejaVerrouille.current;
  const combat = !hud.mort && !entracte;
  const couteau = hud.arme === "couteau";
  const conduite = hud.vehicule && hud.tireInterdit;
  const inviteRecharge = combat && !hud.titan && !couteau && !hud.tireInterdit && !hud.recharge && ["critique", "vide"].includes(niveauMunitions(hud.munitions, hud.chargeur));
  const reglMap = p.reglagesHud.minimap;
  const coinMap = reglMap.coin;
  const effetsReduits = p.reglagesHud.interface.effets === "reduits";
  const degats = p.evenements.filter((e): e is Extract<typeof e, { type: "degat" }> => e.type === "degat");

  const miniMap = coinMap === "off" ? null : (
    <div className={styles.miniMapCadre} hidden={hud.mort}>
      <MiniMap scene={p.scene ?? null} radar={radar} reglages={reglMap} masque={hud.mort} toucheCarte={t("carte") || "M"} effetsReduits={effetsReduits} />
    </div>
  );

  return (
    <div
      className={styles.hud}
      data-effets={p.reglagesHud.interface.effets}
      data-taille={reglMap.taille}
      data-tableau={tab ? "oui" : "non"}
      style={{ "--echelle-hud": p.reglagesHud.interface.echelle } as CSSProperties}
    >
      <ZoneVive message={vive.courant} />

      {combat && hud.pv <= 30 && <div className={styles.sang} aria-hidden="true" />}
      {combat && rupture && <div className={styles.vignetteBouclier} aria-hidden="true" />}
      {combat && degats.map((d) => (
        <div key={d.id} className={styles.degat} style={{ transform: `rotate(${d.angle}rad)` }} aria-hidden="true"><i /></div>
      ))}

      {combat && (
        <>
          {hud.lunette
            ? <Lunette zoomX={hud.zoomX} distanceVisee={hud.distanceVisee} niveau={hud.zoomNiveau} niveaux={hud.zoomNiveaux} toucheZoom={t("zoomLunette")} />
            : <Viseur protege={hud.protege} conduite={conduite} couteau={couteau} recharge={hud.recharge} refAnneau={refAnneau} ecart={hud.ecartViseur} />}
          <RetoursTouche chiffres={chiffres} marqueur={marqueur} kill={kill} />
          <BarreMatch
            rang={synthese.rang} exAequo={synthese.exAequo} mesKills={synthese.mesKills} serie={synthese.serie}
            leaderPseudo={synthese.leader?.pseudo ?? ""} leaderCouleur={synthese.leader?.couleur ?? ""} leaderKills={synthese.leader?.kills ?? 0}
            jeMene={synthese.jeMene} egalite={synthese.egalite} ecart={synthese.ecart} pointDeMatch={synthese.pointDeMatch}
            objectif={match?.objectif ?? JEU.objectifKills} progressionLeader={synthese.progressionLeader} maProgression={synthese.maProgression}
            fin={match?.fin ?? null} maintenantServeur={maintenantServeur} surPalier={surPalier}
          />
          <AnnoncesElsa elsa={p.elsa} maintenantServeur={maintenantServeur} radar={radar} />
          <InvitesAction
            invite={hud.invite} inviteDetail={hud.inviteDetail} toucheInteragir={t("interagir")}
            inviteRecharge={inviteRecharge} toucheRecharger={t("recharger")}
          />
          {toast && <ToastCentre texte={toast} />}
          <div className={styles.milieu}>
            {hud.voix && <BlocVoix etat={hud.voix} parlants={hud.voixParlants} mode={p.voix.mode} toucheParler={t("parler")} />}
            {hud.vehicule ? (
              <BlocVehicule
                siege={hud.siege} vehiculeId={hud.vehiculeId} sieges={p.sieges} joueurs={joueurs} monId={monId}
                toucheInteragir={t("interagir")} toucheSiege={t("siege")} refKmh={refKmh}
              />
            ) : !hud.titan ? (
              <p className={styles.course}>COURSE <span ref={refVitesse} /></p>
            ) : null}
            {!pause && !hud.titan && <p className={styles.aideBas} aria-hidden="true">{t("scores")} : scores · {t("carte")} : carte</p>}
          </div>
        </>
      )}

      {/* cockpit du titan (v3) : sous tout le reste du HUD */}
      {combat && hud.titan && p.monstres && <CockpitTitan monstres={p.monstres} maintenantServeur={maintenantServeur} />}
      {/* événements (v3) : visibles aussi pendant la mort (le Truck vient de vous écraser : on veut savoir combien de temps il roule encore) */}
      {!entracte && p.monstres && <BandeauEvenement monstres={p.monstres} maintenantServeur={maintenantServeur} joueurs={joueurs} monId={monId} />}

      <CoinHud coin="hg" coinMinimap={coinMap} miniMap={miniMap} />
      <CoinHud coin="hd" coinMinimap={coinMap} miniMap={miniMap}>
        {combat && <FilEliminations fil={p.fil} annonces={p.annonces} />}
      </CoinHud>
      <CoinHud coin="bg" coinMinimap={coinMap} miniMap={miniMap}>
        {combat && hud.sort && !hud.titan && <IconeSort touche={t("invoquer")} />}
        {combat && !hud.titan && (
          <BlocVie
            pv={hud.pv} bouclier={hud.bouclier} regen={hud.regen} accroupi={hud.accroupi} glisse={hud.glisse} mur={hud.mur}
            protegeRestant={hud.protegeRestant} rupture={rupture} refTraitRegen={refRegen}
          />
        )}
      </CoinHud>
      <CoinHud coin="bd" coinMinimap={coinMap} miniMap={miniMap}>
        {combat && !hud.titan && (
          <BlocArmes
            arme={hud.arme} slot={hud.slot} slots={hud.slots} munitions={hud.munitions} chargeur={hud.chargeur} reserve={hud.reserve}
            recharge={hud.recharge} degainage={hud.degainage} tireInterdit={hud.tireInterdit} bonusVitesse={hud.bonusVitesse}
            toucheP={t("armePrincipale")} toucheS={t("armeSecondaire")} toucheC={t("couteau")} toucheSp={t("armeSpeciale")}
            refBarre={refBarre} refTemps={refTemps}
          />
        )}
      </CoinHud>

      {!hud.connecte && <p className={`${styles.plaque} ${styles.reseau}`} role="status">Connexion perdue, reconnexion…</p>}
      {!aideVue && hud.verrouille && !hud.mort && <AideCommandes touches={p.touches} disposition={disposition} />}

      {/* mort : rejeu puis carte du tueur (EcranMort), sous le menu pause */}
      {hud.mort && !pause && !entracte && (
        <EcranMort
          hud={hud} derniereMort={derniereMort} killcamInfo={p.killcamInfo} degatsAuTueur={p.degatsAuTueur}
          touches={p.touches} equipement={p.equipement} surEquipement={p.surEquipement} surPasserKillcam={p.surPasserKillcam}
          joueurs={joueurs} aideEquipement={aideEquipement}
        />
      )}

      {/* entracte (podium) ; Tab ouvre le tableau complet par-dessus */}
      {entracte && !tab && (
        <FinDeMatch
          joueurs={joueurs} stats={p.stats} classement={p.classement} monId={monId} match={match}
          maintenantServeur={maintenantServeur} equipement={p.equipement} surEquipement={p.surEquipement} aideEquipement={aideEquipement}
        />
      )}
      {tab && (
        <TableauScores
          joueurs={joueurs} stats={p.stats} classement={entracte ? p.classement : null} monId={monId} match={match}
          maintenantServeur={maintenantServeur}
        />
      )}
      <GrandeCarte scene={p.scene ?? null} radar={radar} visible={carteMaintenue && !hud.mort && !pause} toucheCarte={t("carte") || "M"} effetsReduits={effetsReduits} />

      {pause && (
        <MenuPause
          premiereFois={premiereFois} surReprendre={p.surReprendre} surQuitter={p.surQuitter}
          equipement={p.equipement} surEquipement={p.surEquipement} pseudo={p.pseudo} surPseudo={p.surPseudo}
          sensibilite={p.sensibilite} surSensibilite={p.surSensibilite}
          accroupiBascule={p.accroupiBascule} surAccroupiBascule={p.surAccroupiBascule} actionsSansTouche={p.actionsSansTouche}
          voix={p.voix} surVoix={p.surVoix} voixErreur={p.voixErreur} toucheParler={t("parler")}
          touches={p.touches} surTouches={p.surTouches} reglagesHud={p.reglagesHud} surReglagesHud={p.surReglagesHud}
        />
      )}
    </div>
  );
}
