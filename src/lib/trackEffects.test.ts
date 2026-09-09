// src/lib/trackEffects.test.ts
//
// El DSP de acá es un port a mano del motor nativo en C++ (ver la
// cabecera de trackEffects.ts). Nada avisa si las dos copias se
// separan, así que estas pruebas fijan las PROPIEDADES que definen a
// cada bloque: dónde actúa cada banda del EQ, cuánto reduce el
// compresor, dónde está el techo del limitador y cómo se comporta la
// cola de la reverb. Si alguien toca el motor y actualiza este
// archivo a ojo, algo de esto se cae.

import { describe, expect, it } from "vitest";
import {
  applyLimiterInPlace,
  applyTrackFxInPlace,
  DEFAULT_MASTER_FX,
  isTrackFxActive,
  mixTracks,
  NO_TRACK_FX,
  parseMasterFx,
  parseTrackFx,
  renderReverb,
  type TrackFx,
} from "@/lib/trackEffects";

const FS = 44100;
const NO_LIMITER = { ...DEFAULT_MASTER_FX, limiterEnabled: false };

/// Ganancia de la cadena a una frecuencia, medida con un seno largo
/// (se descarta el primer segundo para saltear el transitorio). Es
/// RELATIVA a la misma señal sin procesar: el pico de un seno
/// muestreado no cae exactamente en 1.0, y compararlo contra 0 dBFS
/// absoluto metía un sesgo de unas centésimas de milésima de dB que no
/// tiene nada que ver con el filtro.
function gainAtDb(freq: number, fx: Partial<TrackFx>): number {
  const n = FS * 2;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * freq * i) / FS);
  let inputPeak = 0;
  for (let i = FS; i < n; i++) inputPeak = Math.max(inputPeak, Math.abs(x[i]));

  applyTrackFxInPlace(x, { ...NO_TRACK_FX, ...fx }, FS);
  let outputPeak = 0;
  for (let i = FS; i < n; i++) outputPeak = Math.max(outputPeak, Math.abs(x[i]));
  return 20 * Math.log10(outputPeak / inputPeak);
}

describe("EQ de 3 bandas", () => {
  it("el shelf grave levanta los graves y no toca los agudos", () => {
    expect(gainAtDb(30, { eqLowDb: 6 })).toBeCloseTo(6, 0);
    expect(gainAtDb(10000, { eqLowDb: 6 })).toBeCloseTo(0, 1);
  });

  it("el shelf grave también corta", () => {
    expect(gainAtDb(30, { eqLowDb: -6 })).toBeCloseTo(-6, 0);
  });

  it("la campana actúa en 1 kHz y no en los graves", () => {
    expect(gainAtDb(1000, { eqMidDb: 6 })).toBeCloseTo(6, 1);
    expect(gainAtDb(60, { eqMidDb: 6 })).toBeCloseTo(0, 1);
  });

  it("el shelf agudo levanta los agudos y no toca los graves", () => {
    expect(gainAtDb(15000, { eqHighDb: 6 })).toBeCloseTo(6, 0);
    expect(gainAtDb(100, { eqHighDb: 6 })).toBeCloseTo(0, 1);
  });

  it("con todo en 0 dB no toca la señal", () => {
    expect(gainAtDb(1000, {})).toBeCloseTo(0, 4);
  });
});

describe("compresor", () => {
  /// Pico de salida de un seno a 0 dBFS pasado por el compresor.
  function peakDb(thresholdDb: number, ratio: number, makeupDb = 0): number {
    return gainAtDb(200, {
      compEnabled: true,
      compThresholdDb: thresholdDb,
      compRatio: ratio,
      compMakeupDb: makeupDb,
    });
  }

  it("reduce lo que pasa el umbral", () => {
    // Umbral -18, relación 4:1 → unos 18 × (1 - 1/4) = 13,5 dB menos.
    const reduced = peakDb(-18, 4);
    expect(reduced).toBeLessThan(-10);
    expect(reduced).toBeGreaterThan(-16);
  });

  it("el makeup compensa en dB exactos", () => {
    expect(peakDb(-18, 4, 6) - peakDb(-18, 4)).toBeCloseTo(6, 4);
  });

  it("un umbral más alto comprime menos", () => {
    expect(peakDb(-6, 4)).toBeGreaterThan(peakDb(-18, 4));
  });

  it("con relación 1:1 no hace nada", () => {
    expect(peakDb(-18, 1)).toBeCloseTo(0, 4);
  });
});

describe("limitador del máster", () => {
  function limitedPeak(amplitude: number): number {
    const left = new Float32Array(FS);
    const right = new Float32Array(FS);
    for (let i = 0; i < FS; i++) {
      left[i] = amplitude * Math.sin((2 * Math.PI * 220 * i) / FS);
      right[i] = left[i];
    }
    applyLimiterInPlace(left, right, FS);
    let peak = 0;
    for (let i = 100; i < FS; i++) peak = Math.max(peak, Math.abs(left[i]));
    return peak;
  }

  it("sujeta una señal muy caliente al techo de -1 dBFS", () => {
    const peak = limitedPeak(2.0);
    // El release avanza antes de comparar contra la muestra siguiente,
    // así que el motor deja pasar hasta ~0,05% sobre el techo — se
    // replica igual a propósito (ver trackEffects.ts).
    expect(peak).toBeLessThanOrEqual(0.891 * 1.005);
    expect(peak).toBeGreaterThan(0.87);
  });

  it("por debajo del techo es transparente", () => {
    expect(limitedPeak(0.5)).toBeCloseTo(0.5, 5);
  });
});

describe("reverb del máster (Freeverb)", () => {
  function impulseResponse(master = DEFAULT_MASTER_FX) {
    const bus = new Float32Array(FS * 3);
    bus[0] = 1;
    return renderReverb(bus, master, FS);
  }

  function energy(data: Float32Array, from: number, to: number): number {
    let e = 0;
    for (let i = from; i < to; i++) e += data[i] * data[i];
    return e;
  }

  it("genera una cola que decae", () => {
    const { left } = impulseResponse();
    expect(energy(left, 0, FS * 0.5)).toBeGreaterThan(0);
    expect(energy(left, FS * 1.5, FS * 2)).toBeLessThan(energy(left, 0, FS * 0.5));
  });

  it("los dos canales difieren (stereo spread de 23 muestras)", () => {
    const { left, right } = impulseResponse();
    const differs = left.some((v, i) => Math.abs(v - right[i]) > 1e-9);
    expect(differs).toBe(true);
  });

  it("más amortiguación acorta la cola", () => {
    const normal = impulseResponse().left;
    const damped = impulseResponse({ ...DEFAULT_MASTER_FX, reverbDamping: 1 }).left;
    expect(energy(damped, FS, FS * 2)).toBeLessThan(energy(normal, FS, FS * 2));
  });

  it("una sala más grande alarga la cola", () => {
    const normal = impulseResponse().left;
    const bigger = impulseResponse({ ...DEFAULT_MASTER_FX, reverbRoomSize: 1 }).left;
    expect(energy(bigger, FS, FS * 2)).toBeGreaterThan(energy(normal, FS, FS * 2));
  });
});

describe("mezcla", () => {
  const mono = () => new Float32Array(FS).fill(0.5);

  it("el paneo extremo manda todo a un lado", () => {
    const mix = mixTracks(
      [{ samples: mono(), volume: 1, pan: -1, fx: NO_TRACK_FX }],
      NO_LIMITER,
      FS,
      FS,
    );
    expect(mix.left[10]).toBeCloseTo(0.5, 5);
    expect(mix.right[10]).toBeCloseTo(0, 5);
  });

  it("centrado reparte a potencia constante", () => {
    const mix = mixTracks(
      [{ samples: mono(), volume: 1, pan: 0, fx: NO_TRACK_FX }],
      NO_LIMITER,
      FS,
      FS,
    );
    expect(mix.left[10]).toBeCloseTo(0.5 * Math.SQRT1_2, 5);
    expect(mix.right[10]).toBeCloseTo(mix.left[10], 9);
  });

  it("sin envíos no se procesa reverb ni se alarga la mezcla", () => {
    const mix = mixTracks(
      [{ samples: mono(), volume: 1, pan: 0, fx: NO_TRACK_FX }],
      DEFAULT_MASTER_FX,
      FS,
      FS,
    );
    expect(mix.left.length).toBe(FS);
  });

  it("con envío agrega reverb y 4 segundos de cola", () => {
    const dry = mixTracks(
      [{ samples: mono(), volume: 1, pan: 0, fx: NO_TRACK_FX }],
      NO_LIMITER,
      FS,
      FS,
    );
    const wet = mixTracks(
      [{ samples: mono(), volume: 1, pan: 0, fx: { ...NO_TRACK_FX, reverbSend: 0.8 } }],
      NO_LIMITER,
      FS,
      FS,
    );
    expect(wet.left.length).toBe(FS * 5);
    let difference = 0;
    for (let i = 0; i < FS; i++) difference += Math.abs(wet.left[i] - dry.left[i]);
    expect(difference).toBeGreaterThan(1e-4);

    let tail = 0;
    for (let i = FS; i < wet.left.length; i++) tail += wet.left[i] * wet.left[i];
    expect(tail).toBeGreaterThan(0);
  });
});

describe("parseo de parámetros", () => {
  it("un respaldo sin efectos toma los valores neutros", () => {
    expect(parseTrackFx(undefined)).toEqual(NO_TRACK_FX);
    expect(parseTrackFx(null)).toEqual(NO_TRACK_FX);
    expect(parseMasterFx(undefined)).toEqual(DEFAULT_MASTER_FX);
  });

  it("lee las mismas claves que escribe TrackFxSettings.toJson en Dart", () => {
    const fx = parseTrackFx({
      eqLowDb: 3,
      eqMidDb: -2,
      eqHighDb: 1,
      compEnabled: true,
      compThresholdDb: -24,
      compRatio: 6,
      compMakeupDb: 2,
      reverbSend: 0.4,
    });
    expect(fx).toEqual({
      eqLowDb: 3,
      eqMidDb: -2,
      eqHighDb: 1,
      compEnabled: true,
      compThresholdDb: -24,
      compRatio: 6,
      compMakeupDb: 2,
      reverbSend: 0.4,
    });
  });

  it("el limitador del máster queda encendido salvo que se apague explícitamente", () => {
    expect(parseMasterFx({}).limiterEnabled).toBe(true);
    expect(parseMasterFx({ limiterEnabled: false }).limiterEnabled).toBe(false);
  });

  it("reconoce cuándo una pista tiene algo activo", () => {
    expect(isTrackFxActive(NO_TRACK_FX)).toBe(false);
    expect(isTrackFxActive({ ...NO_TRACK_FX, eqLowDb: 1 })).toBe(true);
    expect(isTrackFxActive({ ...NO_TRACK_FX, compEnabled: true })).toBe(true);
    expect(isTrackFxActive({ ...NO_TRACK_FX, reverbSend: 0.1 })).toBe(true);
  });
});
