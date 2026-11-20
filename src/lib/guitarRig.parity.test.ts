import { it } from "vitest";
// Exporta la entrada, los programas de la pedalera y lo que da la web, para
// comparar con el motor nativo (tools/guitar_rig/ en la app). Solo corre con
// PARITY_DIR.
import { writeFileSync } from "node:fs";
import {
  DEFAULT_GUITAR_RIG,
  GUITAR_RIG_PRESETS,
  RIG_PARAM_COUNT,
  RigPlayer,
  buildRigProgram,
  prepareIr,
  type GuitarRig,
  type RigAutomation,
  type RigProgram,
} from "./guitarRig";

const SR = 44100;

/// [escenas, cambios, curvas, …] en double: lo lee rigtest.cpp.
function serialize(p: RigProgram): Float64Array {
  const out: number[] = [p.sceneCount, p.changeFrames.length, p.lanes.length];
  for (let i = 0; i < p.sceneCount * RIG_PARAM_COUNT; i++) out.push(p.scenes[i]);
  p.changeFrames.forEach((f, i) => out.push(f, p.changeScenes[i]));
  for (const l of p.lanes) {
    out.push(l.param, l.frames.length);
    l.frames.forEach((f, i) => out.push(f, l.values[i]));
  }
  return Float64Array.from(out);
}

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
  // Un IR sintético (ruido que cae, 3000 muestras) para los bafles 7.
  const irRaw = new Float32Array(3000);
  let t = 77;
  for (let i = 0; i < irRaw.length; i++) {
    t = (t * 1664525 + 1013904223) >>> 0;
    irRaw[i] = ((t / 4294967296) - 0.5) * Math.exp(-i / 500) * (i < 20 ? 0 : 1);
  }
  writeFileSync(`${dir}/ir.f32`, Buffer.from(irRaw.buffer));
  const ir = prepareIr(irRaw);
  const one = (c: Partial<GuitarRig>): [GuitarRig, RigAutomation | null] => [{ ...DEFAULT_GUITAR_RIG, ...c }, null];
  const configs: [GuitarRig, RigAutomation | null][] = [
    ...GUITAR_RIG_PRESETS.map((p) => one(p.rig)),
    one({ wahOn: true, wahAuto: false, wahAmount: 0.7, ampModel: 1 }),
    one({ driveOn: true, driveType: 1, driveGain: 0.9, ampModel: 2, ampGain: 1, ampMaster: 1, cab: 1 }),
    one({ modOn: true, modType: 1, modRate: 0.5, modDepth: 0.8, modMix: 0.7 }),
    one({ dlyOn: true, dlySync: 5, dlyFeedback: 0.6, dlyMix: 0.5, dlyTone: 0.9 }),
    one({ ampOn: false, driveOn: true, driveType: 2, gateDb: -50 }),
    one({ ampModel: 4, ampGain: 1, cab: 4, ampDiBlend: 0.8, octOn: true, octDry: 0.2 }),
    one({ ampModel: 3, ampMidHz: 2500, ampMid: 1, wahOn: true, wahAuto: false, wahAmount: 0.3, driveOn: true, driveType: 0, driveBlend: 0.9 }),
    one({ ampModel: 1, ampGain: 0.7, cab: 7 }),
    one({ ampModel: 4, ampGain: 0.5, cab: 7, cabBright: 0.8, dlyOn: true }),
    // +77: amplificadores, boost, ecualizador y reverb nuevos.
    one({ ampModel: 5, ampGain: 0.6, ampBass: 0.3, ampTreble: 0.8, cab: 2, boostOn: true, boostType: 1, boostDb: 12 }),
    one({ ampModel: 6, ampGain: 0.8, cab: 3, gateDb: -55, boostOn: true, boostType: 0, boostDb: 8, eqOn: true, eqLowCutHz: 90, eqMidDb: 4, eqMidHz: 900, eqHighCutHz: 8000 }),
    one({ ampModel: 0, boostOn: true, boostType: 2, boostDb: 18, revOn: true, revType: 0, revDecay: 0.6, revMix: 0.4 }),
    one({ ampModel: 1, revOn: true, revType: 1, revDecay: 0.3, revTone: 0.2, revMix: 0.6, eqOn: true, eqLowDb: -6, eqHighDb: 5, eqMidQ: 3 }),
    one({ ampModel: 2, revOn: true, revType: 2, revDecay: 1, revTone: 0.9, revMix: 0.3, dlyOn: true, dlySync: 3 }),
    // Escenas: limpio → lead con eco (y vuelta, con la cola del eco).
    [
      {
        ...DEFAULT_GUITAR_RIG,
        ampModel: 0,
        ampGain: 0.3,
        scenes: [{ ...DEFAULT_GUITAR_RIG, ampModel: 2, ampGain: 0.7, driveOn: true, dlyOn: true, dlyFeedback: 0.5, dlyMix: 0.4, dlyTimeMs: 300 }],
      },
      { scenes: [{ seconds: 1, scene: 1 }, { seconds: 2.5, scene: 0 }] },
    ],
    // Curvas: la distorsión que crece, el wah como pedal, el eco que entra.
    [
      { ...DEFAULT_GUITAR_RIG, ampModel: 1, driveOn: true, wahOn: true, wahAuto: false, dlyOn: true },
      {
        rig: {
          driveGain: [{ seconds: 0, value: 0 }, { seconds: 4, value: 1 }],
          wahAmount: [{ seconds: 0.2, value: 0 }, { seconds: 1, value: 1 }, { seconds: 1.6, value: 0.1 }],
          dlyMix: [{ seconds: 2, value: 0 }, { seconds: 3, value: 0.6 }],
          outDb: [{ seconds: 3.5, value: 0 }, { seconds: 3.9, value: -12 }],
        },
      },
    ],
    // Tres escenas con reverb, amplificadores distintos y modulación.
    [
      {
        ...DEFAULT_GUITAR_RIG,
        ampModel: 5,
        revOn: true,
        revType: 0,
        revMix: 0.5,
        scenes: [
          { ...DEFAULT_GUITAR_RIG, ampModel: 6, ampGain: 0.6, revOn: true, revType: 0, revMix: 0.3, revDecay: 0.8 },
          { ...DEFAULT_GUITAR_RIG, ampModel: 0, modOn: true, modType: 2, revOn: false, cab: 7 },
        ],
      },
      { scenes: [{ seconds: 0.7, scene: 1 }, { seconds: 1.9, scene: 2 }, { seconds: 3.1, scene: 0 }], rig: { modMix: [{ seconds: 2, value: 0.2 }, { seconds: 3, value: 1 }] } },
    ],
  ];
  configs.forEach(([rig, auto], k) => {
    const prog = buildRigProgram(rig, auto, SR)!;
    writeFileSync(`${dir}/prog_${k}.f64`, Buffer.from(serialize(prog).buffer));
    const y = Float32Array.from(x);
    const player = new RigPlayer(SR);
    // en bloques de 192 como el motor
    for (let i = 0; i < n; i += 192) player.process(y, Math.min(192, n - i), i, true, prog, -1, 100, ir, i);
    writeFileSync(`${dir}/ts_${k}.f32`, Buffer.from(y.buffer));
  });
  console.log("configs", configs.length);
}, 240000);
