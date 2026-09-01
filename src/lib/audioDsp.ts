// src/lib/audioDsp.ts
//
// Motor ÚNICO de tempo (time-stretch) + tono (pitch-shift) — reemplaza
// la arquitectura anterior de DOS motores separados:
//   - timeStretch.ts (borrado): SoundTouchJS/WSOLA en un Web Worker,
//     para el tempo.
//   - pitchShift.ts (borrado): signalsmith-stretch/AudioWorklet, para
//     el tono, aplicado en una SEGUNDA pasada sobre el resultado del
//     primero.
//
// Por qué se unificó (reporte real): incluso un cambio de tempo chico
// (120→110 BPM) ya sonaba con "espacios y/o alteraciones" notorias.
// SoundTouch usa WSOLA (Waveform-Similarity Overlap-Add) — un
// algoritmo clásico, liviano, pero con una debilidad CONOCIDA en
// material rítmico/percusivo (loops de batería, samples con
// transientes marcados): al buscar "la mejor posición de solapamiento"
// dentro de una ventana, cualquier transiente que caiga cerca de un
// punto de corte se duplica, se recorta o genera un "hueco" audible —
// no es un bug de esta integración, es una limitación real y conocida
// de WSOLA con ESTE tipo de contenido, más notoria cuanto más
// percusivo es el loop (justo lo típico en un Banco de Sonidos).
//
// signalsmith-stretch (Signalsmith Audio, MIT) ya estaba integrado acá
// mismo para el pitch — es un algoritmo más moderno con mejor manejo
// de transientes, Y soporta `rate` (tempo) y `semitones` (tono) como
// parámetros TOTALMENTE independientes en la MISMA llamada a
// `.schedule()`. Unificar en un solo motor da dos cosas a la vez:
// mejor calidad en el tempo (el problema reportado), y una sola pasada
// de DSP en vez de dos encadenadas cuando además hay pitch (menos
// procesamiento, y sin el artefacto extra de "estirar lo ya estirado").
//
// Se descartó un port WASM de Rubber Band (rubberband-wasm/
// rubberband-web) pese a ser mencionado en el pedido original de
// pitch-shifting: AMBOS son GPLv2 — usarlos en MY STUDIO (producto
// comercial cerrado, en Google Play) exigiría abrir el código bajo GPL
// o comprar una licencia comercial al autor. signalsmith-stretch no
// tiene ese riesgo legal.
//
// Por qué se importa desde /signalsmith-stretch.mjs (un archivo
// ESTÁTICO en /public) y NO como "signalsmith-stretch" del paquete de
// npm: esta librería arma su AudioWorklet extrayendo el código como
// TEXTO PLANO (`registerWorkletProcessor.toString()`) y cargándolo vía
// Blob URL en un AudioWorkletGlobalScope aislado. Si Turbopack
// transforma ese código al empaquetarlo (p.ej. inyecta su propio
// polyfill de `process`, que el glue de Emscripten adentro sí
// referencia para detectar si corre en Node), esas referencias quedan
// colgando en el texto extraído y el AudioWorklet explota con
// "ReferenceError: __TURBOPACK__imported__module__... is not defined"
// en cuanto intenta ejecutar. Servir el archivo tal cual desde
// /public e importarlo por URL en tiempo de ejecución evita que el
// bundler lo toque en absoluto.

import type { SignalsmithStretchFactory } from "@/types/signalsmith-stretch";

const IDENTITY_EPSILON = 0.0005;
// Margen de cola generoso para absorber la latencia del algoritmo (el
// arranque real tarda un poco en "calentar" el análisis) — se recorta
// con precisión después usando node.latency(), esto es solo para que
// el OfflineAudioContext tenga espacio de sobra donde renderizar esa
// cola sin cortarla.
const RENDER_PADDING_SECONDS = 2;

const processedBufferCache = new Map<string, AudioBuffer>();
const pendingProcessing = new Map<string, Promise<AudioBuffer>>();

function cacheKey(sampleId: string, rate: number, semitones: number): string {
  return `${sampleId}::${rate.toFixed(4)}::${semitones}`;
}

async function loadSignalsmithStretch(): Promise<SignalsmithStretchFactory> {
  // turbopackIgnore: sin esto, Turbopack intenta RESOLVER este import
  // como si fuera un módulo del proyecto (falla en build: "server
  // relative imports are not implemented yet") — el comentario mágico
  // le dice que lo deje pasar tal cual, para que el NAVEGADOR lo
  // resuelva en tiempo de ejecución como la URL absoluta que es.
  //
  // TypeScript (moduleResolution: bundler) no puede resolver un tipo
  // para un specifier con forma de URL absoluta — @ts-expect-error
  // silencia ESE error puntual; el tipo real se aplica a mano contra
  // SignalsmithStretchFactory (ver src/types/signalsmith-stretch.d.ts)
  // en el cast de abajo.
  // @ts-expect-error — import en tiempo de ejecución por URL, sin declaración de módulo resoluble estáticamente
  const mod = (await import(/* turbopackIgnore: true */ "/signalsmith-stretch.mjs")) as unknown as {
    default: SignalsmithStretchFactory;
  };
  return mod.default;
}

/**
 * Aplica tempo (`rate` — 1 = sin cambio, 0.5 = mitad de velocidad) Y
 * tono (`semitones` — 0 = sin cambio) a `buffer`, en una ÚNICA pasada
 * de DSP. La duración de salida es `buffer.duration / rate` (misma
 * relación que ya usaba el motor anterior de tempo).
 */
export async function applyTimeStretch(
  buffer: AudioBuffer,
  rate: number,
  semitones: number,
): Promise<AudioBuffer> {
  const isIdentity = Math.abs(rate - 1) < IDENTITY_EPSILON && Math.abs(semitones) < IDENTITY_EPSILON;
  if (isIdentity || rate <= 0) return buffer;

  const sampleRate = buffer.sampleRate;
  const channels = buffer.numberOfChannels;
  const inputFrames = buffer.length;
  const outputFrames = Math.max(1, Math.ceil(inputFrames / rate));
  const paddingFrames = Math.ceil(RENDER_PADDING_SECONDS * sampleRate);
  const totalFrames = outputFrames + paddingFrames;

  const offlineCtx = new OfflineAudioContext(channels, totalFrames, sampleRate);
  const SignalsmithStretch = await loadSignalsmithStretch();
  const node = await SignalsmithStretch(offlineCtx, {
    numberOfInputs: 0, // no hay entrada EN VIVO — se alimenta con addBuffers, no con una conexión de audio
    numberOfOutputs: 1,
    outputChannelCount: [channels],
  });

  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) {
    channelData.push(Float32Array.from(buffer.getChannelData(ch)));
  }
  await node.addBuffers(channelData);
  node.connect(offlineCtx.destination);
  // Casi todos los métodos de este nodo viajan por un RPC de
  // postMessage al AudioWorklet y devuelven una Promise — HAY que
  // esperar tanto schedule() como latency() (ver más abajo), si no
  // vuelve el bug real de la Fase de pitch-shifting: sin el await, el
  // cambio no llega a tiempo / el cálculo de latencia da NaN.
  await node.schedule({ output: 0, active: true, input: 0, rate, semitones });

  const rendered = await offlineCtx.startRendering();

  const latencySeconds = await node.latency();
  const latencyFrames = Math.max(0, Math.round(latencySeconds * sampleRate));
  const outBuffer = new AudioBuffer({ numberOfChannels: channels, length: outputFrames, sampleRate });
  for (let ch = 0; ch < channels; ch++) {
    const renderedChannel = rendered.getChannelData(ch);
    const trimmed = renderedChannel.subarray(latencyFrames, latencyFrames + outputFrames);
    outBuffer.copyToChannel(new Float32Array(trimmed), ch);
  }
  return outBuffer;
}

/**
 * Versión cacheada — por (sampleId, rate, semitones), a nivel de
 * MÓDULO (fuera del ciclo de vida de React, sobrevive a que el
 * Arranger se desmonte/remonte): reutilizar el mismo clip al mismo
 * tempo/tono no vuelve a pasar por el motor.
 */
export function getOrProcessBuffer(
  sampleId: string,
  buffer: AudioBuffer,
  rate: number,
  semitones: number,
): Promise<AudioBuffer> {
  const isIdentity = Math.abs(rate - 1) < IDENTITY_EPSILON && Math.abs(semitones) < IDENTITY_EPSILON;
  if (isIdentity) return Promise.resolve(buffer);

  const key = cacheKey(sampleId, rate, semitones);
  const cached = processedBufferCache.get(key);
  if (cached) return Promise.resolve(cached);

  const pending = pendingProcessing.get(key);
  if (pending) return pending;

  const promise = applyTimeStretch(buffer, rate, semitones).then((result) => {
    processedBufferCache.set(key, result);
    return result;
  });
  pendingProcessing.set(key, promise);
  promise.finally(() => pendingProcessing.delete(key));
  return promise;
}
