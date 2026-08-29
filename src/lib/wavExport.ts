// src/lib/wavExport.ts
//
// Renderiza un AudioBuffer decodificado a WAV mono PCM16 44.1kHz —
// EXACTAMENTE el formato que espera el motor nativo del lado Flutter
// (ver native_engine.cpp, loadWavFile: rechaza cualquier WAV que no
// sea bitsPerSample==16, y todo el resto del motor asume 44100 fijo).
// Los samples del Banco de Sonidos pueden venir en cualquier sample
// rate/profundidad de bits/cantidad de canales (WAV o MP3) — esto es
// lo que los deja listos para viajar dentro de un .mystudio real.
//
// Ajuste de tempo (Web Arranger): el AudioBuffer que llega acá YA
// viene con el tempo resuelto — el llamador (handleExport en
// arranger/page.tsx) lo pasa por src/lib/timeStretch.ts (SoundTouchJS,
// preserva el tono) ANTES de invocar renderClipToWav, exactamente el
// mismo buffer "estirado" que usa la reproducción en vivo. Por eso acá
// NO hay ningún playbackRate que aplicar — el source siempre reproduce
// a rate=1. Así el resultado EXPORTADO suena IDÉNTICO (mismo tono, no
// el efecto vinilo de antes) a lo que ya sonó en el preview durante la
// edición.
//
// Volumen/fade por clip: el formato .mystudio no tiene forma de guardar
// una envolvente de volumen por clip (el manifest solo tiene
// volumen/pan a nivel de PISTA) — así que en vez de intentar extender
// ese formato, el gain/fade-in/fade-out se HORNEA directamente en las
// muestras del WAV exportado acá mismo, con el mismo GainNode +
// scheduleGainEnvelope que usa la reproducción en vivo. El resultado
// que se sincroniza al celular ya suena con el fade aplicado, sin que
// el motor nativo (Flutter/C++) necesite saber que existió.

import { scheduleGainEnvelope } from "./clipEnvelope";

const TARGET_SAMPLE_RATE = 44100;

export interface RenderedClipAudio {
  bytes: Uint8Array;
  durationSamples: number;
  sampleRate: number;
}

/**
 * Renderiza la ventana [sourceOffsetSeconds, sourceOffsetSeconds +
 * sourceDurationSeconds) de [buffer] a mono/PCM16/44.1kHz — [buffer]
 * se asume YA al tempo correcto (ver nota de arriba) y las ventanas
 * de offset/duración YA convertidas a la base de tiempo de ESE buffer
 * (el llamador las divide por el rate de time-stretch antes de pasarlas).
 * Aplica también la envolvente de volumen del clip ([gain] base +
 * [fadeInSeconds]/[fadeOutSeconds]). Por defecto renderiza el buffer
 * COMPLETO (offset 0, toda la duración) sin fades. Devuelve los bytes
 * de un WAV completo (con header), listos para meter tal cual en el ZIP.
 */
export async function renderClipToWav(
  buffer: AudioBuffer,
  sourceOffsetSeconds = 0,
  sourceDurationSeconds: number = buffer.duration,
  gain = 1,
  fadeInSeconds = 0,
  fadeOutSeconds = 0,
): Promise<RenderedClipAudio> {
  const outputFrames = Math.max(1, Math.ceil(sourceDurationSeconds * TARGET_SAMPLE_RATE));

  // numberOfChannels: 1 — el propio OfflineAudioContext hace el downmix
  // a mono (misma idea que loadWavFile del lado C++, que promedia
  // canales), sin tener que promediar samples a mano acá.
  const offlineCtx = new OfflineAudioContext(1, outputFrames, TARGET_SAMPLE_RATE);
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  // playbackRate se queda en 1 (default) — el tempo ya se resolvió
  // ANTES con time-stretch real (ver la nota de arriba), así que acá
  // NO hay que volver a resamplear ni tocar el pitch.
  const gainNode = offlineCtx.createGain();
  source.connect(gainNode);
  gainNode.connect(offlineCtx.destination);
  // El export siempre renderiza el clip COMPLETO desde su propio
  // principio (displayOffset = 0) — a diferencia de la reproducción en
  // vivo, acá nunca hace falta "arrancar a mitad" del fade.
  scheduleGainEnvelope(gainNode.gain, 0, 0, sourceDurationSeconds, gain, fadeInSeconds, fadeOutSeconds);
  // start(when, offset, duration) — offset/duration en la base de
  // tiempo NATIVA de [buffer] (que YA es la de salida, ver arriba).
  source.start(0, sourceOffsetSeconds, sourceDurationSeconds);

  const rendered = await offlineCtx.startRendering();
  const samples = rendered.getChannelData(0);
  const bytes = encodeWavMono16(samples, TARGET_SAMPLE_RATE);

  return {
    bytes,
    durationSamples: rendered.length,
    sampleRate: TARGET_SAMPLE_RATE,
  };
}

/** Codifica samples float [-1, 1] mono a un WAV PCM16 completo (header + data). */
export function encodeWavMono16(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // tamaño del chunk fmt
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}
