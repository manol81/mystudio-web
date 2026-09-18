// src/lib/arrangerTypes.ts
//
// Las dos formas centrales del Arranger, sacadas de la página para que
// también las pueda usar el borrador (arrangerDraft.ts) sin importar un
// archivo de 2800 líneas ni convertir la página en un módulo del que
// otros dependen.

import type { TrackFx } from "@/lib/trackEffects";

export interface ArrangerClip {
  id: string;
  sampleId: string;
  sampleName: string;

  /// Ruta del audio en Storage, la MISMA que se le pasa a
  /// `loadAndCacheBuffer`. Viaja en el clip porque es lo único que
  /// permite recuperar el sonido después de recargar la página: el
  /// AudioBuffer vive en memoria y no se puede serializar, así que sin
  /// esta ruta un borrador restaurado sería un arreglo mudo.
  ///
  /// Vacía para el audio que NO vino del Banco de Sonidos (un archivo
  /// subido desde la computadora, o un clip reconstruido al abrir un
  /// .mystudio): esos bytes nunca estuvieron en Storage, así que no hay
  /// de dónde volver a bajarlos. Ver la nota de arrangerDraft.ts sobre
  /// qué sobrevive a una recarga y qué no.
  audioPath: string;

  originalBpm: number;
  /**
   * La tonalidad de ESTE clip, en el formato de SAMPLE_KEYS ("A Minor").
   * Vacía = desconocida.
   *
   * Existe para poder RESPONDER "¿este audio está en el tono del
   * proyecto?" mirando el clip. Antes el dato existía —el Banco de
   * Sonidos lo trae en la ficha del sample— pero se usaba una sola vez,
   * al soltarlo, para calcular la transposición, y se tiraba: el clip
   * ya puesto no sabía de qué tono era y no había dónde verlo. Para un
   * archivo subido desde la computadora directamente no existía.
   */
  sampleKey: string;
  /** "Loop" | "One-Shot" (ver sampleTaxonomy.ts) — determina si este clip se adapta al tempo del proyecto (ver playbackRateFor). */
  sampleType: string;
  startSeconds: number;
  /** Offset DENTRO de `buffer` (segundos, base de tiempo nativa del buffer) donde arranca lo que suena. */
  sourceOffsetSeconds: number;
  /** Cuánto de `buffer`, desde sourceOffsetSeconds, suena — base de tiempo nativa (no la toca el tempo). */
  sourceDurationSeconds: number;
  /**
   * Cuántas veces se repite esa ventana, arrastrando el borde derecho.
   * 1 = suena una sola vez (el default de siempre). Admite fracciones:
   * 2,5 son dos pasadas enteras y media, cortada.
   *
   * ⚠️ Es un MULTIPLICADOR, no una duración en segundos, y eso importa:
   * un loop de 4 compases repetido 3 veces tiene que seguir durando 12
   * compases aunque se cambie el tempo del proyecto. Con una duración
   * absoluta guardada acá, subir el BPM dejaría repeticiones cortadas
   * por la mitad.
   */
  repeats: number;
  /** Volumen propio del clip (1 = sin cambio), independiente del volumen de la pista. */
  gain: number;
  /** Fade-in/out en segundos de LÍNEA DE TIEMPO (ya con el tempo aplicado) — arrastrables desde las esquinas superiores del clip. */
  fadeInSeconds: number;
  fadeOutSeconds: number;
  /**
   * Pitch-shift en semitonos enteros, -12 a +12 (0 = tono original).
   * Independiente del tempo aunque se resuelvan en la MISMA pasada de
   * DSP (ver getProcessedBuffer/audioDsp.ts) — son parámetros
   * separados de la misma llamada, cambiar uno no altera el otro.
   * Motor: signalsmith-stretch (WASM + AudioWorklet, MIT — ver la nota
   * larga en audioDsp.ts sobre por qué no se usó un port de Rubber Band).
   */
  pitchShift: number;
  buffer: AudioBuffer;
  /** Picos sobre el buffer COMPLETO — se recorta la porción visible al dibujar (ver slicePeaksForWindow). */
  peaks: Float32Array;
}

export interface ArrangerTrack {
  id: string;
  name: string;
  volume: number;
  pan: number;
  isMuted: boolean;
  isSolo: boolean;
  clips: ArrangerClip[];
  color: string;
  // Efectos por pista de la app (EQ, compresor, envío a reverb). El
  // Arranger NO los edita ni los reproduce — los transporta tal cual
  // para que un round-trip app → Arranger → app no los pierda. Sin
  // esto, editar un arreglo en la web borraba silenciosamente el
  // trabajo de mezcla hecho en el teléfono.
  fx: TrackFx;
}
