// src/lib/tempoDetect.test.ts
//
// Se prueba con señales sintéticas de tempo CONOCIDO, igual que
// latency_calibrator_test.dart del lado Flutter. Es la única forma de
// tener una verdad contra la cual comparar: con un archivo real uno
// solo puede decir "suena bien".

import { describe, expect, it } from "vitest";
import {
  detectTempo,
  foldToPreferredRange,
  onsetEnvelope,
  snapToLoopLength,
} from "./tempoDetect";

const SAMPLE_RATE = 44100;

/**
 * Un tren de golpes percusivos al tempo pedido: cada golpe es ruido con
 * caída exponencial, que es lo que hace que la envolvente de ataques
 * tenga un pico marcado.
 */
function clickTrack(bpm: number, seconds: number, options: { noise?: number; jitter?: number } = {}) {
  const samples = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  const noiseFloor = options.noise ?? 0;
  const jitter = options.jitter ?? 0;
  // Generador propio con semilla: un test que a veces pasa no sirve.
  let seed = 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  if (noiseFloor > 0) {
    for (let i = 0; i < samples.length; i++) samples[i] = (random() * 2 - 1) * noiseFloor;
  }

  const beatSeconds = 60 / bpm;
  for (let beat = 0; beat * beatSeconds < seconds; beat++) {
    const offset = jitter > 0 ? (random() * 2 - 1) * jitter : 0;
    const start = Math.round((beat * beatSeconds + offset) * SAMPLE_RATE);
    if (start < 0) continue;
    const length = Math.round(0.04 * SAMPLE_RATE);
    for (let i = 0; i < length && start + i < samples.length; i++) {
      const decay = Math.exp(-i / (0.006 * SAMPLE_RATE));
      samples[start + i] += (random() * 2 - 1) * decay;
    }
  }
  return samples;
}

describe("envolvente de ataques", () => {
  it("marca las subidas de energía y no las bajadas", () => {
    // Silencio, después fuerte, después silencio: un pico y nada más.
    const samples = new Float32Array(SAMPLE_RATE);
    for (let i = SAMPLE_RATE / 2; i < SAMPLE_RATE / 2 + 4410; i++) samples[i] = 0.5;
    const envelope = onsetEnvelope(samples, SAMPLE_RATE);
    const picos = [...envelope].filter((v) => v > 1).length;
    expect(picos).toBe(1);
  });

  it("de un audio plano no saca nada", () => {
    const samples = new Float32Array(SAMPLE_RATE).fill(0.3);
    const envelope = onsetEnvelope(samples, SAMPLE_RATE);
    expect(Math.max(...envelope)).toBeLessThan(0.01);
  });

  it("un audio demasiado corto devuelve una envolvente vacía", () => {
    expect(onsetEnvelope(new Float32Array(10), SAMPLE_RATE).length).toBe(0);
  });
});

describe("plegado de octavas", () => {
  it("sube lo que está por debajo del rango", () => {
    expect(foldToPreferredRange(60)).toBe(120);
    expect(foldToPreferredRange(35)).toBe(140);
  });

  it("baja lo que está por encima", () => {
    expect(foldToPreferredRange(180)).toBe(90);
    expect(foldToPreferredRange(320)).toBe(80);
  });

  it("deja en paz lo que ya está adentro", () => {
    expect(foldToPreferredRange(120)).toBe(120);
    expect(foldToPreferredRange(90)).toBe(90);
  });

  it("no se cuelga con un número inválido", () => {
    expect(foldToPreferredRange(0)).toBe(0);
    expect(Number.isNaN(foldToPreferredRange(NaN))).toBe(true);
  });
});

describe("calce con un número entero de compases", () => {
  it("corrige un tempo casi bueno al valor exacto del loop", () => {
    // Cuatro compases de 4/4 a 120 BPM duran exactamente 8 s.
    const calce = snapToLoopLength(119.3, 8);
    expect(calce).not.toBeNull();
    expect(calce!.bpm).toBeCloseTo(120, 6);
    expect(calce!.bars).toBe(4);
  });

  it("no inventa un calce cuando el largo no da", () => {
    // 7,3 s no son compases enteros a ningún candidato cercano a 120.
    expect(snapToLoopLength(120, 7.3)).toBeNull();
  });

  it("respeta el compás elegido", () => {
    // Dos compases de 3/4 a 120 BPM duran 3 s.
    const calce = snapToLoopLength(119, 3, 3);
    expect(calce!.bpm).toBeCloseTo(120, 6);
    expect(calce!.bars).toBe(2);
  });

  it("no acepta entradas absurdas", () => {
    expect(snapToLoopLength(0, 8)).toBeNull();
    expect(snapToLoopLength(120, 0)).toBeNull();
  });
});

describe("detección de tempo", () => {
  it("acierta un pulso limpio a 120", () => {
    const estimate = detectTempo(clickTrack(120, 16), SAMPLE_RATE)!;
    expect(estimate.bpm).toBeCloseTo(120, 1);
    expect(estimate.confidence).toBeGreaterThan(0.25);
  });

  it("acierta a 90 y a 140 dentro de 1 BPM", () => {
    // Un BPM de tolerancia no es resignarse: es lo que se puede afirmar
    // sin que el archivo calce en compases enteros (ver el calce más
    // abajo, que en ese caso lo lleva al valor exacto). Y el control de
    // "BPM original" del clip queda para corregirlo a mano.
    expect(Math.abs(detectTempo(clickTrack(90, 16), SAMPLE_RATE)!.bpm - 90)).toBeLessThan(1);
    expect(Math.abs(detectTempo(clickTrack(140, 16), SAMPLE_RATE)!.bpm - 140)).toBeLessThan(1);
  });

  it("un tempo lento se pliega al rango preferido, no se pierde", () => {
    // 70 BPM se informa como 140: es la misma música y no hay forma de
    // distinguirlas escuchando. Lo importante es que el factor de
    // estiramiento que sale de ahí sigue siendo correcto — la afinidad
    // del Banco de Sonidos ya pliega octavas por el mismo motivo.
    const estimate = detectTempo(clickTrack(70, 20), SAMPLE_RATE)!;
    expect(Math.abs(estimate.bpm - 140)).toBeLessThan(1);
  });

  it("aguanta ruido de fondo fuerte", () => {
    const estimate = detectTempo(clickTrack(120, 16, { noise: 0.15 }), SAMPLE_RATE)!;
    expect(Math.abs(estimate.bpm - 120)).toBeLessThan(1);
  });

  it("aguanta que los golpes no caigan clavados", () => {
    // Una persona tocando no es un metrónomo.
    const estimate = detectTempo(clickTrack(100, 20, { jitter: 0.012 }), SAMPLE_RATE)!;
    expect(Math.abs(estimate.bpm - 100)).toBeLessThan(1.5);
  });

  it("un loop exacto sale con el tempo redondo y lo dice", () => {
    // 8 s a 120 BPM son 4 compases justos.
    const estimate = detectTempo(clickTrack(120, 8), SAMPLE_RATE)!;
    expect(estimate.snappedToLoop).toBe(true);
    expect(estimate.bars).toBe(4);
    expect(estimate.bpm).toBeCloseTo(120, 3);
  });

  it("del silencio no dice nada en vez de inventar", () => {
    // Devolver un número cualquiera sería peor que devolver null: el
    // clip se estiraría contra un tempo imaginario.
    expect(detectTempo(new Float32Array(SAMPLE_RATE * 4), SAMPLE_RATE)).toBeNull();
  });

  it("de un audio más corto que un segundo no dice nada", () => {
    expect(detectTempo(new Float32Array(1000), SAMPLE_RATE)).toBeNull();
  });

  it("de un tono sostenido sin ataques NO dice nada", () => {
    // Encontrado probando, y es el caso que más importa: partido en
    // cuadros, un pad ondula de forma perfectamente periódica y el
    // detector devolvía un tempo inventado con confianza 1,0. Ver
    // MIN_ONSET_STRENGTH.
    const samples = new Float32Array(SAMPLE_RATE * 8);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE);
    expect(detectTempo(samples, SAMPLE_RATE)).toBeNull();
  });

  it("del ruido blanco NO dice nada", () => {
    // Encontrado midiendo con archivos reales: la CONFIANZA no sirve
    // para descartar esto (el ruido da 0,58 y un piano real da 0,54).
    // Lo que lo descarta es la fuerza de los ataques — ver
    // MIN_ONSET_STRENGTH.
    const samples = new Float32Array(SAMPLE_RATE * 8);
    let seed = 7;
    for (let i = 0; i < samples.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      samples[i] = (seed / 0x7fffffff) * 2 - 1;
    }
    expect(detectTempo(samples, SAMPLE_RATE)).toBeNull();
  });

  it("de un archivo con un SOLO golpe no dice nada", () => {
    // Un golpe no es un tempo.
    const samples = new Float32Array(SAMPLE_RATE * 8);
    for (let i = 0; i < 2000; i++) samples[SAMPLE_RATE + i] = Math.exp(-i / 300);
    expect(detectTempo(samples, SAMPLE_RATE)).toBeNull();
  });
});
