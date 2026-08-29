// src/lib/sampleBufferCache.ts
//
// Caché GLOBAL, fuera del ciclo de vida de React (un Map a nivel de
// módulo, no un useState/useRef) de AudioBuffers ya decodificados por
// sampleId. Dos puntos de entrada la alimentan:
//   1. La pre-escucha en el panel del Banco de Sonidos (SampleBrowserPanel)
//      — al tocar Play en el preview, se dispara en paralelo (sin
//      bloquear el preview en sí, que sigue usando <audio src> nativo,
//      ver la nota en SamplePlayer.tsx) una descarga+decode que llena
//      esta caché.
//   2. El propio Arranger, al soltar un sample en una pista.
// El beneficio: si el usuario ya escuchó un sample (o ya lo usó antes
// en el arreglo), soltarlo de nuevo es INSTANTÁNEO — cero fetch, cero
// decode — porque ya está acá. Vive a nivel de módulo (no por
// componente) para sobrevivir aunque el usuario navegue entre
// /samples y /arranger dentro de la misma pestaña.

import { ref, getDownloadURL } from "firebase/storage";
import { storage } from "./firebase";

const bufferCache = new Map<string, AudioBuffer>();
const pendingLoads = new Map<string, Promise<AudioBuffer>>();

// AudioContext exclusivo para decodeAudioData — NUNCA se conecta a
// destination ni se reproduce nada por acá, así que no importa que
// arranque "suspended" (las políticas de autoplay del navegador solo
// afectan la REPRODUCCIÓN, no decodeAudioData). Un solo contexto
// perezoso, compartido, en vez de crear uno por decode.
let decodingContext: AudioContext | null = null;
function getDecodingContext(): AudioContext {
  if (!decodingContext) decodingContext = new AudioContext();
  return decodingContext;
}

export function getCachedBuffer(sampleId: string): AudioBuffer | undefined {
  return bufferCache.get(sampleId);
}

export function setCachedBuffer(sampleId: string, buffer: AudioBuffer): void {
  bufferCache.set(sampleId, buffer);
}

/**
 * Devuelve el AudioBuffer decodificado de este sample — de la caché si
 * ya estaba (síncrono en la práctica, la promesa resuelve en el
 * siguiente microtask), o descargándolo si no. Dos llamadas
 * concurrentes para el MISMO sampleId comparten la misma descarga (no
 * dispara dos fetch en paralelo).
 */
export function loadAndCacheBuffer(sampleId: string, audioPath: string): Promise<AudioBuffer> {
  const cached = bufferCache.get(sampleId);
  if (cached) return Promise.resolve(cached);

  const pending = pendingLoads.get(sampleId);
  if (pending) return pending;

  const promise = (async () => {
    const downloadUrl = await getDownloadURL(ref(storage, audioPath));
    const response = await fetch(`/api/download-proxy?url=${encodeURIComponent(downloadUrl)}`);
    if (!response.ok) {
      throw new Error(`No se pudo descargar el sample (HTTP ${response.status}).`);
    }
    const bytes = await response.arrayBuffer();
    const buffer = await getDecodingContext().decodeAudioData(bytes);
    bufferCache.set(sampleId, buffer);
    return buffer;
  })();

  pendingLoads.set(sampleId, promise);
  promise.finally(() => pendingLoads.delete(sampleId));
  return promise;
}

/** Dispara la descarga+decode en segundo plano SIN esperar el resultado — para pre-calentar la caché desde la pre-escucha, sin acoplar esa UI a si funcionó o no. */
export function warmBufferCache(sampleId: string, audioPath: string): void {
  if (bufferCache.has(sampleId) || pendingLoads.has(sampleId)) return;
  void loadAndCacheBuffer(sampleId, audioPath).catch(() => {
    // Silencioso a propósito: esto es un pre-calentamiento oportunista
    // desde el preview — si falla, el intento "real" al soltar el
    // clip en una pista (loadAndCacheBuffer de nuevo) es el que
    // reporta el error al usuario vía addSampleError.
  });
}
