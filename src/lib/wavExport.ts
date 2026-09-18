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

import { scheduleGainEnvelope, type FadeShape } from "./clipEnvelope";

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
  fadeInShape: FadeShape = "linear",
  fadeOutShape: FadeShape = "linear",
  repeats = 1,
): Promise<RenderedClipAudio> {
  const totalSeconds = sourceDurationSeconds * Math.max(1, repeats);
  const outputFrames = Math.max(1, Math.ceil(totalSeconds * TARGET_SAMPLE_RATE));

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
  // Repeticiones con el loop NATIVO del nodo, igual que en la
  // reproducción en vivo: el empalme entre vuelta y vuelta lo resuelve
  // el motor al sample exacto. El `duration` de start() corta al final
  // aunque el loop esté activo, así que una repetición fraccionaria
  // (2,5 vueltas) sale cortada donde corresponde.
  if (repeats > 1) {
    source.loop = true;
    source.loopStart = sourceOffsetSeconds;
    source.loopEnd = sourceOffsetSeconds + sourceDurationSeconds;
  }
  // La envolvente se aplica sobre el LARGO TOTAL: el fade-out va al
  // final de la última repetición, no al final de la primera.
  scheduleGainEnvelope(
    gainNode.gain,
    0,
    0,
    totalSeconds,
    gain,
    fadeInSeconds,
    fadeOutSeconds,
    fadeInShape,
    fadeOutShape,
  );
  // start(when, offset, duration) — offset/duration en la base de
  // tiempo NATIVA de [buffer] (que YA es la de salida, ver arriba).
  source.start(0, sourceOffsetSeconds, totalSeconds);

  const rendered = await offlineCtx.startRendering();
  const samples = rendered.getChannelData(0);
  const bytes = encodeWavMono16(samples, TARGET_SAMPLE_RATE);

  return {
    bytes,
    durationSamples: rendered.length,
    sampleRate: TARGET_SAMPLE_RATE,
  };
}

/** Un clip dentro de una cadena, ya ubicado contra el arranque de esa cadena. */
export interface ChainPart {
  /** El buffer YA procesado (tempo + pitch), igual que en renderClipToWav. */
  buffer: AudioBuffer;
  sourceOffsetSeconds: number;
  sourceDurationSeconds: number;
  /** Cuántas veces se repite la ventana (1 = una sola pasada). */
  repeats: number;
  /** Cuántos segundos después del arranque de la CADENA entra este clip. */
  startOffsetSeconds: number;
  gain: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  fadeInShape: FadeShape;
  fadeOutShape: FadeShape;
}

/**
 * Aplana VARIOS clips solapados a un solo WAV, con el cruce ya horneado.
 *
 * ⚠️ Esto existe por el motor nativo de Android, no por la web. En
 * `renderBlock` (native_engine.cpp) la mezcla de una pista toma el
 * PRIMER clip que cubre cada frame y corta: el motor da por sentado que
 * los clips de una pista nunca se superponen. Mandar un .mystudio con
 * clips solapados no sonaría cruzado en el teléfono, sonaría con un
 * AGUJERO — el clip que gana en la zona del cruce es justo el que se
 * está yendo a silencio. Aplanando la cadena acá, el teléfono recibe un
 * clip común y corriente que ya trae el cruce adentro.
 *
 * El cruce se suma en un OfflineAudioContext, o sea con la MISMA
 * envolvente que sonó en el navegador durante la edición: "lo que
 * escuchás es lo que exportás" sigue valiendo.
 */
export async function renderClipChainToWav(
  parts: readonly ChainPart[],
  totalDurationSeconds: number,
): Promise<RenderedClipAudio> {
  const outputFrames = Math.max(1, Math.ceil(totalDurationSeconds * TARGET_SAMPLE_RATE));
  const offlineCtx = new OfflineAudioContext(1, outputFrames, TARGET_SAMPLE_RATE);

  for (const part of parts) {
    const source = offlineCtx.createBufferSource();
    source.buffer = part.buffer;
    const partSeconds = part.sourceDurationSeconds * Math.max(1, part.repeats);
    if (part.repeats > 1) {
      source.loop = true;
      source.loopStart = part.sourceOffsetSeconds;
      source.loopEnd = part.sourceOffsetSeconds + part.sourceDurationSeconds;
    }
    const gainNode = offlineCtx.createGain();
    source.connect(gainNode);
    gainNode.connect(offlineCtx.destination);
    scheduleGainEnvelope(
      gainNode.gain,
      part.startOffsetSeconds,
      0,
      partSeconds,
      part.gain,
      part.fadeInSeconds,
      part.fadeOutSeconds,
      part.fadeInShape,
      part.fadeOutShape,
    );
    source.start(part.startOffsetSeconds, part.sourceOffsetSeconds, partSeconds);
  }

  const rendered = await offlineCtx.startRendering();
  return {
    bytes: encodeWavMono16(rendered.getChannelData(0), TARGET_SAMPLE_RATE),
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
