// src/lib/arrangerFxPreview.ts
//
// Escuchar el arreglo del Arranger CON sus efectos.
//
// Por qué no se puede hacer con nodos de Web Audio, que sería lo obvio:
// el EQ, el compresor, la reverb y el limitador de MY STUDIO son un DSP
// propio (ver trackEffects.ts), port exacto del motor en C++. Un
// `DynamicsCompressorNode` no es el mismo compresor y Freeverb no
// existe en Web Audio, así que "monitorear" con nodos del navegador
// sonaría distinto de lo que después exporta la app. La regla del
// proyecto es que lo que se escucha sea lo que se obtiene, así que la
// mezcla se RENDERIZA con el mismo DSP y se reproduce como un solo
// buffer — igual que hace el visor de la Comunidad (ProjectViewer).
//
// El costo de esa decisión: la pre-escucha con efectos es una foto, no
// un monitoreo en vivo. Cambiar un fader no se oye hasta volver a
// renderizar. A cambio, lo que se oye es exactamente lo que va a salir.
//
// Cada clip se rinde con `renderClipSamples`, EL MISMO que usa la
// exportación: volumen, fades, recorte y repeticiones salen de ahí y no
// de una copia parecida.

import { renderClipSamples } from "@/lib/wavExport";
import type { FadeShape } from "@/lib/clipEnvelope";
import { renderProjectMix, type MixdownTrack } from "@/lib/projectMixdown";
import type { MasterFx, TrackFx } from "@/lib/trackEffects";

/// 44,1 kHz — la misma tasa a la que rinde el exportador, así que los
/// buffers que salen de renderClipSamples ya vienen así.
export const PREVIEW_SAMPLE_RATE = 44100;

/** Un clip del arreglo, con todo lo que hace falta para renderizarlo. */
export interface PreviewClip {
  /// El buffer YA procesado (tempo y tono resueltos), el mismo que
  /// usa la reproducción en vivo.
  buffer: AudioBuffer;
  startSeconds: number;
  /// Ventana dentro del buffer, en la base de tiempo de ESE buffer
  /// (o sea, ya dividida por el rate de time-stretch).
  sourceOffsetSeconds: number;
  sourceDurationSeconds: number;
  gain: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  fadeInShape: FadeShape;
  fadeOutShape: FadeShape;
  repeats: number;
}

export interface PreviewTrack {
  volume: number;
  pan: number;
  isMuted: boolean;
  isSolo: boolean;
  fx: TrackFx;
  clips: PreviewClip[];
}

/**
 * Lo mínimo de un AudioBuffer que le hace falta a renderProjectMix:
 * duración, tasa y las muestras. Se arma a mano en vez de crear un
 * AudioBuffer real para no necesitar un AudioContext — esto corre igual
 * en un test de Node.
 */
function asBuffer(samples: Float32Array, sampleRate: number): AudioBuffer {
  return {
    duration: samples.length / sampleRate,
    sampleRate,
    length: samples.length,
    numberOfChannels: 1,
    getChannelData: () => samples,
  } as unknown as AudioBuffer;
}

/**
 * Renderiza el arreglo completo con los efectos de cada pista y los del
 * máster. Devuelve la mezcla estéreo lista para reproducir.
 *
 * Las pistas silenciadas y el solo se resuelven adentro de
 * renderProjectMix, igual que en el visor y en el preview de la
 * Comunidad: una sola implementación de esa regla para todo el
 * proyecto.
 */
export async function renderArrangementWithFx(
  tracks: PreviewTrack[],
  master: MasterFx,
  sampleRate = PREVIEW_SAMPLE_RATE,
): Promise<{
  // <ArrayBuffer> explícito: es lo que exige AudioBuffer.copyToChannel,
  // así la mezcla llega hasta el reproductor sin una copia intermedia
  // de decenas de MB solo para satisfacer al tipo (mismo motivo que en
  // projectMixdown.RenderedMix).
  left: Float32Array<ArrayBuffer>;
  right: Float32Array<ArrayBuffer>;
  durationSeconds: number;
}> {
  const mixdownTracks: MixdownTrack[] = [];
  for (const track of tracks) {
    const clips = [];
    for (const clip of track.clips) {
      const samples = await renderClipSamples(
        clip.buffer,
        clip.sourceOffsetSeconds,
        clip.sourceDurationSeconds,
        clip.gain,
        clip.fadeInSeconds,
        clip.fadeOutSeconds,
        clip.fadeInShape,
        clip.fadeOutShape,
        clip.repeats,
      );
      clips.push({ startSeconds: clip.startSeconds, buffer: asBuffer(samples, sampleRate) });
    }
    mixdownTracks.push({
      volume: track.volume,
      pan: track.pan,
      isMuted: track.isMuted,
      isSolo: track.isSolo,
      fx: track.fx,
      clips,
    });
  }

  const mix = renderProjectMix(mixdownTracks, master, sampleRate);
  return { left: mix.left, right: mix.right, durationSeconds: mix.durationSeconds };
}

/**
 * Firma de TODO lo que cambia el sonido de la mezcla renderizada.
 *
 * Sirve para no volver a renderizar cuando nada cambió: renderizar
 * tarda, y apretar Play dos veces seguidas no tiene por qué costar dos
 * veces. Incluye los efectos, el volumen y el paneo de cada pista, y la
 * posición y ventana de cada clip — todo lo que entra al render.
 *
 * ⚠️ NO incluye el buffer de cada clip por su contenido (sería carísimo
 * de hashear): va su identidad por `sampleId`/duración, que es lo que
 * cambia cuando se reemplaza el audio.
 */
export function mixSignature(tracks: PreviewTrack[], master: MasterFx): string {
  const parts: (string | number | boolean)[] = [
    master.reverbRoomSize,
    master.reverbDamping,
    master.reverbWet,
    master.limiterEnabled,
  ];
  for (const track of tracks) {
    parts.push(
      "|t",
      track.volume,
      track.pan,
      track.isMuted,
      track.isSolo,
      track.fx.eqLowDb,
      track.fx.eqMidDb,
      track.fx.eqHighDb,
      track.fx.compEnabled,
      track.fx.compThresholdDb,
      track.fx.compRatio,
      track.fx.compMakeupDb,
      track.fx.reverbSend,
    );
    for (const clip of track.clips) {
      parts.push(
        "|c",
        clip.startSeconds,
        clip.sourceOffsetSeconds,
        clip.sourceDurationSeconds,
        clip.repeats,
        clip.gain,
        clip.fadeInSeconds,
        clip.fadeOutSeconds,
        clip.buffer.duration,
      );
    }
  }
  return parts.join(",");
}
