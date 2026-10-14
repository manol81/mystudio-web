// Curva de volumen POR CLIP (2026-10-14) — el lado web de
// `lib/features/audio_engine/utils/clip_gain_envelope.dart` de la app.
//
// En el .mystudio (formatVersion 4) viaja como `gainEnvelope: [[frame,
// db], ...]`, con los frames contra el archivo de ORIGEN del clip (no
// contra la línea de tiempo ni contra el inicio de la ventana
// recortada). Acá se convierte a SEGUNDOS de origen con el `sampleRate`
// del manifiesto, por la misma razón que el recorte: `decodeAudioData`
// devuelve el audio a la tasa del contexto, que puede no ser la del
// archivo (ver resample.ts).
//
// ⚠️ La interpolación entre puntos es LINEAL EN AMPLITUD, igual que en
// el motor nativo (native_engine.cpp, envelopeGain) y en Dart. Si una de
// las tres cambia, cambian las tres: si no, lo que se escucha en el
// visor deja de ser lo que sonó en el teléfono. Antes del primer punto
// vale el primero; después del último, el último.
//
// `linearRampToValueAtTime` de Web Audio también interpola lineal en el
// valor, así que la reproducción en vivo (scheduleEnvelope) da la misma
// curva que el render muestra a muestra (envelopeCursor).

export const ENVELOPE_MIN_DB = -60;
export const ENVELOPE_MAX_DB = 12;

export interface ClipEnvelope {
  /// Segundos del archivo de ORIGEN, ordenados y sin repetir.
  seconds: number[];
  /// Ganancias LINEALES, una por punto.
  gains: number[];
}

export function dbToLinear(db: number): number {
  return db <= ENVELOPE_MIN_DB ? 0 : Math.pow(10, db / 20);
}

/// Lee `gainEnvelope` del manifiesto. Nunca lanza: algo malformado es
/// "sin curva", no un proyecto que no abre. Una curva plana (todo en
/// 0 dB) también vuelve como `undefined`, así quien la usa puede
/// preguntar simplemente si existe.
export function parseManifestEnvelope(
  raw: unknown,
  sampleRate: number | undefined,
): ClipEnvelope | undefined {
  if (!Array.isArray(raw) || !sampleRate || !(sampleRate > 0)) return undefined;
  const byFrame = new Map<number, number>();
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [frame, db] = entry;
    if (typeof frame !== "number" || typeof db !== "number") continue;
    if (!Number.isFinite(frame) || !Number.isFinite(db) || frame < 0) continue;
    byFrame.set(Math.round(frame), Math.min(ENVELOPE_MAX_DB, Math.max(ENVELOPE_MIN_DB, db)));
  }
  const frames = [...byFrame.keys()].sort((a, b) => a - b);
  if (frames.length === 0) return undefined;
  if (frames.every((f) => Math.abs(byFrame.get(f)!) < 1e-6)) return undefined;
  return {
    seconds: frames.map((f) => f / sampleRate),
    gains: frames.map((f) => dbToLinear(byFrame.get(f)!)),
  };
}

/// Ganancia lineal en [t] segundos del archivo de origen.
export function envelopeGainAt(env: ClipEnvelope | undefined, t: number): number {
  if (!env || env.seconds.length === 0) return 1;
  const { seconds: s, gains: g } = env;
  const n = s.length;
  if (t <= s[0]) return g[0];
  if (t >= s[n - 1]) return g[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid] <= t) lo = mid;
    else hi = mid;
  }
  const frac = (t - s[lo]) / (s[hi] - s[lo]);
  return g[lo] + (g[hi] - g[lo]) * frac;
}

/// Lo mismo que [envelopeGainAt] para un recorrido que solo AVANZA (el
/// render muestra a muestra), sin búsqueda binaria por muestra.
export function envelopeCursor(env: ClipEnvelope | undefined): (t: number) => number {
  if (!env || env.seconds.length === 0) return () => 1;
  const { seconds: s, gains: g } = env;
  const n = s.length;
  let i = 0;
  return (t: number) => {
    if (t <= s[0]) return g[0];
    if (t >= s[n - 1]) return g[n - 1];
    while (i < n - 2 && s[i + 1] <= t) i++;
    const frac = (t - s[i]) / (s[i + 1] - s[i]);
    return g[i] + (g[i + 1] - g[i]) * frac;
  };
}

/// Programa la curva en un [param] de Web Audio para una fuente que
/// arranca a sonar en el segundo [sourceFrom] del archivo en el instante
/// [when] del contexto, y deja de sonar en [sourceTo].
export function scheduleEnvelope(
  param: AudioParam,
  env: ClipEnvelope | undefined,
  sourceFrom: number,
  when: number,
  sourceTo: number,
): void {
  if (!env || env.seconds.length === 0) return;
  param.setValueAtTime(envelopeGainAt(env, sourceFrom), when);
  for (let i = 0; i < env.seconds.length; i++) {
    const t = env.seconds[i];
    if (t <= sourceFrom) continue;
    if (t >= sourceTo) {
      // El tramo que cruza el final: la rampa hasta donde corta.
      param.linearRampToValueAtTime(envelopeGainAt(env, sourceTo), when + (sourceTo - sourceFrom));
      return;
    }
    param.linearRampToValueAtTime(env.gains[i], when + (t - sourceFrom));
  }
}

/// Multiplica [channels] (audio a [sampleRate], arrancando en el segundo
/// 0 del archivo de origen) por la curva. Lo usa el Arranger, que no
/// edita curvas: la hornea en el audio al importar, así el clip suena
/// como en el teléfono y al guardar vuelve con la curva ya aplicada.
export function applyEnvelopeToChannels(
  channels: Float32Array[],
  sampleRate: number,
  env: ClipEnvelope | undefined,
): void {
  if (!env || env.seconds.length === 0) return;
  const gainAt = envelopeCursor(env);
  const length = channels.reduce((m, c) => Math.max(m, c.length), 0);
  for (let i = 0; i < length; i++) {
    const g = gainAt(i / sampleRate);
    if (g === 1) continue;
    for (const ch of channels) {
      if (i < ch.length) ch[i] *= g;
    }
  }
}
