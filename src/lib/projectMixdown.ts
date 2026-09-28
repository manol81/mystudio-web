// src/lib/projectMixdown.ts
//
// Mezcla de un proyecto CON efectos, compartida por el visor
// (ProjectViewer) y por el preview que se publica en la Comunidad
// (audioPreviewExport). Aplica la cadena de trackEffects.ts, que es el
// port exacto del DSP del motor nativo.
//
// Los dos llamadores siguen usando su camino de siempre —
// AudioBufferSourceNode sueltos con dos GainNodes de paneo — cuando el
// proyecto NO tiene efectos: es el caso de todo lo grabado antes de
// 2026-09 y de cualquier proyecto que no los use, y no tiene sentido
// pagar un render completo en memoria para llegar exactamente al mismo
// audio. `projectHasEffects` es el interruptor entre los dos caminos.
//
// Cuando SÍ hay efectos hay que materializar cada pista entera: el
// compresor y los filtros son procesadores con estado que corren sobre
// el flujo continuo de la pista (su envolvente cruza el silencio entre
// clips, igual que en el motor). Procesar clip por clip los
// reiniciaría en cada uno y sonaría distinto.

import { resampleLinear } from "@/lib/resample";
import {
  applyTrackFxInPlace,
  isTrackFxActive,
  mixTracks,
  type MasterFx,
  type MixTrack,
  type TrackFx,
} from "@/lib/trackEffects";

export interface MixdownClip {
  /// Segundos desde el inicio del proyecto (el `startBeat` del
  /// manifest, que pese al nombre son segundos — ver CLAUDE.md).
  startSeconds: number;
  buffer: AudioBuffer;

  // ─── Recorte, volumen y fades POR CLIP (formatVersion 3) ───────────
  //
  // El .mystudio no los llevaba y por eso acá no existían: un proyecto
  // publicado con clips recortados se pre-escuchaba ENTERO, a volumen
  // pleno y sin fades, y el paquete liviano de pistas salía igual. El
  // WAV del ZIP es el archivo COMPLETO, así que sin estos campos se
  // reproduce audio que la persona había sacado a propósito.
  //
  // Todos opcionales: un manifiesto formatVersion 1/2 —o uno escrito
  // por el Arranger, que hornea todo en el WAV— no los trae, y el
  // default de cada uno es "clip entero, a volumen pleno, sin fades".

  /// Offset DENTRO de `buffer`, en segundos, donde arranca lo que suena.
  sourceOffsetSeconds?: number;
  /// Cuánto de `buffer`, desde [sourceOffsetSeconds], suena.
  sourceDurationSeconds?: number;
  /// Volumen propio del clip (1 = sin cambio), ADEMÁS del de la pista.
  gain?: number;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
}

/// Lo que un clip del `manifest.json` puede traer. Las claves del
/// formatVersion 3 son opcionales: un respaldo 1/2, o uno escrito por
/// el Arranger web (que hornea el recorte y los fades en el WAV), no
/// las tiene.
export interface ManifestClipFields {
  /// Pese al nombre son SEGUNDOS, no compases (ver CLAUDE.md).
  startBeat: number;
  /// Tasa del archivo, contra la que están medidos los frames de trim.
  sampleRate?: number;
  sourceTrimStartFrame?: number;
  sourceTrimDurationFrames?: number;
  volume?: number;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
}

/// Traduce un clip del manifiesto a un [MixdownClip]. Vive acá, y no
/// copiado en cada lector del .mystudio, porque los tres que hay
/// (ProjectViewer, audioPreviewExport y de rebote stemsExport) tienen
/// que interpretar el recorte IGUAL: si uno se olvida de un campo, esa
/// pantalla suena distinto de las otras y nada lo delata.
///
/// Los frames de recorte se convierten con el `sampleRate` del
/// MANIFIESTO, no con el del buffer decodificado: `decodeAudioData`
/// devuelve el audio a la tasa del contexto (ver resample.ts), así que
/// el del buffer puede no ser el del archivo.
export function manifestClipToMixdownClip(
  clip: ManifestClipFields,
  buffer: AudioBuffer,
): MixdownClip {
  const rate = clip.sampleRate && clip.sampleRate > 0 ? clip.sampleRate : 0;
  const framesToSeconds = (frames: number | undefined): number | undefined => {
    if (frames === undefined || !Number.isFinite(frames) || rate <= 0) return undefined;
    return frames / rate;
  };
  return {
    startSeconds: clip.startBeat,
    buffer,
    sourceOffsetSeconds: framesToSeconds(clip.sourceTrimStartFrame),
    sourceDurationSeconds: framesToSeconds(clip.sourceTrimDurationFrames),
    gain: typeof clip.volume === "number" ? clip.volume : undefined,
    fadeInSeconds: clip.fadeInSeconds,
    fadeOutSeconds: clip.fadeOutSeconds,
  };
}

/// Cuánto ocupa este clip en la línea de tiempo: su ventana recortada,
/// o el buffer entero si no está recortado.
export function clipDurationSeconds(clip: MixdownClip): number {
  const trimmed = clip.sourceDurationSeconds;
  if (trimmed === undefined || !Number.isFinite(trimmed) || trimmed <= 0) {
    return clip.buffer.duration;
  }
  const offset = Math.max(0, clip.sourceOffsetSeconds ?? 0);
  return Math.min(trimmed, Math.max(0, clip.buffer.duration - offset));
}

/// Suma un clip —ya recortado, con su ganancia y sus fades— dentro de
/// [into], que es la pista entera alineada a t=0.
///
/// ⚠️ La envolvente es la MISMA que aplica `renderBlock` del motor
/// nativo (ver native_engine.cpp): rampa LINEAL, el fade-in medido
/// desde el inicio de la ventana recortada y el fade-out contra los
/// frames que faltan para su final. Si allá cambia la curva, cambia acá
/// — es el mismo trato que `trackEffects.ts` tiene con el DSP.
export function writeClipInto(
  into: Float32Array,
  clip: MixdownClip,
  sampleRate: number,
): void {
  // Todo lo que graba la app es mono; si algún día llega un clip
  // estéreo, se toma el canal izquierdo (el motor también mezcla a mono
  // antes de la cadena de pista).
  // ⚠️ A [sampleRate], no a la del buffer: si el llamador decodificó con
  // un contexto de otra tasa, copiar muestra a muestra haría sonar todo
  // más lento y cortaría el final (ver resample.ts). Cuando coinciden
  // —el caso normal— no copia nada.
  const data = resampleLinear(
    clip.buffer.getChannelData(0),
    clip.buffer.sampleRate,
    sampleRate,
  );

  // La ventana se recorta DESPUÉS de remuestrear, así que los índices
  // van en frames de [sampleRate] y no en los del archivo original.
  const sourceStart = Math.round(Math.max(0, clip.sourceOffsetSeconds ?? 0) * sampleRate);
  const windowFrames = Math.max(
    0,
    Math.min(
      Math.round(clipDurationSeconds(clip) * sampleRate),
      data.length - sourceStart,
    ),
  );
  if (windowFrames <= 0) return;

  const offset = Math.round(clip.startSeconds * sampleRate);
  const count = Math.min(windowFrames, into.length - offset);
  if (count <= 0) return;

  const gain = clip.gain ?? 1;
  const fadeInFrames = Math.round(Math.max(0, clip.fadeInSeconds ?? 0) * sampleRate);
  const fadeOutFrames = Math.round(Math.max(0, clip.fadeOutSeconds ?? 0) * sampleRate);

  for (let i = 0; i < count; i++) {
    let g = gain;
    if (fadeInFrames > 0 && i < fadeInFrames) g *= i / fadeInFrames;
    const framesFromEnd = windowFrames - i;
    if (fadeOutFrames > 0 && framesFromEnd < fadeOutFrames) {
      g *= framesFromEnd / fadeOutFrames;
    }
    into[offset + i] += data[sourceStart + i] * g;
  }
}

export interface MixdownTrack {
  volume: number;
  pan: number;
  isMuted: boolean;
  isSolo: boolean;
  fx: TrackFx;
  clips: MixdownClip[];
}

/// true si vale la pena pasar por el DSP: alguna pista audible tiene
/// efectos, o el máster tiene el limitador encendido con algo que
/// limitar. Un proyecto sin nada de esto suena idéntico por el camino
/// de siempre.
export function projectHasEffects(tracks: MixdownTrack[]): boolean {
  const anySolo = tracks.some((t) => t.isSolo);
  return tracks.some(
    (t) =>
      !t.isMuted &&
      (!anySolo || t.isSolo) &&
      t.clips.length > 0 &&
      isTrackFxActive(t.fx),
  );
}

export function contentDurationSeconds(tracks: MixdownTrack[]): number {
  return tracks
    .flatMap((t) => t.clips.map((c) => c.startSeconds + clipDurationSeconds(c)))
    .reduce((max, end) => Math.max(max, end), 0);
}

export interface RenderedMix {
  // Con <ArrayBuffer> explícito: es lo que exige
  // AudioBuffer.copyToChannel, y así el resultado llega hasta allá sin
  // una copia intermedia de decenas de MB solo para satisfacer al tipo.
  left: Float32Array<ArrayBuffer>;
  right: Float32Array<ArrayBuffer>;
  /// Duración total incluyendo la cola de reverb, en segundos.
  durationSeconds: number;
}

/// Renderiza la mezcla completa aplicando EQ y compresor por pista y
/// después reverb y limitador del máster, en el mismo orden que
/// renderBlock del motor. [sampleRate] es la tasa a la que están los
/// buffers (los decodifica el AudioContext del llamador, así que ya
/// vienen todos a la misma).
export function renderProjectMix(
  tracks: MixdownTrack[],
  master: MasterFx,
  sampleRate: number,
): RenderedMix {
  const contentFrames = Math.max(
    1,
    Math.ceil(contentDurationSeconds(tracks) * sampleRate),
  );
  const anySolo = tracks.some((t) => t.isSolo);

  const mixTracksInput: MixTrack[] = [];
  for (const track of tracks) {
    const audible = !track.isMuted && (!anySolo || track.isSolo);
    if (!audible || track.clips.length === 0) continue;

    // La pista entera alineada a t=0, con el silencio entre clips que
    // el compresor necesita ver.
    const samples = new Float32Array(contentFrames);
    for (const clip of track.clips) writeClipInto(samples, clip, sampleRate);

    applyTrackFxInPlace(samples, track.fx, sampleRate);
    mixTracksInput.push({
      samples,
      volume: track.volume,
      pan: track.pan,
      fx: track.fx,
    });
  }

  const { left, right } = mixTracks(mixTracksInput, master, sampleRate, contentFrames);
  return { left, right, durationSeconds: left.length / sampleRate };
}

/// Envuelve el resultado en un AudioBuffer para poder reproducirlo o
/// pasárselo al codificador de MP3. Necesita un contexto solo como
/// fábrica — el buffer resultante no queda atado a él.
export function toAudioBuffer(
  mix: RenderedMix,
  ctx: BaseAudioContext,
  sampleRate: number,
): AudioBuffer {
  const buffer = ctx.createBuffer(2, mix.left.length, sampleRate);
  buffer.copyToChannel(mix.left, 0);
  buffer.copyToChannel(mix.right, 1);
  return buffer;
}
