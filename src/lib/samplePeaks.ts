// src/lib/samplePeaks.ts
//
// Formas de onda del Banco de Sonidos: el cálculo de picos (que hasta
// ahora vivía suelto adentro de arranger/page.tsx, usado solo por los
// clips ya colocados) más la logística de conseguirlos para un sample
// que todavía no se tocó nunca.
//
// ─── El problema que resuelve la cola ─────────────────────────────────
//
// Dibujar la onda de una tarjeta exige el audio decodificado, y eso son
// unos cuantos MB por sample. Con el catálogo entero en pantalla,
// pedirlos todos de golpe al montar la lista significaría decenas de
// descargas en paralelo: la pestaña se traba, y en Blaze cada byte que
// sale de Storage se factura. Así que:
//
//   · Se piden SOLO los samples que están visibles de verdad
//     (IntersectionObserver del lado del componente).
//   · De a dos a la vez como mucho (MAX_CONCURRENT), en cola.
//   · Si el sample ya se pre-escuchó o se arrastró alguna vez, su
//     AudioBuffer ya está en sampleBufferCache y los picos salen de ahí
//     SIN tocar la red.
//
// ⚠️ Esto escala hasta un catálogo de unos cientos. Pasado ese punto la
// solución correcta es otra: calcular los picos AL SUBIR el sample
// (panel de admin y scripts/samples.mjs) y guardarlos en el documento
// de Firestore, para que la tarjeta no tenga que bajar el audio nunca.
// Cuando ese campo exista, este módulo sigue sirviendo como camino de
// respaldo para los samples viejos que no lo tengan.

import { getCachedBuffer, loadAndCacheBuffer } from "./sampleBufferCache";

/** Cuántas barras dibuja la onda de una tarjeta del catálogo. */
export const CARD_PEAK_BUCKETS = 96;

/**
 * Min/max por bucket sobre el canal izquierdo, intercalados
 * ([min0, max0, min1, max1, …]). Solo el canal 0 a propósito: es una
 * miniatura para decidir de un vistazo, no una herramienta de análisis
 * — y recorrer los dos canales duplicaría el trabajo para una
 * diferencia visual imperceptible a este tamaño.
 */
export function computePeaks(buffer: AudioBuffer, numBuckets: number): Float32Array {
  const data = buffer.getChannelData(0);
  const samplesPerBucket = Math.max(1, Math.floor(data.length / numBuckets));
  const peaks = new Float32Array(numBuckets * 2);
  for (let i = 0; i < numBuckets; i++) {
    const start = i * samplesPerBucket;
    const end = Math.min(data.length, start + samplesPerBucket);
    let min = 0;
    let max = 0;
    for (let j = start; j < end; j++) {
      const v = data[j];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    peaks[i * 2] = min;
    peaks[i * 2 + 1] = max;
  }
  return peaks;
}

const peaksCache = new Map<string, Float32Array>();
const pendingPeaks = new Map<string, Promise<Float32Array | null>>();

const MAX_CONCURRENT = 2;
let activeLoads = 0;
const waiting: (() => void)[] = [];

function acquireSlot(): Promise<void> {
  if (activeLoads < MAX_CONCURRENT) {
    activeLoads++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiting.push(() => {
      activeLoads++;
      resolve();
    });
  });
}

function releaseSlot(): void {
  activeLoads--;
  const next = waiting.shift();
  if (next) next();
}

function cacheKeyFor(sampleId: string, buckets: number): string {
  return `${sampleId}::${buckets}`;
}

/** Los picos que YA tenemos, sin disparar nada. `undefined` = todavía no. */
export function getCachedPeaks(sampleId: string, buckets = CARD_PEAK_BUCKETS): Float32Array | undefined {
  const cached = peaksCache.get(cacheKeyFor(sampleId, buckets));
  if (cached) return cached;

  // El audio puede estar en la caché global aunque nadie haya pedido
  // los picos: pasa con cualquier sample que ya se pre-escuchó o se
  // arrastró. Calcularlos es un recorrido en memoria, sin red.
  const buffer = getCachedBuffer(sampleId);
  if (!buffer) return undefined;
  const peaks = computePeaks(buffer, buckets);
  peaksCache.set(cacheKeyFor(sampleId, buckets), peaks);
  return peaks;
}

/**
 * Consigue los picos, bajando el audio si hace falta (respetando la
 * cola). Devuelve `null` si no se pudo — una tarjeta sin forma de onda
 * es un detalle estético, nunca un error que valga interrumpir al
 * usuario con un cartel.
 */
export function requestPeaks(
  sampleId: string,
  audioPath: string,
  buckets = CARD_PEAK_BUCKETS,
): Promise<Float32Array | null> {
  const key = cacheKeyFor(sampleId, buckets);
  const ready = getCachedPeaks(sampleId, buckets);
  if (ready) return Promise.resolve(ready);

  const inFlight = pendingPeaks.get(key);
  if (inFlight) return inFlight;

  if (!audioPath) return Promise.resolve(null); // audio local: sus bytes nunca estuvieron en Storage

  const promise = (async () => {
    await acquireSlot();
    try {
      const buffer = await loadAndCacheBuffer(sampleId, audioPath);
      const peaks = computePeaks(buffer, buckets);
      peaksCache.set(key, peaks);
      return peaks;
    } catch {
      return null;
    } finally {
      releaseSlot();
    }
  })();

  pendingPeaks.set(key, promise);
  void promise.finally(() => pendingPeaks.delete(key));
  return promise;
}
