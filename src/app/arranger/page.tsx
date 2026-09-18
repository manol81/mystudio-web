"use client";

// Web Sample Arranger — secuenciador multipista para armar canciones
// con samples del Banco de Sonidos directamente en el navegador, antes
// de sincronizarlas al celular. Arma un proyecto NUEVO desde cero (v1
// no carga proyectos ya sincronizados para editarlos — eso queda para
// una iteración futura) y lo exporta como un .mystudio real, 100%
// compatible con lo que ya lee/escribe ProjectBackupService del lado
// Flutter (ver la nota de REGLA CRÍTICA en handleExport).
//
// Motor de audio: cada PISTA tiene un par de nodos PERSISTENTES
// (StereoPannerNode -> GainNode -> destination) que viven mientras la
// pista exista — volumen/pan/mute/solo actualizan sus .value en vivo
// vía useEffect, así que suenan de inmediato incluso a mitad de la
// reproducción, sin tener que rearmar nada. Cada fuente (un clip
// sonando) se conecta a esos nodos ya existentes; nunca arma su propio
// gain/pan por separado (eso fue el bug: antes el gain se calculaba
// UNA vez al arrancar Play y nunca más se tocaba).
//
// Ajuste de tempo: cada clip guarda el BPM ORIGINAL del sample
// (metadata de Firestore) y su AudioBuffer SIN TOCAR. La duración
// visible en la línea de tiempo y el playbackRate del nodo al
// reproducir se derivan siempre del BPM ACTUAL del proyecto — cambiar
// el tempo del proyecto resincroniza todos los clips automáticamente.
//
// Recorte no destructivo (Cortar/Split, tiradores de trim): cada clip
// guarda sourceOffsetSeconds/sourceDurationSeconds — la ventana de SU
// PROPIO AudioBuffer (nunca modificado) que efectivamente suena. Mismo
// espíritu que sourceTrimStartFrame/sourceTrimDurationFrames del lado
// Flutter, en segundos en vez de frames.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { ref, getDownloadURL, uploadBytesResumable } from "firebase/storage";
import {
  DEFAULT_MASTER_FX,
  NO_TRACK_FX,
  parseMasterFx,
  parseTrackFx,
} from "@/lib/trackEffects";
import JSZip from "jszip";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { db, storage } from "@/lib/firebase";
import { renderClipToWav, renderClipChainToWav, type ChainPart } from "@/lib/wavExport";
import { scheduleGainEnvelope } from "@/lib/clipEnvelope";
import {
  overlapChains,
  resolveTrackFades,
  type ResolvedFades,
} from "@/lib/clipCrossfade";
import { getOrProcessBuffer } from "@/lib/audioDsp";
import { getCachedBuffer, loadAndCacheBuffer, setCachedBuffer } from "@/lib/sampleBufferCache";
import type { ArrangerClip, ArrangerTrack } from "@/lib/arrangerTypes";
import {
  nextBarContextTime,
  secondsPerBar,
  secondsPerBeat,
  secondsPerQuarterNote,
} from "@/lib/barClock";
import {
  keyLabel,
  keysAreCompatible,
  transposeKey,
  transposeSemitonesFor,
} from "@/lib/sampleAffinity";
import { detectKey } from "@/lib/keyDetect";
import { computePeaks } from "@/lib/samplePeaks";
import { detectTempo } from "@/lib/tempoDetect";
import { computeSnappedStart, type SnapNeighbour } from "@/lib/arrangerSnap";
import {
  buildClipboard,
  clipsInRect,
  placeClipboard,
  selectionSpan,
  toggleSelection,
  type ClipboardEntry,
} from "@/lib/arrangerSelection";
import {
  cycleEndFor,
  normalizeLoopRegion,
  playbackStartFor,
  type LoopRegion,
} from "@/lib/loopRegion";
import {
  beatIndicesInWindow,
  isDownbeat,
  scheduleClick,
} from "@/lib/metronome";
import {
  RESET,
  SILENT,
  push,
  useArrangementHistory,
  type ArrangementState,
  type CommitMode,
} from "@/lib/arrangerHistory";
import {
  arrangementSignature,
  clearArrangerDraft,
  describeDraftAge,
  peekLiveArrangerDraft,
  readStoredArrangerDraft,
  rememberArrangerDraft,
  type ArrangerDraft,
  type StoredArrangerDraft,
} from "@/lib/arrangerDraft";
import { takeQueuedSamplesForArranger } from "@/lib/pendingArrangerSamples";
import { LoginModal } from "@/components/LoginModal";
import {
  SampleBrowserPanel,
  type ArrangerSample,
} from "@/components/SampleBrowserPanel";
import { SAMPLE_KEYS } from "@/lib/sampleTaxonomy";

const SAMPLE_DRAG_MIME = "application/x-mystudio-sample";

const TRACK_COLORS = ["#66FCF1", "#C792EA", "#FFB86C", "#FF6AC1", "#82E0AA", "#7AA2F7"];
const ROW_HEIGHT = 64;
const RULER_HEIGHT = 24;
const HEADER_WIDTH = 200;
const PEAK_BUCKETS = 160;
const MIN_TIMELINE_SECONDS = 60;
const CLIP_END_PADDING_SECONDS = 20;
const MIN_SOURCE_DURATION_SECONDS = 0.05;
const MAX_PIXELS_PER_SECOND = 300;
const TRIM_HANDLE_WIDTH = 8;
const FADE_HANDLE_SIZE = 12;
const MIN_CLIP_GAIN = 0;
const MAX_CLIP_GAIN = 1.5;
const MIN_PITCH_SEMITONES = -12;
const MAX_PITCH_SEMITONES = 12;
// Radio del "imán" al arrastrar un clip, en PÍXELES de pantalla (no
// segundos — así el radio se siente igual sin importar el zoom). Más
// allá de este radio el candidato deja de atraer y el clip sigue al
// mouse libre, sin importar qué tan cerca esté de otro clip.
const SNAP_THRESHOLD_PX = 10;
// Distancia máxima (en píxeles, cualquier dirección) para que soltar
// el clip cuente como un CLICK (mover el cursor de reproducción ahí)
// en vez de un arrastre real — un tap de mouse/dedo casi nunca es
// perfectamente estático, así que se tolera este margen chico.
const CLICK_MOVE_THRESHOLD_PX = 4;

/**
 * Con cuánta anticipación se agenda el ciclo SIGUIENTE del loop.
 *
 * Lo que hace que un loop suene continuo es que el audio de la vuelta
 * que viene ya esté agendado en el reloj del AudioContext ANTES de que
 * termine la actual: así el empalme lo resuelve el motor de audio, que
 * es exacto, y no el hilo de JavaScript, que no lo es.
 *
 * ⚠️ 1,5 s y no 0,3 como parecería suficiente. El valor tiene que ser
 * MAYOR que el peor intervalo posible entre dos pasadas del agendador,
 * y los navegadores estrangulan los timers a UNA POR SEGUNDO cuando la
 * pestaña pasa a segundo plano. Con un margen chico, cambiar de pestaña
 * mientras algo cicla mete un silencio en cada vuelta — y es una
 * situación de todos los días: se deja el loop sonando y se va a buscar
 * algo a otro lado.
 */
const CYCLE_LOOKAHEAD_SECONDS = 1.5;

/**
 * Cada cuánto corre el agendador del transporte.
 *
 * Va por setInterval y NO por requestAnimationFrame, aunque ya haya un
 * rAF andando para mover el cursor. Medido en el navegador: con el
 * panel sin pintar, el rAF baja a ~1 pasada por segundo. Para el cursor
 * eso es cosmético; para el audio sería un silencio en cada vuelta del
 * loop y un clic de metrónomo perdido de cada dos. Lo que se oye no
 * puede depender de que algo se esté dibujando.
 */
const SCHEDULER_INTERVAL_MS = 250;

/** Cuántos compases dura el loop que se crea solo al tocar el botón sin haber marcado ninguno. */
const DEFAULT_LOOP_BARS = 4;

/**
 * Hasta acá un archivo puede ser un loop. Más largo que esto es una
 * canción, y una canción NO se estira al tempo del proyecto sin que
 * nadie lo haya pedido: es la misma frontera que usa Ableton para
 * decidir si un archivo entra "warpeado" o no.
 */
const MAX_LOOP_SECONDS = 30;

/**
 * Debajo de esto el tempo detectado se informa con reservas.
 *
 * ⚠️ NO es el filtro de "¿hay música acá?" — eso ya lo resolvió
 * detectTempo devolviendo null (ver MIN_ONSET_STRENGTH en
 * tempoDetect.ts). Esto mide si el tempo elegido es CLARO o si había
 * otro candidato pisándole los talones. Medido sobre archivos reales:
 * entre 0,54 y 0,82.
 */
const MIN_TEMPO_CONFIDENCE = 0.55;
// Paso 4 (rendimiento) — ancho del bloque "esqueleto" que se muestra
// mientras se resuelve el audio real de un clip recién soltado (ver
// PendingDrop). Un valor fijo en segundos de duración ESTIMADA (no en
// píxeles) — así se ve proporcional al zoom actual, igual que un clip real.
const PLACEHOLDER_DURATION_SECONDS = 2;
// Compartido entre el selector de la barra superior y el diálogo de
// "Nuevo Proyecto" (ver TIME_SIGNATURE_PRESETS más abajo).
const TIME_SIGNATURE_PRESETS = ["4/4", "3/4", "2/4", "6/8", "9/8", "12/8", "5/4", "7/8"];

/**
 * A qué se pega un clip al arrastrarlo. Las fracciones son valores de
 * nota (1/4 = negra), no fracciones del compás: es la convención de
 * cualquier DAW y es lo que hace que en 6/8 sigan significando lo
 * mismo.
 *
 * "Libre" deja el imán clip-contra-clip, que es otra cosa y siempre
 * está activo: encadenar loops uno atrás del otro no necesita grilla.
 */
const SNAP_DIVISIONS = ["off", "bar", "1/2", "1/4", "1/8", "1/16"] as const;
type SnapDivision = (typeof SNAP_DIVISIONS)[number];

const SNAP_LABELS: Record<SnapDivision, string> = {
  off: "Libre",
  bar: "Compás",
  "1/2": "1/2",
  "1/4": "1/4",
  "1/8": "1/8",
  "1/16": "1/16",
};

/**
 * Paso 4 (rendimiento) — un drop "en vuelo": el usuario ya soltó el
 * sample en la pista, pero el AudioBuffer real todavía no está listo
 * (cache miss — fetch/decode en curso). Se renderiza como un bloque
 * esqueleto en la posición correcta MIENTRAS tanto; nunca entra a
 * `ArrangerTrack.clips` hasta que el audio real está resuelto — así
 * `ArrangerClip.buffer` se mantiene siempre no-nulo, sin ensuciar con
 * guards de null todo el resto del archivo (playFrom, export, trim,
 * split, etc.).
 */
interface PendingDrop {
  id: string;
  trackId: string;
  startSeconds: number;
  sampleName: string;
  color: string;
}

function newId(): string {
  return crypto.randomUUID();
}

// El arreglo vacío del que parte todo. A nivel de MÓDULO y no adentro
// del componente: si se construyera en cada render, el hook del
// historial recibiría un objeto nuevo cada vez.
//
// El tipo de compás, junto con el BPM, define la grilla musical de la
// regla (ver rulerTicks) y viaja en el manifest.json exportado. El
// motor de reproducción/exportación NO lo usa para nada: el
// posicionamiento real de los clips sigue siendo siempre en segundos
// (ver la REGLA CRÍTICA en handleExport).
const INITIAL_ARRANGEMENT: ArrangementState = {
  projectTitle: "Nuevo Arreglo",
  projectTempoBpm: 120,
  // Tonalidad del proyecto ("" = sin declarar). Habilita dos cosas del
  // Banco de Sonidos: filtrar por compatibilidad armónica y transponer
  // los samples al soltarlos. Vive SOLO en la web (borrador + documento
  // de Firestore), nunca en el manifiesto del .mystudio — así el lado
  // Flutter no necesita enterarse de nada.
  projectKey: "",
  timeSignatureNumerator: 4,
  timeSignatureDenominator: 4,
  // Efectos del máster del proyecto importado — el Arranger no los
  // edita ni los reproduce, los devuelve al exportar para no perderlos
  // (igual que ArrangerTrack.fx).
  masterFx: DEFAULT_MASTER_FX,
  tracks: [],
};

// ─── Importar .mystudio (edición bidireccional) ──────────────────────────
//
// Mismo formato exacto que arma handleExport() acá abajo y
// project_backup_service.dart del lado Flutter — ver la nota de
// REGLA CRÍTICA en importProjectFromZipBytes: `startBeat` es SIEMPRE
// un offset en segundos absolutos, nunca compases, sin importar de
// qué lado (móvil o web) salió el archivo.

interface ImportManifestClip {
  audioFileName: string;
  startBeat: number;
  durationSamples: number;
  sampleRate: number;
  // Ausente en un .mystudio exportado antes de esta feature (o desde
  // la app móvil, que todavía no la conoce) — se completa con 0.
  pitchShift?: number;
}

interface ImportManifestTrack {
  name: string;
  volume: number;
  pan: number;
  isMuted: boolean;
  isSolo: boolean;
  clips: ImportManifestClip[];
  fx?: unknown;
}

interface ImportManifest {
  formatVersion: number;
  project: {
    title: string;
    tempoBpm: number;
    // Ausentes en un .mystudio que vino de la app móvil (Flutter
    // todavía no exporta compás) — se completan con 4/4 si faltan.
    timeSignatureNumerator?: number;
    timeSignatureDenominator?: number;
    // Reverb y limitador del máster (formatVersion 2 de la app).
    masterFx?: unknown;
  };
  tracks: ImportManifestTrack[];
}

// computePeaks vive en samplePeaks.ts: lo comparten los clips de la
// línea de tiempo y las formas de onda de las tarjetas del Banco.

/** Recorta el array de picos (calculado sobre el buffer COMPLETO) a la ventana [offset, offset+duration) para dibujar solo esa porción. */
function slicePeaksForWindow(
  peaks: Float32Array,
  offsetSeconds: number,
  durationSeconds: number,
  bufferDuration: number,
): Float32Array {
  const numBuckets = peaks.length / 2;
  if (bufferDuration <= 0 || numBuckets === 0) return peaks;
  const startBucket = Math.max(
    0,
    Math.min(numBuckets, Math.floor((offsetSeconds / bufferDuration) * numBuckets)),
  );
  const endBucket = Math.max(
    startBucket,
    Math.min(numBuckets, Math.ceil(((offsetSeconds + durationSeconds) / bufferDuration) * numBuckets)),
  );
  return peaks.slice(startBucket * 2, endBucket * 2);
}

/**
 * Repite los picos de una ventana tantas veces como se repita el clip,
 * cortando la última si la repetición es fraccionaria.
 *
 * Sin esto, un clip repetido cuatro veces se ve como UNA onda estirada
 * a lo largo de todo el bloque: parecería que el audio se ralentizó, que
 * es justo lo contrario de lo que pasa.
 */
function tilePeaks(peaks: Float32Array, repeats: number): Float32Array {
  const times = Math.max(1, repeats || 1);
  if (times <= 1 || peaks.length === 0) return peaks;
  const buckets = peaks.length / 2;
  const totalBuckets = Math.max(1, Math.round(buckets * times));
  const out = new Float32Array(totalBuckets * 2);
  for (let bucket = 0; bucket < totalBuckets; bucket++) {
    const source = (bucket % buckets) * 2;
    out[bucket * 2] = peaks[source];
    out[bucket * 2 + 1] = peaks[source + 1];
  }
  return out;
}

function playbackRateFor(clip: ArrangerClip, projectTempoBpm: number): number {
  // Los One-Shot (percusión suelta, FX puntuales, etc.) suenan SIEMPRE
  // a su velocidad y tono original, en su posición de inicio tal cual
  // — el time-stretch (ver audioDsp.ts) es exclusivo de los Loop, que
  // sí están pensados para adaptarse al tempo del proyecto. Como TODO
  // el audio routing (qué buffer usa getProcessedBuffer, qué
  // offset/duración se programan en playFrom, qué se renderiza en
  // handleExport) deriva de este rate, alcanza con condicionar acá.
  if (clip.sampleType !== "Loop") return 1.0;
  if (clip.originalBpm <= 0 || projectTempoBpm <= 0) return 1.0;
  return projectTempoBpm / clip.originalBpm;
}

/** Lo que dura UNA pasada del clip en la línea de tiempo, sin repetir. */
function windowDurationFor(clip: ArrangerClip, projectTempoBpm: number): number {
  return clip.sourceDurationSeconds / playbackRateFor(clip, projectTempoBpm);
}

/**
 * Lo que ocupa el clip en la línea de tiempo, repeticiones incluidas.
 *
 * Es la función de la que cuelga TODO lo demás —el imán, el rectángulo
 * de selección, el crossfade, la duración total del arreglo, el
 * exportador—, así que hacer que entienda de repeticiones acá alcanza
 * para que el resto se entere solo.
 */
function displayDurationFor(clip: ArrangerClip, projectTempoBpm: number): number {
  return windowDurationFor(clip, projectTempoBpm) * Math.max(1, clip.repeats || 1);
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Forma de onda de un clip ───────────────────────────────────────────

function ClipWaveform({
  peaks,
  color,
  widthPx,
  heightPx,
}: {
  peaks: Float32Array;
  color: string;
  widthPx: number;
  heightPx: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || widthPx <= 0 || heightPx <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = widthPx * dpr;
    canvas.height = heightPx * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, widthPx, heightPx);
    ctx.fillStyle = color;

    const numBuckets = peaks.length / 2;
    const barWidth = widthPx / Math.max(1, numBuckets);
    const mid = heightPx / 2;
    for (let i = 0; i < numBuckets; i++) {
      const min = peaks[i * 2];
      const max = peaks[i * 2 + 1];
      const x = i * barWidth;
      const yTop = mid - max * mid;
      const yBottom = mid - min * mid;
      ctx.fillRect(x, yTop, Math.max(1, barWidth - 0.4), Math.max(1, yBottom - yTop));
    }
  }, [peaks, color, widthPx, heightPx]);

  return <canvas ref={canvasRef} style={{ width: widthPx, height: heightPx }} />;
}

// ─── Página ─────────────────────────────────────────────────────────────

export default function ArrangerPage() {
  const { user, loading } = useAuth();
  const [isLoginOpen, setIsLoginOpen] = useState(false);

  // Paso 1 (dashboard) — el botón "+ Crear Nuevo Proyecto" linkea acá
  // con ?new=1: antes de mostrar la grilla vacía, se le pide al
  // usuario Título/BPM/Compás. El inicializador perezoso lee la URL
  // directo (en vez de un useEffect) para que el gate ya aparezca en
  // el primer render del cliente, sin un parpadeo de la grilla vacía
  // detrás — `typeof window !== "undefined"` lo hace seguro también
  // durante el render en el servidor (donde siempre da false).
  const [showNewProjectSetup, setShowNewProjectSetup] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1",
  );

  // ─── El arreglo en sí, con deshacer/rehacer ────────────────────────
  //
  // Título, tempo, tonalidad, compás, efectos del máster y pistas eran
  // siete useState sueltos, y cada edición los pisaba sin dejar rastro.
  // Ahora viven juntos en un reducer con historial (arrangerHistory.ts)
  // — juntos porque son lo que el usuario entiende como "el arreglo", y
  // deshacer tiene que devolverlo entero y coherente.
  //
  // Los setters de abajo son shims con la MISMA firma que tenían los
  // useState, así el resto del archivo no cambió: lo único que se suma
  // es un segundo argumento opcional para decir qué clase de commit es
  // (ver CommitMode).
  const arrangement = useArrangementHistory(INITIAL_ARRANGEMENT);
  const {
    projectTitle,
    projectTempoBpm,
    projectKey,
    timeSignatureNumerator,
    timeSignatureDenominator,
    masterFx: importedMasterFx,
    tracks,
  } = arrangement.state;
  const { commit } = arrangement;

  type Updater<T> = T | ((prev: T) => T);
  function resolve<T>(updater: Updater<T>, prev: T): T {
    return typeof updater === "function" ? (updater as (p: T) => T)(prev) : updater;
  }

  const setTracks = (updater: Updater<ArrangerTrack[]>, mode?: CommitMode) =>
    commit((prev) => ({ ...prev, tracks: resolve(updater, prev.tracks) }), mode ?? push("Editar pistas"));
  const setProjectTitle = (updater: Updater<string>) =>
    commit((prev) => ({ ...prev, projectTitle: resolve(updater, prev.projectTitle) }),
      push("Cambiar el título", "titulo"));
  const setProjectTempoBpm = (updater: Updater<number>) =>
    commit((prev) => ({ ...prev, projectTempoBpm: resolve(updater, prev.projectTempoBpm) }),
      push("Cambiar el tempo", "tempo"));
  const setProjectKey = (updater: Updater<string>, mode?: CommitMode) =>
    commit((prev) => ({ ...prev, projectKey: resolve(updater, prev.projectKey) }),
      mode ?? push("Cambiar la tonalidad"));
  const setTimeSignatureNumerator = (updater: Updater<number>) =>
    commit((prev) => ({ ...prev, timeSignatureNumerator: resolve(updater, prev.timeSignatureNumerator) }),
      push("Cambiar el compás", "compas"));
  const setTimeSignatureDenominator = (updater: Updater<number>) =>
    commit((prev) => ({ ...prev, timeSignatureDenominator: resolve(updater, prev.timeSignatureDenominator) }),
      push("Cambiar el compás", "compas"));
  /** Carga un arreglo COMPLETO de una (abrir, recuperar, empezar de cero): el historial arranca de nuevo desde acá. */
  function loadArrangement(next: Partial<ArrangementState>) {
    commit((prev) => ({ ...prev, ...next }), RESET);
  }
  // Pre-escuchar (y soltar) los samples ya adaptados al tempo y la
  // tonalidad del proyecto. Encendido por defecto: es lo que hace que
  // lo que se escucha en el panel sea lo que después suena en la pista.
  const [matchProject, setMatchProject] = useState(true);
  const [rulerMode, setRulerMode] = useState<"seconds" | "bars">("seconds");
  // Arranca en 1/4 (la negra en 4/4): lo bastante fino para colocar un
  // golpe suelto y lo bastante musical para que un loop caiga en su
  // lugar. Poner un clip "en el compás 5" era literalmente imposible
  // antes de esto — el imán solo conocía los bordes de OTROS clips, así
  // que quedaba en 4,97 y el arreglo se desfasaba solo.
  const [snapDivision, setSnapDivision] = useState<SnapDivision>("1/4");
  const [pixelsPerSecond, setPixelsPerSecond] = useState(50);

  // Selección MÚLTIPLE. El trabajo con loops es repetitivo por
  // naturaleza —se arma un estribillo de cuatro compases y se repite—
  // y hasta acá todo era de a uno: repetir ocho clips eran ocho
  // gestos, cada uno con su propio riesgo de desalinearse.
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  // Los editores POR CLIP (volumen, pitch, tiradores de recorte y de
  // fade) solo tienen sentido con UNO seleccionado: no existe "el
  // pitch" de cinco clips distintos. Con varios, esos controles
  // desaparecen en vez de mostrar el valor de uno cualquiera.
  const selectedClipId = selectedClipIds.length === 1 ? selectedClipIds[0] : null;
  function selectOnlyClip(clipId: string | null) {
    setSelectedClipIds(clipId ? [clipId] : []);
  }
  const [clipboard, setClipboard] = useState<ClipboardEntry<ArrangerClip>[] | null>(null);
  /** Aviso corto cuando pegar no pudo colocar todo (ver placeClipboard). */
  const [clipNotice, setClipNotice] = useState<string | null>(null);
  /**
   * En qué pista cae lo próximo que se pegue, cuando no hay ningún clip
   * seleccionado que sirva de ancla.
   *
   * Sin esto, pegar SIEMPRE caía en la primera pista, así que copiar la
   * batería a una pista nueva y vacía era imposible: no había forma de
   * decir "acá". Se fija al tocar el fondo de un carril, que es el
   * gesto que uno hace igual antes de pegar.
   */
  const [pasteTrackIndex, setPasteTrackIndex] = useState(0);
  // Paso 4 (rendimiento) — drops en vuelo, ver PendingDrop.
  const [pendingDrops, setPendingDrops] = useState<PendingDrop[]>([]);
  const [addSampleError, setAddSampleError] = useState<string | null>(null);

  // ─── Loop y metrónomo ───────────────────────────────────────────
  //
  // La región de loop NO entra en el historial ni en la firma de
  // contenido del borrador: describe cómo se está TRABAJANDO, no lo
  // que se escribió. Deshacer no debería mover el tramo que se está
  // repitiendo, y marcar un loop no debería dejar el proyecto como
  // "sin guardar". Es el mismo corte que ya hacían cloudProjectId y
  // cloudBaseVersion.
  const [loopRegion, setLoopRegion] = useState<LoopRegion | null>(null);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);

  // playFrom lee el loop de ACÁ y no del estado: encender el loop tiene
  // que re-encolar la reproducción en el mismo gesto, y en ese momento
  // el useState todavía no se actualizó.
  const loopRef = useRef<{ enabled: boolean; region: LoopRegion | null }>({
    enabled: false,
    region: null,
  });
  const metronomeRef = useRef(false);
  /** Compás y tempo vigentes para el clic, leídos por el tick de cada frame. */
  const metronomeGridRef = useRef({ beatSeconds: 0.5, beatsPerBar: 4 });
  /** Hasta qué punto de la línea de tiempo ya se agendó clic (ver beatIndicesInWindow). */
  const metronomeCursorRef = useRef(0);
  /**
   * Los clics ya agendados. Se guardan para poder CALLARLOS al parar:
   * con 1,5 s de anticipación, pausar dejaría sonando hasta tres clics
   * después de que el arreglo ya se detuvo.
   */
  const metronomeVoicesRef = useRef<OscillatorNode[]>([]);
  const schedulerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * El ciclo que está sonando ahora. Con el loop apagado hay uno solo,
   * abierto hasta el final del arreglo; con el loop encendido, cada
   * vuelta es un ciclo y el siguiente se agenda ANTES de que termine
   * el actual (ver CYCLE_LOOKAHEAD_SECONDS).
   */
  const cycleRef = useRef<{
    requestId: number;
    fromSeconds: number;
    startContextTime: number;
    /** Dónde termina el ciclo en la línea de tiempo, o null si no cicla. */
    endSeconds: number | null;
    endContextTime: number | null;
    /** A dónde vuelve cada vuelta. */
    loopStartSeconds: number;
    nextScheduled: boolean;
    /**
     * Hasta qué punto de la vuelta QUE VIENE ya se agendaron clics, o
     * null si todavía no se tocó. Ver la nota en runScheduler: los
     * clics del ciclo siguiente se agendan junto con su audio.
     */
    nextMetronomeCursor: number | null;
  } | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadSeconds, setPlayheadSeconds] = useState(0);

  // El proyecto de la nube que estamos editando, si entramos con
  // ?open=<cloudId> o si ya guardamos una vez. Sin esto, cada guardado
  // minteaba un id nuevo y creaba un DUPLICADO en vez de actualizar —
  // el proyecto original se quedaba como estaba y parecía que no se
  // había guardado nada.
  const [cloudProjectId, setCloudProjectId] = useState<string | null>(null);

  // Qué `cloudVersion` tenía el proyecto cuando lo abrimos (o cuando lo
  // guardamos por última vez). Es lo único que permite darse cuenta de
  // que la app lo cambió mientras tanto — sin esto, "Guardar cambios"
  // pisaba lo del teléfono sin decir nada. `null` = no lo sabemos, y
  // ante la duda se pregunta.
  const [cloudBaseVersion, setCloudBaseVersion] = useState<number | null>(null);

  // ¿Hay cambios que todavía no están en la nube? Decide el cartelito
  // de la barra y el aviso antes de cerrar la pestaña.
  const [isDirty, setIsDirty] = useState(false);

  // Un borrador de una sesión ANTERIOR (recargaste o cerraste el
  // navegador). No se aplica solo: restaurar puede tardar (hay que
  // volver a bajar el audio) y puede perder clips, así que se ofrece y
  // decide el usuario. El de esta misma sesión sí se restaura solo —
  // ver el efecto de más abajo.
  const [recoverableDraft, setRecoverableDraft] = useState<StoredArrangerDraft | null>(null);
  const [isRestoringDraft, setIsRestoringDraft] = useState(false);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);

  // La instantánea viva se lee UNA vez, en el primer render, antes de
  // que cualquier efecto la pise.
  const liveDraftRef = useRef(
    typeof window === "undefined" ? null : peekLiveArrangerDraft(),
  );

  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccessTitle, setExportSuccessTitle] = useState<string | null>(null);

  // Edición bidireccional — importar un .mystudio existente.
  const [isImporting, setIsImporting] = useState(false);
  const [importStage, setImportStage] = useState<string | null>(null);
  // 0..1 — descarga (0-0.3), extracción (0.3-0.35), decode (0.35-0.7),
  // pistas reveladas en la grilla (0.7-1). El cálculo de picos reales
  // de la forma de onda queda AFUERA de esta barra a propósito: pasa
  // en segundo plano después de llegar a 100%, no bloquea "ya puedo
  // usar el proyecto" (ver la Fase 2 al final de importProjectFromZipBytes).
  const [importProgress, setImportProgress] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Subir un clip de audio (.mp3/.wav) desde la computadora — la
  // versión web de "Importar audio" que ya existe en la app móvil.
  // isUploadingAudio es solo para el estado del botón (deshabilitado +
  // texto "Subiendo...") mientras decodeAudioData hace su trabajo.
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const audioFileInputRef = useRef<HTMLInputElement>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const playStartContextTimeRef = useRef(0);
  const playheadAtStartRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const autoStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Problema 1 — nodos de audio POR PISTA, persistentes durante toda
  // la vida de la pista (Panner -> Gain -> destination). Las fuentes
  // (clips sonando) se conectan acá; volumen/pan/mute/solo actualizan
  // estos mismos nodos en vivo (ver el useEffect más abajo), nunca se
  // recrean por cada Play.
  const trackNodesRef = useRef<Map<string, { gain: GainNode; panner: StereoPannerNode }>>(
    new Map(),
  );

  // Paso 3 (rendimiento) — id incremental de la última llamada a
  // playFrom(). playFrom ahora es ASYNC (tiene que esperar a que el
  // Worker de time-stretch resuelva los buffers que hagan falta antes
  // de agendar nada) — este contador es lo que evita que una llamada
  // VIEJA (superada por un Play/Stop/seek más nuevo mientras esperaba)
  // termine agendando audio de todos modos una vez que su await resuelve.
  const playRequestIdRef = useRef(0);

  // Arrastre de un clip ya existente (moverlo horizontalmente). Tiene
  // "imán" hacia los bordes de otros clips (ver computeSnappedStart) —
  // insistir el arrastre más allá del radio de imán lo suelta y el
  // clip vuelve a seguir el mouse libremente (se superpone o se aleja
  // sin problema).
  const dragRef = useRef<{
    trackId: string;
    clipId: string;
    // TODOS los clips que se mueven con este arrastre. Con uno solo es
    // [clipId] y todo sigue como siempre; con varios seleccionados, el
    // imán se calcula contra el clip AGARRADO y los demás se corren el
    // mismo delta, que es lo que mantiene el bloque armado.
    movingClipIds: string[];
    startClientX: number;
    startClientY: number;
    // Última posición conocida del puntero — junto con startClientX/Y,
    // sirve para distinguir un CLICK (mover el cursor de reproducción,
    // ver handleClipPointerUp) de un arrastre real.
    lastClientX: number;
    lastClientY: number;
    originalStartSeconds: number;
    displayDuration: number;
    // Paso 3 (arrastrar entre pistas) — sobre qué pista está el mouse
    // AHORA MISMO, no necesariamente la de origen.
    hoveredTrackId: string;
    // Posición (ya con imán aplicado) del último pointermove. TIENE
    // que vivir acá, no solo en el estado `dragPreviewStartSeconds`:
    // handleClipPointerUp se llama desde un listener de window
    // agregado UNA sola vez en handleClipPointerDown, así que su
    // closure quedó fijo con el `dragPreviewStartSeconds` de ESE
    // instante (null, antes de que arrancara el arrastre) — leerlo del
    // ref evita ese bug de closure obsoleto (era la causa real de que
    // "no se agregue en la pista nueva": handleClipPointerUp cortaba
    // en el primer `if` porque veía newStart == null).
    previewStartSeconds: number;
    // Posición (segundos) a la que hay que llevar el cursor de
    // reproducción SI esto termina siendo un click y no un arrastre —
    // calculada una sola vez, al presionar, contra el punto exacto
    // donde se tocó dentro del clip.
    clickSeekSeconds: number;
  } | null>(null);
  // Rectángulo de goma (marquee) para seleccionar varios clips de una
  // pasada. Es el gesto de cualquier DAW y es la razón por la que el
  // fondo de los carriles pasó a tener su propio pointerdown.
  const marqueeRef = useRef<{
    trackIndexA: number;
    trackIndexB: number;
    secondsA: number;
    secondsB: number;
    baseSelection: string[];
    additive: boolean;
    startClientX: number;
    startClientY: number;
    moved: boolean;
  } | null>(null);
  const [marquee, setMarquee] = useState<{
    trackFrom: number;
    trackTo: number;
    fromSeconds: number;
    toSeconds: number;
  } | null>(null);

  // Marcar el tramo de loop arrastrando sobre la regla de tiempo. Un
  // click simple sigue moviendo el cursor, como siempre.
  const loopDragRef = useRef<{
    startSeconds: number;
    lastSeconds: number;
    startClientX: number;
    moved: boolean;
  } | null>(null);
  const [loopDraft, setLoopDraft] = useState<{ fromSeconds: number; toSeconds: number } | null>(null);

  const [dragPreviewStartSeconds, setDragPreviewStartSeconds] = useState<number | null>(null);
  const [snapGuideSeconds, setSnapGuideSeconds] = useState<number | null>(null);
  // Puramente visuales (resaltar el carril destino) — la fuente de
  // verdad para la lógica sigue siendo dragRef.current.hoveredTrackId.
  const [dragOriginTrackId, setDragOriginTrackId] = useState<string | null>(null);
  const [dragHoverTrackId, setDragHoverTrackId] = useState<string | null>(null);

  // Problema 3 — arrastre de los tiradores de recorte (bordes del clip
  // seleccionado).
  const trimDragRef = useRef<{
    trackId: string;
    clipId: string;
    edge: "left" | "right";
    startClientX: number;
    original: ArrangerClip;
  } | null>(null);
  const [trimPreview, setTrimPreview] = useState<{
    startSeconds: number;
    sourceOffsetSeconds: number;
    sourceDurationSeconds: number;
    repeats: number;
  } | null>(null);

  // Arrastre de los "tiradores" de fade en las esquinas superiores del
  // clip (independiente del arrastre de trim, que va en los bordes de
  // TODA la altura) — el volumen del clip en sí (fuera de fades) se
  // controla aparte, con el slider de la barra de herramientas.
  const fadeDragRef = useRef<{
    trackId: string;
    clipId: string;
    edge: "in" | "out";
    startClientX: number;
    original: ArrangerClip;
    displayDuration: number;
  } | null>(null);
  const [fadePreview, setFadePreview] = useState<{
    fadeInSeconds: number;
    fadeOutSeconds: number;
  } | null>(null);

  const timelineViewportRef = useRef<HTMLDivElement>(null);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(800);

  useEffect(() => {
    const ctx = new AudioContext();
    audioContextRef.current = ctx;
    // trackNodesRef.current es un Map ESTABLE, mutado en el lugar
    // (nunca reasignado) por el useEffect de Gain/Pan más abajo — se
    // captura acá para que el cleanup limpie el mismo Map que existía
    // durante toda la vida del componente, sin depender de leerlo de
    // nuevo al desmontar.
    const trackNodes = trackNodesRef.current;
    return () => {
      stopAllSources();
      for (const nodes of trackNodes.values()) {
        nodes.panner.disconnect();
        nodes.gain.disconnect();
      }
      trackNodes.clear();
      ctx.close();
      audioContextRef.current = null;
    };
  }, []);

  // Problema 4 — ancho disponible real del viewport del timeline (sin
  // la columna de encabezados de pista), para calcular el zoom mínimo
  // dinámicamente.
  useEffect(() => {
    function measure() {
      if (timelineViewportRef.current) {
        setTimelineViewportWidth(timelineViewportRef.current.clientWidth);
      }
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  function stopAllSources() {
    // Invalida cualquier playFrom() todavía esperando su DSP — sin
    // esto, un Play seguido rápido de un Stop/Pause podría terminar
    // agendando audio de todos modos una vez que el await resuelve.
    playRequestIdRef.current++;
    // Sin esto, el ciclo viejo seguiría agendando la vuelta siguiente
    // desde el tick aunque ya no suene nada.
    cycleRef.current = null;
    for (const source of activeSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // ya se había detenido solo
      }
    }
    activeSourcesRef.current = [];
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (autoStopTimeoutRef.current !== null) {
      clearTimeout(autoStopTimeoutRef.current);
      autoStopTimeoutRef.current = null;
    }
    if (schedulerRef.current !== null) {
      clearInterval(schedulerRef.current);
      schedulerRef.current = null;
    }
    for (const voice of metronomeVoicesRef.current) {
      try {
        voice.stop();
      } catch {
        // ya había sonado y terminado solo
      }
    }
    metronomeVoicesRef.current = [];
  }

  /**
   * El fade REAL de cada clip, ya mirando a sus vecinos de la misma
   * pista: el declick de los bordes duros y el crossfade de los solapes
   * (ver clipCrossfade.ts). Se calcula en UN solo lugar porque lo
   * consumen tres caminos que tienen que coincidir o el arreglo suena
   * distinto según dónde lo escuches: la reproducción en vivo, el
   * dibujo del clip y la exportación.
   */
  const resolvedFades = useMemo(() => {
    const all = new Map<string, ResolvedFades>();
    for (const track of tracks) {
      const resolved = resolveTrackFades(
        track.clips.map((clip) => ({
          id: clip.id,
          startSeconds: clip.startSeconds,
          displayDuration: displayDurationFor(clip, projectTempoBpm),
          fadeInSeconds: clip.fadeInSeconds,
          fadeOutSeconds: clip.fadeOutSeconds,
        })),
      );
      for (const [id, fades] of resolved) all.set(id, fades);
    }
    return all;
  }, [tracks, projectTempoBpm]);

  /** Los fades de un clip, con el propio del clip como red por si todavía no se calcularon. */
  function fadesFor(clip: ArrangerClip): ResolvedFades {
    return (
      resolvedFades.get(clip.id) ?? {
        fadeInSeconds: clip.fadeInSeconds,
        fadeOutSeconds: clip.fadeOutSeconds,
        fadeInShape: "linear",
        fadeOutShape: "linear",
        crossfadeIn: false,
        crossfadeOut: false,
      }
    );
  }

  const totalDurationSeconds = useMemo(() => {
    let maxEnd = MIN_TIMELINE_SECONDS;
    for (const track of tracks) {
      for (const clip of track.clips) {
        const end = clip.startSeconds + displayDurationFor(clip, projectTempoBpm);
        if (end > maxEnd) maxEnd = end;
      }
    }
    return maxEnd + CLIP_END_PADDING_SECONDS;
  }, [tracks, projectTempoBpm]);

  // Problema 4 — zoom mínimo (más alejado) calculado para que el
  // proyecto ENTERO entre en el ancho visible, sin scroll horizontal.
  // Es un PISO dinámico, no un número fijo: crece/achica solo según
  // cuánto dure el arreglo y cuánto ancho de pantalla haya.
  const minPixelsPerSecond = useMemo(() => {
    const availableWidth = Math.max(100, timelineViewportWidth - HEADER_WIDTH);
    return Math.max(1, availableWidth / totalDurationSeconds);
  }, [timelineViewportWidth, totalDurationSeconds]);

  const effectivePixelsPerSecond = Math.max(pixelsPerSecond, minPixelsPerSecond);

  // Paso 2 — marcas de la regla de tiempo, en dos modos intercambiables:
  //   "seconds": una marca cada 5 segundos (comportamiento de siempre).
  //   "bars": una grilla musical real. Acá "beat" es UNA nota del
  //     valor del DENOMINADOR del compás (ej. negra en 4/4, corchea en
  //     6/8) — el compás dura `numerator` de esos beats. El BPM sigue
  //     siendo siempre "negras por minuto" (convención estándar,
  //     independiente del compás elegido), así que primero se calcula
  //     cuánto dura UNA negra y de ahí se deriva la nota del
  //     denominador. Las marcas de INICIO DE COMPÁS llevan etiqueta
  //     ("1.1", "2.1"...); las de cada beat intermedio son solo una
  //     rayita, y se ocultan si quedarían demasiado juntas al alejar
  //     el zoom (ver MIN_BEAT_TICK_PX).
  // Un compás, en segundos. Lo necesitan la regla de tiempo y la
  // pre-escucha sincronizada — y lo va a necesitar el imán a la grilla
  // musical. La cuenta en sí vive en barClock.ts para que la regla y
  // todo lo que se enganche a ella no puedan divergir.
  const barLengthSeconds = useMemo(
    () => secondsPerBar(projectTempoBpm, timeSignatureNumerator, timeSignatureDenominator),
    [projectTempoBpm, timeSignatureNumerator, timeSignatureDenominator],
  );

  /** Paso de la grilla en segundos. 0 = sin imán a la grilla. */
  const gridSeconds = useMemo(() => {
    if (snapDivision === "off") return 0;
    if (snapDivision === "bar") return barLengthSeconds;
    const noteValue = Number(snapDivision.split("/")[1]);
    if (!Number.isFinite(noteValue) || noteValue <= 0) return 0;
    // 4 / noteValue porque el BPM son NEGRAS por minuto: una redonda
    // son cuatro negras, una corchea media.
    return secondsPerQuarterNote(projectTempoBpm) * (4 / noteValue);
  }, [snapDivision, barLengthSeconds, projectTempoBpm]);

  // El clic sigue al tempo y al compás vigentes. Va por un ref porque
  // lo lee el tick de cada frame, que es una función suelta y no se
  // rearma cuando cambia el estado.
  useEffect(() => {
    metronomeGridRef.current = {
      beatSeconds: secondsPerBeat(projectTempoBpm, timeSignatureDenominator),
      beatsPerBar: timeSignatureNumerator,
    };
  }, [projectTempoBpm, timeSignatureDenominator, timeSignatureNumerator]);

  const rulerTicks = useMemo(() => {
    if (rulerMode === "seconds") {
      const count = Math.floor(totalDurationSeconds / 5) + 1;
      return Array.from({ length: count }, (_, i) => ({
        seconds: i * 5,
        label: formatTime(i * 5) as string | null,
        major: true,
      }));
    }

    const secondsPerDenomNote = secondsPerBeat(projectTempoBpm, timeSignatureDenominator);
    if (!(barLengthSeconds > 0)) return [];

    const MIN_BEAT_TICK_PX = 4;
    const showBeatTicks = secondsPerDenomNote * effectivePixelsPerSecond >= MIN_BEAT_TICK_PX;
    const totalBars = Math.ceil(totalDurationSeconds / barLengthSeconds) + 1;

    const ticks: { seconds: number; label: string | null; major: boolean }[] = [];
    for (let bar = 0; bar < totalBars; bar++) {
      const barStartSeconds = bar * barLengthSeconds;
      ticks.push({ seconds: barStartSeconds, label: `${bar + 1}.1`, major: true });
      if (showBeatTicks) {
        for (let beat = 1; beat < timeSignatureNumerator; beat++) {
          ticks.push({
            seconds: barStartSeconds + beat * secondsPerDenomNote,
            label: null,
            major: false,
          });
        }
      }
    }
    return ticks;
  }, [
    rulerMode,
    totalDurationSeconds,
    projectTempoBpm,
    timeSignatureNumerator,
    timeSignatureDenominator,
    effectivePixelsPerSecond,
    barLengthSeconds,
  ]);

  // ─── Problema 1: Gain/Pan/Mute/Solo por pista, en vivo ───────────────

  useEffect(() => {
    const ctx = audioContextRef.current;
    if (!ctx) return;
    const nodes = trackNodesRef.current;

    for (const track of tracks) {
      if (!nodes.has(track.id)) {
        const panner = ctx.createStereoPanner();
        const gain = ctx.createGain();
        panner.connect(gain);
        gain.connect(ctx.destination);
        nodes.set(track.id, { gain, panner });
      }
    }
    for (const [trackId, trackNodes] of [...nodes.entries()]) {
      if (!tracks.some((t) => t.id === trackId)) {
        trackNodes.panner.disconnect();
        trackNodes.gain.disconnect();
        nodes.delete(trackId);
      }
    }

    // Mute siempre gana (silencio); si no está muteada, solo audible
    // si nadie más está en Solo, o si ELLA está en Solo.
    const anySolo = tracks.some((t) => t.isSolo);
    for (const track of tracks) {
      const trackNodes = nodes.get(track.id);
      if (!trackNodes) continue;
      const audible = !track.isMuted && (!anySolo || track.isSolo);
      trackNodes.gain.gain.value = audible ? track.volume : 0;
      trackNodes.panner.pan.value = track.pan;
    }
  }, [tracks]);

  // ─── Time-stretching + pitch-shift real (Paso 3) ─────────────────────

  /**
   * Devuelve el AudioBuffer que hay que reproducir para este clip a
   * este `rate`, con su pitch-shift ya aplicado — UNA sola pasada de
   * DSP (signalsmith-stretch, WASM + AudioWorklet), cacheada por
   * (sampleId, rate, semitones) en src/lib/audioDsp.ts. Antes eran DOS
   * motores encadenados (SoundTouch/WSOLA para el tempo + esto mismo
   * para el pitch) — se unificó porque WSOLA sonaba con artefactos
   * notorios ("espacios"/alteraciones) incluso en cambios de tempo
   * chicos sobre material rítmico, una debilidad conocida de ese
   * algoritmo con loops percusivos — ver la nota larga en audioDsp.ts.
   */
  async function getProcessedBuffer(clip: ArrangerClip, rate: number): Promise<AudioBuffer> {
    if (Math.abs(rate - 1) < 0.0005 && clip.pitchShift === 0) return clip.buffer;
    try {
      return await getOrProcessBuffer(
        clip.sampleId,
        clip.buffer,
        rate,
        clip.pitchShift,
        clip.sampleType === "Loop",
      );
    } catch (err) {
      // Si el motor de DSP falla, mejor sonar SIN procesar que dejar
      // muda TODA la reproducción (antes, un error acá tumbaba el
      // Promise.all de playFrom y no sonaba NADA, ni siquiera los
      // clips que no necesitaban tempo/pitch).
      console.error("No se pudo procesar tempo/pitch, usando el clip sin transponer:", err);
      return clip.buffer;
    }
  }

  // Pre-calienta las cachés de tempo Y pitch (Worker + AudioWorklet
  // offline, ambas cachés globales) cada vez que cambian los clips, el
  // tempo del proyecto, o el pitch de algún clip, para que Play/
  // Exportar encuentren casi todo ya resuelto — "fire and forget", el
  // efecto no espera nada, cada cálculo corre fuera de este hilo.
  useEffect(() => {
    if (!audioContextRef.current) return;
    for (const track of tracks) {
      for (const clip of track.clips) {
        void getProcessedBuffer(clip, playbackRateFor(clip, projectTempoBpm));
      }
    }
  }, [tracks, projectTempoBpm]);

  // ─── Transporte ──────────────────────────────────────────────────────

  /**
   * Agenda UN ciclo: todos los clips que suenan desde `fromSeconds`,
   * arrancando en `atContextTime` (o "ni bien resuelva el DSP", si es
   * null), recortados para no pasarse de `untilSeconds`.
   *
   * Es la pieza que hace posible el loop: la vuelta siguiente se agenda
   * con anticipación en un instante EXACTO del reloj del AudioContext,
   * así el empalme lo resuelve el motor de audio y no el hilo de
   * JavaScript, que puede llegar tarde por un re-render pesado o por
   * tener la pestaña en segundo plano.
   *
   * Devuelve null si la llamada quedó invalidada mientras esperaba el
   * DSP (alguien tocó Stop, o arrancó otra reproducción).
   */
  async function scheduleCycle(
    ctx: AudioContext,
    fromSeconds: number,
    atContextTime: number | null,
    untilSeconds: number | null,
    requestId: number,
  ): Promise<{ startContextTime: number; sources: AudioBufferSourceNode[] } | null> {
    const clamped = fromSeconds;

    // Se programan las fuentes de TODAS las pistas, muteadas o no — el
    // silencio/audibilidad ya lo resuelve el GainNode persistente de
    // cada una (ver el useEffect de arriba). Así, mutear/desmutear o
    // tocar Solo A MITAD de la reproducción cambia lo que se escucha
    // de inmediato, sin tener que parar y volver a tocar Play.
    const clipsToPlay: { track: ArrangerTrack; clip: ArrangerClip; rate: number; displayDuration: number }[] = [];
    for (const track of tracks) {
      if (track.clips.length === 0) continue;
      for (const clip of track.clips) {
        const rate = playbackRateFor(clip, projectTempoBpm);
        const displayDuration = displayDurationFor(clip, projectTempoBpm);
        if (clip.startSeconds + displayDuration <= clamped) continue;
        // Con loop, lo que empieza DESPUÉS del final del tramo no entra
        // en esta vuelta. Sin este filtro, el audio de más adelante
        // sonaría encimado con el principio del ciclo siguiente.
        if (untilSeconds != null && clip.startSeconds >= untilSeconds) continue;
        clipsToPlay.push({ track, clip, rate, displayDuration });
      }
    }

    // Pasos 2-3 (rendimiento): la gran mayoría de estos ya están en la
    // caché global (pre-calentados por el useEffect de más arriba) y
    // resuelven en el siguiente microtask — solo un Loop nunca antes
    // usado a este tempo dispara trabajo real, en el Worker, sin tocar
    // este hilo. Se esperan TODOS antes de agendar nada, para no
    // arrancar la reproducción a mitad de cálculo.
    const stretchedBuffers = await Promise.all(
      clipsToPlay.map(({ clip, rate }) => getProcessedBuffer(clip, rate)),
    );

    // Alguien arrancó OTRA reproducción, o la paró, mientras
    // esperábamos el DSP — esta llamada quedó vieja, no agendar nada.
    if (playRequestIdRef.current !== requestId) return null;

    // Con un instante dado (el ciclo siguiente de un loop) se respeta
    // ese instante. Sin él se captura DESPUÉS del await, no antes —
    // así todos los clips quedan perfectamente sincronizados entre sí
    // sin importar cuánto tardó el Worker, en vez de arrastrar un
    // "ahora" que ya quedó viejo.
    const startContextTime = atContextTime ?? ctx.currentTime;

    const sources: AudioBufferSourceNode[] = [];
    for (let i = 0; i < clipsToPlay.length; i++) {
      const { track, clip, rate, displayDuration } = clipsToPlay[i];
      const trackNodes = trackNodesRef.current.get(track.id);
      if (!trackNodes) continue;

      const displayOffset = Math.max(0, clamped - clip.startSeconds);
      // Paso 3 — Time-stretching real: en vez de resamplear con
      // `playbackRate` (efecto vinilo, cambia el tono), se reproduce
      // un buffer YA estirado a la duración correcta (mismo tono). Ese
      // buffer tiene su PROPIA base de tiempo nativa (1 segundo de
      // audio = 1 segundo real, sin resamplear más) — el offset y la
      // duración (definidos contra el buffer ORIGINAL) se convierten
      // dividiendo por `rate`, misma relación que ya usaba
      // displayDuration más arriba.
      // ⚠️ Con repeticiones, el punto del buffer donde hay que entrar
      // NO es `offset + displayOffset`: hay que quedarse DENTRO de la
      // ventana. Si el cursor cayó a mitad de la tercera vuelta de un
      // loop de 2 s, se entra a 0,4 s de la ventana, no a 4,4 s del
      // buffer (que ni siquiera existiría).
      const windowDisplay = clip.sourceDurationSeconds / rate;
      const offsetInWindow = windowDisplay > 0 ? displayOffset % windowDisplay : displayOffset;
      const bufferStart = clip.sourceOffsetSeconds / rate + offsetInWindow;
      let remainingDuration = displayDuration - displayOffset;
      // Con loop, el clip se corta en el final del tramo. Se recorta
      // acá, en la duración de la propia fuente, en vez de llamar
      // source.stop() más tarde: así el corte queda resuelto de una
      // vez en el reloj del audio y no depende de que ningún timer
      // llegue a tiempo.
      if (untilSeconds != null) {
        const available = untilSeconds - Math.max(clamped, clip.startSeconds);
        remainingDuration = Math.min(remainingDuration, available);
      }
      if (remainingDuration <= 0) continue;
      const when = startContextTime + Math.max(0, clip.startSeconds - clamped);

      const source = ctx.createBufferSource();
      source.buffer = stretchedBuffers[i];
      // Las repeticiones las hace el PROPIO nodo, con su loop nativo, y
      // no agendando N fuentes encadenadas: así el empalme entre vuelta
      // y vuelta lo resuelve el motor de audio al sample exacto, y un
      // clip repetido cuarenta veces sigue siendo un solo nodo. El
      // `duration` de start() es el que corta al final, incluso con
      // loop activo.
      if (clip.repeats > 1) {
        source.loop = true;
        source.loopStart = clip.sourceOffsetSeconds / rate;
        source.loopEnd = clip.sourceOffsetSeconds / rate + windowDisplay;
      }
      // playbackRate se queda en 1 (default): el tempo YA está
      // resuelto por el time-stretch — resamplear de nuevo acá
      // volvería a cambiar el tono.
      // Gain POR CLIP (volumen propio + fade in/out), transitorio —
      // se recrea en cada Play igual que la propia fuente, a
      // diferencia del gain/panner de la PISTA que es persistente
      // (ver trackNodesRef más arriba).
      const clipGain = ctx.createGain();
      const fades = fadesFor(clip);
      scheduleGainEnvelope(
        clipGain.gain,
        when,
        displayOffset,
        displayDuration,
        clip.gain,
        fades.fadeInSeconds,
        fades.fadeOutSeconds,
        fades.fadeInShape,
        fades.fadeOutShape,
      );
      source.connect(clipGain);
      clipGain.connect(trackNodes.panner);
      source.start(when, bufferStart, remainingDuration);
      // Las fuentes de los ciclos ya terminados no tienen por qué
      // quedar acumuladas en la lista de "lo que está sonando".
      source.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== source);
      };
      sources.push(source);
    }

    return { startContextTime, sources };
  }

  async function playFrom(fromSeconds: number) {
    const ctx = audioContextRef.current;
    if (!ctx || tracks.length === 0) return;
    if (ctx.state === "suspended") ctx.resume();
    stopAllSources();
    // Se captura DESPUÉS de stopAllSources (que ya incrementó el
    // contador al parar lo anterior) — este es el id "vigente" de ESTA
    // llamada a playFrom.
    const requestId = ++playRequestIdRef.current;

    const { enabled: loopOn, region } = loopRef.current;
    const start = playbackStartFor(fromSeconds, region, loopOn);
    const clamped = Math.max(0, Math.min(totalDurationSeconds, start));
    const cycleEndSeconds = cycleEndFor(clamped, region, loopOn);
    playheadAtStartRef.current = clamped;
    metronomeCursorRef.current = clamped;

    const scheduled = await scheduleCycle(ctx, clamped, null, cycleEndSeconds, requestId);
    if (!scheduled) return;

    playStartContextTimeRef.current = scheduled.startContextTime;
    activeSourcesRef.current = scheduled.sources;
    cycleRef.current = {
      requestId,
      fromSeconds: clamped,
      startContextTime: scheduled.startContextTime,
      endSeconds: cycleEndSeconds,
      endContextTime:
        cycleEndSeconds == null
          ? null
          : scheduled.startContextTime + (cycleEndSeconds - clamped),
      loopStartSeconds: region?.startSeconds ?? 0,
      nextScheduled: false,
      nextMetronomeCursor: null,
    };
    setIsPlaying(true);
    rafRef.current = requestAnimationFrame(drawPlayhead);
    schedulerRef.current = setInterval(runScheduler, SCHEDULER_INTERVAL_MS);

    // Con loop no hay parada automática: para eso está el loop.
    if (cycleEndSeconds == null) {
      const remaining = Math.max(0, totalDurationSeconds - clamped);
      autoStopTimeoutRef.current = setTimeout(() => {
        stopAllSources();
        setPlayheadSeconds(totalDurationSeconds);
        setIsPlaying(false);
      }, remaining * 1000 + 150);
    }
  }

  /** Dónde está el cursor según el reloj del audio, sin tocar nada. */
  function livePosition(ctx: AudioContext, cycle: NonNullable<typeof cycleRef.current>): number {
    const limit = cycle.endSeconds ?? totalDurationSeconds;
    return Math.min(limit, playheadAtStartRef.current + (ctx.currentTime - playStartContextTimeRef.current));
  }

  /**
   * Solo mueve el cursor en pantalla. Nada de lo que se OYE depende de
   * esta función — ver SCHEDULER_INTERVAL_MS.
   */
  function drawPlayhead() {
    const ctx = audioContextRef.current;
    const cycle = cycleRef.current;
    if (!ctx || !cycle) return;
    setPlayheadSeconds(livePosition(ctx, cycle));
    rafRef.current = requestAnimationFrame(drawPlayhead);
  }

  /**
   * Agenda los clics que caen en [fromSeconds, toSeconds) de la línea
   * de tiempo, convertidos al reloj del audio con la base de un ciclo
   * (`baseContextTime` es cuándo arranca, `baseSeconds` desde dónde).
   *
   * La base va por parámetro y no se lee de los refs porque hay que
   * poder agendar contra el ciclo SIGUIENTE, que todavía no empezó.
   */
  function scheduleClicks(
    ctx: AudioContext,
    baseContextTime: number,
    baseSeconds: number,
    fromSeconds: number,
    toSeconds: number,
  ) {
    const { beatSeconds, beatsPerBar } = metronomeGridRef.current;
    for (const index of beatIndicesInWindow(fromSeconds, toSeconds, beatSeconds)) {
      const when = baseContextTime + (index * beatSeconds - baseSeconds);
      // Un beat que ya pasó no se agenda: en el AudioContext, un start()
      // con un instante pasado suena INMEDIATAMENTE, o sea fuera de
      // tiempo, que es peor que no sonar.
      if (when < ctx.currentTime) continue;
      metronomeVoicesRef.current.push(
        scheduleClick(ctx, ctx.destination, when, isDownbeat(index, beatsPerBar), 1),
      );
    }
  }

  /**
   * El agendador: cierra el ciclo que terminó, prepara el siguiente con
   * anticipación, y agenda los clics de metrónomo de la ventana que
   * viene. Corre por setInterval, no por rAF.
   */
  function runScheduler() {
    const ctx = audioContextRef.current;
    const cycle = cycleRef.current;
    if (!ctx || !cycle) return;

    // ¿Dio la vuelta? El audio del ciclo nuevo ya viene sonando desde
    // que se agendó; acá solo se corre la base contra la que se mide
    // todo lo demás. Es un while y no un if: con la pestaña en segundo
    // plano esta función puede tardar más que un ciclo entero en
    // volver a correr, y ahí hay que recuperar varias vueltas de una.
    while (
      cycle.endContextTime != null &&
      cycle.endSeconds != null &&
      ctx.currentTime >= cycle.endContextTime
    ) {
      cycle.fromSeconds = cycle.loopStartSeconds;
      cycle.startContextTime = cycle.endContextTime;
      cycle.endContextTime =
        cycle.startContextTime + (cycle.endSeconds - cycle.loopStartSeconds);
      cycle.nextScheduled = false;
      playheadAtStartRef.current = cycle.fromSeconds;
      playStartContextTimeRef.current = cycle.startContextTime;
      // Los clics del arranque de esta vuelta YA se agendaron junto con
      // su audio; el cursor sigue desde ahí para no repetirlos.
      metronomeCursorRef.current = cycle.nextMetronomeCursor ?? cycle.fromSeconds;
      cycle.nextMetronomeCursor = null;
    }

    // Agendar la vuelta siguiente ANTES de que termine esta.
    if (
      cycle.endContextTime != null &&
      cycle.endSeconds != null &&
      !cycle.nextScheduled &&
      ctx.currentTime > cycle.endContextTime - CYCLE_LOOKAHEAD_SECONDS
    ) {
      cycle.nextScheduled = true;
      const at = cycle.endContextTime;
      const from = cycle.loopStartSeconds;
      const until = cycle.endSeconds;
      void scheduleCycle(ctx, from, at, until, cycle.requestId).then((scheduled) => {
        if (!scheduled || playRequestIdRef.current !== cycle.requestId) return;
        activeSourcesRef.current = [...activeSourcesRef.current, ...scheduled.sources];
      });

      // ⚠️ Los clics de la vuelta que viene se agendan ACÁ, junto con su
      // audio, y no cuando el ciclo efectivamente cambie.
      //
      // Encontrado probándolo: esperar al cambio de ciclo PIERDE el
      // primer clic de cada vuelta, que es justo el del compás, el que
      // sirve para contar. El cambio se detecta recién cuando el reloj
      // del audio YA pasó el punto de loop, así que ese beat quedaba en
      // el pasado y se descartaba por la guarda de más arriba. El
      // síntoma era una separación de un segundo entre clics una vez
      // por vuelta, en vez de medio.
      if (metronomeRef.current) {
        const nextFrom = cycle.nextMetronomeCursor ?? from;
        const nextTo = Math.min(from + CYCLE_LOOKAHEAD_SECONDS, until);
        if (nextTo > nextFrom) {
          scheduleClicks(ctx, at, from, nextFrom, nextTo);
          cycle.nextMetronomeCursor = nextTo;
        }
      }
    }

    if (!metronomeRef.current) return;
    const limit = cycle.endSeconds ?? totalDurationSeconds;
    const windowEnd = Math.min(livePosition(ctx, cycle) + CYCLE_LOOKAHEAD_SECONDS, limit);
    const windowStart = metronomeCursorRef.current;
    if (windowEnd <= windowStart) return;
    scheduleClicks(
      ctx,
      playStartContextTimeRef.current,
      playheadAtStartRef.current,
      windowStart,
      windowEnd,
    );
    metronomeCursorRef.current = windowEnd;
  }

  /**
   * Dónde está el cursor AHORA, leído del reloj del audio y no del
   * estado de React, que va un frame atrás. Lo necesitan pausar y
   * cualquier cosa que re-encole la reproducción en el lugar donde
   * está sonando (encender el loop, marcar un tramo nuevo).
   */
  function currentPlayheadSeconds(): number {
    const ctx = audioContextRef.current;
    const cycle = cycleRef.current;
    if (!ctx || !cycle || !isPlaying) return playheadSeconds;
    return livePosition(ctx, cycle);
  }

  function pausePlayback() {
    const ctx = audioContextRef.current;
    if (!ctx) return;
    const pos = currentPlayheadSeconds();
    stopAllSources();
    setPlayheadSeconds(pos);
    setIsPlaying(false);
  }

  /**
   * Enciende/apaga el loop o cambia el tramo, en un solo lugar porque
   * las tres cosas tienen la misma consecuencia: las fuentes que están
   * sonando se agendaron contra el tramo VIEJO.
   *
   * Por eso se re-encola desde donde está el cursor. Es un corte de un
   * instante y es deliberado: la alternativa —seguir con lo agendado y
   * aplicar el cambio recién en la vuelta siguiente— deja el botón
   * prendido sin que pase nada audible por varios segundos, y eso se
   * lee como que no funcionó.
   */
  function applyLoop(enabled: boolean, region: LoopRegion | null) {
    loopRef.current = { enabled, region };
    setLoopEnabled(enabled);
    setLoopRegion(region);
    if (isPlaying) void playFrom(currentPlayheadSeconds());
  }

  function handleLoopButton() {
    if (loopEnabled) {
      applyLoop(false, loopRegion);
      return;
    }
    let region = loopRegion;
    if (!region) {
      // Sin tramo marcado, se arma uno de cuatro compases desde el
      // compás donde está el cursor. El botón tiene que hacer algo
      // audible la primera vez que se toca: quedar prendido sin efecto
      // y esperar a que además se marque un tramo en la regla es
      // pedirle a la persona que adivine el segundo paso.
      const barIndex = barLengthSeconds > 0 ? Math.floor(playheadSeconds / barLengthSeconds) : 0;
      const start = barIndex * barLengthSeconds;
      region = {
        startSeconds: start,
        endSeconds: start + DEFAULT_LOOP_BARS * barLengthSeconds,
      };
    }
    applyLoop(true, region);
  }

  function handleMetronomeButton() {
    const next = !metronomeEnabled;
    metronomeRef.current = next;
    setMetronomeEnabled(next);
    // Al encenderlo a mitad de la reproducción hay que decirle desde
    // dónde contar: si no, trataría de agendar todos los beats desde
    // el arranque del ciclo, que ya pasaron.
    if (next) metronomeCursorRef.current = currentPlayheadSeconds();
  }

  function handlePlayButton() {
    if (isPlaying) return;
    void playFrom(playheadSeconds);
  }

  // Mismo criterio que ProjectViewer/mixer_screen.dart: primer Stop =
  // pausa (conserva posición); Stop de nuevo sin haber tocado Play =
  // recién ahí vuelve al principio.
  function handleStopButton() {
    if (isPlaying) {
      pausePlayback();
    } else {
      setPlayheadSeconds(0);
    }
  }

  function seekTo(seconds: number) {
    const clamped = Math.max(0, Math.min(totalDurationSeconds, seconds));
    if (isPlaying) {
      void playFrom(clamped);
    } else {
      setPlayheadSeconds(clamped);
    }
  }

  /**
   * Dónde cae el próximo comienzo de compás de lo que está sonando, en
   * el reloj del AudioContext — para que la pre-escucha del Banco entre
   * EN TIEMPO sobre el arreglo en vez de pisar el pulso.
   *
   * Devuelve null con la reproducción parada, y ahí la pre-escucha
   * arranca ya: esperar un compás entero sin nada sonando se sentiría
   * como un botón que no responde.
   */
  function syncContextTime(): number | null {
    const ctx = audioContextRef.current;
    if (!ctx) return null;
    return nextBarContextTime({
      isPlaying,
      playStartContextTime: playStartContextTimeRef.current,
      playheadAtStart: playheadAtStartRef.current,
      contextTime: ctx.currentTime,
      secondsPerBar: barLengthSeconds,
    });
  }

  // ─── Pistas ──────────────────────────────────────────────────────────

  function addTrack() {
    setTracks((prev) => [
      ...prev,
      {
        id: newId(),
        name: `Pista ${prev.length + 1}`,
        volume: 0.8,
        pan: 0,
        isMuted: false,
        isSolo: false,
        clips: [],
        color: TRACK_COLORS[prev.length % TRACK_COLORS.length],
        fx: NO_TRACK_FX,
      },
    ], push("Agregar pista"));
  }

  function updateTrack(trackId: string, patch: Partial<ArrangerTrack>) {
    // Clave de fusión por PISTA: mover un fader dispara un cambio por
    // píxel, y sin esto deshacer retrocedería de a un píxel. Todo el
    // arrastre queda como una sola acción — que es como se vivió.
    setTracks(
      (prev) => prev.map((t) => (t.id === trackId ? { ...t, ...patch } : t)),
      push("Ajustar la pista", `pista:${trackId}`),
    );
  }

  function deleteTrack(trackId: string) {
    setTracks((prev) => prev.filter((t) => t.id !== trackId), push("Eliminar pista"));
    const removed = new Set(tracks.find((t) => t.id === trackId)?.clips.map((c) => c.id) ?? []);
    setSelectedClipIds((prev) => prev.filter((id) => !removed.has(id)));
  }

  // ─── Agregar samples ─────────────────────────────────────────────────

  function buildClipFromBuffer(sample: ArrangerSample, buffer: AudioBuffer, startSeconds: number): ArrangerClip {
    return {
      id: newId(),
      sampleId: sample.id,
      sampleName: sample.name,
      // Lo que hace recuperable este clip después de recargar: el
      // AudioBuffer no se puede serializar, la ruta sí (ver
      // arrangerDraft.ts).
      audioPath: sample.audioPath,
      originalBpm: sample.bpm,
      // La ficha del sample ya sabía esto; antes se usaba para calcular
      // la transposición de abajo y se descartaba.
      sampleKey: sample.key ?? "",
      sampleType: sample.type,
      startSeconds: Math.max(0, startSeconds),
      sourceOffsetSeconds: 0,
      sourceDurationSeconds: buffer.duration,
      repeats: 1,
      gain: 1,
      fadeInSeconds: 0,
      fadeOutSeconds: 0,
      // Si el panel está adaptando al proyecto, el clip nace con la
      // MISMA transposición que se pre-escuchó. Sin esto el sample
      // sonaba en tono mientras lo escuchabas y desafinado apenas lo
      // soltabas, que es peor que no transponer nada.
      pitchShift: matchProject ? transposeSemitonesFor(projectKey || null, sample.key) : 0,
      buffer,
      peaks: computePeaks(buffer, PEAK_BUCKETS),
    };
  }

  function addClipToTrack(trackId: string, clip: ArrangerClip) {
    setTracks(
      (prev) => prev.map((t) => (t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t)),
      push(`Agregar ${clip.sampleName}`),
    );
    selectOnlyClip(clip.id);
  }

  async function addSampleToTrack(sample: ArrangerSample, trackId: string, startSeconds: number) {
    setAddSampleError(null);
    const clampedStart = Math.max(0, startSeconds);

    // Paso 1 (rendimiento) — caché global: si ya lo teníamos (pre-
    // escucha anterior, drag-start que lo calentó, u otro uso previo
    // de este mismo sample), el clip se arma DE UNA, sin red ni
    // esqueleto de carga — esto es lo que hace que reusar un sample
    // sea instantáneo.
    const cachedBuffer = getCachedBuffer(sample.id);
    if (cachedBuffer) {
      addClipToTrack(trackId, buildClipFromBuffer(sample, cachedBuffer, clampedStart));
      return;
    }

    // Paso 4 (rendimiento) — renderizado optimista: no hay nada en
    // caché todavía, así que en vez de esperar en silencio a que
    // termine la red, se muestra YA MISMO un bloque esqueleto en la
    // posición del drop — el clip real (con su forma de onda) lo
    // reemplaza en cuanto el audio esté resuelto.
    const pendingId = newId();
    const track = tracks.find((t) => t.id === trackId);
    setPendingDrops((prev) => [
      ...prev,
      { id: pendingId, trackId, startSeconds: clampedStart, sampleName: sample.name, color: track?.color ?? TRACK_COLORS[0] },
    ]);
    try {
      const buffer = await loadAndCacheBuffer(sample.id, sample.audioPath);
      addClipToTrack(trackId, buildClipFromBuffer(sample, buffer, clampedStart));
    } catch (err) {
      setAddSampleError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingDrops((prev) => prev.filter((p) => p.id !== pendingId));
    }
  }

  /**
   * Subir un archivo de audio local (.mp3/.wav) como pista nueva —
   * mismo lugar de la interfaz que "Abrir Proyecto", pero para un
   * clip suelto en vez de un .mystudio completo. Se decodifica PRIMERO
   * y recién si eso sale bien se crea la pista+clip en un solo paso —
   * así un archivo corrupto/no soportado nunca deja una pista vacía
   * huérfana en el arreglo.
   *
   * sampleType: "Loop" a propósito (no "Imported", que es lo que usan
   * los clips reconstruidos al REABRIR un .mystudio ya exportado, sin
   * BPM de origen disponible — ver buildImportedClip). Acá SÍ hay
   * forma de darle un BPM de origen: originalBpm arranca en el tempo
   * ACTUAL del proyecto (así el rate inicial es 1.0, sin cambiar nada
   * hasta que el usuario lo edite) y queda editable desde la barra de
   * herramientas del clip seleccionado (ver el control "BPM original"
   * más abajo) — eso es lo que habilita playbackRateFor a
   * time-stretchear este clip igual que cualquier loop del Banco de
   * Sonidos, con el MISMO motor (audioDsp.ts) que ya usa el pitch.
   */
  /**
   * Mezcla a mono para analizar. El detector de tempo mira UN canal:
   * quedarse solo con el izquierdo perdería un bombo paneado a la
   * derecha, que es justo lo que más aporta al pulso.
   */
  function monoMix(buffer: AudioBuffer): Float32Array {
    if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
    const mixed = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < mixed.length; i++) mixed[i] += data[i];
    }
    for (let i = 0; i < mixed.length; i++) mixed[i] /= buffer.numberOfChannels;
    return mixed;
  }

  async function handleUploadAudioFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite volver a elegir el mismo archivo después
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".mp3") && !lowerName.endsWith(".wav")) {
      setAddSampleError("Solo se aceptan archivos .mp3 o .wav.");
      return;
    }
    const ctx = audioContextRef.current;
    if (!ctx) {
      setAddSampleError("El motor de audio todavía no está listo — probá de nuevo en un segundo.");
      return;
    }

    setAddSampleError(null);
    setIsUploadingAudio(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = await ctx.decodeAudioData(arrayBuffer);
      const displayName = file.name.replace(/\.(mp3|wav)$/i, "");
      const sampleId = `local:${newId()}`;
      // Hidrata la caché global igual que cualquier otro audio que
      // entra a la app — no estrictamente necesario para un archivo
      // subido una sola vez, pero mantiene consistencia con el resto
      // del código (Sound Bank, .mystudio importado).
      setCachedBuffer(sampleId, buffer);

      // ─── Tempo detectado ───────────────────────────────────────
      //
      // Hasta acá el Arranger asumía `originalBpm = tempo del proyecto`,
      // o sea "esto ya está a tiempo, no lo toques". Es la suposición
      // más segura y casi siempre es falsa.
      //
      // ⚠️ Pero detectar el tempo NO alcanza para estirar. Un loop de
      // cuatro compases y una canción entera son dos intenciones
      // distintas: al loop lo querés al tempo del proyecto, a la canción
      // la querés como la grabaste. Estirar una canción de tres minutos
      // sin que nadie lo pida es un desastre silencioso, así que solo se
      // estira cuando hay evidencia FUERTE de que es un loop: que dure
      // poco Y que calce en un número entero de compases. En los demás
      // casos el tempo se INFORMA y la persona decide con el control de
      // "BPM original".
      const mono = monoMix(buffer);
      const estimate = detectTempo(mono, buffer.sampleRate, timeSignatureNumerator);
      // La tonalidad se DETECTA pero nunca se usa sola para transponer:
      // se guarda en el clip para poder verla y compararla contra la del
      // proyecto, y la transposición sigue siendo una decisión explícita
      // (el botón "Adaptar" de la barra del clip).
      const keyEstimate = detectKey(mono, buffer.sampleRate);
      // Para ESTIRAR hace falta evidencia fuerte de que es un loop, y
      // la evidencia fuerte es que el archivo DURE un número entero de
      // compases al tempo detectado. La confianza no entra acá a
      // propósito: mide ambigüedad entre candidatos, no si el archivo
      // es un loop (ver MIN_TEMPO_CONFIDENCE).
      const isLoop =
        estimate != null && estimate.snappedToLoop && buffer.duration <= MAX_LOOP_SECONDS;
      const detectedBpm = estimate ? Math.round(estimate.bpm * 10) / 10 : null;

      const keyNote = keyEstimate
        ? ` Tonalidad detectada: ${keyEstimate.key}${
            keyEstimate.confidence < 0.15 ? ` (o ${keyEstimate.alternative})` : ""
          }.`
        : " No encontré una tonalidad definida (puede ser percusión).";

      if (isLoop) {
        setDraftNotice(
          `"${displayName}": detecté ${detectedBpm} BPM (${estimate!.bars} ${estimate!.bars === 1 ? "compás" : "compases"}), ` +
            `así que el clip sigue el tempo del proyecto. Si no es así, corregí "BPM original" en la barra del clip.` +
            keyNote,
        );
      } else if (detectedBpm != null) {
        const reserva =
          estimate!.confidence < MIN_TEMPO_CONFIDENCE ? " (la lectura no es muy clara)" : "";
        setDraftNotice(
          `"${displayName}": detecté unos ${detectedBpm} BPM${reserva}, pero no calza en compases enteros o es muy largo ` +
            `para ser un loop, así que lo dejé SIN estirar. Si querés que siga el tempo del proyecto, poné ${detectedBpm} en "BPM original".` +
            keyNote,
        );
      } else {
        setDraftNotice(
          `"${displayName}": no encontré un pulso claro, así que el clip queda sin estirar. ` +
            `Si sabés a qué tempo está, ponelo en "BPM original" y se ajusta solo.` +
            keyNote,
        );
      }

      const trackId = newId();
      const trackColor = TRACK_COLORS[tracks.length % TRACK_COLORS.length];
      const clip: ArrangerClip = {
        id: newId(),
        sampleId,
        sampleName: displayName,
        // Vacía a propósito: estos bytes vinieron del disco del
        // usuario y nunca estuvieron en Storage, así que no hay de
        // dónde volver a bajarlos si se recarga la página. El borrador
        // cuenta estos clips como perdidos y lo avisa, en vez de
        // restaurar un arreglo mudo.
        audioPath: "",
        // Con el tempo del proyecto acá, playbackRateFor da 1.0 y el
        // clip no se toca — que es lo que corresponde cuando no hay
        // evidencia de que sea un loop.
        originalBpm: isLoop ? estimate!.bpm : projectTempoBpm,
        sampleKey: keyEstimate?.key ?? "",
        sampleType: "Loop",
        startSeconds: Math.max(0, playheadSeconds),
        sourceOffsetSeconds: 0,
        sourceDurationSeconds: buffer.duration,
        repeats: 1,
        gain: 1,
        fadeInSeconds: 0,
        fadeOutSeconds: 0,
        pitchShift: 0,
        buffer,
        peaks: computePeaks(buffer, PEAK_BUCKETS),
      };
      setTracks((prev) => [
        ...prev,
        {
          id: trackId,
          name: displayName,
          volume: 0.8,
          pan: 0,
          isMuted: false,
          isSolo: false,
          clips: [clip],
          color: trackColor,
          fx: NO_TRACK_FX,
        },
      ]);
      selectOnlyClip(clip.id);
    } catch (err) {
      setAddSampleError(
        err instanceof Error
          ? `No se pudo cargar "${file.name}": ${err.message}`
          : `No se pudo cargar "${file.name}".`,
      );
    } finally {
      setIsUploadingAudio(false);
    }
  }

  /** Click directo en el Banco de Sonidos (sin arrastrar): a la primera pista (creándola si hace falta), en el cursor actual. */
  async function handleQuickAddSample(sample: ArrangerSample) {
    let targetTrackId = tracks[0]?.id;
    if (!targetTrackId) {
      targetTrackId = newId();
      // SILENT: para el usuario esto fue UN click en un sample, no dos
      // acciones. El paso deshacible es el del clip, que llega
      // enseguida con su propio nombre; si esta pista contara aparte,
      // habría que apretar deshacer dos veces para volver atrás un
      // solo click.
      setTracks([
        {
          id: targetTrackId,
          name: "Pista 1",
          volume: 0.8,
          pan: 0,
          isMuted: false,
          isSolo: false,
          clips: [],
          color: TRACK_COLORS[0],
          fx: NO_TRACK_FX,
        },
      ], SILENT);
    }
    await addSampleToTrack(sample, targetTrackId, playheadSeconds);
  }

  function handleTrackDrop(e: React.DragEvent<HTMLDivElement>, trackId: string) {
    e.preventDefault();
    const raw = e.dataTransfer.getData(SAMPLE_DRAG_MIME);
    if (!raw) return;
    const sample = JSON.parse(raw) as ArrangerSample;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, e.clientX - rect.left);
    const startSeconds = x / effectivePixelsPerSecond;
    void addSampleToTrack(sample, trackId, startSeconds);
  }

  // ─── Selección / clipboard ───────────────────────────────────────────

  function findClip(clipId: string): { track: ArrangerTrack; clip: ArrangerClip } | null {
    for (const track of tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return { track, clip };
    }
    return null;
  }

  function updateClip(clipId: string, patch: Partial<ArrangerClip>) {
    setTracks((prev) =>
      prev.map((t) => ({
        ...t,
        clips: t.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
      })),
    );
  }

  /** Los clips seleccionados, con su pista, en el orden del arreglo. */
  function selectedPlacements(): { clip: ArrangerClip; trackIndex: number; startSeconds: number }[] {
    const ids = new Set(selectedClipIds);
    const placements: { clip: ArrangerClip; trackIndex: number; startSeconds: number }[] = [];
    tracks.forEach((track, trackIndex) => {
      for (const clip of track.clips) {
        if (ids.has(clip.id)) placements.push({ clip, trackIndex, startSeconds: clip.startSeconds });
      }
    });
    return placements;
  }

  function deleteSelectedClips() {
    if (selectedClipIds.length === 0) return;
    const ids = new Set(selectedClipIds);
    setTracks(
      (prev) => prev.map((t) => ({ ...t, clips: t.clips.filter((c) => !ids.has(c.id)) })),
      // La etiqueta dice CUÁNTOS: deshacer tiene que anunciar el tamaño
      // real de lo que va a devolver, no "un clip" cuando fueron doce.
      push(ids.size === 1 ? "Eliminar clip" : "Eliminar " + ids.size + " clips"),
    );
    setSelectedClipIds([]);
  }

  function copySelectedClips() {
    const placements = selectedPlacements();
    if (placements.length === 0) return;
    setClipboard(buildClipboard(placements));
    setClipNotice(null);
  }

  function pasteClipboard() {
    if (!clipboard || clipboard.length === 0 || tracks.length === 0) return;
    // El ancla es el PRIMER clip que se seleccionó (arrangerSelection
    // conserva ese orden a propósito), no el que esté más arriba.
    const anchorId = selectedClipIds[0];
    const anchorIndex = anchorId ? tracks.findIndex((t) => t.clips.some((c) => c.id === anchorId)) : -1;
    const { placed, droppedCount } = placeClipboard(
      clipboard,
      anchorIndex >= 0 ? anchorIndex : Math.min(pasteTrackIndex, tracks.length - 1),
      playheadSeconds,
      tracks.length,
    );
    if (placed.length === 0) {
      setClipNotice("No hay pistas donde pegar ese bloque.");
      return;
    }

    const byTrackIndex = new Map<number, ArrangerClip[]>();
    const newIds: string[] = [];
    let blockEnd = 0;
    for (const placement of placed) {
      const clip: ArrangerClip = { ...placement.clip, id: newId(), startSeconds: placement.startSeconds };
      newIds.push(clip.id);
      blockEnd = Math.max(blockEnd, clip.startSeconds + displayDurationFor(clip, projectTempoBpm));
      byTrackIndex.set(placement.trackIndex, [...(byTrackIndex.get(placement.trackIndex) ?? []), clip]);
    }

    setTracks(
      (prev) =>
        prev.map((t, i) => {
          const added = byTrackIndex.get(i);
          return added ? { ...t, clips: [...t.clips, ...added] } : t;
        }),
      push(placed.length === 1 ? "Pegar clip" : "Pegar " + placed.length + " clips"),
    );
    setSelectedClipIds(newIds);
    setClipNotice(
      droppedCount > 0
        ? "Se pegaron " + placed.length + ": faltan pistas para " + droppedCount + " clip" +
          (droppedCount === 1 ? "" : "s") + " más."
        : null,
    );
    // Flujo rápido de edición: el cursor salta al FINAL de lo pegado —
    // así, pegar varias veces seguidas (Ctrl/Cmd+V repetido) encadena el
    // bloque en secuencia ininterrumpida, sin reubicar el cursor a mano.
    seekTo(blockEnd);
  }

  function duplicateSelectedClips() {
    const placements = selectedPlacements();
    if (placements.length === 0) return;
    // El corrimiento es el LARGO DEL BLOQUE ENTERO, no la duración de
    // cada clip por separado: duplicar cuatro compases tiene que dejar
    // la copia justo después de los cuatro compases. Con un solo clip
    // el tramo ES su duración, así que sigue haciendo lo de siempre.
    const span = selectionSpan(
      placements.map((p) => ({
        id: p.clip.id,
        startSeconds: p.startSeconds,
        displayDuration: displayDurationFor(p.clip, projectTempoBpm),
      })),
    );
    if (!span) return;
    const offset = span.endSeconds - span.startSeconds;

    const byTrackIndex = new Map<number, ArrangerClip[]>();
    const newIds: string[] = [];
    for (const placement of placements) {
      const clip: ArrangerClip = {
        ...placement.clip,
        id: newId(),
        startSeconds: placement.startSeconds + offset,
      };
      newIds.push(clip.id);
      byTrackIndex.set(placement.trackIndex, [...(byTrackIndex.get(placement.trackIndex) ?? []), clip]);
    }

    setTracks(
      (prev) =>
        prev.map((t, i) => {
          const added = byTrackIndex.get(i);
          return added ? { ...t, clips: [...t.clips, ...added] } : t;
        }),
      push(placements.length === 1 ? "Duplicar clip" : "Duplicar " + placements.length + " clips"),
    );
    setSelectedClipIds(newIds);
  }

  // Problema 3 — divide el clip seleccionado exactamente en la
  // posición del cursor: la pieza izquierda (mismo id) se acorta, la
  // derecha es un clip NUEVO que arranca donde cortaste, apuntando a
  // la ventana restante del MISMO AudioBuffer (nunca se toca el WAV
  // original) — mismo espíritu que splitClip del lado Flutter.
  function splitSelectedClipAtPlayhead() {
    const found = selectedClipId ? findClip(selectedClipId) : null;
    if (!found) return;
    const { track, clip } = found;
    const rate = playbackRateFor(clip, projectTempoBpm);
    const displayDuration = clip.sourceDurationSeconds / rate;
    const cutOffsetDisplay = playheadSeconds - clip.startSeconds;
    // El cursor tiene que caer DENTRO del clip (con un margen chico,
    // para no crear una pieza de duración ~0 por un click casi en el borde).
    if (cutOffsetDisplay <= 0.02 || cutOffsetDisplay >= displayDuration - 0.02) return;

    const cutOffsetSource = cutOffsetDisplay * rate;
    // El corte nuevo es un borde DURO — cualquier fade que hubiera
    // justo ahí (fadeOut de lo que ahora es el medio del clip
    // izquierdo, fadeIn de lo que ahora es el medio del derecho) ya no
    // tiene sentido; se conserva solo el fade del lado que sigue
    // siendo un extremo real del audio (mismo criterio que un DAW).
    const leftClip: ArrangerClip = {
      ...clip,
      sourceDurationSeconds: cutOffsetSource,
      // Las piezas de un corte no heredan las repeticiones: partir por
      // la mitad "esto suena tres veces" no tiene un significado obvio,
      // y dejar el multiplicador daría dos clips que duran el triple de
      // lo que se ve en pantalla.
      repeats: 1,
      fadeOutSeconds: 0,
    };
    const rightClip: ArrangerClip = {
      ...clip,
      id: newId(),
      startSeconds: playheadSeconds,
      sourceOffsetSeconds: clip.sourceOffsetSeconds + cutOffsetSource,
      sourceDurationSeconds: clip.sourceDurationSeconds - cutOffsetSource,
      repeats: 1,
      fadeInSeconds: 0,
    };

    setTracks((prev) =>
      prev.map((t) =>
        t.id === track.id
          ? { ...t, clips: t.clips.flatMap((c) => (c.id === clip.id ? [leftClip, rightClip] : [c])) }
          : t,
      ),
    );
    selectOnlyClip(rightClip.id);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      if (e.code === "Space") {
        // Problema 2 — Play/Pausa con la barra espaciadora.
        // preventDefault: sin esto el navegador scrollea la página
        // (comportamiento default de Space sobre el body).
        e.preventDefault();
        if (isPlaying) {
          pausePlayback();
        } else {
          void playFrom(playheadSeconds);
        }
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelectedClips();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        // Ctrl/Cmd+A selecciona TODOS los clips del arreglo. Va antes
        // que la rama de la "c" y la "v" por prolijidad, no por
        // precedencia: son teclas distintas.
        e.preventDefault();
        setSelectedClipIds(tracks.flatMap((t) => t.clips.map((c) => c.id)));
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        e.preventDefault();
        copySelectedClips();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        e.preventDefault();
        pasteClipboard();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        // Ctrl+Z deshace; Ctrl+Shift+Z y Ctrl+Y rehacen (las dos
        // convenciones conviven según de qué editor venga cada uno).
        e.preventDefault();
        if (e.shiftKey) arrangement.redo();
        else arrangement.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        arrangement.redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelectedClips();
      } else if (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "s") {
        // Problema 3 — 'S' corta el clip seleccionado en el cursor.
        e.preventDefault();
        splitSelectedClipAtPlayhead();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClipIds, clipboard, tracks, projectTempoBpm, playheadSeconds, isPlaying, arrangement]);

  // ─── Arrastrar un clip existente (mover horizontalmente) ────────────

  function handleClipPointerDown(
    e: React.PointerEvent<HTMLDivElement>,
    trackId: string,
    clip: ArrangerClip,
  ) {
    e.stopPropagation();

    // Ctrl/Cmd/Shift+click SUMA o SACA de la selección, y no arrastra
    // nada. Los dos gestos tienen que estar separados: si armar una
    // selección de seis clips además los moviera un par de píxeles,
    // seleccionar sería una forma de desalinear el arreglo sin querer.
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      setSelectedClipIds((prev) => toggleSelection(prev, clip.id));
      return;
    }

    // Agarrar un clip que YA está en una selección múltiple arrastra
    // todo el bloque. Agarrar uno de afuera reemplaza la selección:
    // si no, mover un clip suelto después de haber seleccionado otros
    // se llevaría puestos a esos otros.
    const alreadySelected = selectedClipIds.includes(clip.id);
    const movingClipIds = alreadySelected && selectedClipIds.length > 1 ? selectedClipIds : [clip.id];
    if (!alreadySelected) selectOnlyClip(clip.id);

    // Posición exacta (en segundos) del punto donde se tocó DENTRO del
    // clip — currentTarget (no target) para que dé lo mismo clickear
    // el fondo del clip o el <canvas> de la forma de onda de adentro.
    const clipRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const clickSeekSeconds = clip.startSeconds + (e.clientX - clipRect.left) / effectivePixelsPerSecond;
    dragRef.current = {
      trackId,
      clipId: clip.id,
      movingClipIds,
      startClientX: e.clientX,
      startClientY: e.clientY,
      lastClientX: e.clientX,
      lastClientY: e.clientY,
      originalStartSeconds: clip.startSeconds,
      displayDuration: displayDurationFor(clip, projectTempoBpm),
      hoveredTrackId: trackId,
      previewStartSeconds: clip.startSeconds,
      clickSeekSeconds,
    };
    setDragPreviewStartSeconds(clip.startSeconds);
    setDragOriginTrackId(trackId);
    setDragHoverTrackId(trackId);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    // Paso 3 (arrastrar entre pistas): el pointer capture ata los
    // eventos siguientes al DIV DEL CLIP — sus ancestros solo bubblean
    // dentro del carril de ORIGEN, así que nunca nos enteraríamos de
    // que el mouse pasó a otra fila usando el onPointerMove del
    // carril (ver handleLanePointerMove, que ya no maneja este caso).
    // Escuchar en window funciona sin importar dónde esté el mouse en
    // pantalla; document.elementFromPoint + data-track-id (puesto en
    // cada carril) dicen sobre qué pista está ahora.
    const handleWindowMove = (ev: PointerEvent) => {
      // Alt suelta el imán mientras se arrastra, sin tener que ir hasta
      // el selector y volver. Es el gesto de Ableton y Logic, y hace
      // falta porque a veces uno quiere justamente lo que la grilla no
      // permite (un golpe adelantado, un efecto a contratiempo).
      updateClipDragPreview(ev.clientX, ev.clientY, ev.altKey);
    };
    const handleWindowUp = () => {
      window.removeEventListener("pointermove", handleWindowMove);
      window.removeEventListener("pointerup", handleWindowUp);
      handleClipPointerUp();
    };
    window.addEventListener("pointermove", handleWindowMove);
    window.addEventListener("pointerup", handleWindowUp);
  }

  /** Actualiza la posición/imán/pista-destino del clip en arrastre — llamado desde el listener de window, ver handleClipPointerDown. */
  function updateClipDragPreview(clientX: number, clientY: number, bypassSnap = false) {
    const moveDrag = dragRef.current;
    if (!moveDrag) return;
    moveDrag.lastClientX = clientX;
    moveDrag.lastClientY = clientY;

    const deltaSeconds = (clientX - moveDrag.startClientX) / effectivePixelsPerSecond;
    const rawStart = Math.max(0, moveDrag.originalStartSeconds + deltaSeconds);
    const snapped = snapDraggedClip(
      moveDrag.clipId,
      rawStart,
      moveDrag.displayDuration,
      bypassSnap,
    );
    moveDrag.previewStartSeconds = snapped.startSeconds;
    setDragPreviewStartSeconds(snapped.startSeconds);
    setSnapGuideSeconds(snapped.guideSeconds);

    const hoveredEl = document.elementFromPoint(clientX, clientY);
    const laneEl = hoveredEl instanceof Element ? hoveredEl.closest("[data-track-id]") : null;
    const hoveredTrackId = laneEl?.getAttribute("data-track-id") ?? moveDrag.trackId;
    moveDrag.hoveredTrackId = hoveredTrackId;
    setDragHoverTrackId(hoveredTrackId);
  }

  // "Imán" al arrastrar un clip: si el punto crudo (sin ajustar) del
  // mouse cae a SNAP_THRESHOLD_PX o menos de un borde candidato
  // (continuación con otro clip, o alinear inicios/finales entre
  // clips de CUALQUIER pista), se pega ahí. Como la distancia se mide
  // siempre contra la posición CRUDA del mouse (no contra el último
  // valor ya pegado), seguir arrastrando más allá del radio lo suelta
  // solo — no hace falta ningún estado extra de "se soltó el imán".
  /**
   * Los candidatos del imán salen de arrangerSnap.ts (puro y probado);
   * acá solo se arma la entrada: cuánto vale un píxel con el zoom
   * actual, qué paso tiene la grilla, y qué otros clips hay — con el
   * que se está arrastrando excluido, porque pegarse a uno mismo no
   * significa nada.
   */
  function snapDraggedClip(
    clipId: string,
    rawStartSeconds: number,
    displayDuration: number,
    bypassSnap = false,
  ): { startSeconds: number; guideSeconds: number | null } {
    if (bypassSnap) return { startSeconds: rawStartSeconds, guideSeconds: null };

    const neighbours: SnapNeighbour[] = [];
    for (const track of tracks) {
      for (const other of track.clips) {
        if (other.id === clipId) continue;
        neighbours.push({
          startSeconds: other.startSeconds,
          displayDuration: displayDurationFor(other, projectTempoBpm),
        });
      }
    }

    return computeSnappedStart({
      rawStartSeconds,
      displayDuration,
      pixelsPerSecond: effectivePixelsPerSecond,
      gridSeconds,
      neighbours,
      thresholdPx: SNAP_THRESHOLD_PX,
    });
  }

  function handleClipPointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragPreviewStartSeconds(null);
    setSnapGuideSeconds(null);
    setDragOriginTrackId(null);
    setDragHoverTrackId(null);
    if (!drag) return;

    // El clip YA se seleccionó en el pointerDown — acá solo falta
    // decidir si además hay que mover el cursor de reproducción: si el
    // puntero prácticamente no se movió, esto fue un CLICK (tocar el
    // clip), no un arrastre, así que el clip se queda donde estaba y
    // el cursor salta al punto exacto donde se tocó.
    const movedPx = Math.hypot(drag.lastClientX - drag.startClientX, drag.lastClientY - drag.startClientY);
    if (movedPx < CLICK_MOVE_THRESHOLD_PX) {
      seekTo(drag.clickSeekSeconds);
      return;
    }

    const newStart = drag.previewStartSeconds; // del ref, no del estado — ver la nota en dragRef

    // Bloque de varios clips: se corren TODOS el mismo delta y cada uno
    // se queda en SU pista.
    //
    // ⚠️ El arrastre entre pistas queda deliberadamente afuera del
    // caso múltiple. Trasladar un bloque que ocupa tres pistas hacia
    // abajo obliga a recortar contra la última, y ahí dos clips que
    // estaban en pistas distintas terminarían apilados sonando a la
    // vez — el mismo motivo por el que placeClipboard descarta en vez
    // de apilar. Con UN clip seleccionado, mover entre pistas sigue
    // funcionando igual que siempre.
    if (drag.movingClipIds.length > 1) {
      const delta = newStart - drag.originalStartSeconds;
      if (delta === 0) return;
      const movingIds = new Set(drag.movingClipIds);
      setTracks(
        (prev) =>
          prev.map((t) => ({
            ...t,
            clips: t.clips.map((c) =>
              movingIds.has(c.id) ? { ...c, startSeconds: Math.max(0, c.startSeconds + delta) } : c,
            ),
          })),
        push(`Mover ${drag.movingClipIds.length} clips`),
      );
      return;
    }

    const targetTrackId = drag.hoveredTrackId;
    const movedToOtherTrack = targetTrackId !== drag.trackId;
    if (!movedToOtherTrack && newStart === drag.originalStartSeconds) return; // sin cambios reales

    setTracks((prev) => {
      if (!movedToOtherTrack) {
        return prev.map((t) =>
          t.id === drag.trackId
            ? { ...t, clips: t.clips.map((c) => (c.id === drag.clipId ? { ...c, startSeconds: newStart } : c)) }
            : t,
        );
      }

      // Paso 3 — arrastrar entre pistas: sacar el clip de la pista de
      // origen y agregarlo a la de destino, con la posición (ya con
      // imán aplicado) que tenía al soltar.
      let movedClip: ArrangerClip | null = null;
      const withoutClip = prev.map((t) => {
        if (t.id !== drag.trackId) return t;
        const found = t.clips.find((c) => c.id === drag.clipId);
        if (found) movedClip = { ...found, startSeconds: newStart };
        return { ...t, clips: t.clips.filter((c) => c.id !== drag.clipId) };
      });
      if (!movedClip) return prev; // no debería pasar — el clip desapareció bajo el mouse
      return withoutClip.map((t) => (t.id === targetTrackId ? { ...t, clips: [...t.clips, movedClip!] } : t));
    }, push("Mover clip"));
  }

  // ─── Marcar el tramo de loop en la regla ────────────────────────────

  function handleRulerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const secondsAt = (clientX: number) => Math.max(0, (clientX - rect.left) / effectivePixelsPerSecond);
    const seconds = secondsAt(e.clientX);
    loopDragRef.current = {
      startSeconds: seconds,
      lastSeconds: seconds,
      startClientX: e.clientX,
      moved: false,
    };
    setLoopDraft({ fromSeconds: seconds, toSeconds: seconds });

    const handleWindowMove = (ev: PointerEvent) => {
      const drag = loopDragRef.current;
      if (!drag) return;
      if (Math.abs(ev.clientX - drag.startClientX) >= CLICK_MOVE_THRESHOLD_PX) drag.moved = true;
      drag.lastSeconds = secondsAt(ev.clientX);
      setLoopDraft({
        fromSeconds: Math.min(drag.startSeconds, drag.lastSeconds),
        toSeconds: Math.max(drag.startSeconds, drag.lastSeconds),
      });
    };
    const handleWindowUp = () => {
      window.removeEventListener("pointermove", handleWindowMove);
      window.removeEventListener("pointerup", handleWindowUp);
      const drag = loopDragRef.current;
      loopDragRef.current = null;
      setLoopDraft(null);
      if (!drag) return;
      if (!drag.moved) {
        // Un click en la regla sigue siendo mover el cursor: es el
        // gesto que ya existía y el que más se usa.
        seekTo(drag.startSeconds);
        return;
      }
      const region = normalizeLoopRegion(drag.startSeconds, drag.lastSeconds, gridSeconds);
      // Marcar un tramo lo ENCIENDE. Dejarlo dibujado pero apagado
      // obligaría a un segundo gesto para que suene, y nadie marca un
      // loop para no escucharlo.
      if (region) applyLoop(true, region);
    };
    window.addEventListener("pointermove", handleWindowMove);
    window.addEventListener("pointerup", handleWindowUp);
  }

  // ─── Rectángulo de goma (seleccionar varios clips) ──────────────────

  /** Los clips del arreglo con su duración EN PANTALLA, que es contra lo que se mide el rectángulo. */
  function selectableTracks() {
    return tracks.map((track) => ({
      id: track.id,
      clips: track.clips.map((clip) => ({
        id: clip.id,
        startSeconds: clip.startSeconds,
        displayDuration: displayDurationFor(clip, projectTempoBpm),
      })),
    }));
  }

  function handleLanePointerDown(e: React.PointerEvent<HTMLDivElement>, trackIndex: number) {
    // Solo el FONDO del carril arranca un rectángulo. Un pointerdown
    // sobre un clip llega hasta acá por bubbling, y si no se filtrara,
    // agarrar un clip empezaría también una selección por detrás.
    if (e.target !== e.currentTarget) return;

    // Tocar un carril lo vuelve el destino de lo próximo que se pegue.
    setPasteTrackIndex(trackIndex);

    const rect = e.currentTarget.getBoundingClientRect();
    const seconds = Math.max(0, (e.clientX - rect.left) / effectivePixelsPerSecond);
    marqueeRef.current = {
      trackIndexA: trackIndex,
      trackIndexB: trackIndex,
      secondsA: seconds,
      secondsB: seconds,
      baseSelection: selectedClipIds,
      additive: e.shiftKey || e.ctrlKey || e.metaKey,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
    };
    setMarquee({ trackFrom: trackIndex, trackTo: trackIndex, fromSeconds: seconds, toSeconds: seconds });

    // Mismo motivo que en el arrastre de clips: escuchar en window es
    // lo único que se entera de que el mouse pasó a OTRA fila.
    const handleWindowMove = (ev: PointerEvent) => updateMarquee(ev.clientX, ev.clientY);
    const handleWindowUp = () => {
      window.removeEventListener("pointermove", handleWindowMove);
      window.removeEventListener("pointerup", handleWindowUp);
      finishMarquee();
    };
    window.addEventListener("pointermove", handleWindowMove);
    window.addEventListener("pointerup", handleWindowUp);
  }

  function updateMarquee(clientX: number, clientY: number) {
    const state = marqueeRef.current;
    if (!state) return;
    if (Math.hypot(clientX - state.startClientX, clientY - state.startClientY) >= CLICK_MOVE_THRESHOLD_PX) {
      state.moved = true;
    }

    const hovered = document.elementFromPoint(clientX, clientY);
    const lane = hovered instanceof Element ? hovered.closest("[data-track-index]") : null;
    if (lane) {
      const index = Number(lane.getAttribute("data-track-index"));
      if (Number.isFinite(index)) state.trackIndexB = index;
      // Los segundos se miden contra el carril que está DEBAJO del
      // mouse, no contra el de origen: los dos empiezan en la misma x,
      // pero el de origen puede haber quedado fuera de pantalla.
      const rect = lane.getBoundingClientRect();
      state.secondsB = Math.max(0, (clientX - rect.left) / effectivePixelsPerSecond);
    }

    setMarquee({
      trackFrom: Math.min(state.trackIndexA, state.trackIndexB),
      trackTo: Math.max(state.trackIndexA, state.trackIndexB),
      fromSeconds: Math.min(state.secondsA, state.secondsB),
      toSeconds: Math.max(state.secondsA, state.secondsB),
    });
  }

  function finishMarquee() {
    const state = marqueeRef.current;
    marqueeRef.current = null;
    setMarquee(null);
    if (!state) return;

    if (!state.moved) {
      // Click en el vacío: deseleccionar. Es la salida natural de una
      // selección múltiple — sin esto había que ir a tocar otro clip,
      // que además lo selecciona.
      if (!state.additive) setSelectedClipIds([]);
      return;
    }

    const hit = clipsInRect(
      selectableTracks(),
      state.trackIndexA,
      state.trackIndexB,
      state.secondsA,
      state.secondsB,
    );
    setSelectedClipIds(
      state.additive ? Array.from(new Set([...state.baseSelection, ...hit])) : hit,
    );
  }

  // ─── Problema 3: tiradores de recorte (bordes del clip seleccionado) ─

  function handleTrimPointerDown(
    e: React.PointerEvent<HTMLDivElement>,
    trackId: string,
    clip: ArrangerClip,
    edge: "left" | "right",
  ) {
    e.stopPropagation();
    trimDragRef.current = { trackId, clipId: clip.id, edge, startClientX: e.clientX, original: clip };
    setTrimPreview({
      startSeconds: clip.startSeconds,
      sourceOffsetSeconds: clip.sourceOffsetSeconds,
      sourceDurationSeconds: clip.sourceDurationSeconds,
      repeats: clip.repeats,
    });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handleTrimPointerUp() {
    const drag = trimDragRef.current;
    const preview = trimPreview;
    trimDragRef.current = null;
    setTrimPreview(null);
    if (!drag || !preview) return;

    setTracks((prev) =>
      prev.map((t) =>
        t.id === drag.trackId
          ? { ...t, clips: t.clips.map((c) => (c.id === drag.clipId ? { ...c, ...preview } : c)) }
          : t,
      ),
    );
  }

  // Tiradores de fade: se agarran desde una esquina superior del clip
  // y se arrastran HORIZONTALMENTE — igual gesto que Ableton/Logic, la
  // línea diagonal que "cae" desde el extremo hasta donde el volumen
  // llega al 100%. Van en segundos de LÍNEA DE TIEMPO (no los afecta
  // el playbackRate del clip).
  function handleFadePointerDown(
    e: React.PointerEvent<HTMLDivElement>,
    trackId: string,
    clip: ArrangerClip,
    edge: "in" | "out",
  ) {
    e.stopPropagation();
    const displayDuration = displayDurationFor(clip, projectTempoBpm);
    fadeDragRef.current = { trackId, clipId: clip.id, edge, startClientX: e.clientX, original: clip, displayDuration };
    setFadePreview({ fadeInSeconds: clip.fadeInSeconds, fadeOutSeconds: clip.fadeOutSeconds });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handleFadePointerUp() {
    const drag = fadeDragRef.current;
    const preview = fadePreview;
    fadeDragRef.current = null;
    setFadePreview(null);
    if (!drag || !preview) return;
    updateClip(drag.clipId, preview);
  }

  // Un solo manejador de pointermove por carril para recortar/fade — el
  // arrastre de "mover clip" (dragRef) se maneja aparte, con listeners
  // de window (ver handleClipPointerDown), porque ese sí necesita
  // detectar cruces entre pistas; trim/fade nunca cruzan de pista, les
  // alcanza con el bubbling normal dentro de su propio carril.
  function handleLanePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const fadeDrag = fadeDragRef.current;
    if (fadeDrag) {
      const deltaSeconds = (e.clientX - fadeDrag.startClientX) / effectivePixelsPerSecond;
      if (fadeDrag.edge === "in") {
        const newFadeIn = Math.max(
          0,
          Math.min(fadeDrag.displayDuration, fadeDrag.original.fadeInSeconds + deltaSeconds),
        );
        setFadePreview({ fadeInSeconds: newFadeIn, fadeOutSeconds: fadeDrag.original.fadeOutSeconds });
      } else {
        const newFadeOut = Math.max(
          0,
          Math.min(fadeDrag.displayDuration, fadeDrag.original.fadeOutSeconds - deltaSeconds),
        );
        setFadePreview({ fadeInSeconds: fadeDrag.original.fadeInSeconds, fadeOutSeconds: newFadeOut });
      }
      return;
    }

    const trimDrag = trimDragRef.current;
    if (!trimDrag) return;
    const rate = playbackRateFor(trimDrag.original, projectTempoBpm);
    const deltaSourceSeconds =
      ((e.clientX - trimDrag.startClientX) / effectivePixelsPerSecond) * rate;

    if (trimDrag.edge === "left") {
      const maxDelta = trimDrag.original.sourceDurationSeconds - MIN_SOURCE_DURATION_SECONDS;
      const minDelta = -trimDrag.original.sourceOffsetSeconds;
      const clampedDelta = Math.max(minDelta, Math.min(maxDelta, deltaSourceSeconds));
      setTrimPreview({
        startSeconds: trimDrag.original.startSeconds + clampedDelta / rate,
        sourceOffsetSeconds: trimDrag.original.sourceOffsetSeconds + clampedDelta,
        sourceDurationSeconds: trimDrag.original.sourceDurationSeconds - clampedDelta,
        repeats: trimDrag.original.repeats,
      });
    } else {
      // El borde derecho hace DOS cosas, en este orden:
      //
      //   1. Mientras quede audio sin usar, lo DESTAPA (recorte de
      //      siempre).
      //   2. Cuando ya no queda, empieza a REPETIR la ventana.
      //
      // El orden importa y no es arbitrario: para un sample recién
      // soltado del Banco la ventana YA es el archivo entero, así que
      // el primer píxel de arrastre hacia la derecha ya repite, que es
      // el caso común. Y para un clip recortado, tirar de la derecha
      // primero devuelve lo que se había recortado, que es lo que
      // cualquiera espera antes de pensar en repetir.
      //
      // ⚠️ Consecuencia a tener presente: NO se puede repetir una
      // ventana recortada. Estirar hacia la derecha la destapa antes de
      // repetir, así que lo que se repite es siempre el audio completo
      // desde el offset. Repetir un recorte necesitaría un gesto
      // aparte, y no vale la pena inventarle un modificador a esto.
      const maxAvailable = trimDrag.original.buffer.duration - trimDrag.original.sourceOffsetSeconds;
      const originalWindowDisplay = trimDrag.original.sourceDurationSeconds / rate;
      const desiredDisplay = Math.max(
        MIN_SOURCE_DURATION_SECONDS / rate,
        originalWindowDisplay * trimDrag.original.repeats + deltaSourceSeconds / rate,
      );
      const maxWindowDisplay = maxAvailable / rate;

      let newDuration: number;
      let newRepeats: number;
      if (desiredDisplay <= maxWindowDisplay) {
        newDuration = Math.max(MIN_SOURCE_DURATION_SECONDS, desiredDisplay * rate);
        newRepeats = 1;
      } else {
        newDuration = maxAvailable;
        newRepeats = desiredDisplay / maxWindowDisplay;
        // Imán a repeticiones ENTERAS, salvo con Alt. Un loop repetido
        // 2,97 veces corta la última justo antes de su golpe final y
        // suena a error; acertar el entero a pulso, con el zoom
        // alejado, es imposible.
        if (!e.altKey) {
          const whole = Math.round(newRepeats);
          const wholePx = Math.abs(whole - newRepeats) * maxWindowDisplay * effectivePixelsPerSecond;
          if (whole >= 1 && wholePx <= SNAP_THRESHOLD_PX) newRepeats = whole;
        }
        newRepeats = Math.max(1, newRepeats);
      }

      setTrimPreview({
        startSeconds: trimDrag.original.startSeconds,
        sourceOffsetSeconds: trimDrag.original.sourceOffsetSeconds,
        sourceDurationSeconds: newDuration,
        repeats: newRepeats,
      });
    }
  }

  function handleLanePointerUp() {
    // "mover clip" (dragRef) NO se resuelve acá — lo cierra el
    // listener de window agregado en handleClipPointerDown, para no
    // finalizarlo dos veces (el pointerup también bubblea hasta acá).
    if (trimDragRef.current) handleTrimPointerUp();
    if (fadeDragRef.current) handleFadePointerUp();
  }

  // ─── Export / Sincronizar ────────────────────────────────────────────

  async function handleExport() {
    if (!user) return;
    setIsExporting(true);
    setExportProgress(0);
    setExportError(null);
    setExportSuccessTitle(null);

    try {
      // 1. Renderizar cada COMBINACIÓN ÚNICA de (sample, ventana de
      // recorte, tempo) una sola vez a WAV mono/PCM16/44.1kHz — dos
      // clips que usan el mismo sample entero al mismo tempo comparten
      // archivo (igual criterio que splitClip del lado Flutter,
      // reusando filePath), pero un clip CORTADO/recortado necesita su
      // propio WAV: el formato .mystudio no tiene forma de guardar una
      // ventana de recorte no destructiva (ver la nota en
      // project_backup_service.dart — CLAUDE.md ya documenta que el
      // export es siempre el archivo completo), así que acá el corte
      // se resuelve renderizando solo esa porción.
      //
      // ⚠️ Y una UNIDAD de exportación no es siempre un clip. Si dos
      // clips de una pista se SOLAPAN (o sea, hay un crossfade entre
      // ellos), viajan aplanados en un solo WAV con el cruce ya
      // horneado. El motivo está en native_engine.cpp: la mezcla de una
      // pista toma el PRIMER clip que cubre cada frame y corta, porque
      // el motor da por sentado que los clips de una pista no se
      // superponen. Mandar el solape tal cual no sonaría cruzado en el
      // teléfono, sonaría con un AGUJERO — el que gana en esa zona es
      // justo el que se está yendo a silencio. Ver overlapChains.
      const describe = (clip: ArrangerClip, rate: number, fades: ResolvedFades) =>
        `${clip.sampleId}::${clip.sourceOffsetSeconds.toFixed(4)}::` +
        `${clip.sourceDurationSeconds.toFixed(4)}::${rate.toFixed(4)}::` +
        `${clip.gain.toFixed(4)}::${fades.fadeInSeconds.toFixed(4)}::${fades.fadeOutSeconds.toFixed(4)}::` +
        `${fades.fadeInShape}::${fades.fadeOutShape}::${clip.pitchShift}::${clip.repeats.toFixed(4)}`;

      /** Un archivo del .mystudio: un clip suelto, o una cadena solapada aplanada. */
      interface ExportUnit {
        key: string;
        startSeconds: number;
        pitchShift: number;
        clips: { clip: ArrangerClip; rate: number; fades: ResolvedFades }[];
        totalDurationSeconds: number;
      }

      const unitsByTrack: ExportUnit[][] = tracks.map((track) => {
        const withGeometry = track.clips.map((clip) => ({
          id: clip.id,
          startSeconds: clip.startSeconds,
          displayDuration: displayDurationFor(clip, projectTempoBpm),
          fadeInSeconds: clip.fadeInSeconds,
          fadeOutSeconds: clip.fadeOutSeconds,
          clip,
        }));
        return overlapChains(withGeometry).map((chain) => {
          const parts = chain.map((entry) => ({
            clip: entry.clip,
            rate: playbackRateFor(entry.clip, projectTempoBpm),
            fades: fadesFor(entry.clip),
          }));
          const startSeconds = Math.min(...chain.map((c) => c.startSeconds));
          const endSeconds = Math.max(...chain.map((c) => c.startSeconds + c.displayDuration));
          return {
            // La posición RELATIVA de cada clip dentro de la cadena
            // entra en la clave: dos cadenas con los mismos clips pero
            // distinto solape son audios distintos.
            key: parts
              .map(
                (p, i) =>
                  `${describe(p.clip, p.rate, p.fades)}@${(chain[i].startSeconds - startSeconds).toFixed(4)}`,
              )
              .join("|"),
            startSeconds,
            pitchShift: parts[0].clip.pitchShift,
            clips: parts,
            totalDurationSeconds: endSeconds - startSeconds,
          };
        });
      });

      const uniqueUnits = new Map<string, ExportUnit>();
      for (const units of unitsByTrack) {
        for (const unit of units) if (!uniqueUnits.has(unit.key)) uniqueUnits.set(unit.key, unit);
      }

      const renderedByKey = new Map<
        string,
        { fileName: string; durationSamples: number; sampleRate: number; bytes: Uint8Array }
      >();
      const uniqueEntries = [...uniqueUnits.entries()];
      for (let i = 0; i < uniqueEntries.length; i++) {
        const [key, unit] = uniqueEntries[i];
        // Mismo buffer YA procesado (tempo + pitch) que usa la
        // reproducción en vivo — el offset/duración de recorte están
        // definidos contra el buffer ORIGINAL, así que se convierten a
        // la base de tiempo del buffer estirado dividiendo por `rate`
        // (idéntico criterio que playFrom, ver más arriba; el pitch no
        // cambia la duración, así que no afecta esta cuenta). En
        // general ya está en caché (ver el useEffect de pre-calentado),
        // así que este await resuelve casi siempre de inmediato.
        const buffers = await Promise.all(
          unit.clips.map(({ clip, rate }) => getProcessedBuffer(clip, rate)),
        );
        let rendered;
        if (unit.clips.length === 1) {
          const { clip, rate, fades } = unit.clips[0];
          rendered = await renderClipToWav(
            buffers[0],
            clip.sourceOffsetSeconds / rate,
            clip.sourceDurationSeconds / rate,
            clip.gain,
            fades.fadeInSeconds,
            fades.fadeOutSeconds,
            fades.fadeInShape,
            fades.fadeOutShape,
            clip.repeats,
          );
        } else {
          const parts: ChainPart[] = unit.clips.map(({ clip, rate, fades }, index) => ({
            buffer: buffers[index],
            sourceOffsetSeconds: clip.sourceOffsetSeconds / rate,
            sourceDurationSeconds: clip.sourceDurationSeconds / rate,
            repeats: clip.repeats,
            startOffsetSeconds: clip.startSeconds - unit.startSeconds,
            gain: clip.gain,
            fadeInSeconds: fades.fadeInSeconds,
            fadeOutSeconds: fades.fadeOutSeconds,
            fadeInShape: fades.fadeInShape,
            fadeOutShape: fades.fadeOutShape,
          }));
          rendered = await renderClipChainToWav(parts, unit.totalDurationSeconds);
        }
        renderedByKey.set(key, { fileName: `audio_${i}.wav`, ...rendered });
        setExportProgress(((i + 1) / Math.max(1, uniqueEntries.length)) * 0.55);
      }

      // 2. Armar el ZIP — REGLA CRÍTICA: startBeat va en SEGUNDOS, tal
      // cual, para que project_backup_service.dart del lado Flutter lo
      // lea sin ninguna conversión (ver CLAUDE.md: ese campo se
      // reutiliza como offset en segundos hace tiempo, pese al nombre).
      const zip = new JSZip();
      for (const rendered of renderedByKey.values()) {
        zip.file(rendered.fileName, rendered.bytes);
      }

      const manifest = {
        // 2 desde que el manifest lleva efectos (ver
        // project_backup_service.dart). El Arranger no los edita, pero
        // los devuelve intactos, así que exporta la misma versión.
        formatVersion: 2,
        project: {
          title: projectTitle.trim() || "Arreglo sin título",
          tempoBpm: projectTempoBpm,
          masterFx: importedMasterFx,
          // Campos NUEVOS (Paso 1) — project_backup_service.dart del
          // lado Flutter todavía no los lee (solo toma title/tempoBpm
          // de este objeto), así que agregarlos acá es 100%
          // retrocompatible: viajan igual dentro del .mystudio, listos
          // para cuando el motor nativo los soporte.
          timeSignatureNumerator,
          timeSignatureDenominator,
        },
        tracks: tracks.map((track, trackIndex) => ({
          name: track.name,
          volume: track.volume,
          pan: track.pan,
          isMuted: track.isMuted,
          isSolo: track.isSolo,
          fx: track.fx,
          // Una entrada por UNIDAD, no por clip: una cadena solapada ya
          // viajó aplanada en un solo WAV (ver más arriba).
          clips: unitsByTrack[trackIndex].map((unit) => {
            const rendered = renderedByKey.get(unit.key)!;
            return {
              audioFileName: rendered.fileName,
              // REGLA CRÍTICA (Paso 4): `startBeat` es, para
              // project_backup_service.dart, un offset de tiempo en
              // SEGUNDOS (pese al nombre — ver CLAUDE.md). Sin
              // importar en qué modo esté la regla de tiempo en
              // pantalla (Segundos o Compases), `clip.startSeconds`
              // SIEMPRE fue y sigue siendo segundos puros — el modo
              // "Compases" es solo una vista/formato de la regla, la
              // posición real de cada clip nunca se guardó en
              // compases. Nada que convertir acá.
              startBeat: unit.startSeconds,
              durationSamples: rendered.durationSamples,
              sampleRate: rendered.sampleRate,
              // Paso 3 (pitch-shifting) — el audio EN SÍ ya viaja
              // pitcheado (el WAV renderizado usa el buffer procesado
              // por getProcessedBuffer), así que esto es puramente
              // informativo para una futura lectura (Flutter no lo lee
              // todavía, mismo criterio que timeSignatureNumerator/
              // Denominator a nivel de proyecto).
              pitchShift: unit.pitchShift,
            };
          }),
        })),
      };
      zip.file("manifest.json", JSON.stringify(manifest));

      const zipBytes = await zip.generateAsync({ type: "uint8array" }, (metadata) => {
        setExportProgress(0.55 + (metadata.percent / 100) * 0.15);
      });

      // 3. Checksum (Web Crypto — mismo sha256 que ya calcula
      // CloudSyncService del lado Flutter con package:crypto).
      // new Uint8Array(...) de por medio: JSZip tipa su salida contra
      // un ArrayBufferLike genérico (podría ser un SharedArrayBuffer),
      // que el tipo BufferSource de crypto.subtle.digest no acepta —
      // copiar a un Uint8Array respaldado por un ArrayBuffer normal
      // conforma ese tipo sin cambiar los bytes en sí.
      const digestBuffer = await crypto.subtle.digest("SHA-256", new Uint8Array(zipBytes));
      const checksum = Array.from(new Uint8Array(digestBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // 4. Subir a Storage — mismo layout de ruta que
      // CloudSyncService.uploadProject: users/{uid}/projects/{cloudId}.mystudio.
      // .doc() sin argumento genera el id LOCALMENTE (sin red), mismo
      // truco que reserveCloudId del lado Flutter.
      // Si ya estamos editando un proyecto de la nube, se ACTUALIZA ese
      // mismo documento. Antes se generaba un id nuevo siempre, así que
      // abrir un proyecto, editarlo y guardar creaba otro proyecto y
      // dejaba el original intacto.
      const cloudId =
        cloudProjectId ?? doc(collection(db, "users", user.uid, "projects")).id;

      // ¿Cambió en la app (o en otra pestaña) desde que lo abrimos? Una
      // sola lectura de un documento chico, y es lo que separa
      // "sincronizar" de "pisar". El espejo exacto de esto vive en
      // CloudSyncService.uploadProject del lado Flutter.
      const remoteSnap = await getDoc(doc(db, "users", user.uid, "projects", cloudId));
      const remoteVersion = remoteSnap.exists()
        ? ((remoteSnap.data().cloudVersion as number | undefined) ?? 0)
        : 0;
      if (
        remoteSnap.exists() &&
        (cloudBaseVersion === null || remoteVersion > cloudBaseVersion)
      ) {
        const proceed = window.confirm(
          `«${manifest.project.title}» se editó desde la app (o en otro dispositivo) ` +
            `después de que lo abriste acá.\n\n` +
            `Si guardás ahora, esos cambios se pierden. ` +
            `Para conservarlos, cancelá y volvé a abrir el proyecto desde Mis Proyectos.`,
        );
        if (!proceed) {
          setIsExporting(false);
          setExportProgress(0);
          return;
        }
      }
      const storagePath = `users/${user.uid}/projects/${cloudId}.mystudio`;
      const uploadTask = uploadBytesResumable(ref(storage, storagePath), zipBytes, {
        contentType: "application/zip",
      });
      await new Promise<void>((resolve, reject) => {
        uploadTask.on(
          "state_changed",
          (snapshot) =>
            setExportProgress(
              0.7 + (snapshot.bytesTransferred / snapshot.totalBytes) * 0.3,
            ),
          reject,
          resolve,
        );
      });

      // 5. Metadata en Firestore — MISMOS campos que escribe
      // CloudSyncService, para que ProjectsScreen lo detecte como
      // cualquier otro proyecto sincronizado.
      await setDoc(
        doc(db, "users", user.uid, "projects", cloudId),
        {
          title: manifest.project.title,
          tempoBpm: projectTempoBpm,
          updatedAt: serverTimestamp(),
          // Número EXPLÍCITO, igual que en la app: con increment(1) el
          // cliente no sabe en qué versión quedó, y sin saberlo no puede
          // detectar el próximo cambio ajeno.
          cloudVersion: remoteVersion + 1,
          // Campo exclusivo de la web. La app parsea el documento campo
          // por campo (CloudProjectMetadata.fromFirestore) e ignora lo
          // que no conoce, así que agregarlo acá no la afecta — y
          // guardarlo en el documento y no en el manifiesto del
          // .mystudio es lo que evita tocar el formato que lee Flutter.
          projectKey,
          storagePath,
          sizeBytes: zipBytes.length,
          checksum,
        },
        { merge: true },
      );

      setCloudProjectId(cloudId);
      setCloudBaseVersion(remoteVersion + 1);
      // El borrador NO se borra al guardar: sigue siendo lo que permite
      // irse del Arranger y volver sin tener que bajar el proyecto de
      // nuevo. Lo que cambia es que deja de estar "sin guardar".
      //
      // ⚠️ Anotar la FIRMA de lo que se acaba de subir no es opcional, y
      // olvidarlo fue un bug real: el `setIsDirty(false)` de acá abajo
      // duraba 700 ms. El guardado continuo vuelve a correr enseguida,
      // compara la firma actual contra esta referencia —que seguía en
      // null— y marca el arreglo como sucio otra vez. O sea que el
      // cartel decía "Sin sincronizar" para SIEMPRE, incluso recién
      // sincronizado, que es justo el momento en que más importa que
      // diga la verdad.
      cloudSavedSignatureRef.current = arrangementSignature(currentDraft());
      setIsDirty(false);
      setExportSuccessTitle(manifest.project.title);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsExporting(false);
    }
  }

  // ─── Importar / edición bidireccional ─────────────────────────────────

  /**
   * Lee el body de una descarga informando el avance real (bytes
   * recibidos / Content-Length) — antes se esperaba `response.arrayBuffer()`
   * a ciegas, sin ningún indicio de progreso mientras bajaba un .mystudio
   * grande. Si el navegador no expone streaming acá o no hay
   * Content-Length, cae a leerlo entero de una (mismo resultado, solo
   * sin progreso granular).
   */
  async function readResponseWithProgress(
    response: Response,
    onProgress: (fraction: number) => void,
  ): Promise<ArrayBuffer> {
    const total = Number(response.headers.get("content-length")) || 0;
    if (!response.body || !total) return response.arrayBuffer();

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress(Math.min(1, received / total));
    }
    const result = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result.buffer;
  }

  // Paso 2-3: descomprime, parsea el manifest, decodifica cada WAV
  // único UNA vez (varios clips pueden compartir el mismo audioFileName
  // si el .mystudio vino de una exportación web con samples repetidos)
  // y los hidrata en la caché global (sampleBufferCache) antes de
  // reconstruir el estado de React. No maneja su propio try/catch — el
  // llamador (el picker local o el deep-link del Dashboard) es quien
  // sabe cómo se consiguieron los bytes del ZIP y reporta el error.
  async function importProjectFromZipBytes(zipBytes: ArrayBuffer) {
    setImportStage("Extrayendo proyecto...");
    setImportProgress(0.3);
    const zip = await JSZip.loadAsync(zipBytes);
    const manifestFile = zip.file("manifest.json");
    if (!manifestFile) {
      throw new Error("El archivo no tiene manifest.json — .mystudio inválido.");
    }
    const manifest = JSON.parse(await manifestFile.async("string")) as ImportManifest;

    const ctx = audioContextRef.current;
    if (!ctx) throw new Error("El motor de audio todavía no está listo.");

    setImportProgress(0.35);
    const uniqueFileNames = [
      ...new Set(manifest.tracks.flatMap((track) => track.clips.map((clip) => clip.audioFileName))),
    ];
    const bufferByFileName = new Map<string, AudioBuffer>();
    for (let i = 0; i < uniqueFileNames.length; i++) {
      const fileName = uniqueFileNames[i];
      setImportStage(`Decodificando audio... (${i + 1}/${uniqueFileNames.length})`);
      const audioFile = zip.file(fileName);
      if (audioFile) {
        const arrayBuffer = await audioFile.async("arraybuffer");
        const buffer = await ctx.decodeAudioData(arrayBuffer);
        bufferByFileName.set(fileName, buffer);
        // Paso 3 — hidrata la caché GLOBAL (sampleBufferCache): cualquier
        // reuso posterior de este mismo audio en la sesión (otra pista,
        // otro drag) sale gratis, sin volver a decodificar.
        setCachedBuffer(`imported:${fileName}`, buffer);
      } // si no hay match: clip huérfano — mismo criterio que Flutter/ProjectViewer, se omite en silencio
      setImportProgress(0.35 + ((i + 1) / uniqueFileNames.length) * 0.35);
    }

    // Construye el clip SIN los picos reales todavía (peaks vacío = "en
    // blanco/shimmer" en el render, ver ClipWaveform) — calcularlos acá
    // mismo, de una, para un proyecto con muchos clips es exactamente lo
    // que hacía "esperar a que todo termine" antes de ver nada. Los
    // picos de verdad llegan en la Fase 2, después de revelar las pistas.
    function buildImportedClip(clip: ImportManifestClip, buffer: AudioBuffer): ArrangerClip {
      return {
        id: newId(),
        sampleId: `imported:${clip.audioFileName}`,
        sampleName: clip.audioFileName.replace(/\.wav$/i, ""),
        // Igual que el audio subido a mano: salió de un ZIP que se
        // decodificó en memoria, no de Storage.
        audioPath: "",
        // El manifest no guarda de qué sample del Banco salió este
        // WAV (ni tiene BPM de origen) — sin esa referencia no hay
        // rate sensato que calcular, así que se trata como audio
        // "congelado": originalBpm=0 hace que playbackRateFor
        // devuelva 1.0 siempre (nunca se time-stretchea), igual
        // criterio que ya existe para los One-Shot.
        originalBpm: 0,
        // El manifiesto tampoco guarda la tonalidad. Queda vacía y
        // editable, igual que el BPM de origen.
        sampleKey: "",
        sampleType: "Imported",
        // REGLA CRÍTICA: `startBeat` es SIEMPRE un offset en
        // SEGUNDOS absolutos (pese al nombre — ver CLAUDE.md), acá
        // se mapea TAL CUAL a startSeconds, sin ninguna conversión.
        // Esto es correcto sin importar si la regla de tiempo está
        // en modo Segundos o Compases — ese modo es solo la VISTA;
        // la posición real de un clip siempre fue y sigue siendo
        // segundos puros (mismo motivo por el que handleExport
        // tampoco convierte nada al exportar).
        startSeconds: clip.startBeat,
        sourceOffsetSeconds: 0,
        sourceDurationSeconds: buffer.duration,
        repeats: 1,
        gain: 1,
        fadeInSeconds: 0,
        fadeOutSeconds: 0,
        pitchShift: clip.pitchShift ?? 0,
        buffer,
        peaks: new Float32Array(0),
      };
    }

    stopAllSources();
    setIsPlaying(false);
    setPlayheadSeconds(0);
    setSelectedClipIds([]);
    setClipboard(null);
    // El tramo de loop es del arreglo que estaba abierto: los compases
    // 9 a 17 de otra canción no significan nada acá.
    loopRef.current = { enabled: false, region: null };
    setLoopEnabled(false);
    setLoopRegion(null);
    setPendingDrops([]);
    // Un arreglo NUEVO entero: el historial arranca de cero acá.
    // Deshacer más atrás devolvería al proyecto anterior, que ya no
    // está abierto.
    loadArrangement({
      projectTitle: manifest.project.title || "Proyecto importado",
      projectTempoBpm: manifest.project.tempoBpm > 0 ? manifest.project.tempoBpm : 120,
      timeSignatureNumerator: manifest.project.timeSignatureNumerator ?? 4,
      timeSignatureDenominator: manifest.project.timeSignatureDenominator ?? 4,
      masterFx: manifest.project.masterFx
        ? parseMasterFx(manifest.project.masterFx)
        : DEFAULT_MASTER_FX,
      tracks: [],
    });

    // Fase 1: una pista por vez, con una pausa de un tick entre cada
    // una — así se REVELAN gradualmente en la grilla en vez de aparecer
    // todas de golpe al final. Cada pista ya es 100% reproducible (el
    // audio real ya está decodificado), solo falta dibujar su forma de
    // onda real.
    const allNewClipIds: string[] = [];
    for (let ti = 0; ti < manifest.tracks.length; ti++) {
      const track = manifest.tracks[ti];
      const clips = track.clips
        .filter((clip) => bufferByFileName.has(clip.audioFileName))
        .map((clip) => buildImportedClip(clip, bufferByFileName.get(clip.audioFileName)!));
      clips.forEach((c) => allNewClipIds.push(c.id));

      const newTrack: ArrangerTrack = {
        id: newId(),
        name: track.name,
        volume: track.volume,
        pan: track.pan,
        isMuted: track.isMuted,
        isSolo: track.isSolo,
        color: TRACK_COLORS[ti % TRACK_COLORS.length],
        clips,
        // Se conservan tal cual vinieron: el Arranger no los edita ni
        // los reproduce, solo evita que un round-trip los borre.
        fx: parseTrackFx(track.fx),
      };
      // SILENT: las pistas se revelan de a una para que se vean
      // aparecer, pero eso es UNA importación, no N acciones del
      // usuario — si no, deshacer caminaría hacia atrás pista por pista.
      setTracks((prev) => [...prev, newTrack], SILENT);
      setImportStage(`Agregando pistas... (${ti + 1}/${manifest.tracks.length})`);
      setImportProgress(0.7 + ((ti + 1) / Math.max(1, manifest.tracks.length)) * 0.3);
      // Cede el hilo un tick entre pista y pista para que React
      // realmente pinte cada una antes de seguir con la siguiente —
      // sin esto, aunque el estado se actualice "de a uno", el
      // navegador podría no llegar a mostrar ningún frame intermedio.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    // Fase 2 (segundo plano, ya con el proyecto usable): calcula los
    // picos reales UN CLIP POR VEZ, en su propio tick — mismo patrón
    // que ProjectViewer.tsx. No bloquea nada ni retrasa que isImporting
    // pase a false; el usuario ya puede tocar Play mientras esto termina.
    for (const clipId of allNewClipIds) {
      setTimeout(() => {
        // SILENT: dibujar la forma de onda no es una edición. Es lo
        // mismo que el usuario ya tenía, solo que ahora se ve.
        setTracks((prev) => {
          for (const t of prev) {
            const clip = t.clips.find((c) => c.id === clipId);
            if (clip && clip.peaks.length === 0) {
              const peaks = computePeaks(clip.buffer, PEAK_BUCKETS);
              return prev.map((tt) =>
                tt.id !== t.id
                  ? tt
                  : { ...tt, clips: tt.clips.map((c) => (c.id === clipId ? { ...c, peaks } : c)) },
              );
            }
          }
          return prev;
        }, SILENT);
      }, 0);
    }
  }

  /** Paso 1 — abrir un .mystudio elegido con el selector de archivos local. */
  async function handleOpenLocalFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite volver a elegir el MISMO archivo y que dispare onChange de nuevo
    if (!file) return;
    if (tracks.length > 0 && !window.confirm("Esto reemplaza el arreglo actual (sin guardar). ¿Continuar?")) {
      return;
    }
    setImportError(null);
    setIsImporting(true);
    setImportProgress(0);
    try {
      const bytes = await file.arrayBuffer();
      await importProjectFromZipBytes(bytes);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsImporting(false);
      setImportStage(null);
    }
  }

  // Efecto único de montaje: dos orígenes posibles, SIEMPRE en este
  // orden (uno solo de los dos primeros pasos corre, según cómo se
  // llegó, pero el Paso 2 corre SIEMPRE después de que el Paso 1
  // termine, nunca en paralelo) —
  //   Paso 1: llegar desde el Dashboard con ?open=<cloudId> —
  //     ProjectsDashboard linkea acá, se busca el storagePath en el
  //     MISMO doc de Firestore que ya lee ProjectsDashboard/
  //     ProjectViewer y se descarga vía /api/download-proxy (evita
  //     CORS en la lectura de bytes — ver la nota extensa en
  //     ProjectViewer.tsx).
  //   Paso 2: samples elegidos en /samples con "Enviar al Arranger"
  //     (ver pendingArrangerSamples.ts) — cada uno a SU PROPIA pista
  //     nueva. Tenía que ir DESPUÉS del Paso 1 a propósito: si
  //     corrieran en paralelo (dos useEffect separados), y ?open=
  //     también estuviera presente, el setTracks([]) que hace
  //     importProjectFromZipBytes al arrancar se comería estas pistas
  //     si ya se habían agregado antes.
  useEffect(() => {
    if (!user) return;

    (async () => {
      const openId = new URLSearchParams(window.location.search).get("open");
      // Si volvimos del menú con el arreglo todavía en memoria, bajarlo
      // otra vez sería descartar lo que el usuario venía editando. Se
      // saltea SOLO la descarga, no el resto del efecto: los samples
      // encolados desde /samples siguen teniendo que entrar (y
      // takeQueuedSamplesForArranger vacía la cola, así que si no se
      // llama quedan colgados hasta la próxima visita).
      const alreadyOpen = !!openId && liveDraftRef.current?.cloudProjectId === openId;
      if (openId && !alreadyOpen) {
        setImportError(null);
        setIsImporting(true);
        setImportProgress(0);
        setImportStage("Descargando proyecto...");
        try {
          const snap = await getDoc(doc(db, "users", user.uid, "projects", openId));
          if (!snap.exists()) throw new Error("No se encontró el proyecto.");
          const storagePath = snap.data().storagePath as string | undefined;
          const openedVersion = (snap.data().cloudVersion as number | undefined) ?? null;
          const openedKey = (snap.data().projectKey as string | undefined) ?? "";
          if (!storagePath) throw new Error("El proyecto no tiene un archivo asociado.");
          const downloadUrl = await getDownloadURL(ref(storage, storagePath));
          const response = await fetch(`/api/download-proxy?url=${encodeURIComponent(downloadUrl)}`);
          if (!response.ok) throw new Error(`No se pudo descargar el archivo (HTTP ${response.status}).`);
          const bytes = await readResponseWithProgress(response, (f) => setImportProgress(f * 0.3));
          await importProjectFromZipBytes(bytes);
          // A partir de acá, guardar ACTUALIZA este proyecto en vez de
          // crear uno nuevo al lado, y sabemos de qué versión partimos.
          setCloudProjectId(openId);
          setCloudBaseVersion(openedVersion);
          pendingOpenedSnapshotRef.current = true;
          // SILENT: la tonalidad venía guardada en el documento, no la
          // acaba de elegir nadie. Con un commit normal, abrir un
          // proyecto dejaba un "Deshacer: Cambiar la tonalidad" que no
          // correspondía a ninguna acción del usuario — y deshacerlo
          // borraba la tonalidad del proyecto que se acababa de abrir.
          setProjectKey(openedKey, SILENT);
        } catch (err) {
          setImportError(err instanceof Error ? err.message : String(err));
        } finally {
          setIsImporting(false);
          setImportStage(null);
        }
      }

      const queued = takeQueuedSamplesForArranger();
      if (queued && queued.length > 0) {
        queued.forEach((sample) => {
          const trackId = newId();
          setTracks((prev) => [
            ...prev,
            {
              id: trackId,
              name: sample.name || "Nueva pista",
              volume: 0.8,
              pan: 0,
              isMuted: false,
              isSolo: false,
              clips: [],
              color: TRACK_COLORS[prev.length % TRACK_COLORS.length],
              fx: NO_TRACK_FX,
            },
          ]);
          void addSampleToTrack(sample, trackId, 0);
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ─── Borrador: que irse del Arranger no borre el trabajo ─────────────
  //
  // El Arranger no guardaba NADA hasta que se apretaba "Exportar y
  // Sincronizar": todo el arreglo vivía en useState, y cambiar de
  // sección en el menú lo desmontaba. Ver arrangerDraft.ts para por qué
  // el borrador tiene dos capas y qué puede recuperar cada una.

  /// Lo último que se guardó en la NUBE, como firma de contenido. Es
  /// contra esto que se decide si hay cambios sin guardar — no contra
  /// "¿pasó algo?", que daría siempre que sí apenas se restaura.
  const cloudSavedSignatureRef = useRef<string | null>(null);
  /**
   * Se acaba de ABRIR un proyecto desde la nube y todavía no se anotó
   * cómo quedó. Hace falta un paso diferido porque al terminar la
   * descarga el estado nuevo todavía no se aplicó (la importación revela
   * las pistas de a una): la firma se toma en la primera pasada del
   * guardado continuo después de que todo se asentó.
   *
   * ⚠️ Sin esto, abrir un proyecto recién bajado mostraba "Sin
   * sincronizar" sin haber tocado nada — el mismo cartel mentiroso que
   * se arregló al guardar, pero del lado de abrir.
   */
  const pendingOpenedSnapshotRef = useRef(false);

  function currentDraft(): ArrangerDraft {
    return {
      projectTitle,
      projectTempoBpm,
      timeSignatureNumerator,
      timeSignatureDenominator,
      tracks,
      masterFx: importedMasterFx,
      projectKey,
      cloudProjectId,
      cloudBaseVersion,
      isDirty,
      savedAt: Date.now(),
    };
  }

  // 1. Volver del menú: la instantánea viva todavía tiene el arreglo
  //    ENTERO, con sus AudioBuffer. Se restaura sola y al instante — no
  //    se le pregunta nada al usuario porque, desde donde él lo ve,
  //    nunca se fue a ningún lado.
  useEffect(() => {
    const live = liveDraftRef.current;
    if (!live || showNewProjectSetup) return;
    queueMicrotask(() => {
      loadArrangement({
        projectTitle: live.projectTitle,
        projectTempoBpm: live.projectTempoBpm,
        projectKey: live.projectKey ?? "",
        timeSignatureNumerator: live.timeSignatureNumerator,
        timeSignatureDenominator: live.timeSignatureDenominator,
        masterFx: live.masterFx,
        tracks: live.tracks,
      });
      setCloudProjectId(live.cloudProjectId);
      setCloudBaseVersion(live.cloudBaseVersion);
      setIsDirty(live.isDirty);
      if (!live.isDirty) {
        cloudSavedSignatureRef.current = arrangementSignature(live);
      }
    });
    // Solo al montar: es una restauración, no una sincronización continua.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Sesión anterior (recargaste o cerraste el navegador): la
  //    instantánea viva murió, pero queda la copia de localStorage. Esa
  //    NO se aplica sola — restaurarla puede tardar (hay que volver a
  //    bajar el audio) y puede perder clips, así que se ofrece.
  useEffect(() => {
    if (!user || liveDraftRef.current || showNewProjectSetup) return;
    const stored = readStoredArrangerDraft(user.uid);
    if (!stored) return;
    queueMicrotask(() => setRecoverableDraft(stored));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // 3. Guardado continuo, con debounce. La capa viva es una asignación;
  //    la de localStorage serializa el arreglo, así que no conviene
  //    hacerlo en cada pixel de un arrastre.
  useEffect(() => {
    if (!user || showNewProjectSetup || isImporting) return;
    // Un arreglo vacío no se guarda: si se guardara, el primer render
    // (antes de restaurar) pisaría el borrador bueno con la nada.
    if (tracks.length === 0) return;

    const handle = setTimeout(() => {
      const draft = currentDraft();
      if (pendingOpenedSnapshotRef.current) {
        // Lo que se acaba de bajar ES lo que está en la nube.
        cloudSavedSignatureRef.current = arrangementSignature(draft);
        pendingOpenedSnapshotRef.current = false;
      }
      const dirty = arrangementSignature(draft) !== cloudSavedSignatureRef.current;
      rememberArrangerDraft(user.uid, { ...draft, isDirty: dirty });
      setIsDirty(dirty);
    }, 700);
    return () => clearTimeout(handle);
    // currentDraft se rearma en cada render; las dependencias reales son
    // sus partes, que sí están listadas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    user,
    showNewProjectSetup,
    isImporting,
    tracks,
    projectTitle,
    projectTempoBpm,
    timeSignatureNumerator,
    timeSignatureDenominator,
    importedMasterFx,
    cloudProjectId,
    cloudBaseVersion,
    projectKey,
  ]);

  // 4. Aviso antes de CERRAR o RECARGAR la pestaña, que es lo único que
  //    todavía puede perder trabajo: ahí muere la instantánea viva y,
  //    con ella, el audio que no vino del Banco de Sonidos (subido a
  //    mano o abierto desde un .mystudio). Navegar por el menú ya no
  //    avisa nada, y no es un olvido: no se pierde nada, así que un
  //    cartel de confirmación sería puro ruido.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  /// Rehidrata un borrador de localStorage: vuelve a conseguir el audio
  /// de cada clip y recalcula sus picos.
  ///
  /// El orden importa. Primero se mira la caché global —que sobrevive a
  /// la navegación dentro de la pestaña—, y recién si no está se baja de
  /// Storage. Un clip sin `audioPath` (subido desde la computadora, o
  /// venido de un .mystudio) no tiene de dónde bajarse: se cuenta como
  /// perdido y se avisa, en vez de dejar un bloque mudo en la grilla.
  async function restoreStoredDraft(stored: StoredArrangerDraft) {
    setIsRestoringDraft(true);
    setDraftNotice(null);
    let lostClips = 0;

    const restored: ArrangerTrack[] = [];
    for (const track of stored.tracks) {
      const clips: ArrangerClip[] = [];
      for (const clip of track.clips) {
        let buffer = getCachedBuffer(clip.sampleId);
        if (!buffer && clip.audioPath) {
          try {
            buffer = await loadAndCacheBuffer(clip.sampleId, clip.audioPath);
          } catch {
            buffer = undefined;
          }
        }
        if (!buffer) {
          lostClips++;
          continue;
        }
        // `repeats` no existía en los borradores anteriores a esta
        // función: sin el ?? 1, displayDurationFor daría NaN y el clip
        // desaparecería de la pantalla.
        clips.push({
          ...clip,
          repeats: clip.repeats || 1,
          buffer,
          peaks: computePeaks(buffer, PEAK_BUCKETS),
        });
      }
      restored.push({ ...track, clips });
    }

    loadArrangement({
      projectTitle: stored.projectTitle,
      projectTempoBpm: stored.projectTempoBpm,
      // ?? "" porque puede venir de un borrador anterior a este campo.
      projectKey: stored.projectKey ?? "",
      timeSignatureNumerator: stored.timeSignatureNumerator,
      timeSignatureDenominator: stored.timeSignatureDenominator,
      masterFx: stored.masterFx,
      tracks: restored,
    });
    setCloudProjectId(stored.cloudProjectId);
    // Puede venir de un borrador anterior a este campo: null significa
    // "no sé qué versión es", y guardar va a preguntar antes de pisar.
    setCloudBaseVersion(stored.cloudBaseVersion ?? null);
    setIsDirty(true);
    setRecoverableDraft(null);
    setIsRestoringDraft(false);
    if (lostClips > 0) {
      setDraftNotice(
        `Se recuperó el arreglo, pero ${lostClips === 1 ? "un clip quedó" : `${lostClips} clips quedaron`} afuera: ` +
          `era audio subido desde tu computadora o traído de un .mystudio, y eso solo vivía en la memoria del navegador. ` +
          `Volvé a agregarlo.`,
      );
    }
  }

  /// Arranca de cero, tirando el borrador. Lo llama tanto "Descartar"
  /// del cartel de recuperación como "Crear Proyecto" del gate de
  /// proyecto nuevo — en los dos casos el usuario dijo explícitamente
  /// que quiere empezar limpio.
  function discardDraft() {
    if (user) clearArrangerDraft(user.uid);
    liveDraftRef.current = null;
    cloudSavedSignatureRef.current = null;
    setRecoverableDraft(null);
    setDraftNotice(null);
    setCloudProjectId(null);
    setCloudBaseVersion(null);
    setProjectKey("");
    setIsDirty(false);
  }

  // ─── Render ──────────────────────────────────────────────────────────

  if (loading) return null;

  if (!user) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="font-display text-3xl font-bold text-white">
          Web Sample <span className="text-neon-cyan">Arranger</span>
        </h1>
        <p className="max-w-sm text-sm text-white/60">
          Iniciá sesión para armar y sincronizar canciones con samples del Banco de Sonidos.
        </p>
        <button
          type="button"
          onClick={() => setIsLoginOpen(true)}
          className="rounded-full border border-neon-cyan/40 bg-onyx-black px-6 py-2 font-display text-sm font-semibold text-neon-cyan transition-all duration-300 hover:border-neon-cyan hover:shadow-[0_0_18px_rgba(102,252,241,0.4)]"
        >
          Iniciar Sesión
        </button>
        {isLoginOpen && <LoginModal onClose={() => setIsLoginOpen(false)} />}
      </div>
    );
  }

  // Paso 1 (dashboard) — gate de "Nuevo Proyecto": pide Título/BPM/
  // Compás ANTES de revelar la grilla. Edita DIRECTAMENTE el mismo
  // estado que la barra superior (projectTitle/projectTempoBpm/
  // timeSignature...) — los valores ya quedaron aplicados cuando se
  // cierra el gate.
  //
  // "Crear Proyecto" además TIRA el borrador: pedir un proyecto nuevo es
  // decir explícitamente que se quiere empezar de cero, y arrancar con
  // las pistas del arreglo anterior adentro sería peor que perderlas.
  if (showNewProjectSetup) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-6 bg-onyx-black px-6 text-center">
        <h1 className="font-display text-3xl font-bold text-white">
          Nuevo <span className="text-neon-cyan">Arreglo</span>
        </h1>
        <p className="max-w-sm text-sm text-white/60">
          Definí el título, el tempo y el compás para empezar — podés cambiarlos después desde la barra superior.
        </p>
        <div className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-white/10 bg-graphite p-6 text-left">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">Título</span>
            <input
              value={projectTitle}
              onChange={(e) => setProjectTitle(e.target.value)}
              autoFocus
              className="rounded-lg border border-white/15 bg-onyx-black px-3 py-2 text-sm text-white outline-none focus:border-neon-cyan"
            />
          </label>
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-xs text-white/50">BPM</span>
              <input
                type="number"
                min={20}
                max={300}
                value={projectTempoBpm}
                onChange={(e) => setProjectTempoBpm(Number(e.target.value) || 120)}
                className="rounded-lg border border-white/15 bg-onyx-black px-3 py-2 text-sm text-white outline-none focus:border-neon-cyan"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-xs text-white/50">Compás</span>
              <select
                value={`${timeSignatureNumerator}/${timeSignatureDenominator}`}
                onChange={(e) => {
                  const [num, den] = e.target.value.split("/").map(Number);
                  setTimeSignatureNumerator(num);
                  setTimeSignatureDenominator(den);
                }}
                className="rounded-lg border border-white/15 bg-onyx-black px-3 py-2 text-sm text-white outline-none focus:border-neon-cyan"
              >
                {TIME_SIGNATURE_PRESETS.map((sig) => (
                  <option key={sig} value={sig}>
                    {sig}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            onClick={() => {
              discardDraft();
              // Empezar de cero también vacía el historial: no hay
              // ningún arreglo anterior al que volver.
              loadArrangement({ tracks: [] });
              setShowNewProjectSetup(false);
            }}
            className="mt-2 rounded-full bg-neon-cyan px-6 py-2.5 font-display text-sm font-semibold text-onyx-black transition-all duration-200 hover:shadow-[0_0_20px_rgba(102,252,241,0.5)] active:scale-95"
          >
            Crear Proyecto
          </button>
        </div>
      </div>
    );
  }

  const totalWidth = totalDurationSeconds * effectivePixelsPerSecond;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-onyx-black text-white">
      {/* ─── Barra superior ─── */}
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 bg-graphite px-4 py-3">
        <Link href="/projects" className="text-xs text-white/40 hover:text-white/70">
          ← Mis Proyectos
        </Link>

        {/* Paso 1 — edición bidireccional: abrir un .mystudio existente desde el disco. La otra vía (Firebase Storage) llega vía ?open=<cloudId> desde ProjectsDashboard. */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".mystudio"
          onChange={handleOpenLocalFile}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isImporting}
          title="Abrir un archivo .mystudio desde tu computadora"
          className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:border-white/40 disabled:opacity-40"
        >
          Abrir Proyecto
        </button>

        {/* Subir un clip de audio suelto (.mp3/.wav) como pista nueva —
            equivalente web de "Importar audio" de la app móvil. */}
        <input
          ref={audioFileInputRef}
          type="file"
          accept=".mp3,.wav,audio/mpeg,audio/wav"
          onChange={handleUploadAudioFile}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => audioFileInputRef.current?.click()}
          disabled={isUploadingAudio}
          title="Subir un archivo de audio (.mp3 o .wav) como pista nueva"
          className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:border-white/40 disabled:opacity-40"
        >
          {isUploadingAudio ? "Subiendo..." : "+ Subir Audio"}
        </button>

        <input
          value={projectTitle}
          onChange={(e) => setProjectTitle(e.target.value)}
          className="rounded-lg border border-white/15 bg-onyx-black px-3 py-1.5 text-sm font-semibold text-white outline-none focus:border-neon-cyan"
        />
        <div className="flex items-center gap-1.5 text-xs text-white/50">
          <span>BPM</span>
          <input
            type="number"
            min={20}
            max={300}
            value={projectTempoBpm}
            onChange={(e) => setProjectTempoBpm(Number(e.target.value) || 120)}
            className="w-16 rounded-lg border border-white/15 bg-onyx-black px-2 py-1.5 text-xs text-white outline-none focus:border-neon-cyan"
          />
        </div>

        {/* Tonalidad del proyecto — opcional, y por eso arranca en
            "—": declararla habilita el filtro de compatibilidad del
            Banco de Sonidos y la transposición automática al soltar,
            pero un arreglo de percusión no tiene por qué inventarse
            una. */}
        <div className="flex items-center gap-1.5 text-xs text-white/50">
          <span>Tono</span>
          <select
            value={projectKey}
            onChange={(e) => setProjectKey(e.target.value)}
            title="Tonalidad del proyecto: filtra el Banco de Sonidos por compatibilidad y transpone los samples al soltarlos"
            className="rounded-lg border border-white/15 bg-onyx-black px-2 py-1.5 text-xs text-white outline-none focus:border-neon-cyan"
          >
            <option value="">—</option>
            {SAMPLE_KEYS.filter((k) => k !== "N/A").map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>

        {/* Paso 1 — Tipo de compás del proyecto. */}
        <div className="flex items-center gap-1.5 text-xs text-white/50">
          <span>Compás</span>
          <select
            value={`${timeSignatureNumerator}/${timeSignatureDenominator}`}
            onChange={(e) => {
              const [num, den] = e.target.value.split("/").map(Number);
              setTimeSignatureNumerator(num);
              setTimeSignatureDenominator(den);
            }}
            className="rounded-lg border border-white/15 bg-onyx-black px-2 py-1.5 text-xs text-white outline-none focus:border-neon-cyan"
          >
            {TIME_SIGNATURE_PRESETS.map((sig) => (
              <option key={sig} value={sig}>
                {sig}
              </option>
            ))}
          </select>
        </div>

        {/* Imán a la grilla. Convive con el imán clip-contra-clip, que
            no se apaga nunca: son dos cosas distintas (pegarse a la
            grilla del tema, o pegarse al clip de al lado). Alt mientras
            arrastrás los suelta a los dos. */}
        <div className="flex items-center gap-1.5 text-xs text-white/50">
          <span title="A qué se pega un clip al arrastrarlo. Mantené Alt para soltarlo momentáneamente.">
            Imán
          </span>
          <select
            value={snapDivision}
            onChange={(e) => setSnapDivision(e.target.value as SnapDivision)}
            className="rounded-lg border border-white/15 bg-onyx-black px-2 py-1.5 text-xs text-white outline-none focus:border-neon-cyan"
          >
            {SNAP_DIVISIONS.map((division) => (
              <option key={division} value={division}>
                {SNAP_LABELS[division]}
              </option>
            ))}
          </select>
        </div>

        {/* Paso 2 — alternar la regla de tiempo entre Segundos y Compases. */}
        <div className="flex items-center overflow-hidden rounded-full border border-white/15 text-[10px]">
          <button
            type="button"
            onClick={() => setRulerMode("seconds")}
            className={`px-2.5 py-1 transition-colors duration-200 ${
              rulerMode === "seconds" ? "bg-neon-cyan/20 text-neon-cyan" : "text-white/50 hover:text-white/80"
            }`}
          >
            Segundos
          </button>
          <button
            type="button"
            onClick={() => setRulerMode("bars")}
            className={`px-2.5 py-1 transition-colors duration-200 ${
              rulerMode === "bars" ? "bg-neon-cyan/20 text-neon-cyan" : "text-white/50 hover:text-white/80"
            }`}
          >
            Compases
          </button>
        </div>

        {/* Deshacer/rehacer. El tooltip dice QUÉ se va a deshacer: un
            botón que solo dice "deshacer" obliga a probar para saber. */}
        <div className="flex items-center overflow-hidden rounded-full border border-white/15">
          <button
            type="button"
            onClick={arrangement.undo}
            disabled={!arrangement.canUndo}
            title={arrangement.undoLabel ? `Deshacer: ${arrangement.undoLabel} (Ctrl+Z)` : "Nada que deshacer"}
            aria-label="Deshacer"
            className="px-2.5 py-1 text-sm text-white/60 transition-colors duration-200 hover:text-white disabled:opacity-25"
          >
            ↶
          </button>
          <button
            type="button"
            onClick={arrangement.redo}
            disabled={!arrangement.canRedo}
            title={arrangement.redoLabel ? `Rehacer: ${arrangement.redoLabel} (Ctrl+Shift+Z)` : "Nada que rehacer"}
            aria-label="Rehacer"
            className="px-2.5 py-1 text-sm text-white/60 transition-colors duration-200 hover:text-white disabled:opacity-25"
          >
            ↷
          </button>
        </div>

        <div className="mx-2 flex items-center gap-2">
          <button
            type="button"
            onClick={handlePlayButton}
            title="Play (barra espaciadora)"
            className={`flex h-9 w-9 items-center justify-center rounded-full border transition-all duration-200 ${
              isPlaying
                ? "border-neon-cyan bg-neon-cyan/15 text-neon-cyan"
                : "border-neon-cyan/40 text-neon-cyan hover:border-neon-cyan"
            }`}
            aria-label="Play"
          >
            <span className="ml-0.5 block h-0 w-0 border-y-[6px] border-l-[10px] border-y-transparent border-l-current" />
          </button>
          <button
            type="button"
            onClick={handleStopButton}
            title="Pausa/Stop (barra espaciadora)"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-white/70 hover:border-white/50 hover:text-white"
            aria-label="Stop"
          >
            <span className="block h-2.5 w-2.5 bg-current" />
          </button>
          <button
            type="button"
            onClick={handleLoopButton}
            title={
              loopRegion
                ? `Repetir ${formatTime(loopRegion.startSeconds)} → ${formatTime(loopRegion.endSeconds)} · arrastrá sobre la regla para marcar otro tramo`
                : `Repetir ${DEFAULT_LOOP_BARS} compases desde el cursor · arrastrá sobre la regla para marcar un tramo`
            }
            aria-pressed={loopEnabled}
            className={`flex h-8 items-center gap-1 rounded-full border px-2.5 text-sm transition-all duration-200 ${
              loopEnabled
                ? "border-amber-400 bg-amber-400/15 text-amber-300"
                : "border-white/20 text-white/60 hover:border-white/50 hover:text-white"
            }`}
            aria-label="Loop"
          >
            ⟳
            {loopEnabled && loopRegion && (
              <span className="text-[10px] tabular-nums">
                {formatTime(loopRegion.startSeconds)}–{formatTime(loopRegion.endSeconds)}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={handleMetronomeButton}
            title="Clic del metrónomo. No entra en la mezcla ni en lo que se exporta: es para comprobar que el arreglo esté a tiempo."
            aria-pressed={metronomeEnabled}
            className={`flex h-8 w-8 items-center justify-center rounded-full border text-sm transition-all duration-200 ${
              metronomeEnabled
                ? "border-neon-cyan bg-neon-cyan/15 text-neon-cyan"
                : "border-white/20 text-white/60 hover:border-white/50 hover:text-white"
            }`}
            aria-label="Metrónomo"
          >
            ♩
          </button>
          <span className="w-20 font-display text-xs tabular-nums text-white/50">
            {formatTime(playheadSeconds)} / {formatTime(totalDurationSeconds)}
          </span>
        </div>

        {/* Problema 4 — slider de zoom, con piso dinámico (ver minPixelsPerSecond). */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-white/40">Zoom</span>
          <input
            type="range"
            min={minPixelsPerSecond}
            max={MAX_PIXELS_PER_SECOND}
            step={1}
            value={effectivePixelsPerSecond}
            onChange={(e) => setPixelsPerSecond(Number(e.target.value))}
            className="h-1 w-24 accent-neon-cyan"
          />
          <button
            type="button"
            onClick={() => setPixelsPerSecond(minPixelsPerSecond)}
            title="Ver todo el arreglo, sin scroll horizontal"
            className="rounded-full border border-white/15 px-2.5 py-1 text-[10px] text-white/60 hover:border-white/40"
          >
            Ajustar
          </button>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {selectedClipIds.length > 0 && (
            <div className="flex items-center gap-1.5">
              {(() => {
                const found = selectedClipId ? findClip(selectedClipId) : null;
                if (!found) return null;
                return (
                  <div className="flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5">
                    <span className="text-[10px] text-white/40">Vol. clip</span>
                    <input
                      type="range"
                      min={MIN_CLIP_GAIN}
                      max={MAX_CLIP_GAIN}
                      step={0.01}
                      value={found.clip.gain}
                      onChange={(e) => updateClip(found.clip.id, { gain: Number(e.target.value) })}
                      className="h-1 w-16 accent-neon-cyan"
                    />
                    <span className="w-8 text-[10px] tabular-nums text-white/40">
                      {Math.round(found.clip.gain * 100)}%
                    </span>
                  </div>
                );
              })()}
              {(() => {
                const found = selectedClipId ? findClip(selectedClipId) : null;
                if (!found) return null;
                return (
                  <div className="flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5">
                    <span className="text-[10px] text-white/40">Pitch</span>
                    <button
                      type="button"
                      onClick={() =>
                        updateClip(found.clip.id, {
                          pitchShift: Math.max(MIN_PITCH_SEMITONES, found.clip.pitchShift - 1),
                        })
                      }
                      disabled={found.clip.pitchShift <= MIN_PITCH_SEMITONES}
                      title="Bajar un semitono"
                      className="flex h-4 w-4 items-center justify-center rounded-full bg-white/10 text-[10px] leading-none text-white/70 hover:bg-white/20 disabled:opacity-30"
                    >
                      −
                    </button>
                    <input
                      type="range"
                      min={MIN_PITCH_SEMITONES}
                      max={MAX_PITCH_SEMITONES}
                      step={1}
                      value={found.clip.pitchShift}
                      onChange={(e) => updateClip(found.clip.id, { pitchShift: Number(e.target.value) })}
                      className="h-1 w-20 accent-neon-cyan"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        updateClip(found.clip.id, {
                          pitchShift: Math.min(MAX_PITCH_SEMITONES, found.clip.pitchShift + 1),
                        })
                      }
                      disabled={found.clip.pitchShift >= MAX_PITCH_SEMITONES}
                      title="Subir un semitono"
                      className="flex h-4 w-4 items-center justify-center rounded-full bg-white/10 text-[10px] leading-none text-white/70 hover:bg-white/20 disabled:opacity-30"
                    >
                      +
                    </button>
                    <span className="w-10 text-[10px] tabular-nums text-white/40">
                      {found.clip.pitchShift > 0 ? "+" : ""}
                      {found.clip.pitchShift} st
                    </span>
                  </div>
                );
              })()}
              {/* BPM original del clip — solo tiene efecto en clips
                  "Loop" (playbackRateFor devuelve 1.0 para cualquier
                  otro tipo, ver esa función). Es lo que habilita el
                  time-stretch automático al tempo del proyecto para un
                  clip subido desde la computadora (ver
                  handleUploadAudioFile) con el MISMO motor que ya
                  usaban los loops del Banco de Sonidos. */}
              {(() => {
                const found = selectedClipId ? findClip(selectedClipId) : null;
                if (!found || found.clip.sampleType !== "Loop") return null;
                return (
                  <div className="flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5">
                    <span className="text-[10px] text-white/40" title="BPM original de este clip — el motor lo estira/comprime para que coincida con el BPM del proyecto de arriba">
                      BPM original
                    </span>
                    <input
                      type="number"
                      min={20}
                      max={300}
                      value={found.clip.originalBpm}
                      onChange={(e) =>
                        updateClip(found.clip.id, { originalBpm: Number(e.target.value) || found.clip.originalBpm })
                      }
                      className="w-14 rounded-lg border border-white/15 bg-onyx-black px-2 py-1 text-[10px] text-white outline-none focus:border-neon-cyan"
                    />
                  </div>
                );
              })()}
              {/* Tonalidad del clip, y si ENTRA o no en la del
                  proyecto. Es la respuesta a "¿este audio está en el
                  tono del tema?", que antes no se podía contestar en
                  ninguna pantalla: el dato del Banco se usaba al soltar
                  el sample y se descartaba, y un archivo propio no lo
                  tenía nunca. */}
              {(() => {
                const found = selectedClipId ? findClip(selectedClipId) : null;
                if (!found) return null;
                const clipKey = found.clip.sampleKey;
                const shift = found.clip.pitchShift;
                // ⚠️ Se juzga en qué tono SUENA, no en cuál se grabó.
                // Un clip del Banco nace transpuesto, así que mirar su
                // tonalidad original decía "no entra" de algo que
                // entraba perfecto y ofrecía aplicar una transposición
                // que YA estaba aplicada. Encontrado probándolo: un
                // piano en G Minor con +2 st puestos automáticamente
                // suena en A Minor, y el control insistía con
                // "Adaptar +2 st".
                const soundingKey = shift === 0 ? clipKey : (transposeKey(clipKey, shift) ?? clipKey);
                const fits = keysAreCompatible(projectKey || null, soundingKey || null);
                // Cuánto FALTA desde donde está ahora, no desde el
                // original: si no, "Adaptar" volvería a contar desde
                // cero y desharía lo que ya se aplicó.
                const missing = transposeSemitonesFor(projectKey || null, soundingKey || null);
                const canCompare = Boolean(projectKey && clipKey);
                return (
                  <div className="flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5">
                    <span
                      className="text-[10px] text-white/40"
                      title="Tonalidad de este clip. Si el proyecto tiene tonalidad elegida, al lado dice si entra o no."
                    >
                      Tono
                    </span>
                    <select
                      value={clipKey}
                      onChange={(e) => updateClip(found.clip.id, { sampleKey: e.target.value })}
                      className="rounded-lg border border-white/15 bg-onyx-black px-1.5 py-1 text-[10px] text-white outline-none focus:border-neon-cyan"
                    >
                      <option value="">—</option>
                      {SAMPLE_KEYS.filter((k) => k !== "N/A").map((k) => (
                        <option key={k} value={k}>
                          {keyLabel(k)}
                        </option>
                      ))}
                    </select>
                    {/* Con transposición aplicada se muestran las DOS:
                        de dónde salió y cómo suena. Mostrar solo una de
                        las dos deja una pregunta sin responder. */}
                    {clipKey && shift !== 0 && soundingKey && (
                      <span className="text-[10px] text-white/50">
                        → {keyLabel(soundingKey)} ({shift > 0 ? "+" : ""}
                        {shift} st)
                      </span>
                    )}
                    {canCompare &&
                      (fits ? (
                        // Verde y sin botón: no hay nada que hacer, y
                        // ofrecer una acción acá invitaría a "arreglar"
                        // algo que ya está bien.
                        <span className="text-[10px] font-semibold text-emerald-400">
                          entra en {keyLabel(projectKey)}
                        </span>
                      ) : (
                        <>
                          <span className="text-[10px] font-semibold text-amber-300">
                            no entra en {keyLabel(projectKey)}
                          </span>
                          {missing !== 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                updateClip(found.clip.id, { pitchShift: shift + missing })
                              }
                              title={`Mover ${missing > 0 ? "+" : ""}${missing} semitonos más (quedaría en ${shift + missing} st): es el desplazamiento más chico que lo vuelve compatible`}
                              className="rounded-full border border-amber-300/40 px-2 py-0.5 text-[10px] text-amber-200 hover:border-amber-300"
                            >
                              Adaptar {missing > 0 ? "+" : ""}
                              {missing} st
                            </button>
                          )}
                        </>
                      ))}
                    {!projectKey && (
                      <span className="text-[10px] text-white/30">
                        elegí el tono del proyecto arriba para comparar
                      </span>
                    )}
                  </div>
                );
              })()}
              {/* Cortar es por definición de UN clip: partir seis en
                  el cursor a la vez es otra función, y bastante más
                  dudosa (la mitad quedaría con piezas de duración casi
                  cero). */}
              {selectedClipId && (
                <button
                  type="button"
                  onClick={splitSelectedClipAtPlayhead}
                  title="Cortar en el cursor (tecla S)"
                  className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:border-white/40"
                >
                  Cortar
                </button>
              )}
              <button
                type="button"
                onClick={copySelectedClips}
                className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:border-white/40"
              >
                Copiar
              </button>
              <button
                type="button"
                onClick={pasteClipboard}
                disabled={!clipboard || clipboard.length === 0}
                className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:border-white/40 disabled:opacity-30"
              >
                Pegar
              </button>
              <button
                type="button"
                onClick={duplicateSelectedClips}
                className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:border-white/40"
              >
                Duplicar
              </button>
              <button
                type="button"
                onClick={deleteSelectedClips}
                className="rounded-full border border-red-400/30 px-3 py-1.5 text-xs text-red-300 hover:border-red-400"
              >
                Eliminar
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={handleExport}
            // Antes pedía que ALGUNA pista tuviera audio, y eso dejaba
            // sin ninguna forma de guardar al caso más común de todos:
            // proyecto nuevo, unas pistas armadas, todavía sin clips.
            // Alcanza con que haya una pista.
            disabled={isExporting || pendingDrops.length > 0 || tracks.length === 0}
            className="rounded-full border border-neon-cyan/40 bg-onyx-black px-5 py-2 font-display text-xs font-semibold text-neon-cyan transition-all duration-300 hover:border-neon-cyan hover:shadow-[0_0_18px_rgba(102,252,241,0.4)] disabled:opacity-40"
          >
            {isExporting
              ? `Exportando... ${Math.round(exportProgress * 100)}%`
              : cloudProjectId
                ? "Guardar cambios"
                : "Exportar y Sincronizar"}
          </button>
          {/* Estado del borrador. "Guardado" acá significa EN LA NUBE:
              el borrador local es automático y no hace falta contarlo
              como una acción del usuario. */}
          {tracks.length > 0 && !isExporting && (
            <span
              className={`text-[11px] ${isDirty ? "text-amber-300/80" : "text-white/30"}`}
              title={
                isDirty
                  ? "Se guarda solo en este navegador. Sincronizá para tenerlo en la app y en otros dispositivos."
                  : undefined
              }
            >
              {isDirty ? "Sin sincronizar" : "Sincronizado"}
            </span>
          )}
        </div>
      </div>

      {isImporting && (
        <div className="flex flex-col gap-1.5 bg-white/5 px-4 py-2">
          <div className="flex items-center gap-2 text-xs text-white/50">
            <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-neon-cyan" />
            <span>{importStage ?? "Importando proyecto..."}</span>
            <span className="ml-auto tabular-nums text-white/30">{Math.round(importProgress * 100)}%</span>
          </div>
          {/* Barra de progreso real (no solo un spinner indeterminado) —
              el brillo que la recorre de lado a lado es puro adorno
              (misma idea que un shimmer de skeleton), la que realmente
              informa avance es el ancho. */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="relative h-full overflow-hidden rounded-full bg-neon-cyan transition-[width] duration-200 ease-out"
              style={{ width: `${Math.max(4, importProgress * 100)}%` }}
            >
              <div className="absolute inset-0 animate-[shimmer_1.2s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent" />
            </div>
          </div>
        </div>
      )}
      {importError && (
        <p className="bg-red-900/30 px-4 py-1.5 text-xs text-red-300">
          No se pudo abrir el proyecto: {importError}
        </p>
      )}
      {addSampleError && (
        <p className="bg-red-900/30 px-4 py-1.5 text-xs text-red-300">{addSampleError}</p>
      )}
      {recoverableDraft && (
        <div className="flex flex-wrap items-center gap-3 bg-amber-900/25 px-4 py-2 text-xs text-amber-100">
          <span>
            Tenés un arreglo sin sincronizar de {describeDraftAge(recoverableDraft.savedAt)}
            {recoverableDraft.projectTitle ? ` — «${recoverableDraft.projectTitle}»` : ""}.
          </span>
          <button
            type="button"
            onClick={() => void restoreStoredDraft(recoverableDraft)}
            disabled={isRestoringDraft}
            className="rounded-full border border-amber-300/50 px-3 py-1 font-semibold transition-colors duration-200 hover:border-amber-200 disabled:opacity-50"
          >
            {isRestoringDraft ? "Recuperando..." : "Recuperar"}
          </button>
          <button
            type="button"
            onClick={discardDraft}
            disabled={isRestoringDraft}
            className="rounded-full border border-white/20 px-3 py-1 text-white/60 transition-colors duration-200 hover:border-white/40 hover:text-white disabled:opacity-50"
          >
            Descartar
          </button>
        </div>
      )}
      {draftNotice && (
        <p className="bg-amber-900/25 px-4 py-1.5 text-xs text-amber-100">{draftNotice}</p>
      )}
      {exportError && (
        <p className="bg-red-900/30 px-4 py-1.5 text-xs text-red-300">
          No se pudo exportar: {exportError}
        </p>
      )}
      {exportSuccessTitle && (
        <p className="bg-green-900/30 px-4 py-1.5 text-xs text-neon-cyan">
          &quot;{exportSuccessTitle}&quot; se sincronizó a la nube — ya debería aparecer en la app.
        </p>
      )}
      {pendingDrops.length > 0 && (
        <p className="bg-white/5 px-4 py-1.5 text-xs text-white/50">
          Cargando {pendingDrops.length === 1 ? "sample" : `${pendingDrops.length} samples`}...
        </p>
      )}

      {/* ─── Cuerpo: sidebar + timeline ─── */}
      <div className="flex flex-1 overflow-hidden">
        <div className="w-72 shrink-0 border-r border-white/10 bg-graphite p-4">
          <SampleBrowserPanel
            onAddSample={handleQuickAddSample}
            projectTempoBpm={projectTempoBpm}
            projectKey={projectKey}
            matchProject={matchProject}
            onMatchProjectChange={setMatchProject}
            getAudioContext={() => audioContextRef.current}
            getSyncContextTime={syncContextTime}
          />
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
            <button
              type="button"
              onClick={addTrack}
              className="rounded-full border border-white/15 px-4 py-1.5 text-xs font-semibold text-white/70 hover:border-neon-cyan/50 hover:text-neon-cyan"
            >
              + Agregar pista
            </button>
            {clipNotice ? (
              <span className="text-[10px] text-amber-300/80">{clipNotice}</span>
            ) : selectedClipIds.length > 1 ? (
              <span className="text-[10px] text-white/40">
                {selectedClipIds.length} clips seleccionados · Ctrl+D duplica el bloque · Delete borra todo
              </span>
            ) : selectedClipId ? (
              <span className="text-[10px] text-white/30">
                Tecla S: cortar en el cursor · Delete: borrar · Ctrl+click o arrastrá sobre el fondo para elegir varios
              </span>
            ) : null}
          </div>

          <div ref={timelineViewportRef} className="flex-1 overflow-auto">
            {tracks.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-white/30">
                  Agregá una pista y arrastrá un sample para empezar.
                </p>
              </div>
            ) : (
              <div style={{ width: HEADER_WIDTH + totalWidth }}>
                {/* Regla de tiempo */}
                <div className="flex" style={{ height: RULER_HEIGHT }}>
                  <div
                    className="sticky left-0 z-20 shrink-0 border-b border-white/10 bg-onyx-black"
                    style={{ width: HEADER_WIDTH }}
                  />
                  <div
                    className="relative flex-1 cursor-pointer border-b border-white/10"
                    onPointerDown={handleRulerPointerDown}
                    title="Click para mover el cursor · arrastrá para marcar el tramo a repetir"
                  >
                    {/* Tramo de loop, dibujado por TODA la altura de las
                        pistas (mismo truco de bottom negativo que usan el
                        cursor y la grilla). Atenuado cuando el loop está
                        apagado: el tramo sigue marcado y se puede volver
                        a encender sin tener que dibujarlo de nuevo. */}
                    {loopRegion && (
                      <div
                        className={`pointer-events-none absolute top-0 z-0 ${
                          loopEnabled ? "bg-amber-400/10" : "bg-white/[0.03]"
                        }`}
                        style={{
                          left: loopRegion.startSeconds * effectivePixelsPerSecond,
                          width: Math.max(
                            1,
                            (loopRegion.endSeconds - loopRegion.startSeconds) * effectivePixelsPerSecond,
                          ),
                          bottom: -4000,
                          borderLeft: `1px solid ${loopEnabled ? "rgb(251 191 36 / 0.8)" : "rgb(255 255 255 / 0.15)"}`,
                          borderRight: `1px solid ${loopEnabled ? "rgb(251 191 36 / 0.8)" : "rgb(255 255 255 / 0.15)"}`,
                        }}
                      />
                    )}
                    {/* Lo que se está arrastrando ahora mismo. Se dibuja
                        SIN pegar a la grilla, siguiendo al mouse: el
                        tramo definitivo se redondea recién al soltar
                        (ver normalizeLoopRegion) y ver el redondeo en
                        vivo daría un borde que salta. */}
                    {loopDraft && (
                      <div
                        className="pointer-events-none absolute top-0 z-0 border-x border-amber-300/70 bg-amber-300/15"
                        style={{
                          left: loopDraft.fromSeconds * effectivePixelsPerSecond,
                          width: Math.max(
                            1,
                            (loopDraft.toSeconds - loopDraft.fromSeconds) * effectivePixelsPerSecond,
                          ),
                          bottom: -4000,
                        }}
                      />
                    )}
                    {rulerTicks.map((tick, i) => (
                      <div
                        key={i}
                        className="absolute top-0 flex h-full flex-col items-start"
                        style={{ left: tick.seconds * effectivePixelsPerSecond }}
                      >
                        <div className={tick.major ? "h-1.5 w-px bg-white/20" : "h-1 w-px bg-white/10"} />
                        {tick.label && <span className="text-[9px] text-white/35">{tick.label}</span>}
                      </div>
                    ))}
                    {/* Grilla musical de fondo (Paso 2) — mismas marcas que la regla, extendidas por TODA la altura de las pistas, para poder alinear clips a ojo contra el compás/beat. Solo en modo Compases. */}
                    {rulerMode === "bars" &&
                      rulerTicks.map((tick, i) => (
                        <div
                          key={`grid-${i}`}
                          className={`pointer-events-none absolute top-0 z-0 w-px ${
                            tick.major ? "bg-white/10" : "bg-white/5"
                          }`}
                          style={{ left: tick.seconds * effectivePixelsPerSecond, bottom: -4000 }}
                        />
                      ))}
                    <div
                      className="pointer-events-none absolute top-0 z-10 w-px bg-neon-cyan"
                      style={{ left: playheadSeconds * effectivePixelsPerSecond, bottom: -4000 }}
                    />
                    {/* Guía de "imán": aparece mientras arrastrás un clip cerca de otro, marcando el borde al que se va a pegar. */}
                    {snapGuideSeconds != null && (
                      <div
                        className="pointer-events-none absolute top-0 z-10 w-px bg-amber-400"
                        style={{ left: snapGuideSeconds * effectivePixelsPerSecond, bottom: -4000 }}
                      />
                    )}
                  </div>
                </div>

                {tracks.map((track, trackIndex) => (
                  <div key={track.id} className="flex" style={{ height: ROW_HEIGHT }}>
                    <div
                      className="sticky left-0 z-20 flex shrink-0 flex-col justify-center gap-1 border-b border-r border-white/10 bg-graphite px-3 py-1.5"
                      style={{ width: HEADER_WIDTH }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: track.color }}
                        />
                        <input
                          value={track.name}
                          onChange={(e) => updateTrack(track.id, { name: e.target.value })}
                          className="w-full truncate bg-transparent text-xs font-semibold text-white outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => deleteTrack(track.id)}
                          className="text-white/30 hover:text-red-300"
                          aria-label="Borrar pista"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="flex items-center gap-1">
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={track.volume}
                          onChange={(e) =>
                            updateTrack(track.id, { volume: Number(e.target.value) })
                          }
                          className="h-1 flex-1 accent-neon-cyan"
                        />
                        <input
                          type="range"
                          min={-1}
                          max={1}
                          step={0.01}
                          value={track.pan}
                          onChange={(e) => updateTrack(track.id, { pan: Number(e.target.value) })}
                          className="h-1 w-12 accent-white/60"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => updateTrack(track.id, { isMuted: !track.isMuted })}
                          className={`h-5 w-5 rounded text-[10px] font-bold ${
                            track.isMuted
                              ? "bg-amber-500 text-black"
                              : "bg-white/10 text-white/50"
                          }`}
                        >
                          M
                        </button>
                        <button
                          type="button"
                          onClick={() => updateTrack(track.id, { isSolo: !track.isSolo })}
                          className={`h-5 w-5 rounded text-[10px] font-bold ${
                            track.isSolo
                              ? "bg-sky-400 text-black"
                              : "bg-white/10 text-white/50"
                          }`}
                        >
                          S
                        </button>
                      </div>
                    </div>

                    <div
                      data-track-id={track.id}
                      data-track-index={trackIndex}
                      className={`relative flex-1 border-b bg-black/20 transition-colors duration-100 ${
                        dragHoverTrackId === track.id && dragOriginTrackId !== null && dragOriginTrackId !== track.id
                          ? "border-white/10 bg-neon-cyan/10 ring-1 ring-inset ring-neon-cyan/40"
                          : "border-white/10"
                      }`}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => handleTrackDrop(e, track.id)}
                      onPointerDown={(e) => handleLanePointerDown(e, trackIndex)}
                      onPointerMove={handleLanePointerMove}
                      onPointerUp={handleLanePointerUp}
                    >
                      {/* Tramo del rectángulo de goma que le toca a ESTE
                          carril. Dibujarlo por carril evita tener que
                          montar una capa que cruce toda la zona de
                          pistas por encima del scroll.
                          pointer-events-none es obligatorio: si no,
                          elementFromPoint devolvería el rectángulo en
                          vez del carril y dejaría de saber sobre qué
                          pista está el mouse. */}
                      {marquee && trackIndex >= marquee.trackFrom && trackIndex <= marquee.trackTo && (
                        <div
                          className="pointer-events-none absolute top-0 bottom-0 z-10 border border-neon-cyan/70 bg-neon-cyan/10"
                          style={{
                            left: marquee.fromSeconds * effectivePixelsPerSecond,
                            width: Math.max(
                              1,
                              (marquee.toSeconds - marquee.fromSeconds) * effectivePixelsPerSecond,
                            ),
                          }}
                        />
                      )}
                      {track.clips.map((clip) => {
                        const isDragging = dragRef.current?.clipId === clip.id;
                        // Los demás clips del bloque se corren el MISMO
                        // delta que el agarrado: sin esto, el bloque se
                        // ve romperse durante el arrastre y recomponerse
                        // al soltar.
                        const groupDrag =
                          !isDragging &&
                          dragPreviewStartSeconds != null &&
                          dragRef.current != null &&
                          dragRef.current.movingClipIds.length > 1 &&
                          dragRef.current.movingClipIds.includes(clip.id)
                            ? dragPreviewStartSeconds - dragRef.current.originalStartSeconds
                            : null;
                        const isTrimming = trimDragRef.current?.clipId === clip.id;
                        const isFading = fadeDragRef.current?.clipId === clip.id;
                        let effective = clip;
                        if (isTrimming && trimPreview) effective = { ...effective, ...trimPreview };
                        if (isFading && fadePreview) effective = { ...effective, ...fadePreview };
                        const startSeconds =
                          isDragging && dragPreviewStartSeconds != null
                            ? dragPreviewStartSeconds
                            : groupDrag != null
                              ? Math.max(0, effective.startSeconds + groupDrag)
                              : effective.startSeconds;
                        const widthPx = Math.max(
                          3,
                          displayDurationFor(effective, projectTempoBpm) * effectivePixelsPerSecond,
                        );
                        const isSelected = selectedClipIds.includes(clip.id);
                        const visiblePeaks = tilePeaks(
                          slicePeaksForWindow(
                            clip.peaks,
                            effective.sourceOffsetSeconds,
                            effective.sourceDurationSeconds,
                            clip.buffer.duration,
                          ),
                          effective.repeats,
                        );
                        // Lo que se DIBUJA es el fade resuelto (con el
                        // crossfade de los solapes ya adentro), no el que
                        // la persona puso a mano: si no, un cruce se
                        // escucharía sin verse. Mientras se arrastra un
                        // tirador se muestra el valor crudo, que es el
                        // que la mano está moviendo.
                        const shownFades = isFading && fadePreview ? null : fadesFor(clip);
                        const fadeInPx =
                          (shownFades?.fadeInSeconds ?? effective.fadeInSeconds) * effectivePixelsPerSecond;
                        const fadeOutPx =
                          (shownFades?.fadeOutSeconds ?? effective.fadeOutSeconds) * effectivePixelsPerSecond;
                        // El cruce se dibuja en ámbar y el fade propio en
                        // blanco: uno lo puso el código por vos y el otro
                        // lo pusiste vos, y conviene poder distinguirlos
                        // de un vistazo.
                        const fadeInColor = shownFades?.crossfadeIn ? "#FBBF24" : "#fff";
                        const fadeOutColor = shownFades?.crossfadeOut ? "#FBBF24" : "#fff";
                        const waveformHeightPx = ROW_HEIGHT - 12;
                        // Los tiradores de fade van en la PUNTA de la rampa (no
                        // fijos en la esquina) para poder ubicar de un vistazo
                        // dónde quedó, sin perder el punto donde agarrarla de
                        // nuevo — clamp para que el círculo no quede recortado
                        // por el overflow-hidden del clip en los extremos.
                        const fadeInHandleX = Math.min(
                          Math.max(fadeInPx, FADE_HANDLE_SIZE / 2),
                          widthPx - FADE_HANDLE_SIZE / 2,
                        );
                        const fadeOutHandleX = Math.min(
                          Math.max(widthPx - fadeOutPx, FADE_HANDLE_SIZE / 2),
                          widthPx - FADE_HANDLE_SIZE / 2,
                        );
                        const showTempoBadge =
                          clip.sampleType === "Loop" &&
                          clip.originalBpm > 0 &&
                          Math.round(clip.originalBpm) !== Math.round(projectTempoBpm);
                        return (
                          <div
                            key={clip.id}
                            onPointerDown={(e) => handleClipPointerDown(e, track.id, clip)}
                            className="absolute top-1.5 bottom-1.5 cursor-grab overflow-hidden rounded-sm border active:cursor-grabbing"
                            style={{
                              left: startSeconds * effectivePixelsPerSecond,
                              width: widthPx,
                              backgroundColor: `${track.color}1F`,
                              borderColor: isSelected ? "#FFB74D" : `${track.color}55`,
                              borderWidth: isSelected ? 2 : 1,
                              opacity: isDragging || groupDrag != null ? 0.65 : 1,
                            }}
                          >
                            {clip.peaks.length === 0 ? (
                              // Forma de onda todavía no calculada (recién
                              // importado — ver Fase 2 de
                              // importProjectFromZipBytes): un bloque
                              // pulsando en vez de vacío, para que se note
                              // que hay algo en curso y no que el clip
                              // está roto o silencioso.
                              <div
                                className="h-full w-full animate-pulse"
                                style={{ backgroundColor: `${track.color}33` }}
                              />
                            ) : (
                              <ClipWaveform
                                peaks={visiblePeaks}
                                color={track.color}
                                widthPx={widthPx}
                                heightPx={waveformHeightPx}
                              />
                            )}
                            {/* Triángulos de fade — mismo criterio visual que Ableton/Logic: la zona más oscura es la que suena más baja. */}
                            {fadeInPx > 0.5 && (
                              <div
                                className="pointer-events-none absolute inset-0 bg-black/55"
                                style={{ clipPath: `polygon(0 0, ${fadeInPx}px 0, 0 100%)` }}
                              />
                            )}
                            {fadeOutPx > 0.5 && (
                              <div
                                className="pointer-events-none absolute inset-0 bg-black/55"
                                style={{
                                  clipPath: `polygon(100% 0, ${Math.max(0, widthPx - fadeOutPx)}px 0, 100% 100%)`,
                                }}
                              />
                            )}
                            {/* Línea de la rampa — siempre visible (no solo al seleccionar), para poder ver de un vistazo dónde quedó el fade. */}
                            {(fadeInPx > 0.5 || fadeOutPx > 0.5) && (
                              <svg
                                className="pointer-events-none absolute left-0 top-0"
                                width={widthPx}
                                height={waveformHeightPx}
                              >
                                {fadeInPx > 0.5 && (
                                  <line
                                    x1={0}
                                    y1={waveformHeightPx}
                                    x2={fadeInPx}
                                    y2={0}
                                    stroke={fadeInColor}
                                    strokeWidth={1.5}
                                    opacity={0.85}
                                  />
                                )}
                                {fadeOutPx > 0.5 && (
                                  <line
                                    x1={widthPx}
                                    y1={waveformHeightPx}
                                    x2={Math.max(0, widthPx - fadeOutPx)}
                                    y2={0}
                                    stroke={fadeOutColor}
                                    strokeWidth={1.5}
                                    opacity={0.85}
                                  />
                                )}
                              </svg>
                            )}
                            {/* Dónde arranca cada vuelta. Es lo que
                                convierte "un bloque largo" en "esto se
                                repite cuatro veces" de un vistazo. */}
                            {effective.repeats > 1 &&
                              Array.from(
                                { length: Math.ceil(effective.repeats) - 1 },
                                (_, i) => i + 1,
                              ).map((n) => (
                                <div
                                  key={`rep-${n}`}
                                  className="pointer-events-none absolute top-0 bottom-0 w-px bg-white/25"
                                  style={{ left: (widthPx / effective.repeats) * n }}
                                />
                              ))}
                            <span className="pointer-events-none absolute left-1 top-0.5 truncate text-[9px] font-semibold text-white/80">
                              {clip.sampleName}
                            </span>
                            {effective.repeats > 1 && (
                              <span
                                className="pointer-events-none absolute right-1 top-0.5 rounded bg-black/50 px-1 text-[9px] font-semibold text-white/70"
                                title={`Se repite ${effective.repeats.toFixed(2).replace(/\.?0+$/, "")} veces`}
                              >
                                ×{Math.round(effective.repeats * 100) / 100}
                              </span>
                            )}
                            {showTempoBadge && (
                              <span
                                title="El motor está adaptando este sample al tempo del proyecto"
                                className="pointer-events-none absolute bottom-0.5 right-1 rounded bg-black/60 px-1 text-[8px] tabular-nums text-white/70"
                              >
                                {Math.round(clip.originalBpm)}→{Math.round(projectTempoBpm)}
                              </span>
                            )}
                            {clip.pitchShift !== 0 && (
                              <span
                                title="Pitch-shift aplicado a este clip (semitonos)"
                                className="pointer-events-none absolute bottom-0.5 left-1 rounded bg-black/60 px-1 text-[8px] tabular-nums text-white/70"
                              >
                                ♪ {clip.pitchShift > 0 ? "+" : ""}
                                {clip.pitchShift}
                              </span>
                            )}
                            {/* Los tiradores de recorte y de fade solo
                                aparecen con UN clip seleccionado: con
                                varios, la fila se llenaría de tiradores
                                y cualquiera de ellos editaría uno solo,
                                que no es lo que la selección múltiple
                                promete. */}
                            {isSelected && selectedClipIds.length === 1 && (
                              <>
                                <div
                                  onPointerDown={(e) =>
                                    handleTrimPointerDown(e, track.id, clip, "left")
                                  }
                                  className="absolute left-0 top-0 bottom-0 cursor-ew-resize bg-white/25 hover:bg-white/50"
                                  style={{ width: TRIM_HANDLE_WIDTH }}
                                />
                                <div
                                  onPointerDown={(e) =>
                                    handleTrimPointerDown(e, track.id, clip, "right")
                                  }
                                  className="absolute right-0 top-0 bottom-0 cursor-ew-resize bg-white/25 hover:bg-white/50"
                                  style={{ width: TRIM_HANDLE_WIDTH }}
                                />
                                {/* Tiradores de fade: se agarran EXACTAMENTE en la punta de la rampa (no en la esquina fija), así se ve y se retoma fácil dónde quedó. */}
                                <div
                                  onPointerDown={(e) => handleFadePointerDown(e, track.id, clip, "in")}
                                  title={`Fade-in: ${effective.fadeInSeconds.toFixed(2)}s`}
                                  className="absolute top-0 -translate-x-1/2 cursor-ew-resize rounded-full border border-black/50 bg-white shadow-sm hover:scale-110"
                                  style={{ left: fadeInHandleX, width: FADE_HANDLE_SIZE, height: FADE_HANDLE_SIZE }}
                                />
                                <div
                                  onPointerDown={(e) => handleFadePointerDown(e, track.id, clip, "out")}
                                  title={`Fade-out: ${effective.fadeOutSeconds.toFixed(2)}s`}
                                  className="absolute top-0 -translate-x-1/2 cursor-ew-resize rounded-full border border-black/50 bg-white shadow-sm hover:scale-110"
                                  style={{ left: fadeOutHandleX, width: FADE_HANDLE_SIZE, height: FADE_HANDLE_SIZE }}
                                />
                              </>
                            )}
                          </div>
                        );
                      })}
                      {/* Paso 4 (rendimiento) — bloques esqueleto para drops en vuelo: aparecen INSTANTÁNEOS en el punto exacto donde se soltó el sample, antes de que el audio real esté resuelto. */}
                      {pendingDrops
                        .filter((pending) => pending.trackId === track.id)
                        .map((pending) => (
                          <div
                            key={pending.id}
                            className="absolute top-1.5 bottom-1.5 animate-pulse overflow-hidden rounded-sm border border-dashed"
                            style={{
                              left: pending.startSeconds * effectivePixelsPerSecond,
                              width: Math.max(40, PLACEHOLDER_DURATION_SECONDS * effectivePixelsPerSecond),
                              borderColor: `${pending.color}55`,
                              backgroundColor: `${pending.color}12`,
                            }}
                          >
                            <span className="pointer-events-none absolute left-1 top-0.5 truncate text-[9px] font-semibold text-white/50">
                              {pending.sampleName}
                            </span>
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white/70" />
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
