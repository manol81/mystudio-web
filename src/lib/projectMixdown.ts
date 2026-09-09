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
    .flatMap((t) => t.clips.map((c) => c.startSeconds + c.buffer.duration))
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
    for (const clip of track.clips) {
      // Todo lo que graba la app es mono; si algún día llega un clip
      // estéreo, se toma el canal izquierdo (el motor también mezcla
      // a mono antes de la cadena de pista).
      const data = clip.buffer.getChannelData(0);
      const offset = Math.round(clip.startSeconds * sampleRate);
      const count = Math.min(data.length, contentFrames - offset);
      for (let i = 0; i < count; i++) samples[offset + i] += data[i];
    }

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
