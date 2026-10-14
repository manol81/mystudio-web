// El volumen de un clip se muestra y se mueve en dB (2026-10-14), igual
// que en la app (`_ClipEditToolbar` de mixer_screen.dart): en amplitud
// todo lo útil (−12 a 0 dB) quedaba amontonado a la derecha, y subir
// por encima de 0 dB no existía o se veía como "150 %".
//
// Extremo izquierdo = silencio; de ahí en más, −40 a +12 dB lineal en
// dB, con un imán en 0 dB. +12 dB es el MISMO tope que el motor nativo
// (kMaxClipVolume): un valor que la web permita y el teléfono no,
// sonaría distinto allá.

export const MAX_CLIP_GAIN = 3.9810717055349722; // +12 dB
const MIN_DB = -40;
const MAX_DB = 12;

export function clipGainToSlider(gain: number): number {
  if (!(gain > 0)) return 0;
  const db = 20 * Math.log10(gain);
  return Math.min(1, Math.max(0, (db - MIN_DB) / (MAX_DB - MIN_DB)));
}

export function sliderToClipGain(slider: number): number {
  if (slider <= 0.002) return 0;
  const db = MIN_DB + slider * (MAX_DB - MIN_DB);
  if (Math.abs(db) < 0.5) return 1; // imán en "como se grabó"
  return Math.min(MAX_CLIP_GAIN, Math.pow(10, db / 20));
}

/// "−3,0 dB", "+1,5 dB", "0 dB", "−∞ dB".
export function formatClipGainDb(gain: number): string {
  if (!(gain > 0)) return "−∞ dB";
  const db = 20 * Math.log10(gain);
  if (Math.abs(db) < 0.05) return "0 dB";
  return `${db > 0 ? "+" : "−"}${Math.abs(db).toFixed(1).replace(".", ",")} dB`;
}
