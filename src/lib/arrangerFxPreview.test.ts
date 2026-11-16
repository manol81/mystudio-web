import { describe, expect, it } from "vitest";
import {
  mixSignature,
  PREVIEW_SAMPLE_RATE,
  renderArrangementWithFx,
  type PreviewTrack,
} from "./arrangerFxPreview";
import { DEFAULT_MASTER_FX, NO_TRACK_FX } from "./trackEffects";

function track(over: Partial<PreviewTrack> = {}): PreviewTrack {
  return {
    volume: 1,
    pan: 0,
    isMuted: false,
    isSolo: false,
    fx: { ...NO_TRACK_FX },
    clips: [
      {
        buffer: { duration: 2, sampleRate: 44100, getChannelData: () => new Float32Array(1) } as unknown as AudioBuffer,
        startSeconds: 0,
        sourceOffsetSeconds: 0,
        sourceDurationSeconds: 2,
        gain: 1,
        fadeInSeconds: 0,
        fadeOutSeconds: 0,
        fadeInShape: "linear",
        fadeOutShape: "linear",
        repeats: 1,
      },
    ],
    ...over,
  };
}

describe("mixSignature", () => {
  it("no cambia si no cambió nada que se escuche", () => {
    // Es lo que evita renderizar de nuevo al apretar Play dos veces.
    expect(mixSignature([track()], DEFAULT_MASTER_FX)).toBe(
      mixSignature([track()], DEFAULT_MASTER_FX),
    );
  });

  it("cambia al mover un efecto de pista", () => {
    const con = track({ fx: { ...NO_TRACK_FX, eqLowDb: 3 } });
    expect(mixSignature([con], DEFAULT_MASTER_FX)).not.toBe(
      mixSignature([track()], DEFAULT_MASTER_FX),
    );
  });

  it("cambia al mover el máster", () => {
    expect(mixSignature([track()], { ...DEFAULT_MASTER_FX, reverbWet: 0.9 })).not.toBe(
      mixSignature([track()], DEFAULT_MASTER_FX),
    );
  });

  it("cambia al mover un clip de lugar", () => {
    const movido = track();
    movido.clips[0].startSeconds = 4;
    expect(mixSignature([movido], DEFAULT_MASTER_FX)).not.toBe(
      mixSignature([track()], DEFAULT_MASTER_FX),
    );
  });

  it("cambia al silenciar una pista", () => {
    expect(mixSignature([track({ isMuted: true })], DEFAULT_MASTER_FX)).not.toBe(
      mixSignature([track()], DEFAULT_MASTER_FX),
    );
  });

  it("dos pistas no se confunden con una sola", () => {
    // Sin el separador "|t" entre pistas, dos arreglos distintos podían
    // dar la misma cadena y reusar una mezcla que no era.
    expect(mixSignature([track(), track()], DEFAULT_MASTER_FX)).not.toBe(
      mixSignature([track()], DEFAULT_MASTER_FX),
    );
  });
});

describe("renderArrangementWithFx: la tasa de los clips", () => {
  // Bug del 2026-11-16 ("Escuchar con efectos suena chillón"): los clips
  // salen de su render SIEMPRE a 44,1 kHz, y la página pedía la mezcla a
  // la tasa del AudioContext (48 kHz). Declarados a 48, sonaban 9 % más
  // rápido y un tono y medio más agudos.
  const tone = (hz: number, seconds: number, rate: number) => {
    const out = new Float32Array(Math.round(seconds * rate));
    for (let i = 0; i < out.length; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / rate);
    return out;
  };
  /// La frecuencia de un tono puro, por cruces por cero hacia arriba.
  const frequencyOf = (x: Float32Array, rate: number) => {
    let crossings = 0;
    for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) crossings++;
    return crossings / (x.length / rate);
  };
  const renderClip = async () => tone(440, 2, 44100);

  it("a 44,1 kHz la mezcla dura lo que el clip y conserva su nota", async () => {
    const mix = await renderArrangementWithFx([track()], DEFAULT_MASTER_FX, undefined, 120, renderClip);
    expect(PREVIEW_SAMPLE_RATE).toBe(44100);
    expect(mix.durationSeconds).toBeCloseTo(2, 3);
    expect(Math.abs(frequencyOf(mix.left, 44100) - 440)).toBeLessThan(2);
  });

  it("pedida a otra tasa se remuestrea: ni más rápida ni más aguda", async () => {
    const mix = await renderArrangementWithFx([track()], DEFAULT_MASTER_FX, 48000, 120, renderClip);
    expect(mix.durationSeconds).toBeCloseTo(2, 3);
    expect(mix.left.length).toBe(96000);
    expect(Math.abs(frequencyOf(mix.left, 48000) - 440)).toBeLessThan(2); // con el bug: 479
  });
});
