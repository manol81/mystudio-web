import { describe, expect, it } from "vitest";
import { isProjectOwner } from "./projectOwnership";

const UID = "xOhFs5L8SESylnDAWgoKTTNs8qt1";

describe("isProjectOwner", () => {
  it("reconoce la ruta del propio proyecto", () => {
    expect(isProjectOwner(`users/${UID}/projects/Eg3d1fMY6g8DhLgXNPKj.mystudio`, UID)).toBe(true);
  });

  it("el proyecto de otra persona no es propio", () => {
    expect(isProjectOwner(`users/${UID}/projects/abc.mystudio`, "otro-uid")).toBe(false);
  });

  it("también lee el uid dentro de una URL de descarga escapada", () => {
    const url =
      "https://firebasestorage.googleapis.com/v0/b/my-studio-4530a.firebasestorage.app/o/" +
      encodeURIComponent(`users/${UID}/projects/abc.mystudio`) +
      "?alt=media&token=x";
    expect(isProjectOwner(url, UID)).toBe(true);
  });

  it("ante la duda dice que NO", () => {
    // Un falso positivo devuelve el error ilegible de Firebase que se
    // está tratando de evitar; un falso negativo solo muestra un cartel.
    expect(isProjectOwner(null, UID)).toBe(false);
    expect(isProjectOwner("", UID)).toBe(false);
    expect(isProjectOwner(`users/${UID}/projects/abc`, null)).toBe(false);
    expect(isProjectOwner("community_stems/otro/abc.zip", UID)).toBe(false);
  });
});
