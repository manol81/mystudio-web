import { describe, expect, it } from "vitest";
import { mixSignature, type PreviewTrack } from "./arrangerFxPreview";
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
