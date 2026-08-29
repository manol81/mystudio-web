// src/types/signalsmith-stretch.d.ts
//
// Tipos a mano para signalsmith-stretch (no trae los suyos) — basados
// en su README (node_modules/signalsmith-stretch/README.md) y en el
// código real del bundle. CASI todos los métodos del nodo viajan por
// un RPC de postMessage al AudioWorklet y devuelven una Promise —
// incluido `latency()`, que NO es un número síncrono (un bug real de
// esta feature fue tratarlo como si lo fuera).
//
// Estos son tipos SUELTOS (no un `declare module`) a propósito: el
// módulo en sí se carga en tiempo de ejecución desde
// /signalsmith-stretch.mjs (un asset estático, ver la nota larga en
// pitchShift.ts sobre por qué no se importa como paquete de npm
// normal), y TypeScript no resuelve bien un `declare module` para un
// specifier con forma de URL absoluta bajo `moduleResolution: bundler`
// — así que en pitchShift.ts el resultado de ese `import()` dinámico
// se castea a `SignalsmithStretchFactory` en vez de depender de esa
// resolución.

export interface StretchScheduleOptions {
  /** Tiempo del contexto de audio (segundos) para este cambio. */
  output?: number;
  active?: boolean;
  /** Posición dentro del buffer de entrada (segundos). */
  input?: number;
  /** Velocidad de reproducción — 1 = sin cambio de tempo. */
  rate?: number;
  /** Desafinación en semitonos — 0 = sin cambio de tono. */
  semitones?: number;
  tonalityHz?: number;
  formantSemitones?: number;
  formantCompensation?: boolean;
  formantBaseHz?: number;
  loopStart?: number;
  loopEnd?: number;
}

export interface StretchConfigureOptions {
  blockMs?: number | null;
  intervalMs?: number;
  splitComputation?: boolean;
  preset?: "default" | "cheaper";
}

export interface StretchNode extends AudioNode {
  readonly inputTime: number;
  schedule(options: StretchScheduleOptions): Promise<unknown>;
  start(when?: number, offset?: number, duration?: number): Promise<unknown>;
  stop(when?: number): Promise<unknown>;
  /** Agrega buffers (un Float32Array por canal) al final del buffer de entrada actual. Devuelve el nuevo fin (segundos). */
  addBuffers(buffers: Float32Array[]): Promise<number>;
  dropBuffers(toSeconds?: number): Promise<{ start: number; end: number } | void>;
  /** Latencia del algoritmo, en segundos — cuánto "silencio de arranque" hay que descartar del principio del render. ES ASYNC pese al nombre. */
  latency(): Promise<number>;
  configure(options: StretchConfigureOptions): Promise<unknown>;
  setUpdateInterval(seconds: number, callback?: (time: number) => void): Promise<unknown>;
}

export type SignalsmithStretchFactory = (
  audioContext: BaseAudioContext,
  channelOptions?: AudioWorkletNodeOptions,
) => Promise<StretchNode>;
