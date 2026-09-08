// src/lib/previewEncoder.worker.ts
//
// Codificación MP3 del preview de la Comunidad en un Web Worker (ver
// audioPreviewExport.ts). lamejs es JS puro y lento (varias veces más
// lento que el tiempo real en un celular): en el hilo principal
// trababa la página aunque cediera cada tanto con setTimeout. Acá corre
// aparte, la UI sigue fluida y el progreso llega por mensajes.
//
// Protocolo: recibe { left, right (Int16Array, transferidos),
// sampleRate, kbps }; emite { type: "progress", ratio } y al final
// { type: "done", blob } o { type: "error", message }.

import { Mp3Encoder } from "@breezystack/lamejs";

const MP3_BLOCK_SIZE = 1152;
const PROGRESS_EVERY_BLOCKS = 100;

interface EncodeRequest {
  left: Int16Array;
  right: Int16Array;
  sampleRate: number;
  kbps: number;
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<EncodeRequest>) => void) | null;
  postMessage: (msg: unknown) => void;
};

scope.onmessage = (e: MessageEvent<EncodeRequest>) => {
  try {
    const { left, right, sampleRate, kbps } = e.data;
    const encoder = new Mp3Encoder(2, sampleRate, kbps);
    // Uint8Array<ArrayBuffer> explícito: con TS 5.7+ el genérico por
    // defecto es ArrayBufferLike y Blob no lo acepta como BlobPart.
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let block = 0;
    for (let i = 0; i < left.length; i += MP3_BLOCK_SIZE, block++) {
      const mp3buf = encoder.encodeBuffer(
        left.subarray(i, i + MP3_BLOCK_SIZE),
        right.subarray(i, i + MP3_BLOCK_SIZE),
      );
      if (mp3buf.length > 0) chunks.push(new Uint8Array(mp3buf));
      if (block % PROGRESS_EVERY_BLOCKS === 0) {
        scope.postMessage({ type: "progress", ratio: i / left.length });
      }
    }
    const finalBuf = encoder.flush();
    if (finalBuf.length > 0) chunks.push(new Uint8Array(finalBuf));
    scope.postMessage({ type: "done", blob: new Blob(chunks, { type: "audio/mpeg" }) });
  } catch (err) {
    scope.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
