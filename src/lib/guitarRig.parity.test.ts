import { it } from "vitest";
// Exporta la entrada, los parámetros y lo que da la web, para comparar con el
// motor nativo (tools/guitar_rig/ en la app). Solo corre con PARITY_DIR.
import { writeFileSync } from "node:fs";
import { DEFAULT_GUITAR_RIG, GUITAR_RIG_PRESETS, GuitarRigDsp, RIG_PARAM_COUNT, rigParams, type GuitarRig } from "./guitarRig";

const SR = 44100;
it.skipIf(!process.env.PARITY_DIR)("parity export (tools/guitar_rig/run_parity.sh)", () => {
  const dir = process.env.PARITY_DIR!;
  const n = SR * 4;
  const x = new Float32Array(n);
  let s = 12345;
  // Rasgueos sintéticos: ruido filtrado con caída + senos (determinístico).
  for (let k = 0; k < 8; k++) {
    const start = Math.round(k * 0.5 * SR);
    const f = [82.4, 110, 146.8, 196][k % 4];
    for (let i = 0; i < SR * 0.5 && start + i < n; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const env = Math.exp(-i / (SR * 0.25));
      x[start + i] += 0.12 * env * (Math.sin((2 * Math.PI * f * i) / SR) + 0.5 * Math.sin((2 * Math.PI * 2 * f * i) / SR) + 0.3 * Math.sin((2 * Math.PI * 3.01 * f * i) / SR) + 0.2 * ((s / 4294967296) - 0.5));
    }
  }
  writeFileSync(`${dir}/input.f32`, Buffer.from(x.buffer));
  const configs: Partial<GuitarRig>[] = [
    ...GUITAR_RIG_PRESETS.map((p) => p.rig),
    { wahOn: true, wahAuto: false, wahAmount: 0.7, ampModel: 1 },
    { driveOn: true, driveType: 1, driveGain: 0.9, ampModel: 2, ampGain: 1, ampMaster: 1, cab: 1 },
    { modOn: true, modType: 1, modRate: 0.5, modDepth: 0.8, modMix: 0.7 },
    { dlyOn: true, dlySync: 5, dlyFeedback: 0.6, dlyMix: 0.5, dlyTone: 0.9 },
    { ampOn: false, driveOn: true, driveType: 2, gateDb: -50 },
    { ampModel: 4, ampGain: 1, cab: 4, ampDiBlend: 0.8, octOn: true, octDry: 0.2 },
    { ampModel: 3, ampMidHz: 2500, ampMid: 1, wahOn: true, wahAuto: false, wahAmount: 0.3, driveOn: true, driveType: 0, driveBlend: 0.9 },
  ];
  const params = new Float32Array(configs.length * RIG_PARAM_COUNT);
  configs.forEach((c, k) => {
    const rig = { ...DEFAULT_GUITAR_RIG, ...c };
    params.set(rigParams(rig), k * RIG_PARAM_COUNT);
    const y = Float32Array.from(x);
    const dsp = new GuitarRigDsp(SR);
    // en bloques de 192 como el motor
    for (let i = 0; i < n; i += 192) dsp.process(y, Math.min(192, n - i), rigParams(rig), 100, i);
    writeFileSync(`${dir}/ts_${k}.f32`, Buffer.from(y.buffer));
  });
  writeFileSync(`${dir}/params.f32`, Buffer.from(params.buffer));
  console.log("configs", configs.length);
}, 120000);
