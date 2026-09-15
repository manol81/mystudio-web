// src/lib/barClock.test.ts
//
// La cuenta que hay que clavar es que el BPM son NEGRAS por minuto sin
// importar el compás. Si alguien alguna vez "simplifica" esto asumiendo
// que un beat es siempre una negra, el 4/4 sigue andando perfecto y el
// 6/8 se desarma en silencio — que es la peor forma de romperse.

import { describe, expect, it } from "vitest";
import { nextBarContextTime, secondsPerBar, secondsPerBeat } from "./barClock";

describe("secondsPerBeat / secondsPerBar", () => {
  it("en 4/4 el beat es la negra", () => {
    expect(secondsPerBeat(120, 4)).toBeCloseTo(0.5, 6);
    expect(secondsPerBar(120, 4, 4)).toBeCloseTo(2, 6);
  });

  it("en 6/8 el beat es la corchea, pero el BPM sigue siendo de negras", () => {
    // A 120 BPM la negra dura 0,5 s → la corchea 0,25 s → el compás,
    // que son seis corcheas, 1,5 s.
    expect(secondsPerBeat(120, 8)).toBeCloseTo(0.25, 6);
    expect(secondsPerBar(120, 6, 8)).toBeCloseTo(1.5, 6);
  });

  it("los compases impares no son un caso especial", () => {
    expect(secondsPerBar(120, 7, 8)).toBeCloseTo(1.75, 6);
    expect(secondsPerBar(90, 3, 4)).toBeCloseTo(2, 6);
  });

  it("un tempo absurdo no divide por cero", () => {
    expect(Number.isFinite(secondsPerBar(0, 4, 4))).toBe(true);
    expect(Number.isFinite(secondsPerBar(120, 0, 0))).toBe(true);
  });
});

describe("nextBarContextTime", () => {
  // Arreglo sonando desde el segundo 0, que arrancó cuando el reloj del
  // AudioContext marcaba 100. Compases de 2 s (120 BPM en 4/4).
  const base = {
    isPlaying: true,
    playStartContextTime: 100,
    playheadAtStart: 0,
    secondsPerBar: 2,
  };

  it("apunta al próximo comienzo de compás", () => {
    // Van 2,5 s de arreglo (compás 2, a mitad) → el próximo compás
    // empieza en el segundo 4 del arreglo = 104 del reloj.
    expect(nextBarContextTime({ ...base, contextTime: 102.5 })).toBeCloseTo(104, 6);
  });

  it("justo sobre la línea de compás, salta al SIGUIENTE", () => {
    // Este es el caso que un `ceil()` resolvería mal: devolvería el
    // instante actual, que ya pasó, y la fuente entraría corrida.
    expect(nextBarContextTime({ ...base, contextTime: 104 })).toBeCloseTo(106, 6);
  });

  it("nunca devuelve un instante que ya pasó", () => {
    for (let t = 100; t < 110; t += 0.1) {
      const when = nextBarContextTime({ ...base, contextTime: t });
      expect(when).not.toBeNull();
      expect(when!).toBeGreaterThan(t);
    }
  });

  it("respeta que la reproducción haya arrancado a mitad del arreglo", () => {
    // Se tocó Play con el cursor en el segundo 5: el próximo compás es
    // el que empieza en el 6, o sea dentro de 1 s.
    const when = nextBarContextTime({
      ...base,
      playheadAtStart: 5,
      contextTime: 100,
    });
    expect(when).toBeCloseTo(101, 6);
  });

  it("sin nada sonando no hay a qué engancharse", () => {
    // Y eso significa arrancar ya: hacer esperar un compás entero con
    // la línea de tiempo parada se sentiría como un botón roto.
    expect(nextBarContextTime({ ...base, isPlaying: false, contextTime: 102 })).toBeNull();
  });
});
