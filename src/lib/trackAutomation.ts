// Automatización por pista (2026-11-09, app +70): volumen, paneo y envío a la
// reverb a lo largo de la canción. Espejo EXACTO de
// lib/features/audio_engine/automation/track_automation.dart (app) y de
// TrackAutomation en native_engine.cpp: mismo JSON, misma interpolación.
// Cambiar uno obliga a cambiar los otros en el mismo commit.
//
//   · volumen: dB SOBRE el fader (0 = como el fader; −60 o menos = silencio),
//     interpolado en AMPLITUD (como la curva de volumen del clip);
//   · paneo: −1..1, reemplaza al paneo de la pista mientras haya curva;
//   · envío: 0..1, reemplaza al envío a la reverb de la hoja FX.
//
// Antes del primer punto vale el primero; después del último, el último.

export interface AutomationPoint {
  seconds: number;
  value: number;
}

export interface TrackAutomation {
  volume: AutomationPoint[];
  pan: AutomationPoint[];
  send: AutomationPoint[];
}

export const AUTOMATION_MIN_DB = -60;
export const AUTOMATION_MAX_DB = 12;

function clampLane(lane: keyof TrackAutomation, v: number): number {
  if (lane === "volume") return Math.min(AUTOMATION_MAX_DB, Math.max(AUTOMATION_MIN_DB, v));
  if (lane === "pan") return Math.min(1, Math.max(-1, v));
  return Math.min(1, Math.max(0, v));
}

/// null si no hay curvas o el JSON no se entiende. Acepta el string del
/// manifiesto (`track.automation`) o el objeto ya parseado.
export function parseTrackAutomation(json: unknown): TrackAutomation | null {
  let data: unknown = json;
  if (typeof json === "string") {
    if (json.length === 0) return null;
    try {
      data = JSON.parse(json);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;
  const map = data as Record<string, unknown>;
  const read = (lane: keyof TrackAutomation): AutomationPoint[] => {
    const raw = map[lane];
    if (!Array.isArray(raw)) return [];
    const pts: AutomationPoint[] = [];
    for (const e of raw) {
      if (Array.isArray(e) && typeof e[0] === "number" && typeof e[1] === "number") {
        pts.push({ seconds: Math.max(0, e[0]), value: clampLane(lane, e[1]) });
      }
    }
    pts.sort((a, b) => a.seconds - b.seconds);
    return pts;
  };
  const a = { volume: read("volume"), pan: read("pan"), send: read("send") };
  return a.volume.length || a.pan.length || a.send.length ? a : null;
}

export function laneValueAt(points: AutomationPoint[], seconds: number): number | null {
  const n = points.length;
  if (n === 0) return null;
  if (seconds <= points[0].seconds) return points[0].value;
  if (seconds >= points[n - 1].seconds) return points[n - 1].value;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].seconds <= seconds) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const t = (seconds - a.seconds) / (b.seconds - a.seconds);
  return a.value + (b.value - a.value) * t;
}

export function automationDbToGain(db: number): number {
  return db <= AUTOMATION_MIN_DB ? 0 : Math.pow(10, db / 20);
}

/// El carril de volumen como ganancia LINEAL en [seconds], interpolada en
/// amplitud entre los puntos (igual que el motor: los puntos se pasan a
/// ganancia y se interpola la ganancia).
export function volumeGainAt(points: AutomationPoint[], seconds: number): number {
  const n = points.length;
  if (n === 0) return 1;
  if (seconds <= points[0].seconds) return automationDbToGain(points[0].value);
  if (seconds >= points[n - 1].seconds) return automationDbToGain(points[n - 1].value);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].seconds <= seconds) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const t = (seconds - a.seconds) / (b.seconds - a.seconds);
  const ga = automationDbToGain(a.value);
  const gb = automationDbToGain(b.value);
  return ga + (gb - ga) * t;
}

export function hasAutomation(a: TrackAutomation | null | undefined): boolean {
  return !!a && (a.volume.length > 0 || a.pan.length > 0 || a.send.length > 0);
}
