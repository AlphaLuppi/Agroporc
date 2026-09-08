import { describe, it, expect } from "vitest";
import { feedCode, isTypingTarget, CODE } from "./myrtille";

function typeAll(text: string, code = CODE) {
  let buffer = "";
  let matches = 0;
  for (const ch of text) {
    const r = feedCode(buffer, ch, code);
    buffer = r.buffer;
    if (r.matched) matches++;
  }
  return { buffer, matches };
}

describe("feedCode", () => {
  it("détecte le code tapé d'une traite", () => {
    expect(typeAll("myrtille").matches).toBe(1);
  });

  it("ignore la casse", () => {
    expect(typeAll("MyRtIlLe").matches).toBe(1);
  });

  it("tolère des lettres parasites avant le code", () => {
    expect(typeAll("bonjour mmyrtille").matches).toBe(1);
  });

  it("ne déclenche pas sur un code incomplet ou mal orthographié", () => {
    expect(typeAll("myrtile").matches).toBe(0);
    expect(typeAll("myrtill").matches).toBe(0);
  });

  it("repart de zéro après une détection : deux saisies = deux déclenchements", () => {
    const r = typeAll("myrtillemyrtille");
    expect(r.matches).toBe(2);
    expect(r.buffer).toBe("");
  });

  it("borne le tampon à la longueur du code", () => {
    const { buffer } = typeAll("abcdefghijklmnop");
    expect(buffer.length).toBeLessThanOrEqual(CODE.length);
  });
});

describe("isTypingTarget", () => {
  it("considère les champs de saisie comme des zones de frappe", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("laisse passer le reste de la page", () => {
    expect(isTypingTarget({ tagName: "DIV" })).toBe(false);
    expect(isTypingTarget({ tagName: "BODY", isContentEditable: false })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
