// src/lib/samplePreview.ts
//
// Pre-escucha de un sample EN EL CONTEXTO DEL PROYECTO.
//
// Hasta acá, escuchar un sample del Banco de Sonidos era un
// `<audio src>` nativo (ver SamplePlayer.tsx): sonaba a su BPM y su
// tonalidad originales. Si el proyecto iba a 120 y el loop era de 90,
// lo que el usuario escuchaba NO era lo que iba a sonar al soltarlo —
// estaba eligiendo a ciegas y descubriendo el resultado después. El
// `<audio>` sigue existiendo y sigue siendo la opción correcta para
// escuchar el ORIGINAL (streaming progresivo, sin esperar la descarga
// completa); esto es lo otro.
//
// Acá se baja el audio, se lo pasa por el MISMO motor que usa el
// Arranger (audioDsp.ts) con el mismo rate y los mismos semitonos que
// va a tener como clip, y se lo reproduce en loop. Dos consecuencias
// que valen por sí solas:
//
//   · `getOrProcessBuffer` cachea por (sampleId, rate, semitones), así
//     que pre-escuchar un loop al tempo del proyecto deja YA CALCULADO
//     exactamente el buffer que va a necesitar el clip cuando se lo
//     suelte. Escuchar antes de soltar deja de costar tiempo: lo adelanta.
//   · Con `startAtContextTime` la pre-escucha se engancha al próximo
//     compás de lo que ya está sonando, así que se escucha el sample
//     ENCIMA del arreglo y en tiempo, sin tener que soltarlo primero
//     para saber si pega.
//
// La reproducción va derecho a `destination`, sin pasar por los nodos
// de pista del Arranger: silenciar o poner en Solo una pista no tiene
// por qué afectar una pre-escucha, que es una acción del navegador de
// sonidos y no parte de la mezcla.
//
// Las cuentas (qué rate, qué semitonos, dónde cae el próximo compás)
// NO viven acá: están en sampleAffinity.ts y barClock.ts, que son
// puros y testeables. Este módulo es solo el motor.

import { getOrProcessBuffer } from "./audioDsp";
import { loadAndCacheBuffer } from "./sampleBufferCache";
import {
  resolvePreviewTransform,
  type PreviewOptions,
  type PreviewSpec,
} from "./sampleAffinity";

interface ActivePreview {
  sampleId: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

let active: ActivePreview | null = null;
// Igual que `playRequestIdRef` en el Arranger: entre que se pide un
// sample y que su audio está listo, el usuario puede haber clickeado
// otro (o haber parado). Sin este contador, la pre-escucha vieja
// arrancaría igual al resolver su promesa y se escucharían las dos.
let requestCounter = 0;

/** Sube y baja en 15 ms: cortar la reproducción a mitad de onda produce un click audible — el mismo fenómeno que el usuario escucha entre dos clips pegados. */
const FADE_SECONDS = 0.015;
const PREVIEW_GAIN = 0.9;

export function currentPreviewSampleId(): string | null {
  return active?.sampleId ?? null;
}

export function stopPreview(): void {
  requestCounter++; // invalida cualquier carga en vuelo
  const playing = active;
  active = null;
  if (!playing) return;

  const ctx = playing.gain.context;
  const now = ctx.currentTime;
  playing.gain.gain.cancelScheduledValues(now);
  playing.gain.gain.setValueAtTime(playing.gain.gain.value, now);
  playing.gain.gain.linearRampToValueAtTime(0, now + FADE_SECONDS);
  try {
    playing.source.stop(now + FADE_SECONDS);
  } catch {
    // Ya había terminado sola (un One-Shot corto): stop() sobre una
    // fuente terminada lanza, y no es un problema.
  }
}

/**
 * Arranca la pre-escucha de `spec`, parando la anterior si había.
 *
 * `onEnded` avisa cuando dejó de sonar POR SU CUENTA (un One-Shot que
 * se terminó), para que el botón de la tarjeta vuelva a su estado. No
 * se llama cuando la paró el usuario ni cuando la reemplazó otra: de
 * eso ya se enteró quien la paró.
 */
export async function startPreview(
  ctx: AudioContext,
  spec: PreviewSpec,
  options: PreviewOptions & {
    /**
     * Instante absoluto del AudioContext donde empezar a sonar — para
     * caer en el próximo compás del arreglo en curso (ver
     * nextBarContextTime en barClock.ts). Si es null, arranca ya.
     */
    startAtContextTime?: number | null;
  },
  onEnded?: () => void,
): Promise<void> {
  stopPreview();
  const requestId = ++requestCounter;

  if (ctx.state === "suspended") await ctx.resume();

  const raw = await loadAndCacheBuffer(spec.sampleId, spec.audioPath);
  const { rate, semitones } = resolvePreviewTransform(spec, options);
  // Mismo `loopable` que el clip: si no, pre-escucha y clip dejan de
  // compartir el caché (ver getOrProcessBuffer).
  const buffer = await getOrProcessBuffer(spec.sampleId, raw, rate, semitones, spec.sampleType === "Loop");

  // Mientras se bajaba/procesaba, el usuario pidió otra cosa.
  if (requestId !== requestCounter) return;

  const gain = ctx.createGain();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  // Los loops se repiten para poder escucharlos contra el arreglo todo
  // lo que haga falta; un One-Shot repitiéndose solo sería molesto.
  source.loop = spec.sampleType === "Loop";
  source.connect(gain);
  gain.connect(ctx.destination);

  const when = Math.max(ctx.currentTime, options.startAtContextTime ?? ctx.currentTime);
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(PREVIEW_GAIN, when + FADE_SECONDS);

  source.onended = () => {
    // Solo interesa el final NATURAL: si esta ya no es la que suena,
    // fue reemplazada o parada.
    if (active?.source !== source) return;
    active = null;
    onEnded?.();
  };

  source.start(when);
  active = { sampleId: spec.sampleId, source, gain };
}
