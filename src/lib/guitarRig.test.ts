import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_GUITAR_RIG,
  GUITAR_RIG_PRESETS,
  RIG_PARAM_COUNT,
  applyGuitarRigInPlace,
  ftanh,
  guitarRigFromPreset,
  parseGuitarRig,
  rigHasTail,
  rigParams,
  toneStackAnalog,
  toneStackPots,
  type GuitarRig,
} from "./guitarRig";
import { applyTrackFxInPlace, hasFxTail, isTrackFxActive, NO_TRACK_FX, parseTrackFx } from "./trackEffects";

const SR = 44100;

// Rasgueos sintéticos (Karplus-Strong), a nivel de una guitarra directa.
function guitar(seconds = 3): Float32Array {
  const out = new Float32Array(Math.round(SR * seconds));
  const notes = [82.41, 123.47, 164.81, 98, 146.83, 196];
  notes.forEach((f, k) => {
    const N = Math.round(SR / f);
    const buf = new Float32Array(N);
    let s = 99 + k;
    for (let i = 0; i < N; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      buf[i] = (s / 4294967296 - 0.5) * 2;
    }
    const start = Math.round((k < 3 ? k * 0.012 : 1.5 + (k - 3) * 0.012) * SR);
    let p = 0;
    for (let i = start; i < out.length; i++) {
      const a = buf[p], b = buf[(p + 1) % N];
      buf[p] = 0.996 * 0.5 * (a + b);
      p = (p + 1) % N;
      out[i] += a * 0.1;
    }
  });
  return out;
}
const rmsDb = (x: Float32Array) => {
  let s = 0;
  for (const v of x) s += v * v;
  return 10 * Math.log10(s / x.length + 1e-20);
};
function bandEnergy(x: Float32Array, lo: number, hi: number): number {
  // DFT directa en unas pocas frecuencias de la banda (alcanza para comparar).
  let e = 0;
  const n = Math.min(x.length, 8192);
  const step = hi > lo ? (hi - lo) / 12 : 1;
  for (let f = lo; f <= hi; f += step) {
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) {
      const w = (2 * Math.PI * f * i) / SR;
      re += x[i] * Math.cos(w);
      im -= x[i] * Math.sin(w);
    }
    e += re * re + im * im;
  }
  return e;
}

describe("pedalera de guitarra", () => {
  it("parseGuitarRig completa lo que falta y rechaza lo que no es un objeto", () => {
    expect(parseGuitarRig(null)).toBeNull();
    expect(parseGuitarRig("x")).toBeNull();
    const r = parseGuitarRig({ ampModel: 2, ampGain: 0.9 })!;
    expect(r.ampModel).toBe(2);
    expect(r.ampGain).toBe(0.9);
    expect(r.cab).toBe(DEFAULT_GUITAR_RIG.cab);
  });

  it("los 36 valores van en el orden del motor", () => {
    const p = rigParams({ ...DEFAULT_GUITAR_RIG, ampModel: 2, outDb: -3, dlyTone: 0.7 });
    expect(p.length).toBe(RIG_PARAM_COUNT);
    expect(p[0]).toBe(1);
    expect(p[15]).toBe(2); // ampModel
    expect(p[34]).toBeCloseTo(0.7); // dlyTone
    expect(p[35]).toBe(-3); // outDb
    // El mismo orden que guitar_rig.h (lo dice su enum).
    const h = readFileSync("../android/app/src/main/cpp/guitar_rig.h", "utf8");
    expect(h).toContain("kOutDb,\n    kParamCount  // 36");
  });

  it("los sonidos son los mismos que en la app", () => {
    const dart = readFileSync("../lib/features/audio_engine/utils/guitar_rig_presets.dart", "utf8");
    const ids = [...dart.matchAll(/GuitarRigPreset\('(\w+)'/g)].map((m) => m[1]);
    expect(ids).toEqual(GUITAR_RIG_PRESETS.map((p) => p.id));
  });

  it("ftanh sigue a tanh y nunca pasa de ±1", () => {
    for (let x = -10; x <= 10; x += 0.01) {
      expect(Math.abs(ftanh(x) - Math.tanh(x))).toBeLessThan(2e-4);
      expect(Math.abs(ftanh(x))).toBeLessThanOrEqual(1);
    }
  });

  it("la red de tonos: más agudos sube los agudos y más medios sube los medios", () => {
    const parts = { R1: 250e3, R2: 1e6, R3: 25e3, R4: 56e3, C1: 250e-12, C2: 20e-9, C3: 20e-9 };
    const mag = (bass: number, mid: number, treb: number, f: number) => {
      const [t, m, l] = toneStackPots(bass, mid, treb);
      const [b, a] = toneStackAnalog(t, m, l, parts);
      const s = { re: 0, im: 2 * Math.PI * f };
      const poly = (c: number[]) => {
        let re = 0, im = 0;
        for (let k = c.length - 1; k >= 0; k--) {
          const nr = re * s.re - im * s.im + c[k];
          im = re * s.im + im * s.re;
          re = nr;
        }
        return Math.hypot(re, im);
      };
      return 20 * Math.log10(poly(b) / poly(a));
    };
    expect(mag(0.5, 0.5, 1, 4000)).toBeGreaterThan(mag(0.5, 0.5, 0, 4000) + 6);
    expect(mag(0.5, 1, 0.5, 800)).toBeGreaterThan(mag(0.5, 0, 0.5, 800) + 4);
    expect(mag(1, 0.5, 0.5, 80)).toBeGreaterThan(mag(0, 0.5, 0.5, 80) + 10);
    // El "scoop" de Fender: los medios abajo de los graves con todo al medio.
    expect(mag(0.5, 0.5, 0.5, 700)).toBeLessThan(mag(0.5, 0.5, 0.5, 100) - 5);
  });

  it("apagada no toca nada; cada sonido queda a un nivel parejo y sin valores raros", () => {
    const g = guitar(2);
    const off = Float32Array.from(g);
    applyGuitarRigInPlace(off, { ...DEFAULT_GUITAR_RIG, on: false }, SR);
    expect(off).toEqual(g);
    for (const p of GUITAR_RIG_PRESETS) {
      const y = Float32Array.from(g);
      applyGuitarRigInPlace(y, guitarRigFromPreset(p.id)!, SR);
      expect(y.every(Number.isFinite)).toBe(true);
      const db = rmsDb(y);
      expect(db, p.id).toBeGreaterThan(-30);
      expect(db, p.id).toBeLessThan(-10);
    }
  });

  it("el bafle corta lo que un parlante de guitarra no da", () => {
    const g = guitar(1);
    const withCab = Float32Array.from(g);
    const noCab = Float32Array.from(g);
    applyGuitarRigInPlace(withCab, { ...DEFAULT_GUITAR_RIG, cab: 3 }, SR);
    applyGuitarRigInPlace(noCab, { ...DEFAULT_GUITAR_RIG, cab: 0 }, SR);
    const ratio = (x: Float32Array) => bandEnergy(x, 8000, 12000) / bandEnergy(x, 300, 1500);
    expect(ratio(withCab)).toBeLessThan(ratio(noCab) / 30);
  });

  it("sobremuestreo: un lead al máximo casi no genera aliasing", () => {
    const n = 1 << 15;
    const f0 = 1000;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = 0.1 * Math.sin((2 * Math.PI * f0 * i) / SR);
    applyGuitarRigInPlace(x, { ...DEFAULT_GUITAR_RIG, ampModel: 2, ampGain: 1, cab: 3 }, SR);
    // Energía en frecuencias que NO son armónicos de 1 kHz (entre medio).
    // Con ventana de Hann: si no, la fuga de los armónicos tapa lo que se mide.
    const tail = x.slice(n / 2, n / 2 + 8192);
    for (let i = 0; i < tail.length; i++) tail[i] *= 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / tail.length);
    const harmonics = bandEnergy(tail, 1000, 4000);
    let alias = 0;
    for (const f of [1500, 2500, 3500, 1230, 2770]) alias += bandEnergy(tail, f, f);
    expect(10 * Math.log10(alias / harmonics)).toBeLessThan(-55);
  });

  it("el eco a tempo repite a la negra", () => {
    const x = new Float32Array(SR * 2);
    for (let i = 0; i < 200; i++) x[i] = 0.5 * Math.sin(i / 3);
    const rig: GuitarRig = { ...DEFAULT_GUITAR_RIG, ampOn: false, dlyOn: true, dlySync: 5, dlyFeedback: 0, dlyMix: 1, dlyTone: 1 };
    applyGuitarRigInPlace(x, rig, SR, 120);
    // A 120 BPM la negra son 0,5 s: la repetición tiene que estar ahí.
    let peakAt = 0, peak = 0;
    for (let i = SR * 0.2; i < SR * 1.5; i++) {
      if (Math.abs(x[i]) > peak) { peak = Math.abs(x[i]); peakAt = i; }
    }
    expect(Math.abs(peakAt / SR - 0.5)).toBeLessThan(0.01);
    expect(rigHasTail(rig)).toBe(true);
  });

  it("viaja en los efectos de la pista y se aplica en la cadena", () => {
    const fx = parseTrackFx({ ...NO_TRACK_FX, rig: { ampModel: 1, ampGain: 0.7 } });
    expect(fx.rig?.ampModel).toBe(1);
    expect(isTrackFxActive(fx)).toBe(true);
    expect(hasFxTail(fx)).toBe(false);
    const g = guitar(1);
    const y = Float32Array.from(g);
    applyTrackFxInPlace(y, fx, SR);
    let diff = 0;
    for (let i = 0; i < g.length; i++) diff = Math.max(diff, Math.abs(y[i] - g[i]));
    expect(diff).toBeGreaterThan(0.01);
    expect(parseTrackFx(NO_TRACK_FX).rig).toBeNull();
  });
});
