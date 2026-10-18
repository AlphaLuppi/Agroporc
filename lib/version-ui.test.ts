import { describe, it, expect } from "vitest";
import { lireVersion } from "./version-ui";

describe("lireVersion", () => {
  it("sert la V2 par défaut et la V1 seulement sur demande explicite", () => {
    expect(lireVersion(undefined)).toBe("v2");
    expect(lireVersion(null)).toBe("v2");
    expect(lireVersion("v2")).toBe("v2");
    expect(lireVersion("n'importe quoi")).toBe("v2");
    expect(lireVersion("v1")).toBe("v1");
  });
});
