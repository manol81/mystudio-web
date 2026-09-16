// src/lib/loopRegion.test.ts

import { describe, expect, it } from "vitest";
import { cycleEndFor, normalizeLoopRegion, playbackStartFor } from "./loopRegion";

// Grilla de 0,5 s = la negra a 120 BPM. Compás de 2 s.
describe("armar la región", () => {
  it("pega LOS DOS extremos a la grilla", () => {
    // Un loop que no cae en la grilla se va desfasando del pulso en
    // cada vuelta: a las pocas pasadas el arreglo suena corrido.
    expect(normalizeLoopRegion(4.07, 11.9, 0.5)).toEqual({ startSeconds: 4, endSeconds: 12 });
  });

  it("funciona arrastrando de derecha a izquierda", () => {
    expect(normalizeLoopRegion(11.9, 4.07, 0.5)).toEqual({ startSeconds: 4, endSeconds: 12 });
  });

  it("con la grilla en Libre respeta lo que se arrastró", () => {
    const region = normalizeLoopRegion(4.07, 11.9, 0);
    expect(region?.startSeconds).toBeCloseTo(4.07, 6);
    expect(region?.endSeconds).toBeCloseTo(11.9, 6);
  });

  it("un click simple no deja loop", () => {
    // Sin esto, tocar la regla para mover el cursor dejaría un loop de
    // duración cero y la reproducción se trabaría en un punto.
    expect(normalizeLoopRegion(6, 6, 0)).toBeNull();
    expect(normalizeLoopRegion(6, 6.03, 0)).toBeNull();
  });

  it("un arrastre corto con grilla gruesa se estira hasta la línea siguiente", () => {
    // Con la grilla en un compás (2 s), arrastrar de 4,1 a 4,6 redondea
    // los dos extremos a la MISMA línea. Devolver null se sentiría como
    // que el gesto no hizo nada.
    expect(normalizeLoopRegion(4.1, 4.6, 2)).toEqual({ startSeconds: 4, endSeconds: 6 });
  });

  it("nunca empieza antes del cero", () => {
    const region = normalizeLoopRegion(-3, 4, 0.5);
    expect(region?.startSeconds).toBe(0);
  });
});

describe("desde dónde arranca la reproducción", () => {
  const region = { startSeconds: 8, endSeconds: 16 };

  it("con el cursor ANTES del loop, se reproduce la entrada y se cae adentro", () => {
    // Escuchar cómo entra la parte en contexto es la mitad del motivo
    // para tener un loop.
    expect(playbackStartFor(2, region, true)).toBe(2);
  });

  it("con el cursor DENTRO, arranca donde está", () => {
    expect(playbackStartFor(10, region, true)).toBe(10);
  });

  it("con el cursor DESPUÉS, salta al principio del tramo", () => {
    // Si no, no habría forma de entrar nunca al loop.
    expect(playbackStartFor(40, region, true)).toBe(8);
  });

  it("con el loop apagado no toca nada", () => {
    expect(playbackStartFor(40, region, false)).toBe(40);
    expect(playbackStartFor(40, null, true)).toBe(40);
  });
});

describe("dónde termina el ciclo", () => {
  const region = { startSeconds: 8, endSeconds: 16 };

  it("en el final del tramo", () => {
    expect(cycleEndFor(8, region, true)).toBe(16);
    expect(cycleEndFor(2, region, true)).toBe(16);
  });

  it("sin loop, no hay ciclo que cerrar", () => {
    expect(cycleEndFor(8, region, false)).toBeNull();
    expect(cycleEndFor(8, null, true)).toBeNull();
  });

  it("pasado el final del tramo, la reproducción sigue de largo", () => {
    // Pasa al apagar el loop a mitad de camino: cortar en un punto que
    // ya no significa nada sería peor que seguir.
    expect(cycleEndFor(20, region, true)).toBeNull();
  });
});
