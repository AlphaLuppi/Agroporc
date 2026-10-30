import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ANNONCES_EN_ATTENTE_MAX, ECART_ANNONCES_S, ECHANTILLONS, FileAnnonces, IDS_ECHANTILLONS, IDS_VOIX, POIDS_MAX_EFFET, POIDS_MAX_SIRENE, POIDS_MAX_TOTAL, POIDS_MAX_VOIX,
  RAYON_EXPLOSION_GRENADE_M, SONS_POLICE, URLS_ARENE, URLS_ZOMBIES, VOIX_ANNONCES, departCale, instantPic, reglageSirene, sonExplosion, voixDuBonus, voixLibre,
} from "./sons-echantillons";
import { GENRES_BONUS } from "./zombies-vagues";

const PUBLIC = join(__dirname, "..", "..", "public");
const fichier = (url: string) => join(PUBLIC, url);
/** En-tête d'un MP3 : balise ID3v2, ou synchronisation de trame MPEG (11 bits à 1). */
const estMp3 = (b: Buffer) => (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);

describe("registre des sons échantillonnés : fichiers livrés", () => {
  it("chaque effet a un MP3 dans public/, non vide et sous le plafond", () => {
    for (const id of IDS_ECHANTILLONS) {
      const f = fichier(ECHANTILLONS[id].url);
      expect(existsSync(f), `${id} : ${f}`).toBe(true);
      const taille = statSync(f).size;
      expect(taille, id).toBeGreaterThan(1_000);
      expect(taille, id).toBeLessThanOrEqual(POIDS_MAX_EFFET);
      expect(estMp3(readFileSync(f)), `${id} n'est pas un MP3`).toBe(true);
      expect(ECHANTILLONS[id].url.endsWith(".mp3"), id).toBe(true);
    }
  });

  it("chaque annonce a un MP3 dans public/, court, et un texte de repli", () => {
    for (const id of IDS_VOIX) {
      const f = fichier(VOIX_ANNONCES[id].url);
      expect(existsSync(f), `${id} : ${f}`).toBe(true);
      const taille = statSync(f).size;
      expect(taille, id).toBeGreaterThan(1_000);
      expect(taille, id).toBeLessThanOrEqual(POIDS_MAX_VOIX);
      expect(estMp3(readFileSync(f)), `${id} n'est pas un MP3`).toBe(true);
      expect(VOIX_ANNONCES[id].texte.length, id).toBeGreaterThan(3);
    }
  });

  it("tout ce qui est téléchargé à l'entrée en zombies tient sous 2 Mo, sans doublon", () => {
    expect(new Set(URLS_ZOMBIES).size).toBe(URLS_ZOMBIES.length);
    expect(URLS_ZOMBIES.length).toBe(IDS_ECHANTILLONS.length + IDS_VOIX.length);
    const total = URLS_ZOMBIES.reduce((s, u) => s + statSync(fichier(u)).size, 0);
    expect(total).toBeLessThanOrEqual(POIDS_MAX_TOTAL);
  });

  it("chaque fichier est crédité (CREDITS.txt) et régénéré par un script du dépôt", () => {
    const credits = readFileSync(join(PUBLIC, "arene", "CREDITS.txt"), "utf8");
    const sons = readFileSync(join(__dirname, "..", "..", "scripts", "fps", "generer_sons.sh"), "utf8");
    const voix = readFileSync(join(__dirname, "..", "..", "scripts", "fps", "generer_voix.sh"), "utf8");
    for (const id of IDS_ECHANTILLONS) {
      const nom = ECHANTILLONS[id].url.split("/").pop()!;
      expect(credits, nom).toContain(nom);
      expect(sons, nom).toContain(nom);
    }
    expect(credits).toContain("sons/voix/");
    for (const id of IDS_VOIX) expect(voix, id).toContain(`"${id}|`);
  });

  it("chaque bonus a son annonce, et deux bonus ne partagent pas la même", () => {
    const voix = GENRES_BONUS.map(voixDuBonus);
    for (const v of voix) expect(IDS_VOIX).toContain(v);
    expect(new Set(voix).size).toBe(GENRES_BONUS.length);
  });
});

describe("instantPic : où est le coup dans le fichier", () => {
  it("trouve une crête isolée à 10 ms près", () => {
    const f = 8_000;
    const d = new Float32Array(f); // 1 s
    for (let i = 0; i < d.length; i++) d[i] = 0.05 * Math.sin(i / 7);
    for (let i = 3_360; i < 3_440; i++) d[i] = i % 2 ? 0.9 : -0.9; // claquement à 0,42 s
    expect(instantPic(d, f)).toBeCloseTo(0.42, 1);
    expect(Math.abs(instantPic(d, f) - 0.42)).toBeLessThanOrEqual(0.011);
  });

  it("son vide ou fréquence absurde : 0", () => {
    expect(instantPic(new Float32Array(0), 44_100)).toBe(0);
    expect(instantPic([0.5, 1], 0)).toBe(0);
    expect(instantPic([0, 0, 1], 1)).toBe(2);
  });
});

describe("departCale : le pic du son tombe à l'instant voulu", () => {
  it("pic plus tôt que le contact : on attend la différence", () => {
    const r = departCale(0.2, 0.55);
    expect(r.retard).toBeCloseTo(0.35);
    expect(r.decalage).toBe(0);
    expect(r.retard + 0.2 - r.decalage).toBeCloseTo(0.55);
  });

  it("pic plus tard que le contact : on saute le début du fichier", () => {
    const r = departCale(0.9, 0.55);
    expect(r.retard).toBe(0);
    expect(r.decalage).toBeCloseTo(0.35);
    expect(r.retard + 0.9 - r.decalage).toBeCloseTo(0.55);
  });

  it("jamais négatif", () => {
    expect(departCale(-1, -1)).toEqual({ retard: 0, decalage: 0 });
    expect(departCale(0.55, 0.55)).toEqual({ retard: 0, decalage: 0 });
  });
});

describe("voixLibre : limite de lectures simultanées", () => {
  it("les lectures finies libèrent leur place", () => {
    expect(voixLibre([1, 2], 0.5, 2)).toEqual({ fins: [1, 2], libre: false });
    expect(voixLibre([1, 2], 1.5, 2)).toEqual({ fins: [2], libre: true });
    expect(voixLibre([], 0, 1).libre).toBe(true);
    expect(voixLibre([5], 0, 0).libre).toBe(false);
  });
});

describe("FileAnnonces : les annonces s'enchaînent sans se couper", () => {
  it("la deuxième attend la fin de la première, plus un court silence", () => {
    const f = new FileAnnonces();
    expect(f.planifier(10, 1.2)).toBe(10);
    expect(f.planifier(10.3, 0.9)).toBeCloseTo(11.2 + ECART_ANNONCES_S);
    expect(f.taille(10.3)).toBe(2);
  });

  it(`au plus ${ANNONCES_EN_ATTENTE_MAX} en attente derrière celle qui parle : la suivante est abandonnée`, () => {
    const f = new FileAnnonces();
    expect(f.planifier(0, 1)).toBe(0);
    expect(f.planifier(0.1, 1)).not.toBeNull();
    expect(f.planifier(0.2, 1)).not.toBeNull();
    expect(f.planifier(0.3, 1)).toBeNull();
    // la première a fini de parler, la deuxième parle : une place se libère
    expect(f.planifier(1.3, 1)).not.toBeNull();
  });

  it("`auPlusTot` retarde une annonce seule (après la fanfare), la file vide repart de maintenant", () => {
    const f = new FileAnnonces();
    expect(f.planifier(5, 1, 5.35)).toBeCloseTo(5.35);
    expect(f.planifier(20, 1)).toBe(20);
    f.vider();
    expect(f.taille(20)).toBe(0);
  });
});

describe("sonExplosion", () => {
  it("les gros souffles sont des explosions de grenade, le pistolet à rayons garde le pouf synthétisé", () => {
    expect(sonExplosion(RAYON_EXPLOSION_GRENADE_M).genre).toBe("grenade");
    expect(sonExplosion(4.5)).toEqual({ genre: "grenade", force: 1 });
    expect(sonExplosion(1.6).genre).toBe("pouf");
    expect(sonExplosion(2).force).toBeCloseTo(2 / 6);
    expect(sonExplosion(-1).force).toBe(0);
  });
});

describe("(2026-10-30) sirène de la voiture de police", () => {
  it("le fichier du joueur est livré : MP3, sous le plafond, cité dans les crédits, hors du registre des zombies", () => {
    const f = fichier(SONS_POLICE.sirene.url);
    expect(existsSync(f)).toBe(true);
    expect(statSync(f).size).toBeLessThanOrEqual(POIDS_MAX_SIRENE);
    expect(estMp3(readFileSync(f))).toBe(true);
    expect(readFileSync(fichier("/arene/CREDITS.txt"), "utf8")).toContain("sirene-police.mp3");
    // `URLS_ZOMBIES` et `ECHANTILLONS` sont figés : la sirène a son registre
    expect(URLS_ZOMBIES).not.toContain(SONS_POLICE.sirene.url);
    expect(URLS_ARENE).toEqual([SONS_POLICE.sirene.url]);
  });

  it("la boucle évite l'attaque (début) et le fondu de sortie (fin), dans la durée du fichier (9,84 s)", () => {
    const { boucleDebutS, boucleFinS } = SONS_POLICE.sirene;
    expect(boucleDebutS).toBeGreaterThanOrEqual(0.05);
    expect(boucleFinS).toBeLessThan(9.6);
    expect(boucleFinS).toBeGreaterThan(boucleDebutS + 5);
  });

  it("réglage : plus loin, plus faible et plus sourd ; Doppler borné à ±8 % ; entrées douteuses sans NaN", () => {
    const proche = reglageSirene(5), loin = reglageSirene(300);
    expect(loin.gain).toBeLessThan(proche.gain);
    expect(loin.passeBas).toBeLessThan(proche.passeBas);
    expect(reglageSirene(0).gain).toBeLessThanOrEqual(SONS_POLICE.sirene.gain);
    expect(reglageSirene(10_000).gain).toBeGreaterThanOrEqual(0.05 * SONS_POLICE.sirene.gain - 1e-9);
    expect(reglageSirene(10_000).passeBas).toBeGreaterThanOrEqual(900);
    expect(reglageSirene(50, 0).vitesse).toBe(1);
    expect(reglageSirene(50, 24).vitesse).toBeLessThan(1); // elle s'éloigne : plus grave
    expect(reglageSirene(50, -24).vitesse).toBeGreaterThan(1); // elle approche : plus aigu
    expect(reglageSirene(50, 1e6).vitesse).toBe(0.92);
    expect(reglageSirene(50, -1e6).vitesse).toBe(1.08);
    const bizarre = reglageSirene(NaN, Infinity);
    for (const v of Object.values(bizarre)) expect(Number.isFinite(v)).toBe(true);
  });
});
