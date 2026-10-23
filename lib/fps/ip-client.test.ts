import { describe, expect, it } from "vitest";
import { ipClient } from "./ip-client";

describe("ipClient", () => {
  it("le dernier élément de x-forwarded-for (ajouté par le proxy), jamais le premier (forgeable)", () => {
    expect(ipClient("1.2.3.4", "10.0.0.2")).toBe("1.2.3.4");
    expect(ipClient("9.9.9.9, 1.2.3.4", "10.0.0.2")).toBe("1.2.3.4");
    expect(ipClient(["9.9.9.9", "1.2.3.4"], "10.0.0.2")).toBe("1.2.3.4");
  });
  it("sans en-tête (ou vide) : l'adresse de la socket, sinon « inconnue »", () => {
    expect(ipClient(undefined, "10.0.0.2")).toBe("10.0.0.2");
    expect(ipClient(" , ", "10.0.0.2")).toBe("10.0.0.2");
    expect(ipClient(undefined, undefined)).toBe("inconnue");
  });
});
