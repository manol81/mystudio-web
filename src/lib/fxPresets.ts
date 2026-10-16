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

import { DEFAULT_EQ_MID_HZ, type MasterFx, type TrackFx } from "@/lib/trackEffects";

export const LOW_CUT_STEPS_HZ = [0, 30, 40, 60, 80, 100, 120, 160, 200, 250, 300];
export const MID_HZ_MIN = 200;
export const MID_HZ_MAX = 5000;

interface CompPreset {
  enabled: boolean;
  thresholdDb?: number;
  ratio?: number;
  makeupDb?: number;
}

/// Un campo ausente = el preset no lo toca (los correctivos solo cambian
/// el ecualizador y respetan el compresor y la reverb).
export interface TrackFxPreset {
  id: string;
  name: string;
  hpfHz?: number;
  eqLowDb: number;
  eqMidDb: number;
  eqMidHz: number;
  eqHighDb: number;
  comp?: CompPreset;
  reverbSend?: number;
}

export const TRACK_FX_PRESETS: TrackFxPreset[] = [
  {
    id: "vocals", name: "Voz",
    hpfHz: 100, eqLowDb: 0, eqMidDb: -3, eqMidHz: 300, eqHighDb: 3,
    comp: { enabled: true, thresholdDb: -20, ratio: 3, makeupDb: 3 },
    reverbSend: 0.2,
  },
  {
    id: "acousticGuitar", name: "Guitarra acústica",
    hpfHz: 80, eqLowDb: -2, eqMidDb: -3, eqMidHz: 250, eqHighDb: 2,
    comp: { enabled: true, thresholdDb: -18, ratio: 2.5, makeupDb: 2 },
    reverbSend: 0.15,
  },
  {
    id: "electricGuitar", name: "Guitarra eléctrica",
    hpfHz: 80, eqLowDb: 0, eqMidDb: 2, eqMidHz: 1500, eqHighDb: -2,
    comp: { enabled: true, thresholdDb: -16, ratio: 2, makeupDb: 1 },
    reverbSend: 0.1,
  },
  {
    id: "bass", name: "Bajo",
    hpfHz: 40, eqLowDb: 3, eqMidDb: -2, eqMidHz: 600, eqHighDb: -3,
    comp: { enabled: true, thresholdDb: -22, ratio: 4, makeupDb: 4 },
    reverbSend: 0,
  },
  {
    id: "drums", name: "Batería",
    hpfHz: 30, eqLowDb: 2, eqMidDb: -3, eqMidHz: 400, eqHighDb: 3,
    comp: { enabled: true, thresholdDb: -14, ratio: 3, makeupDb: 2 },
    reverbSend: 0.1,
  },
  {
    id: "keys", name: "Teclados",
    hpfHz: 60, eqLowDb: -1, eqMidDb: -2, eqMidHz: 500, eqHighDb: 1,
    comp: { enabled: false },
    reverbSend: 0.2,
  },
  { id: "removeMud", name: "Quitar barro", hpfHz: 80, eqLowDb: 0, eqMidDb: -4, eqMidHz: 300, eqHighDb: 0 },
  { id: "softenHarshness", name: "Suavizar lo áspero", eqLowDb: 0, eqMidDb: -4, eqMidHz: 3500, eqHighDb: -3 },
  {
    id: "lofi", name: "Lo-fi / teléfono",
    hpfHz: 250, eqLowDb: -6, eqMidDb: 6, eqMidHz: 1500, eqHighDb: -12,
    comp: { enabled: true, thresholdDb: -24, ratio: 6, makeupDb: 6 },
    reverbSend: 0,
  },
];

export function applyTrackPreset(preset: TrackFxPreset, fx: TrackFx): TrackFx {
  const next: TrackFx = {
    ...fx,
    eqLowDb: preset.eqLowDb,
    eqMidDb: preset.eqMidDb,
    eqMidHz: preset.eqMidHz,
    eqHighDb: preset.eqHighDb,
  };
  if (preset.hpfHz !== undefined) next.hpfHz = preset.hpfHz;
  if (preset.comp) {
    next.compEnabled = preset.comp.enabled;
    next.compThresholdDb = preset.comp.thresholdDb ?? -18;
    next.compRatio = preset.comp.ratio ?? 3;
    next.compMakeupDb = preset.comp.makeupDb ?? 0;
  }
  if (preset.reverbSend !== undefined) next.reverbSend = preset.reverbSend;
  return next;
}

const near = (a: number | undefined, b: number) => Math.abs((a ?? 0) - b) < 0.01;

function trackPresetMatches(p: TrackFxPreset, fx: TrackFx): boolean {
  if (p.hpfHz !== undefined && !near(fx.hpfHz, p.hpfHz)) return false;
  if (!near(fx.eqLowDb, p.eqLowDb) || !near(fx.eqMidDb, p.eqMidDb) || !near(fx.eqHighDb, p.eqHighDb)) {
    return false;
  }
  if (p.eqMidDb !== 0 && !near(fx.eqMidHz ?? DEFAULT_EQ_MID_HZ, p.eqMidHz)) return false;
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
  if (p.reverbSend !== undefined && !near(fx.reverbSend, p.reverbSend)) return false;
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

export function lowCutStepIndex(hz: number): number {
  let best = 0;
  LOW_CUT_STEPS_HZ.forEach((step, i) => {
    if (Math.abs(step - hz) < Math.abs(LOW_CUT_STEPS_HZ[best] - hz)) best = i;
  });
  return best;
}
