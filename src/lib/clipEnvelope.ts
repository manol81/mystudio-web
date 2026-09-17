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
 * Forma de la rampa. Ver la nota larga en clipCrossfade.ts: un CRUCE
 * entre dos audios distintos necesita potencia constante (dos rampas
 * lineales sumadas dan un pozo de −3 dB justo en la junta), y un fade
 * que no cruza con nada tiene que ser lineal, que además es lo que
 * aplica el motor nativo.
 */
export type FadeShape = "linear" | "equalPower";

/**
 * En cuántos tramos se aproxima una curva de potencia constante.
 *
 * El AudioParam solo sabe hacer rampas lineales y exponenciales entre
 * dos puntos; la curva se arma con puntos intermedios. Con 8 tramos el
 * error máximo contra el seno real queda por debajo de 0,006 (≈0,05 dB),
 * bastante menos que lo que cualquiera puede oír, y son 8 puntos, no
 * cientos.
 */
const EQUAL_POWER_SEGMENTS = 8;

/** Ganancia de una entrada de potencia constante en el progreso [0,1]. */
function equalPowerIn(progress: number): number {
  return Math.sin((progress * Math.PI) / 2);
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
  fadeInShape: FadeShape = "linear",
  fadeOutShape: FadeShape = "linear",
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
  if (fadeIn > 0) {
    if (fadeInShape === "equalPower") {
      for (let i = 1; i < EQUAL_POWER_SEGMENTS; i++) {
        const progress = i / EQUAL_POWER_SEGMENTS;
        points.push({ time: fadeIn * progress, value: gain * equalPowerIn(progress) });
      }
    }
    points.push({ time: fadeIn, value: gain });
  }
  const fadeOutStart = displayDuration - fadeOut;
  if (fadeOut > 0 && fadeOutStart > points[points.length - 1].time) {
    points.push({ time: fadeOutStart, value: gain });
    if (fadeOutShape === "equalPower") {
      for (let i = 1; i < EQUAL_POWER_SEGMENTS; i++) {
        const progress = i / EQUAL_POWER_SEGMENTS;
        // La salida es la entrada al revés: cos(x) = sin(1 - x). Así
        // las dos mitades del cruce suman exactamente 1 en potencia.
        points.push({
          time: fadeOutStart + fadeOut * progress,
          value: gain * equalPowerIn(1 - progress),
        });
      }
    }
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
  fadeInShape: FadeShape = "linear",
  fadeOutShape: FadeShape = "linear",
) {
  const points = computeFadeBreakpoints(
    displayDuration,
    gain,
    fadeInSeconds,
    fadeOutSeconds,
    fadeInShape,
    fadeOutShape,
  );
  const startValue = valueAtBreakpoint(points, displayOffset);
  param.cancelScheduledValues(when);
  param.setValueAtTime(startValue, when);
  for (const point of points) {
    if (point.time > displayOffset) {
      param.linearRampToValueAtTime(point.value, when - displayOffset + point.time);
    }
  }
}
