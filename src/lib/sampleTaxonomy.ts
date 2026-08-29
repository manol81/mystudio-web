// src/lib/sampleTaxonomy.ts
//
// Taxonomía estructurada del Banco de Sonidos — fuente única de verdad
// para las opciones que arma tanto el panel de admin
// (/admin/upload-sample, al SUBIR un sample) como el catálogo
// (/samples, al FILTRAR). Un solo lugar evita que ambos lados
// diverjan silenciosamente (ej. un valor de instrumento escrito
// distinto en cada pantalla, que haría que el filtro nunca matchee).

export const SAMPLE_TYPES = ["Loop", "One-Shot"] as const;
export type SampleType = (typeof SAMPLE_TYPES)[number];

export const SAMPLE_INSTRUMENTS = [
  "Drums",
  "Bass",
  "Keys",
  "Synth",
  "Vocals",
  "Guitar",
  "FX",
] as const;
export type SampleInstrument = (typeof SAMPLE_INSTRUMENTS)[number];

export const SAMPLE_GENRES = [
  "Lo-Fi",
  "Hip-Hop",
  "EDM",
  "Rock",
  "Cinematic",
  "Utility",
] as const;
export type SampleGenre = (typeof SAMPLE_GENRES)[number];

// 12 notas cromáticas × Major/Minor + "N/A" (percusión y demás audio
// sin tonalidad definida) — mismo criterio que catálogos tipo Splice.
const KEY_ROOTS = [
  "C",
  "C#",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "Bb",
  "B",
] as const;

export const SAMPLE_KEYS = [
  "N/A",
  ...KEY_ROOTS.flatMap((root) => [`${root} Major`, `${root} Minor`]),
] as const;
export type SampleKey = (typeof SAMPLE_KEYS)[number];
