import { describe, expect, it } from "vitest";

import {
  automationDbToGain,
  laneValueAt,
  parseTrackAutomation,
  volumeGainAt,
} from "./trackAutomation";
import { DEFAULT_MASTER_FX, mixTracks, NO_TRACK_FX } from "./trackEffects";
import { projectHasEffects } from "./projectMixdown";

const FS = 1000;
const NO_LIMITER = { ...DEFAULT_MASTER_FX, limiterEnabled: false, reverbWet: 0.5 };

describe("automatización por pista", () => {
  it("lee el JSON de la app y descarta lo que no entiende", () => {
    const a = parseTrackAutomation(
      JSON.stringify({ v: 1, volume: [[2, -6], [0, 0]], pan: [[1, 5]], send: "x" }),
    );
    expect(a).not.toBeNull();
    // Ordenado por tiempo, y el paneo recortado a −1..1.
    expect(a!.volume.map((p) => p.seconds)).toEqual([0, 2]);
    expect(a!.pan[0].value).toBe(1);
    expect(a!.send).toEqual([]);
    expect(parseTrackAutomation(null)).toBeNull();
    expect(parseTrackAutomation("{")).toBeNull();
    expect(parseTrackAutomation(JSON.stringify({ v: 1 }))).toBeNull();
  });

  it("interpola en línea recta y es constante afuera", () => {
    const pts = [
      { seconds: 1, value: 0 },
      { seconds: 3, value: 1 },
    ];
    expect(laneValueAt(pts, 0)).toBe(0);
    expect(laneValueAt(pts, 2)).toBeCloseTo(0.5);
    expect(laneValueAt(pts, 9)).toBe(1);
    expect(laneValueAt([], 2)).toBeNull();
  });

  it("el volumen se interpola en amplitud, como en el motor", () => {
    const pts = [
      { seconds: 0, value: 0 },
      { seconds: 2, value: -60 },
    ];
    // A mitad de camino: la mitad de la ganancia, no −30 dB.
    expect(volumeGainAt(pts, 1)).toBeCloseTo(0.5, 6);
    expect(automationDbToGain(-60)).toBe(0);
    expect(automationDbToGain(-6)).toBeCloseTo(0.501, 3);
  });

  it("la mezcla baja el volumen y mueve el paneo en el tiempo", () => {
    const n = 4 * FS;
    const samples = new Float32Array(n).fill(0.5);
    const automation = {
      volume: [
        { seconds: 1.9, value: 0 },
        { seconds: 2, value: -6 },
      ],
      pan: [
        { seconds: 2.9, value: 0 },
        { seconds: 3, value: -1 },
      ],
      send: [],
    };
    const { left, right } = mixTracks(
      [{ samples, volume: 1, pan: 0, fx: NO_TRACK_FX, automation }],
      { ...NO_LIMITER, reverbWet: 0 },
      FS,
      n,
    );
    const center = Math.cos(Math.PI / 4);
    // Antes de los cambios: centro, a volumen pleno.
    expect(left[500]).toBeCloseTo(0.5 * center, 4);
    expect(right[500]).toBeCloseTo(0.5 * center, 4);
    // Después de 2 s: −6 dB parejo.
    expect(left[2500]).toBeCloseTo(0.5 * center * automationDbToGain(-6), 4);
    // Después de 3 s: todo a la izquierda.
    expect(right[3500]).toBeCloseTo(0, 6);
    expect(left[3500]).toBeCloseTo(0.5 * automationDbToGain(-6), 4);
  });

  it("un envío automatizado prende la reverb aunque la hoja FX diga 0", () => {
    const n = FS;
    const samples = new Float32Array(n).fill(0.3);
    const withSend = mixTracks(
      [
        {
          samples,
          volume: 1,
          pan: 0,
          fx: NO_TRACK_FX,
          automation: { volume: [], pan: [], send: [{ seconds: 0, value: 0.8 }] },
        },
      ],
      NO_LIMITER,
      FS,
      n,
    );
    // Se suma la cola de reverb (4 s).
    expect(withSend.left.length).toBeGreaterThan(n);
  });

  it("un proyecto con automatización pasa por la mezcla con DSP", () => {
    const track = {
      volume: 1,
      pan: 0,
      isMuted: false,
      isSolo: false,
      fx: NO_TRACK_FX,
      clips: [{ startSeconds: 0, buffer: {} as AudioBuffer }],
    };
    expect(projectHasEffects([track])).toBe(false);
    expect(
      projectHasEffects([
        { ...track, automation: { volume: [{ seconds: 0, value: -3 }], pan: [], send: [] } },
      ]),
    ).toBe(true);
  });
});
