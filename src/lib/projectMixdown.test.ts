// src/lib/projectMixdown.test.ts
//
// Lo que se prueba acá es el armado de la mezcla: dónde cae cada clip
// en la línea de tiempo, qué pistas suenan (mute/solo) y que el
// compresor vea el silencio ENTRE clips igual que en el motor. El DSP
// en sí tiene sus propias pruebas en trackEffects.test.ts.
//
// Los AudioBuffer se simulan: de toda su interfaz, el renderizador usa
// `duration` y `getChannelData(0)`.

import { describe, expect, it } from "vitest";
import {
  contentDurationSeconds,
  projectHasEffects,
  renderProjectMix,
  type MixdownTrack,
} from "@/lib/projectMixdown";
import { DEFAULT_MASTER_FX, NO_TRACK_FX } from "@/lib/trackEffects";

const FS = 44100;
const NO_LIMITER = { ...DEFAULT_MASTER_FX, limiterEnabled: false };

function fakeBuffer(seconds: number, value: number): AudioBuffer {
  const data = new Float32Array(Math.round(seconds * FS)).fill(value);
  return {
    duration: seconds,
    length: data.length,
    sampleRate: FS,
    numberOfChannels: 1,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

function track(overrides: Partial<MixdownTrack> = {}): MixdownTrack {
  return {
    volume: 1,
    pan: 0,
    isMuted: false,
    isSolo: false,
    fx: NO_TRACK_FX,
    clips: [],
    ...overrides,
  };
}

describe("posicionamiento en la línea de tiempo", () => {
  it("la duración llega hasta el final del último clip", () => {
    const t = track({ clips: [{ startSeconds: 1, buffer: fakeBuffer(0.5, 0.4) }] });
    expect(contentDurationSeconds([t])).toBeCloseTo(1.5, 9);
  });

  it("un clip suena en su offset y no antes", () => {
    const t = track({ clips: [{ startSeconds: 1, buffer: fakeBuffer(0.5, 0.4) }] });
    const mix = renderProjectMix([t], NO_LIMITER, FS);
    expect(mix.left[0]).toBe(0);
    expect(mix.left[FS + 100]).toBeCloseTo(0.4 * Math.SQRT1_2, 5);
  });

  it("entre dos clips queda silencio", () => {
    const t = track({
      clips: [
        { startSeconds: 0, buffer: fakeBuffer(0.5, 0.4) },
        { startSeconds: 1.5, buffer: fakeBuffer(0.5, 0.4) },
      ],
    });
    const mix = renderProjectMix([t], NO_LIMITER, FS);
    expect(mix.left[Math.round(1.0 * FS)]).toBe(0);
    expect(mix.left[Math.round(1.6 * FS)]).toBeCloseTo(0.4 * Math.SQRT1_2, 5);
  });
});

describe("mute y solo", () => {
  const a = track({ clips: [{ startSeconds: 0, buffer: fakeBuffer(1, 0.5) }] });
  const b = track({ clips: [{ startSeconds: 0, buffer: fakeBuffer(1, 0.5) }] });

  it("una pista muteada no suma a la mezcla", () => {
    const both = renderProjectMix([a, b], NO_LIMITER, FS);
    const muted = renderProjectMix([a, { ...b, isMuted: true }], NO_LIMITER, FS);
    expect(muted.left[100]).toBeCloseTo(both.left[100] / 2, 6);
  });

  it("con una pista en solo, las demás callan", () => {
    const both = renderProjectMix([a, b], NO_LIMITER, FS);
    const soloed = renderProjectMix([a, { ...b, isSolo: true }], NO_LIMITER, FS);
    expect(soloed.left[100]).toBeCloseTo(both.left[100] / 2, 6);
  });
});

describe("estado del DSP a lo largo de la pista", () => {
  it("el compresor no se reinicia en cada clip", () => {
    // Si el envolvente arrancara de cero en el segundo clip, su ataque
    // saldría igual de fuerte que el del primero. Como el motor
    // procesa la pista entera (silencio incluido), el segundo llega
    // con el compresor todavía actuando.
    const fx = { ...NO_TRACK_FX, compEnabled: true, compThresholdDb: -30, compRatio: 8 };
    const t = track({
      fx,
      clips: [
        { startSeconds: 0, buffer: fakeBuffer(0.5, 0.8) },
        { startSeconds: 0.52, buffer: fakeBuffer(0.5, 0.8) },
      ],
    });
    const mix = renderProjectMix([t], NO_LIMITER, FS);
    const firstAttack = Math.abs(mix.left[10]);
    const secondAttack = Math.abs(mix.left[Math.round(0.52 * FS) + 10]);
    expect(secondAttack).toBeLessThan(firstAttack * 0.9);
  });
});

describe("interruptor de efectos", () => {
  const plain = track({ clips: [{ startSeconds: 0, buffer: fakeBuffer(1, 0.5) }] });

  it("un proyecto sin efectos no necesita el camino de DSP", () => {
    expect(projectHasEffects([plain])).toBe(false);
  });

  it("cualquier parámetro movido lo activa", () => {
    expect(projectHasEffects([{ ...plain, fx: { ...NO_TRACK_FX, eqLowDb: 3 } }])).toBe(true);
    expect(projectHasEffects([{ ...plain, fx: { ...NO_TRACK_FX, compEnabled: true } }])).toBe(true);
    expect(projectHasEffects([{ ...plain, fx: { ...NO_TRACK_FX, reverbSend: 0.3 } }])).toBe(true);
  });

  it("no cuenta lo que no se va a escuchar", () => {
    const withFx = { ...NO_TRACK_FX, eqLowDb: 3 };
    expect(projectHasEffects([{ ...plain, isMuted: true, fx: withFx }])).toBe(false);
    expect(projectHasEffects([{ ...plain, clips: [], fx: withFx }])).toBe(false);
  });
});

describe("cola de reverb", () => {
  it("la mezcla se extiende más allá del audio y la cola suena", () => {
    const t = track({
      fx: { ...NO_TRACK_FX, reverbSend: 0.7 },
      clips: [{ startSeconds: 0, buffer: fakeBuffer(1, 0.5) }],
    });
    const mix = renderProjectMix([t], NO_LIMITER, FS);
    expect(mix.durationSeconds).toBeCloseTo(5, 1);

    let tail = 0;
    for (let i = FS + 1000; i < mix.left.length; i++) tail += Math.abs(mix.left[i]);
    expect(tail).toBeGreaterThan(1e-3);
  });
});
