// src/lib/barClock.ts
//
// Cuánto dura un compás, cuánto un beat, y dónde cae el próximo
// comienzo de compás. Tres cuentas chiquitas que hasta ahora vivían
// enterradas adentro del useMemo que dibuja la regla de tiempo del
// Arranger (`rulerTicks`), donde nadie más podía usarlas.
//
// Se sacan acá porque las necesita la pre-escucha sincronizada (entrar
// en el próximo compás en vez de pisar el pulso), y porque son
// exactamente las mismas que va a pedir el imán a la grilla musical.
// Tenerlas en un solo lugar es lo que evita que la regla dibuje los
// compases en un lado y el imán los calcule en otro.
//
// ─── La convención que hay que respetar ───────────────────────────────
//
// El BPM es SIEMPRE negras por minuto, sin importar el compás elegido.
// Es la convención estándar y es la que ya usa el Arranger: en 6/8 a
// 120 BPM la negra dura medio segundo, la corchea un cuarto, y el
// compás son seis corcheas = 1,5 s. Derivar el beat del denominador en
// vez de asumir que "beat = negra" es lo que hace que 6/8 y 7/8 caigan
// bien y no solo el 4/4.

/** Duración de una negra, en segundos. */
export function secondsPerQuarterNote(tempoBpm: number): number {
  return 60 / Math.max(1, tempoBpm);
}

/** Duración de UN beat — una nota del valor del denominador (negra en 4/4, corchea en 6/8). */
export function secondsPerBeat(tempoBpm: number, denominator: number): number {
  return secondsPerQuarterNote(tempoBpm) * (4 / Math.max(1, denominator));
}

/** Duración de un compás entero. */
export function secondsPerBar(tempoBpm: number, numerator: number, denominator: number): number {
  return secondsPerBeat(tempoBpm, denominator) * Math.max(1, numerator);
}

/**
 * El instante del AudioContext donde cae el próximo comienzo de compás
 * del arreglo en curso.
 *
 * Devuelve `null` cuando no hay nada sonando, y eso es deliberado: con
 * la línea de tiempo parada no hay ningún pulso al que engancharse, y
 * hacer esperar hasta un compás entero se sentiría como que el botón
 * no responde. Sin nada sonando, la pre-escucha arranca ya.
 */
export function nextBarContextTime(args: {
  isPlaying: boolean;
  /** ctx.currentTime del momento en que arrancó la reproducción. */
  playStartContextTime: number;
  /** Segundo del arreglo en el que arrancó. */
  playheadAtStart: number;
  /** ctx.currentTime de ahora. */
  contextTime: number;
  secondsPerBar: number;
}): number | null {
  const { isPlaying, playStartContextTime, playheadAtStart, contextTime } = args;
  const barLength = args.secondsPerBar;
  if (!isPlaying || !(barLength > 0)) return null;

  const playhead = playheadAtStart + (contextTime - playStartContextTime);
  // `floor(x) + 1` y no `ceil(x)`: cuando el cursor cae EXACTO sobre un
  // comienzo de compás, ceil devolvería ese mismo instante, que ya
  // pasó — la fuente arrancaría con retraso de un bloque y entraría
  // corrida. Siempre el SIGUIENTE.
  const nextBarIndex = Math.floor(playhead / barLength) + 1;
  return playStartContextTime + (nextBarIndex * barLength - playheadAtStart);
}
