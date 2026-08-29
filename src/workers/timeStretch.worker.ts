/// <reference lib="webworker" />

// src/workers/timeStretch.worker.ts
//
// El cálculo de time-stretching (SoundTouchJS, WSOLA) corre ACÁ, en un
// hilo aparte — un Worker NO tiene Web Audio API (no existe
// AudioContext/AudioBuffer dentro de un Worker común, solo dentro del
// AudioWorkletGlobalScope, que es otro mecanismo mucho más restringido
// pensado para procesar audio EN TIEMPO REAL, no para esto). Por eso
// acá se trabaja con Float32Array planos (los canales del AudioBuffer,
// copiados ANTES de mandarlos — ver timeStretchWorkerClient.ts) en vez
// de con un AudioBuffer real; el AudioBuffer final se reconstruye en
// el hilo principal a partir de lo que este worker devuelve — esa
// reconstrucción es barata (createBuffer + copyToChannel), la parte
// CARA (el DSP en sí) es la que queda completamente fuera del hilo
// principal, así que no genera jank en la interfaz durante el drag & drop.

import { SimpleFilter, SoundTouch, type SoundTouchSource } from "soundtouchjs";

interface StretchRequest {
  type: "stretch";
  requestId: string;
  left: Float32Array;
  right: Float32Array | null;
  rate: number;
}

// Mismo contrato que WebAudioBufferSource (verificado contra el bundle
// real de soundtouchjs), pero leyendo de Float32Array planos en vez de
// un AudioBuffer — que acá no existe.
class RawChannelSource implements SoundTouchSource {
  constructor(
    private readonly left: Float32Array,
    private readonly right: Float32Array,
  ) {}

  extract(target: Float32Array, numFrames: number, position: number): number {
    for (let i = 0; i < numFrames; i++) {
      target[i * 2] = this.left[i + position] ?? 0;
      target[i * 2 + 1] = this.right[i + position] ?? 0;
    }
    return Math.max(0, Math.min(numFrames, this.left.length - position));
  }
}

const EXTRACT_CHUNK_FRAMES = 4096;

self.onmessage = (event: MessageEvent<StretchRequest>) => {
  const { type, requestId, left, right, rate } = event.data;
  if (type !== "stretch") return;

  try {
    const soundTouch = new SoundTouch();
    soundTouch.tempo = rate;
    // TODO(pitch-shifting futuro): acá es donde se conectaría
    // `pitchShift` de ArrangerClip (ver arranger/page.tsx) —
    // `soundTouch.pitch = 2 ** (pitchShift / 12)` en vez de este 1 fijo.
    soundTouch.pitch = 1;

    const source = new RawChannelSource(left, right ?? left);
    const filter = new SimpleFilter(source, soundTouch);

    const chunks: Float32Array[] = [];
    const scratch = new Float32Array(EXTRACT_CHUNK_FRAMES * 2); // SoundTouch trabaja siempre intercalado estéreo
    let totalFrames = 0;
    let framesExtracted: number;
    do {
      framesExtracted = filter.extract(scratch, EXTRACT_CHUNK_FRAMES);
      if (framesExtracted > 0) {
        chunks.push(scratch.slice(0, framesExtracted * 2));
        totalFrames += framesExtracted;
      }
    } while (framesExtracted > 0);

    const outLeft = new Float32Array(totalFrames);
    const outRight = right ? new Float32Array(totalFrames) : null;
    let offset = 0;
    for (const chunk of chunks) {
      const frames = chunk.length / 2;
      for (let i = 0; i < frames; i++) {
        outLeft[offset + i] = chunk[i * 2];
        if (outRight) outRight[offset + i] = chunk[i * 2 + 1];
      }
      offset += frames;
    }

    const transferables: Transferable[] = [outLeft.buffer];
    if (outRight) transferables.push(outRight.buffer);
    (self as unknown as Worker).postMessage(
      { type: "stretch-result", requestId, left: outLeft, right: outRight, frameCount: totalFrames },
      transferables,
    );
  } catch (err) {
    (self as unknown as Worker).postMessage({
      type: "stretch-error",
      requestId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
