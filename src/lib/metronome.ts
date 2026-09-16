// src/lib/metronome.ts
//
// El clic del metrónomo en el Arranger web.
//
// ⚠️ Sirve para algo DISTINTO que el metrónomo de la app. En el
// teléfono se graba, y ahí el clic es lo que mantiene a la persona en
// tiempo. En el navegador no se graba nada: acá el clic es una
// HERRAMIENTA DE VERIFICACIÓN. Si el arreglo está armado y el clic se
// despega de los clips, o el tempo del proyecto está mal, o el sample
// no era del BPM que declaraba su ficha. Es la forma más rápida de
// darse cuenta, y sin él ese error se descubre recién al exportar.
//
// El "beat" acá es UNA nota del valor del DENOMINADOR del compás
// (negra en 4/4, corchea en 6/8), igual que las marcas de la regla de
// tiempo — ver barClock.ts. El BPM sigue siendo negras por minuto sin
// importar el compás.

/**
 * Índices de beat cuyo instante cae en [fromSeconds, toSeconds).
 *
 * El intervalo es semiabierto a propósito: la ventana de una pasada
 * empieza justo donde terminó la anterior, y con los dos extremos
 * cerrados el beat del borde sonaría DOS VECES — un doble golpe en
 * cada compás, que es exactamente el síntoma que el metrónomo tendría
 * que ayudar a descartar.
 */
export function beatIndicesInWindow(
  fromSeconds: number,
  toSeconds: number,
  beatSeconds: number,
): number[] {
  if (!(beatSeconds > 0) || !(toSeconds > fromSeconds)) return [];

  const firstIndex = Math.max(0, Math.ceil(fromSeconds / beatSeconds));
  const indices: number[] = [];
  for (let index = firstIndex; index * beatSeconds < toSeconds; index++) {
    // Guarda contra un beatSeconds absurdamente chico (un BPM disparado
    // por un campo de texto a medio escribir): antes que trabar la
    // pestaña agendando miles de clics, se corta.
    if (indices.length >= 256) break;
    indices.push(index);
  }
  return indices;
}

/** El primer beat de cada compás va acentuado: es lo que deja contar. */
export function isDownbeat(beatIndex: number, beatsPerBar: number): boolean {
  if (!(beatsPerBar > 0)) return true;
  return beatIndex % beatsPerBar === 0;
}

/**
 * Un clic sintetizado, sin ningún archivo de audio: una senoide corta
 * con caída exponencial. No se baja nada y suena igual en cualquier
 * máquina.
 *
 * Va DIRECTO a `destination`, nunca por las pistas: el metrónomo no es
 * parte del arreglo. Tiene que quedar afuera del mute/solo, del volumen
 * de las pistas y —sobre todo— de lo que se exporta.
 */
export function scheduleClick(
  ctx: BaseAudioContext,
  destination: AudioNode,
  atTime: number,
  accent: boolean,
  volume: number,
): OscillatorNode {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.frequency.value = accent ? 1600 : 1000;
  oscillator.type = "sine";

  // Rampa de 1 ms para entrar: arrancar de golpe en la amplitud plena
  // mete un chasquido de banda ancha encima del propio clic.
  const peak = Math.max(0, volume) * (accent ? 0.5 : 0.32);
  gain.gain.setValueAtTime(0.0001, atTime);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), atTime + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, atTime + 0.05);

  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start(atTime);
  oscillator.stop(atTime + 0.06);
  // Se devuelve para poder CALLARLO: los clics se agendan con más de un
  // segundo de anticipación, así que pausar sin esto dejaría sonando
  // varios después de que el arreglo ya se detuvo.
  return oscillator;
}
