// src/lib/arrangerSnap.ts
//
// El "imán" al arrastrar un clip: a qué posición se pega, y qué línea
// guía mostrar mientras tanto.
//
// Son DOS imanes conviviendo, y la distinción importa:
//
//   · **Clip contra clip** — pegarse al borde de otro clip (encadenar
//     un loop atrás del anterior, alinear dos entradas). Está desde
//     siempre y no se apaga: no depende de ninguna grilla.
//   · **Grilla musical** — pegarse al compás o a la subdivisión
//     elegida. Es lo que faltaba, y su ausencia hacía IMPOSIBLE poner
//     un clip "en el compás 5": caía en 4,97 y el arreglo se desfasaba
//     solo. La matemática de compases ya existía para dibujar la regla
//     de tiempo (barClock.ts), pero el imán no la conocía.
//
// ─── Por qué todo se mide en PÍXELES y no en segundos ─────────────────
//
// El radio del imán tiene que sentirse igual con cualquier zoom. Medido
// en segundos, alejarse haría que el clip se pegue a cosas que en
// pantalla están lejísimos, y acercarse lo volvería inútil.
//
// ─── Por qué la distancia se mide contra la posición CRUDA ────────────
//
// Siempre contra dónde está el mouse, nunca contra el último valor ya
// pegado. Así, seguir arrastrando más allá del radio lo suelta solo, y
// no hace falta ningún estado extra de "el imán ya se soltó".

export interface SnapNeighbour {
  /** Dónde empieza, en segundos de línea de tiempo. */
  startSeconds: number;
  /** Cuánto ocupa EN PANTALLA (ya con el tempo aplicado). */
  displayDuration: number;
}

export interface SnapRequest {
  /** Dónde caería el clip siguiendo al mouse, sin ajustar nada. */
  rawStartSeconds: number;
  displayDuration: number;
  pixelsPerSecond: number;
  /** Paso de la grilla en segundos. 0 = sin imán a la grilla. */
  gridSeconds: number;
  /** Los demás clips del arreglo (el que se arrastra ya viene excluido). */
  neighbours: readonly SnapNeighbour[];
  thresholdPx: number;
}

export interface SnapResult {
  startSeconds: number;
  /** Dónde dibujar la línea guía, o null si no se pegó a nada. */
  guideSeconds: number | null;
}

export function computeSnappedStart(request: SnapRequest): SnapResult {
  const { rawStartSeconds, displayDuration, pixelsPerSecond, gridSeconds, thresholdPx } = request;
  const rawStartPx = rawStartSeconds * pixelsPerSecond;
  const durationPx = displayDuration * pixelsPerSecond;

  // El cero siempre es candidato: el principio del tema es la
  // referencia más fuerte que hay.
  const candidates: { startPx: number; guidePx: number }[] = [{ startPx: 0, guidePx: 0 }];

  if (gridSeconds > 0) {
    // Dos candidatos: que el clip EMPIECE en una línea, y que TERMINE
    // en una. El segundo es lo que permite que algo desemboque exacto
    // en el compás siguiente, que es la mitad de para qué sirve tener
    // una grilla.
    const nearestStart = Math.round(rawStartSeconds / gridSeconds) * gridSeconds;
    candidates.push({
      startPx: nearestStart * pixelsPerSecond,
      guidePx: nearestStart * pixelsPerSecond,
    });
    const nearestEnd = Math.round((rawStartSeconds + displayDuration) / gridSeconds) * gridSeconds;
    candidates.push({
      startPx: (nearestEnd - displayDuration) * pixelsPerSecond,
      guidePx: nearestEnd * pixelsPerSecond,
    });
  }

  for (const other of request.neighbours) {
    const otherStartPx = other.startSeconds * pixelsPerSecond;
    const otherEndPx = otherStartPx + other.displayDuration * pixelsPerSecond;
    candidates.push({ startPx: otherEndPx, guidePx: otherEndPx }); // mi inicio, pegado al final del otro
    candidates.push({ startPx: otherStartPx - durationPx, guidePx: otherStartPx }); // mi final, pegado al inicio del otro
    candidates.push({ startPx: otherStartPx, guidePx: otherStartPx }); // alinear inicios
    candidates.push({ startPx: otherEndPx - durationPx, guidePx: otherEndPx }); // alinear finales
  }

  let bestStartPx = rawStartPx;
  let bestGuidePx: number | null = null;
  let bestDistancePx = Infinity;
  for (const candidate of candidates) {
    // Un candidato que empujaría el clip antes del cero no es una
    // posición válida: la línea de tiempo no tiene tiempos negativos.
    if (candidate.startPx < 0) continue;
    const distancePx = Math.abs(candidate.startPx - rawStartPx);
    // En un EMPATE gana el candidato que se agregó primero, y por eso
    // el orden de arriba es el orden de prioridad: cero, inicio en la
    // grilla, final en la grilla, vecinos. Pasa seguido — un clip que
    // dura un número redondo de compases empieza Y termina sobre la
    // grilla a la vez, y las dos dan la misma posición. Lo único que
    // cambia es dónde se dibuja la línea guía, y ahí es más útil
    // marcar el borde que la persona está arrastrando.
    if (distancePx <= thresholdPx && distancePx < bestDistancePx) {
      bestDistancePx = distancePx;
      bestStartPx = candidate.startPx;
      bestGuidePx = candidate.guidePx;
    }
  }

  return {
    startSeconds: Math.max(0, bestStartPx / pixelsPerSecond),
    guideSeconds: bestGuidePx == null ? null : bestGuidePx / pixelsPerSecond,
  };
}
