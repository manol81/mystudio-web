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
  manifestClipToMixdownClip,
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

/// Un buffer donde cada segundo tiene un valor distinto, para poder
/// afirmar QUÉ pedazo del archivo sonó y no solo que sonó algo.
function bufferBySecond(values: number[]): AudioBuffer {
  const data = new Float32Array(values.length * FS);
  values.forEach((v, i) => data.fill(v, i * FS, (i + 1) * FS));
  return {
    duration: values.length,
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

// ─── Recorte, volumen y fades por clip (formatVersion 3) ───────────────
//
// El .mystudio no llevaba nada de esto, así que acá no existía: un
// proyecto publicado con clips recortados se pre-escuchaba ENTERO, a
// volumen pleno y sin fades, y el paquete liviano de pistas salía
// igual. El WAV del ZIP es el archivo COMPLETO — sin aplicar estos
// campos se reproduce audio que la persona había sacado a propósito.

describe("recorte no destructivo", () => {
  it("la duración cuenta la ventana, no el archivo entero", () => {
    const t = track({
      clips: [
        {
          startSeconds: 1,
          buffer: fakeBuffer(4, 0.5),
          sourceOffsetSeconds: 1,
          sourceDurationSeconds: 2,
        },
      ],
    });
    // 1 s de offset en la línea de tiempo + 2 s de ventana = 3, no 5.
    expect(contentDurationSeconds([t])).toBeCloseTo(3, 9);
  });

  it("suena SOLO la ventana recortada", () => {
    // Un archivo de 4 s donde cada segundo vale distinto; la ventana
    // toma el segundo 1 y el 2.
    const t = track({
      clips: [
        {
          startSeconds: 0,
          buffer: bufferBySecond([0.1, 0.2, 0.3, 0.4]),
          sourceOffsetSeconds: 1,
          sourceDurationSeconds: 2,
        },
      ],
    });
    const mix = renderProjectMix([t], NO_LIMITER, FS);
    const g = Math.SQRT1_2;
    // Al principio del clip suena lo que había en el segundo 1, no el 0.
    expect(mix.left[100]).toBeCloseTo(0.2 * g, 5);
    expect(mix.left[FS + 100]).toBeCloseTo(0.3 * g, 5);
    // Y lo que quedó fuera de la ventana no aparece en ningún lado.
    expect(mix.left.some((v) => Math.abs(v - 0.1 * g) < 1e-4)).toBe(false);
    expect(mix.left.some((v) => Math.abs(v - 0.4 * g) < 1e-4)).toBe(false);
  });

  it("una ventana más larga que el archivo se acota al archivo", () => {
    // Defensivo: un manifiesto inconsistente no puede leer fuera del
    // buffer (el motor nativo también se protege así).
    const t = track({
      clips: [
        {
          startSeconds: 0,
          buffer: fakeBuffer(1, 0.5),
          sourceOffsetSeconds: 0.5,
          sourceDurationSeconds: 10,
        },
      ],
    });
    expect(contentDurationSeconds([t])).toBeCloseTo(0.5, 9);
  });
});

describe("volumen y fades del clip", () => {
  it("el volumen del clip multiplica al de la pista", () => {
    const t = track({
      volume: 0.5,
      clips: [{ startSeconds: 0, buffer: fakeBuffer(1, 0.8), gain: 0.5 }],
    });
    const mix = renderProjectMix([t], NO_LIMITER, FS);
    expect(mix.left[FS / 2]).toBeCloseTo(0.8 * 0.5 * 0.5 * Math.SQRT1_2, 5);
  });

  it("el fade-in es una rampa LINEAL desde 0, como en el motor", () => {
    const t = track({
      clips: [{ startSeconds: 0, buffer: fakeBuffer(2, 1), fadeInSeconds: 1 }],
    });
    const mix = renderProjectMix([t], NO_LIMITER, FS);
    const g = Math.SQRT1_2;
    expect(mix.left[0]).toBeCloseTo(0, 6);
    // A la mitad del fade, la mitad del valor: eso es lo que hace que
    // sea lineal y no exponencial (ver renderBlock en native_engine.cpp).
    expect(mix.left[FS / 2]).toBeCloseTo(0.5 * g, 3);
    expect(mix.left[FS + 100]).toBeCloseTo(g, 3);
  });

  it("el fade-out llega a cero al final de la VENTANA", () => {
    const t = track({
      clips: [
        {
          startSeconds: 0,
          buffer: fakeBuffer(4, 1),
          sourceDurationSeconds: 2,
          fadeOutSeconds: 1,
        },
      ],
    });
    const mix = renderProjectMix([t], NO_LIMITER, FS);
    const g = Math.SQRT1_2;
    // Antes de que empiece el fade, valor pleno.
    expect(mix.left[FS / 2]).toBeCloseTo(g, 3);
    // A mitad del fade-out, la mitad.
    expect(mix.left[Math.round(1.5 * FS)]).toBeCloseTo(0.5 * g, 2);
    // Y en el último frame de la ventana, prácticamente nada.
    expect(Math.abs(mix.left[2 * FS - 1])).toBeLessThan(0.01);
  });
});

describe("manifestClipToMixdownClip", () => {
  it("un manifiesto SIN las claves nuevas da el clip entero y neutro", () => {
    // formatVersion 1/2, o uno escrito por el Arranger web (que hornea
    // el recorte y los fades en el WAV).
    const buffer = fakeBuffer(3, 0.5);
    const clip = manifestClipToMixdownClip(
      { startBeat: 2, sampleRate: FS },
      buffer,
    );
    expect(clip.startSeconds).toBe(2);
    expect(clip.sourceOffsetSeconds).toBeUndefined();
    expect(clip.sourceDurationSeconds).toBeUndefined();
    expect(clip.gain).toBeUndefined();
    expect(contentDurationSeconds([track({ clips: [clip] })])).toBeCloseTo(5, 9);
  });

  it("los frames se convierten con el sampleRate del MANIFIESTO", () => {
    // ⚠️ No con el del buffer: decodeAudioData devuelve el audio a la
    // tasa del CONTEXTO, así que los dos pueden no coincidir (ver
    // resample.ts y el bug del paquete de pistas del 2026-09-21).
    const buffer = fakeBuffer(4, 0.5); // decodificado a FS
    const clip = manifestClipToMixdownClip(
      {
        startBeat: 0,
        sampleRate: 22050, // el archivo original era de media tasa
        sourceTrimStartFrame: 22050,
        sourceTrimDurationFrames: 44100,
      },
      buffer,
    );
    expect(clip.sourceOffsetSeconds).toBeCloseTo(1, 9);
    expect(clip.sourceDurationSeconds).toBeCloseTo(2, 9);
  });

  it("sin sampleRate utilizable no inventa un recorte", () => {
    // Un manifiesto roto tiene que dar "clip entero", no una ventana
    // calculada con una división por cero.
    const clip = manifestClipToMixdownClip(
      { startBeat: 0, sampleRate: 0, sourceTrimDurationFrames: 44100 },
      fakeBuffer(3, 0.5),
    );
    expect(clip.sourceDurationSeconds).toBeUndefined();
    expect(contentDurationSeconds([track({ clips: [clip] })])).toBeCloseTo(3, 9);
  });
});
