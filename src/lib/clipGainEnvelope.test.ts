import { describe, expect, it } from "vitest";
import {
  applyEnvelopeToChannels,
  dbToLinear,
  envelopeCursor,
  envelopeGainAt,
  parseManifestEnvelope,
} from "./clipGainEnvelope";
import { clipGainToSlider, formatClipGainDb, MAX_CLIP_GAIN, sliderToClipGain } from "./clipGainSlider";
import { manifestClipToMixdownClip, writeClipInto } from "./projectMixdown";

/// Un AudioBuffer mínimo para el entorno node de Vitest (sin Web Audio).
function fakeBuffer(data: Float32Array, sampleRate: number): AudioBuffer {
  return {
    sampleRate,
    length: data.length,
    duration: data.length / sampleRate,
    numberOfChannels: 1,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

describe("parseManifestEnvelope", () => {
  it("convierte frames del archivo a segundos con la tasa del MANIFIESTO", () => {
    const env = parseManifestEnvelope([[44100, -6], [88200, 0]], 44100)!;
    expect(env.seconds).toEqual([1, 2]);
    expect(env.gains[0]).toBeCloseTo(dbToLinear(-6), 9);
  });

  it("ordena, deja el último si se repite un frame y acota a [-60, +12]", () => {
    const env = parseManifestEnvelope([[500, 99], [10, -3], [10, -99]], 1000)!;
    expect(env.seconds).toEqual([0.01, 0.5]);
    expect(env.gains[0]).toBe(0); // −99 → −60 = silencio
    expect(env.gains[1]).toBeCloseTo(dbToLinear(12), 9);
  });

  it("algo roto, o una curva plana, es 'sin curva' — nunca un error", () => {
    expect(parseManifestEnvelope(undefined, 44100)).toBeUndefined();
    expect(parseManifestEnvelope("hola", 44100)).toBeUndefined();
    expect(parseManifestEnvelope([[1, "x"]], 44100)).toBeUndefined();
    expect(parseManifestEnvelope([[1, 0], [9, 0]], 44100)).toBeUndefined();
    expect(parseManifestEnvelope([[1, -3]], 0)).toBeUndefined();
  });
});

describe("envelopeGainAt — la MISMA cuenta que el motor y que Dart", () => {
  const env = parseManifestEnvelope([[0, -60], [100, 0]], 100)!; // 0 → 1 en 1 s

  it("interpola lineal en AMPLITUD", () => {
    expect(envelopeGainAt(env, 0.5)).toBeCloseTo(0.5, 9);
  });

  it("antes del primero vale el primero, después del último el último", () => {
    expect(envelopeGainAt(env, -1)).toBe(0);
    expect(envelopeGainAt(env, 5)).toBe(1);
    expect(envelopeGainAt(undefined, 3)).toBe(1);
  });

  it("el cursor del render da lo mismo que la búsqueda", () => {
    const e = parseManifestEnvelope([[10, -6], [40, 3], [70, -12], [90, 0]], 100)!;
    const at = envelopeCursor(e);
    for (let t = 0; t <= 1.2; t += 0.013) {
      expect(at(t)).toBeCloseTo(envelopeGainAt(e, t), 12);
    }
  });
});

describe("writeClipInto aplica la curva sobre el AUDIO de origen", () => {
  it("baja el tramo marcado y respeta el recorte (los puntos no se corren)", () => {
    const rate = 1000;
    const data = new Float32Array(3000).fill(1); // 3 s de un valor constante
    // −6 dB del segundo 1,5 al 2,5 del ARCHIVO; el clip suena del 1 al 3.
    const clip = manifestClipToMixdownClip(
      {
        startBeat: 0,
        sampleRate: rate,
        sourceTrimStartFrame: 1000,
        sourceTrimDurationFrames: 2000,
        gainEnvelope: [[1500, 0], [1501, -6], [2500, -6], [2501, 0]],
      },
      fakeBuffer(data, rate),
    );
    const out = new Float32Array(2000);
    writeClipInto(out, clip, rate);
    expect(out[100]).toBeCloseTo(1, 6); // segundo 1,1 del archivo
    expect(out[1000]).toBeCloseTo(dbToLinear(-6), 6); // segundo 2,0
    expect(out[1800]).toBeCloseTo(1, 6); // segundo 2,8
  });

  it("sin curva suena exactamente como antes", () => {
    const rate = 1000;
    const data = new Float32Array(500).fill(0.5);
    const clip = manifestClipToMixdownClip({ startBeat: 0, sampleRate: rate }, fakeBuffer(data, rate));
    expect(clip.envelope).toBeUndefined();
    const out = new Float32Array(500);
    writeClipInto(out, clip, rate);
    expect(out[250]).toBe(0.5);
  });
});

describe("applyEnvelopeToChannels (lo que hornea el Arranger)", () => {
  it("multiplica todos los canales por la curva", () => {
    const env = parseManifestEnvelope([[0, -6]], 100)!;
    const l = new Float32Array(10).fill(1);
    const r = new Float32Array(10).fill(-1);
    applyEnvelopeToChannels([l, r], 100, env);
    expect(l[5]).toBeCloseTo(dbToLinear(-6), 6);
    expect(r[5]).toBeCloseTo(-dbToLinear(-6), 6);
  });
});

describe("slider de volumen del clip en dB", () => {
  it("ida y vuelta, con el imán en 0 dB y el tope en +12 dB", () => {
    expect(sliderToClipGain(clipGainToSlider(0.5))).toBeCloseTo(0.5, 6);
    expect(sliderToClipGain(clipGainToSlider(1.01))).toBe(1);
    expect(sliderToClipGain(1)).toBeCloseTo(MAX_CLIP_GAIN, 9);
    expect(sliderToClipGain(0)).toBe(0);
    expect(clipGainToSlider(0)).toBe(0);
  });

  it("se lee como dB", () => {
    expect(formatClipGainDb(1)).toBe("0 dB");
    expect(formatClipGainDb(0)).toBe("−∞ dB");
    expect(formatClipGainDb(dbToLinear(-3))).toBe("−3,0 dB");
    expect(formatClipGainDb(MAX_CLIP_GAIN)).toBe("+12,0 dB");
  });
});
