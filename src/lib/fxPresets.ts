// src/lib/fxPresets.ts
//
// Presets de efectos (2026-10-16). ⚠️ Espejo A MANO de
// `lib/features/audio_engine/utils/fx_presets.dart` de la app: mismos
// ids, mismos valores, mismos pasos del corte de graves. Si se cambia
// uno sin el otro, la app y el Arranger muestran nombres distintos para
// la misma mezcla.
//
// Un preset es un PUNTO DE PARTIDA: mueve los sliders y desde ahí se
// ajusta a mano. Si alguien toca algo, el panel pasa a decir
// "Personalizado" (ver matchingTrackPreset).

import {
  DEFAULT_EQ_MID_HZ,
  DEFAULT_SAT_TONE_HZ,
  GATE_OFF_DB,
  type MasterFx,
  type TrackFx,
} from "@/lib/trackEffects";

export const LOW_CUT_STEPS_HZ = [0, 30, 40, 60, 80, 100, 120, 160, 200, 250, 300];
export const MID_HZ_MIN = 200;
export const MID_HZ_MAX = 5000;

interface CompPreset {
  enabled: boolean;
  thresholdDb?: number;
  ratio?: number;
  makeupDb?: number;
}

interface SatPreset { drive: number; toneHz?: number; mix?: number }
interface DelayPreset { division: number; feedback?: number; mix?: number }
interface ChorusPreset { mix: number; depth?: number }

/// Un campo ausente = el preset no lo toca (los correctivos solo cambian
/// lo suyo y respetan el resto).
export interface TrackFxPreset {
  id: string;
  name: string;
  hpfHz?: number;
  eqLowDb?: number;
  eqMidDb?: number;
  eqMidHz?: number;
  eqHighDb?: number;
  comp?: CompPreset;
  reverbSend?: number;
  /// Paquete 1 de efectos (2026-10-27).
  gateDb?: number;
  sat?: SatPreset;
  delay?: DelayPreset;
  chorus?: ChorusPreset;
}

// Los "apagados" del paquete 1: los presets completos los ponen para que
// pasar de "Voz con eco" a "Voz" saque el eco.
const OFF = {
  gateDb: GATE_OFF_DB,
  sat: { drive: 0 },
  delay: { division: 0 },
  chorus: { mix: 0 },
};
const VOCAL_EQ = { hpfHz: 100, eqLowDb: 0, eqMidDb: -3, eqMidHz: 300, eqHighDb: 3 };
const VOCAL_COMP: CompPreset = { enabled: true, thresholdDb: -20, ratio: 3, makeupDb: 3 };

export const TRACK_FX_PRESETS: TrackFxPreset[] = [
  { id: "vocals", name: "Voz", ...VOCAL_EQ, comp: VOCAL_COMP, reverbSend: 0.2, ...OFF },
  {
    id: "acousticGuitar", name: "Guitarra acústica",
    hpfHz: 80, eqLowDb: -2, eqMidDb: -3, eqMidHz: 250, eqHighDb: 2,
    comp: { enabled: true, thresholdDb: -18, ratio: 2.5, makeupDb: 2 },
    reverbSend: 0.15, ...OFF,
  },
  {
    id: "electricGuitar", name: "Guitarra eléctrica",
    hpfHz: 80, eqLowDb: 0, eqMidDb: 2, eqMidHz: 1500, eqHighDb: -2,
    comp: { enabled: true, thresholdDb: -16, ratio: 2, makeupDb: 1 },
    reverbSend: 0.1, ...OFF,
  },
  {
    id: "bass", name: "Bajo",
    hpfHz: 40, eqLowDb: 3, eqMidDb: -2, eqMidHz: 600, eqHighDb: -3,
    comp: { enabled: true, thresholdDb: -22, ratio: 4, makeupDb: 4 },
    reverbSend: 0, ...OFF,
  },
  {
    id: "drums", name: "Batería",
    hpfHz: 30, eqLowDb: 2, eqMidDb: -3, eqMidHz: 400, eqHighDb: 3,
    comp: { enabled: true, thresholdDb: -14, ratio: 3, makeupDb: 2 },
    reverbSend: 0.1, ...OFF,
  },
  {
    id: "keys", name: "Teclados",
    hpfHz: 60, eqLowDb: -1, eqMidDb: -2, eqMidHz: 500, eqHighDb: 1,
    comp: { enabled: false },
    reverbSend: 0.2, ...OFF,
  },
  // ─── Voces con carácter (2026-10-27) ───
  {
    id: "doubleVocals", name: "Doble voz", ...VOCAL_EQ, comp: VOCAL_COMP, reverbSend: 0.15,
    ...OFF, chorus: { mix: 0.55, depth: 0.2 },
  },
  {
    id: "vocalEcho", name: "Voz con eco", ...VOCAL_EQ, comp: VOCAL_COMP, reverbSend: 0.15,
    ...OFF, delay: { division: 3, feedback: 0.3, mix: 0.25 },
  },
  {
    id: "stadiumVocals", name: "Voz de estadio", ...VOCAL_EQ, comp: VOCAL_COMP, reverbSend: 0.4,
    ...OFF, delay: { division: 5, feedback: 0.45, mix: 0.3 },
  },
  {
    id: "distortedVocals", name: "Voz distorsionada",
    hpfHz: 120, eqLowDb: -2, eqMidDb: 3, eqMidHz: 2000, eqHighDb: -2,
    comp: { enabled: true, thresholdDb: -18, ratio: 3, makeupDb: 2 },
    reverbSend: 0.1,
    ...OFF, gateDb: -55, sat: { drive: 0.65, toneHz: 6000 },
  },
  {
    id: "oldRadio", name: "Radio vieja",
    hpfHz: 300, eqLowDb: -6, eqMidDb: 4, eqMidHz: 1500, eqHighDb: -12,
    comp: { enabled: true, thresholdDb: -22, ratio: 4, makeupDb: 4 },
    reverbSend: 0,
    ...OFF, sat: { drive: 0.35, toneHz: 3500 },
  },
  {
    id: "megaphone", name: "Megáfono",
    hpfHz: 300, eqLowDb: -8, eqMidDb: 6, eqMidHz: 2000, eqHighDb: -12,
    comp: { enabled: true, thresholdDb: -20, ratio: 6, makeupDb: 4 },
    reverbSend: 0.05,
    ...OFF, sat: { drive: 0.6, toneHz: 4000 },
  },
  {
    id: "slapback", name: "Slapback",
    hpfHz: 100, eqLowDb: 0, eqMidDb: 0, eqMidHz: DEFAULT_EQ_MID_HZ, eqHighDb: 1,
    comp: { enabled: true, thresholdDb: -18, ratio: 3, makeupDb: 2 },
    reverbSend: 0.05,
    ...OFF, delay: { division: 1, feedback: 0.1, mix: 0.35 },
  },
  // ─── Color para instrumentos ───
  {
    id: "crunchGuitar", name: "Guitarra crunch",
    hpfHz: 80, eqLowDb: 0, eqMidDb: 2, eqMidHz: 1200, eqHighDb: -2,
    comp: { enabled: true, thresholdDb: -16, ratio: 2, makeupDb: 1 },
    reverbSend: 0.1,
    ...OFF, sat: { drive: 0.5, toneHz: 5000 },
  },
  {
    id: "chorusGuitar", name: "Guitarra con chorus",
    hpfHz: 80, eqLowDb: -1, eqMidDb: -2, eqMidHz: 400, eqHighDb: 2,
    comp: { enabled: false },
    reverbSend: 0.2,
    ...OFF, chorus: { mix: 0.5, depth: 0.6 },
  },
  {
    id: "drivenBass", name: "Bajo saturado",
    hpfHz: 40, eqLowDb: 3, eqMidDb: 2, eqMidHz: 800, eqHighDb: -3,
    comp: { enabled: true, thresholdDb: -22, ratio: 4, makeupDb: 4 },
    reverbSend: 0,
    ...OFF, sat: { drive: 0.3, toneHz: 2500, mix: 0.5 },
  },
  // ─── Correcciones ───
  { id: "removeMud", name: "Quitar barro", hpfHz: 80, eqLowDb: 0, eqMidDb: -4, eqMidHz: 300, eqHighDb: 0 },
  { id: "softenHarshness", name: "Suavizar lo áspero", eqLowDb: 0, eqMidDb: -4, eqMidHz: 3500, eqHighDb: -3 },
  { id: "cleanNoise", name: "Limpiar ruido entre frases", gateDb: -50 },
  {
    id: "lofi", name: "Lo-fi / teléfono",
    hpfHz: 250, eqLowDb: -6, eqMidDb: 6, eqMidHz: 1500, eqHighDb: -12,
    comp: { enabled: true, thresholdDb: -24, ratio: 6, makeupDb: 6 },
    reverbSend: 0, ...OFF,
  },
];

/// Cómo se agrupan en la lista (mismos grupos que la app).
export const TRACK_FX_PRESET_GROUPS: { name: string; ids: string[] }[] = [
  { name: "Instrumentos y voz", ids: ["vocals", "acousticGuitar", "electricGuitar", "bass", "drums", "keys"] },
  {
    name: "Voces con carácter",
    ids: ["doubleVocals", "vocalEcho", "stadiumVocals", "distortedVocals", "oldRadio", "megaphone", "slapback"],
  },
  { name: "Color para instrumentos", ids: ["crunchGuitar", "chorusGuitar", "drivenBass", "lofi"] },
  { name: "Correcciones", ids: ["removeMud", "softenHarshness", "cleanNoise"] },
];

export function applyTrackPreset(preset: TrackFxPreset, fx: TrackFx): TrackFx {
  const next: TrackFx = { ...fx };
  if (preset.eqLowDb !== undefined) next.eqLowDb = preset.eqLowDb;
  if (preset.eqMidDb !== undefined) next.eqMidDb = preset.eqMidDb;
  if (preset.eqMidHz !== undefined) next.eqMidHz = preset.eqMidHz;
  if (preset.eqHighDb !== undefined) next.eqHighDb = preset.eqHighDb;
  if (preset.hpfHz !== undefined) next.hpfHz = preset.hpfHz;
  if (preset.comp) {
    next.compEnabled = preset.comp.enabled;
    next.compThresholdDb = preset.comp.thresholdDb ?? -18;
    next.compRatio = preset.comp.ratio ?? 3;
    next.compMakeupDb = preset.comp.makeupDb ?? 0;
  }
  if (preset.reverbSend !== undefined) next.reverbSend = preset.reverbSend;
  if (preset.gateDb !== undefined) next.gateThresholdDb = preset.gateDb;
  if (preset.sat) {
    next.satDrive = preset.sat.drive;
    next.satToneHz = preset.sat.toneHz ?? DEFAULT_SAT_TONE_HZ;
    next.satMix = preset.sat.mix ?? 1;
  }
  if (preset.delay) {
    next.delayDiv = preset.delay.division;
    next.delayFeedback = preset.delay.feedback ?? 0.3;
    next.delayMix = preset.delay.mix ?? 0.3;
  }
  if (preset.chorus) {
    next.chorusMix = preset.chorus.mix;
    next.chorusDepth = preset.chorus.depth ?? 0.3;
  }
  return next;
}

const near = (a: number | undefined, b: number) => Math.abs((a ?? 0) - b) < 0.01;

function trackPresetMatches(p: TrackFxPreset, fx: TrackFx): boolean {
  const same = (value: number | undefined, preset: number | undefined) =>
    preset === undefined || near(value, preset);
  if (
    !same(fx.hpfHz, p.hpfHz) ||
    !same(fx.eqLowDb, p.eqLowDb) ||
    !same(fx.eqMidDb, p.eqMidDb) ||
    !same(fx.eqHighDb, p.eqHighDb)
  ) {
    return false;
  }
  if ((p.eqMidDb ?? 0) !== 0 && !same(fx.eqMidHz ?? DEFAULT_EQ_MID_HZ, p.eqMidHz)) return false;
  if (p.comp) {
    if (fx.compEnabled !== p.comp.enabled) return false;
    if (
      p.comp.enabled &&
      (!near(fx.compThresholdDb, p.comp.thresholdDb ?? -18) ||
        !near(fx.compRatio, p.comp.ratio ?? 3) ||
        !near(fx.compMakeupDb, p.comp.makeupDb ?? 0))
    ) {
      return false;
    }
  }
  if (!same(fx.reverbSend, p.reverbSend)) return false;
  if (p.gateDb !== undefined && !near(fx.gateThresholdDb ?? GATE_OFF_DB, p.gateDb)) return false;
  if (p.sat) {
    if (!near(fx.satDrive, p.sat.drive)) return false;
    if (
      p.sat.drive > 0 &&
      (!near(fx.satToneHz ?? DEFAULT_SAT_TONE_HZ, p.sat.toneHz ?? DEFAULT_SAT_TONE_HZ) ||
        !near(fx.satMix ?? 1, p.sat.mix ?? 1))
    ) {
      return false;
    }
  }
  if (p.delay) {
    if ((fx.delayDiv ?? 0) !== p.delay.division) return false;
    if (
      p.delay.division > 0 &&
      (!near(fx.delayFeedback ?? 0.3, p.delay.feedback ?? 0.3) || !near(fx.delayMix ?? 0.3, p.delay.mix ?? 0.3))
    ) {
      return false;
    }
  }
  if (p.chorus) {
    if (!near(fx.chorusMix, p.chorus.mix)) return false;
    if (p.chorus.mix > 0 && !near(fx.chorusDepth ?? 0.3, p.chorus.depth ?? 0.3)) return false;
  }
  return true;
}

export function matchingTrackPreset(fx: TrackFx): TrackFxPreset | null {
  return TRACK_FX_PRESETS.find((p) => trackPresetMatches(p, fx)) ?? null;
}

/// Presets del máster: SOLO el ecualizador.
export interface MasterEqPreset {
  id: string;
  name: string;
  eqLowDb: number;
  eqMidDb: number;
  eqMidHz: number;
  eqHighDb: number;
}

export const MASTER_EQ_PRESETS: MasterEqPreset[] = [
  { id: "flat", name: "Plano", eqLowDb: 0, eqMidDb: 0, eqMidHz: DEFAULT_EQ_MID_HZ, eqHighDb: 0 },
  { id: "warm", name: "Cálido", eqLowDb: 2, eqMidDb: -1, eqMidHz: 3000, eqHighDb: -2 },
  { id: "bright", name: "Brillante", eqLowDb: -1, eqMidDb: 1, eqMidHz: 4000, eqHighDb: 3 },
  { id: "lessMud", name: "Menos barro", eqLowDb: 0, eqMidDb: -3, eqMidHz: 300, eqHighDb: 0 },
  { id: "smallSpeakers", name: "Parlantes chicos", eqLowDb: -4, eqMidDb: 2, eqMidHz: 1200, eqHighDb: 1 },
];

export function applyMasterPreset(p: MasterEqPreset, fx: MasterFx): MasterFx {
  return { ...fx, eqLowDb: p.eqLowDb, eqMidDb: p.eqMidDb, eqMidHz: p.eqMidHz, eqHighDb: p.eqHighDb };
}

export function matchingMasterEqPreset(fx: MasterFx): MasterEqPreset | null {
  return (
    MASTER_EQ_PRESETS.find(
      (p) =>
        near(fx.eqLowDb, p.eqLowDb) &&
        near(fx.eqMidDb, p.eqMidDb) &&
        near(fx.eqHighDb, p.eqHighDb) &&
        (p.eqMidDb === 0 || near(fx.eqMidHz ?? DEFAULT_EQ_MID_HZ, p.eqMidHz)),
    ) ?? null
  );
}

/// Frecuencia de medios ↔ posición [0, 1] del slider, logarítmica (la
/// mitad cae en 1 kHz). Mismo redondeo que la app.
export function midHzToSlider(hz: number): number {
  const c = Math.max(MID_HZ_MIN, Math.min(MID_HZ_MAX, hz));
  return Math.log(c / MID_HZ_MIN) / Math.log(MID_HZ_MAX / MID_HZ_MIN);
}

export function sliderToMidHz(t: number): number {
  const raw = MID_HZ_MIN * Math.pow(MID_HZ_MAX / MID_HZ_MIN, Math.max(0, Math.min(1, t)));
  const step = raw < 1000 ? 10 : 50;
  return Math.max(MID_HZ_MIN, Math.min(MID_HZ_MAX, Math.round(raw / step) * step));
}

export function formatHz(hz: number): string {
  if (hz < 1000) return `${Math.round(hz)} Hz`;
  const k = hz / 1000;
  return `${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)} kHz`;
}

/// Tono de la saturación ↔ posición [0, 1], logarítmica entre 1 y 16 kHz,
/// redondeada a 100 Hz (igual que la app).
export function satToneToSlider(hz: number): number {
  const c = Math.max(1000, Math.min(16000, hz));
  return Math.log(c / 1000) / Math.log(16);
}

export function sliderToSatTone(t: number): number {
  const raw = 1000 * Math.pow(16, Math.max(0, Math.min(1, t)));
  return Math.max(1000, Math.min(16000, Math.round(raw / 100) * 100));
}

export function lowCutStepIndex(hz: number): number {
  let best = 0;
  LOW_CUT_STEPS_HZ.forEach((step, i) => {
    if (Math.abs(step - hz) < Math.abs(LOW_CUT_STEPS_HZ[best] - hz)) best = i;
  });
  return best;
}
