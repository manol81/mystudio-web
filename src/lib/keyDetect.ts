// src/lib/keyDetect.ts
//
// Adivinar la TONALIDAD de un audio escuchándolo.
//
// Hermano de tempoDetect.ts y con el mismo propósito: que subir un
// sample no obligue a medir el tono a mano con otra aplicación, que es
// lento y se presta a errores que después nadie encuentra — un sample
// con la tonalidad mal cargada no rompe nada, solo aparece donde no
// corresponde y desaparece donde sí, y quien lo use concluye que el
// Banco de Sonidos es malo.
//
// ─── Cómo funciona ───────────────────────────────────────────────────
//
// 1. **Cromagrama.** Se parte el audio en ventanas, se les saca el
//    espectro con una FFT propia, y la energía de cada bin se suma en
//    la NOTA a la que pertenece, sin importar la octava. Quedan 12
//    números: cuánto suena cada nota de la escala cromática en todo el
//    archivo.
// 2. **Perfiles de Krumhansl-Schmuckler.** Son dos vectores de 12
//    valores —uno mayor y uno menor— medidos experimentalmente en 1982
//    preguntándole a oyentes qué tan bien "cerraba" cada nota después
//    de escuchar un contexto tonal. Se correlaciona el cromagrama
//    contra los dos perfiles ROTADOS a cada una de las 12 tónicas: 24
//    correlaciones, gana la más alta.
//
// ⚠️ **La confusión estructural es la relativa** (C Major y A Minor
// tienen exactamente las mismas notas). Los perfiles las distinguen por
// el PESO de cada nota, no por cuáles aparecen, así que en material
// ambiguo el margen entre las dos es chico. Por eso se devuelve también
// la segunda opción: es más útil ofrecer "A Minor, o quizás C Major"
// que afirmar una de las dos con cara de certeza.

import { SAMPLE_KEYS } from "./sampleTaxonomy";

/** Igual que KEY_ROOTS de sampleTaxonomy: el índice ES la clase de altura (0 = C). */
const ROOT_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];

/**
 * ⚠️ 8192 y no 4096, y el motivo es aritmética, no gusto.
 *
 * Un bin de la FFT mide `sampleRate / N` hercios y un semitono mide un
 * 5,95 % de su propia frecuencia. Para que dos notas vecinas caigan en
 * bins distintos hace falta `f > (sampleRate / N) / 0,0595`:
 *   · N = 4096 → resuelve recién desde 181 Hz
 *   · N = 8192 → desde 91 Hz
 * Con 4096 y el rango arrancando en 65 Hz, TODO lo que había entre 65 y
 * 181 Hz se repartía entre notas prácticamente al azar. El síntoma
 * medido con archivos reales: un loop en Do mayor daba Do SOSTENIDO
 * como la nota más presente, que en Do mayor no existe.
 */
const FFT_SIZE = 8192;
const HOP_SIZE = 4096;

/**
 * Rango de frecuencias que entra al cromagrama: G2 a C6.
 *
 * Abajo de G2 quedan los graves de bombos y sub-bajos, que aportan
 * energía sin aportar tonalidad. Arriba de C6 lo que queda son casi
 * puros armónicos de otras notas, que empujan hacia la quinta y la
 * tercera de cosas que no son la tónica.
 *
 * Los dos extremos se eligieron midiendo contra las fichas cargadas a
 * mano del catálogo real, no a ojo: con 65-2093 Hz el detector acertaba
 * 0 de 7; con 98-1046, 5 de 7.
 */
const MIN_FREQUENCY = 98; // G2
const MAX_FREQUENCY = 1046; // C6

/**
 * Cuánto se le devuelve a cada nota de la energía que su TERCER
 * ARMÓNICO dejó en su quinta.
 *
 * ⚠️ Sin esto el detector tiene un sesgo sistemático hacia la
 * DOMINANTE, y no es sutil: de siete archivos reales, cuatro daban
 * exactamente la quinta de la tonalidad correcta. La causa es física —
 * el tercer armónico de cualquier nota cae en su quinta (una octava más
 * arriba), así que tocar Do deposita energía en Sol, y el perfil de Sol
 * mayor termina explicando el cromagrama mejor que el de Do.
 *
 * 0,6 salió de barrer el parámetro contra el catálogo real.
 */
const FIFTH_HARMONIC_COMPENSATION = 0.6;

/**
 * Más que esto no hace falta escuchar, y escucharlo cuesta caro: cada
 * ventana es una FFT de 4096 puntos, y una canción de tres minutos son
 * más de tres mil ventanas bloqueando el hilo principal. La tonalidad,
 * además, no suele cambiar.
 */
const MAX_ANALYSIS_SECONDS = 60;

/**
 * Perfiles de Krumhansl & Kessler (1982). El índice 0 es la TÓNICA.
 *
 * No son inventados ni ajustados a ojo: salen de un experimento con
 * oyentes. Cambiarlos "para que ande mejor con este sample" es
 * exactamente cómo se rompe un detector de tonalidad.
 */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/**
 * Cuánto tiene que sobresalir el cromagrama para que haya algo tonal.
 *
 * Un loop de batería reparte energía entre las 12 notas: su cromagrama
 * es casi plano, y correlacionar ruido contra un perfil siempre
 * devuelve ALGUNA tonalidad.
 *
 * ⚠️ Se mide sobre `perBin`, no sobre los pesos. Ver la nota de
 * Chromagram: son dos vectores distintos justamente porque esta
 * decisión y la de identificar la tonalidad necesitan cosas opuestas.
 * Medido: ruido blanco 0,130 · percusión real null · samples tonales
 * reales entre 0,416 y 0,708. 0,25 queda en el medio.
 */
const MIN_CHROMA_CONTRAST = 0.25;

/** Debajo de esto la correlación ganadora no se distingue del azar. */
const MIN_CORRELATION = 0.5;

export interface KeyEstimate {
  /** En el formato de SAMPLE_KEYS: "A Minor", "Eb Major". */
  key: string;
  /** 0..1 — cuánto le saca la ganadora a la segunda. Ver la nota sobre la relativa. */
  confidence: number;
  /** La segunda más probable, casi siempre la relativa o la vecina de quintas. */
  alternative: string;
}

/**
 * FFT iterativa (Cooley-Tukey, radix-2, in-place). Trabaja sobre `re` e
 * `im`, cuyo largo tiene que ser potencia de dos.
 *
 * Va escrita a mano y no como dependencia: son cuarenta líneas, y el
 * proyecto ya arrastró bastantes conflictos de versiones (ver la
 * sección 3 de CLAUDE.md) como para sumar un paquete por esto.
 */
export function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;

  // Reordenamiento por bits invertidos.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const stepReal = Math.cos(angle);
    const stepImag = Math.sin(angle);
    const half = len >> 1;
    for (let start = 0; start < n; start += len) {
      let wReal = 1;
      let wImag = 0;
      for (let k = 0; k < half; k++) {
        const evenReal = re[start + k];
        const evenImag = im[start + k];
        const oddReal = re[start + k + half] * wReal - im[start + k + half] * wImag;
        const oddImag = re[start + k + half] * wImag + im[start + k + half] * wReal;
        re[start + k] = evenReal + oddReal;
        im[start + k] = evenImag + oddImag;
        re[start + k + half] = evenReal - oddReal;
        im[start + k + half] = evenImag - oddImag;
        const nextReal = wReal * stepReal - wImag * stepImag;
        wImag = wReal * stepImag + wImag * stepReal;
        wReal = nextReal;
      }
    }
  }
}

export interface Chromagram {
  /**
   * Cuánto suena cada nota, ya compensada la contaminación del tercer
   * armónico. Es lo que se compara contra los perfiles.
   */
  weights: Float32Array;
  /**
   * Lo mismo pero dividido por cuántos bins de la FFT caen en cada
   * nota. Solo sirve para decidir si HAY tonalidad.
   *
   * ⚠️ Son dos vectores porque las dos preguntas piden lo contrario, y
   * usar uno solo rompe una de las dos — probado en las dos
   * direcciones. Los bins están repartidos linealmente en frecuencia y
   * las notas logarítmicamente, así que las notas agudas se llevan
   * muchos más bins: con ruido blanco —que no tiene tonalidad— el
   * reparto desparejo alcanza para que una nota gane y el detector
   * devuelva "A Minor" con seguridad. Dividir por la cantidad de bins
   * aplana el ruido y lo deja en evidencia. Pero esa misma división
   * multiplica la región grave, donde la resolución es peor, y ahí la
   * identificación empeora mucho. Entonces: se identifica con los
   * pesos crudos y se decide si hay tonalidad con los normalizados.
   */
  perBin: Float32Array;
}

/**
 * Cuánto suena cada una de las 12 notas en todo el archivo, sin
 * importar la octava.
 */
export function chromagram(samples: Float32Array, sampleRate: number): Chromagram {
  const chroma = new Float32Array(12);
  if (!(sampleRate > 0) || samples.length < FFT_SIZE) {
    return { weights: chroma, perBin: new Float32Array(12) };
  }

  // Ventana de Hann: sin ella, cortar el audio en pedazos rectangulares
  // inventa bandas laterales que ensucian los bins vecinos, y en un
  // cromagrama eso se traduce en semitonos que no están sonando.
  const window = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
  }

  // La nota de cada bin se calcula UNA vez: es la misma en todos los
  // cuadros y son miles de logaritmos que no hace falta repetir.
  const minBin = Math.max(1, Math.floor((MIN_FREQUENCY * FFT_SIZE) / sampleRate));
  const maxBin = Math.min(FFT_SIZE / 2 - 1, Math.ceil((MAX_FREQUENCY * FFT_SIZE) / sampleRate));
  const binPitchClass = new Int8Array(FFT_SIZE / 2);
  /** Cuántos bins caen en cada nota — ver la nota de `perBin`. */
  const binsPerPitchClass = new Float32Array(12);
  for (let bin = minBin; bin <= maxBin; bin++) {
    const frequency = (bin * sampleRate) / FFT_SIZE;
    const midi = 69 + 12 * Math.log2(frequency / 440);
    const pitchClass = (((Math.round(midi) % 12) + 12) % 12) as number;
    binPitchClass[bin] = pitchClass;
    binsPerPitchClass[pitchClass]++;
  }

  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const frame = new Float32Array(12);
  let frames = 0;

  for (let start = 0; start + FFT_SIZE <= samples.length; start += HOP_SIZE) {
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = samples[start + i] * window[i];
      im[i] = 0;
    }
    fftInPlace(re, im);

    frame.fill(0);
    let total = 0;
    for (let bin = minBin; bin <= maxBin; bin++) {
      const magnitude = Math.hypot(re[bin], im[bin]);
      frame[binPitchClass[bin]] += magnitude;
      total += magnitude;
    }
    // Cada cuadro aporta lo MISMO. Sin normalizar, un estribillo fuerte
    // decide la tonalidad de toda la canción y una intro suave no
    // cuenta, aunque las dos duren lo mismo.
    if (total > 1e-9) {
      for (let i = 0; i < 12; i++) chroma[i] += frame[i] / total;
      frames++;
    }
  }

  if (frames === 0) return { weights: chroma, perBin: new Float32Array(12) };

  let peak = 0;
  for (let i = 0; i < 12; i++) {
    chroma[i] /= frames;
    if (chroma[i] > peak) peak = chroma[i];
  }
  if (peak > 0) for (let i = 0; i < 12; i++) chroma[i] /= peak;

  // Versión normalizada por bins, solo para el gate (ver `perBin`).
  const perBin = new Float32Array(12);
  let perBinPeak = 0;
  for (let i = 0; i < 12; i++) {
    perBin[i] = binsPerPitchClass[i] > 0 ? chroma[i] / binsPerPitchClass[i] : 0;
    if (perBin[i] > perBinPeak) perBinPeak = perBin[i];
  }
  if (perBinPeak > 0) for (let i = 0; i < 12; i++) perBin[i] /= perBinPeak;

  // Compensación del tercer armónico: cada nota recupera parte de lo
  // que dejó en su quinta. Ver FIFTH_HARMONIC_COMPENSATION.
  const weights = new Float32Array(12);
  for (let i = 0; i < 12; i++) {
    weights[i] = chroma[i] + FIFTH_HARMONIC_COMPENSATION * chroma[(i + 7) % 12];
  }
  return { weights, perBin };
}

/** Qué tanto sobresale la nota más presente sobre el promedio, en 0..1. */
function contrastOf(chroma: ArrayLike<number>): number {
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < 12; i++) {
    sum += chroma[i];
    if (chroma[i] > peak) peak = chroma[i];
  }
  return peak <= 0 ? 0 : (peak - sum / 12) / peak;
}

/** Correlación de Pearson entre dos vectores del mismo largo. */
function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= n;
  meanB /= n;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  const denominator = Math.sqrt(varianceA * varianceB);
  return denominator < 1e-12 ? 0 : covariance / denominator;
}

/** El nombre en el formato de SAMPLE_KEYS. */
function keyName(tonic: number, mode: "major" | "minor"): string {
  return `${ROOT_NAMES[tonic]} ${mode === "major" ? "Major" : "Minor"}`;
}

/**
 * La tonalidad de un cromagrama ya calculado, o null si no hay nada
 * tonal que reportar.
 *
 * Separado de `detectKey` para poder probarlo con cromagramas armados a
 * mano, sin tener que sintetizar audio.
 */
export function keyFromChroma(chroma: ArrayLike<number>): KeyEstimate | null {
  const candidates: { key: string; score: number }[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    const major = new Array(12);
    const minor = new Array(12);
    for (let i = 0; i < 12; i++) {
      major[i] = MAJOR_PROFILE[(i - tonic + 12) % 12];
      minor[i] = MINOR_PROFILE[(i - tonic + 12) % 12];
    }
    candidates.push({ key: keyName(tonic, "major"), score: pearson(chroma, major) });
    candidates.push({ key: keyName(tonic, "minor"), score: pearson(chroma, minor) });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const runnerUp = candidates[1];
  if (best.score < MIN_CORRELATION) return null;

  return {
    key: best.key,
    // Cuánto le saca a la segunda, en proporción a lo que vale la
    // ganadora. Con la relativa pisándole los talones esto da bajo, y
    // está bien que dé bajo: eso es exactamente lo que pasa.
    confidence: Math.max(0, Math.min(1, (best.score - runnerUp.score) / Math.abs(best.score))),
    alternative: runnerUp.key,
  };
}

/**
 * La tonalidad de un audio, o null si no hay material tonal.
 *
 * `samples` es UN canal; el llamador mezcla a mono si hace falta.
 */
export function detectKey(samples: Float32Array, sampleRate: number): KeyEstimate | null {
  const maxSamples = Math.floor(MAX_ANALYSIS_SECONDS * sampleRate);
  const analyzed = samples.length > maxSamples ? samples.subarray(0, maxSamples) : samples;
  const { weights, perBin } = chromagram(analyzed, sampleRate);
  // Primero: ¿hay algo tonal? Un loop de batería o ruido llegan hasta
  // acá y no tienen que pasar.
  if (contrastOf(perBin) < MIN_CHROMA_CONTRAST) return null;
  return keyFromChroma(weights);
}

/** Para validar contra la lista cerrada antes de guardar. */
export function isKnownSampleKey(key: string): boolean {
  return (SAMPLE_KEYS as readonly string[]).includes(key);
}
