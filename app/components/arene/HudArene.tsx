"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { JEU, estMelee } from "@/lib/fps/protocole";
import type { Action } from "@/lib/fps/touches";
import { libelleGain, niveauMunitions, syntheseMatch, texteRefusAchat } from "@/lib/fps/hud-modele";
import { LIBELLES_COINS, coinSuivant } from "@/lib/fps/reglages-hud";
import { useDisposition } from "./ReglageTouches";
import { aideChoixEquipement, armeSuivanteDuGroupe, groupePrincipale, groupeSecondaire } from "./lobby-modele";
import type { PropsHudArene } from "./contrats";
import AideCommandes, { toucheDe } from "./hud/AideCommandes";
import AnnoncesElsa from "./hud/AnnoncesElsa";
import BandeauEvenement from "./hud/BandeauEvenement";
import BandeauManche from "./hud/BandeauManche";
import CockpitTitan from "./hud/CockpitTitan";
import BarreMatch from "./hud/BarreMatch";
import BarreVague from "./hud/BarreVague";
import BlocArgent from "./hud/BlocArgent";
import BlocArmes from "./hud/BlocArmes";
import BlocVehicule from "./hud/BlocVehicule";
import BlocVie from "./hud/BlocVie";
import CoinHud from "./hud/CoinHud";
import EcranMort from "./hud/EcranMort";
import FilEliminations from "./hud/FilEliminations";
import FinDeMatch from "./hud/FinDeMatch";
import FinDePartieZombies from "./hud/FinDePartieZombies";
import GrandeCarte from "./hud/GrandeCarte";
import IconeSort from "./hud/IconeSort";
import InvitesAction from "./hud/InvitesAction";
import Lunette from "./hud/Lunette";
import BlocVoix from "./hud/BlocVoix";
import MenuPause from "./hud/MenuPause";
import MiniMap from "./hud/MiniMap";
import RetoursTouche from "./hud/RetoursTouche";
import TableauScores from "./hud/TableauScores";
import TableauZombies from "./hud/TableauZombies";
import ToastCentre from "./hud/ToastCentre";
import Viseur from "./hud/Viseur";
import ZoneVive, { useFileVive } from "./hud/ZoneVive";
import { useEphemere, useEtatZombies, useProgressionReanimation } from "./hud/useEtatZombies";
import { AnnonceZombies, AtoutsZombies, BonusActifs, CinematiqueZombies, IntroZombies, MancheCraie, NoteZombies, ObjectifZombies } from "./hud/PanneauZombies";
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
 * Zombies (`hud.mode === "zombies"`, v5) : `BarreVague` remplace `BarreMatch`, `BlocArgent` s'empile au-dessus de la vie, `InvitesAction` couvre achats et
 * relèves, `BandeauManche` annonce chaque manche, `EcranMort` devient « À terre » puis « Éliminé » (pas de killcam), `TableauZombies` remplace le tableau
 * de l'arène et `FinDePartieZombies` remplace `FinDeMatch`. L'état de la partie est lu toutes les 150 ms (`JeuHandle.zombies()`), jamais à 60 Hz.
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
  const [carteForcee, setCarteForcee] = useState(false);
  useEffect(() => {
    vueScoresRef.current(tab);
  }, [tab]);
  useEffect(() => () => vueScoresRef.current(false), []);

  const { chiffres, marqueur, kill } = useRetoursTouche(p.evenements);
  const rupture = useRupture(hud?.bouclier ?? 0, !hud?.mort);
  const vive = useFileVive();
  // ---- zombies : état de la partie lu à intervalle, gains, refus d'achat et annonce de manche éphémères ----
  const zombies = hud?.mode === "zombies";
  const ez = useEtatZombies(p.zombies, zombies);
  const partieZ = ez?.partie ?? null;
  const gainTexte = useEphemere(ez?.gain?.n ?? 0, ez?.gain ? libelleGain(ez.gain.delta, ez.gain.motif) : null, 1600);
  const refusTexte = useEphemere(ez?.refus?.n ?? 0, ez?.refus ? texteRefusAchat(ez.refus.raison) : null, 2600);
  const refusAchat = useMemo(() => (ez?.refus ? { n: ez.refus.n, texte: texteRefusAchat(ez.refus.raison) } : null), [ez?.refus?.n, ez?.refus?.raison]); // eslint-disable-line react-hooks/exhaustive-deps
  const mancheEnCours = partieZ?.phase === "manche" ? partieZ.manche : 0;
  const bandeauManche = useEphemere(mancheEnCours > 0 ? mancheEnCours : null, ez ? { manche: mancheEnCours, restants: ez.restants } : null, 4200);
  // (v7) annonces (bonus, courant, livraison…) et introduction de la partie
  const annonceZ = useEphemere(ez?.annonce?.n ?? 0, ez?.annonce ?? null, 3200);
  const introZ = useEphemere(partieZ?.phase === "pause" && partieZ.manche === 1 ? partieZ.debutT : null, true, 7600);
  const mesAtoutsZ = partieZ?.joueurs.find((j) => j.id === monId)?.atouts ?? [];
  const refReanim = useRef<HTMLSpanElement | null>(null);
  useProgressionReanimation(p.live, refReanim, zombies && !!hud?.reanime);
  const { toast, surPalier, afficher } = useMessagesVifs({
    hud, derniereMort, annonces: p.annonces, bonus: p.bonus, match,
    toucheSpeciale: toucheDe(p.touches, "armeSpeciale", disposition), pousser: vive.pousser, refusAchat,
  });
  const synthese = useMemo(() => syntheseMatch(joueurs, monId, match?.objectif ?? JEU.objectifKills), [joueurs, monId, match?.objectif]);
  // la frappe aérienne n'existe que dans l'arène (en zombies, une grenade enchaîne vite 5 kills sans rien débloquer)
  const frappeDisponible = !zombies && (synthese.serie >= 5 || !!hud?.frappeDisponible);

  useToucheAppui(verrouille && frappeDisponible, p.touches.frappeAerienne, () => {
    setCarteForcee((prev) => !prev);
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
  const choixEquipementActif = verrouille && !!hud && !zombies && (hud.mort || match?.phase === "entracte");
  useToucheAppui(choixEquipementActif, p.touches.armePrincipale, () => {
    const { equipement, sur } = equipRef.current;
    sur(armeSuivanteDuGroupe(groupePrincipale(), equipement.principale), equipement.secondaire);
  });
  useToucheAppui(choixEquipementActif, p.touches.armeSecondaire, () => {
    const { equipement, sur } = equipRef.current;
    sur(equipement.principale, armeSuivanteDuGroupe(groupeSecondaire(), equipement.secondaire));
  });

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
  const entracte = !zombies && match?.phase === "entracte";
  const aideEquipement = aideChoixEquipement(t("armePrincipale"), t("armeSecondaire"));
  /** zombies : partie perdue, le bilan occupe l'écran (la souris est rendue, le menu pause ne s'y superpose pas) */
  const finZ = zombies && partieZ?.phase === "fin";
  const pause = !hud.verrouille && !finZ;
  const premiereFois = pause && !dejaVerrouille.current;
  const combat = !hud.mort && !entracte && !finZ;
  const couteau = estMelee(hud.arme);
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
      {combat && hud.dansFumee && <div className={styles.fumeeOverlay} aria-hidden="true" />}
      {combat && degats.map((d) => (
        <div key={d.id} className={styles.degat} style={{ transform: `rotate(${d.angle}rad)` }} aria-hidden="true"><i /></div>
      ))}

      {combat && (
        <>
          {hud.lunette
            ? <Lunette zoomX={hud.zoomX} distanceVisee={hud.distanceVisee} niveau={hud.zoomNiveau} niveaux={hud.zoomNiveaux} toucheZoom={t("zoomLunette")} thermique={hud.viseur === "thermique"} />
            : <Viseur
                protege={hud.protege} conduite={conduite} couteau={couteau} recharge={hud.recharge} refAnneau={refAnneau} ecart={hud.ecartViseur}
                optique={hud.vise && (hud.viseur === "point_rouge" || hud.viseur === "holo") ? hud.viseur : null}
              />}
          <RetoursTouche chiffres={chiffres} marqueur={marqueur} kill={kill} />
          {!zombies && (
            <>
              <BarreMatch
                rang={synthese.rang} exAequo={synthese.exAequo} mesKills={synthese.mesKills} serie={synthese.serie}
                leaderPseudo={synthese.leader?.pseudo ?? ""} leaderCouleur={synthese.leader?.couleur ?? ""} leaderKills={synthese.leader?.kills ?? 0}
                jeMene={synthese.jeMene} egalite={synthese.egalite} ecart={synthese.ecart} pointDeMatch={synthese.pointDeMatch}
                objectif={match?.objectif ?? JEU.objectifKills} progressionLeader={synthese.progressionLeader} maProgression={synthese.maProgression}
                fin={match?.fin ?? null} maintenantServeur={maintenantServeur} surPalier={surPalier}
              />
              <AnnoncesElsa elsa={p.elsa} maintenantServeur={maintenantServeur} radar={radar} />
            </>
          )}
          <InvitesAction
            invite={hud.invite} inviteDetail={hud.inviteDetail} toucheInteragir={t("interagir")}
            inviteRecharge={inviteRecharge} toucheRecharger={t("recharger")}
            assez={hud.inviteAssez} reanime={hud.reanime} refReanim={refReanim}
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

      {/* zombies : vague et annonce de manche, visibles aussi à terre (la barre ne dépend pas de la vie) */}
      {zombies && !finZ && (
        <BarreVague
          phase={partieZ?.phase ?? (hud.manche ? "manche" : "lobby")} manche={partieZ?.manche ?? hud.manche ?? 0} restants={ez?.restants ?? hud.restants ?? 0}
          finT={partieZ?.finT ?? 0} maintenantServeur={maintenantServeur}
        />
      )}
      {zombies && !finZ && !pause && bandeauManche && <BandeauManche manche={bandeauManche.manche} restants={bandeauManche.restants} />}
      {zombies && !finZ && ez && <ObjectifZombies texte={ez.objectif} />}
      {zombies && !finZ && partieZ && <BonusActifs effets={partieZ.effets} maintenantServeur={maintenantServeur} />}
      {zombies && !finZ && !pause && annonceZ && <AnnonceZombies texte={annonceZ.texte} genre={annonceZ.genre} />}
      {zombies && !finZ && !pause && introZ && <IntroZombies />}
      {zombies && !finZ && !pause && ez?.note != null && <NoteZombies id={ez.note} touche={t("interagir")} />}
      {zombies && !finZ && ez?.cinematique != null && <CinematiqueZombies k={ez.cinematique} />}

      {/* cockpit du titan (v3) : sous tout le reste du HUD */}
      {combat && hud.titan && p.monstres && <CockpitTitan monstres={p.monstres} maintenantServeur={maintenantServeur} />}
      {/* événements (v3) : visibles aussi pendant la mort (le Truck vient de vous écraser : on veut savoir combien de temps il roule encore) */}
      {!entracte && p.monstres && <BandeauEvenement monstres={p.monstres} maintenantServeur={maintenantServeur} joueurs={joueurs} monId={monId} />}

      <CoinHud coin="hg" coinMinimap={coinMap} miniMap={miniMap} />
      <CoinHud coin="hd" coinMinimap={coinMap} miniMap={miniMap}>
        {combat && <FilEliminations fil={p.fil} annonces={p.annonces} />}
      </CoinHud>
      <CoinHud coin="bg" coinMinimap={coinMap} miniMap={miniMap}>
        {zombies && !finZ && <MancheCraie manche={partieZ?.manche ?? 0} truck={!!partieZ?.mancheTruck} />}
        {zombies && !finZ && <AtoutsZombies atouts={mesAtoutsZ} />}
        {zombies && !finZ && (
          <BlocArgent
            argent={ez?.argent ?? hud.argent ?? 0} gain={gainTexte} cleGain={ez?.gain?.n ?? 0} gainPositif={(ez?.gain?.delta ?? 0) > 0} refus={refusTexte}
          />
        )}
        {combat && frappeDisponible && !hud.titan && (
          <div className={styles.banniereFrappe}>
            ⚡ FRAPPE AÉRIENNE ({t("carte") || "M"})
          </div>
        )}
        {combat && hud.sort && !hud.titan && <IconeSort touche={t("invoquer")} />}
        {combat && !hud.titan && (
          <BlocVie
            pv={hud.pv} bouclier={hud.bouclier} regen={hud.regen} accroupi={hud.accroupi} glisse={hud.glisse} mur={hud.mur}
            protegeRestant={hud.protegeRestant} rupture={rupture} refTraitRegen={refRegen}
            {...(zombies ? { pvMax: ez?.pvMax ?? 100, regenParS: 60 } : {})}
          />
        )}
      </CoinHud>
      <CoinHud coin="bd" coinMinimap={coinMap} miniMap={miniMap}>
        {combat && !hud.titan && (
          <BlocArmes
            arme={hud.arme} slot={hud.slot} slots={hud.slots} munitions={hud.munitions} chargeur={hud.chargeur} reserve={hud.reserve}
            recharge={hud.recharge} degainage={hud.degainage} tireInterdit={hud.tireInterdit} bonusVitesse={hud.bonusVitesse}
            toucheP={t("armePrincipale")} toucheS={t("armeSecondaire")} toucheC={t("couteau")} toucheSp={t("armeSpeciale")}
            refBarre={refBarre} refTemps={refTemps} ameliorees={hud.ameliorees} munitionsG={hud.munitionsG}
            {...(zombies ? { grenades: ez?.grenades ?? 0, remontoirs: ez?.remontoirs ?? 0, cuisson: ez?.cuisson ?? null, toucheGrenade: t("grenade"), toucheRemontoir: t("remontoir") } : {})}
          />
        )}
      </CoinHud>

      {!hud.connecte && <p className={`${styles.plaque} ${styles.reseau}`} role="status">Connexion perdue, reconnexion…</p>}
      {!aideVue && hud.verrouille && !hud.mort && <AideCommandes touches={p.touches} disposition={disposition} mode={zombies ? "zombies" : "arene"} />}

      {/* mort : rejeu puis carte du tueur (EcranMort), sous le menu pause ; zombies : « À terre » puis « Éliminé » */}
      {hud.mort && !pause && !entracte && !finZ && (
        <EcranMort
          hud={hud} derniereMort={derniereMort} killcamInfo={p.killcamInfo} degatsAuTueur={p.degatsAuTueur}
          touches={p.touches} equipement={p.equipement} surEquipement={p.surEquipement} surPasserKillcam={p.surPasserKillcam}
          joueurs={joueurs} aideEquipement={aideEquipement} terreFinT={ez?.terreFinT} maintenantServeur={maintenantServeur}
        />
      )}

      {/* zombies : partie perdue (bilan, record, Rejouer / Quitter) */}
      {finZ && partieZ && (
        <FinDePartieZombies
          partie={partieZ} monId={monId} maintenantServeur={maintenantServeur}
          surRejouer={p.surRejouer ?? p.surQuitter} surQuitter={p.surQuitterVue ?? p.surQuitter}
        />
      )}

      {/* entracte (podium) ; Tab ouvre le tableau complet par-dessus */}
      {entracte && !tab && (
        <FinDeMatch
          joueurs={joueurs} stats={p.stats} classement={p.classement} monId={monId} match={match}
          maintenantServeur={maintenantServeur} equipement={p.equipement} surEquipement={p.surEquipement} aideEquipement={aideEquipement}
        />
      )}
      {tab && !finZ && (zombies && partieZ ? (
        <TableauZombies partie={partieZ} monId={monId} />
      ) : (
        <TableauScores
          joueurs={joueurs} stats={p.stats} classement={entracte ? p.classement : null} monId={monId} match={match}
          maintenantServeur={maintenantServeur}
        />
      ))}
      <GrandeCarte
        scene={p.scene ?? null}
        radar={radar}
        visible={(carteMaintenue || carteForcee) && !hud.mort && !pause}
        toucheCarte={t("carte") || "M"}
        effetsReduits={effetsReduits}
        frappeDisponible={frappeDisponible}
        surLancerFrappe={(cible) => {
          p.surLancerFrappe?.(cible);
          setCarteForcee(false);
        }}
      />

      {pause && (
        <MenuPause
          premiereFois={premiereFois} surReprendre={p.surReprendre} surQuitter={p.surQuitter}
          equipement={p.equipement} surEquipement={p.surEquipement} pseudo={p.pseudo} surPseudo={p.surPseudo}
          sensibilite={p.sensibilite} surSensibilite={p.surSensibilite}
          accroupiBascule={p.accroupiBascule} surAccroupiBascule={p.surAccroupiBascule} actionsSansTouche={p.actionsSansTouche}
          voix={p.voix} surVoix={p.surVoix} voixErreur={p.voixErreur} toucheParler={t("parler")}
          touches={p.touches} surTouches={p.surTouches} reglagesHud={p.reglagesHud} surReglagesHud={p.surReglagesHud}
          mode={zombies ? "zombies" : "arene"}
        />
      )}
    </div>
  );
}
