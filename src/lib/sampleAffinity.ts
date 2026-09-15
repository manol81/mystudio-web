// src/lib/sampleAffinity.ts
//
// ¿Este sample entra en MI proyecto? Tres preguntas que hasta ahora el
// Banco de Sonidos no respondía en ningún lado, y que el usuario tenía
// que contestar de oído, soltando el clip y escuchando qué pasaba:
//
//   1. ¿La tonalidad es compatible? (keysAreCompatible)
//   2. ¿Cuánto hay que transponerlo para que lo sea? (transposeSemitonesFor)
//   3. ¿El tempo está cerca, o estirarlo lo va a destrozar? (tempoDistance / stretchRatioFor)
//
// Todo acá es PURO: sin React, sin Firebase, sin AudioContext. Es la
// capa que comparten el catálogo (/samples) y el panel del Arranger,
// y la única parte de este bloque que tiene sentido cubrir con tests.
//
// ─── Por qué Camelot y no "la misma tonalidad" ────────────────────────
//
// Filtrar por tonalidad EXACTA sería casi inútil: con 34 samples, pedir
// "solo A Minor" deja dos. Pero A Minor, C Major, E Minor y D Minor
// comparten prácticamente todas sus notas — mezclarlos no produce
// ningún choque. La rueda Camelot es la forma estándar (Mixed In Key,
// Traktor, Rekordbox y medio mundo del DJing) de expresar justamente
// eso: cada tonalidad es un número del 1 al 12 más una letra (A menor,
// B mayor), y son compatibles el mismo número (relativa mayor/menor) y
// los números vecinos con la misma letra (una quinta arriba o abajo).
//
// El número sale del CÍRCULO DE QUINTAS, no del orden cromático: subir
// una quinta (7 semitonos) avanza exactamente un número. Por eso la
// conversión multiplica por 7 en módulo 12 en vez de usar una tabla de
// 24 entradas escrita a mano, que sería otra cosa más para mantener
// sincronizada con SAMPLE_KEYS.

/** Nota → clase de altura (0 = C). Incluye enarmónicos que NO están en
 *  SAMPLE_KEYS (Db, D#, Gb, Ab, A#) porque los nombres de archivo de
 *  los packs reales los usan y la heurística del script de carga masiva
 *  los puede haber dejado escritos así. */
const PITCH_CLASSES: Record<string, number> = {
  C: 0,
  "B#": 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  Fb: 4,
  F: 5,
  "E#": 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
  Cb: 11,
};

export type KeyMode = "major" | "minor";

export interface ParsedKey {
  /** 0 = C, 1 = C#/Db, … 11 = B. */
  pitchClass: number;
  mode: KeyMode;
}

export interface CamelotCode {
  /** 1-12, posición en el círculo de quintas. */
  number: number;
  /** "A" = menor, "B" = mayor (convención Camelot). */
  letter: "A" | "B";
}

function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

/**
 * "A Minor" → { pitchClass: 9, mode: "minor" }.
 *
 * Devuelve `null` para "N/A", vacío o cualquier cosa que no se pueda
 * leer — que NO es un error: la percusión y los FX no tienen tonalidad
 * y son perfectamente usables. Todo lo de abajo trata ese `null` como
 * "entra en cualquier lado", nunca como "descartar".
 */
export function parseSampleKey(raw: string | null | undefined): ParsedKey | null {
  const text = (raw ?? "").trim();
  if (!text || text.toUpperCase() === "N/A") return null;

  const match = text.match(/^([A-Ga-g])\s*([#b]?)\s*(.*)$/);
  if (!match) return null;

  // "eb minor" y "Eb Minor" tienen que dar lo mismo: la nota va en
  // mayúscula y el alteración en minúscula ("b" bemol), que es como
  // están escritas las claves de PITCH_CLASSES.
  const root = match[1].toUpperCase() + (match[2] === "#" ? "#" : match[2] ? "b" : "");
  const pitchClass = PITCH_CLASSES[root];
  if (pitchClass === undefined) return null;

  const rest = match[3].toLowerCase();
  // "Minor", "min", "m" y "minor" son todos lo mismo. Ojo con el orden:
  // preguntar por "m" antes que por "maj" leería "C maj" como menor
  // (mismo bug que ya se documentó en la heurística del script de carga
  // masiva, ver scripts/samples.mjs).
  const mode: KeyMode = rest.startsWith("min") || rest === "m" ? "minor" : "major";
  return { pitchClass, mode };
}

/** Posición en la rueda Camelot. A Minor = 8A y C Major = 8B son los anclajes. */
export function camelotFor(key: ParsedKey): CamelotCode {
  const anchorPitchClass = key.mode === "minor" ? 9 : 0; // A minor / C major
  const stepsOfFifths = mod12((key.pitchClass - anchorPitchClass) * 7);
  return {
    number: mod12(7 + stepsOfFifths) + 1,
    letter: key.mode === "minor" ? "A" : "B",
  };
}

/** "A Minor" → "8A". Para mostrar en la ficha del sample. */
export function camelotLabel(raw: string | null | undefined): string | null {
  const parsed = parseSampleKey(raw);
  if (!parsed) return null;
  const code = camelotFor(parsed);
  return `${code.number}${code.letter}`;
}

/**
 * ¿Se pueden mezclar sin que choquen?
 *
 * Es DELIBERADAMENTE permisivo en los casos de duda: si el proyecto no
 * tiene tonalidad definida, o el sample no la tiene (percusión, FX),
 * devuelve `true`. Un filtro que esconde samples usables es mucho peor
 * que uno que deja pasar alguno de más — el usuario escucha y decide.
 */
export function keysAreCompatible(
  projectKey: string | null | undefined,
  sampleKey: string | null | undefined,
): boolean {
  const project = parseSampleKey(projectKey);
  const sample = parseSampleKey(sampleKey);
  if (!project || !sample) return true;

  const a = camelotFor(project);
  const b = camelotFor(sample);
  if (a.number === b.number) return true; // mismo número: relativa mayor/menor (o idéntica)
  if (a.letter !== b.letter) return false;

  const distance = Math.abs(a.number - b.number);
  return distance === 1 || distance === 11; // vecinos en la rueda (12 y 1 son vecinos)
}

/** Orden de búsqueda: 0, −1, +1, −2, +2… hasta media octava. Al recorrerlo en orden, el primero que sirve es SIEMPRE el desplazamiento más chico. */
const SHIFT_SEARCH_ORDER = [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6];

/**
 * Cuántos semitonos conviene mover el sample para que entre en el
 * proyecto. 0 = no hay que tocarlo.
 *
 * ─── La decisión importante: NO transponer lo que ya entra ───────────
 *
 * Lo que hacen Splice y compañía es llevar todo al tónico exacto del
 * proyecto. Suena razonable y es lo que estaba escrito acá primero,
 * hasta que se vio en pantalla: un loop en E Minor dentro de un
 * proyecto en A Minor pedía +5 semitonos. Pero E Minor es la quinta de
 * A Minor — entra perfecto tal cual. Transponerlo 5 semitonos le
 * cambia el cuerpo al instrumento y mete artefactos del motor, a
 * cambio de nada.
 *
 * Así que la regla es: si ya es compatible, no se toca. Y si no lo es,
 * se busca el desplazamiento MÁS CHICO que lo vuelva compatible — no
 * el que lo lleve al tónico. Para un sample en Eb Major dentro de un
 * proyecto en A Minor eso son 3 semitonos abajo (queda en C Major, la
 * relativa) en vez de los 5 que costaría clavarlo en A.
 *
 * Nunca pasa de media octava: más que eso deja de sonar al instrumento
 * que era, y del otro lado del círculo siempre hay una opción más
 * cerca.
 */
export function transposeSemitonesFor(
  projectKey: string | null | undefined,
  sampleKey: string | null | undefined,
): number {
  const project = parseSampleKey(projectKey);
  const sample = parseSampleKey(sampleKey);
  if (!project || !sample) return 0;

  for (const shift of SHIFT_SEARCH_ORDER) {
    const shifted: ParsedKey = {
      pitchClass: mod12(sample.pitchClass + shift),
      mode: sample.mode, // transponer no cambia el modo: un menor sigue siendo menor
    };
    const a = camelotFor(project);
    const b = camelotFor(shifted);
    const distance = Math.abs(a.number - b.number);
    const fits =
      a.number === b.number || (a.letter === b.letter && (distance === 1 || distance === 11));
    if (fits) return shift;
  }

  // Inalcanzable con las 24 tonalidades reales (siempre hay una casilla
  // compatible a menos de media octava), pero devolver 0 es la
  // respuesta segura: no tocar nada.
  return 0;
}

/**
 * Qué tan lejos está el tempo del sample del tempo del proyecto, en BPM.
 * `null` = el sample no tiene tempo (One-Shot, percusión suelta) y por
 * lo tanto entra en cualquier proyecto: no es "lejos", es "no aplica".
 *
 * Cuenta también el MEDIO y el DOBLE del tempo, porque musicalmente son
 * el mismo pulso: un loop de 70 BPM cae perfecto en un proyecto de 140,
 * un compás suyo por cada dos del proyecto. Sin esto, todo el material
 * de medio tiempo quedaría hundido al final de la lista justo en los
 * proyectos donde mejor funciona.
 *
 * Ojo: esto es la AFINIDAD MUSICAL, no lo que va a hacer el motor.
 * `playbackRateFor` estira sin plegar octavas, así que ese loop de 70
 * en un proyecto de 140 se va a estirar ×2 igual — por eso la ficha
 * muestra aparte el factor real (ver stretchRatioFor).
 */
export function tempoDistance(
  sampleBpm: number,
  projectBpm: number | null | undefined,
): number | null {
  if (!(sampleBpm > 0) || !(projectBpm && projectBpm > 0)) return null;
  return Math.min(
    Math.abs(sampleBpm - projectBpm),
    Math.abs(sampleBpm * 2 - projectBpm),
    Math.abs(sampleBpm / 2 - projectBpm),
  );
}

/** Factor REAL que le va a aplicar el motor (espejo de playbackRateFor del Arranger). `null` = no se estira. */
export function stretchRatioFor(
  sampleBpm: number,
  projectBpm: number | null | undefined,
  sampleType: string,
): number | null {
  if (sampleType !== "Loop") return null; // los One-Shot suenan siempre tal cual
  if (!(sampleBpm > 0) || !(projectBpm && projectBpm > 0)) return null;
  return projectBpm / sampleBpm;
}

// Más allá de estos factores el time-stretch empieza a notarse aunque
// el algoritmo sea bueno (signalsmith maneja transientes mucho mejor
// que WSOLA, pero no hace magia). Son los umbrales que usa la ficha
// para avisar ANTES de que el usuario suelte el clip y se lleve la
// sorpresa.
const STRETCH_WARN_LOW = 0.7;
const STRETCH_WARN_HIGH = 1.45;

export function isExtremeStretch(ratio: number | null): boolean {
  if (ratio === null) return false;
  return ratio < STRETCH_WARN_LOW || ratio > STRETCH_WARN_HIGH;
}

export interface AffinityScore {
  /** Menor = mejor. Es solo para ORDENAR: el número en sí no significa nada para el usuario. */
  rank: number;
  keyFits: boolean;
  tempoDelta: number | null;
  semitones: number;
  stretchRatio: number | null;
}

/**
 * Puntaje único para ordenar el catálogo por "qué tanto entra esto en
 * mi proyecto". El orden de los términos ES la decisión de diseño:
 *
 *   1. La tonalidad manda (penalización grande). Un sample en una
 *      tonalidad que pelea no se arregla con nada; uno con el tempo
 *      lejos se estira.
 *   2. Después la distancia de tempo, en BPM.
 *   3. Los samples SIN tempo (One-Shots) quedan en el medio, no al
 *      final: son utilizables siempre, pero quien ordena por afinidad
 *      casi siempre está buscando un loop que encaje.
 */
export function affinityFor(
  sample: { bpm: number; key: string; type: string },
  projectBpm: number | null,
  projectKey: string | null,
): AffinityScore {
  const keyFits = keysAreCompatible(projectKey, sample.key);
  const tempoDelta = tempoDistance(sample.bpm, projectBpm);
  const NEUTRAL_TEMPO_PENALTY = 12; // los sin tempo, a mitad de tabla
  return {
    rank: (keyFits ? 0 : 1000) + (tempoDelta ?? NEUTRAL_TEMPO_PENALTY),
    keyFits,
    tempoDelta,
    semitones: transposeSemitonesFor(projectKey, sample.key),
    stretchRatio: stretchRatioFor(sample.bpm, projectBpm, sample.type),
  };
}

// ─── Cómo va a sonar la pre-escucha ──────────────────────────────────

export interface PreviewSpec {
  sampleId: string;
  audioPath: string;
  /** "Loop" | "One-Shot" — los One-Shot no se estiran ni se repiten. */
  sampleType: string;
  originalBpm: number;
  sampleKey: string;
}

export interface PreviewOptions {
  /** false = sonar tal cual se subió (sin estirar, sin transponer). */
  matchProject: boolean;
  projectBpm: number | null;
  projectKey: string | null;
}

/**
 * El rate y los semitonos con los que va a sonar este sample.
 *
 * Vive acá, y no en samplePreview.ts, por dos motivos: es la MISMA
 * cuenta que ya hace stretchRatioFor, y la ficha del sample necesita
 * mostrar el resultado ("×1.33", "−2 st") ANTES de que el usuario
 * toque nada. Si la UI la calculara por su cuenta, tarde o temprano
 * anunciaría algo distinto de lo que después se escucha.
 */
export function resolvePreviewTransform(
  spec: PreviewSpec,
  options: PreviewOptions,
): { rate: number; semitones: number } {
  if (!options.matchProject) return { rate: 1, semitones: 0 };
  return {
    rate: stretchRatioFor(spec.originalBpm, options.projectBpm, spec.sampleType) ?? 1,
    semitones: transposeSemitonesFor(options.projectKey, spec.sampleKey),
  };
}
