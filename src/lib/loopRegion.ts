// src/lib/loopRegion.ts
//
// La región de loop: un tramo de la línea de tiempo que se repite solo.
//
// Es LA herramienta para armar una parte. Se deja ciclando el estribillo
// y se prueban samples encima con la pre-escucha sincronizada del
// Banco de Sonidos (ver sampleAffinity/barClock). Sin esto había que
// apretar Play y volver a buscar la posición en cada pasada, que es
// justo el gesto que rompe el hilo cuando uno está eligiendo sonidos.
//
// ⚠️ Esto es del ARRANGER WEB, que corre sobre Web Audio. El motor
// nativo de Android tiene su propio loop (`mystudio_set_loop_region` en
// native_engine.cpp) y son implementaciones independientes: no se
// comparte una sola línea de código entre las dos puntas.

export interface LoopRegion {
  startSeconds: number;
  endSeconds: number;
}

/**
 * Un loop más corto que esto es casi siempre un click accidental en la
 * regla, no una intención. Media negra a 120 BPM son 0,25 s.
 */
export const MIN_LOOP_LENGTH_SECONDS = 0.2;

/**
 * Arma la región a partir de los dos puntos que se arrastraron en la
 * regla, con los DOS extremos pegados a la grilla.
 *
 * Pegar es obligatorio, no una comodidad: un loop que no cae en la
 * grilla se va desfasando del pulso en cada vuelta, y a las pocas
 * pasadas el arreglo entero suena corrido. Con la grilla en "Libre"
 * (gridSeconds = 0) se respeta lo que se arrastró — quien la apagó lo
 * hizo a propósito.
 *
 * Devuelve null si quedó demasiado corta, que es lo que pasa con un
 * click simple: ahí la regla tiene que seguir haciendo lo de siempre
 * (mover el cursor), no dejar un loop de duración cero.
 */
export function normalizeLoopRegion(
  secondsA: number,
  secondsB: number,
  gridSeconds: number,
): LoopRegion | null {
  const snap = (value: number) =>
    gridSeconds > 0 ? Math.round(value / gridSeconds) * gridSeconds : value;

  const start = Math.max(0, snap(Math.min(secondsA, secondsB)));
  let end = Math.max(0, snap(Math.max(secondsA, secondsB)));

  // Con la grilla gruesa (un compás) los dos extremos pueden caer en la
  // MISMA línea aunque se haya arrastrado un tramo visible. Redondear
  // los dos hacia la misma línea y devolver null se sentiría como que
  // el gesto no hizo nada; estirar hasta la línea siguiente es lo que
  // la persona quiso decir.
  if (gridSeconds > 0 && end - start < gridSeconds / 2) {
    end = start + gridSeconds;
  }

  if (end - start < MIN_LOOP_LENGTH_SECONDS) return null;
  return { startSeconds: start, endSeconds: end };
}

/**
 * Desde dónde arranca realmente la reproducción.
 *
 * Con el cursor ANTES del loop se reproduce normal y se entra al loop
 * al llegar: así se escucha la entrada de la parte en contexto, que es
 * la mitad del motivo para tener un loop. Con el cursor DESPUÉS del
 * loop no habría forma de entrar nunca, así que se salta al principio
 * del tramo.
 */
export function playbackStartFor(
  requestedSeconds: number,
  region: LoopRegion | null,
  loopEnabled: boolean,
): number {
  if (!loopEnabled || !region) return requestedSeconds;
  if (requestedSeconds >= region.endSeconds) return region.startSeconds;
  return requestedSeconds;
}

/**
 * En qué instante de la línea de tiempo termina el ciclo que arranca en
 * `fromSeconds`, o null si no hay nada que ciclar.
 *
 * null cuando el cursor ya pasó el final del tramo: eso ocurre cuando
 * el loop se apagó a mitad de camino, y ahí la reproducción tiene que
 * seguir de largo, no cortarse en un punto que ya no significa nada.
 */
export function cycleEndFor(
  fromSeconds: number,
  region: LoopRegion | null,
  loopEnabled: boolean,
): number | null {
  if (!loopEnabled || !region) return null;
  if (fromSeconds >= region.endSeconds) return null;
  return region.endSeconds;
}
