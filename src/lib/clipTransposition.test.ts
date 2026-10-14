import { describe, expect, it } from "vitest";
import {
  chordsForSample,
  keyName,
  pitchToApplyFromManifest,
  shiftToSoundIn,
  soundingKeyOf,
  soundingKeyOptions,
} from "./clipTransposition";
import { parseSampleKey } from "./sampleAffinity";

const pc = (key: string) => parseSampleKey(key)!.pitchClass;

describe("shiftToSoundIn — el caso pedido: C maj → F maj → G maj", () => {
  it("F es +5 y G es −5 (el camino más corto, no +7)", () => {
    expect(shiftToSoundIn("C Major", pc("F Major"))).toBe(5);
    expect(shiftToSoundIn("C Major", pc("G Major"))).toBe(-5);
    expect(shiftToSoundIn("C Major", pc("C Major"))).toBe(0);
  });

  it("nunca pasa de media octava, y en el empate baja", () => {
    for (let target = 0; target < 12; target++) {
      const s = shiftToSoundIn("D Minor", target)!;
      expect(s).toBeGreaterThanOrEqual(-6);
      expect(s).toBeLessThanOrEqual(5);
    }
    expect(shiftToSoundIn("C Major", pc("F# Major"))).toBe(-6);
  });

  it("sin tonalidad original no hay cuenta posible", () => {
    expect(shiftToSoundIn("", 5)).toBeNull();
    expect(shiftToSoundIn("N/A", 5)).toBeNull();
  });

  it("propiedad: transponer lo que dice deja el clip sonando en la raíz pedida", () => {
    for (const original of ["C Major", "Eb Minor", "B Major", "F# Minor"]) {
      for (let target = 0; target < 12; target++) {
        const shift = shiftToSoundIn(original, target)!;
        expect(pc(soundingKeyOf(original, shift)!)).toBe(target);
      }
    }
  });
});

describe("chordsForSample — los acordes del tema que el sample puede tocar", () => {
  it("sample mayor en un tema en C maj: I, IV y V", () => {
    expect(chordsForSample("C Major", "C Major").map((c) => `${c.degree} ${c.key}`)).toEqual([
      "I C Major",
      "IV F Major",
      "V G Major",
    ]);
  });

  it("sample menor en C maj: ii, iii y vi (nunca un vi mayor)", () => {
    expect(chordsForSample("C Major", "A Minor").map((c) => `${c.degree} ${c.key}`)).toEqual([
      "ii D Minor",
      "iii E Minor",
      "vi A Minor",
    ]);
  });

  it("tema menor (A min): un sample menor toca i, iv y v; uno mayor III, VI y VII", () => {
    expect(chordsForSample("A Minor", "E Minor").map((c) => c.degree)).toEqual(["i", "iv", "v"]);
    expect(chordsForSample("A Minor", "G Major").map((c) => c.key)).toEqual([
      "C Major",
      "F Major",
      "G Major",
    ]);
  });

  it("sin tonalidad del tema o del sample, no ofrece nada", () => {
    expect(chordsForSample("", "C Major")).toEqual([]);
    expect(chordsForSample("C Major", "")).toEqual([]);
  });
});

describe("nombres", () => {
  it("devuelve siempre un nombre del catálogo (Bb, no A#)", () => {
    expect(keyName(10, "minor")).toBe("Bb Minor");
    expect(soundingKeyOf("A Minor", 1)).toBe("Bb Minor");
    expect(soundingKeyOptions("C Major")).toHaveLength(12);
  });
});

describe("pitchToApplyFromManifest — el bug de transponer dos veces", () => {
  it("hasta el formatVersion 4 el pitch ya venía horneado en el WAV: no se aplica", () => {
    expect(pitchToApplyFromManifest(3, 5)).toBe(0);
    expect(pitchToApplyFromManifest(4, -2)).toBe(0);
    expect(pitchToApplyFromManifest(undefined, 7)).toBe(0);
  });

  it("desde el 5 significa transponer al reproducir", () => {
    expect(pitchToApplyFromManifest(5, 5)).toBe(5);
    expect(pitchToApplyFromManifest(5, undefined)).toBe(0);
  });
});
