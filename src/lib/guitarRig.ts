// Pedalera de guitarra (app +75, 2026-11-18): pedales + amplificador +
// bafle, como un plugin de amplificador, hecho entero acá (sin licencias de
// terceros). Port EXACTO de guitar_rig.h del motor nativo: mismas
// constantes, mismo orden, mismas fórmulas. Si se toca uno, se toca el
// otro en el mismo commit (lo fija guitarRig.test.ts).
//
// Cadena, en este orden (como en una pedalera real):
//
//   puerta → compresor → wah → [×8: drive → amplificador] → bafle →
//   modulación → eco → nivel
//
// · El drive y el amplificador (lo que distorsiona) corren a 8 veces la
//   tasa de muestreo (sobremuestreo con un FIR de fase lineal): sin eso, los
//   armónicos que genera la distorsión "se doblan" por debajo de 22 kHz y la
//   distorsión suena áspera y metálica.
// · Amplificador: etapas de válvula (curva asimétrica tipo triodo, que
//   invierte la fase como el real, con su filtro de Miller y su capacitor de
//   acople), la red de tonos REAL (Bass/Middle/Treble de Fender o Marshall:
//   la función de transferencia de 3.er orden del circuito, sacada a mano
//   con análisis de nodos y pasada a digital con la transformada bilineal)
//   y la etapa de potencia (push-pull con presencia, resonancia y "sag").
// · Bafle: filtros que imitan un parlante de guitarra en su caja (1×12
//   abierto, 2×12, 4×12 cerrado). No hay respuestas al impulso de terceros.
//
// Todo en mono: entra la pista y sale la pista; el paneo y la reverb del
// máster siguen como siempre.

// ─── Parámetros (mismas claves que GuitarRig en Dart) ───────────────────

export interface GuitarRig {
  on: boolean;
  /// Puerta de ruido de la pedalera: -80 = apagada, hasta -30 dB.
  gateDb: number;
  compOn: boolean;
  compSustain: number; // 0..1
  compLevelDb: number; // -12..12
  wahOn: boolean;
  wahAuto: boolean; // true = sigue la fuerza del toque; false = fija
  wahAmount: number; // 0..1: sensibilidad (auto) o posición del pedal (fija)
  wahQ: number; // 0..1: cuánto "canta" la resonancia
  driveOn: boolean;
  driveType: number; // 0 overdrive, 1 distorsión, 2 fuzz
  driveGain: number; // 0..1
  driveTone: number; // 0..1
  driveLevelDb: number; // -12..12
  ampOn: boolean;
  ampModel: number; // 0 limpio (Fender), 1 crunch (Marshall), 2 lead (alta ganancia), 3 bajo limpio, 4 bajo saturado
  ampGain: number; // 0..1
  ampBass: number; // 0..1
  ampMid: number; // 0..1
  ampTreble: number; // 0..1
  ampPresence: number; // 0..1
  ampMaster: number; // 0..1 (cuánto empuja la etapa de potencia)
  cab: number; // 0 sin bafle, 1 1x12 abierto, 2 2x12, 3 4x12 cerrado, 4 1x15, 5 4x10, 6 8x10 (bajo)
  cabBright: number; // 0..1 (0,5 = neutro): micrófono más al centro o al borde
  modOn: boolean;
  modType: number; // 0 chorus, 1 flanger, 2 phaser, 3 trémolo
  modRate: number; // 0..1
  modDepth: number; // 0..1
  modMix: number; // 0..1
  dlyOn: boolean;
  dlyTimeMs: number; // 40..1500 (si dlySync = 0)
  dlySync: number; // 0 libre, o división del eco (2 1/16 … 6 1/2) a tempo
  dlyFeedback: number; // 0..0.9
  dlyMix: number; // 0..1
  dlyTone: number; // 0 oscuro (cinta) .. 1 brillante (digital)
  outDb: number; // -24..12
  // Bajo (app +76): agregados AL FINAL, no cambian el orden de los 36 de antes.
  driveBlend: number; // 0..1: cuánto de la señal limpia se suma al pedal (el bajo no pierde graves)
  ampDiBlend: number; // 0..1: mezcla del amplificador con la línea directa (DI), como se graba un bajo
  octOn: boolean; // octavador: una octava abajo
  octLevel: number; // 0..1
  octDry: number; // 0..1
  ampMidHz: number; // 200..3000: frecuencia de los medios de los amplificadores de bajo
}

export const RIG_GATE_OFF_DB = -80;

export const DEFAULT_GUITAR_RIG: GuitarRig = {
  on: true,
  gateDb: RIG_GATE_OFF_DB,
  compOn: false,
  compSustain: 0.5,
  compLevelDb: 0,
  wahOn: false,
  wahAuto: true,
  wahAmount: 0.5,
  wahQ: 0.5,
  driveOn: false,
  driveType: 0,
  driveGain: 0.5,
  driveTone: 0.5,
  driveLevelDb: 0,
  ampOn: true,
  ampModel: 1,
  ampGain: 0.5,
  ampBass: 0.5,
  ampMid: 0.5,
  ampTreble: 0.5,
  ampPresence: 0.5,
  ampMaster: 0.5,
  cab: 3,
  cabBright: 0.5,
  modOn: false,
  modType: 0,
  modRate: 0.3,
  modDepth: 0.5,
  modMix: 0.5,
  dlyOn: false,
  dlyTimeMs: 380,
  dlySync: 0,
  dlyFeedback: 0.35,
  dlyMix: 0.25,
  dlyTone: 0.4,
  outDb: 0,
  driveBlend: 0,
  ampDiBlend: 0,
  octOn: false,
  octLevel: 0.6,
  octDry: 0.8,
  ampMidHz: 500,
};

/// Tolerante igual que GuitarRig.fromJson en Dart: lo que falte toma el
/// default; null (o algo que no es un objeto) = sin pedalera.
export function parseGuitarRig(json: unknown): GuitarRig | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const d = DEFAULT_GUITAR_RIG;
  const num = (k: keyof GuitarRig) => (typeof o[k] === "number" ? (o[k] as number) : (d[k] as number));
  const bool = (k: keyof GuitarRig) => (typeof o[k] === "boolean" ? (o[k] as boolean) : (d[k] as boolean));
  return {
    on: bool("on"),
    gateDb: num("gateDb"),
    compOn: bool("compOn"),
    compSustain: num("compSustain"),
    compLevelDb: num("compLevelDb"),
    wahOn: bool("wahOn"),
    wahAuto: bool("wahAuto"),
    wahAmount: num("wahAmount"),
    wahQ: num("wahQ"),
    driveOn: bool("driveOn"),
    driveType: Math.round(num("driveType")),
    driveGain: num("driveGain"),
    driveTone: num("driveTone"),
    driveLevelDb: num("driveLevelDb"),
    ampOn: bool("ampOn"),
    ampModel: Math.round(num("ampModel")),
    ampGain: num("ampGain"),
    ampBass: num("ampBass"),
    ampMid: num("ampMid"),
    ampTreble: num("ampTreble"),
    ampPresence: num("ampPresence"),
    ampMaster: num("ampMaster"),
    cab: Math.round(num("cab")),
    cabBright: num("cabBright"),
    modOn: bool("modOn"),
    modType: Math.round(num("modType")),
    modRate: num("modRate"),
    modDepth: num("modDepth"),
    modMix: num("modMix"),
    dlyOn: bool("dlyOn"),
    dlyTimeMs: num("dlyTimeMs"),
    dlySync: Math.round(num("dlySync")),
    dlyFeedback: num("dlyFeedback"),
    dlyMix: num("dlyMix"),
    dlyTone: num("dlyTone"),
    outDb: num("outDb"),
    driveBlend: num("driveBlend"),
    ampDiBlend: num("ampDiBlend"),
    octOn: bool("octOn"),
    octLevel: num("octLevel"),
    octDry: num("octDry"),
    ampMidHz: num("ampMidHz"),
  };
}

export const rigOn = (rig: GuitarRig | null | undefined): rig is GuitarRig => !!rig && rig.on;
/// El eco y la modulación siguen sonando después del último audio.
export const rigHasTail = (rig: GuitarRig | null | undefined) =>
  rigOn(rig) && (rig.dlyOn || rig.modOn);

/// El orden de los 42 valores que recibe el motor (mystudio_set_track_rig).
/// NO reordenar: es el mismo en guitar_rig.h y en guitar_rig.dart.
export function rigParams(rig: GuitarRig): Float32Array {
  const b = (v: boolean) => (v ? 1 : 0);
  return Float32Array.from([
    b(rig.on), rig.gateDb,
    b(rig.compOn), rig.compSustain, rig.compLevelDb,
    b(rig.wahOn), b(rig.wahAuto), rig.wahAmount, rig.wahQ,
    b(rig.driveOn), rig.driveType, rig.driveGain, rig.driveTone, rig.driveLevelDb,
    b(rig.ampOn), rig.ampModel, rig.ampGain, rig.ampBass, rig.ampMid, rig.ampTreble, rig.ampPresence, rig.ampMaster,
    rig.cab, rig.cabBright,
    b(rig.modOn), rig.modType, rig.modRate, rig.modDepth, rig.modMix,
    b(rig.dlyOn), rig.dlyTimeMs, rig.dlySync, rig.dlyFeedback, rig.dlyMix, rig.dlyTone,
    rig.outDb,
    rig.driveBlend, rig.ampDiBlend, b(rig.octOn), rig.octLevel, rig.octDry, rig.ampMidHz,
  ]);
}

export const RIG_PARAM_COUNT = 42;
const P = {
  on: 0, gateDb: 1,
  compOn: 2, compSustain: 3, compLevelDb: 4,
  wahOn: 5, wahAuto: 6, wahAmount: 7, wahQ: 8,
  driveOn: 9, driveType: 10, driveGain: 11, driveTone: 12, driveLevelDb: 13,
  ampOn: 14, ampModel: 15, ampGain: 16, ampBass: 17, ampMid: 18, ampTreble: 19, ampPresence: 20, ampMaster: 21,
  cab: 22, cabBright: 23,
  modOn: 24, modType: 25, modRate: 26, modDepth: 27, modMix: 28,
  dlyOn: 29, dlyTimeMs: 30, dlySync: 31, dlyFeedback: 32, dlyMix: 33, dlyTone: 34,
  outDb: 35,
  driveBlend: 36, ampDiBlend: 37, octOn: 38, octLevel: 39, octDry: 40, ampMidHz: 41,
} as const;

// ─── Piezas ─────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/// tanh rápida (fracción continua de Lambert, error < 1e-4), la MISMA en el
/// motor: a 8× se llama unas 45 veces por muestra y la de la biblioteca es
/// lo que más costaba.
export function ftanh(x: number): number {
  const x2 = x * x;
  const y = (x * (135135 + x2 * (17325 + x2 * (378 + x2)))) / (135135 + x2 * (62370 + x2 * (3150 + 28 * x2)));
  return y > 1 ? 1 : y < -1 ? -1 : y;
}
const dbToLin = (db: number) => Math.pow(10, db / 20);

/// Filtro de un polo (pasa-bajos; el pasa-altos es x − lp).
class OnePole {
  a = 0;
  y = 0;
  set(fc: number, rate: number) {
    this.a = 1 - Math.exp((-2 * Math.PI * fc) / rate);
  }
  lp(x: number) {
    this.y += this.a * (x - this.y);
    return this.y;
  }
  hp(x: number) {
    return x - this.lp(x);
  }
  reset() {
    this.y = 0;
  }
}

type BqType = 0 | 1 | 2 | 3 | 4 | 5; // LP, HP, peak, lowShelf, highShelf, bandPass(pico 0 dB)
const LP = 0, HP = 1, PEAK = 2, LSH = 3, HSH = 4;

/// Biquad RBJ en forma directa transpuesta II.
class Bq {
  b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0;
  z1 = 0; z2 = 0;
  set(type: BqType, fc: number, q: number, gainDb: number, rate: number) {
    const A = Math.pow(10, gainDb / 40);
    const w = (2 * Math.PI * Math.min(fc, rate * 0.49)) / rate;
    const cw = Math.cos(w), sw = Math.sin(w);
    const alpha = sw / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === LP) {
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    } else if (type === HP) {
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    } else if (type === PEAK) {
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
    } else if (type === LSH) {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cw + s); b1 = 2 * A * (A - 1 - (A + 1) * cw); b2 = A * (A + 1 - (A - 1) * cw - s);
      a0 = A + 1 + (A - 1) * cw + s; a1 = -2 * (A - 1 + (A + 1) * cw); a2 = A + 1 + (A - 1) * cw - s;
    } else if (type === HSH) {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cw + s); b1 = -2 * A * (A - 1 + (A + 1) * cw); b2 = A * (A + 1 + (A - 1) * cw - s);
      a0 = A + 1 - (A - 1) * cw + s; a1 = 2 * (A - 1 - (A + 1) * cw); a2 = A + 1 - (A - 1) * cw - s;
    } else {
      b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  run(x: number) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  reset() {
    this.z1 = 0; this.z2 = 0;
  }
}

// Sobremuestreo ×8 (medido: con ×4 el aliasing de un lead al máximo quedaba
// 20 dB más arriba): un FIR pasa-bajos de fase lineal (seno cardinal con
// ventana de Kaiser), corte en 0,45 × la tasa original. El mismo filtro
// sube (con ganancia OS, porque intercalar ceros divide el nivel) y baja.
export const OS = 8;
const OS_TAPS = 96;
function besselI0(x: number) {
  let sum = 1, term = 1;
  for (let k = 1; k < 30; k++) {
    term *= (x / (2 * k)) * (x / (2 * k));
    sum += term;
  }
  return sum;
}
const OS_FIR: Float64Array = (() => {
  const h = new Float64Array(OS_TAPS);
  const fc = 0.45 / OS; // en ciclos por muestra a la tasa alta
  const beta = 7;
  const mid = (OS_TAPS - 1) / 2;
  let sum = 0;
  for (let i = 0; i < OS_TAPS; i++) {
    const t = i - mid;
    const sinc = t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
    const r = (2 * i) / (OS_TAPS - 1) - 1;
    h[i] = sinc * (besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / besselI0(beta));
    sum += h[i];
  }
  for (let i = 0; i < OS_TAPS; i++) h[i] /= sum;
  return h;
})();

class Oversampler {
  // Historia de la entrada (tasa baja) para subir, y de la tasa alta para bajar.
  private up = new Float64Array(OS_TAPS / OS);
  private upPos = 0;
  private down = new Float64Array(OS_TAPS);
  private downPos = 0;
  /// Un cuadro a la tasa baja → OS cuadros a la tasa alta (en `out`).
  upsample(x: number, out: Float64Array) {
    const m = OS_TAPS / OS;
    this.upPos = (this.upPos + m - 1) % m;
    this.up[this.upPos] = x;
    for (let p = 0; p < OS; p++) {
      let acc = 0;
      for (let j = 0; j < m; j++) acc += OS_FIR[j * OS + p] * this.up[(this.upPos + j) % m];
      out[p] = acc * OS;
    }
  }
  /// OS cuadros a la tasa alta → uno a la tasa baja.
  downsample(inp: Float64Array): number {
    for (let p = 0; p < OS; p++) {
      this.downPos = (this.downPos + OS_TAPS - 1) % OS_TAPS;
      this.down[this.downPos] = inp[p];
    }
    let acc = 0;
    for (let i = 0; i < OS_TAPS; i++) acc += OS_FIR[i] * this.down[(this.downPos + i) % OS_TAPS];
    return acc;
  }
  reset() {
    this.up.fill(0); this.down.fill(0); this.upPos = 0; this.downPos = 0;
  }
}

// ─── Red de tonos (Bass / Middle / Treble) ──────────────────────────────
//
// El circuito pasivo de Fender y Marshall: entrada → C1 → potenciómetro de
// agudos (R1, cursor = salida) → potenciómetro de graves (R2, resistencia
// variable) → potenciómetro de medios (R3, resistencia variable a masa); y
// en paralelo, entrada → R4 → C2 al pie del de agudos y C3 al de medios. La
// función de transferencia sale del análisis de nodos (resuelto con sympy)
// y es de 3.er orden. t, m, l = posición de agudos, medios y graves.

interface ToneStackParts { R1: number; R2: number; R3: number; R4: number; C1: number; C2: number; C3: number }
const FENDER: ToneStackParts = { R1: 250e3, R2: 1e6, R3: 25e3, R4: 56e3, C1: 250e-12, C2: 20e-9, C3: 20e-9 };
const MARSHALL: ToneStackParts = { R1: 220e3, R2: 1e6, R3: 22e3, R4: 33e3, C1: 470e-12, C2: 22e-9, C3: 22e-9 };

/// Coeficientes analógicos [b0..b3], [a0..a3] (a0 = 1).
export function toneStackAnalog(t: number, m: number, l: number, c: ToneStackParts): [number[], number[]] {
  const { R1, R2, R3, R4, C1, C2, C3 } = c;
  const b1 = C1 * R1 * t + C1 * R2 * l + C1 * R3 * m + C2 * R2 * l + C2 * R3 * m + C3 * R3 * m;
  const b2 =
    C1 * C2 * R1 * R2 * l + C1 * C2 * R1 * R3 * m + C1 * C2 * R1 * R4 * t + C1 * C2 * R2 * R4 * l +
    C1 * C2 * R3 * R4 * m + C1 * C3 * R1 * R3 * m + C1 * C3 * R1 * R4 * t + C1 * C3 * R2 * R3 * l * m +
    C1 * C3 * R2 * R4 * l + C1 * C3 * R3 * R4 * m + C2 * C3 * R2 * R3 * l * m;
  const b3 = C1 * C2 * C3 * R2 * l * (R1 * R3 * m + R1 * R4 * t + R3 * R4 * m);
  const a1 = C1 * R1 + C1 * R2 * l + C1 * R3 * m + C2 * R2 * l + C2 * R3 * m + C2 * R4 + C3 * R3 * m + C3 * R4;
  const a2 =
    C1 * C2 * R1 * R2 * l + C1 * C2 * R1 * R3 * m + C1 * C2 * R1 * R4 + C1 * C2 * R2 * R4 * l +
    C1 * C2 * R3 * R4 * m + C1 * C3 * R1 * R3 * m + C1 * C3 * R1 * R4 + C1 * C3 * R2 * R3 * l * m +
    C1 * C3 * R2 * R4 * l + C1 * C3 * R3 * R4 * m + C2 * C3 * R2 * R3 * l * m + C2 * C3 * R2 * R4 * l;
  const a3 = C1 * C2 * C3 * R2 * l * (R1 * R3 * m + R1 * R4 + R3 * R4 * m);
  return [[0, b1, b2, b3], [1, a1, a2, a3]];
}

/// Las perillas → posición de cada potenciómetro. Graves con curva
/// logarítmica (como el potenciómetro real); agudos y medios lineales.
export function toneStackPots(bass: number, mid: number, treble: number): [number, number, number] {
  const l = (Math.pow(10, 2 * clamp(bass, 0, 1)) - 1) / 99;
  return [clamp(treble, 0.001, 0.999), clamp(mid, 0.001, 1), Math.max(l, 0.001)];
}

class ToneStack {
  b = [1, 0, 0, 0];
  a = [1, 0, 0, 0];
  z = [0, 0, 0];
  set(bass: number, mid: number, treble: number, parts: ToneStackParts, rate: number) {
    const [t, m, l] = toneStackPots(bass, mid, treble);
    const [B, A] = toneStackAnalog(t, m, l, parts);
    const c = 2 * rate;
    const c2 = c * c, c3 = c2 * c;
    const d = (k: number[]) => [
      k[0] + k[1] * c + k[2] * c2 + k[3] * c3,
      3 * k[0] + k[1] * c - k[2] * c2 - 3 * k[3] * c3,
      3 * k[0] - k[1] * c - k[2] * c2 + 3 * k[3] * c3,
      k[0] - k[1] * c + k[2] * c2 - k[3] * c3,
    ];
    const bd = d(B), ad = d(A);
    for (let i = 0; i < 4; i++) {
      this.b[i] = bd[i] / ad[0];
      this.a[i] = ad[i] / ad[0];
    }
  }
  run(x: number) {
    const y = this.b[0] * x + this.z[0];
    this.z[0] = this.b[1] * x - this.a[1] * y + this.z[1];
    this.z[1] = this.b[2] * x - this.a[2] * y + this.z[2];
    this.z[2] = this.b[3] * x - this.a[3] * y;
    return y;
  }
  reset() {
    this.z = [0, 0, 0];
  }
}

// ─── Una etapa de válvula ───────────────────────────────────────────────
//
// Curva asimétrica (la del triodo: recorta más duro de un lado que del
// otro, eso da armónicos pares, el "calor"), con pendiente 1 en el centro,
// e invertida como la real. Después, el filtro de Miller (la válvula sola
// recorta agudos más cuanto más ganancia) y el capacitor de acople.

const TUBE_BIAS = 0.3;
const TUBE_T = ftanh(TUBE_BIAS);
const TUBE_SLOPE = 1 - TUBE_T * TUBE_T;

function tube(u: number) {
  return -(ftanh(u + TUBE_BIAS) - TUBE_T) / TUBE_SLOPE;
}

class TubeStage {
  gain = 1;
  miller = new OnePole();
  coupling = new OnePole();
  set(gain: number, millerHz: number, couplingHz: number, rate: number) {
    this.gain = gain;
    this.miller.set(millerHz, rate);
    this.coupling.set(couplingHz, rate);
  }
  run(x: number) {
    return this.coupling.hp(this.miller.lp(tube(this.gain * x)));
  }
  reset() {
    this.miller.reset(); this.coupling.reset();
  }
}

// ─── El equipo entero ───────────────────────────────────────────────────

const MAX_STAGES = 4;
const DELAY_MAX_SECONDS = 2;
const MOD_MAX_SECONDS = 0.03;

export class GuitarRigDsp {
  private readonly rate: number;
  private readonly hi: number;
  private last = new Float32Array(RIG_PARAM_COUNT).fill(NaN);
  private lastBpm = NaN;

  // Puerta y compresor
  private gateEnv = 0;
  private gateGain = 1;
  private gateHold = 0;
  private compEnv = 0;
  private compGain = 1;
  // Wah
  private wahEnv = 0;
  private wahPos = 0;
  private wahS1 = 0;
  private wahS2 = 0;
  private wahG = 0;
  private wahK = 0;
  private wahCount = 0;
  // Drive
  private drvPre = new OnePole();
  private drvPre2 = new OnePole();
  private drvGbw = new OnePole();
  private drvTone = new OnePole();
  private drvTone2 = new OnePole();
  private drvMid = new OnePole();
  private drvFizz = new OnePole();
  private drvGain = 1;
  private drvLevel = 1;
  private drvComp = 1;
  private drvBlend = 0;
  // Bajo
  private bassEq = false;
  private bassSplit = false;
  private eqLow = new Bq();
  private eqMid = new Bq();
  private eqHigh = new Bq();
  private split = new Bq();
  private diBlend = 0;
  private diBuf = new Float64Array(16);
  private diPos = 0;
  private wahLo = 450;
  private wahRatio = 2200 / 450;
  // Octavador
  private octLp1 = new Bq();
  private octLp2 = new Bq();
  private octOut1 = new Bq();
  private octOut2 = new Bq();
  private octEnv = 0;
  private octUp = false;
  private octFlip = 1;
  private fuzz1 = new TubeStage();
  // Amplificador
  private ampInHp = new OnePole();
  private ampBright = new Bq();
  private ampMidBoost = new Bq();
  private stages: TubeStage[] = Array.from({ length: MAX_STAGES }, () => new TubeStage());
  private nStages = 0;
  private tone = new ToneStack();
  private toneMakeup = 1;
  private presence = new Bq();
  private resonance = new Bq();
  private powerDrive = 1;
  private powerOut = 1;
  private ampTrim = 0.14;
  private sag = 0;
  private sagA = 0;
  private os = new Oversampler();
  private hiBuf = new Float64Array(OS);
  // Bafle
  private cab: Bq[] = Array.from({ length: 8 }, () => new Bq());
  private cabN = 0;
  private cabBright = new Bq();
  // Modulación
  private modBuf: Float32Array;
  private modPos = 0;
  private modPhase = 0;
  private modFb = 0;
  private apState = new Float64Array(6);
  // Eco
  private dlyBuf: Float32Array | null = null;
  private dlyPos = 0;
  private dlyFrames = 0;
  private dlyCur = 0;
  private dlyLp = new OnePole();
  private dlyHp = new OnePole();
  private dlyWow = 0;
  private outGain = 1;

  constructor(sampleRate: number) {
    this.rate = sampleRate;
    this.hi = sampleRate * OS;
    this.modBuf = new Float32Array(Math.ceil(sampleRate * MOD_MAX_SECONDS) + 4);
  }

  reset() {
    this.gateEnv = 0; this.gateGain = 1; this.gateHold = 0;
    this.compEnv = 0; this.compGain = 1;
    this.wahEnv = 0; this.wahPos = 0; this.wahS1 = 0; this.wahS2 = 0;
    for (const f of [this.drvPre, this.drvPre2, this.drvGbw, this.drvTone, this.drvTone2, this.drvMid, this.drvFizz, this.ampInHp]) f.reset();
    this.fuzz1.reset();
    this.ampBright.reset(); this.ampMidBoost.reset();
    for (const s of this.stages) s.reset();
    this.tone.reset(); this.presence.reset(); this.resonance.reset(); this.sag = 0;
    this.os.reset();
    for (const c of this.cab) c.reset();
    this.cabBright.reset();
    this.modBuf.fill(0); this.modPos = 0; this.modPhase = 0; this.modFb = 0; this.apState.fill(0);
    this.dlyBuf?.fill(0); this.dlyPos = 0; this.dlyCur = 0; this.dlyLp.reset(); this.dlyHp.reset(); this.dlyWow = 0;
    for (const f of [this.eqLow, this.eqMid, this.eqHigh, this.split, this.octLp1, this.octLp2, this.octOut1, this.octOut2]) f.reset();
    this.diBuf.fill(0); this.diPos = 0; this.octEnv = 0; this.octUp = false; this.octFlip = 1;
  }

  /// Recalcula los coeficientes si cambió algo (perillas, tempo).
  private configure(p: Float32Array, bpm: number) {
    let changed = bpm !== this.lastBpm;
    for (let i = 0; i < RIG_PARAM_COUNT && !changed; i++) if (p[i] !== this.last[i]) changed = true;
    if (!changed) return;
    this.last.set(p);
    this.lastBpm = bpm;
    const r = this.rate, hi = this.hi;

    // Drive
    const dType = Math.round(p[P.driveType]);
    const dg = clamp(p[P.driveGain], 0, 1);
    const dt = clamp(p[P.driveTone], 0, 1);
    this.drvLevel = dbToLin(clamp(p[P.driveLevelDb], -12, 12));
    if (dType === 0) {
      // Overdrive (tipo "tubo verde"): solo se ensucia lo que está arriba
      // de ~720 Hz y se suma a la señal limpia → la joroba de medios.
      this.drvPre.set(720, hi);
      this.drvGain = 1 + 120 * dg * dg;
      this.drvTone.set(700 * Math.pow(10, dt * 1.1), hi);
      this.drvFizz.set(9000, hi);
    } else if (dType === 1) {
      // Distorsión (tipo "rata"): mucha ganancia con el ancho de banda del
      // operacional que se achica al subirla, recorte duro a masa.
      this.drvPre.set(80, hi);
      this.drvGain = 1 + 1500 * dg * dg;
      this.drvGbw.set(clamp(1.6e6 / this.drvGain, 2200, 18000), hi);
      this.drvTone.set(450 * Math.pow(10, dt * 1.25), hi);
      this.drvFizz.set(8000, hi);
    } else {
      // Fuzz (tipo "gran muff"): dos etapas con mucha ganancia, asimétricas,
      // y el tono que mezcla un pasa-bajos y un pasa-altos (los medios caen).
      this.drvPre.set(120, hi);
      this.drvGain = 1 + 60 * dg;
      this.fuzz1.set(2 + 30 * dg, 6000, 60, hi);
      this.drvTone.set(900, hi);
      this.drvMid.set(1100, hi);
      this.drvFizz.set(7000, hi);
    }
    this.drvTone2.set(dType === 2 ? 900 : 12000, hi);
    // Con poca ganancia el pedal deja pasar la señal casi entera; con mucha,
    // recorta. La compensación deja el nivel parejo en todo el recorrido.
    this.drvComp = dType === 0 ? clamp(30 / this.drvGain, 1, 5.7) : dType === 1 ? clamp(400 / this.drvGain, 1, 18) : clamp(12 / this.drvGain, 1, 4);
    this.drvBlend = clamp(p[P.driveBlend], 0, 1);

    // Amplificador
    const model = clamp(Math.round(p[P.ampModel]), 0, 4);
    const g = clamp(p[P.ampGain], 0, 1);
    const g2 = g * g;
    if (model === 0) {
      // Limpio (Fender): dos etapas; rompe recién arriba de la mitad.
      this.ampInHp.set(20, hi);
      this.ampBright.set(HSH, 2500, 0.7, 3 * (1 - g), hi);
      this.ampMidBoost.set(PEAK, 800, 0.7, 0, hi);
      this.nStages = 2;
      this.stages[0].set(1.5 + 14 * g2, 16000, 15, hi);
      this.stages[1].set(1.2 + 4 * g, 12000, 20, hi);
      this.tone.set(p[P.ampBass], p[P.ampMid], p[P.ampTreble], FENDER, hi);
      this.toneMakeup = dbToLin(11);
    } else if (model === 1) {
      // Crunch (Marshall): tres etapas, la red de tonos de Marshall.
      this.ampInHp.set(30, hi);
      this.ampBright.set(HSH, 2000, 0.7, 4, hi);
      this.ampMidBoost.set(PEAK, 800, 0.7, 1.5, hi);
      this.nStages = 3;
      this.stages[0].set(1 + 30 * g2, 14000, 25, hi);
      this.stages[1].set(1.5 + 10 * g, 10000, 40, hi);
      this.stages[2].set(1.6, 9000, 30, hi);
      this.tone.set(p[P.ampBass], p[P.ampMid], p[P.ampTreble], MARSHALL, hi);
      this.toneMakeup = dbToLin(8.5);
    } else if (model === 2) {
      // Lead (alta ganancia): la entrada "ajustada" (corta graves antes de
      // distorsionar, si no se embarra), cuatro etapas.
      this.ampInHp.set(160, hi);
      this.ampBright.set(HSH, 1800, 0.7, 2, hi);
      this.ampMidBoost.set(PEAK, 750, 0.8, 4, hi);
      this.nStages = 4;
      this.stages[0].set(1 + 60 * g2 * g, 12000, 40, hi);
      this.stages[1].set(1.2 + 12 * g2, 9000, 90, hi);
      this.stages[2].set(1.5 + 4 * g, 8000, 60, hi);
      this.stages[3].set(1.2, 7500, 40, hi);
      this.tone.set(p[P.ampBass], p[P.ampMid], p[P.ampTreble], MARSHALL, hi);
      this.toneMakeup = dbToLin(8.5);
    } else if (model === 3) {
      // Bajo limpio (tipo SVT): poca ganancia, EQ activo con los medios
      // en la frecuencia que se elija.
      this.ampInHp.set(25, hi);
      this.ampBright.set(HSH, 2500, 0.7, 0, hi);
      this.ampMidBoost.set(PEAK, 800, 0.7, 0, hi);
      this.nStages = 2;
      this.stages[0].set(1.2 + 8 * g2, 14000, 10, hi);
      this.stages[1].set(1.2 + 3 * g, 10000, 10, hi);
    } else {
      // Bajo saturado: los graves (abajo de 150 Hz) pasan limpios y solo se
      // distorsiona lo de arriba; si no, el bajo pierde el piso.
      this.ampInHp.set(30, hi);
      this.ampBright.set(HSH, 2000, 0.7, 2, hi);
      this.ampMidBoost.set(PEAK, 900, 0.8, 3, hi);
      this.nStages = 3;
      this.stages[0].set(1 + 25 * g2, 9000, 60, hi);
      this.stages[1].set(1.5 + 6 * g, 7000, 80, hi);
      this.stages[2].set(1.4, 6000, 60, hi);
      this.split.set(LP, 150, 0.7071, 0, hi);
    }
    this.bassEq = model >= 3;
    this.bassSplit = model === 4;
    if (this.bassEq) {
      const midHz = clamp(p[P.ampMidHz], 200, 3000);
      this.eqLow.set(LSH, 70, 0.7, (clamp(p[P.ampBass], 0, 1) - 0.5) * 24, hi);
      this.eqMid.set(PEAK, midHz, 0.9, (clamp(p[P.ampMid], 0, 1) - 0.5) * 24, hi);
      this.eqHigh.set(HSH, 2500, 0.7, (clamp(p[P.ampTreble], 0, 1) - 0.5) * 24, hi);
      this.toneMakeup = 1;
    }
    // El wah se corre a la zona del bajo con un amplificador de bajo.
    this.wahLo = this.bassEq ? 220 : 450;
    this.wahRatio = this.bassEq ? 1400 / 220 : 2200 / 450;
    this.diBlend = clamp(p[P.ampDiBlend], 0, 1);
    const pres = clamp(p[P.ampPresence], 0, 1);
    this.presence.set(HSH, this.bassEq ? 5000 : 3200, 0.7, -4 + 12 * pres, hi);
    this.resonance.set(LSH, this.bassEq ? 60 : 100, 0.7, model === 0 ? 0 : this.bassEq ? 2 : 3, hi);
    this.ampTrim = model === 0 ? 0.22 : model === 3 ? 0.3 : model === 4 ? 0.2 : 0.14;
    const master = clamp(p[P.ampMaster], 0, 1);
    this.powerDrive = 0.6 + 5 * master * master;
    this.powerOut = 1 / ftanh(this.powerDrive * 0.9);
    this.sagA = 1 - Math.exp(-1 / (0.04 * hi));

    // Bafle
    const cab = clamp(Math.round(p[P.cab]), 0, 6);
    const c = this.cab;
    if (cab === 1) {
      c[0].set(HP, 90, 0.7, 0, r); c[1].set(PEAK, 150, 1, 2, r); c[2].set(PEAK, 600, 0.9, -2, r);
      c[3].set(PEAK, 2200, 1.4, 4, r); c[4].set(PEAK, 3800, 3, -3, r); c[5].set(LP, 5500, 0.9, 0, r);
      c[6].set(LP, 7000, 0.6, 0, r);
      this.cabN = 7;
    } else if (cab === 2) {
      c[0].set(HP, 80, 0.8, 0, r); c[1].set(PEAK, 120, 1.1, 3, r); c[2].set(PEAK, 500, 0.8, -3, r);
      c[3].set(PEAK, 1800, 1.2, 3, r); c[4].set(PEAK, 3000, 1.5, 2, r); c[5].set(LP, 5000, 0.85, 0, r);
      c[6].set(LP, 6500, 0.6, 0, r);
      this.cabN = 7;
    } else if (cab === 3) {
      c[0].set(HP, 70, 1.1, 0, r); c[1].set(PEAK, 110, 1.2, 4, r); c[2].set(PEAK, 400, 0.8, -4, r);
      c[3].set(PEAK, 2500, 1.5, 5, r); c[4].set(PEAK, 4200, 3, -4, r); c[5].set(LP, 4800, 0.8, 0, r);
      c[6].set(LP, 6000, 0.6, 0, r);
      this.cabN = 7;
    } else if (cab === 4) {
      // 1x15 de bajo: mucho grave, poco agudo.
      c[0].set(HP, 40, 1.0, 0, r); c[1].set(PEAK, 80, 1.1, 3, r); c[2].set(PEAK, 600, 0.9, -3, r);
      c[3].set(PEAK, 2000, 1.5, -2, r); c[4].set(PEAK, 1200, 1.2, 1, r); c[5].set(LP, 3000, 0.8, 0, r);
      c[6].set(LP, 4000, 0.6, 0, r);
      this.cabN = 7;
    } else if (cab === 5) {
      // 4x10 de bajo: más definido, con brillo.
      c[0].set(HP, 50, 0.9, 0, r); c[1].set(PEAK, 100, 1.1, 2, r); c[2].set(PEAK, 400, 0.9, -2, r);
      c[3].set(PEAK, 2500, 1.4, 3, r); c[4].set(PEAK, 4000, 2, -2, r); c[5].set(LP, 5000, 0.8, 0, r);
      c[6].set(LP, 7000, 0.6, 0, r);
      this.cabN = 7;
    } else if (cab === 6) {
      // 8x10 de bajo: el muro de rock.
      c[0].set(HP, 45, 1.1, 0, r); c[1].set(PEAK, 90, 1.2, 4, r); c[2].set(PEAK, 500, 0.8, -3, r);
      c[3].set(PEAK, 1800, 1.3, 2, r); c[4].set(PEAK, 3200, 2, -2, r); c[5].set(LP, 4200, 0.8, 0, r);
      c[6].set(LP, 5500, 0.6, 0, r);
      this.cabN = 7;
    } else {
      this.cabN = 0;
    }
    // Octavador: detecta la nota en los graves y la divide por dos.
    this.octLp1.set(LP, 300, 0.7071, 0, r);
    this.octLp2.set(LP, 300, 0.7071, 0, r);
    this.octOut1.set(LP, 220, 0.7071, 0, r);
    this.octOut2.set(LP, 220, 0.7071, 0, r);
    this.cabBright.set(HSH, 2500, 0.7, (clamp(p[P.cabBright], 0, 1) - 0.5) * 8, r);

    // Eco
    const sync = Math.round(p[P.dlySync]);
    const seconds = sync > 0 ? delayDivisionSecondsRig(sync, bpm) : clamp(p[P.dlyTimeMs], 40, 1500) / 1000;
    this.dlyFrames = clamp(seconds * r, 1, DELAY_MAX_SECONDS * r - 4);
    const tone = clamp(p[P.dlyTone], 0, 1);
    this.dlyLp.set(1500 * Math.pow(8, tone), r);
    this.dlyHp.set(120, r);
    this.outGain = dbToLin(clamp(p[P.outDb], -24, 12));
  }

  /// Procesa `n` muestras de `buf` en el lugar. `params`: los 36 valores de
  /// rigParams. `bpm`: el tempo, para el eco a tempo.
  process(buf: Float32Array, n: number, params: Float32Array, bpm: number, offset = 0) {
    if (params[P.on] < 0.5) return;
    this.configure(params, bpm);
    const r = this.rate;
    const gateDb = params[P.gateDb];
    const gateOn = gateDb > RIG_GATE_OFF_DB;
    const gateThr = dbToLin(clamp(gateDb, -80, -30));
    const compOn = params[P.compOn] >= 0.5;
    const sustain = clamp(params[P.compSustain], 0, 1);
    const compThrDb = -18 - 18 * sustain;
    const compRatio = 2 + 8 * sustain;
    const compMakeup = dbToLin(-compThrDb * (1 - 1 / compRatio) * 0.6 + clamp(params[P.compLevelDb], -12, 12));
    const wahOn = params[P.wahOn] >= 0.5;
    const wahAuto = params[P.wahAuto] >= 0.5;
    const wahAmount = clamp(params[P.wahAmount], 0, 1);
    const wahQ = 2 + 8 * clamp(params[P.wahQ], 0, 1);
    const driveOn = params[P.driveOn] >= 0.5;
    const dType = Math.round(params[P.driveType]);
    const dTone = clamp(params[P.driveTone], 0, 1);
    const ampOn = params[P.ampOn] >= 0.5;
    const anyHi = driveOn || ampOn;
    const modOn = params[P.modOn] >= 0.5 && params[P.modMix] > 0;
    const modType = Math.round(params[P.modType]);
    const modRate = clamp(params[P.modRate], 0, 1);
    const modDepth = clamp(params[P.modDepth], 0, 1);
    const modMix = clamp(params[P.modMix], 0, 1);
    const dlyOn = params[P.dlyOn] >= 0.5 && params[P.dlyMix] > 0;
    if (dlyOn && !this.dlyBuf) this.dlyBuf = new Float32Array(DELAY_MAX_SECONDS * r);
    const dlyFb = clamp(params[P.dlyFeedback], 0, 0.9);
    const dlyMix = clamp(params[P.dlyMix], 0, 1);
    const dlyTape = clamp(params[P.dlyTone], 0, 1) < 0.5;
    const octOn = params[P.octOn] >= 0.5;
    const octLevel = clamp(params[P.octLevel], 0, 1);
    const octDry = clamp(params[P.octDry], 0, 1);
    const octAtt = 1 - Math.exp(-1 / (0.002 * r));
    const octRel = 1 - Math.exp(-1 / (0.05 * r));

    const gateAtt = 1 - Math.exp(-1 / (0.0005 * r));
    const gateRel = 1 - Math.exp(-1 / (0.06 * r));
    const gateOpen = 1 - Math.exp(-1 / (0.001 * r));
    const gateClose = 1 - Math.exp(-1 / (0.05 * r));
    const compAtt = 1 - Math.exp(-1 / (0.004 * r));
    const compRel = 1 - Math.exp(-1 / (0.15 * r));
    const wahEnvA = 1 - Math.exp(-1 / (0.006 * r));
    const wahEnvR = 1 - Math.exp(-1 / (0.12 * r));
    const wahSmooth = 1 - Math.exp(-1 / (0.01 * r));
    const hiBuf = this.hiBuf;

    for (let i = offset; i < offset + n; i++) {
      let x = buf[i];

      // Puerta: sigue el pico; abre al pasar el umbral y cierra 4 dB abajo
      // después de 50 ms.
      if (gateOn) {
        const a = Math.abs(x);
        this.gateEnv += (a > this.gateEnv ? gateAtt : gateRel) * (a - this.gateEnv);
        if (this.gateEnv > gateThr) this.gateHold = 0.05 * r;
        else if (this.gateEnv < gateThr * 0.63 && this.gateHold > 0) this.gateHold--;
        const target = this.gateEnv > gateThr || this.gateHold > 0 ? 1 : 0;
        this.gateGain += (target > this.gateGain ? gateOpen : gateClose) * (target - this.gateGain);
        x *= this.gateGain;
      }

      // Compresor de pedal: más "sustain" = umbral más bajo y más relación.
      if (compOn) {
        const a = Math.abs(x);
        this.compEnv += (a > this.compEnv ? compAtt : compRel) * (a - this.compEnv);
        const envDb = 20 * Math.log10(this.compEnv + 1e-9);
        const over = envDb - compThrDb;
        const target = over > 0 ? dbToLin(-over * (1 - 1 / compRatio)) : 1;
        this.compGain += 0.02 * (target - this.compGain);
        x *= this.compGain * compMakeup;
      }

      // Octavador (tipo OC-2): la nota de los graves se divide por dos con
      // un flip-flop que cambia en cada cruce por cero (con histéresis), y
      // se suaviza para que suene redonda.
      if (octOn) {
        const s = this.octLp2.run(this.octLp1.run(x));
        const a = Math.abs(s);
        this.octEnv += (a > this.octEnv ? octAtt : octRel) * (a - this.octEnv);
        const thr = 0.1 * this.octEnv;
        if (!this.octUp && s > thr) {
          this.octUp = true;
          this.octFlip = -this.octFlip;
        } else if (this.octUp && s < -thr) {
          this.octUp = false;
        }
        const sub = this.octOut2.run(this.octOut1.run(this.octFlip * this.octEnv * 2));
        x = x * octDry + sub * octLevel * 1.5;
      }

      // Wah: filtro de estado variable con la frecuencia entre 450 Hz y
      // 2,2 kHz (220 Hz y 1,4 kHz con un amplificador de bajo); en
      // automático la mueve la fuerza del toque.
      if (wahOn) {
        const a = Math.abs(x);
        this.wahEnv += (a > this.wahEnv ? wahEnvA : wahEnvR) * (a - this.wahEnv);
        const target = wahAuto ? clamp(this.wahEnv * (4 + 36 * wahAmount), 0, 1) : wahAmount;
        this.wahPos += wahSmooth * (target - this.wahPos);
        if ((this.wahCount++ & 7) === 0) {
          const f = this.wahLo * Math.pow(this.wahRatio, this.wahPos);
          this.wahG = Math.tan((Math.PI * f) / r);
          this.wahK = 1 / wahQ;
        }
        const g = this.wahG, k = this.wahK;
        const hp = (x - (g + k) * this.wahS1 - this.wahS2) / (1 + g * (g + k));
        const bp = g * hp + this.wahS1;
        this.wahS1 = g * hp + bp;
        const lp = g * bp + this.wahS2;
        this.wahS2 = g * bp + lp;
        x = 0.25 * lp + 2.2 * k * bp * Math.sqrt(wahQ);
      }

      // La línea directa (DI) para mezclar con el amplificador, demorada lo
      // mismo que el sobremuestreo (95 muestras a 8× = 11,875 a 1×) para que
      // no se cancelen.
      this.diBuf[this.diPos] = x;
      // Drive y amplificador, a 8× la tasa.
      if (anyHi) {
        this.os.upsample(x, hiBuf);
        for (let k = 0; k < OS; k++) {
          let v = hiBuf[k];
          if (driveOn) {
            const d = this.drive(v, dType, dTone);
            v = this.drvBlend > 0 ? (1 - this.drvBlend) * d + this.drvBlend * v : d;
          }
          if (ampOn) v = this.amp(v);
          hiBuf[k] = v;
        }
        x = this.os.downsample(hiBuf);
      }

      // Bafle.
      if (this.cabN > 0 && ampOn) {
        for (let k = 0; k < this.cabN; k++) x = this.cab[k].run(x);
        x = this.cabBright.run(x);
      }
      if (ampOn && this.diBlend > 0) {
        const d11 = this.diBuf[(this.diPos + 16 - 11) & 15];
        const d12 = this.diBuf[(this.diPos + 16 - 12) & 15];
        const di = d11 * 0.125 + d12 * 0.875;
        x = (1 - this.diBlend) * x + this.diBlend * di * 2;
      }
      this.diPos = (this.diPos + 1) & 15;

      // Modulación.
      if (modOn) x = this.modulate(x, modType, modRate, modDepth, modMix);

      // Eco.
      if (dlyOn && this.dlyBuf) x = this.echo(x, dlyFb, dlyMix, dlyTape);

      buf[i] = x * this.outGain;
    }
  }

  private drive(v: number, type: number, tone: number) {
    if (type === 0) {
      const hp = this.drvPre.hp(v);
      const clipped = 0.5 * ftanh((this.drvGain * hp) / 0.5);
      let y = v + clipped;
      y = this.drvTone.lp(y);
      y = this.drvFizz.lp(y);
      return y * this.drvLevel * this.drvComp * 0.175;
    }
    if (type === 1) {
      let u = this.drvPre.hp(v) * this.drvGain;
      u = this.drvGbw.lp(u);
      // Recorte duro pero redondeado (como dos diodos a masa).
      const u2 = u * u;
      const y0 = u / Math.sqrt(Math.sqrt(1 + u2 * u2));
      let y = this.drvTone.lp(y0);
      y = this.drvFizz.lp(y);
      return y * this.drvLevel * this.drvComp * 0.056;
    }
    // Fuzz
    const u = this.drvPre.hp(v) * this.drvGain;
    const s1 = ftanh(u + 0.4) - 0.38;
    const s2 = this.fuzz1.run(s1);
    const s3 = this.drvFizz.lp(ftanh(s2));
    const low = this.drvTone.lp(s3);
    const high = s3 - this.drvMid.lp(s3);
    const y = (1 - tone) * low + tone * high * 1.6;
    return y * this.drvLevel * this.drvComp * 0.11;
  }

  private amp(v: number) {
    let x = this.ampInHp.hp(v);
    x = this.ampBright.run(x);
    x = this.ampMidBoost.run(x);
    if (this.bassSplit) {
      const low = this.split.run(x);
      let h = x - low;
      for (let s = 0; s < this.nStages; s++) h = this.stages[s].run(h);
      x = low * 1.5 + h;
    } else {
      for (let s = 0; s < this.nStages; s++) x = this.stages[s].run(x);
    }
    if (this.bassEq) {
      x = this.eqHigh.run(this.eqMid.run(this.eqLow.run(x)));
    } else {
      x = this.tone.run(x) * this.toneMakeup;
    }
    // Etapa de potencia: presencia y resonancia (la realimentación del
    // amplificador), y un push-pull simétrico que se "hunde" un poco con la
    // fuerza (sag).
    x = this.presence.run(x);
    x = this.resonance.run(x);
    const drive = this.powerDrive / (1 + 0.5 * this.sag);
    const y = ftanh(drive * x) * this.powerOut;
    this.sag += this.sagA * (Math.abs(y) - this.sag);
    return y * this.ampTrim;
  }

  private modulate(x: number, type: number, rate: number, depth: number, mix: number) {
    const r = this.rate;
    const len = this.modBuf.length;
    const hz =
      type === 0 ? 0.1 * Math.pow(30, rate) : type === 1 ? 0.05 * Math.pow(30, rate) : type === 2 ? 0.1 * Math.pow(40, rate) : 1 * Math.pow(12, rate);
    this.modPhase += hz / r;
    if (this.modPhase >= 1) this.modPhase -= 1;
    const lfo = Math.sin(2 * Math.PI * this.modPhase);
    if (type === 3) {
      // Trémolo: el volumen sube y baja (seno un poco cuadrado).
      const shaped = Math.tanh(2.5 * lfo) / Math.tanh(2.5);
      const g = 1 - depth * mix * (0.5 + 0.5 * shaped);
      return x * g;
    }
    if (type === 2) {
      // Phaser: seis pasa-todo con la frecuencia entre 200 Hz y 2 kHz.
      const f = 200 * Math.pow(10, (0.5 + 0.5 * lfo) * (0.3 + 0.7 * depth));
      const t = Math.tan((Math.PI * Math.min(f, r * 0.45)) / r);
      const a = (t - 1) / (t + 1);
      let y = x + 0.5 * this.modFb;
      for (let k = 0; k < 6; k++) {
        const s = this.apState[k];
        const out = a * y + s;
        this.apState[k] = y - a * out;
        y = out;
      }
      this.modFb = y;
      return x + mix * (y - x) * 0.5;
    }
    // Chorus y flanger: una línea de retardo modulada.
    const baseMs = type === 0 ? 8 : 1.2;
    const spanMs = type === 0 ? 0.5 + 3 * depth : 0.3 + 3.5 * depth;
    const delayFrames = ((baseMs + spanMs * (0.5 + 0.5 * lfo)) / 1000) * r;
    const fb = type === 1 ? 0.65 * depth : 0;
    this.modBuf[this.modPos] = x + fb * this.modFb;
    let rp = this.modPos - delayFrames;
    while (rp < 0) rp += len;
    const i0 = Math.floor(rp);
    const frac = rp - i0;
    const d = this.modBuf[i0 % len] * (1 - frac) + this.modBuf[(i0 + 1) % len] * frac;
    this.modFb = d;
    this.modPos = (this.modPos + 1) % len;
    return type === 0 ? (x + mix * d) / (1 + 0.5 * mix) : (x + mix * d) / (1 + 0.6 * mix);
  }

  private echo(x: number, fb: number, mix: number, tape: boolean) {
    const buf = this.dlyBuf!;
    const len = buf.length;
    const r = this.rate;
    // El tiempo se acerca de a poco al pedido (al moverlo suena como una
    // cinta que cambia de velocidad, no como un clic).
    this.dlyCur += 0.0005 * (this.dlyFrames - this.dlyCur);
    if (Math.abs(this.dlyFrames - this.dlyCur) > r * 0.5) this.dlyCur = this.dlyFrames;
    let t = this.dlyCur;
    if (tape) {
      this.dlyWow += 0.45 / r;
      if (this.dlyWow >= 1) this.dlyWow -= 1;
      t += 0.0007 * r * Math.sin(2 * Math.PI * this.dlyWow);
    }
    let rp = this.dlyPos - t;
    while (rp < 0) rp += len;
    const i0 = Math.floor(rp);
    const frac = rp - i0;
    const wet = buf[i0 % len] * (1 - frac) + buf[(i0 + 1) % len] * frac;
    let w = this.dlyHp.hp(this.dlyLp.lp(wet));
    if (tape) w = Math.tanh(w * 1.2) / 1.2;
    buf[this.dlyPos] = x + fb * w;
    this.dlyPos = (this.dlyPos + 1) % len;
    return x + mix * wet;
  }
}

/// Mismas divisiones que el eco de la pista (delayDivisionSeconds).
function delayDivisionSecondsRig(div: number, bpm: number): number {
  const beat = 60 / clamp(bpm, 20, 300);
  switch (div) {
    case 1: return 0.09;
    case 2: return beat / 4;
    case 3: return beat / 2;
    case 4: return beat * 0.75;
    case 5: return beat;
    case 6: return beat * 2;
    default: return beat / 2;
  }
}

/// Toda la pista de una pasada (lo que usa la mezcla de la web).
export function applyGuitarRigInPlace(samples: Float32Array, rig: GuitarRig, sampleRate: number, bpm = 120) {
  if (!rigOn(rig)) return samples;
  const dsp = new GuitarRigDsp(sampleRate);
  dsp.process(samples, samples.length, rigParams(rig), bpm);
  return samples;
}

/// Presets de la pedalera: mismos ids y valores que kGuitarRigPresets en Dart.
export interface GuitarRigPreset {
  id: string;
  rig: Partial<GuitarRig>;
  /// La puerta de la pista y el envío a la reverb que conviene (opcional).
  gateDb?: number;
  reverbSend?: number;
}

/// Los presets de la pedalera (sobre DEFAULT_GUITAR_RIG). Espejo a mano de
/// kGuitarRigPresets en lib/features/audio_engine/fx/guitar_rig.dart: mismos
/// ids y valores (lo verifica guitarRig.test.ts leyendo el archivo de Dart).
export const GUITAR_RIG_PRESETS: GuitarRigPreset[] = [
  { id: "clean_bright", reverbSend: 0.2, rig: { ampModel: 0, ampGain: 0.3, ampBass: 0.5, ampMid: 0.55, ampTreble: 0.65, ampPresence: 0.6, cab: 1, cabBright: 0.6, compOn: true, compSustain: 0.4 } },
  { id: "clean_chorus", reverbSend: 0.25, rig: { ampModel: 0, ampGain: 0.35, cab: 2, modOn: true, modType: 0, modRate: 0.3, modDepth: 0.5, modMix: 0.5 } },
  { id: "funk_wah", rig: { ampModel: 0, ampGain: 0.3, ampTreble: 0.6, cab: 1, compOn: true, compSustain: 0.6, wahOn: true, wahAuto: true, wahAmount: 0.55, wahQ: 0.6 } },
  { id: "blues", reverbSend: 0.2, rig: { ampModel: 0, ampGain: 0.55, cab: 2, driveOn: true, driveType: 0, driveGain: 0.45, driveTone: 0.5, driveLevelDb: 2 } },
  { id: "crunch", rig: { ampModel: 1, ampGain: 0.5, ampBass: 0.55, ampMid: 0.6, ampTreble: 0.55, cab: 3 } },
  { id: "rock", rig: { ampModel: 1, ampGain: 0.8, ampMid: 0.65, cab: 3 } },
  { id: "lead_delay", reverbSend: 0.2, rig: { ampModel: 2, ampGain: 0.55, ampMid: 0.6, cab: 3, dlyOn: true, dlyTimeMs: 420, dlySync: 0, dlyFeedback: 0.35, dlyMix: 0.25, dlyTone: 0.4 } },
  { id: "metal", rig: { ampModel: 2, ampGain: 0.7, ampBass: 0.6, ampMid: 0.35, ampTreble: 0.6, ampPresence: 0.6, cab: 3, gateDb: -55, driveOn: true, driveType: 0, driveGain: 0.1, driveTone: 0.6, driveLevelDb: 6 } },
  { id: "fuzz", rig: { ampModel: 0, ampGain: 0.3, cab: 2, driveOn: true, driveType: 2, driveGain: 0.7, driveTone: 0.45 } },
  { id: "phaser70", rig: { ampModel: 1, ampGain: 0.4, cab: 3, modOn: true, modType: 2, modRate: 0.25, modDepth: 0.6, modMix: 0.7 } },
  { id: "surf_tremolo", reverbSend: 0.4, rig: { ampModel: 0, ampGain: 0.35, ampTreble: 0.65, cab: 1, modOn: true, modType: 3, modRate: 0.45, modDepth: 0.7, modMix: 1 } },
  { id: "ambient", reverbSend: 0.45, rig: { ampModel: 0, ampGain: 0.3, cab: 2, modOn: true, modType: 0, modRate: 0.2, modDepth: 0.6, modMix: 0.4, dlyOn: true, dlySync: 4, dlyFeedback: 0.5, dlyMix: 0.35, dlyTone: 0.3 } },
  // Bajo (app +76): los ids empiezan con "bass_" (así la app sabe en qué
  // lista mostrarlos).
  { id: "bass_clean", reverbSend: 0, rig: { ampModel: 3, ampGain: 0.3, ampBass: 0.55, ampMid: 0.5, ampMidHz: 500, ampTreble: 0.5, cab: 5, compOn: true, compSustain: 0.45, ampDiBlend: 0.3 } },
  { id: "bass_pick", reverbSend: 0, rig: { ampModel: 3, ampGain: 0.35, ampMid: 0.55, ampMidHz: 800, ampTreble: 0.65, ampPresence: 0.6, cab: 5, compOn: true, compSustain: 0.6 } },
  { id: "bass_motown", reverbSend: 0, rig: { ampModel: 3, ampGain: 0.25, ampBass: 0.6, ampMid: 0.55, ampMidHz: 400, ampTreble: 0.3, ampPresence: 0.3, cab: 4, ampDiBlend: 0.2 } },
  { id: "bass_rock", reverbSend: 0, rig: { ampModel: 4, ampGain: 0.55, ampBass: 0.55, ampMid: 0.6, ampMidHz: 800, ampTreble: 0.55, cab: 6, ampDiBlend: 0.3 } },
  { id: "bass_octave", reverbSend: 0, rig: { ampModel: 3, ampGain: 0.3, cab: 5, octOn: true, octLevel: 0.7, octDry: 0.7 } },
  { id: "bass_funk", reverbSend: 0, rig: { ampModel: 3, ampGain: 0.3, ampTreble: 0.6, cab: 5, compOn: true, compSustain: 0.6, wahOn: true, wahAuto: true, wahAmount: 0.6, wahQ: 0.55 } },
  { id: "bass_metal", reverbSend: 0, rig: { ampModel: 3, ampGain: 0.4, ampMid: 0.4, cab: 6, driveOn: true, driveType: 1, driveGain: 0.6, driveTone: 0.55, driveBlend: 0.5 } },
];

export const isBassPresetId = (id: string) => id.startsWith("bass_");

export function guitarRigFromPreset(id: string): GuitarRig | null {
  const p = GUITAR_RIG_PRESETS.find((x) => x.id === id);
  return p ? { ...DEFAULT_GUITAR_RIG, ...p.rig } : null;
}
