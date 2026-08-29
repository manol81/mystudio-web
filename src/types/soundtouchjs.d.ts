// src/types/soundtouchjs.d.ts
//
// El paquete "soundtouchjs" (dist/soundtouch.js) no trae sus propios
// tipos — esta es una declaración mínima, a mano, de SOLO lo que
// realmente usamos en src/lib/timeStretch.ts. Verificado contra el
// bundle real instalado (node_modules/soundtouchjs/dist/soundtouch.js)
// antes de escribir esto, no adivinado.

declare module "soundtouchjs" {
  export class SoundTouch {
    tempo: number;
    pitch: number;
  }

  export interface SoundTouchSource {
    extract(target: Float32Array, numFrames: number, position: number): number;
  }

  export class SimpleFilter {
    constructor(sourceSound: SoundTouchSource, pipe: SoundTouch);
    extract(target: Float32Array, numFrames: number): number;
  }

  export class WebAudioBufferSource implements SoundTouchSource {
    constructor(buffer: AudioBuffer);
    extract(target: Float32Array, numFrames: number, position: number): number;
  }
}
