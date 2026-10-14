// Programar UN clip en un contexto de Web Audio, con su ventana
// recortada, su volumen, sus fades y su curva de volumen (2026-10-14).
//
// Antes esto vivía copiado adentro de ProjectViewer, y el MP3 del feed
// (audioPreviewExport) tenía su propia versión que reproducía el WAV
// ENTERO: sin recorte, sin volumen del clip y sin fades. Un proyecto sin
// efectos publicado con clips recortados sonaba en el feed con el audio
// que la persona había sacado. Es la misma lección del paquete lento y
// del manifiesto: dos copias de una regla terminan diciendo cosas
// distintas. Ahora hay una.
//
// El camino CON efectos no pasa por acá: lo resuelve writeClipInto
// (projectMixdown.ts) muestra a muestra, con las MISMAS reglas.

import { clipDurationSeconds, type MixdownClip } from "@/lib/projectMixdown";
import { scheduleEnvelope } from "@/lib/clipGainEnvelope";

/// Programa [clip] para que suene en [outputs], con la reproducción
/// arrancando en el segundo [fromSeconds] del proyecto en el instante
/// [startContextTime] del contexto. Devuelve la fuente (para poder
/// pararla), o `null` si el clip ya terminó antes de [fromSeconds].
export function scheduleClip(
  ctx: BaseAudioContext,
  clip: MixdownClip,
  outputs: AudioNode[],
  startContextTime: number,
  fromSeconds: number,
): AudioBufferSourceNode | null {
  // Cuánto de este clip SUENA: su ventana recortada, no el archivo
  // entero (formatVersion 3 del .mystudio).
  const windowStart = Math.max(0, clip.sourceOffsetSeconds ?? 0);
  const windowDuration = clipDurationSeconds(clip);
  const clipEnd = clip.startSeconds + windowDuration;
  if (clipEnd <= fromSeconds) return null; // ya terminó antes del punto de arranque

  // Cuánto de la ventana ya pasó al arrancar desde `fromSeconds`.
  const intoClip = Math.max(0, fromSeconds - clip.startSeconds);
  const when = startContextTime + Math.max(0, clip.startSeconds - fromSeconds);

  const source = ctx.createBufferSource();
  source.buffer = clip.buffer;

  // Volumen y fades del CLIP, en su propio nodo: son distintos del
  // volumen de la pista (que vive en los nodos de [outputs] y el oyente
  // puede mover con mute/solo sin rehacer nada).
  const clipGain = ctx.createGain();
  const gain = clip.gain ?? 1;
  const fadeIn = Math.max(0, clip.fadeInSeconds ?? 0);
  const fadeOut = Math.max(0, clip.fadeOutSeconds ?? 0);
  // ⚠️ Rampas LINEALES, como renderBlock del motor nativo y como
  // writeClipInto — no exponenciales, que además no pueden partir de 0
  // en Web Audio.
  clipGain.gain.setValueAtTime(gain, when);
  if (fadeIn > intoClip) {
    // Entrando a mitad del fade-in: se arranca en el valor que la rampa
    // ya tenía, no de cero.
    clipGain.gain.setValueAtTime(gain * (intoClip / fadeIn), when);
    clipGain.gain.linearRampToValueAtTime(gain, when + (fadeIn - intoClip));
  } else if (fadeIn > 0) {
    clipGain.gain.setValueAtTime(gain, when);
  }
  if (fadeOut > 0) {
    const fadeOutStart = clip.startSeconds + windowDuration - fadeOut;
    const at = startContextTime + Math.max(0, fadeOutStart - fromSeconds);
    clipGain.gain.setValueAtTime(
      gain * Math.min(1, Math.max(0, (clipEnd - Math.max(fromSeconds, fadeOutStart)) / fadeOut)),
      at,
    );
    clipGain.gain.linearRampToValueAtTime(0, startContextTime + (clipEnd - fromSeconds));
  }
  for (const out of outputs) clipGain.connect(out);

  // La curva va en un nodo APARTE: sus rampas y las de los fades se
  // multiplican, igual que en el motor (volumen × curva × fade). En un
  // solo AudioParam se pisarían unas a otras.
  if (clip.envelope) {
    const envGain = ctx.createGain();
    const sourceFrom = windowStart + intoClip;
    scheduleEnvelope(envGain.gain, clip.envelope, sourceFrom, when, windowStart + windowDuration);
    source.connect(envGain);
    envGain.connect(clipGain);
  } else {
    source.connect(clipGain);
  }

  // offset y duration acotados a la ventana: sin `duration`, un clip
  // recortado seguiría sonando hasta el final del archivo.
  source.start(when, windowStart + intoClip, windowDuration - intoClip);
  return source;
}
