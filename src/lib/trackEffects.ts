// src/lib/trackEffects.ts
//
// Port EXACTO del DSP de efectos del motor nativo (namespace `dsp` en
// android/app/src/main/cpp/native_engine.cpp) a JavaScript, para que un
// proyecto suene IGUAL en la web que en la app. Antes la web ignoraba
// los efectos por completo: el mismo proyecto sonaba seco acá y
// procesado en el teléfono.
//
// Por qué un port a mano en vez de los nodos nativos de Web Audio:
//   - BiquadFilterNode sí usa las mismas fórmulas RBJ y habría servido,
//     pero DynamicsCompressorNode NO es el mismo compresor (tiene
//     lookahead interno, detector RMS-ish y una curva de knee propia
//     que no se puede desactivar del todo) — con el mismo umbral y
//     relación suena distinto de forma audible.
//   - Freeverb no existe en Web Audio. Armarlo con DelayNode + Gain es
//     posible, pero cualquier ciclo de realimentación en Web Audio
//     suma 128 muestras de retardo obligatorio por render quantum, lo
//     que desafina los ocho peines y cambia el color de la cola.
//   - Este DSP corre sobre Float32Array antes de reproducir (una sola
//     pasada, cacheada), no por muestra en tiempo real: el costo es
//     despreciable y el resultado es bit a bit el mismo algoritmo.
//
// Si se toca el DSP del motor, hay que tocar esto en el mismo commit.

// ─── Parámetros (mismas claves que TrackFxSettings/MasterFxSettings) ────

export interface TrackFx {
  eqLowDb: number;
  eqMidDb: number;
  eqHighDb: number;
  compEnabled: boolean;
  compThresholdDb: number;
  compRatio: number;
  compMakeupDb: number;
  reverbSend: number;
}

export interface MasterFx {
  reverbRoomSize: number;
  reverbDamping: number;
  reverbWet: number;
  limiterEnabled: boolean;
}

export const NO_TRACK_FX: TrackFx = {
  eqLowDb: 0,
  eqMidDb: 0,
  eqHighDb: 0,
  compEnabled: false,
  compThresholdDb: -18,
  compRatio: 3,
  compMakeupDb: 0,
  reverbSend: 0,
};

export const DEFAULT_MASTER_FX: MasterFx = {
  reverbRoomSize: 0.7,
  reverbDamping: 0.5,
  reverbWet: 0.35,
  limiterEnabled: true,
};

/// Tolerante igual que TrackFxSettings.fromJson en Dart: un respaldo
/// anterior a los efectos no trae nada de esto y toma los defaults.
export function parseTrackFx(json: unknown): TrackFx {
  if (!json || typeof json !== "object") return NO_TRACK_FX;
  const o = json as Record<string, unknown>;
  const num = (key: string, fallback: number) =>
    typeof o[key] === "number" ? (o[key] as number) : fallback;
  return {
    eqLowDb: num("eqLowDb", 0),
    eqMidDb: num("eqMidDb", 0),
    eqHighDb: num("eqHighDb", 0),
    compEnabled: o.compEnabled === true,
    compThresholdDb: num("compThresholdDb", -18),
    compRatio: num("compRatio", 3),
    compMakeupDb: num("compMakeupDb", 0),
    reverbSend: num("reverbSend", 0),
  };
}

export function parseMasterFx(json: unknown): MasterFx {
  if (!json || typeof json !== "object") return DEFAULT_MASTER_FX;
  const o = json as Record<string, unknown>;
  const num = (key: string, fallback: number) =>
    typeof o[key] === "number" ? (o[key] as number) : fallback;
  return {
    reverbRoomSize: num("reverbRoomSize", DEFAULT_MASTER_FX.reverbRoomSize),
    reverbDamping: num("reverbDamping", DEFAULT_MASTER_FX.reverbDamping),
    reverbWet: num("reverbWet", DEFAULT_MASTER_FX.reverbWet),
    limiterEnabled: o.limiterEnabled !== false,
  };
}

/// Mismo criterio que TrackFxSettings.isActive: si nada se movió de su
/// valor neutro, no hay por qué gastar una pasada de DSP.
export function isTrackFxActive(fx: TrackFx): boolean {
  return (
    fx.eqLowDb !== 0 ||
    fx.eqMidDb !== 0 ||
    fx.eqHighDb !== 0 ||
    fx.compEnabled ||
    fx.reverbSend > 0
  );
}

// ─── Biquad RBJ — idéntico a dsp::Biquad ────────────────────────────────

type BiquadType = "lowShelf" | "peak" | "highShelf";

class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;

  constructor(type: BiquadType, freqHz: number, gainDb: number, sampleRate: number, q = 1) {
    const A = Math.pow(10, gainDb / 40);
    const w0 = (2 * Math.PI * freqHz) / sampleRate;
    const cw = Math.cos(w0);
    const sw = Math.sin(w0);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;

    if (type === "lowShelf") {
      const alpha = (sw / 2) * Math.sqrt((A + 1 / A) * (1 / 0.707 - 1) + 2);
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cw + s);
      b1 = 2 * A * (A - 1 - (A + 1) * cw);
      b2 = A * (A + 1 - (A - 1) * cw - s);
      a0 = A + 1 + (A - 1) * cw + s;
      a1 = -2 * (A - 1 + (A + 1) * cw);
      a2 = A + 1 + (A - 1) * cw - s;
    } else if (type === "highShelf") {
      const alpha = (sw / 2) * Math.sqrt((A + 1 / A) * (1 / 0.707 - 1) + 2);
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cw + s);
      b1 = -2 * A * (A - 1 + (A + 1) * cw);
      b2 = A * (A + 1 + (A - 1) * cw - s);
      a0 = A + 1 - (A - 1) * cw + s;
      a1 = 2 * (A - 1 - (A + 1) * cw);
      a2 = A + 1 - (A - 1) * cw - s;
    } else {
      const alpha = sw / (2 * q);
      b0 = 1 + alpha * A;
      b1 = -2 * cw;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cw;
      a2 = 1 - alpha / A;
    }

    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  /// Forma directa II transpuesta, igual que el motor.
  processInPlace(samples: Float32Array): void {
    let z1 = this.z1;
    let z2 = this.z2;
    const { b0, b1, b2, a1, a2 } = this;
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      samples[i] = y;
    }
    this.z1 = z1;
    this.z2 = z2;
  }
}

// ─── Compresor — idéntico a dsp::Compressor ─────────────────────────────
//
// Los coeficientes del motor (0.9977 / 0.99981) están calculados para
// 44,1 kHz; acá se derivan de las MISMAS constantes de tiempo (10 ms de
// ataque, 120 ms de release) contra la tasa real del buffer, así que a
// 44,1 kHz dan exactamente los mismos números y a 48 kHz suenan igual
// en vez de ser un poco más rápidos.

const COMP_ATTACK_SECONDS = 0.01;
const COMP_RELEASE_SECONDS = 0.12;

function dbToLin(db: number): number {
  return Math.pow(10, db / 20);
}

function linToDb(lin: number): number {
  return 20 * Math.log10(Math.max(lin, 1e-9));
}

function compressInPlace(
  samples: Float32Array,
  thresholdDb: number,
  ratio: number,
  makeupDb: number,
  sampleRate: number,
): void {
  const attack = Math.exp(-1 / (COMP_ATTACK_SECONDS * sampleRate));
  const release = Math.exp(-1 / (COMP_RELEASE_SECONDS * sampleRate));
  let env = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const level = Math.abs(x);
    const coef = level > env ? attack : release;
    env = coef * env + (1 - coef) * level;
    const over = linToDb(env) - thresholdDb;
    let gainDb = makeupDb;
    if (over > 0 && ratio > 1) gainDb -= over * (1 - 1 / ratio);
    samples[i] = x * dbToLin(gainDb);
  }
}

// ─── Freeverb — idéntico a dsp::Freeverb ────────────────────────────────

const COMB_TUNINGS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS_TUNINGS = [556, 441, 341, 225];
const STEREO_SPREAD = 23;
const FIXED_GAIN = 0.015;

class Comb {
  private readonly buf: Float32Array;
  private idx = 0;
  private filterStore = 0;

  constructor(size: number) {
    this.buf = new Float32Array(size);
  }

  process(input: number, feedback: number, damp: number): number {
    const out = this.buf[this.idx];
    this.filterStore = out * (1 - damp) + this.filterStore * damp;
    this.buf[this.idx] = input + this.filterStore * feedback;
    if (++this.idx >= this.buf.length) this.idx = 0;
    return out;
  }
}

class Allpass {
  private readonly buf: Float32Array;
  private idx = 0;

  constructor(size: number) {
    this.buf = new Float32Array(size);
  }

  process(input: number): number {
    const bufout = this.buf[this.idx];
    const out = -input + bufout;
    this.buf[this.idx] = input + bufout * 0.5;
    if (++this.idx >= this.buf.length) this.idx = 0;
    return out;
  }
}

/// Renderiza el bus de envío mono a un par estéreo húmedo. Las
/// sintonías originales son para 44,1 kHz — se escalan si el navegador
/// abrió el contexto a otra tasa (el propio Freeverb canónico hace
/// esto), si no la cola sonaría más corta y más metálica a 48 kHz.
export function renderReverb(
  bus: Float32Array,
  master: MasterFx,
  sampleRate: number,
): { left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer> } {
  const scale = sampleRate / 44100;
  const size = (base: number) => Math.max(1, Math.round(base * scale));

  const combL = COMB_TUNINGS.map((t) => new Comb(size(t)));
  const combR = COMB_TUNINGS.map((t) => new Comb(size(t + STEREO_SPREAD)));
  const apL = ALLPASS_TUNINGS.map((t) => new Allpass(size(t)));
  const apR = ALLPASS_TUNINGS.map((t) => new Allpass(size(t + STEREO_SPREAD)));

  const feedback = master.reverbRoomSize * 0.28 + 0.7;
  const damp = master.reverbDamping * 0.4;

  const left = new Float32Array(bus.length);
  const right = new Float32Array(bus.length);

  for (let i = 0; i < bus.length; i++) {
    const input = bus[i] * FIXED_GAIN;
    let l = 0;
    let r = 0;
    for (let c = 0; c < combL.length; c++) {
      l += combL[c].process(input, feedback, damp);
      r += combR[c].process(input, feedback, damp);
    }
    for (let a = 0; a < apL.length; a++) {
      l = apL[a].process(l);
      r = apR[a].process(r);
    }
    left[i] = l;
    right[i] = r;
  }
  return { left, right };
}

// ─── Limitador del máster — idéntico a dsp::Limiter ─────────────────────

const LIMITER_CEILING = 0.891; // -1 dBFS
const LIMITER_RELEASE_STEP_44K = 0.00038; // ≈ 60 ms

/// Ataque instantáneo, release exponencial. Modifica los dos canales in
/// situ, igual que en el motor.
///
/// Nota: como el release avanza ANTES de comparar contra el objetivo de
/// la muestra siguiente, un pico sostenido puede quedar hasta ~0,05%
/// por encima del techo (-0,996 dBFS en vez de -1). Es el
/// comportamiento del limitador del motor tal cual, y sigue muy lejos
/// de 0 dBFS: se replica igual a propósito, en vez de "arreglarlo" acá
/// y que la web sonara distinto de la app.
export function applyLimiterInPlace(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
): void {
  const releaseStep = LIMITER_RELEASE_STEP_44K * (44100 / sampleRate);
  let gain = 1;
  for (let i = 0; i < left.length; i++) {
    const peak = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    const target = peak > LIMITER_CEILING ? LIMITER_CEILING / peak : 1;
    if (target < gain) gain = target;
    else gain += (1 - gain) * releaseStep;
    left[i] *= gain;
    right[i] *= gain;
  }
}

// ─── Cadena por pista ───────────────────────────────────────────────────

/// EQ de 3 bandas → compresor, sobre la pista ENTERA (no clip por
/// clip): el compresor del motor corre sobre el flujo continuo de la
/// pista, y su envolvente cruza el silencio entre clips. Aplicarlo por
/// clip lo reiniciaría en cada uno y sonaría distinto.
///
/// Modifica `samples` in situ y lo devuelve por comodidad.
export function applyTrackFxInPlace(
  samples: Float32Array,
  fx: TrackFx,
  sampleRate: number,
): Float32Array {
  if (fx.eqLowDb !== 0) {
    new Biquad("lowShelf", 100, fx.eqLowDb, sampleRate).processInPlace(samples);
  }
  if (fx.eqMidDb !== 0) {
    new Biquad("peak", 1000, fx.eqMidDb, sampleRate, 1).processInPlace(samples);
  }
  if (fx.eqHighDb !== 0) {
    new Biquad("highShelf", 8000, fx.eqHighDb, sampleRate).processInPlace(samples);
  }
  if (fx.compEnabled) {
    compressInPlace(samples, fx.compThresholdDb, fx.compRatio, fx.compMakeupDb, sampleRate);
  }
  return samples;
}

/// Paneo de potencia constante — misma fórmula que el motor y que
/// ProjectViewer ya usaba para las pistas sin efectos.
export function constantPowerGains(
  volume: number,
  pan: number,
): { left: number; right: number } {
  const theta = (pan + 1) * (Math.PI / 4);
  return { left: Math.cos(theta) * volume, right: Math.sin(theta) * volume };
}

// ─── Mezcla completa ────────────────────────────────────────────────────

export interface MixTrack {
  /// Pista entera alineada a t=0 (silencio incluido), mono.
  samples: Float32Array;
  volume: number;
  pan: number;
  fx: TrackFx;
}

/// Cola que se deja sonar después del último envío para no cortar la
/// reverb — los mismos 4 segundos que reserva el motor
/// (`reverbTailFrames` en renderBlock).
export const REVERB_TAIL_SECONDS = 4;

/// Suma las pistas ya procesadas aplicando envío a reverb, paneo,
/// reverb del máster y limitador — el MISMO orden que renderBlock en el
/// motor (pasos 4 a 7). Las pistas llegan con su EQ y compresor ya
/// aplicados (ver applyTrackFxInPlace); acá solo pasa lo que depende de
/// la mezcla.
///
/// [contentFrames] es la duración del audio en sí. Si alguna pista
/// manda a la reverb, los buffers devueltos son MÁS LARGOS que eso
/// (ver REVERB_TAIL_SECONDS): sin ese margen la cola se cortaría de
/// golpe al terminar la última nota. Usar `left.length` para saber la
/// duración real del resultado.
export function mixTracks(
  tracks: MixTrack[],
  master: MasterFx,
  sampleRate: number,
  contentFrames: number,
): { left: Float32Array<ArrayBuffer>; right: Float32Array<ArrayBuffer> } {
  const anySend = tracks.some((t) => t.fx.reverbSend > 0);
  const useReverb = anySend && master.reverbWet > 0;
  const totalFrames = useReverb
    ? contentFrames + Math.round(REVERB_TAIL_SECONDS * sampleRate)
    : contentFrames;

  const left = new Float32Array(totalFrames);
  const right = new Float32Array(totalFrames);
  const bus = useReverb ? new Float32Array(totalFrames) : null;

  for (const track of tracks) {
    const { left: lg, right: rg } = constantPowerGains(track.volume, track.pan);
    const send = track.fx.reverbSend;
    const sendGain = send * track.volume;
    const n = Math.min(totalFrames, track.samples.length);
    for (let i = 0; i < n; i++) {
      const s = track.samples[i];
      if (bus !== null && send > 0) bus[i] += s * sendGain;
      left[i] += s * lg;
      right[i] += s * rg;
    }
  }

  if (bus !== null) {
    const { left: wetL, right: wetR } = renderReverb(bus, master, sampleRate);
    const wet = master.reverbWet;
    for (let i = 0; i < totalFrames; i++) {
      left[i] += wetL[i] * wet;
      right[i] += wetR[i] * wet;
    }
  }

  if (master.limiterEnabled) applyLimiterInPlace(left, right, sampleRate);

  return { left, right };
}
