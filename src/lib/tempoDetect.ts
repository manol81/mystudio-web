// src/lib/tempoDetect.ts
//
// Adivinar el TEMPO de un audio mirando el audio, no el nombre del
// archivo.
//
// ⚠️ No confundir con la heurística de `scripts/samples.mjs`, que lee el
// BPM del NOMBRE (`kick_90bpm_Am.wav`). Esa sirve para packs que vienen
// nombrados así y es inútil para una grabación propia llamada
// `idea3.wav`. Esto es lo otro: escuchar.
//
// Por qué importa acá: al subir un archivo desde la computadora, el
// Arranger venía asumiendo `originalBpm = tempo del proyecto`, o sea
// "esto ya está a tiempo, no lo toques". Es la suposición más segura
// pero casi siempre es falsa, y el costo de que sea falsa es que el
// clip NO se estira y queda corrido contra todo lo demás.
//
// ─── Cómo funciona ───────────────────────────────────────────────────
//
// 1. Se arma una ENVOLVENTE DE ATAQUES: cuánto SUBE la energía de un
//    cuadro al siguiente. Solo la subida —una bajada de energía no es
//    un golpe— y en escala logarítmica, para que un pasaje suave aporte
//    tanto como uno fuerte.
// 2. Se AUTOCORRELACIONA esa envolvente, SUMANDO ARMÓNICOS: el puntaje
//    de un desplazamiento incluye también el de su doble, su triple y
//    su cuádruple. Un pulso real se repite en todos ellos; un pico
//    casual, en ninguno.
// 3. Se PLIEGAN las octavas a un rango preferido: 90 y 180 BPM son la
//    misma música y no hay forma de distinguirlas escuchando, solo
//    convenciones.
// 4. Si el archivo resulta durar un número entero de compases a ese
//    tempo, se AJUSTA al valor exacto que da ese calce. Es lo que hace
//    que un loop salga en 120,0 y no en 119,3 — y lo que la gente sube
//    a un arreglo son loops la mayoría de las veces.

/** Cuadros por segundo de la envolvente de ataques. */
const ENVELOPE_RATE = 100;

/**
 * Cuántos saltos de cuadro mide la ventana de análisis. 4 = ventanas de
 * 40 ms que se solapan, avanzando de a 10 ms.
 *
 * ⚠️ Solapar no es un detalle: con ventanas pegadas (una por salto) la
 * energía de cada cuadro es una medición demasiado corta y ruidosa, y
 * con audio REAL —donde nunca hay silencio entre golpes, siempre hay
 * cola de reverb, bajo y hi-hats— la autocorrelación no encuentra
 * nada. Medido sobre un loop de batería de 116 BPM: con ventanas
 * pegadas el detector decía 63,2 BPM; con ventanas de 4 saltos y suma
 * de armónicos, 115,4.
 */
const ANALYSIS_WINDOW_HOPS = 4;

/**
 * Cuántos armónicos se suman al puntaje de cada desplazamiento.
 *
 * Es la otra mitad del arreglo de arriba. Un pulso de negras también se
 * repite cada dos negras, cada tres y cada cuatro; un pico casual de la
 * autocorrelación no. Sumar los armónicos con peso decreciente premia
 * al que es realmente periódico.
 */
const HARMONIC_COUNT = 4;

/** Rango donde se busca. Fuera de esto no hay con qué decidir. */
const MIN_BPM = 60;
const MAX_BPM = 200;

/**
 * Dónde cae el tempo una vez plegadas las octavas.
 *
 * 90 y 180 son indistinguibles para cualquier algoritmo —y para mucha
 * gente— así que hay que elegir por convención. Este rango es el que
 * usan los packs de samples y las tablas de DJ.
 */
const PREFERRED_MIN_BPM = 78;
const PREFERRED_MAX_BPM = 156;

/** Más que esto no hace falta escuchar: el tempo no suele cambiar. */
const MAX_ANALYSIS_SECONDS = 60;

/**
 * Cuánto tiene que saltar la energía para contar como un ATAQUE.
 *
 * ⚠️ **Este umbral es lo ÚNICO que distingue música de no-música acá**,
 * y sin él el detector MIENTE con total seguridad. Un tono sostenido no
 * tiene ataques, pero al partirlo en cuadros su energía ondula igual,
 * porque en cada cuadro entra una fracción distinta de ciclo; esa
 * ondulación es perfectamente periódica y la autocorrelación la
 * encuentra. Con ruido blanco pasa lo mismo.
 *
 * La confianza NO sirve para este trabajo: medida sobre archivos
 * reales da entre 0,54 y 0,82, y sobre ruido blanco da 0,58. Lo que
 * separa los casos es el TAMAÑO absoluto del salto de energía, no lo
 * regular que sea.
 *
 * Medido en unidades de log-energía, con la ventana de 4 saltos:
 *   · silencio 0 · seno de 220 Hz 0,031 · ruido blanco 0,052
 *   · piano real 0,689 · loop de batería real 1,337
 * 0,2 queda en el medio, con un factor 4 de margen para cada lado.
 */
const MIN_ONSET_STRENGTH = 0.2;

/**
 * Cuántos ataques hacen falta como mínimo. Con menos de cuatro no hay
 * de dónde sacar un pulso — un archivo con un solo golpe al principio
 * no tiene tempo, tiene un golpe.
 *
 * ⚠️ Se cuentan contra MIN_ONSET_STRENGTH, un umbral FIJO, y no contra
 * una fracción del pico. Contra el pico fallaba con archivos reales: un
 * piano grabado tenía un transitorio suelto de 13,0 cuando sus ataques
 * normales rondaban 1,5, así que "el 25 % del pico" daba 3,26 y casi
 * ningún ataque real lo pasaba. El detector decía "no hay pulso" en un
 * archivo con pulso clarísimo. Un umbral relativo al máximo es rehén
 * de un solo valor atípico.
 */
const MIN_ONSET_COUNT = 4;

/** Compases de 4/4 que puede tener un loop, de más largo a más corto. */
const LOOP_BAR_CANDIDATES = [64, 48, 32, 24, 16, 12, 8, 6, 4, 3, 2, 1];

/**
 * Qué tan cerca tiene que estar el largo del archivo de un número
 * entero de compases para creerle. 1,5 % de 8 segundos son 120 ms.
 */
const LOOP_TOLERANCE = 0.015;

export interface TempoEstimate {
  bpm: number;
  /** 0..1. Debajo de 0,25 el resultado no vale más que una moneda al aire. */
  confidence: number;
  /** El largo calzó con un número entero de compases y el BPM se ajustó a ese calce. */
  snappedToLoop: boolean;
  /** Cuántos compases dura, si calzó. */
  bars: number | null;
}

/**
 * La envolvente de ataques: cuánto SUBE la energía de un cuadro al
 * siguiente.
 *
 * Solo la subida, porque una bajada de energía no es un golpe. Y en
 * escala logarítmica porque lo que define el pulso es el CONTRASTE, no
 * el volumen: en lineal, un estribillo fuerte tapa una estrofa suave y
 * la autocorrelación termina siguiendo la forma de la canción en vez
 * del pulso.
 */
export function onsetEnvelope(
  samples: Float32Array,
  sampleRate: number,
  envelopeRate = ENVELOPE_RATE,
): Float32Array {
  const hop = Math.max(1, Math.round(sampleRate / envelopeRate));
  // Ventanas SOLAPADAS: avanzan de a un salto pero miden varios. Ver
  // ANALYSIS_WINDOW_HOPS — con ventanas pegadas esto no funciona con
  // audio real.
  const window = hop * ANALYSIS_WINDOW_HOPS;
  const frames = Math.floor((samples.length - window) / hop);
  if (frames < 2) return new Float32Array(0);

  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const start = f * hop;
    const end = Math.min(samples.length, start + window);
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    // El 1e-9 es para que el logaritmo del silencio sea un número y no
    // -infinito, que envenenaría la media y el desvío de todo el resto.
    energy[f] = Math.log(1e-9 + sum / Math.max(1, end - start));
  }

  const envelope = new Float32Array(frames - 1);
  for (let f = 1; f < frames; f++) {
    envelope[f - 1] = Math.max(0, energy[f] - energy[f - 1]);
  }
  return envelope;
}

/** Resta la media y divide por el desvío: la autocorrelación mide FORMA, no nivel. */
function normalize(values: Float32Array): Float32Array {
  if (values.length === 0) return values;
  let mean = 0;
  for (const v of values) mean += v;
  mean /= values.length;
  let variance = 0;
  for (const v of values) variance += (v - mean) * (v - mean);
  variance /= values.length;
  const deviation = Math.sqrt(variance);
  const out = new Float32Array(values.length);
  if (deviation < 1e-12) return out; // señal plana: nada que correlacionar
  for (let i = 0; i < values.length; i++) out[i] = (values[i] - mean) / deviation;
  return out;
}

/** Autocorrelación normalizada en un desplazamiento dado. */
function correlationAt(values: Float32Array, lag: number): number {
  const n = values.length - lag;
  if (n <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += values[i] * values[i + lag];
  return sum / n;
}

/**
 * Lleva un tempo al rango preferido duplicándolo o partiéndolo al
 * medio. 90 y 180 BPM son la misma música: elegir es una convención,
 * no una medición.
 */
export function foldToPreferredRange(bpm: number): number {
  if (!(bpm > 0)) return bpm;
  let folded = bpm;
  // Los topes de vueltas evitan un lazo infinito con un número raro.
  for (let i = 0; i < 8 && folded < PREFERRED_MIN_BPM; i++) folded *= 2;
  for (let i = 0; i < 8 && folded > PREFERRED_MAX_BPM; i++) folded /= 2;
  return folded;
}

/**
 * Si el archivo dura un número entero de compases a ese tempo, devuelve
 * el tempo EXACTO que da ese calce.
 *
 * Es el paso que más cambia el resultado en la práctica: la
 * autocorrelación de un loop de cuatro compases da algo como 119,3, y
 * el calce lo lleva a 120,000. Un error de 0,7 BPM no se nota en dos
 * compases y se nota muchísimo a los treinta.
 */
export function snapToLoopLength(
  roughBpm: number,
  durationSeconds: number,
  beatsPerBar = 4,
): { bpm: number; bars: number } | null {
  if (!(roughBpm > 0) || !(durationSeconds > 0) || !(beatsPerBar > 0)) return null;
  const roughBars = (durationSeconds * roughBpm) / (60 * beatsPerBar);
  for (const bars of LOOP_BAR_CANDIDATES) {
    if (Math.abs(roughBars - bars) / bars <= LOOP_TOLERANCE) {
      return { bpm: (bars * beatsPerBar * 60) / durationSeconds, bars };
    }
  }
  return null;
}

/**
 * El tempo de un audio, o null si no se puede decir nada.
 *
 * `samples` es UN canal; el llamador mezcla a mono si hace falta.
 */
export function detectTempo(
  samples: Float32Array,
  sampleRate: number,
  beatsPerBar = 4,
): TempoEstimate | null {
  if (!(sampleRate > 0) || samples.length < sampleRate) return null;

  const durationSeconds = samples.length / sampleRate;
  const analyzed =
    durationSeconds > MAX_ANALYSIS_SECONDS
      ? samples.subarray(0, Math.floor(MAX_ANALYSIS_SECONDS * sampleRate))
      : samples;

  const raw = onsetEnvelope(analyzed, sampleRate);
  if (raw.length < ENVELOPE_RATE) return null;

  // Antes de normalizar hay que mirar el tamaño ABSOLUTO de los saltos:
  // normalizar convierte cualquier ondulación mínima en algo que parece
  // una señal fuerte. Ver MIN_ONSET_STRENGTH.
  let peak = 0;
  let strongOnsets = 0;
  for (const v of raw) {
    if (v > peak) peak = v;
    if (v > MIN_ONSET_STRENGTH) strongOnsets++;
  }
  if (peak < MIN_ONSET_STRENGTH || strongOnsets < MIN_ONSET_COUNT) return null;

  const envelope = normalize(raw);

  const minLag = Math.floor((60 / MAX_BPM) * ENVELOPE_RATE);
  const maxLag = Math.min(Math.ceil((60 / MIN_BPM) * ENVELOPE_RATE), envelope.length - 1);
  if (maxLag <= minLag) return null;

  // Puntaje de un desplazamiento: su propia correlación más la de sus
  // armónicos, con peso decreciente. Ver HARMONIC_COUNT.
  const scoreAt = (lag: number) => {
    let total = correlationAt(envelope, lag);
    for (let h = 2; h <= HARMONIC_COUNT; h++) total += correlationAt(envelope, lag * h) / h;
    return total;
  };

  const scores = new Map<number, number>();
  let bestLag = 0;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const score = scoreAt(lag);
    scores.set(lag, score);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag === 0 || !(bestScore > 0)) return null;

  // Interpolación parabólica contra los vecinos del pico: la resolución
  // de un cuadro es de 10 ms, que a 120 BPM ya son 2,4 BPM de error.
  const before = scoreAt(bestLag - 1);
  const after = scoreAt(bestLag + 1);
  const denominator = before - 2 * bestScore + after;
  const offset = Math.abs(denominator) > 1e-12 ? (0.5 * (before - after)) / denominator : 0;
  const refinedLag = bestLag + Math.max(-1, Math.min(1, offset));

  const rawBpm = (60 * ENVELOPE_RATE) / refinedLag;
  const folded = foldToPreferredRange(rawBpm);
  const snapped = snapToLoopLength(folded, durationSeconds, beatsPerBar);

  return {
    bpm: snapped ? snapped.bpm : folded,
    confidence: confidenceOf(scores, bestLag, bestScore),
    snappedToLoop: snapped != null,
    bars: snapped ? snapped.bars : null,
  };
}

/**
 * Cuán CLARO fue el ganador: cuánto le saca al mejor candidato que no
 * sea pariente suyo (ni un múltiplo, ni un divisor, ni un vecino).
 *
 * ⚠️ Esto mide AMBIGÜEDAD, no veracidad. Un tempo de 0,8 no quiere
 * decir "seguro que hay música": quiere decir "si hay pulso, es éste y
 * no otro". Decidir si hay música o no lo hace MIN_ONSET_STRENGTH, que
 * es lo único que separa un loop de un ruido — ver su nota.
 */
function confidenceOf(scores: Map<number, number>, bestLag: number, bestScore: number): number {
  let rival = 0;
  for (const [lag, score] of scores) {
    let related = false;
    for (let k = 1; k <= HARMONIC_COUNT; k++) {
      if (Math.abs(lag - bestLag * k) <= bestLag * k * 0.08) related = true;
      if (Math.abs(lag - bestLag / k) <= (bestLag / k) * 0.08) related = true;
    }
    if (!related && score > rival) rival = score;
  }
  if (rival <= 0) return 1;
  return Math.max(0, Math.min(1, bestScore / (bestScore + rival)));
}
