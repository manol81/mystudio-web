// src/lib/pitchShift.ts
//
// Pitch-Shifting REAL (cambio de tonalidad SIN alterar la duración),
// independiente del time-stretch de tempo (ver timeStretch.ts) — dos
// ejes que se aplican en dos pasadas separadas, cada una cacheada por
// su cuenta, así ajustar el pitch de un clip nunca vuelve a calcular
// el tempo, y viceversa.
//
// Motor: signalsmith-stretch (Signalsmith Audio, MIT) — WASM +
// AudioWorklet. Se descartó integrar un port WASM de Rubber Band
// (rubberband-wasm / rubberband-web) pese a ser el pedido original:
// AMBOS son GPLv2 — usarlos en MY STUDIO (producto comercial cerrado,
// en Google Play) exigiría o bien abrir el código bajo GPL, o comprar
// una licencia comercial al autor de Rubber Band. signalsmith-stretch
// es MIT (sin ese riesgo legal), corre igual sobre WASM+AudioWorklet
// (el cálculo nunca toca el hilo principal — corre en el hilo de audio
// en tiempo real del navegador, un aislamiento incluso más fuerte que
// el Web Worker que usa timeStretch.ts) y soporta rate/semitones como
// parámetros TOTALMENTE independientes en la misma llamada a
// `.schedule()`, que es exactamente la garantía que pide esta feature.
//
// Cómo se usa acá (offline, no en vivo): NO se conecta a los parlantes
// en tiempo real — se le da el buffer completo de una (con
// addBuffers), se programa un ÚNICO cambio a rate=1/semitones=n, y se
// renderiza todo de una en un OfflineAudioContext (más rápido que
// tiempo real). El resultado es un AudioBuffer normal, que de ahí en
// más se cachea y reproduce exactamente igual que cualquier otro
// buffer ya procesado (ver getStretchedBuffer en arranger/page.tsx) —
// el resto del motor (trim, fade, export) no sabe ni le importa que
// pasó por acá.
//
// Por qué se importa desde /signalsmith-stretch.mjs (un archivo
// ESTÁTICO en /public) y NO como "signalsmith-stretch" del paquete de
// npm: esta librería arma su AudioWorklet extrayendo el código como
// TEXTO PLANO (`registerWorkletProcessor.toString()`) y cargándolo vía
// Blob URL en un AudioWorkletGlobalScope aislado — un hilo con su
// propio scope global, sin nada del bundler. Si Turbopack transforma
// ese código al empaquetarlo (p.ej. inyecta su propio polyfill de
// `process`, que el glue de Emscripten adentro sí referencia para
// detectar si corre en Node), esas referencias quedan colgando en el
// texto extraído: el AudioWorklet arranca y explota con
// "ReferenceError: __TURBOPACK__imported__module__... is not defined"
// en cuanto intenta ejecutar — bug real que causaba el silencio total
// apenas el pitch era distinto de 0 (confirmado con una página de
// diagnóstico aislada, sin login, generando un tono sintético). Servir
// el archivo tal cual desde /public e importarlo por URL en tiempo de
// ejecución evita que el bundler lo toque en absoluto.
import type { SignalsmithStretchFactory } from "@/types/signalsmith-stretch";

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

const PITCH_IDENTITY_EPSILON = 0.0005;
// Margen de cola generoso para absorber la latencia del algoritmo (el
// arranque real tarda un poco en "calentar" el análisis) — se recorta
// con precisión después usando node.latency(), esto es solo para que
// el OfflineAudioContext tenga espacio de sobra donde renderizar esa
// cola sin cortarla.
const RENDER_PADDING_SECONDS = 2;

const pitchedBufferCache = new Map<string, AudioBuffer>();
const pendingPitchShifts = new Map<string, Promise<AudioBuffer>>();

function cacheKey(sampleId: string, rate: number, semitones: number): string {
  return `${sampleId}::${rate.toFixed(4)}::${semitones}`;
}

/**
 * Aplica `semitones` de pitch-shift a `buffer` SIN cambiar su
 * duración (rate=1 en el motor — el eje de tempo ya se resolvió antes,
 * en timeStretch.ts, si hacía falta). `semitones` es un entero de -12
 * a +12 (ver la UI en arranger/page.tsx), pero acá acepta cualquier
 * número por si a futuro se permite pitch fraccionario.
 */
export async function applyPitchShift(buffer: AudioBuffer, semitones: number): Promise<AudioBuffer> {
  if (Math.abs(semitones) < PITCH_IDENTITY_EPSILON) return buffer;

  const sampleRate = buffer.sampleRate;
  const channels = buffer.numberOfChannels;
  const inputFrames = buffer.length;
  const paddingFrames = Math.ceil(RENDER_PADDING_SECONDS * sampleRate);
  const totalFrames = inputFrames + paddingFrames;

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
  // rate: 1 — SOLO pitch, cero cambio de velocidad/duración (Paso 3:
  // time-stretch y pitch-shift operan en pasadas independientes, esta
  // llamada es la prueba de que acá ninguna de las dos cosas se mezcla).
  //
  // BUG REAL que causaba silencio total con cualquier pitch != 0: TODO
  // método de este nodo (menos connect/disconnect, heredados de
  // AudioNode) viaja por un RPC de postMessage al AudioWorklet y
  // devuelve una Promise — acá antes NO se esperaba ni schedule() ni
  // latency(). Sin el await de schedule(), no había garantía de que el
  // cambio de pitch ya estuviera aplicado antes de startRendering().
  await node.schedule({ output: 0, active: true, input: 0, rate: 1, semitones });

  const rendered = await offlineCtx.startRendering();

  // El bug real estaba ACÁ: node.latency() TAMBIÉN es una Promise (no
  // un número). Sin el await, `node.latency() * sampleRate` daba NaN,
  // que Math.round/Math.max dejaban pasar como NaN, y
  // Float32Array.subarray(NaN, NaN) coerciona NaN a 0 — terminaba
  // copiando el arranque "en frío" del algoritmo (la ventana de
  // latencia, casi silenciosa) en vez de saltarla, así que el clip
  // sonaba mudo o casi mudo apenas se tocaba el pitch.
  const latencySeconds = await node.latency();
  const latencyFrames = Math.max(0, Math.round(latencySeconds * sampleRate));
  const outBuffer = new AudioBuffer({ numberOfChannels: channels, length: inputFrames, sampleRate });
  for (let ch = 0; ch < channels; ch++) {
    const renderedChannel = rendered.getChannelData(ch);
    const trimmed = renderedChannel.subarray(latencyFrames, latencyFrames + inputFrames);
    outBuffer.copyToChannel(new Float32Array(trimmed), ch);
  }
  return outBuffer;
}

/**
 * Versión cacheada — por (sampleId, rate, semitones): reutilizar el
 * mismo clip con el mismo pitch no vuelve a pasar por el motor.
 */
export function getOrPitchShiftBuffer(
  sampleId: string,
  buffer: AudioBuffer,
  rate: number,
  semitones: number,
): Promise<AudioBuffer> {
  if (Math.abs(semitones) < PITCH_IDENTITY_EPSILON) return Promise.resolve(buffer);

  const key = cacheKey(sampleId, rate, semitones);
  const cached = pitchedBufferCache.get(key);
  if (cached) return Promise.resolve(cached);

  const pending = pendingPitchShifts.get(key);
  if (pending) return pending;

  const promise = applyPitchShift(buffer, semitones).then((result) => {
    pitchedBufferCache.set(key, result);
    return result;
  });
  pendingPitchShifts.set(key, promise);
  promise.finally(() => pendingPitchShifts.delete(key));
  return promise;
}
