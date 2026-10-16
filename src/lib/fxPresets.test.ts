// Presets de efectos — espejo de test/audio_engine/fx_presets_test.dart.
// Que cada preset se reconozca a sí mismo (si no, el panel diría
// "Personalizado" justo después de elegirlo) y que los correctivos no
// pisen el compresor ni la reverb.

import { describe, expect, it } from "vitest";
import {
  LOW_CUT_STEPS_HZ,
  MASTER_EQ_PRESETS,
  TRACK_FX_PRESETS,
  applyMasterPreset,
  applyTrackPreset,
  formatHz,
  matchingMasterEqPreset,
  matchingTrackPreset,
  midHzToSlider,
  sliderToMidHz,
} from "./fxPresets";
import { DEFAULT_MASTER_FX, NO_TRACK_FX, isTrackFxActive } from "./trackEffects";

describe("presets de pista", () => {
  it("cada preset se reconoce a sí mismo y usa pasos válidos del corte", () => {
    for (const p of TRACK_FX_PRESETS) {
      const fx = applyTrackPreset(p, NO_TRACK_FX);
      expect(matchingTrackPreset(fx)?.id).toBe(p.id);
      expect(isTrackFxActive(fx)).toBe(true);
      if (p.hpfHz !== undefined) expect(LOW_CUT_STEPS_HZ).toContain(p.hpfHz);
    }
    expect(new Set(TRACK_FX_PRESETS.map((p) => p.id)).size).toBe(TRACK_FX_PRESETS.length);
  });

  it("los ids y valores son los de la app", () => {
    expect(TRACK_FX_PRESETS.map((p) => p.id)).toEqual([
      "vocals", "acousticGuitar", "electricGuitar", "bass", "drums", "keys",
      "removeMud", "softenHarshness", "lofi",
    ]);
    expect(MASTER_EQ_PRESETS.map((p) => p.id)).toEqual([
      "flat", "warm", "bright", "lessMud", "smallSpeakers",
    ]);
  });

  it("los correctivos tocan solo el ecualizador", () => {
    const mine = { ...NO_TRACK_FX, compEnabled: true, compRatio: 8, reverbSend: 0.4, hpfHz: 120 };
    const harsh = applyTrackPreset(TRACK_FX_PRESETS.find((p) => p.id === "softenHarshness")!, mine);
    expect(harsh.compRatio).toBe(8);
    expect(harsh.reverbSend).toBe(0.4);
    expect(harsh.hpfHz).toBe(120);
  });

  it("mover un slider pasa a Personalizado", () => {
    const fx = applyTrackPreset(TRACK_FX_PRESETS[0], NO_TRACK_FX);
    expect(matchingTrackPreset({ ...fx, eqHighDb: fx.eqHighDb + 1 })).toBeNull();
  });
});

describe("presets del máster", () => {
  it("cada uno se reconoce y no toca la reverb ni el limitador", () => {
    const base = { ...DEFAULT_MASTER_FX, reverbWet: 0.6, limiterEnabled: false };
    for (const p of MASTER_EQ_PRESETS) {
      const fx = applyMasterPreset(p, base);
      expect(matchingMasterEqPreset(fx)?.id).toBe(p.id);
      expect(fx.reverbWet).toBe(0.6);
      expect(fx.limiterEnabled).toBe(false);
    }
    expect(matchingMasterEqPreset(DEFAULT_MASTER_FX)?.id).toBe("flat");
  });
});

describe("frecuencia de medios", () => {
  it("la mitad del slider es 1 kHz", () => {
    expect(midHzToSlider(1000)).toBeCloseTo(0.5, 9);
    expect(sliderToMidHz(0.5)).toBe(1000);
    expect(sliderToMidHz(0)).toBe(200);
    expect(sliderToMidHz(1)).toBe(5000);
  });

  it("formato legible", () => {
    expect(formatHz(350)).toBe("350 Hz");
    expect(formatHz(1000)).toBe("1 kHz");
    expect(formatHz(3500)).toBe("3.5 kHz");
  });
});
