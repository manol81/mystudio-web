// src/lib/metronome.test.ts

import { describe, expect, it } from "vitest";
import { beatIndicesInWindow, isDownbeat } from "./metronome";

// Negra a 120 BPM = 0,5 s.
describe("qué beats entran en la ventana", () => {
  it("los que caen adentro", () => {
    expect(beatIndicesInWindow(0, 1.2, 0.5)).toEqual([0, 1, 2]);
  });

  it("el borde IZQUIERDO entra y el DERECHO no", () => {
    // Dos pasadas seguidas comparten ese borde. Con los dos extremos
    // cerrados, el beat del borde sonaría dos veces: un doble golpe en
    // cada compás, justo el síntoma que el metrónomo tendría que
    // ayudar a descartar.
    expect(beatIndicesInWindow(1, 2, 0.5)).toEqual([2, 3]);
    expect(beatIndicesInWindow(2, 3, 0.5)).toEqual([4, 5]);
  });

  it("no inventa beats antes del cero", () => {
    expect(beatIndicesInWindow(-2, 0.6, 0.5)).toEqual([0, 1]);
  });

  it("una ventana vacía o invertida no da nada", () => {
    expect(beatIndicesInWindow(3, 3, 0.5)).toEqual([]);
    expect(beatIndicesInWindow(5, 2, 0.5)).toEqual([]);
  });

  it("un beat de duración cero no trata de agendar infinitos clics", () => {
    expect(beatIndicesInWindow(0, 1, 0)).toEqual([]);
  });

  it("corta antes de trabar la pestaña con un tempo absurdo", () => {
    // Un BPM disparado por un campo de texto a medio escribir.
    expect(beatIndicesInWindow(0, 100, 0.00001).length).toBe(256);
  });
});

describe("acento", () => {
  it("cae en el primer beat de cada compás", () => {
    expect(isDownbeat(0, 4)).toBe(true);
    expect(isDownbeat(4, 4)).toBe(true);
    expect(isDownbeat(2, 4)).toBe(false);
  });

  it("sigue al compás elegido, no siempre a 4", () => {
    // En 6/8 el acento va cada seis corcheas.
    expect(isDownbeat(6, 6)).toBe(true);
    expect(isDownbeat(4, 6)).toBe(false);
    expect(isDownbeat(3, 3)).toBe(true);
  });
});
