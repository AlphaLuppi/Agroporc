import { describe, expect, it } from "vitest";
import { fmtNote, noteClass } from "./format";

describe("fmtNote", () => {
  it("entier tel quel, une décimale à la virgule, « ? » sans note", () => {
    expect(fmtNote(7)).toBe("7");
    expect(fmtNote(7.5)).toBe("7,5");
    expect(fmtNote(undefined)).toBe("?");
    expect(fmtNote(null)).toBe("?");
  });
});

describe("noteClass", () => {
  it("seuils 7 et 5", () => {
    expect(noteClass(7)).toBe("good");
    expect(noteClass(6.9)).toBe("ok");
    expect(noteClass(5)).toBe("ok");
    expect(noteClass(4.9)).toBe("bad");
  });
});
