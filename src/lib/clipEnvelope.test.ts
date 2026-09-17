// src/lib/clipEnvelope.test.ts
//
// La propiedad que importa acá no es "el fade sube": es que las DOS
// mitades de un cruce sumen potencia constante. Un error ahí no rompe
// nada visible, solo mete un bajón de volumen en cada junta, y quien lo
// escuche va a culpar al sample, no al código.

import { describe, expect, it } from "vitest";
import { computeFadeBreakpoints, valueAtBreakpoint } from "./clipEnvelope";

describe("fade lineal", () => {
  it("sube de 0 al gain y baja de vuelta", () => {
    const points = computeFadeBreakpoints(10, 0.8, 2, 2);
    expect(valueAtBreakpoint(points, 0)).toBe(0);
    expect(valueAtBreakpoint(points, 1)).toBeCloseTo(0.4, 6);
    expect(valueAtBreakpoint(points, 5)).toBeCloseTo(0.8, 6);
    expect(valueAtBreakpoint(points, 9)).toBeCloseTo(0.4, 6);
    expect(valueAtBreakpoint(points, 10)).toBe(0);
  });

  it("sin fades vale el gain de punta a punta", () => {
    const points = computeFadeBreakpoints(10, 0.5, 0, 0);
    expect(valueAtBreakpoint(points, 0)).toBe(0.5);
    expect(valueAtBreakpoint(points, 10)).toBe(0.5);
  });

  it("fades que no entran se escalan en proporción, sin cruzarse", () => {
    const points = computeFadeBreakpoints(4, 1, 3, 3);
    // 3 + 3 no entran en 4: quedan 2 y 2, y el pico cae justo al medio.
    expect(valueAtBreakpoint(points, 2)).toBeCloseTo(1, 6);
    expect(valueAtBreakpoint(points, 0)).toBe(0);
    expect(valueAtBreakpoint(points, 4)).toBe(0);
  });
});

describe("potencia constante", () => {
  it("las dos mitades de un cruce suman 1 en POTENCIA, no en amplitud", () => {
    // El clip que se va: dura 4, cruza en sus últimos 2 segundos.
    const saliendo = computeFadeBreakpoints(4, 1, 0, 2, "linear", "equalPower");
    // El que entra: empieza en el segundo 2 de la línea de tiempo y
    // cruza en sus primeros 2 segundos.
    const entrando = computeFadeBreakpoints(4, 1, 2, 0, "equalPower", "linear");

    for (const progreso of [0.125, 0.25, 0.5, 0.75, 0.875]) {
      const a = valueAtBreakpoint(saliendo, 2 + 2 * progreso);
      const b = valueAtBreakpoint(entrando, 2 * progreso);
      // Amplitudes al cuadrado: eso es potencia.
      expect(a * a + b * b).toBeCloseTo(1, 2);
    }
  });

  it("en el medio del cruce vale ~0,707 y NO 0,5", () => {
    // 0,5 es lo que daría una rampa lineal, y es justo el pozo de −3 dB
    // que hay que evitar.
    const points = computeFadeBreakpoints(4, 1, 2, 0, "equalPower", "linear");
    expect(valueAtBreakpoint(points, 1)).toBeCloseTo(Math.SQRT1_2, 2);
  });

  it("respeta el gain del clip", () => {
    const points = computeFadeBreakpoints(4, 0.5, 2, 0, "equalPower", "linear");
    expect(valueAtBreakpoint(points, 1)).toBeCloseTo(0.5 * Math.SQRT1_2, 2);
    expect(valueAtBreakpoint(points, 3)).toBeCloseTo(0.5, 6);
  });

  it("arranca en silencio y llega al gain, igual que el lineal", () => {
    const points = computeFadeBreakpoints(4, 1, 2, 2, "equalPower", "equalPower");
    expect(valueAtBreakpoint(points, 0)).toBe(0);
    expect(valueAtBreakpoint(points, 2)).toBeCloseTo(1, 6);
    expect(valueAtBreakpoint(points, 4)).toBe(0);
  });

  it("los puntos van siempre hacia adelante en el tiempo", () => {
    // Un punto fuera de orden haría que linearRampToValueAtTime agende
    // hacia atrás y la envolvente salte.
    const points = computeFadeBreakpoints(10, 1, 3, 3, "equalPower", "equalPower");
    for (let i = 1; i < points.length; i++) {
      expect(points[i].time).toBeGreaterThanOrEqual(points[i - 1].time);
    }
  });
});
