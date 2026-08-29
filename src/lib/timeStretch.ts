// src/lib/timeStretch.ts
//
// Time-stretching REAL (preserva el tono) para adaptar un Loop al
// tempo del proyecto — reemplaza el truco anterior de simplemente
// cambiar `AudioBufferSourceNode.playbackRate` (efecto "vinilo": la
// afinación cambiaba junto con la velocidad).
//
// `AudioBufferSourceNode` no tiene ningún `preservesPitch` real (esa
// propiedad solo existe en <audio>/<video>, y usar elementos HTML ahí
// haría perder la precisión de sincronización sample-accurate que
// necesita este motor). La solución es procesar el AudioBuffer, EN
// MEMORIA, con SoundTouchJS (WSOLA) — y desde la optimización de
// rendimiento (Pasos 1-4 del pedido de performance), ese cálculo corre
// en un Web Worker (ver timeStretchWorkerClient.ts /
// workers/timeStretch.worker.ts), NUNCA en el hilo principal, para no
// trabar la interfaz durante el drag & drop.
//
// Caché GLOBAL de resultados (Paso 2 del pedido de performance): un
// Map a nivel de MÓDULO (fuera del ciclo de vida de React, sobrevive
// a que el componente del Arranger se desmonte/remonte), con clave
// compuesta (sampleId + rate) — si el usuario reutiliza el mismo Loop
// al mismo tempo, el resultado ya estirado se devuelve directo, costo
// de procesamiento CERO.

import { stretchChannelsInWorker } from "./timeStretchWorkerClient";

const RATE_IDENTITY_EPSILON = 0.0005;

const stretchedBufferCache = new Map<string, AudioBuffer>();
const pendingStretches = new Map<string, Promise<AudioBuffer>>();

function cacheKey(sampleId: string, rate: number): string {
  return `${sampleId}::${rate.toFixed(4)}`;
}

/**
 * Devuelve el AudioBuffer de `buffer` ya adaptado a `rate` (misma
 * duración que `buffer.duration / rate`, tono original intacto). Si
 * `rate` es ~1 devuelve `buffer` TAL CUAL (no tiene sentido gastar un
 * Worker para no cambiar nada). Cachea por (sampleId, rate) — dos
 * clips del mismo sample al mismo tempo comparten el resultado.
 */
export function getOrStretchBuffer(
  sampleId: string,
  buffer: AudioBuffer,
  rate: number,
  audioContext: BaseAudioContext,
): Promise<AudioBuffer> {
  if (Math.abs(rate - 1) < RATE_IDENTITY_EPSILON || rate <= 0) return Promise.resolve(buffer);

  const key = cacheKey(sampleId, rate);
  const cached = stretchedBufferCache.get(key);
  if (cached) return Promise.resolve(cached);

  const pending = pendingStretches.get(key);
  if (pending) return pending;

  const promise = (async () => {
    // Copias descartables de los canales — stretchChannelsInWorker
    // TRANSFIERE estos arrays al worker (zero-copy, pero los deja
    // inutilizables acá), así que nunca hay que pasarle los canales
    // ORIGINALES de `buffer` (que otros rates todavía necesitan leer).
    const left = Float32Array.from(buffer.getChannelData(0));
    const right = buffer.numberOfChannels > 1 ? Float32Array.from(buffer.getChannelData(1)) : null;

    const result = await stretchChannelsInWorker(left, right, rate);

    const outChannels = result.right ? 2 : 1;
    const outBuffer = audioContext.createBuffer(
      outChannels,
      Math.max(1, result.frameCount),
      buffer.sampleRate,
    );
    // new Float32Array(...) de por medio: lo que llega del worker está
    // tipado contra un ArrayBufferLike genérico (podría ser un
    // SharedArrayBuffer), que copyToChannel no acepta — mismo patrón
    // que el checksum del ZIP en handleExport (ver page.tsx).
    outBuffer.copyToChannel(new Float32Array(result.left), 0);
    if (result.right) outBuffer.copyToChannel(new Float32Array(result.right), 1);

    stretchedBufferCache.set(key, outBuffer);
    return outBuffer;
  })();

  pendingStretches.set(key, promise);
  promise.finally(() => pendingStretches.delete(key));
  return promise;
}
