// src/lib/arrangerSelection.ts
//
// Selección de VARIOS clips a la vez, y qué significa copiar y pegar un
// bloque en vez de un clip suelto.
//
// El trabajo con loops es repetitivo por naturaleza: se arma un
// estribillo de cuatro compases y se repite. Hasta acá todo era de a
// uno —mover, borrar, duplicar— así que repetir ocho clips eran ocho
// gestos, cada uno con su propio riesgo de desalinearse.
//
// Todo lo de este archivo es puro a propósito: el arrastre de goma
// (marquee) y el pegado son justo las cosas que "se sienten" y por eso
// nadie prueba, hasta que alguien toca el zoom o pega en la pista
// equivocada.

export interface SelectableClip {
  id: string;
  startSeconds: number;
  /** Cuánto ocupa EN PANTALLA, con el tempo del proyecto ya aplicado. */
  displayDuration: number;
}

export interface SelectableTrack {
  id: string;
  clips: readonly SelectableClip[];
}

/**
 * Ctrl/Cmd+click o Shift+click sobre un clip: entra si no estaba, sale
 * si estaba. Se conserva el ORDEN de selección —no el del arreglo—
 * porque el primero que se eligió es el ancla del pegado, y eso tiene
 * que ser lo que la persona tocó primero, no lo que quede más a la
 * izquierda.
 */
export function toggleSelection(current: readonly string[], clipId: string): string[] {
  return current.includes(clipId)
    ? current.filter((id) => id !== clipId)
    : [...current, clipId];
}

/**
 * Qué clips toca el rectángulo de goma. Se toma TODA intersección, por
 * chica que sea: exigir que el clip entre entero obligaría a rodear
 * cosas que se salen de la pantalla, que es justo cuando más falta
 * hace seleccionar en bloque.
 *
 * Los índices de pista se dan ya ordenados o no — se normalizan acá,
 * porque el rectángulo se puede dibujar de abajo hacia arriba.
 */
export function clipsInRect(
  tracks: readonly SelectableTrack[],
  trackIndexA: number,
  trackIndexB: number,
  secondsA: number,
  secondsB: number,
): string[] {
  const fromTrack = Math.min(trackIndexA, trackIndexB);
  const toTrack = Math.max(trackIndexA, trackIndexB);
  const fromSeconds = Math.min(secondsA, secondsB);
  const toSeconds = Math.max(secondsA, secondsB);

  const selected: string[] = [];
  for (let i = fromTrack; i <= toTrack; i++) {
    const track = tracks[i];
    if (!track) continue;
    for (const clip of track.clips) {
      const clipEnd = clip.startSeconds + clip.displayDuration;
      if (clipEnd > fromSeconds && clip.startSeconds < toSeconds) selected.push(clip.id);
    }
  }
  return selected;
}

/**
 * De dónde a dónde llega la selección en la línea de tiempo. Es lo que
 * define cuánto corre una duplicación: duplicar un bloque de cuatro
 * compases tiene que dejar la copia JUSTO después del bloque, no
 * desplazada por la duración de un clip cualquiera de adentro.
 */
export function selectionSpan(clips: readonly SelectableClip[]): { startSeconds: number; endSeconds: number } | null {
  if (clips.length === 0) return null;
  let start = Infinity;
  let end = -Infinity;
  for (const clip of clips) {
    if (clip.startSeconds < start) start = clip.startSeconds;
    const clipEnd = clip.startSeconds + clip.displayDuration;
    if (clipEnd > end) end = clipEnd;
  }
  return { startSeconds: start, endSeconds: end };
}

export interface ClipPlacement<T> {
  clip: T;
  trackIndex: number;
  startSeconds: number;
}

export interface ClipboardEntry<T> {
  clip: T;
  /** Pistas por debajo de la más alta de la copia. 0 = la de arriba. */
  trackOffset: number;
  /** Segundos después del clip más temprano de la copia. */
  timeOffset: number;
}

/**
 * Copiar guarda posiciones RELATIVAS, nunca absolutas: lo que define a
 * un bloque es cómo están puestos sus clips ENTRE SÍ. Guardar los
 * segundos tal cual haría que pegar en otro punto rearmara el bloque
 * desarmado.
 */
export function buildClipboard<T>(placements: readonly ClipPlacement<T>[]): ClipboardEntry<T>[] {
  if (placements.length === 0) return [];
  let minTrack = Infinity;
  let minStart = Infinity;
  for (const placement of placements) {
    if (placement.trackIndex < minTrack) minTrack = placement.trackIndex;
    if (placement.startSeconds < minStart) minStart = placement.startSeconds;
  }
  return placements.map((placement) => ({
    clip: placement.clip,
    trackOffset: placement.trackIndex - minTrack,
    timeOffset: placement.startSeconds - minStart,
  }));
}

/**
 * Dónde cae cada clip al pegar, con el bloque anclado en (pista, cursor).
 *
 * ⚠️ Un clip cuya pista de destino NO EXISTE se DESCARTA, no se apila
 * en la última. Aplastar dos pistas en una dejaría clips superpuestos
 * que suenan a la vez y hay que separar a mano — peor que no pegar ese
 * clip y decirlo. El caso normal (copiar varios clips de UNA pista)
 * tiene todos los offsets en 0 y nunca pierde nada.
 */
export function placeClipboard<T>(
  entries: readonly ClipboardEntry<T>[],
  anchorTrackIndex: number,
  anchorSeconds: number,
  trackCount: number,
): { placed: ClipPlacement<T>[]; droppedCount: number } {
  const placed: ClipPlacement<T>[] = [];
  let droppedCount = 0;
  for (const entry of entries) {
    const trackIndex = anchorTrackIndex + entry.trackOffset;
    if (trackIndex < 0 || trackIndex >= trackCount) {
      droppedCount++;
      continue;
    }
    placed.push({
      clip: entry.clip,
      trackIndex,
      startSeconds: Math.max(0, anchorSeconds + entry.timeOffset),
    });
  }
  return { placed, droppedCount };
}
