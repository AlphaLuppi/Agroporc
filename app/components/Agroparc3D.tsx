"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Chakra_Petch, IBM_Plex_Mono } from "next/font/google";
import type { Carte, PdjEntry, Plat } from "@/lib/db";
import type { Poi, SceneData } from "@/lib/agroparc3d/types";
import type { JoueurAerien, SceneHandle } from "@/lib/agroparc3d/scene";
import type { JeuHandle, HudEtat } from "@/lib/fps/jeu";
import type { HudLive } from "@/lib/fps/jeu-types";
import type { ArmeFeuId, ArmePrincipaleId, ArmeSecondaireId, Slot, Vec3 } from "@/lib/fps/protocole";
import { ecrireEquipement, estPrincipale, estSecondaire, lireEquipement } from "@/lib/fps/equipement";
import { creerRadarFrame } from "@/lib/fps/radar";
import { nomPersonnage } from "@/lib/characters";
import { lireCachettes, type Cachette, type FichierCachettes } from "@/lib/agroparc3d/cachettes";
import { etatRestaurant } from "@/lib/agroparc3d/panneau";
import { couleurNote, remplissage } from "@/lib/agroparc3d/jauge";
import { MODE_LABEL, noteMode, trierCarte, type Mode } from "@/lib/carte-tri";
import { useModeSite } from "@/app/menus/useModeSite";
import { variantesPlat, type VariantePlat } from "@/lib/plat-options";
import { restoParNom } from "@/lib/restaurants";
import { CLE_CLASSEMENT, messageEnregistre } from "@/lib/tigre-scores";
import RestoBadge from "./RestoBadge";
import Arene from "./arene/Arene";
import HudArene from "./arene/HudArene";
import { useArene } from "./arene/useArene";
import type { EquipementChoisi } from "./arene/contrats";
import { actionsSansTouche, ecrireTouches, lireTouches, stockageNavigateur, type ConfigTouches } from "@/lib/fps/touches";
import { ecrireReglagesVoix, lireReglagesVoix, type ReglagesVoix } from "@/lib/fps/voix";
import { useReglagesHud } from "./arene/hud/useReglagesHud";
import { CLASSEMENT_INDISPONIBLE, EnregistrerScore, PanneauClassement } from "./ClassementTigre";
import styles from "./Agroparc3D.module.css";

const display = Chakra_Petch({ subsets: ["latin"], weight: ["400", "600", "700"], variable: "--ag-display", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--ag-mono", display: "swap" });

interface Ev { id: number; time: string; tag: string; text: string }

/** Score de la chasse au tigre, gardé par `MyrtilleEasterEgg` : il survit à la fermeture de la vue. */
export interface PartieTigre { score: number; tigres: number }

/** Cachettes précalculées (scripts/agroparc/generer_cachettes.mjs). Indisponibles : pas de chasse. */
async function fetchCachettes(): Promise<Cachette[]> {
  try {
    const r = await fetch("/agroparc/cachettes.json");
    return r.ok ? lireCachettes((await r.json()) as FichierCachettes) : [];
  } catch {
    return [];
  }
}

const fmtDate = (iso: string, long = true) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("fr-FR", long
    ? { weekday: "long", day: "numeric", month: "long" }
    : { weekday: "short", day: "numeric", month: "short" });
};
const fmtNote = (n?: number) => (n == null ? "—" : `${n}/10`);

function lireClassementOuvert(): boolean {
  try { return localStorage.getItem(CLE_CLASSEMENT) === "1"; } catch { return false; }
}

/** Échap ne ferme pas la vue quand on tape dans un champ (pseudo du classement). */
function dansUnChamp(cible: EventTarget | null): boolean {
  const el = cible as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

const CLE_PSEUDO = "pdj-fps-pseudo";
/** Accroupi : « 1 » = bascule, « 0 » (défaut) = maintenir. */
const CLE_ACCROUPI_BASCULE = "pdj-fps-accroupi-bascule";
const CLE_SENSIBILITE = "pdj-fps-sensibilite";
/** Personnage choisi dans les commentaires (app/CommentForm.tsx) : pseudo par défaut dans l'arène. */
const CLE_PERSONNAGE = "pdj-selected-character";

/** Pseudo enregistré, sinon le personnage des commentaires, sinon « Agent ». */
function pseudoInitial(): string {
  try {
    const p = localStorage.getItem(CLE_PSEUDO);
    if (p) return p;
    const c = localStorage.getItem(CLE_PERSONNAGE);
    if (c) return nomPersonnage(c);
  } catch { /* stockage indisponible */ }
  return "Agent";
}
/** Équipement mémorisé (clé `pdj-fps-equipement`, migration de l'ancienne clé `pdj-fps-arme` faite par `lireEquipement`). */
function equipementInitial(): EquipementChoisi {
  return lireEquipement(stockageNavigateur());
}
function accroupiBasculeInitial(): boolean {
  try { return localStorage.getItem(CLE_ACCROUPI_BASCULE) === "1"; } catch { return false; }
}
/** Valeurs de repli du HUD tant que la partie n'est pas lancée (objets stables). */
const LIVE_VIDE: HudLive = { recharge: 0, vitesse: 0, vitesseKmh: 0, regenDelai: 1 };
const RADAR_VIDE = creerRadarFrame();

/** HUD de repos (à pied, vivant, fusil d'assaut + pistolet) : base de `window.__arene.forcerHud`, qui y superpose un état partiel. */
const HUD_REPOS: HudEtat = {
  pv: 100, bouclier: 0, arme: "fusil_assaut", slot: "principale",
  slots: "principale:fusil_assaut:30:30:-1|secondaire:pistolet:12:12:-1|couteau:couteau:0:0",
  equipSuivant: "fusil_assaut|pistolet", munitions: 30, chargeur: 30, reserve: -1, recharge: false, degainage: false,
  vise: false, lunette: false, zoomX: 0, zoomNiveau: -1, zoomNiveaux: 0, ecartViseur: 0, distanceVisee: -1, mur: false, mort: false, reapparitionDans: 0, protege: false,
  protegeRestant: 0, verrouille: true, connecte: true, entracte: false, accroupi: false, glisse: false, regen: false,
  bonusVitesse: 1, invite: "", inviteDetail: "", vehicule: false, vehiculeId: -1, siege: -1, tireInterdit: false,
  embarquement: false, killcam: -1, killcamPhase: "", sort: false, voix: "", voixParlants: "", titan: false,
};
function sensibiliteInitiale(): number {
  try {
    const v = Number(localStorage.getItem(CLE_SENSIBILITE));
    if (Number.isFinite(v) && v >= 0.2 && v <= 3) return v;
  } catch { /* stockage indisponible */ }
  return 1;
}

/** Menu du jour : celui d'aujourd'hui si publié, sinon le plus récent. */
async function fetchPdj(): Promise<PdjEntry | null> {
  const today = new Date().toLocaleDateString("en-CA");
  for (const url of [`/api/pdj?date=${today}`, "/api/pdj"]) {
    try {
      const r = await fetch(url);
      if (r.ok) return (await r.json()) as PdjEntry;
    } catch { /* on tente l'URL suivante */ }
  }
  return null;
}

interface Props {
  onClose?: () => void;
  partie?: PartieTigre;
  /** Le joueur vient de débusquer le tigre dans la cachette `c`. */
  surTigre?: (c: Cachette) => void;
  /** Le score vient d'être enregistré dans le classement : la partie repart de 0. */
  remettreAZero?: () => void;
}

export default function Agroparc3D({ onClose, partie = { score: 0, tigres: 0 }, surTigre, remettreAZero }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<SceneHandle | null>(null);
  const [scene, setScene] = useState<{ data: SceneData; cachettes: Cachette[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [pdj, setPdj] = useState<PdjEntry | null>(null);
  const [selected, setSelected] = useState<Poi | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  /** Dernier tigre trouvé, affiché un instant à côté du score (le journal est masqué sur mobile). */
  const [gain, setGain] = useState<{ id: number; points: number } | null>(null);
  const surTigreRef = useRef(surTigre);
  surTigreRef.current = surTigre;
  // Classement : ouvert ou fermé (gardé en localStorage), rechargé après chaque enregistrement.
  // Le composant n'est monté qu'au clavier (jamais rendu côté serveur) : lecture directe.
  const [classementOuvert, setClassementOuvert] = useState(lireClassementOuvert);
  const [versionClassement, setVersionClassement] = useState(0);
  const [message, setMessage] = useState<{ id: number; texte: string } | null>(null);
  const ouvrirClassement = (v: boolean) => {
    setClassementOuvert(v);
    if (v) setSelected(null);
    try { localStorage.setItem(CLE_CLASSEMENT, v ? "1" : "0"); } catch { /* stockage indisponible : état non retenu */ }
  };
  // Mode choisi sur le site : les jauges le suivent, la vue ne le modifie pas.
  const [mode] = useModeSite();

  // ---------- arène FPS ----------
  // Le canvas est NEUF à chaque bascule (vue aérienne ↔ arène) : un contexte WebGL perdu à la
  // destruction de la vue précédente ne peut pas être réutilisé sur le même élément.
  const [enArene, setEnArene] = useState(false);
  const [cleCanvas, setCleCanvas] = useState(0);
  const [areneOuverte, setAreneOuverte] = useState(false);
  const [hudJeu, setHud] = useState<HudEtat | null>(null);
  // dev : état forcé par `window.__arene.forcerHud` (captures des états du HUD sans jouer) ; null = le vrai état du jeu
  const [hudForce, setHudForce] = useState<Partial<HudEtat> | null>(null);
  // `verrouille` à vrai par défaut : sans pointer lock (captures, tests) le menu pause masquerait l'état forcé
  const hud = hudForce ? { ...(hudJeu ?? HUD_REPOS), verrouille: true, ...hudForce } : hudJeu;
  const [pseudoSaisi, setPseudoSaisi] = useState(pseudoInitial);
  const [pseudoConnecte, setPseudoConnecte] = useState(() => pseudoInitial().trim() || "Agent");
  const [equipement, setEquipement] = useState<EquipementChoisi>(equipementInitial);
  const [accroupiBascule, setAccroupiBascule] = useState(accroupiBasculeInitial);
  // chat vocal de proximité (v3 §5) : réglages gardés (`pdj-fps-voix`), message si le micro est refusé
  const [reglagesVoix, setReglagesVoix] = useState<ReglagesVoix>(() => lireReglagesVoix(stockageNavigateur()));
  const [voixErreur, setVoixErreur] = useState("");
  const [sensibilite, setSensibilite] = useState(sensibiliteInitiale);
  const [touches, setTouches] = useState<ConfigTouches>(() => lireTouches(stockageNavigateur()));
  // mini-map et taille de l'interface (clés `pdj-fps-minimap` et `pdj-fps-hud`), réglables au lobby comme en pause
  const [reglagesHud, setReglagesHud] = useReglagesHud();
  const [tactile, setTactile] = useState(false);
  const jeuRef = useRef<JeuHandle | null>(null);
  const arene = useArene(pseudoConnecte, jeuRef);
  // identité stable : le HUD le lit en rAF (mini-map, flèche d'Elsa), sans repasser par React
  const radar = useCallback(() => jeuRef.current?.radar() ?? RADAR_VIDE, []);
  const monstres = useCallback(() => jeuRef.current?.monstres() ?? null, []);
  const enAreneRef = useRef(enArene);
  enAreneRef.current = enArene;
  const equipementRef = useRef(equipement);
  equipementRef.current = equipement;
  const accroupiBasculeRef = useRef(accroupiBascule);
  accroupiBasculeRef.current = accroupiBascule;
  const reglagesVoixRef = useRef(reglagesVoix);
  reglagesVoixRef.current = reglagesVoix;
  const sensibiliteRef = useRef(sensibilite);
  sensibiliteRef.current = sensibilite;

  useEffect(() => {
    setTactile(matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches);
  }, []);
  // Le pseudo saisi part au serveur après une courte pause de frappe (message « pseudo », sans
  // reconnexion : possible aussi en pleine partie, depuis le menu pause).
  useEffect(() => {
    const t = setTimeout(() => setPseudoConnecte(pseudoSaisi.trim() || "Agent"), 400);
    return () => clearTimeout(t);
  }, [pseudoSaisi]);
  const saisirPseudo = (v: string) => {
    setPseudoSaisi(v);
    try { localStorage.setItem(CLE_PSEUDO, v); } catch { /* non retenu */ }
  };
  // Lobby, écran de mort et pause : l'équipement de la prochaine apparition (principale + secondaire, couteau toujours là).
  // Mémorisé tout de suite ; en partie, `equiper` le transmet au jeu (immédiat si mort).
  const choisirEquipement = (principale: ArmePrincipaleId, secondaire: ArmeSecondaireId) => {
    setEquipement({ principale, secondaire });
    jeuRef.current?.equiper(principale, secondaire);
    ecrireEquipement({ principale, secondaire }, stockageNavigateur());
  };
  const reglerAccroupiBascule = (b: boolean) => {
    setAccroupiBascule(b);
    jeuRef.current?.accroupiBascule(b);
    try { localStorage.setItem(CLE_ACCROUPI_BASCULE, b ? "1" : "0"); } catch { /* non retenu */ }
  };
  /** Active le micro de la partie en cours ; en cas d'échec, la voix est décochée et la raison affichée dans le menu pause. */
  const activerVoix = useCallback((jeu: JeuHandle, r: ReglagesVoix) => {
    void jeu.voix.activer().then((res) => {
      if (res === "ok") return;
      setVoixErreur(res === "refuse"
        ? "Micro refusé : autorisez-le pour ce site dans le navigateur, puis réessayez."
        : "Chat vocal indisponible dans ce navigateur.");
      const coupe = { ...r, actif: false };
      setReglagesVoix(coupe);
      ecrireReglagesVoix(coupe, stockageNavigateur());
    });
  }, []);
  const reglerVoix = (r: ReglagesVoix) => {
    setVoixErreur("");
    const jeu = jeuRef.current;
    if (jeu) {
      jeu.voix.mode(r.mode);
      if (r.actif && !reglagesVoixRef.current.actif) activerVoix(jeu, r);
      else if (!r.actif) jeu.voix.desactiver();
    }
    setReglagesVoix(r);
    ecrireReglagesVoix(r, stockageNavigateur());
  };
  const regler = (x: number) => {
    setSensibilite(x);
    jeuRef.current?.sensibilite(x);
    try { localStorage.setItem(CLE_SENSIBILITE, String(x)); } catch { /* non retenu */ }
  };
  const reglerTouches = (cfg: ConfigTouches) => {
    setTouches(cfg);
    jeuRef.current?.touches(cfg);
    ecrireTouches(cfg, stockageNavigateur());
  };
  const entrerArene = () => {
    if (!scene || !arene.monId) return;
    // le nom tapé juste avant de cliquer part tout de suite, sans attendre la pause de frappe
    const nom = pseudoSaisi.trim() || "Agent";
    setPseudoConnecte(nom);
    arene.clientRef.current?.renommer(nom);
    setSelected(null);
    setAreneOuverte(false);
    setCleCanvas((k) => k + 1);
    setEnArene(true);
  };
  const quitterArene = () => {
    setCleCanvas((k) => k + 1);
    setEnArene(false);
  };
  const quitterRef = useRef(quitterArene);
  quitterRef.current = quitterArene;
  // Le bouton « Entrer » / « Quitter l'arène » disparaît avec son panneau : sans cela le focus tombe sur
  // <body>, hors du dialogue. On le ramène sur la racine à chaque bascule (pas au montage : déjà fait plus bas).
  const basculeVue = useRef(false);
  useEffect(() => {
    if (basculeVue.current) rootRef.current?.focus({ preventScroll: true });
    basculeVue.current = true;
  }, [enArene]);

  // Échap ferme la vue, sauf dans un champ de saisie (le champ gère alors Échap lui-même).
  const fermerRef = useRef(onClose);
  fermerRef.current = onClose;
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      // En arène, Échap libère la souris (menu pause) : il ne ferme jamais la vue.
      if (e.key !== "Escape" || e.defaultPrevented || enAreneRef.current || dansUnChamp(e.target)) return;
      e.preventDefault();
      fermerRef.current?.();
    };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, []);

  // Le site derrière ne doit plus défiler tant que la vue 3D est ouverte.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Dialogue modal : le reste de la page devient inerte (sinon Tab part dans la navbar ou le panier
  // masqués), le focus entre sur le dialogue et revient où il était à la fermeture.
  useEffect(() => {
    const racine = rootRef.current;
    const precedent = document.activeElement as HTMLElement | null;
    const rendus: HTMLElement[] = [];
    if (racine) {
      for (const el of Array.from(document.body.children) as HTMLElement[]) {
        if (el === racine || el.contains(racine) || el.inert) continue;
        el.inert = true;
        rendus.push(el);
      }
    }
    racine?.focus({ preventScroll: true });
    return () => {
      rendus.forEach((el) => { el.inert = false; });
      if (precedent?.isConnected) precedent.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const data = fetch("/agroparc/scene.json")
      .then((r) => { if (!r.ok) throw new Error(`scene.json ${r.status}`); return r.json() as Promise<SceneData>; });
    Promise.all([data, fetchCachettes()])
      .then(([d, cachettes]) => { if (!cancelled) setScene({ data: d, cachettes }); })
      .catch((e: Error) => { if (!cancelled) setError(`Impossible de charger la carte (${e.message}).`); });
    fetchPdj().then((d) => { if (!cancelled) setPdj(d); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    // En arène, c'est lib/fps/jeu.ts qui dessine : la vue aérienne est détruite puis recréée à la sortie.
    if (!scene || enArene || !canvasRef.current || !labelsRef.current) return;
    let handle: SceneHandle | null = null;
    let cancelled = false;
    import("@/lib/agroparc3d/scene")
      .then(({ createAgroparcScene }) => {
        if (cancelled || !canvasRef.current || !labelsRef.current) return;
        const journal = (tag: string, text: string) => {
          const now = new Date();
          const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
          setEvents((evs) => [...evs, { id: now.getTime() + Math.random(), time, tag, text }].slice(-3));
        };
        handle = createAgroparcScene(canvasRef.current, labelsRef.current, scene.data, {
          onSelect: (poi) => { setSelected(poi); setAreneOuverte(false); },
          onEvent: journal,
          onTigre: (c) => {
            journal("TIGRE", `Tigre débusqué, cachette ${c.palier}, +${c.points}`);
            setGain({ id: Date.now(), points: c.points });
            surTigreRef.current?.(c);
          },
        }, { cachettes: scene.cachettes });
        handleRef.current = handle;
        setReady(true);
      })
      .catch((e: Error) => setError(`Le rendu 3D n'a pas pu démarrer (${e.message}). WebGL est-il activé ?`));
    return () => { cancelled = true; handle?.dispose(); handleRef.current = null; };
  }, [scene, enArene, cleCanvas]);

  // Partie FPS sur le canvas neuf ; three et le jeu ne sont chargés qu'à la première entrée.
  useEffect(() => {
    if (!enArene || !scene || !canvasRef.current) return;
    const canvas = canvasRef.current;
    let jeu: JeuHandle | null = null;
    let annule = false;
    import("@/lib/fps/jeu")
      .then(({ lancerJeu }) => {
        const client = arene.clientRef.current;
        if (annule) return;
        if (!client) { quitterRef.current(); return; }
        jeu = lancerJeu(canvas, scene.data, client, equipementRef.current, {
          hud: setHud,
          evenement: arene.pousserEvenement,
          sortir: () => quitterRef.current(),
          erreur: (texte) => setMessage({ id: Date.now(), texte }),
        });
        jeuRef.current = jeu;
        jeu.sensibilite(sensibiliteRef.current);
        jeu.accroupiBascule(accroupiBasculeRef.current);
        jeu.voix.mode(reglagesVoixRef.current.mode);
        if (reglagesVoixRef.current.actif) activerVoix(jeu, reglagesVoixRef.current);
        // le jeu n'a pas vu le « bienvenue » : pseudos, couleurs et phase du match
        jeu.recevoir({ t: "presence", joueurs: arene.joueursRef.current });
        if (arene.matchRef.current) jeu.recevoir({ t: "match", match: arene.matchRef.current, classement: [] });
      })
      .catch((e: Error) => {
        setMessage({ id: Date.now(), texte: `L'arène n'a pas pu démarrer (${e.message}). WebGL est-il activé ?` });
        quitterRef.current();
      });
    return () => {
      annule = true;
      jeu?.dispose();
      if (jeuRef.current === jeu) jeuRef.current = null;
      setHud(null);
      setHudForce(null);
    };
    // `arene` change à chaque rendu : seules ses refs et son callback stable servent ici
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enArene, scene, cleCanvas]);

  // Spectateurs : les joueurs en jeu apparaissent dans la vue aérienne (marqueur à leur couleur + pseudo).
  useEffect(() => {
    if (enArene || !ready) return;
    const maj = () => {
      const h = handleRef.current;
      if (!h) return;
      const liste: JoueurAerien[] = [];
      // le serveur n'envoie plus d'instantané quand personne ne joue : au-delà de 2 s, plus personne
      if (Date.now() - arene.snapTRef.current < 2000) {
        for (const e of arene.snapRef.current) {
          const j = arene.joueursRef.current.find((x) => x.id === e.id);
          if (e.vivant && j?.enJeu) liste.push({ id: j.id, pseudo: j.pseudo, couleur: j.couleur, p: e.p });
        }
      }
      h.joueurs(liste);
    };
    maj();
    const i = setInterval(maj, 250);
    return () => { clearInterval(i); handleRef.current?.joueurs([]); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enArene, ready, cleCanvas]);

  // Le message du classement s'efface après 6 s.
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 6000);
    return () => clearTimeout(t);
  }, [message]);

  // Le gain affiché à côté du score s'efface après 2,5 s.
  useEffect(() => {
    if (!gain) return;
    const t = setTimeout(() => setGain(null), 2500);
    return () => clearTimeout(t);
  }, [gain]);

  // Crochet de développement : cachette courante, débusquer, placer, viser (captures et vérifications).
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || !ready || !scene) return;
    window.__palantir = {
      cachette: () => handleRef.current?.chasse?.cachette() ?? null,
      debusquer: () => handleRef.current?.chasse?.debusquer() ?? null,
      cachettes: () => scene.cachettes.length,
      placer: (i) => {
        const c = scene.cachettes[Math.max(0, Math.min(scene.cachettes.length - 1, Math.round(i)))];
        if (c) handleRef.current?.chasse?.placer(c);
        return c ?? null;
      },
      viser: (distance) => handleRef.current?.chasse?.viser(distance),
      ecran: () => handleRef.current?.chasse?.ecran() ?? null,
    };
    return () => { delete window.__palantir; };
  }, [ready, scene]);

  // Crochet de développement de l'arène : état, entrer, téléporter, forcer un tir (joueur ou tigre), changer de slot, monter en voiture,
  // killcam, monde, tigres et avion, lancer le sort (tests bout à bout et captures).
  const dev = useRef({ arene, hud, enArene, equipement });
  dev.current = { arene, hud, enArene, equipement };
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    window.__arene = {
      etat: () => ({
        connexion: dev.current.arene.etat, monId: dev.current.arene.monId, joueurs: dev.current.arene.joueurs,
        match: dev.current.arene.match, enArene: dev.current.enArene, hud: dev.current.hud, equipement: dev.current.equipement,
        jeu: jeuRef.current?.debug.etat() ?? null,
      }),
      // une arme seule (v1) la range dans son slot par catégorie ; un équipement règle les deux ; sans argument, l'équipement mémorisé
      entrer: (a) => {
        const eq = dev.current.equipement;
        if (typeof a === "string") {
          if (estPrincipale(a)) choisirEquipementRef.current(a, eq.secondaire);
          else if (estSecondaire(a)) choisirEquipementRef.current(eq.principale, a);
        } else if (a) {
          choisirEquipementRef.current(a.principale ?? eq.principale, a.secondaire ?? eq.secondaire);
        }
        entrerRef.current();
      },
      quitter: () => quitterRef.current(),
      teleporter: (p) => jeuRef.current?.debug.teleporter(p),
      regarder: (lacet, tangage) => jeuRef.current?.debug.regarder(lacet, tangage),
      tirerVers: (id) => jeuRef.current?.debug.tirerVers(id) ?? false,
      touche: (code, appuyee) => jeuRef.current?.debug.touche(code, appuyee),
      slot: (s) => jeuRef.current?.debug.slot(s),
      monter: (id) => jeuRef.current?.debug.monter(id),
      killcam: () => jeuRef.current?.debug.killcam() ?? null,
      monde: () => jeuRef.current?.debug.monde() ?? null,
      tigres: (mesures) => jeuRef.current?.debug.tigres(mesures) ?? null,
      invoquer: () => jeuRef.current?.debug.invoquer() ?? false,
      forcerHud: (partiel) => setHudForce(partiel ? { ...partiel } : null),
      voix: (mode) => {
        const j = jeuRef.current;
        if (!j) return Promise.resolve("indisponible");
        if (mode === null) { j.voix.desactiver(); return Promise.resolve("ok"); }
        j.voix.mode(mode);
        return j.voix.activer();
      },
      etatVoix: () => jeuRef.current?.debug.voix() ?? null,
    };
    return () => { delete window.__arene; };
  }, []);
  const entrerRef = useRef(entrerArene);
  entrerRef.current = entrerArene;
  const choisirEquipementRef = useRef(choisirEquipement);
  choisirEquipementRef.current = choisirEquipement;

  // Plat du jour du POI cliqué (+ carte permanente en dépliant), ou statut + carte quand il n'en a pas.
  const chargement = !ready || !!error;
  const etat = selected ? etatRestaurant(selected, pdj, new Date().toLocaleDateString("en-CA")) : null;

  return (
    <div ref={rootRef} tabIndex={-1} className={`${styles.root} ${display.variable} ${mono.variable}`} role="dialog" aria-modal="true" aria-label="Agroparc en 3D" data-arene={enArene ? "actif" : undefined}>
      <canvas key={cleCanvas} ref={canvasRef} className={styles.canvas} />
      <div ref={labelsRef} className={styles.labels} />
      {!enArene && <div className={styles.vignette} />}

      {/* Tant que l'écran de chargement / d'erreur recouvre le HUD, ses boutons ne sont pas atteignables au clavier. */}
      {!enArene && (<>
      <header className={`${styles.hud} ${styles.hudTl}`} inert={chargement}>
        <h1 className={styles.title}>Agroporc x Palantir</h1>
        <p className={styles.score} aria-live="polite">
          <span><b>{partie.score}</b> pts</span>
          <span>{partie.tigres} {partie.tigres > 1 ? "tigres trouvés" : "tigre trouvé"}</span>
          {gain && <span key={gain.id} className={styles.gain}>+{gain.points}</span>}
        </p>
        <div className={styles.actions}>
          {partie.score > 0 && (
            <EnregistrerScore
              score={partie.score}
              tigres={partie.tigres}
              surEnregistre={(rang) => {
                setMessage({ id: Date.now(), texte: messageEnregistre(rang) });
                remettreAZero?.();
                setVersionClassement((v) => v + 1);
                ouvrirClassement(true);
              }}
              surEchec={() => setMessage({ id: Date.now(), texte: CLASSEMENT_INDISPONIBLE })}
            />
          )}
          <button type="button" className={styles.action} aria-expanded={classementOuvert && !selected && !areneOuverte} onClick={() => { setAreneOuverte(false); ouvrirClassement(!(classementOuvert && !selected && !areneOuverte)); }}>
            Classement
          </button>
          <button type="button" className={styles.action} aria-expanded={areneOuverte} onClick={() => { setSelected(null); setAreneOuverte((o) => !o); }}>
            Arène{arene.etat === "ouvert" && arene.joueurs.length > 0 && ` · ${arene.joueurs.length} en ligne`}
          </button>
        </div>
        {message && <p key={message.id} className={styles.message} role="status">{message.texte}</p>}
      </header>

      {/* Sortie toujours atteignable : hors des blocs inertes, au-dessus de l'écran de chargement ou d'erreur. */}
      {onClose && (
        <button type="button" className={styles.sortie} onClick={onClose}>
          <span aria-hidden="true">←</span> Retour au site
        </button>
      )}
      </>)}

      {!enArene && (<>
      <div className={`${styles.hud} ${styles.hudBl}`} inert={chargement}>
        <div className={styles.legend}>
          <span className={styles.kHome}>CBA</span>
          <span className={styles.kResto}>Restaurants PDJ</span>
          <span className={styles.kBat}>Bâtiments IGN</span>
        </div>
        <div className={styles.hint}>
          Glisser : pivoter · Clic droit ou deux doigts : déplacer · Molette : zoom · Flèches : déplacer · Clic sur un restaurant : plat du jour et carte · <b>Échap</b> ou <b>Retour au site</b> pour revenir
        </div>
        <div className={styles.ctl}>
          <button type="button" onClick={() => handleRef.current?.spin(1)} aria-label="Pivoter vers la gauche">↺ Pivoter</button>
          <button type="button" onClick={() => handleRef.current?.spin(-1)} aria-label="Pivoter vers la droite">Pivoter ↻</button>
          <button type="button" onClick={() => { setSelected(null); handleRef.current?.recenter(); }}>Recentrer</button>
        </div>
      </div>

      <div className={`${styles.hud} ${styles.hudBr}`}>
        <div className={styles.date}>{pdj?.date ? `Menus du ${fmtDate(pdj.date)}` : "Menus indisponibles"}</div>
        <div className={styles.log}>
          {events.map((e) => (
            <div key={e.id}>{e.time} {e.text}<b>{e.tag}</b></div>
          ))}
        </div>
      </div>
      </>)}

      {/* Un seul panneau à droite : le restaurant choisi passe devant le classement, qui reste ouvert derrière. */}
      {!enArene && areneOuverte && !selected && (
        <Arene
          etat={arene.etat}
          monId={arene.monId}
          joueurs={arene.joueurs}
          match={arene.match}
          pseudo={pseudoSaisi}
          surPseudo={saisirPseudo}
          equipement={equipement}
          surEquipement={choisirEquipement}
          touches={touches}
          reglagesHud={reglagesHud}
          surReglagesHud={setReglagesHud}
          surEntrer={entrerArene}
          surFermer={() => setAreneOuverte(false)}
          erreur={arene.erreur}
          tactile={tactile}
          pseudoParDefaut={!pseudoSaisi.trim() || pseudoSaisi.trim() === "Agent"}
        />
      )}

      {enArene && (
        <HudArene
          hud={hud}
          monId={arene.monId}
          joueurs={arene.joueurs}
          match={arene.match}
          classement={arene.classement}
          fil={arene.fil}
          evenements={arene.evenements}
          derniereMort={arene.derniereMort}
          maintenantServeur={() => arene.clientRef.current?.maintenantServeur() ?? Date.now()}
          sensibilite={sensibilite}
          surSensibilite={regler}
          touches={touches}
          surTouches={reglerTouches}
          pseudo={pseudoSaisi}
          surPseudo={saisirPseudo}
          surReprendre={() => jeuRef.current?.verrouiller()}
          surQuitter={quitterArene}
          actionsSansTouche={actionsSansTouche(touches)}
          equipement={equipement}
          surEquipement={choisirEquipement}
          elsa={arene.elsa}
          annonces={arene.annonces}
          sieges={arene.sieges}
          bonus={arene.bonus}
          accroupiBascule={accroupiBascule}
          surAccroupiBascule={reglerAccroupiBascule}
          voix={reglagesVoix}
          surVoix={reglerVoix}
          voixErreur={voixErreur}
          killcamInfo={arene.killcamInfo}
          surPasserKillcam={() => jeuRef.current?.passerKillcam()}
          stats={arene.stats}
          surVueScores={arene.demanderScores}
          live={jeuRef.current?.live ?? LIVE_VIDE}
          radar={radar}
          monstres={monstres}
          reglagesHud={reglagesHud}
          surReglagesHud={setReglagesHud}
          degatsAuTueur={arene.degatsAuTueur}
          scene={scene?.data ?? null}
          surLancerFrappe={(cible) => jeuRef.current?.lancerFrappe?.(cible)}
          surLancerFumigene={() => jeuRef.current?.lancerFumigene?.()}
        />
      )}

      {!enArene && classementOuvert && !selected && !areneOuverte && (
        <PanneauClassement version={versionClassement} surFermer={() => ouvrirClassement(false)} />
      )}

      {!enArene && selected && etat && (
        <aside className={styles.panel} aria-live="polite">
          <p className={`${styles.eyebrow} ${styles.panelHead}`}>
            <span>{[etat.kind === "plat" ? "Plat du jour" : "Restaurant", pdj?.date && fmtDate(pdj.date, false)].filter(Boolean).join(" · ")}</span>
            <button type="button" className={styles.close} onClick={() => setSelected(null)}>Fermer</button>
          </p>
          <h2>
            {restoParNom(selected.name) && <RestoBadge nom={selected.name} variante="picto" className={styles.panelPicto} />}
            {selected.name}
          </h2>
          <p className={styles.addr}>{selected.addr}</p>
          {etat.kind === "plat" ? (
            <>
              <PlatDuJour plat={etat.plat} mode={mode} />
              {etat.carteSlug && <CarteDepliante key={etat.carteSlug} slug={etat.carteSlug} mode={mode} />}
            </>
          ) : (
            <>
              <p className={styles.empty}>{etat.statut}</p>
              {etat.carteSlug && <CarteMini key={etat.carteSlug} slug={etat.carteSlug} mode={mode} />}
            </>
          )}
        </aside>
      )}

      {chargement && (
        <div className={styles.loading}>
          {error ? (
            <div className={styles.errSortie}>
              <span className={styles.err}>{error}</span>
              <p><b>Échap</b> ou <b>Retour au site</b> pour revenir.</p>
            </div>
          ) : <span>Radiographie en cours</span>}
        </div>
      )}
    </div>
  );
}

/** Plat du jour du panneau ; un plat multi-options (Basilic n'Go, Dubble) montre une jauge par option. */
function PlatDuJour({ plat, mode }: { plat: Plat; mode: Mode }) {
  const variantes = variantesPlat(plat);
  if (variantes.length === 1) return <Variante v={variantes[0]} mode={mode} prix={plat.prix} />;
  return (
    <>
      <p className={styles.eyebrow}>{variantes.length} plats au choix{plat.prix && ` · ${plat.prix}`}</p>
      {variantes.map((v) => (
        <div key={v.plat} className={styles.option}>
          <Variante v={v} mode={mode} />
        </div>
      ))}
    </>
  );
}

function Variante({ v, mode, prix }: { v: VariantePlat; mode: Mode; prix?: string }) {
  const note = noteMode(v, mode);
  const justification = mode === "goulaf" ? v.justification_goulaf ?? v.justification : v.justification;
  return (
    <>
      <p className={styles.plat}>{v.plat}</p>
      <div className={styles.platMeta}>
        {prix && <p className={styles.prix}>{prix}</p>}
        <Jauge note={note} label={MODE_LABEL[mode]} />
      </div>
      {v.nutrition_estimee && (
        <div className={styles.nutri}>
          <span><b>{Math.round(v.nutrition_estimee.calories)}</b> kcal</span>
          <span>P <b>{Math.round(v.nutrition_estimee.proteines_g)}</b> g</span>
          <span>G <b>{Math.round(v.nutrition_estimee.glucides_g)}</b> g</span>
          <span>L <b>{Math.round(v.nutrition_estimee.lipides_g)}</b> g</span>
        </div>
      )}
      {justification && <p className={styles.just}>{justification}</p>}
    </>
  );
}

/** Demi-cercle de rayon 44 centré en (56, 56) dans une boîte 112 × 62. */
const ARC = "M 12 56 A 44 44 0 0 1 100 56";
const ARC_LEN = Math.PI * 44;

/** Jauge en arc : remplie à note/10, colorée du rouge au vert (cf. lib/agroparc3d/jauge.ts). */
function Jauge({ note, label }: { note?: number; label: string }) {
  const style = { "--jauge": couleurNote(note) } as CSSProperties;
  return (
    <div className={styles.jauge} style={style} role="img" aria-label={`Note ${label} : ${fmtNote(note)}`}>
      <svg viewBox="0 0 112 62" aria-hidden="true">
        <path className={styles.jaugeFond} d={ARC} />
        <path className={styles.jaugeArc} d={ARC} style={{ strokeDasharray: `${remplissage(note) * ARC_LEN} ${ARC_LEN}` }} />
      </svg>
      <div className={styles.jaugeVal}><b>{note == null ? "—" : note}</b><span>/10</span></div>
      <div className={styles.jaugeK}>{label}</div>
    </div>
  );
}

/** Version compacte pour les lignes de carte : barre remplie + note, même échelle de couleur. */
function MiniJauge({ note }: { note?: number }) {
  const style = { "--jauge": couleurNote(note) } as CSSProperties;
  return (
    <span className={styles.mini} style={style} role="img" aria-label={`Note ${fmtNote(note)}`}>
      <i><i style={{ width: `${remplissage(note) * 100}%` }} /></i>
      <b>{fmtNote(note)}</b>
    </span>
  );
}

/** Sous le plat du jour : la carte permanente du resto, chargée au premier dépliage. */
function CarteDepliante({ slug, mode }: { slug: string; mode: Mode }) {
  const [ouverte, setOuverte] = useState(false);
  return (
    <div className={styles.depliant}>
      <button type="button" className={styles.depliantBtn} aria-expanded={ouverte} onClick={() => setOuverte((o) => !o)}>
        {ouverte ? "Masquer la carte" : "Voir aussi la carte"}
        <span aria-hidden="true">{ouverte ? "▴" : "▾"}</span>
      </button>
      {ouverte && <CarteMini slug={slug} mode={mode} />}
    </div>
  );
}

/** Cartes déjà demandées pendant la session 3D : un seul fetch par resto, retentable en cas d'échec. */
const cartesCache = new Map<string, Promise<Carte | null>>();

function chargerCarte(slug: string): Promise<Carte | null> {
  let p = cartesCache.get(slug);
  if (!p) {
    p = fetch(`/api/carte?slug=${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Carte | null>) : null))
      .catch(() => null);
    cartesCache.set(slug, p);
    void p.then((c) => { if (c === null) cartesCache.delete(slug); });
  }
  return p;
}

/** Carte permanente en liste compacte : sections puis plats triés par la note du mode courant. */
function CarteMini({ slug, mode }: { slug: string; mode: Mode }) {
  // undefined = chargement en cours, null = indisponible
  const [carte, setCarte] = useState<Carte | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    chargerCarte(slug).then((c) => { if (!cancelled) setCarte(c); });
    return () => { cancelled = true; };
  }, [slug]);

  if (carte === undefined) return <p className={`${styles.empty} ${styles.carteEtat}`}>Chargement de la carte…</p>;
  if (carte === null) return <p className={`${styles.empty} ${styles.carteEtat}`}>Carte indisponible pour le moment.</p>;

  const noteeLe = carte.evaluated_at
    ? new Date(carte.evaluated_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
    : null;

  return (
    <div className={styles.carte}>
      <p className={styles.eyebrow}>Carte permanente · notes {MODE_LABEL[mode]}{noteeLe && ` · notée le ${noteeLe}`}</p>
      {trierCarte(carte, mode).map((sec) => (
        <section key={sec.nom} className={styles.carteSection}>
          <h3>{sec.nom} <span>{sec.plats.length}</span></h3>
          <ul>
            {sec.plats.map((p, i) => (
              <li key={`${sec.nom}::${p.plat ?? i}`}>
                <span className={styles.carteNom}>{p.plat}</span>
                <span className={styles.carteMeta}>
                  {p.prix && <span>{p.prix}</span>}
                  <MiniJauge note={noteMode(p, mode)} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

declare global {
  interface Window {
    /** Crochet de test de l'arène FPS, présent en développement seulement. */
    __arene?: {
      etat(): Record<string, unknown>;
      /** Entre dans l'arène. Une arme seule la range dans son slot par catégorie ; un équipement règle les deux slots. */
      entrer(equipement?: ArmeFeuId | Partial<EquipementChoisi>): void;
      quitter(): void;
      teleporter(p: Vec3): void;
      regarder(lacet: number, tangage: number): void;
      /** Vise le centre du joueur ou du tigre `id` et tire sans dispersion. */
      tirerVers(id: string): boolean;
      /** Appuie (true) ou relâche (false) une touche par son `KeyboardEvent.code`, sans pointer lock. */
      touche(code: string, appuyee: boolean): void;
      /** Change de slot sans clavier. */
      slot(s: Slot): void;
      /** Entre dans le véhicule `id` (téléporte à côté puis envoie `monter`). */
      monter(id: number): void;
      /** État de la killcam (null hors killcam). */
      killcam(): Record<string, unknown> | null;
      /** État du monde dynamique : voitures PNJ, voitures conduisibles, Elsa. */
      monde(): Record<string, unknown> | null;
      /** Tigres interpolés (silhouette de touche comprise), avion en cours, charge du sort, GLB chargé. `mesures` : tigre dessiné mesuré. */
      tigres(mesures?: boolean): Record<string, unknown> | null;
      /** Lance le sort d'invocation comme la touche « invoquer » (false sans charge). */
      invoquer(): boolean;
      /** Superpose un état partiel au HUD (base : repos si le jeu n'émet rien) ; `null` rend la main au jeu. */
      forcerHud(partiel: Partial<HudEtat> | null): void;
      /** Active le chat vocal dans ce mode (null : le coupe), comme la case du menu pause. */
      voix(mode: "appuyer" | "ouvert" | null): Promise<string>;
      /** Diagnostic du chat vocal (connexions WebRTC, audibilité, joueurs entendus). */
      etatVoix(): Record<string, unknown> | null;
    };
    /** Crochet de test de la chasse au tigre, présent en développement seulement. */
    __palantir?: {
      cachette(): Cachette | null;
      debusquer(): Cachette | null;
      cachettes(): number;
      /** Pose le tigre dans la cachette de rang i (0 = la plus facile). */
      placer(i: number): Cachette | null;
      viser(distance?: number): void;
      /** Position du tigre à l'écran (px), null s'il est caché ou hors champ. */
      ecran(): { x: number; y: number } | null;
    };
  }
}
