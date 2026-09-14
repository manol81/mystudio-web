// src/lib/arrangerDraft.ts
//
// El Arranger no perdía el trabajo por un bug puntual: no lo guardaba
// en ningún lado. Todo el arreglo vivía en `useState`, y "Crear
// Proyecto" no creaba nada — solo cerraba el formulario. Al cambiar de
// sección, Next desmonta la página y eso era todo. Sin localStorage,
// sin aviso, sin nada.
//
// Lo obvio sería autoguardar en la nube, y es justamente lo que NO hay
// que hacer: `handleExport` renderiza cada clip a WAV, arma un ZIP y lo
// sube a Storage. Correr eso al mover un clip sería lento, caro y
// además llenaría el Dashboard de versiones.
//
// Así que el borrador tiene DOS CAPAS, y cada una cubre lo que la otra
// no puede:
//
//   1. **Una instantánea viva, a nivel de módulo** (el mismo truco que
//      `sampleBufferCache`). Sobrevive a la navegación interna del
//      menú, que es donde se perdía el trabajo, y como no pasa por
//      JSON conserva los `AudioBuffer` tal cual: volver al Arranger
//      restaura el arreglo COMPLETO al instante, sin bajar nada. Muere
//      al recargar la pestaña, como cualquier variable de JavaScript.
//
//   2. **Una copia serializada en `localStorage`.** Sobrevive a
//      recargar y a cerrar el navegador. No puede guardar el audio —un
//      `AudioBuffer` son megabytes de PCM crudo y `localStorage` tiene
//      unos 5 MB en total—, así que guarda la RUTA de cada clip
//      (`audioPath`) y el sonido se vuelve a bajar del Banco al
//      restaurar.
//
// ⚠️ Lo que la capa 2 NO puede recuperar, y hay que decírselo al
// usuario en vez de restaurar un arreglo mudo: el audio que nunca
// estuvo en Storage. Son los clips subidos desde la computadora
// (`sampleId` con prefijo `local:`) y los reconstruidos al abrir un
// .mystudio (`imported:`). Sus bytes solo existieron en memoria. Por eso
// la restauración (`restoreStoredDraft`, en la página) cuenta los clips
// que no pudo recuperar y lo avisa, en vez de simular que está todo bien.

import type { MasterFx } from "@/lib/trackEffects";
import type { ArrangerTrack } from "@/lib/arrangerTypes";

/// Todo lo que define un arreglo, menos el audio ya decodificado.
export interface ArrangerDraft {
  projectTitle: string;
  projectTempoBpm: number;
  timeSignatureNumerator: number;
  timeSignatureDenominator: number;
  tracks: ArrangerTrack[];
  masterFx: MasterFx;
  /// El proyecto de la nube que estamos editando, si vinimos de uno
  /// (`?open=<cloudId>`). Viaja en el borrador para que recargar la
  /// página no convierta el próximo guardado en un duplicado.
  cloudProjectId: string | null;
  /// Si hay cambios posteriores al último guardado en la nube. Es lo
  /// que decide si avisar antes de cerrar la pestaña.
  isDirty: boolean;
  savedAt: number;
}

/// Un clip sin lo que no se puede serializar. El audio se recupera por
/// `audioPath`; los picos se recalculan (son una función del buffer, no
/// vale la pena guardar 160 pares de floats por clip).
type StoredClip = Omit<ArrangerTrack["clips"][number], "buffer" | "peaks">;

interface StoredTrack extends Omit<ArrangerTrack, "clips"> {
  clips: StoredClip[];
}

export interface StoredArrangerDraft extends Omit<ArrangerDraft, "tracks"> {
  tracks: StoredTrack[];
}

// ─── Capa 1: la instantánea viva ────────────────────────────────────────

let liveDraft: ArrangerDraft | null = null;

/// Guarda el arreglo en las dos capas. Llamar con debounce: la capa 1 es
/// gratis (una asignación) pero la 2 serializa el arreglo entero.
export function rememberArrangerDraft(uid: string, draft: ArrangerDraft): void {
  liveDraft = draft;
  writeStoredDraft(uid, draft);
}

/// La instantánea viva, si la hay. NO la consume: volver a entrar y
/// salir del Arranger sin tocar nada tiene que seguir encontrándola.
export function peekLiveArrangerDraft(): ArrangerDraft | null {
  return liveDraft;
}

// ─── Capa 2: localStorage ───────────────────────────────────────────────

/// La clave lleva el uid: dos personas que comparten la computadora no
/// tienen por qué verse el borrador, y restaurar el arreglo de otro
/// sería peor que no restaurar nada.
function storageKey(uid: string): string {
  return `mystudio.arranger.draft.${uid}`;
}

/// Saca del clip lo único que no se puede serializar. Se copia y se
/// borran esos dos campos en vez de listar a mano los que sí van: así,
/// si mañana el clip gana una propiedad nueva, entra sola al borrador en
/// vez de perderse en silencio.
function withoutAudio(clip: ArrangerTrack["clips"][number]): StoredClip {
  const copy: Partial<ArrangerTrack["clips"][number]> = { ...clip };
  delete copy.buffer;
  delete copy.peaks;
  return copy as StoredClip;
}

function stripAudio(tracks: ArrangerDraft["tracks"]): StoredTrack[] {
  return tracks.map((track) => ({ ...track, clips: track.clips.map(withoutAudio) }));
}

/// Firma del CONTENIDO del arreglo: todo lo que el usuario puede
/// cambiar, y nada más. Deja afuera `isDirty` y `savedAt` a propósito —
/// si entraran, la firma cambiaría sola con el tiempo y el arreglo
/// figuraría como modificado sin que nadie lo tocara.
///
/// Es lo que permite distinguir "esto cambió desde el último guardado en
/// la nube" de "esto es lo mismo que acabo de restaurar", que es la
/// diferencia entre avisar y molestar.
export function arrangementSignature(draft: ArrangerDraft): string {
  return JSON.stringify({
    projectTitle: draft.projectTitle,
    projectTempoBpm: draft.projectTempoBpm,
    timeSignatureNumerator: draft.timeSignatureNumerator,
    timeSignatureDenominator: draft.timeSignatureDenominator,
    cloudProjectId: draft.cloudProjectId,
    masterFx: draft.masterFx,
    tracks: stripAudio(draft.tracks),
  });
}

function writeStoredDraft(uid: string, draft: ArrangerDraft): void {
  try {
    const stored: StoredArrangerDraft = { ...draft, tracks: stripAudio(draft.tracks) };
    window.localStorage.setItem(storageKey(uid), JSON.stringify(stored));
  } catch {
    // Cuota llena, modo privado, o el usuario bloqueó el
    // almacenamiento. No se le dice nada: la capa 1 sigue funcionando y
    // avisar de esto en el medio de armar un tema no le sirve a nadie.
  }
}

export function readStoredArrangerDraft(uid: string): StoredArrangerDraft | null {
  try {
    const raw = window.localStorage.getItem(storageKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredArrangerDraft;
    // Un borrador sin pistas no tiene nada que ofrecer, y preguntarle
    // al usuario si quiere recuperar la nada es peor que no preguntar.
    if (!Array.isArray(parsed.tracks) || parsed.tracks.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

/// Borra las dos capas. Solo lo llaman las dos acciones en las que el
/// usuario pide explícitamente empezar de cero: "Crear Proyecto" y
/// "Descartar".
///
/// A propósito NO se llama al guardar en la nube. Podría parecer que ahí
/// el borrador deja de hacer falta, pero es al revés: es lo que permite
/// irse del Arranger y volver sin tener que bajar el proyecto entero de
/// nuevo. Guardar no cambia qué hay en el borrador, solo que deja de
/// haber algo en riesgo — eso viaja en `isDirty`.
export function clearArrangerDraft(uid: string): void {
  liveDraft = null;
  try {
    window.localStorage.removeItem(storageKey(uid));
  } catch {
    // Ver writeStoredDraft.
  }
}

/// Cuánto hace que se guardó, en texto corto, para el cartel de
/// recuperación. Sin librería de fechas: son cuatro casos.
export function describeDraftAge(savedAt: number): string {
  const minutes = Math.floor((Date.now() - savedAt) / 60000);
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} ${days === 1 ? "día" : "días"}`;
}
