"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { HudEtat } from "@/lib/fps/jeu";
import { ARMES, JEU, type ArmeId, type InfoMatch, type JoueurPublic, type LigneClassement } from "@/lib/fps/protocole";
import { STATS } from "@/lib/fps/armes";
import { chrono, ecartViseurPx } from "@/lib/fps/vue";
import type { DerniereMort, EntreeFil, EvenementHud } from "./useArene";
import { INFOS_ARMES } from "./armesInfo";
import ReglageTouches, { useDisposition } from "./ReglageTouches";
import { libelleTouche, type Action, type ConfigTouches } from "@/lib/fps/touches";
import styles from "./HudArene.module.css";

const CLE_AIDE = "pdj-fps-aide-vue";

interface Props {
  hud: HudEtat | null;
  monId: string | null;
  joueurs: JoueurPublic[];
  match: InfoMatch | null;
  classement: LigneClassement[] | null;
  fil: EntreeFil[];
  evenements: EvenementHud[];
  derniereMort: DerniereMort | null;
  maintenantServeur(): number;
  sensibilite: number;
  surSensibilite(x: number): void;
  /** touches du joueur (lib/fps/touches.ts), modifiables dans le menu pause */
  touches: ConfigTouches;
  surTouches(cfg: ConfigTouches): void;
  /** nom saisi, modifiable en pleine partie depuis le menu pause */
  pseudo: string;
  surPseudo(v: string): void;
  surReprendre(): void;
  surChoisirArme(a: ArmeId): void;
  surQuitter(): void;
}

/** Touche principale d'une action (sinon la seconde), pour les aides à l'écran. */
const touche = (cfg: ConfigTouches, a: Action, d?: ReadonlyMap<string, string> | null) => libelleTouche(cfg[a][0] ?? cfg[a][1], d);

/** Aide du premier lancement, d'après les touches du joueur. */
function commandes(cfg: ConfigTouches, d: ReadonlyMap<string, string> | null): [string, string][] {
  return [
    [[touche(cfg, "avant", d), touche(cfg, "gauche", d), touche(cfg, "arriere", d), touche(cfg, "droite", d)].join(" "), "Se déplacer"],
    ["Souris", "Viser"],
    [touche(cfg, "tir", d), "Tirer (maintenir : rafale)"],
    [touche(cfg, "visee", d), "Viser / lunette"],
    [touche(cfg, "saut", d), "Sauter, double saut, saut de mur"],
    [touche(cfg, "sprint", d), "Sprinter"],
    [touche(cfg, "recharger", d), "Recharger"],
  ];
}

function lireAideVue(): boolean {
  try { return localStorage.getItem(CLE_AIDE) === "1"; } catch { return false; }
}

/** Vrai pendant que la touche des scores (Tab par défaut) est maintenue ; le navigateur ne déplace pas le focus. */
function useTabMaintenue(actif: boolean, codes: readonly (string | null)[]): boolean {
  const [tab, setTab] = useState(false);
  const cle = codes.join(",");
  useEffect(() => {
    if (!actif) return;
    const liste = cle.split(",").filter(Boolean);
    const bas = (e: KeyboardEvent) => { if (liste.includes(e.code)) { e.preventDefault(); setTab(true); } };
    const haut = (e: KeyboardEvent) => { if (liste.includes(e.code)) { e.preventDefault(); setTab(false); } };
    const perdu = () => setTab(false);
    window.addEventListener("keydown", bas);
    window.addEventListener("keyup", haut);
    window.addEventListener("blur", perdu);
    return () => {
      window.removeEventListener("keydown", bas);
      window.removeEventListener("keyup", haut);
      window.removeEventListener("blur", perdu);
      setTab(false);
    };
  }, [actif, cle]);
  return tab;
}

export default function HudArene(p: Props) {
  const { hud, monId, joueurs, match, classement, fil, evenements, derniereMort, maintenantServeur } = p;
  const [, setTick] = useState(0);
  const [hauteur, setHauteur] = useState(() => (typeof window === "undefined" ? 900 : window.innerHeight));
  const [aideVue, setAideVue] = useState(lireAideVue);
  const dejaVerrouille = useRef(false);
  // Tab = scores seulement souris prise : menu pause ouvert, il garde sa navigation au clavier.
  const tab = useTabMaintenue(!!hud?.verrouille, p.touches.scores);
  const disposition = useDisposition();

  // La minuterie avance même quand le jeu n'émet rien.
  useEffect(() => {
    const i = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(i);
  }, []);
  useEffect(() => {
    const f = () => setHauteur(window.innerHeight);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  if (hud?.verrouille) dejaVerrouille.current = true;

  // Aide des commandes au premier lancement : 12 s après la prise de la souris.
  useEffect(() => {
    if (aideVue || !hud?.verrouille) return;
    const t = setTimeout(() => {
      setAideVue(true);
      try { localStorage.setItem(CLE_AIDE, "1"); } catch { /* stockage indisponible */ }
    }, 12000);
    return () => clearTimeout(t);
  }, [aideVue, hud?.verrouille]);

  if (!hud) return null;

  const moi = joueurs.find((j) => j.id === monId);
  const restant = match?.fin != null ? match.fin - maintenantServeur() : null;
  const entracte = match?.phase === "entracte";
  const prochainDans = match?.prochain != null ? Math.max(0, Math.ceil((match.prochain - maintenantServeur()) / 1000)) : 0;
  const ecart = Math.max(3, ecartViseurPx(hud.dispersion, hud.fov, hauteur));
  const classePv = hud.pv > 50 ? "" : hud.pv > 25 ? styles.pvMoyen : styles.pvBas;
  const dernierImpact = [...evenements].reverse().find((e) => e.type === "touche" || e.type === "kill");
  const degats = evenements.filter((e): e is Extract<EvenementHud, { type: "degat" }> => e.type === "degat");

  const lignes: LigneClassement[] = entracte && classement
    ? classement
    : joueurs
        .filter((j) => j.enJeu)
        .sort((a, b) => b.kills - a.kills || a.morts - b.morts || a.pseudo.localeCompare(b.pseudo, "fr"))
        .map((j) => ({ id: j.id, pseudo: j.pseudo, couleur: j.couleur, kills: j.kills, morts: j.morts }));
  const pings = new Map(joueurs.map((j) => [j.id, j.ping]));
  const tableau = tab || entracte;
  const pause = !hud.verrouille;
  const premiereFois = pause && !dejaVerrouille.current;

  return (
    <div className={styles.hud}>
      {hud.pv <= 30 && !hud.mort && <div className={styles.sang} aria-hidden="true" />}

      {/* lunette du sniper */}
      {hud.lunette && !hud.mort && (
        <div className={styles.lunette} aria-hidden="true">
          <i className={styles.lunetteH} /><i className={styles.lunetteV} />
        </div>
      )}

      {/* viseur dynamique */}
      {!hud.lunette && !hud.mort && (
        <div className={`${styles.viseur} ${hud.protege ? styles.viseurProtege : ""}`} aria-hidden="true" style={{ "--ecart": `${ecart}px` } as CSSProperties}>
          <i className={styles.tHaut} /><i className={styles.tBas} /><i className={styles.tGauche} /><i className={styles.tDroite} />
          <i className={styles.point} />
        </div>
      )}

      {/* retours de touche et de kill */}
      {dernierImpact && (
        <div
          key={dernierImpact.id}
          className={`${styles.touche} ${dernierImpact.type === "kill" ? styles.toucheKill : dernierImpact.zone === "tete" ? styles.toucheTete : ""}`}
          aria-hidden="true"
        >
          <i /><i /><i /><i />
        </div>
      )}

      {/* indicateurs de dégâts directionnels */}
      {degats.map((d) => (
        <div key={d.id} className={styles.degat} style={{ transform: `rotate(${d.angle}rad)` }} aria-hidden="true"><i /></div>
      ))}

      {/* haut : minuterie et score */}
      <div className={styles.haut}>
        <div className={styles.minuterie} aria-label="Temps restant">
          <b>{restant != null ? chrono(restant) : "—:——"}</b>
          <span>Premier à {match?.objectif ?? JEU.objectifKills}</span>
        </div>
        {moi && (
          <div className={styles.score} aria-label="Vos kills et morts">
            <span><b>{moi.kills}</b> kills</span><span><b>{moi.morts}</b> morts</span>
          </div>
        )}
      </div>

      {/* fil des kills */}
      <ul className={styles.fil} aria-label="Éliminations">
        {fil.map((f) => (
          <li key={f.id} className={f.moi ? styles.filMoi : ""}>
            <b style={{ color: f.parCouleur }}>{f.par}</b>
            <span className={styles.filArme}>{f.tete && <span title="Tir à la tête" aria-label="Tir à la tête">◎ </span>}[{INFOS_ARMES[f.arme].nom}]</span>
            <b style={{ color: f.cibleCouleur }}>{f.cible}</b>
          </li>
        ))}
      </ul>

      {/* bas gauche : vie */}
      <div className={`${styles.vie} ${classePv}`}>
        <div className={styles.pv} aria-label={`Points de vie : ${hud.pv}`}><b>{hud.pv}</b><span>PV</span></div>
        <div className={styles.pvBarre}><i style={{ width: `${Math.max(0, Math.min(100, hud.pv))}%` }} /></div>
        {hud.protege && <p className={styles.etiquette}>Protégé</p>}
      </div>

      {/* bas centre : vitesse et wall-run */}
      <div className={styles.milieu}>
        {hud.mur && <p className={`${styles.etiquette} ${styles.etiquetteMur}`}>Wall-run</p>}
        <p className={styles.vitesse}>{hud.vitesse.toFixed(0)} <span>m/s</span></p>
      </div>

      {/* bas droite : arme et munitions */}
      <div className={styles.arme}>
        <p className={styles.armeNom}>{STATS[hud.arme].nom}</p>
        <p className={`${styles.munitions} ${hud.munitions === 0 ? styles.munitionsVides : ""}`} aria-label={`${hud.munitions} munitions sur ${hud.chargeur}`}>
          <b>{hud.munitions}</b><span> / {hud.chargeur}</span>
        </p>
        {hud.recharge > 0 && (
          <div className={styles.recharge} role="progressbar" aria-label="Rechargement" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hud.recharge * 100)}>
            <i style={{ width: `${hud.recharge * 100}%` }} />
          </div>
        )}
        {hud.munitions === 0 && hud.recharge === 0 && <p className={styles.etiquette}>{touche(p.touches, "recharger", disposition)} : recharger</p>}
        {hud.armeSuivante !== hud.arme && <p className={styles.suivante}>Prochaine : {STATS[hud.armeSuivante].nom}</p>}
      </div>

      {!hud.connecte && <p className={styles.reseau} role="status">Connexion perdue, reconnexion…</p>}

      {/* aide au premier lancement */}
      {!aideVue && hud.verrouille && !hud.mort && (
        <div className={styles.aide} aria-hidden="true">
          {commandes(p.touches, disposition).map(([k, v]) => (<p key={v}><kbd>{k}</kbd> {v}</p>))}
        </div>
      )}
      {hud.verrouille && !tableau && <p className={styles.tabAstuce} aria-hidden="true">{touche(p.touches, "scores", disposition)} : scores</p>}

      {/* écran de mort */}
      {hud.mort && !pause && (
        <div className={styles.mort}>
          {hud.reapparitionDans > 0 || derniereMort ? (
            <>
              <p className={styles.mortTitre} role="status">Éliminé</p>
              {derniereMort && (
                <p className={styles.mortPar}>
                  par <b style={{ color: derniereMort.parCouleur }}>{derniereMort.par}</b> · {INFOS_ARMES[derniereMort.arme].nom}{derniereMort.zone === "tete" && " · tir à la tête"}
                </p>
              )}
              <p className={styles.mortDelai}>{hud.reapparitionDans > 0 ? <>Réapparition dans <b>{hud.reapparitionDans.toFixed(1)}</b> s</> : "Réapparition…"}</p>
            </>
          ) : (
            <p className={styles.mortTitre}>Apparition…</p>
          )}
          <div className={styles.choixArme} role="group" aria-label="Arme de la prochaine apparition">
            {ARMES.map((id, i) => (
              <button key={id} type="button" aria-pressed={hud.armeSuivante === id} onClick={() => p.surChoisirArme(id)}>
                <kbd>{touche(p.touches, `arme${i + 1}` as Action)}</kbd> {INFOS_ARMES[id].nom}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* tableau des scores (Tab ou fin de match) */}
      {tableau && (
        <section className={styles.scores} aria-label="Tableau des scores">
          {entracte ? (
            <>
              <h2>Match terminé</h2>
              {lignes[0] && <p className={styles.gagnant}>Vainqueur : <b style={{ color: lignes[0].couleur }}>{lignes[0].pseudo}</b> ({lignes[0].kills} kills)</p>}
              <p className={styles.prochain}>Prochain match dans <b>{prochainDans}</b> s</p>
            </>
          ) : (
            <h2>Scores</h2>
          )}
          <table>
            <thead><tr><th>#</th><th>Agent</th><th>Kills</th><th>Morts</th><th>Ping</th></tr></thead>
            <tbody>
              {lignes.length === 0 && <tr><td colSpan={5}>Personne en jeu.</td></tr>}
              {lignes.map((l, i) => (
                <tr key={l.id} className={l.id === monId ? styles.moi : ""}>
                  <td>{i + 1}</td>
                  <td className={styles.agent}><i style={{ background: l.couleur, boxShadow: `0 0 8px ${l.couleur}` }} aria-hidden="true" />{l.pseudo}</td>
                  <td>{l.kills}</td><td>{l.morts}</td><td>{pings.get(l.id) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* menu pause : la souris est libérée */}
      {pause && (
        <div className={styles.pause} onClick={(e) => { if (e.target === e.currentTarget) p.surReprendre(); }}>
          <div className={styles.pausePanneau} role="group" aria-label="Menu pause">
            <h2>{premiereFois ? "Prêt ?" : "Pause"}</h2>
            <p className={styles.pauseTexte}>{premiereFois ? "Cliquez pour prendre la souris et jouer." : "La partie continue : vous êtes toujours dans l'arène."}</p>
            <button type="button" className={styles.reprendre} autoFocus onClick={p.surReprendre}>{premiereFois ? "Jouer" : "Reprendre"}</button>
            <div className={styles.pauseArmes} role="group" aria-label="Changer d'arme (prochaine apparition)">
              <span>Changer d&apos;arme</span>
              {ARMES.map((id, i) => (
                <button key={id} type="button" aria-pressed={hud.armeSuivante === id} onClick={() => p.surChoisirArme(id)}>
                  <kbd>{touche(p.touches, `arme${i + 1}` as Action)}</kbd> {INFOS_ARMES[id].nom}
                </button>
              ))}
            </div>
            <label className={styles.sens}>
              <span>Nom de joueur</span>
              <input
                type="text"
                className={styles.nom}
                value={p.pseudo}
                maxLength={16}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => p.surPseudo(e.target.value)}
              />
            </label>
            <label className={styles.sens}>
              <span>Sensibilité de la souris <b>{p.sensibilite.toFixed(1)}</b></span>
              <input type="range" min={0.2} max={3} step={0.1} value={p.sensibilite} onChange={(e) => p.surSensibilite(Number(e.target.value))} />
            </label>
            <button type="button" className={styles.quitter} onClick={p.surQuitter}>Quitter l&apos;arène</button>
            <ReglageTouches config={p.touches} surChange={p.surTouches} />
          </div>
        </div>
      )}
    </div>
  );
}
