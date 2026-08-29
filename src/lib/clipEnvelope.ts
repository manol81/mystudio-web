// src/lib/clipEnvelope.ts
//
// Envolvente de volumen POR CLIP (independiente del volumen de la
// pista): un gain base + fade-in/fade-out, arrastrables desde las
// esquinas superiores del clip en la UI (igual criterio visual que
// Ableton/Logic — la típica "línea diagonal" que cae desde el extremo).
//
// Se comparte entre DOS contextos que necesitan la MISMA matemática
// pero en líneas de tiempo distintas:
//   - Reproducción en vivo (AudioContext): puede arrancar a MITAD del
//     clip (el usuario hizo seek), así que hay que anclar la
//     automatización en `displayOffset` (cuánto del clip ya pasó).
//   - Render de exportación (OfflineAudioContext, wavExport.ts):
//     siempre renderiza el clip COMPLETO desde el principio, así que
//     displayOffset es siempre 0 — mismo código, caso particular.
//
// Todos los tiempos acá son "display seconds" — segundos de LÍNEA DE
// TIEMPO ya con el tempo aplicado (post playbackRate), no segundos
// nativos del AudioBuffer. Así el ancho en pantalla de un fade
// (fadeSeconds * pixelsPerSecond) es consistente sin importar el BPM
// del proyecto ni el original del sample.

export interface FadeBreakpoint {
  time: number;
  value: number;
}

/**
 * Puntos de quiebre de la envolvente: (0, silencio-o-gain),
 * (fadeIn, gain), (fadeOutStart, gain), (duración, silencio-o-gain).
 * Si fadeIn+fadeOut excede la duración del clip, se escalan
 * proporcionalmente (nunca se recortan feo ni se cruzan).
 */
export function computeFadeBreakpoints(
  displayDuration: number,
  gain: number,
  fadeInSeconds: number,
  fadeOutSeconds: number,
): FadeBreakpoint[] {
  let fadeIn = Math.max(0, Math.min(fadeInSeconds, displayDuration));
  let fadeOut = Math.max(0, Math.min(fadeOutSeconds, displayDuration));
  const total = fadeIn + fadeOut;
  if (total > displayDuration && total > 0) {
    const scale = displayDuration / total;
    fadeIn *= scale;
    fadeOut *= scale;
  }

  const points: FadeBreakpoint[] = [{ time: 0, value: fadeIn > 0 ? 0 : gain }];
  if (fadeIn > 0) points.push({ time: fadeIn, value: gain });
  const fadeOutStart = displayDuration - fadeOut;
  if (fadeOut > 0 && fadeOutStart > points[points.length - 1].time) {
    points.push({ time: fadeOutStart, value: gain });
  }
  points.push({ time: displayDuration, value: fadeOut > 0 ? 0 : gain });
  return points;
}

/** Interpola linealmente el valor de la envolvente en el instante `t`. */
export function valueAtBreakpoint(points: FadeBreakpoint[], t: number): number {
  if (points.length === 0) return 1;
  if (t <= points[0].time) return points[0].value;
  for (let i = 1; i < points.length; i++) {
    if (t <= points[i].time) {
      const prev = points[i - 1];
      const cur = points[i];
      if (cur.time === prev.time) return cur.value;
      const ratio = (t - prev.time) / (cur.time - prev.time);
      return prev.value + (cur.value - prev.value) * ratio;
    }
  }
  return points[points.length - 1].value;
}

/**
 * Programa la envolvente (gain base + fade in/out) sobre un AudioParam
 * real (gainNode.gain), en vivo u offline. `when` es el tiempo absoluto
 * del contexto que corresponde al instante `displayOffset` DENTRO del
 * clip — el llamador ya lo calculó para posicionar el AudioBufferSourceNode.
 */
export function scheduleGainEnvelope(
  param: AudioParam,
  when: number,
  displayOffset: number,
  displayDuration: number,
  gain: number,
  fadeInSeconds: number,
  fadeOutSeconds: number,
) {
  const points = computeFadeBreakpoints(displayDuration, gain, fadeInSeconds, fadeOutSeconds);
  const startValue = valueAtBreakpoint(points, displayOffset);
  param.cancelScheduledValues(when);
  param.setValueAtTime(startValue, when);
  for (const point of points) {
    if (point.time > displayOffset) {
      param.linearRampToValueAtTime(point.value, when - displayOffset + point.time);
    }
  }
}
