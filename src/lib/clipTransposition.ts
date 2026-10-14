// Cambiar de tono un clip pensando en ACORDES, no en semitonos
// (2026-10-14). Pedido: "hacer una canción con todos sus cambios de
// acordes con un mismo sample, al que simplemente fui cambiando de
// tonalidad" — un loop en C maj, dos compases en F maj, dos en G maj.
//
// Hasta acá se podía, pero había que traducir a mano: el control
// "Pitch" pedía semitonos (F es +5, G es +7… o −5) y el control "Tono"
// cambiaba la tonalidad DECLARADA del sample —en qué tono está
// grabado—, no en cuál suena. Acá están las dos preguntas que se hace
// un músico, con la cuenta adentro:
//
//  · "¿Que suene en F maj?"  → shiftToSoundIn
//  · "¿Qué acordes del tema puede tocar este sample?" → chordsForSample
//
// Transponer NO cambia el modo: un sample mayor sigue sonando mayor en
// cualquier tono. Por eso los acordes que se ofrecen son los del tema
// con la MISMA calidad que el sample (con un loop mayor en C maj: I, IV
// y V; con uno menor: ii, iii y vi). Ofrecer el vi con un sample mayor
// daría A MAYOR, que no es el vi del tema: sonaría a error.

import { parseSampleKey, type KeyMode } from "@/lib/sampleAffinity";

const ROOT_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];

function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

/** "F Major" — el nombre del catálogo (SAMPLE_KEYS) de una nota y un modo. */
export function keyName(pitchClass: number, mode: KeyMode): string {
  return `${ROOT_NAMES[mod12(pitchClass)]} ${mode === "minor" ? "Minor" : "Major"}`;
}

/**
 * Semitonos para que un clip grabado en [originalKey] SUENE con raíz en
 * [targetPitchClass]. Siempre el camino más corto, entre −6 y +5: subir
 * o bajar más de media octava cambia el cuerpo del instrumento y suma
 * artefactos, y del otro lado siempre hay una opción más cerca. En el
 * empate (6 semitonos) se BAJA: subir mucho suena a "ardilla" antes que
 * bajar lo mismo.
 *
 * null si la tonalidad original no se puede leer (percusión, vacío).
 */
export function shiftToSoundIn(
  originalKey: string | null | undefined,
  targetPitchClass: number,
): number | null {
  const original = parseSampleKey(originalKey);
  if (!original) return null;
  const up = mod12(targetPitchClass - original.pitchClass); // 0..11
  return up > 5 ? up - 12 : up; // 6 → −6
}

/** La tonalidad en la que SUENA un clip, como nombre del catálogo. */
export function soundingKeyOf(
  originalKey: string | null | undefined,
  pitchShift: number,
): string | null {
  const original = parseSampleKey(originalKey);
  if (!original) return null;
  return keyName(original.pitchClass + Math.round(pitchShift), original.mode);
}

export interface ChordOption {
  /** "IV", "vi", "VII" — mayúscula = mayor, minúscula = menor. */
  degree: string;
  pitchClass: number;
  mode: KeyMode;
  /** "F Major". */
  key: string;
}

// Grados de la escala con la calidad de su acorde (tríadas). El
// disminuido (vii° en mayor, ii° en menor) no está: ningún sample
// mayor o menor transpuesto suena disminuido.
const MAJOR_DEGREES: { degree: string; offset: number; mode: KeyMode }[] = [
  { degree: "I", offset: 0, mode: "major" },
  { degree: "ii", offset: 2, mode: "minor" },
  { degree: "iii", offset: 4, mode: "minor" },
  { degree: "IV", offset: 5, mode: "major" },
  { degree: "V", offset: 7, mode: "major" },
  { degree: "vi", offset: 9, mode: "minor" },
];
// Menor natural.
const MINOR_DEGREES: { degree: string; offset: number; mode: KeyMode }[] = [
  { degree: "i", offset: 0, mode: "minor" },
  { degree: "III", offset: 3, mode: "major" },
  { degree: "iv", offset: 5, mode: "minor" },
  { degree: "v", offset: 7, mode: "minor" },
  { degree: "VI", offset: 8, mode: "major" },
  { degree: "VII", offset: 10, mode: "major" },
];

/**
 * Los acordes de la tonalidad del TEMA que un sample de [sampleKey]
 * puede tocar transponiéndolo: los de su misma calidad. Vacío si falta
 * alguna de las dos tonalidades.
 */
export function chordsForSample(
  projectKey: string | null | undefined,
  sampleKey: string | null | undefined,
): ChordOption[] {
  const project = parseSampleKey(projectKey);
  const sample = parseSampleKey(sampleKey);
  if (!project || !sample) return [];
  const degrees = project.mode === "minor" ? MINOR_DEGREES : MAJOR_DEGREES;
  return degrees
    .filter((d) => d.mode === sample.mode)
    .map((d) => {
      const pitchClass = mod12(project.pitchClass + d.offset);
      return { degree: d.degree, pitchClass, mode: d.mode, key: keyName(pitchClass, d.mode) };
    });
}

/** Las 12 tonalidades a las que se puede llevar un sample (su mismo modo), con el desplazamiento de cada una. */
export function soundingKeyOptions(
  originalKey: string | null | undefined,
): { key: string; pitchClass: number; shift: number }[] {
  const original = parseSampleKey(originalKey);
  if (!original) return [];
  return Array.from({ length: 12 }, (_, pc) => ({
    key: keyName(pc, original.mode),
    pitchClass: pc,
    shift: shiftToSoundIn(originalKey, pc)!,
  }));
}

/**
 * Lo que dice el `pitchShift` de un clip del .mystudio, según quién lo
 * escribió:
 *
 *  · Hasta el formatVersion 4, el ÚNICO que escribía un valor distinto
 *    de 0 era este Arranger, y lo escribía DESPUÉS de hornear la
 *    transposición en el WAV (ver handleExport): era informativo. La
 *    app nunca transpone; solo lo guardaba y lo devolvía. Aplicarlo al
 *    importar transponía DOS VECES: el bug que hacía que una canción
 *    con cambios de acordes volviera de la nube desafinada.
 *  · Desde el formatVersion 5 significa "transponer al reproducir": el
 *    WAV viaja tal como se grabó.
 *
 * Devuelve los semitonos que hay que APLICAR al audio del ZIP.
 */
export function pitchToApplyFromManifest(
  formatVersion: number | undefined,
  pitchShift: number | undefined,
): number {
  if (!formatVersion || formatVersion < 5) return 0;
  return Number.isFinite(pitchShift) ? Math.round(pitchShift!) : 0;
}
