import { describe, expect, it } from "vitest";
import { imageFileProblem, resizePlan, withVersion } from "@/lib/imageUpload";

describe("resizePlan", () => {
  it("avatar: recorta el cuadrado CENTRAL de una foto vertical y lo achica", () => {
    const p = resizePlan(3000, 4000, 512, true);
    expect(p).toEqual({ sx: 0, sy: 500, sw: 3000, sh: 3000, dw: 512, dh: 512 });
  });

  it("portada: conserva la proporción y deja el lado mayor en el tope", () => {
    const p = resizePlan(4000, 3000, 1200, false);
    expect(p).toMatchObject({ sx: 0, sy: 0, sw: 4000, sh: 3000, dw: 1200, dh: 900 });
  });

  it("nunca agranda una imagen chica", () => {
    expect(resizePlan(300, 200, 1200, false)).toMatchObject({ dw: 300, dh: 200 });
  });
});

describe("imageFileProblem", () => {
  it("acepta JPG, PNG y WebP", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(imageFileProblem({ type, size: 1000 })).toBeNull();
    }
  });

  it("rechaza lo que no es imagen, HEIC y archivos gigantes", () => {
    expect(imageFileProblem({ type: "audio/mpeg", size: 1000 })).not.toBeNull();
    expect(imageFileProblem({ type: "image/heic", size: 1000 })).not.toBeNull();
    expect(imageFileProblem({ type: "image/jpeg", size: 30 * 1024 * 1024 })).not.toBeNull();
  });
});

describe("withVersion", () => {
  // Una URL de descarga de Storage YA trae `?alt=media&token=…`.
  it("suma la versión con & cuando la URL ya tiene parámetros", () => {
    expect(withVersion("https://x/o/a.jpg?alt=media&token=t", 7)).toBe(
      "https://x/o/a.jpg?alt=media&token=t&v=7",
    );
  });

  it("y con ? cuando no los tiene", () => {
    expect(withVersion("https://x/a.jpg", 7)).toBe("https://x/a.jpg?v=7");
  });
});
