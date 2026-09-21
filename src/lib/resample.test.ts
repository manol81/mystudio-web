import { describe, expect, it } from "vitest";
import { resampleLinear } from "./resample";
import { renderProjectMix, type MixdownTrack } from "./projectMixdown";
import { DEFAULT_MASTER_FX, type TrackFx } from "./trackEffects";

const NEUTRAL_FX: TrackFx = {
  eqLowDb: 0,
  eqMidDb: 0,
  eqHighDb: 0,
  compEnabled: false,
  compThresholdDb: 0,
  compRatio: 1,
  compMakeupDb: 0,
  reverbSend: 0,
};

/** Un seno de [seconds] a [freq] Hz, muestreado a [rate]. */
function sine(freq: number, seconds: number, rate: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.sin((2 * Math.PI * freq * i) / rate);
  }
  return out;
}

/** Cruces por cero por segundo → frecuencia, para medir si algo se estiró. */
function measuredFreq(data: Float32Array, rate: number): number {
  let crossings = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i - 1] < 0 && data[i] >= 0) crossings++;
  }
  return crossings / (data.length / rate);
}

describe("resampleLinear", () => {
  it("con la misma tasa devuelve el MISMO array, sin copiar", () => {
    const data = sine(440, 0.1, 48000);
    expect(resampleLinear(data, 48000, 48000)).toBe(data);
  });

  it("de 48 kHz a 32 kHz conserva la duración en SEGUNDOS", () => {
    const data = sine(440, 1, 48000);
    const out = resampleLinear(data, 48000, 32000);
    expect(out.length).toBe(32000);
    // Un segundo sigue siendo un segundo: eso es lo que se rompía.
    expect(out.length / 32000).toBeCloseTo(data.length / 48000, 5);
  });

  it("conserva la frecuencia, o sea el tempo y la afinación", () => {
    const data = sine(200, 1, 48000);
    const out = resampleLinear(data, 48000, 32000);
    expect(measuredFreq(out, 32000)).toBeCloseTo(200, -1);
    // Sin remuestrear, esas 48.000 muestras leídas como 32 kHz dan
    // 1,5 s de audio a 133 Hz: 1,5× más lento y más grave.
    expect(measuredFreq(data, 32000)).toBeCloseTo(133, -1);
  });

  it("una tasa inservible deja los datos como están", () => {
    const data = sine(440, 0.1, 48000);
    expect(resampleLinear(data, 0, 32000)).toBe(data);
    expect(resampleLinear(data, 48000, Number.NaN)).toBe(data);
  });
});

describe("renderProjectMix con buffers en otra tasa", () => {
  // El caso REAL que se rompía: el .mystudio se decodificaba a 48 kHz
  // (la tasa del equipo) y la mezcla se pedía a 32 kHz.
  function trackAt(rate: number, seconds: number): MixdownTrack {
    const data = sine(200, seconds, rate);
    return {
      volume: 1,
      pan: 0,
      isMuted: false,
      isSolo: false,
      fx: NEUTRAL_FX,
      clips: [
        {
          startSeconds: 0,
          buffer: {
            duration: seconds,
            sampleRate: rate,
            getChannelData: () => data,
          } as unknown as AudioBuffer,
        },
      ],
    };
  }

  it("no se acorta ni se enlentece al mezclar a 32 kHz", () => {
    const mix = renderProjectMix([trackAt(48000, 2)], DEFAULT_MASTER_FX, 32000);
    expect(mix.durationSeconds).toBeCloseTo(2, 1);
    // Con el bug, la pista entraba a 133 Hz en vez de 200 y el último
    // tercio quedaba en silencio.
    expect(measuredFreq(mix.left, 32000)).toBeCloseTo(200, -1);
    const lastThird = mix.left.slice(Math.floor(mix.left.length * 0.7));
    const peak = lastThird.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak).toBeGreaterThan(0.1);
  });

  it("no toca nada cuando las tasas ya coinciden (camino del visor)", () => {
    const mix = renderProjectMix([trackAt(48000, 2)], DEFAULT_MASTER_FX, 48000);
    expect(mix.durationSeconds).toBeCloseTo(2, 1);
    expect(measuredFreq(mix.left, 48000)).toBeCloseTo(200, -1);
  });
});
