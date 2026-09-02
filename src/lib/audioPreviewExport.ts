// src/lib/audioPreviewExport.ts
//
// Genera el preview liviano (MP3) que se sube al publicar en la
// Comunidad — ver docs/social_architecture.md, Sección 1 ("streaming
// económico"). El .mystudio completo (WAVs sin comprimir) se descarga
// y se mezcla UNA sola vez, en el momento de publicar — no en cada
// reproducción del feed, que es justamente el problema de ancho de
// banda que este archivo resuelve.
//
// A propósito NO comparte código con ProjectViewer.tsx: ese es un
// reproductor interactivo con caché de sesión y cálculo de picos en
// fases (dos responsabilidades de UI que acá no aplican); esto es un
// mixdown de una sola pasada, sin estado de React. Sí reimplementa la
// MISMA fórmula de paneo de potencia constante que ProjectViewer y el
// motor nativo (Oboe) usan, para que el preview suene igual que el
// resto del ecosistema.
//
// El encoder MP3 (@breezystack/lamejs, LGPL-3.0 — la licencia real de
// cualquier encoder JS de MP3, todos son ports de LAME) corre 100% en
// el navegador de quien publica — sin esto habría que mandar el audio
// a un servidor propio para codificarlo, que es exactamente lo que
// este proyecto evita a propósito (ver CLAUDE.md, "100% local").

import JSZip from "jszip";
import { Mp3Encoder } from "@breezystack/lamejs";

interface ManifestClip {
  audioFileName: string;
  startBeat: number;
}

interface ManifestTrack {
  volume: number;
  pan: number;
  isMuted: boolean;
  isSolo: boolean;
  clips: ManifestClip[];
}

interface Manifest {
  tracks: ManifestTrack[];
}

interface DecodedClip {
  startBeat: number;
  buffer: AudioBuffer;
}

interface DecodedTrack {
  volume: number;
  pan: number;
  isMuted: boolean;
  isSolo: boolean;
  clips: DecodedClip[];
}

export interface MixdownResult {
  blob: Blob;
  durationSeconds: number;
}

const MP3_BITRATE_KBPS = 128;
const SAMPLE_RATE = 44100;
const MP3_BLOCK_SIZE = 1152; // tamaño de frame que espera encodeBuffer, fijo por el formato MP3

function constantPowerGains(volume: number, pan: number): { left: number; right: number } {
  const theta = (pan + 1.0) * (Math.PI / 4.0);
  return { left: Math.cos(theta) * volume, right: Math.sin(theta) * volume };
}

async function loadDecodedTracks(downloadUrl: string, ctx: AudioContext): Promise<DecodedTrack[]> {
  // Mismo motivo que ProjectViewer para pasar por /api/download-proxy:
  // decodeAudioData es una lectura por JS del contenido del archivo, y
  // eso SÍ dispara CORS contra el bucket (a diferencia de un <a href>
  // o un <audio src>, que son navegación/media del navegador, no JS).
  const response = await fetch(`/api/download-proxy?url=${encodeURIComponent(downloadUrl)}`);
  if (!response.ok) {
    throw new Error(`No se pudo descargar el proyecto (HTTP ${response.status}).`);
  }
  const zip = await JSZip.loadAsync(await response.arrayBuffer());

  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("El respaldo no tiene manifest.json — archivo inválido.");
  const manifest: Manifest = JSON.parse(await manifestFile.async("string"));

  const tracks: DecodedTrack[] = [];
  for (const track of manifest.tracks) {
    const clips: DecodedClip[] = [];
    for (const clip of track.clips) {
      const audioFile = zip.file(clip.audioFileName);
      if (!audioFile) continue; // clip huérfano, mismo criterio que ProjectViewer/Flutter
      const buffer = await ctx.decodeAudioData(await audioFile.async("arraybuffer"));
      clips.push({ startBeat: clip.startBeat, buffer });
    }
    tracks.push({
      volume: track.volume,
      pan: track.pan,
      isMuted: track.isMuted,
      isSolo: track.isSolo,
      clips,
    });
  }
  return tracks;
}

async function renderMixdown(tracks: DecodedTrack[]): Promise<{ buffer: AudioBuffer; durationSeconds: number }> {
  const durationSeconds = Math.max(
    0.1, // piso chico — evita un OfflineAudioContext de longitud 0 en un proyecto vacío
    tracks
      .flatMap((t) => t.clips.map((c) => c.startBeat + c.buffer.duration))
      .reduce((max, end) => Math.max(max, end), 0),
  );

  const offlineCtx = new OfflineAudioContext(2, Math.ceil(durationSeconds * SAMPLE_RATE), SAMPLE_RATE);
  const anySolo = tracks.some((t) => t.isSolo);

  for (const track of tracks) {
    const audible = !track.isMuted && (!anySolo || track.isSolo);
    if (!audible || track.clips.length === 0) continue;

    const { left, right } = constantPowerGains(track.volume, track.pan);
    const gainL = offlineCtx.createGain();
    gainL.gain.value = left;
    const gainR = offlineCtx.createGain();
    gainR.gain.value = right;
    const merger = offlineCtx.createChannelMerger(2);
    gainL.connect(merger, 0, 0);
    gainR.connect(merger, 0, 1);
    merger.connect(offlineCtx.destination);

    for (const clip of track.clips) {
      const source = offlineCtx.createBufferSource();
      source.buffer = clip.buffer;
      source.connect(gainL);
      source.connect(gainR);
      source.start(clip.startBeat);
    }
  }

  const buffer = await offlineCtx.startRendering();
  return { buffer, durationSeconds };
}

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

// Cuántos bloques de MP3_BLOCK_SIZE samples se codifican por "tanda"
// antes de ceder el hilo principal (setTimeout 0 → siguiente macrotask
// del event loop). Sin esto, un proyecto de varios minutos dispara
// miles de llamadas sincrónicas a encodeBuffer seguidas — suficiente
// para que el navegador marque la pestaña como "no responde" (bug
// real, reportado después de publicar un proyecto largo). 50 bloques ≈
// 1.3s de audio por tanda: un compromiso entre no trabar el hilo y no
// generar overhead innecesario por ceder demasiado seguido.
const BLOCKS_PER_CHUNK = 50;

function encodeMp3(buffer: AudioBuffer, onProgress?: (ratio: number) => void): Promise<Blob> {
  const left = floatTo16BitPCM(buffer.getChannelData(0));
  const right = buffer.numberOfChannels > 1 ? floatTo16BitPCM(buffer.getChannelData(1)) : left;
  const encoder = new Mp3Encoder(2, buffer.sampleRate, MP3_BITRATE_KBPS);
  const chunks: Uint8Array[] = [];

  return new Promise((resolve) => {
    let i = 0;
    function processChunk() {
      let blocksProcessed = 0;
      while (i < left.length && blocksProcessed < BLOCKS_PER_CHUNK) {
        const mp3buf = encoder.encodeBuffer(
          left.subarray(i, i + MP3_BLOCK_SIZE),
          right.subarray(i, i + MP3_BLOCK_SIZE),
        );
        if (mp3buf.length > 0) chunks.push(mp3buf);
        i += MP3_BLOCK_SIZE;
        blocksProcessed++;
      }
      onProgress?.(Math.min(1, i / left.length));

      if (i < left.length) {
        setTimeout(processChunk, 0);
        return;
      }
      const finalBuf = encoder.flush();
      if (finalBuf.length > 0) chunks.push(finalBuf);
      resolve(new Blob(chunks.map((c) => new Uint8Array(c)), { type: "audio/mpeg" }));
    }
    processChunk();
  });
}

/// Descarga el `.mystudio` completo desde `downloadUrl`, lo mezcla
/// entero (respetando volumen/pan/mute/solo actuales, igual que
/// ProjectViewer) y devuelve un MP3 liviano listo para subir a
/// Storage como preview del feed. `onProgress` (0-1) cubre SOLO la
/// etapa de codificación (la más larga con diferencia) — pensado para
/// que PublishModal pueda mostrar un porcentaje en vez de un texto
/// fijo durante una espera que puede tardar varios segundos.
export async function buildCommunityPreview(
  downloadUrl: string,
  onProgress?: (ratio: number) => void,
): Promise<MixdownResult> {
  const ctx = new AudioContext();
  try {
    const tracks = await loadDecodedTracks(downloadUrl, ctx);
    const { buffer, durationSeconds } = await renderMixdown(tracks);
    const blob = await encodeMp3(buffer, onProgress);
    return { blob, durationSeconds };
  } finally {
    await ctx.close();
  }
}
