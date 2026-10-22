import { describe, it, expect } from "vitest";
import { creerDeclencheur, jouerPassage, type ScenePassage } from "./declencheur";

const attendre = () => new Promise((r) => setTimeout(r, 0));

function fausseScene(echec = false) {
  const s = { prechargee: false, libere: 0, lancee: 0 } as { prechargee: boolean; libere: number; lancee: number } & ScenePassage;
  s.precharger = async () => { if (echec) throw new Error("GLB introuvable"); s.prechargee = true; };
  s.dispose = () => { s.libere++; };
  return s;
}

describe("déclencheur de l'easter egg « macron »", () => {
  it("retaper le code pendant un passage ne relance rien ; le suivant part une fois le premier fini", () => {
    let demarrages = 0;
    const d = creerDeclencheur(() => true, () => demarrages++);
    expect(d.declencher()).toBe(true);
    expect(d.declencher()).toBe(false);
    expect(d.declencher()).toBe(false);
    expect(demarrages).toBe(1);
    d.liberer();
    expect(d.declencher()).toBe(true);
    expect(demarrages).toBe(2);
  });

  it("rien quand le passage est impossible (reduced-motion, pas de WebGL, fenêtre modale), sauf forcé", () => {
    let demarrages = 0;
    const d = creerDeclencheur(() => false, () => demarrages++);
    expect(d.declencher()).toBe(false);
    expect(d.enCours()).toBe(false);
    expect(d.declencher(true)).toBe(true);
    expect(demarrages).toBe(1);
  });
});

describe("jouerPassage", () => {
  it("précharge puis lance ; la fin n'arrive qu'une fois ; l'annulation libère la scène", async () => {
    const s = fausseScene();
    let fins = 0, lances = 0;
    let finScene: (() => void) | null = null;
    const annuler = jouerPassage({
      importer: async () => "module",
      creer: (_m, perte) => { finScene = perte; return s; },
      lancer: () => { lances++; },
      fin: () => { fins++; },
    });
    await attendre();
    expect(s.prechargee).toBe(true);
    expect(lances).toBe(1);
    finScene!();
    finScene!();
    expect(fins).toBe(1);
    annuler();
    expect(s.libere).toBe(1);
  });

  it("GLB introuvable : fin silencieuse (aucune erreur), jamais lancé", async () => {
    const s = fausseScene(true);
    let fins = 0, lances = 0;
    jouerPassage({ importer: async () => 0, creer: () => s, lancer: () => { lances++; }, fin: () => { fins++; } });
    await attendre();
    expect(lances).toBe(0);
    expect(fins).toBe(1);
  });

  it("three introuvable ou WebGL indisponible (import ou création qui échoue) : fin silencieuse", async () => {
    let fins = 0;
    jouerPassage({ importer: async () => { throw new Error("chunk"); }, creer: () => fausseScene(), lancer: () => {}, fin: () => { fins++; } });
    jouerPassage({ importer: async () => 0, creer: () => { throw new Error("pas de WebGL"); }, lancer: () => {}, fin: () => { fins++; } });
    await attendre();
    expect(fins).toBe(2);
  });

  it("annulé pendant l'import (double montage de React en dev) : aucune scène créée, rien lancé ni signalé", async () => {
    let fins = 0, lances = 0, creees = 0;
    let importer!: (v: number) => void;
    const annuler = jouerPassage({
      importer: () => new Promise<number>((r) => { importer = r; }),
      creer: () => { creees++; return fausseScene(); },
      lancer: () => { lances++; }, fin: () => { fins++; },
    });
    annuler();
    importer(1);
    await attendre();
    expect(creees).toBe(0);
    expect(lances).toBe(0);
    expect(fins).toBe(0);
  });

  it("annulé pendant le préchargement : la scène est libérée, rien n'est lancé ni signalé", async () => {
    const s = fausseScene();
    let fins = 0, lances = 0;
    let fini!: () => void;
    s.precharger = () => new Promise<void>((r) => { fini = r; });
    const annuler = jouerPassage({ importer: async () => 0, creer: () => s, lancer: () => { lances++; }, fin: () => { fins++; } });
    await attendre();
    annuler();
    fini();
    await attendre();
    expect(s.libere).toBe(1);
    expect(lances).toBe(0);
    expect(fins).toBe(0);
  });

  it("contexte WebGL perdu pendant le préchargement : fin silencieuse, pas de lancement", async () => {
    let perdre!: () => void;
    let fins = 0, lances = 0;
    const s = fausseScene();
    s.precharger = async () => { perdre(); };
    jouerPassage({ importer: async () => 0, creer: (_m, perte) => { perdre = perte; return s; }, lancer: () => { lances++; }, fin: () => { fins++; } });
    await attendre();
    expect(fins).toBe(1);
    expect(lances).toBe(0);
  });
});
