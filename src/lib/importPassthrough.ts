// src/lib/importPassthrough.ts
//
// Que guardar desde el Arranger no le saque al teléfono lo que la web no
// sabe editar (2026-10-20). Antes, al guardar, CADA clip se volvía a
// renderizar a un WAV nuevo y las tomas de la app (`takes` por pista) no
// se escribían: el proyecto volvía al teléfono sin tomas, y aunque se
// hubieran transportado, sus clips ya no apuntaban a los archivos de las
// tomas, que es como la app sabe qué toma suena en cada parte.
//
// Ahora:
//   · Al importar un .mystudio se guardan los BYTES originales de cada
//     archivo (en memoria, acá) y cada clip recuerda de qué entrada del
//     manifiesto vino y cómo estaba (`ClipPassthrough`).
//   · Al guardar, un clip que sigue INTACTO (misma posición, recorte,
//     volumen, fades, tono y repeticiones) viaja tal cual vino: el mismo
//     archivo y las mismas claves del manifiesto (curvas incluidas), sin
//     re-renderizar. Si alguien lo tocó, se renderiza como siempre.
//   · Las tomas de cada pista (`ImportedTake`) se devuelven con su
//     archivo. Como los clips intactos nombran el MISMO archivo, la app
//     vuelve a reconocer qué toma suena en cada parte.
//
// Los bytes viven solo en memoria: un borrador restaurado después de
// recargar la página ya no los tiene, y entonces se renderiza todo como
// antes y las tomas no viajan (lo mismo que pasa con el audio de un
// .mystudio importado, ver arrangerDraft.ts).

/// Los bytes de los archivos del último .mystudio importado, por clave
/// `${importId}/${fileName}`.
const fileBytes = new Map<string, Uint8Array>();

/// Arranca una importación nueva: olvida los archivos de la anterior
/// (importar carga OTRO arreglo y vacía el historial, así que nada puede
/// volver a nombrarlos) y devuelve el id para las claves de esta.
export function beginImport(): string {
  fileBytes.clear();
  return `imp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function rememberImportedFile(fileKey: string, bytes: Uint8Array): void {
  fileBytes.set(fileKey, bytes);
}

export function importedFileBytes(fileKey: string): Uint8Array | undefined {
  return fileBytes.get(fileKey);
}

/// Lo que define cómo suena un clip importado. Si alguno cambió, el clip
/// ya no es el que vino y hay que renderizarlo.
export interface PassthroughSnapshot {
  startSeconds: number;
  sourceOffsetSeconds: number;
  sourceDurationSeconds: number;
  gain: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  pitchShift: number;
  repeats: number;
}

export interface ClipPassthrough {
  fileKey: string;
  /// La entrada del manifiesto tal cual vino (sin `audioFileName`, que
  /// se pone al guardar).
  manifestClip: Record<string, unknown>;
  snapshot: PassthroughSnapshot;
}

export interface ImportedTake {
  fileKey: string;
  /// La entrada `takes[]` del manifiesto tal cual vino.
  take: Record<string, unknown>;
}

export function snapshotOf(clip: PassthroughSnapshot): PassthroughSnapshot {
  return {
    startSeconds: clip.startSeconds,
    sourceOffsetSeconds: clip.sourceOffsetSeconds,
    sourceDurationSeconds: clip.sourceDurationSeconds,
    gain: clip.gain,
    fadeInSeconds: clip.fadeInSeconds,
    fadeOutSeconds: clip.fadeOutSeconds,
    pitchShift: clip.pitchShift,
    repeats: clip.repeats,
  };
}

const SNAPSHOT_KEYS: (keyof PassthroughSnapshot)[] = [
  "startSeconds",
  "sourceOffsetSeconds",
  "sourceDurationSeconds",
  "gain",
  "fadeInSeconds",
  "fadeOutSeconds",
  "pitchShift",
  "repeats",
];

/// true si el clip sigue exactamente como vino y sus bytes originales
/// están en memoria: puede viajar sin re-renderizar.
export function isPassthroughIntact(
  clip: PassthroughSnapshot & { passthrough?: ClipPassthrough },
): boolean {
  const p = clip.passthrough;
  if (!p || !fileBytes.has(p.fileKey)) return false;
  return SNAPSHOT_KEYS.every((k) => Math.abs(clip[k] - p.snapshot[k]) < 1e-6);
}

/// Nombres de archivo para lo que viaja sin renderizar: uno por archivo
/// original, aunque lo nombren varios clips y tomas (así siguen
/// compartiéndolo del otro lado, que es lo que une un clip con su toma).
export class PassthroughFiles {
  private readonly names = new Map<string, string>();

  /// El nombre en el ZIP para [fileKey], o null si sus bytes ya no están.
  nameFor(fileKey: string): string | null {
    const known = this.names.get(fileKey);
    if (known) return known;
    if (!fileBytes.has(fileKey)) return null;
    const name = `src_${this.names.size}.wav`;
    this.names.set(fileKey, name);
    return name;
  }

  /// Cada archivo a escribir en el ZIP, una sola vez.
  entries(): { name: string; bytes: Uint8Array }[] {
    return [...this.names].map(([key, name]) => ({ name, bytes: fileBytes.get(key)! }));
  }
}
