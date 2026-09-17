// src/lib/keyDetect.test.ts

import { describe, expect, it } from "vitest";
import { chromagram, detectKey, fftInPlace, isKnownSampleKey, keyFromChroma } from "./keyDetect";

const SAMPLE_RATE = 44100;

/** Un acorde sostenido con sus armónicos, que es lo que ve un detector real. */
function chord(midiNotes: number[], seconds = 4): Float32Array {
  const samples = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (const midi of midiNotes) {
    const frequency = 440 * Math.pow(2, (midi - 69) / 12);
    for (let harmonic = 1; harmonic <= 4; harmonic++) {
      const f = frequency * harmonic;
      if (f > SAMPLE_RATE / 2) break;
      const amplitude = 0.25 / harmonic;
      for (let i = 0; i < samples.length; i++) {
        samples[i] += amplitude * Math.sin((2 * Math.PI * f * i) / SAMPLE_RATE);
      }
    }
  }
  return samples;
}

describe("FFT", () => {
  it("encuentra la frecuencia de una senoide donde corresponde", () => {
    const n = 1024;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    // 8 ciclos completos en la ventana: el pico va justo en el bin 8.
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 8 * i) / n);
    fftInPlace(re, im);
    let bestBin = 0;
    let best = 0;
    for (let k = 1; k < n / 2; k++) {
      const magnitude = Math.hypot(re[k], im[k]);
      if (magnitude > best) {
        best = magnitude;
        bestBin = k;
      }
    }
    expect(bestBin).toBe(8);
  });

  it("de una constante deja todo en el bin 0", () => {
    const n = 64;
    const re = new Float32Array(n).fill(1);
    const im = new Float32Array(n);
    fftInPlace(re, im);
    expect(re[0]).toBeCloseTo(64, 3);
    for (let k = 1; k < n; k++) expect(Math.hypot(re[k], im[k])).toBeLessThan(1e-3);
  });
});

describe("cromagrama", () => {
  it("un LA 440 aislado cae en la clase de altura 9", () => {
    const samples = new Float32Array(SAMPLE_RATE * 2);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE);
    const { perBin } = chromagram(samples, SAMPLE_RATE);
    // Se mira `perBin` y no `weights`: los pesos ya traen la
    // compensación del tercer armónico, que a propósito le suma a cada
    // nota parte de lo de su quinta.
    let bestIndex = 0;
    for (let i = 1; i < 12; i++) if (perBin[i] > perBin[bestIndex]) bestIndex = i;
    expect(bestIndex).toBe(9); // 0 = C, así que 9 = A
  });

  it("no depende de la OCTAVA", () => {
    // El mismo LA una octava más abajo tiene que caer en la misma
    // clase: eso es lo que significa "cromagrama". (220 Hz y no 110:
    // el rango del cromagrama arranca en G2, 98 Hz, y 110 quedaría en
    // el borde mismo.)
    const samples = new Float32Array(SAMPLE_RATE * 2);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE);
    const { perBin } = chromagram(samples, SAMPLE_RATE);
    let bestIndex = 0;
    for (let i = 1; i < 12; i++) if (perBin[i] > perBin[bestIndex]) bestIndex = i;
    expect(bestIndex).toBe(9);
  });

  it("de un audio más corto que la ventana devuelve ceros", () => {
    const { weights, perBin } = chromagram(new Float32Array(100), SAMPLE_RATE);
    expect([...weights, ...perBin].every((v) => v === 0)).toBe(true);
  });
});

describe("tonalidad a partir del cromagrama", () => {
  /**
   * Un cromagrama como el de música real: suenan las notas de la
   * escala, pero NO todas lo mismo — la tónica manda, después la
   * quinta y la tercera.
   *
   * ⚠️ Pesarlas todas igual no sirve para probar esto, y el primer
   * intento cayó justo ahí: una escala mayor y su relativa menor tienen
   * EXACTAMENTE las mismas siete notas, así que con pesos iguales los
   * dos cromagramas son el mismo vector y no hay nada que distinguir.
   * Lo único que las separa es cuánto pesa cada nota, que es
   * precisamente lo que miden los perfiles de Krumhansl-Schmuckler.
   */
  function scaleChroma(tonic: number, intervals: number[]): number[] {
    const chroma = new Array(12).fill(0.05);
    for (const interval of intervals) chroma[(tonic + interval) % 12] = 0.4;
    chroma[(tonic + intervals[4]) % 12] = 0.8; // la quinta
    chroma[(tonic + intervals[2]) % 12] = 0.7; // la tercera, mayor o menor
    chroma[tonic] = 1;
    return chroma;
  }
  const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
  const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

  it("reconoce una escala mayor", () => {
    // Do mayor: las teclas blancas.
    expect(keyFromChroma(scaleChroma(0, MAJOR_SCALE))!.key).toBe("C Major");
  });

  it("reconoce una escala menor", () => {
    expect(keyFromChroma(scaleChroma(9, MINOR_SCALE))!.key).toBe("A Minor");
  });

  it("la segunda opción es siempre una tonalidad vecina", () => {
    // Para Do mayor, las vecinas son su relativa (La menor) y las dos
    // de al lado en el círculo de quintas (Sol y Fa mayor), que
    // comparten seis de las siete notas.
    //
    // ⚠️ La segunda NO es necesariamente la relativa, aunque sea la
    // confusión de la que más se habla: acá gana Sol mayor. Es correcto
    // y por eso el test acepta cualquiera de las tres — fijar una sola
    // sería fijar un detalle del perfil, no una propiedad musical.
    const estimate = keyFromChroma(scaleChroma(0, MAJOR_SCALE))!;
    expect(estimate.key).toBe("C Major");
    expect(["A Minor", "G Major", "F Major"]).toContain(estimate.alternative);
  });

  it("funciona en cualquier tónica", () => {
    expect(keyFromChroma(scaleChroma(3, MAJOR_SCALE))!.key).toBe("Eb Major");
    expect(keyFromChroma(scaleChroma(6, MINOR_SCALE))!.key).toBe("F# Minor");
  });

  it("de un cromagrama PLANO no dice nada", () => {
    // Un vector sin varianza correlaciona 0 contra cualquier perfil, así
    // que no llega al mínimo. El caso real de la percusión lo ataja
    // antes `detectKey`, con el contraste — ver MIN_CHROMA_CONTRAST.
    expect(keyFromChroma(new Array(12).fill(0.5))).toBeNull();
  });

  it("de un cromagrama vacío no dice nada", () => {
    expect(keyFromChroma(new Array(12).fill(0))).toBeNull();
  });

  it("siempre devuelve un nombre que el catálogo conoce", () => {
    for (let tonic = 0; tonic < 12; tonic++) {
      for (const intervals of [MAJOR_SCALE, MINOR_SCALE]) {
        const estimate = keyFromChroma(scaleChroma(tonic, intervals))!;
        expect(isKnownSampleKey(estimate.key)).toBe(true);
        expect(isKnownSampleKey(estimate.alternative)).toBe(true);
      }
    }
  });
});

describe("detección sobre audio", () => {
  it("un acorde de Do mayor da una tonalidad con Do adentro", () => {
    // C4 E4 G4. Con armónicos, un acorde suelto puede leerse como su
    // relativa o su dominante: lo que se fija acá es que la nota
    // fundamental aparezca en la respuesta, no la respuesta exacta.
    const estimate = detectKey(chord([60, 64, 67]), SAMPLE_RATE)!;
    expect(estimate).not.toBeNull();
    expect(`${estimate.key} ${estimate.alternative}`).toContain("C ");
  });

  it("un acorde de La menor da una tonalidad con La adentro", () => {
    const estimate = detectKey(chord([57, 60, 64]), SAMPLE_RATE)!;
    expect(`${estimate.key} ${estimate.alternative}`).toContain("A ");
  });

  it("del ruido blanco no dice nada", () => {
    const samples = new Float32Array(SAMPLE_RATE * 2);
    let seed = 99;
    for (let i = 0; i < samples.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      samples[i] = (seed / 0x7fffffff) * 2 - 1;
    }
    expect(detectKey(samples, SAMPLE_RATE)).toBeNull();
  });

  it("del silencio no dice nada", () => {
    expect(detectKey(new Float32Array(SAMPLE_RATE * 2), SAMPLE_RATE)).toBeNull();
  });
});
