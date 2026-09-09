// src/lib/stemsExport.ts
//
// Paquete LIVIANO de pistas para la Comunidad: un MP3 por pista, todos
// alineados desde el segundo 0, dentro de un ZIP con un manifiesto
// mínimo. Es lo que permite que cualquiera escuche una canción POR
// DENTRO, silenciando o destacando pistas, sin acceso al proyecto real.
//
// Por qué existe: el `.mystudio` vive en `users/{uid}/projects`, que
// por reglas lee únicamente su dueño. Antes de esto, el visor
// multipista fallaba con "permiso denegado" para cualquier otra
// persona, así que escuchar por pistas solo servía en las
// publicaciones propias.
//
// Por qué liviano y no una copia del proyecto: el original son WAV sin
// comprimir, decenas de MB por canción, y el plan gratuito de Firebase
// son 5 GB en total. A 32 kHz y 96 kbps, las mismas pistas pesan cerca
// de una séptima parte, y para escuchar y analizar una canción en el
// navegador la diferencia es inaudible. La calidad real sigue estando
// en el proyecto del autor y en la exportación de la app.
//
// Qué NO lleva: la reverb del máster, que es un efecto compartido
// alimentado por los envíos de todas las pistas y no se puede repartir
// entre ellas. Cada pista sí lleva su EQ, su compresor, su volumen y
// su paneo, así que sumarlas suena como la mezcla salvo por esa cola.

import JSZip from "jszip";
import {
  encodeMp3,
  loadDecodedTracks,
  SAMPLE_RATE,
  type DecodedProject,
} from "@/lib/audioPreviewExport";
import { applyTrackFxInPlace, constantPowerGains } from "@/lib/trackEffects";
import { contentDurationSeconds } from "@/lib/projectMixdown";

/// Nombre del manifiesto dentro del ZIP.
export const STEMS_MANIFEST = "stems.json";

export interface StemsManifestEntry {
  /// Archivo dentro del ZIP.
  file: string;
  /// Nombre de la pista tal como la nombró el autor.
  name: string;
}

export interface StemsManifest {
  formatVersion: 1;
  /// Duración total en segundos; todas las pistas miden lo mismo.
  durationSeconds: number;
  stems: StemsManifestEntry[];
}

export interface StemsPackage {
  blob: Blob;
  trackCount: number;
}

/// Genera el paquete a partir del .mystudio publicado. `onProgress`
/// (0-1) cubre la codificación, que es con diferencia lo más lento.
export async function buildStemsPackage(
  downloadUrl: string,
  onProgress?: (ratio: number) => void,
): Promise<StemsPackage> {
  const ctx = new AudioContext();
  try {
    const project = await loadDecodedTracks(downloadUrl, ctx);
    return await renderStems(project, onProgress);
  } finally {
    await ctx.close();
  }
}

async function renderStems(
  project: DecodedProject,
  onProgress?: (ratio: number) => void,
): Promise<StemsPackage> {
  const { tracks } = project;
  const anySolo = tracks.some((t) => t.isSolo);
  const audible = tracks.filter(
    (t) => !t.isMuted && (!anySolo || t.isSolo) && t.clips.length > 0,
  );

  const durationSeconds = Math.max(0.1, contentDurationSeconds(tracks));
  const totalFrames = Math.ceil(durationSeconds * SAMPLE_RATE);

  const zip = new JSZip();
  const entries: StemsManifestEntry[] = [];
  const offline = new OfflineAudioContext(2, totalFrames, SAMPLE_RATE);

  for (let i = 0; i < audible.length; i++) {
    const track = audible[i];

    // La pista entera alineada a t=0, con el silencio entre clips que
    // el compresor necesita ver (mismo criterio que projectMixdown.ts).
    const mono = new Float32Array(totalFrames);
    for (const clip of track.clips) {
      const data = clip.buffer.getChannelData(0);
      const offset = Math.round(clip.startSeconds * SAMPLE_RATE);
      const count = Math.min(data.length, totalFrames - offset);
      for (let n = 0; n < count; n++) mono[offset + n] += data[n];
    }
    applyTrackFxInPlace(mono, track.fx, SAMPLE_RATE);

    // Volumen y paneo ya aplicados: así el oyente escucha cada pista
    // en el lugar del estéreo donde la puso el autor, y sumarlas
    // reproduce la mezcla.
    const { left: lg, right: rg } = constantPowerGains(track.volume, track.pan);
    const buffer = offline.createBuffer(2, totalFrames, SAMPLE_RATE);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    for (let n = 0; n < totalFrames; n++) {
      left[n] = mono[n] * lg;
      right[n] = mono[n] * rg;
    }

    const file = `stem_${i}.mp3`;
    const blob = await encodeMp3(buffer, (ratio) =>
      onProgress?.((i + ratio) / audible.length),
    );
    zip.file(file, blob);
    entries.push({ file, name: track.name || `Pista ${i + 1}` });
  }

  const manifest: StemsManifest = {
    formatVersion: 1,
    durationSeconds,
    stems: entries,
  };
  zip.file(STEMS_MANIFEST, JSON.stringify(manifest));

  const blob = await zip.generateAsync({ type: "blob" });
  return { blob, trackCount: entries.length };
}
