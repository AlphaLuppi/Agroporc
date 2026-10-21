"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { passage, type Evenement, type Passage } from "@/lib/tigre-courant";
import {
  creerParticules, decisionClic, demiTour, DUREES, hauteurSaut, imagesSaut, imagesSursaut,
  passageAutorise, texteBulle, tirerReaction, VITESSE_CONTENT, VITESSE_VEXE,
  type CleTexte, type GenreParticule, type Particule, type Reaction,
} from "@/lib/tigre-reactions";
import { useCalendrierTigre } from "./useCalendrierTigre";
import styles from "./TigreSprite.module.css";

/** Sprite animé (course) et images fixes extraites du même webp pour les poses d'arrêt. */
const GIF = "/textures/tigre-court.webp";
const ARRET = "/textures/tigre-arret.webp";
const TAPE = "/textures/tigre-tape.webp";

interface Course { id: number; evenement: Evenement; petits: number }
type Pose = "course" | "arret" | "tape";
interface Bulle { id: number; texte: string }
/** Ce que le calendrier de passages exige de l'effet de course : le clic le déclenche. */
interface Commandes { reagir: () => void }

/**
 * Repli du thème Tigre quand WebGL est indisponible : le tigre 2D (sprite webp animé) qui
 * traverse le bas de l'écran, avec les mêmes passages, réactions et bulles que la version 3D
 * (`Tigre3D.tsx`) mais sans changement de pose : les gestes 3D qui n'ont pas de sprite
 * (rugir, salut, lécher, étirement) se réduisent à un arrêt de face avec leur bulle.
 * Le webp n'est chargé que dans ce repli.
 *
 * On peut cliquer (ou taper, dès l'appui : la cible bouge) sur le tigre et sur ses petits : une
 * réaction au hasard, cf. lib/tigre-reactions.ts. Le conteneur reste décoratif (aria-hidden) et
 * laisse passer les clics ; seuls les tigres les captent.
 */
export function TigreSprite() {
  const [course, setCourse] = useState<Course | null>(null);
  const [pose, setPose] = useState<Pose>("course");
  const [bulle, setBulle] = useState<Bulle | null>(null);
  const [particules, setParticules] = useState<Particule[]>([]);
  const [fuite, setFuite] = useState(false);
  const troupeRef = useRef<HTMLDivElement>(null);
  const groupeRef = useRef<HTMLDivElement>(null);
  const mereRef = useRef<HTMLDivElement>(null);
  const commandesRef = useRef<Commandes | null>(null);
  /** Lus par le calendrier : un passage tient l'écran jusqu'à sa fin, réactions comprises. */
  const passageEnCoursRef = useRef(false);
  const reactionRef = useRef<Reaction | null>(null);
  const compteurRef = useRef(0);
  const compteurPassageRef = useRef(0);
  const bulleRef = useRef<HTMLSpanElement>(null);
  /** Dernière réaction tirée : survit aux passages pour que deux clics d'affilée ne donnent jamais la même. */
  const derniereRef = useRef<Reaction | null>(null);

  // Calendrier : tire le prochain passage ; l'animation part une fois la troupe rendue.
  useEffect(() => {
    // Images fixes préchargées : l'arrêt ne doit pas clignoter au changement de sprite.
    for (const src of [ARRET, TAPE]) new Image().src = src;
  }, []);
  useCalendrierTigre(true, {
    libre: () => passageAutorise(passageEnCoursRef.current, reactionRef.current),
    partir: (evenement, petits) => {
      passageEnCoursRef.current = true;
      setCourse({ id: ++compteurPassageRef.current, evenement, petits });
    },
    arret: () => {
      passageEnCoursRef.current = false;
      reactionRef.current = null;
      setCourse(null);
    },
  });

  // Un passage : l'animation de translation, et les réactions au clic qui la
  // mettent en pause, la ralentissent, l'accélèrent ou la remplacent.
  useEffect(() => {
    const troupe = troupeRef.current;
    const groupe = groupeRef.current;
    const mere = mereRef.current;
    if (!course || !troupe || !groupe || !mere) {
      passageEnCoursRef.current = false;
      return;
    }
    const largeurEcran = window.innerWidth;
    passageEnCoursRef.current = true;
    let trajet: Passage = passage(
      largeurEcran, troupe.offsetWidth, mere.offsetWidth, course.evenement, Math.random(), Math.random(),
    );
    let anim: Animation | null = null;
    /** Minuteurs et animations d'effet (bond) à annuler à la fin ou au démontage. */
    const minuteurs = new Set<ReturnType<typeof setTimeout>>();
    const effets = new Set<Animation>();
    let fenetreTape = false;
    let minuteurTape: ReturnType<typeof setTimeout> | undefined;

    const apres = (ms: number, fn: () => void) => {
      const t = setTimeout(() => { minuteurs.delete(t); fn(); }, ms);
      minuteurs.add(t);
      return t;
    };

    /** Tout remettre à zéro : fin du passage, changement de passage ou démontage. */
    const terminer = () => {
      troupe.style.visibility = "";
      troupe.style.removeProperty("--sens");
      passageEnCoursRef.current = false;
      reactionRef.current = null;
      fenetreTape = false;
      for (const t of minuteurs) clearTimeout(t);
      minuteurs.clear();
      for (const e of effets) e.cancel();
      effets.clear();
      setPose("course");
      setBulle(null);
      setParticules([]);
      setFuite(false);
    };

    /** Lance (ou remplace) la translation ; `vitesse` = playbackRate. */
    const lancer = (p: Passage, vitesse: number) => {
      anim?.cancel();
      trajet = p;
      troupe.style.setProperty("--sens", String(p.sens));
      troupe.style.visibility = "visible";
      const a = troupe.animate(
        [
          { transform: `translateX(${p.deX}px) scaleX(${p.sens})` },
          { transform: `translateX(${p.aX}px) scaleX(${p.sens})` },
        ],
        { duration: p.dureeMs, easing: "linear" },
      );
      a.playbackRate = vitesse;
      a.onfinish = terminer;
      anim = a;
    };

    const dire = (cle: CleTexte) => {
      const id = ++compteurRef.current;
      setBulle({ id, texte: texteBulle(cle, Math.random()) });
      return id;
    };
    const retirerBulle = (id: number) => setBulle((b) => (b && b.id === id ? null : b));

    const jeter = (type: GenreParticule, nombre: number) => {
      const lot = creerParticules(type, nombre, compteurRef.current, Math.random);
      compteurRef.current += nombre;
      setParticules((prev) => [...prev, ...lot]);
      apres(DUREES.particules, () => setParticules((prev) => prev.filter((p) => !lot.includes(p))));
    };

    /** Bond sur place ou en course : animation sur le groupe, sans toucher au translateX de la troupe. */
    const bondir = (images: Keyframe[], dureeMs: number) => {
      const a = groupe.animate(images, { duration: dureeMs });
      effets.add(a);
      a.onfinish = () => effets.delete(a);
    };

    const finReaction = () => {
      reactionRef.current = null;
      fenetreTape = false;
      setPose("course");
      setBulle(null);
    };
    /** Le tigre repart : à sa vitesse d'avant sauf `vitesse` (content = plus vite, vexé = plus lent). */
    const repartir = (vitesse?: number) => {
      finReaction();
      if (!anim) return;
      if (vitesse !== undefined) anim.playbackRate = vitesse;
      anim.play();
    };
    const arreter = (nouvellePose: Pose) => {
      anim?.pause();
      setPose(nouvellePose);
    };

    const arretParle = (cle: Exclude<Reaction, "regard" | "saut" | "tape" | "sursaut" | "ronron" | "serre-main">) => {
      arreter("arret");
      dire(cle);
      apres(DUREES[cle], () => repartir());
    };

    const reaction = {
      /** Il s'arrête, nous regarde, puis repart. */
      regard: () => {
        arreter("arret");
        dire("regard");
        apres(DUREES.regard, () => repartir());
      },
      /** Bond en arc, sans s'arrêter. */
      saut: () => {
        bondir(imagesSaut(hauteurSaut(mere.offsetWidth)), DUREES.saut);
        dire("saut");
        apres(DUREES.saut, finReaction);
      },
      /** Il tend la patte : un second clic dans la fenêtre fait « Clap ! », sinon il repart vexé. */
      tape: () => {
        arreter("tape");
        dire("tape");
        fenetreTape = true;
        minuteurTape = apres(DUREES.fenetreTape, () => {
          fenetreTape = false;
          setPose("arret");
          dire("vexe");
          apres(DUREES.vexe, () => repartir(VITESSE_VEXE));
        });
      },
      /** Il sursaute, se retourne et file à l'éclair dans l'autre sens, depuis où il est. */
      sursaut: () => {
        arreter("arret");
        const id = dire("sursaut");
        bondir(imagesSursaut(hauteurSaut(mere.offsetWidth) * 0.5), DUREES.sursaut);
        apres(DUREES.sursaut, () => {
          const ecoule = Number(anim?.currentTime ?? 0);
          setPose("course");
          setFuite(true);
          lancer(
            demiTour(trajet, ecoule, largeurEcran, troupe.offsetWidth, mere.offsetWidth, Math.random()),
            1,
          );
          reactionRef.current = null;
          apres(600, () => retirerBulle(id));
        });
      },
      /** Il s'arrête et ronronne : des cœurs montent. */
      ronron: () => {
        arreter("arret");
        dire("ronron");
        jeter("ronron", 2);
        apres(700, () => jeter("ronron", 2));
        apres(1400, () => jeter("ronron", 2));
        apres(DUREES.ronron, () => repartir());
      },
      /** Sans pose dédiée : il s'arrête de face, dit sa phrase, puis repart. */
      rugir: () => arretParle("rugir"),
      salut: () => arretParle("salut"),
      lecher: () => arretParle("lecher"),
      etirement: () => {
        arretParle("etirement");
        jeter("zzz", 1);
        apres(900, () => jeter("zzz", 1));
      },
      /** Sans le clip capturé : arrêt de face, sa bulle, et il applaudit (éclats), le temps d'un salut. */
      "serre-main": () => {
        arreter("arret");
        dire("serre-main");
        apres(400, () => jeter("clap", 6));
        apres(DUREES.salut, () => repartir());
      },
    } satisfies Record<Reaction, () => void>;

    const claquer = () => {
      clearTimeout(minuteurTape);
      if (minuteurTape) minuteurs.delete(minuteurTape);
      fenetreTape = false;
      dire("clap");
      jeter("clap", 8);
      apres(DUREES.clap, () => repartir(VITESSE_CONTENT));
    };

    commandesRef.current = {
      reagir: () => {
        if (!anim || anim.playState === "finished") return;
        const decision = decisionClic(reactionRef.current, fenetreTape);
        if (decision === "ignorer") return;
        if (decision === "taper") { claquer(); return; }
        const choisie = tirerReaction(Math.random(), derniereRef.current);
        derniereRef.current = choisie;
        reactionRef.current = choisie;
        reaction[choisie]();
      },
    };

    troupe.style.visibility = "visible";
    lancer(trajet, 1);
    return () => {
      commandesRef.current = null;
      anim?.cancel();
      terminer();
    };
  }, [course]);

  // Bulle recadrée dans l'écran : le tigre peut être figé à moitié sorti. Décalage en px
  // d'écran (--decal) ; mesure sur offsetWidth, car l'animation d'apparition réduit la boîte rendue.
  useLayoutEffect(() => {
    const el = bulleRef.current;
    const mere = mereRef.current;
    if (!bulle || !el || !mere) return;
    const r = mere.getBoundingClientRect();
    const demi = el.offsetWidth / 2;
    const centre = r.left + r.width / 2;
    const marge = 8;
    const min = marge + demi;
    const max = Math.max(min, window.innerWidth - marge - demi);
    el.style.setProperty("--decal", `${Math.min(max, Math.max(min, centre)) - centre}px`);
  }, [bulle]);

  const petits = course?.evenement === "famille" ? course.petits : 0;
  // pointerdown et non click : le tigre bouge, un click (mousedown + mouseup sur le même
  // élément) est perdu dès que la cible a filé entre les deux, surtout en éclair.
  const toucher = (e: PointerEvent) => {
    if (e.button !== 0) return;
    commandesRef.current?.reagir();
  };
  const classes = [
    styles.troupe,
    (course?.evenement === "eclair" || fuite) && pose === "course" ? styles.eclair : "",
    pose !== "course" ? styles.fige : "",
  ].join(" ");
  return (
    <div ref={troupeRef} className={classes} aria-hidden="true">
      <div ref={groupeRef} className={styles.groupe}>
        {Array.from({ length: petits }, (_, i) => (
          <span key={i} className={styles.petitZone} onPointerDown={toucher}>
            <img src={pose === "course" ? GIF : ARRET} alt="" className={styles.petit} />
          </span>
        ))}
        <div ref={mereRef} className={styles.mere} onPointerDown={toucher}>
          <img src={pose === "course" ? GIF : pose === "tape" ? TAPE : ARRET} alt="" />
          {bulle && <span key={bulle.id} ref={bulleRef} className={styles.bulle}>{bulle.texte}</span>}
          {particules.length > 0 && (
            <span className={styles.ancre}>
              {particules.map((p) => (
                <span
                  key={p.id}
                  className={styles.particule}
                  style={{ "--dx": `${p.dx}px`, "--dy": `${p.dy}px`, animationDelay: `${p.retardMs}ms` } as CSSProperties}
                >
                  {p.glyphe}
                </span>
              ))}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
