// src/lib/clipCrossfade.ts
//
// Qué fade tiene REALMENTE cada clip, una vez que se mira a sus vecinos
// de la misma pista.
//
// Resuelve dos cosas distintas que se ven parecidas:
//
//   · **Declick.** Un clip que arranca o termina en un punto cualquiera
//     de la onda produce un salto instantáneo de amplitud, y un salto
//     instantáneo es un CHASQUIDO. Pasa en cada junta entre dos clips
//     encadenados, que es donde más se nota porque es donde más se
//     repite. Se arregla con un fade cortísimo en cada borde duro.
//   · **Crossfade.** Si dos clips de la misma pista se SUPERPONEN, ese
//     solape se convierte en un cruce: el de atrás se va mientras el de
//     adelante entra. Es lo que hace que dos loops distintos se sientan
//     pegados en vez de contiguos.
//
// ⚠️ **El crossfade usa potencia constante y el declick no.** Al cruzar
// dos audios DISTINTOS, dos rampas lineales que se suman dan un pozo de
// −3 dB en el medio: se escucha como un bajón de volumen justo en la
// junta, que es lo contrario de lo que se buscaba. La curva de potencia
// constante (seno/coseno) mantiene la suma plana. El declick, en
// cambio, no cruza nada —no hay nada del otro lado— así que lineal es
// lo correcto y además es lo que hace el motor nativo.

export type FadeShape = "linear" | "equalPower";

/**
 * Largo del fade que se pone solo en cada borde duro.
 *
 * 2 ms = 88 muestras a 44,1 kHz. El número sale de una tensión real:
 * tiene que ser lo bastante largo para que el salto de amplitud deje de
 * ser instantáneo, y lo bastante CORTO para no comerse el ataque de un
 * golpe. El ataque de un bombo vive entre los 5 y los 20 ms; con 10 ms
 * de fade el golpe pierde pegada de una forma que se nota enseguida y
 * que nadie relacionaría con esta línea de código.
 */
export const EDGE_DECLICK_SECONDS = 0.002;

export interface CrossfadeClip {
  id: string;
  startSeconds: number;
  /** Cuánto ocupa EN LA LÍNEA DE TIEMPO, con el tempo ya aplicado. */
  displayDuration: number;
  /** Lo que la persona puso a mano arrastrando la esquina del clip. */
  fadeInSeconds: number;
  fadeOutSeconds: number;
}

export interface ResolvedFades {
  fadeInSeconds: number;
  fadeOutSeconds: number;
  fadeInShape: FadeShape;
  fadeOutShape: FadeShape;
  /** Ese borde cruza con un vecino: se dibuja distinto y no es solo un declick. */
  crossfadeIn: boolean;
  crossfadeOut: boolean;
}

function byStart(a: CrossfadeClip, b: CrossfadeClip) {
  return a.startSeconds - b.startSeconds;
}

/**
 * El fade efectivo de cada clip de UNA pista.
 *
 * El fade que puso la persona a mano siempre GANA si es más largo: si
 * alguien dibujó una entrada de dos segundos, un solape de medio
 * segundo no tiene por qué acortársela.
 */
export function resolveTrackFades(clips: readonly CrossfadeClip[]): Map<string, ResolvedFades> {
  const sorted = [...clips].sort(byStart);
  const resolved = new Map<string, ResolvedFades>();
  for (const clip of sorted) {
    resolved.set(clip.id, {
      fadeInSeconds: Math.max(0, clip.fadeInSeconds),
      fadeOutSeconds: Math.max(0, clip.fadeOutSeconds),
      fadeInShape: "linear",
      fadeOutShape: "linear",
      crossfadeIn: false,
      crossfadeOut: false,
    });
  }

  // Solo se cruzan clips CONSECUTIVOS. Tres clips apilados en el mismo
  // punto son un accidente, no una intención musical, y tratar de
  // cruzarlos todos contra todos daría una envolvente que nadie puede
  // predecir mirando la pantalla.
  for (let i = 0; i < sorted.length - 1; i++) {
    const left = sorted[i];
    const right = sorted[i + 1];
    const leftEnd = left.startSeconds + left.displayDuration;
    const rawOverlap = leftEnd - right.startSeconds;
    if (rawOverlap <= 0) continue;

    // Nunca más largo que el más corto de los dos: un cruce no puede
    // durar más que el clip que se está yendo.
    const overlap = Math.min(rawOverlap, left.displayDuration, right.displayDuration);
    if (overlap <= 0) continue;

    const leftFades = resolved.get(left.id)!;
    const rightFades = resolved.get(right.id)!;
    leftFades.fadeOutSeconds = Math.max(leftFades.fadeOutSeconds, overlap);
    leftFades.fadeOutShape = "equalPower";
    leftFades.crossfadeOut = true;
    rightFades.fadeInSeconds = Math.max(rightFades.fadeInSeconds, overlap);
    rightFades.fadeInShape = "equalPower";
    rightFades.crossfadeIn = true;
  }

  // Declick al final, sobre lo que haya quedado en cero. Un borde que
  // ya tiene fade —propio o de un cruce— no lo necesita.
  for (const clip of sorted) {
    const fades = resolved.get(clip.id)!;
    const maxDeclick = Math.min(EDGE_DECLICK_SECONDS, clip.displayDuration / 2);
    if (fades.fadeInSeconds <= 0) fades.fadeInSeconds = maxDeclick;
    if (fades.fadeOutSeconds <= 0) fades.fadeOutSeconds = maxDeclick;
  }

  return resolved;
}

/**
 * Los clips agrupados en CADENAS: cada cadena es un conjunto que se
 * toca entre sí por solape, y los que no se solapan con nadie quedan
 * solos en su propia cadena de un elemento.
 *
 * ⚠️ Esto existe por el motor nativo de Android, no por la web. En
 * `renderBlock` (native_engine.cpp) la mezcla de una pista toma el
 * PRIMER clip que cubre cada frame y corta —hay un `break`— porque el
 * motor da por sentado que los clips de una pista nunca se superponen.
 * Un .mystudio con clips solapados no sonaría cruzado en el teléfono:
 * sonaría con un AGUJERO, porque el que gana es el que se está yendo a
 * silencio. Por eso el exportador aplana cada cadena a un solo WAV con
 * el cruce ya horneado, en vez de mandar los clips por separado.
 *
 * Devuelve las cadenas ordenadas por tiempo, y cada una ordenada por
 * tiempo adentro.
 */
export function overlapChains<T extends CrossfadeClip>(clips: readonly T[]): T[][] {
  const sorted = [...clips].sort(byStart);
  const chains: T[][] = [];
  let current: T[] = [];
  let currentEnd = -Infinity;

  for (const clip of sorted) {
    if (current.length > 0 && clip.startSeconds < currentEnd) {
      current.push(clip);
      currentEnd = Math.max(currentEnd, clip.startSeconds + clip.displayDuration);
      continue;
    }
    if (current.length > 0) chains.push(current);
    current = [clip];
    currentEnd = clip.startSeconds + clip.displayDuration;
  }
  if (current.length > 0) chains.push(current);
  return chains;
}
