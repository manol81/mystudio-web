import { it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { GUITAR_RIG_PRESETS, GuitarRigDsp, guitarRigFromPreset, rigParams } from "./guitarRig";

const SR = 44100;
function pluck(out: Float32Array, start: number, f: number, amp: number, dur: number, seed: number, mute = false) {
  const N = Math.round(SR / f);
  const buf = new Float32Array(N);
  let s = seed;
  for (let i = 0; i < N; i++) { s = (s * 1664525 + 1013904223) >>> 0; buf[i] = (s / 4294967296 - 0.5) * 2; }
  for (let k = 0; k < 2; k++) for (let i = 1; i < N; i++) buf[i] = 0.5 * (buf[i] + buf[i - 1]);
  let p = 0;
  const len = Math.min(out.length - start, Math.round(dur * SR));
  const pick = Math.round(N * 0.15);
  const hist: number[] = [];
  const decay = mute ? 0.97 : 0.997;
  for (let i = 0; i < len; i++) {
    const a = buf[p], b = buf[(p + 1) % N];
    buf[p] = decay * 0.5 * (a + b);
    p = (p + 1) % N;
    hist.push(a);
    const v = a - (hist.length > pick ? hist[hist.length - 1 - pick] : 0);
    const env = i > len - 300 ? (len - i) / 300 : 1;
    out[start + i] += v * amp * env;
  }
}
function riff(): Float32Array {
  const bpm = 100, beat = 60 / bpm;
  const out = new Float32Array(Math.round(SR * 12));
  // Acordes de quinta con golpes, después una frase de notas sueltas.
  const chords = [[82.41, 123.47, 164.81], [98.0, 146.83, 196.0], [110.0, 164.81, 220.0], [73.42, 110.0, 146.83]];
  let t = 0;
  for (let bar = 0; bar < 4; bar++) {
    const ch = chords[bar];
    const pattern = [1, 0.5, 0.5, 1, 1];
    for (const d of pattern) {
      ch.forEach((f, k) => pluck(out, Math.round((t + k * 0.008) * SR), f, 0.12, d * beat * 0.95, 11 + k + bar * 7, d < 1));
      t += d * beat;
    }
  }
  const lick = [329.63, 392.0, 440.0, 493.88, 440.0, 392.0, 329.63, 293.66];
  for (const [k, f] of lick.entries()) {
    pluck(out, Math.round(t * SR), f, 0.16, k === lick.length - 1 ? 1.8 : beat * 0.5, 50 + k);
    t += beat * 0.5;
  }
  return out;
}
it.skipIf(!process.env.DEMO_DIR)("demos", () => {
  const dir = process.env.DEMO_DIR!;
  const di = riff();
  writeFileSync(`${dir}/di_00_directo.f32`, Buffer.from(di.buffer));
  const realBuf = readFileSync(`${dir}/real.f32`);
  const real = new Float32Array(realBuf.buffer, realBuf.byteOffset, realBuf.byteLength / 4);
  // Llevar la toma real a nivel de guitarra directa (pico ~ -12 dBFS).
  let pk = 0; for (const v of real) pk = Math.max(pk, Math.abs(v));
  const realIn = real.map((v) => (v / pk) * 0.25);
  const ids = GUITAR_RIG_PRESETS.map((p) => p.id);
  ids.forEach((id, k) => {
    for (const [name, src] of [["di", di], ["real", realIn]] as const) {
      const y = Float32Array.from(src);
      const dsp = new GuitarRigDsp(SR);
      const p = rigParams(guitarRigFromPreset(id)!);
      for (let i = 0; i < y.length; i += 192) dsp.process(y, Math.min(192, y.length - i), p, 100, i);
      writeFileSync(`${dir}/${name}_${String(k + 1).padStart(2, "0")}_${id}.f32`, Buffer.from(y.buffer));
    }
  });
}, 600000);
