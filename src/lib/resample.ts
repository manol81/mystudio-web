// Remuestreo lineal — la RED que evita volver a mandar audio lento.
//
// Por qué existe (bug real, 2026-09-21): `decodeAudioData` devuelve el
// audio a la tasa del CONTEXTO que decodifica, no a la del archivo. El
// paquete liviano de pistas y el preview de la Comunidad decodificaban
// con un `new AudioContext()` (48 kHz en la mayoría de las máquinas) y
// después copiaban esas muestras UNA A UNA dentro de un buffer
// declarado a 32 kHz. Copiar 48.000 muestras y decir que son un segundo
// a 32.000 hace dos cosas a la vez: el audio suena **1,5× más lento** y
// se **corta al llegar a los dos tercios**, porque el resto ya no entra.
//
// Lo notó un colaborador al abrir en su app una canción compartida: "se
// escucha a un tempo mucho menor que el original". El visor web nunca
// lo mostró porque ahí la mezcla se pide a `ctx.sampleRate`, que SÍ es
// la tasa real de los buffers.
//
// La causa se corrige decodificando directamente a la tasa de destino
// (ver loadDecodedTracks), que usa el remuestreador del navegador. Esto
// es la segunda línea de defensa: cualquier consumidor que mezcle
// muestra a muestra pasa los datos por acá, así que un buffer en otra
// tasa se adapta en vez de sonar mal en silencio. Cuando las tasas
// coinciden —el caso normal— devuelve los mismos datos sin copiar nada.
//
// Lineal y no sinc: acá solo corre en el camino de respaldo, y una
// interpolación lineal suena infinitamente mejor que no remuestrear.

/**
 * Lleva [data] de [fromRate] a [toRate] por interpolación lineal.
 *
 * Devuelve el MISMO Float32Array si las tasas coinciden o si alguna no
 * es utilizable (0, negativa, NaN): sin una tasa confiable, inventar un
 * factor sería peor que no tocar nada.
 */
export function resampleLinear(
  data: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (
    !Number.isFinite(fromRate) ||
    !Number.isFinite(toRate) ||
    fromRate <= 0 ||
    toRate <= 0 ||
    fromRate === toRate ||
    data.length === 0
  ) {
    return data;
  }

  const ratio = toRate / fromRate;
  // round y no ceil: con ceil, un remuestreo de ida y vuelta iría
  // sumando una muestra cada vez.
  const outLength = Math.max(1, Math.round(data.length * ratio));
  const out = new Float32Array(outLength);
  const step = 1 / ratio;

  for (let i = 0; i < outLength; i++) {
    const pos = i * step;
    const left = Math.floor(pos);
    const right = left + 1;
    const frac = pos - left;
    const a = data[left] ?? 0;
    // Más allá del final se repite la última muestra en vez de saltar a
    // cero: un salto a cero en el último frame es un chasquido.
    const b = right < data.length ? data[right] : a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}
