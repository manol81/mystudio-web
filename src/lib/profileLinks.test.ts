import { describe, expect, it } from "vitest";
import { buildProfileLinks, normalizeProfileLink } from "@/lib/profileLinks";

describe("normalizeProfileLink", () => {
  it("le agrega https:// a lo que se escribió sin protocolo", () => {
    expect(normalizeProfileLink("instagram.com/manol81")).toBe("https://instagram.com/manol81");
  });
  it("deja un https tal cual", () => {
    expect(normalizeProfileLink(" https://open.spotify.com/artist/1 ")).toBe("https://open.spotify.com/artist/1");
  });
  it("rechaza http, javascript: y texto suelto (las reglas los rechazarían igual)", () => {
    expect(normalizeProfileLink("http://x.com")).toBeNull();
    expect(normalizeProfileLink("javascript:alert(1)")).toBeNull();
    expect(normalizeProfileLink("mi banda")).toBeNull();
  });
  it("vacío es sin link", () => {
    expect(normalizeProfileLink("   ")).toBeNull();
  });
});

describe("buildProfileLinks", () => {
  it("guarda los válidos y avisa los inválidos", () => {
    const r = buildProfileLinks({
      spotify: "open.spotify.com/x",
      instagram: "",
      youtube: "no es un link",
      soundcloud: "",
      tiktok: "",
      web: "https://banda.com",
    });
    expect(r.links).toEqual({ spotify: "https://open.spotify.com/x", web: "https://banda.com" });
    expect(r.invalid).toEqual(["youtube"]);
  });
});
