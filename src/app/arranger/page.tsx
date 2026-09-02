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
  increment,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { ref, getDownloadURL, uploadBytesResumable } from "firebase/storage";
import JSZip from "jszip";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { db, storage } from "@/lib/firebase";
import { renderClipToWav } from "@/lib/wavExport";
import { scheduleGainEnvelope } from "@/lib/clipEnvelope";
import { getOrProcessBuffer } from "@/lib/audioDsp";
import { getCachedBuffer, loadAndCacheBuffer, setCachedBuffer } from "@/lib/sampleBufferCache";
import { takeQueuedSamplesForArranger } from "@/lib/pendingArrangerSamples";
import { LoginModal } from "@/components/LoginModal";
import {
  SampleBrowserPanel,
  type ArrangerSample,
} from "@/components/SampleBrowserPanel";

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
// Paso 4 (rendimiento) — ancho del bloque "esqueleto" que se muestra
// mientras se resuelve el audio real de un clip recién soltado (ver
// PendingDrop). Un valor fijo en segundos de duración ESTIMADA (no en
// píxeles) — así se ve proporcional al zoom actual, igual que un clip real.
const PLACEHOLDER_DURATION_SECONDS = 2;
// Compartido entre el selector de la barra superior y el diálogo de
// "Nuevo Proyecto" (ver TIME_SIGNATURE_PRESETS más abajo).
const TIME_SIGNATURE_PRESETS = ["4/4", "3/4", "2/4", "6/8", "9/8", "12/8", "5/4", "7/8"];

interface ArrangerClip {
  id: string;
  sampleId: string;
  sampleName: string;
  originalBpm: number;
  /** "Loop" | "One-Shot" (ver sampleTaxonomy.ts) — determina si este clip se adapta al tempo del proyecto (ver playbackRateFor). */
  sampleType: string;
  startSeconds: number;
  /** Offset DENTRO de `buffer` (segundos, base de tiempo nativa del buffer) donde arranca lo que suena. */
  sourceOffsetSeconds: number;
  /** Cuánto de `buffer`, desde sourceOffsetSeconds, suena — base de tiempo nativa (no la toca el tempo). */
  sourceDurationSeconds: number;
  /** Volumen propio del clip (1 = sin cambio), independiente del volumen de la pista. */
  gain: number;
  /** Fade-in/out en segundos de LÍNEA DE TIEMPO (ya con el tempo aplicado) — arrastrables desde las esquinas superiores del clip. */
  fadeInSeconds: number;
  fadeOutSeconds: number;
  /**
   * Pitch-shift en semitonos enteros, -12 a +12 (0 = tono original).
   * Independiente del tempo aunque se resuelvan en la MISMA pasada de
   * DSP (ver getProcessedBuffer/audioDsp.ts) — son parámetros
   * separados de la misma llamada, cambiar uno no altera el otro.
   * Motor: signalsmith-stretch (WASM + AudioWorklet, MIT — ver la nota
   * larga en audioDsp.ts sobre por qué no se usó un port de Rubber Band).
   */
  pitchShift: number;
  buffer: AudioBuffer;
  /** Picos sobre el buffer COMPLETO — se recorta la porción visible al dibujar (ver slicePeaksForWindow). */
  peaks: Float32Array;
}

interface ArrangerTrack {
  id: string;
  name: string;
  volume: number;
  pan: number;
  isMuted: boolean;
  isSolo: boolean;
  clips: ArrangerClip[];
  color: string;
}

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
  };
  tracks: ImportManifestTrack[];
}

function computePeaks(buffer: AudioBuffer, numBuckets: number): Float32Array {
  const data = buffer.getChannelData(0);
  const samplesPerBucket = Math.max(1, Math.floor(data.length / numBuckets));
  const peaks = new Float32Array(numBuckets * 2);
  for (let i = 0; i < numBuckets; i++) {
    const start = i * samplesPerBucket;
    const end = Math.min(data.length, start + samplesPerBucket);
    let min = 0;
    let max = 0;
    for (let j = start; j < end; j++) {
      const v = data[j];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    peaks[i * 2] = min;
    peaks[i * 2 + 1] = max;
  }
  return peaks;
}

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

function displayDurationFor(clip: ArrangerClip, projectTempoBpm: number): number {
  return clip.sourceDurationSeconds / playbackRateFor(clip, projectTempoBpm);
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

  const [projectTitle, setProjectTitle] = useState("Nuevo Arreglo");
  const [projectTempoBpm, setProjectTempoBpm] = useState(120);
  // Tipo de compás del proyecto — junto con el BPM, define la grilla
  // musical de la regla (ver rulerTicks) y viaja en el manifest.json
  // exportado (ver handleExport). El motor de reproducción/export en
  // sí NO usa esto para nada más: el posicionamiento real de los
  // clips sigue siendo siempre en segundos (ver REGLA CRÍTICA en
  // handleExport).
  const [timeSignatureNumerator, setTimeSignatureNumerator] = useState(4);
  const [timeSignatureDenominator, setTimeSignatureDenominator] = useState(4);
  const [rulerMode, setRulerMode] = useState<"seconds" | "bars">("seconds");
  const [tracks, setTracks] = useState<ArrangerTrack[]>([]);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(50);

  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [clipboardClip, setClipboardClip] = useState<ArrangerClip | null>(null);
  // Paso 4 (rendimiento) — drops en vuelo, ver PendingDrop.
  const [pendingDrops, setPendingDrops] = useState<PendingDrop[]>([]);
  const [addSampleError, setAddSampleError] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadSeconds, setPlayheadSeconds] = useState(0);

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
  const rulerTicks = useMemo(() => {
    if (rulerMode === "seconds") {
      const count = Math.floor(totalDurationSeconds / 5) + 1;
      return Array.from({ length: count }, (_, i) => ({
        seconds: i * 5,
        label: formatTime(i * 5) as string | null,
        major: true,
      }));
    }

    const secondsPerQuarterNote = 60 / Math.max(1, projectTempoBpm);
    const secondsPerDenomNote = secondsPerQuarterNote * (4 / Math.max(1, timeSignatureDenominator));
    const secondsPerBar = secondsPerDenomNote * Math.max(1, timeSignatureNumerator);
    if (!(secondsPerBar > 0)) return [];

    const MIN_BEAT_TICK_PX = 4;
    const showBeatTicks = secondsPerDenomNote * effectivePixelsPerSecond >= MIN_BEAT_TICK_PX;
    const totalBars = Math.ceil(totalDurationSeconds / secondsPerBar) + 1;

    const ticks: { seconds: number; label: string | null; major: boolean }[] = [];
    for (let bar = 0; bar < totalBars; bar++) {
      const barStartSeconds = bar * secondsPerBar;
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
      return await getOrProcessBuffer(clip.sampleId, clip.buffer, rate, clip.pitchShift);
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

  async function playFrom(fromSeconds: number) {
    const ctx = audioContextRef.current;
    if (!ctx || tracks.length === 0) return;
    if (ctx.state === "suspended") ctx.resume();
    stopAllSources();
    // Se captura DESPUÉS de stopAllSources (que ya incrementó el
    // contador al parar lo anterior) — este es el id "vigente" de ESTA
    // llamada a playFrom.
    const requestId = ++playRequestIdRef.current;

    const clamped = Math.max(0, Math.min(totalDurationSeconds, fromSeconds));
    playheadAtStartRef.current = clamped;

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
        const displayDuration = clip.sourceDurationSeconds / rate;
        if (clip.startSeconds + displayDuration <= clamped) continue;
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
    if (playRequestIdRef.current !== requestId) return;

    // Se captura DESPUÉS del await (no antes) — así todos los clips
    // quedan perfectamente sincronizados entre sí sin importar cuánto
    // tardó el Worker, en vez de arrastrar un "ahora" que ya quedó viejo.
    const startContextTime = ctx.currentTime;
    playStartContextTimeRef.current = startContextTime;

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
      const bufferStart = clip.sourceOffsetSeconds / rate + displayOffset;
      const remainingDuration = displayDuration - displayOffset;
      if (remainingDuration <= 0) continue;
      const when = startContextTime + Math.max(0, clip.startSeconds - clamped);

      const source = ctx.createBufferSource();
      source.buffer = stretchedBuffers[i];
      // playbackRate se queda en 1 (default): el tempo YA está
      // resuelto por el time-stretch — resamplear de nuevo acá
      // volvería a cambiar el tono.
      // Gain POR CLIP (volumen propio + fade in/out), transitorio —
      // se recrea en cada Play igual que la propia fuente, a
      // diferencia del gain/panner de la PISTA que es persistente
      // (ver trackNodesRef más arriba).
      const clipGain = ctx.createGain();
      scheduleGainEnvelope(
        clipGain.gain,
        when,
        displayOffset,
        displayDuration,
        clip.gain,
        clip.fadeInSeconds,
        clip.fadeOutSeconds,
      );
      source.connect(clipGain);
      clipGain.connect(trackNodes.panner);
      source.start(when, bufferStart, remainingDuration);
      sources.push(source);
    }

    activeSourcesRef.current = sources;
    setIsPlaying(true);

    const tick = () => {
      const c = audioContextRef.current;
      if (!c) return;
      const elapsed = c.currentTime - playStartContextTimeRef.current;
      setPlayheadSeconds(Math.min(totalDurationSeconds, playheadAtStartRef.current + elapsed));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    const remaining = Math.max(0, totalDurationSeconds - clamped);
    autoStopTimeoutRef.current = setTimeout(() => {
      stopAllSources();
      setPlayheadSeconds(totalDurationSeconds);
      setIsPlaying(false);
    }, remaining * 1000 + 150);
  }

  function pausePlayback() {
    const ctx = audioContextRef.current;
    if (!ctx) return;
    const elapsed = ctx.currentTime - playStartContextTimeRef.current;
    const pos = Math.min(totalDurationSeconds, playheadAtStartRef.current + elapsed);
    stopAllSources();
    setPlayheadSeconds(pos);
    setIsPlaying(false);
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
      },
    ]);
  }

  function updateTrack(trackId: string, patch: Partial<ArrangerTrack>) {
    setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, ...patch } : t)));
  }

  function deleteTrack(trackId: string) {
    setTracks((prev) => prev.filter((t) => t.id !== trackId));
    setSelectedClipId((prev) => {
      const track = tracks.find((t) => t.id === trackId);
      if (track?.clips.some((c) => c.id === prev)) return null;
      return prev;
    });
  }

  // ─── Agregar samples ─────────────────────────────────────────────────

  function buildClipFromBuffer(sample: ArrangerSample, buffer: AudioBuffer, startSeconds: number): ArrangerClip {
    return {
      id: newId(),
      sampleId: sample.id,
      sampleName: sample.name,
      originalBpm: sample.bpm,
      sampleType: sample.type,
      startSeconds: Math.max(0, startSeconds),
      sourceOffsetSeconds: 0,
      sourceDurationSeconds: buffer.duration,
      gain: 1,
      fadeInSeconds: 0,
      fadeOutSeconds: 0,
      pitchShift: 0,
      buffer,
      peaks: computePeaks(buffer, PEAK_BUCKETS),
    };
  }

  function addClipToTrack(trackId: string, clip: ArrangerClip) {
    setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t)));
    setSelectedClipId(clip.id);
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

      const trackId = newId();
      const trackColor = TRACK_COLORS[tracks.length % TRACK_COLORS.length];
      const clip: ArrangerClip = {
        id: newId(),
        sampleId,
        sampleName: displayName,
        originalBpm: projectTempoBpm,
        sampleType: "Loop",
        startSeconds: Math.max(0, playheadSeconds),
        sourceOffsetSeconds: 0,
        sourceDurationSeconds: buffer.duration,
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
        },
      ]);
      setSelectedClipId(clip.id);
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
        },
      ]);
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

  function deleteSelectedClip() {
    if (!selectedClipId) return;
    setTracks((prev) =>
      prev.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== selectedClipId) })),
    );
    setSelectedClipId(null);
  }

  function copySelectedClip() {
    const found = selectedClipId ? findClip(selectedClipId) : null;
    if (found) setClipboardClip(found.clip);
  }

  function pasteClipboard() {
    if (!clipboardClip) return;
    const targetTrackId = (selectedClipId && findClip(selectedClipId)?.track.id) ?? tracks[0]?.id;
    if (!targetTrackId) return;
    const newClip: ArrangerClip = { ...clipboardClip, id: newId(), startSeconds: playheadSeconds };
    setTracks((prev) =>
      prev.map((t) => (t.id === targetTrackId ? { ...t, clips: [...t.clips, newClip] } : t)),
    );
    setSelectedClipId(newClip.id);
    // Flujo rápido de edición: el cursor salta al FINAL del clip recién
    // pegado — así, pegar el mismo clip varias veces seguidas (Ctrl/Cmd+V
    // repetido) lo encadena en secuencia ininterrumpida, sin tener que
    // reubicar el cursor a mano entre pegada y pegada.
    seekTo(newClip.startSeconds + displayDurationFor(newClip, projectTempoBpm));
  }

  function duplicateSelectedClip() {
    const found = selectedClipId ? findClip(selectedClipId) : null;
    if (!found) return;
    const duration = displayDurationFor(found.clip, projectTempoBpm);
    const newClip: ArrangerClip = {
      ...found.clip,
      id: newId(),
      startSeconds: found.clip.startSeconds + duration,
    };
    setTracks((prev) =>
      prev.map((t) =>
        t.id === found.track.id ? { ...t, clips: [...t.clips, newClip] } : t,
      ),
    );
    setSelectedClipId(newClip.id);
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
      fadeOutSeconds: 0,
    };
    const rightClip: ArrangerClip = {
      ...clip,
      id: newId(),
      startSeconds: playheadSeconds,
      sourceOffsetSeconds: clip.sourceOffsetSeconds + cutOffsetSource,
      sourceDurationSeconds: clip.sourceDurationSeconds - cutOffsetSource,
      fadeInSeconds: 0,
    };

    setTracks((prev) =>
      prev.map((t) =>
        t.id === track.id
          ? { ...t, clips: t.clips.flatMap((c) => (c.id === clip.id ? [leftClip, rightClip] : [c])) }
          : t,
      ),
    );
    setSelectedClipId(rightClip.id);
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
        deleteSelectedClip();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        e.preventDefault();
        copySelectedClip();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        e.preventDefault();
        pasteClipboard();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelectedClip();
      } else if (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "s") {
        // Problema 3 — 'S' corta el clip seleccionado en el cursor.
        e.preventDefault();
        splitSelectedClipAtPlayhead();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClipId, clipboardClip, tracks, projectTempoBpm, playheadSeconds, isPlaying]);

  // ─── Arrastrar un clip existente (mover horizontalmente) ────────────

  function handleClipPointerDown(
    e: React.PointerEvent<HTMLDivElement>,
    trackId: string,
    clip: ArrangerClip,
  ) {
    e.stopPropagation();
    setSelectedClipId(clip.id);
    // Posición exacta (en segundos) del punto donde se tocó DENTRO del
    // clip — currentTarget (no target) para que dé lo mismo clickear
    // el fondo del clip o el <canvas> de la forma de onda de adentro.
    const clipRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const clickSeekSeconds = clip.startSeconds + (e.clientX - clipRect.left) / effectivePixelsPerSecond;
    dragRef.current = {
      trackId,
      clipId: clip.id,
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
      updateClipDragPreview(ev.clientX, ev.clientY);
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
  function updateClipDragPreview(clientX: number, clientY: number) {
    const moveDrag = dragRef.current;
    if (!moveDrag) return;
    moveDrag.lastClientX = clientX;
    moveDrag.lastClientY = clientY;

    const deltaSeconds = (clientX - moveDrag.startClientX) / effectivePixelsPerSecond;
    const rawStart = Math.max(0, moveDrag.originalStartSeconds + deltaSeconds);
    const snapped = computeSnappedStart(moveDrag.clipId, rawStart, moveDrag.displayDuration);
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
  function computeSnappedStart(
    clipId: string,
    rawStartSeconds: number,
    displayDuration: number,
  ): { startSeconds: number; guideSeconds: number | null } {
    const rawStartPx = rawStartSeconds * effectivePixelsPerSecond;
    const durationPx = displayDuration * effectivePixelsPerSecond;

    const candidates: { startPx: number; guidePx: number }[] = [{ startPx: 0, guidePx: 0 }];
    for (const track of tracks) {
      for (const other of track.clips) {
        if (other.id === clipId) continue;
        const otherStartPx = other.startSeconds * effectivePixelsPerSecond;
        const otherEndPx =
          otherStartPx + displayDurationFor(other, projectTempoBpm) * effectivePixelsPerSecond;
        candidates.push({ startPx: otherEndPx, guidePx: otherEndPx }); // mi inicio, pegado al final del otro
        candidates.push({ startPx: otherStartPx - durationPx, guidePx: otherStartPx }); // mi final, pegado al inicio del otro
        candidates.push({ startPx: otherStartPx, guidePx: otherStartPx }); // alinear inicios
        candidates.push({ startPx: otherEndPx - durationPx, guidePx: otherEndPx }); // alinear finales
      }
    }

    let bestStartPx = rawStartPx;
    let bestGuidePx: number | null = null;
    let bestDistancePx = SNAP_THRESHOLD_PX;
    for (const candidate of candidates) {
      if (candidate.startPx < 0) continue;
      const distancePx = Math.abs(candidate.startPx - rawStartPx);
      if (distancePx <= bestDistancePx) {
        bestDistancePx = distancePx;
        bestStartPx = candidate.startPx;
        bestGuidePx = candidate.guidePx;
      }
    }
    return {
      startSeconds: Math.max(0, bestStartPx / effectivePixelsPerSecond),
      guideSeconds: bestGuidePx == null ? null : bestGuidePx / effectivePixelsPerSecond,
    };
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
    });
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
      });
    } else {
      const maxAvailable = trimDrag.original.buffer.duration - trimDrag.original.sourceOffsetSeconds;
      const newDuration = Math.max(
        MIN_SOURCE_DURATION_SECONDS,
        Math.min(maxAvailable, trimDrag.original.sourceDurationSeconds + deltaSourceSeconds),
      );
      setTrimPreview({
        startSeconds: trimDrag.original.startSeconds,
        sourceOffsetSeconds: trimDrag.original.sourceOffsetSeconds,
        sourceDurationSeconds: newDuration,
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
      const keyFor = (clip: ArrangerClip, rate: number) =>
        `${clip.sampleId}::${clip.sourceOffsetSeconds.toFixed(4)}::` +
        `${clip.sourceDurationSeconds.toFixed(4)}::${rate.toFixed(4)}::` +
        `${clip.gain.toFixed(4)}::${clip.fadeInSeconds.toFixed(4)}::${clip.fadeOutSeconds.toFixed(4)}::` +
        `${clip.pitchShift}`;

      const uniqueClips = new Map<string, { clip: ArrangerClip; rate: number }>();
      for (const track of tracks) {
        for (const clip of track.clips) {
          const rate = playbackRateFor(clip, projectTempoBpm);
          const key = keyFor(clip, rate);
          if (!uniqueClips.has(key)) uniqueClips.set(key, { clip, rate });
        }
      }

      const renderedByKey = new Map<
        string,
        { fileName: string; durationSamples: number; sampleRate: number; bytes: Uint8Array }
      >();
      const uniqueEntries = [...uniqueClips.entries()];
      for (let i = 0; i < uniqueEntries.length; i++) {
        const [key, { clip, rate }] = uniqueEntries[i];
        // Mismo buffer YA procesado (tempo + pitch) que usa la
        // reproducción en vivo — el offset/duración de recorte están
        // definidos contra el buffer ORIGINAL, así que se convierten a
        // la base de tiempo del buffer estirado dividiendo por `rate`
        // (idéntico criterio que playFrom, ver más arriba; el pitch no
        // cambia la duración, así que no afecta esta cuenta). En
        // general ya está en caché (ver el useEffect de pre-calentado),
        // así que este await resuelve casi siempre de inmediato.
        const stretchedBuffer = await getProcessedBuffer(clip, rate);
        const rendered = await renderClipToWav(
          stretchedBuffer,
          clip.sourceOffsetSeconds / rate,
          clip.sourceDurationSeconds / rate,
          clip.gain,
          clip.fadeInSeconds,
          clip.fadeOutSeconds,
        );
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
        formatVersion: 1,
        project: {
          title: projectTitle.trim() || "Arreglo sin título",
          tempoBpm: projectTempoBpm,
          // Campos NUEVOS (Paso 1) — project_backup_service.dart del
          // lado Flutter todavía no los lee (solo toma title/tempoBpm
          // de este objeto), así que agregarlos acá es 100%
          // retrocompatible: viajan igual dentro del .mystudio, listos
          // para cuando el motor nativo los soporte.
          timeSignatureNumerator,
          timeSignatureDenominator,
        },
        tracks: tracks.map((track) => ({
          name: track.name,
          volume: track.volume,
          pan: track.pan,
          isMuted: track.isMuted,
          isSolo: track.isSolo,
          clips: track.clips.map((clip) => {
            const rate = playbackRateFor(clip, projectTempoBpm);
            const rendered = renderedByKey.get(keyFor(clip, rate))!;
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
              startBeat: clip.startSeconds,
              durationSamples: rendered.durationSamples,
              sampleRate: rendered.sampleRate,
              // Paso 3 (pitch-shifting) — el audio EN SÍ ya viaja
              // pitcheado (el WAV renderizado usa el buffer procesado
              // por getProcessedBuffer), así que esto es puramente
              // informativo para una futura lectura (Flutter no lo lee
              // todavía, mismo criterio que timeSignatureNumerator/
              // Denominator a nivel de proyecto).
              pitchShift: clip.pitchShift,
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
      const cloudId = doc(collection(db, "users", user.uid, "projects")).id;
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
          cloudVersion: increment(1),
          storagePath,
          sizeBytes: zipBytes.length,
          checksum,
        },
        { merge: true },
      );

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
        // El manifest no guarda de qué sample del Banco salió este
        // WAV (ni tiene BPM de origen) — sin esa referencia no hay
        // rate sensato que calcular, así que se trata como audio
        // "congelado": originalBpm=0 hace que playbackRateFor
        // devuelva 1.0 siempre (nunca se time-stretchea), igual
        // criterio que ya existe para los One-Shot.
        originalBpm: 0,
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
    setSelectedClipId(null);
    setClipboardClip(null);
    setPendingDrops([]);
    setProjectTitle(manifest.project.title || "Proyecto importado");
    setProjectTempoBpm(manifest.project.tempoBpm > 0 ? manifest.project.tempoBpm : 120);
    setTimeSignatureNumerator(manifest.project.timeSignatureNumerator ?? 4);
    setTimeSignatureDenominator(manifest.project.timeSignatureDenominator ?? 4);
    setTracks([]);

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
      };
      setTracks((prev) => [...prev, newTrack]);
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
        });
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
      if (openId) {
        setImportError(null);
        setIsImporting(true);
        setImportProgress(0);
        setImportStage("Descargando proyecto...");
        try {
          const snap = await getDoc(doc(db, "users", user.uid, "projects", openId));
          if (!snap.exists()) throw new Error("No se encontró el proyecto.");
          const storagePath = snap.data().storagePath as string | undefined;
          if (!storagePath) throw new Error("El proyecto no tiene un archivo asociado.");
          const downloadUrl = await getDownloadURL(ref(storage, storagePath));
          const response = await fetch(`/api/download-proxy?url=${encodeURIComponent(downloadUrl)}`);
          if (!response.ok) throw new Error(`No se pudo descargar el archivo (HTTP ${response.status}).`);
          const bytes = await readResponseWithProgress(response, (f) => setImportProgress(f * 0.3));
          await importProjectFromZipBytes(bytes);
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
            },
          ]);
          void addSampleToTrack(sample, trackId, 0);
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

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
  // timeSignature...) — no hay un borrador separado, "Crear Proyecto"
  // simplemente cierra el gate, los valores ya quedaron aplicados.
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
            onClick={() => setShowNewProjectSetup(false)}
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
          {selectedClipId && (
            <div className="flex items-center gap-1.5">
              {(() => {
                const found = findClip(selectedClipId);
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
                const found = findClip(selectedClipId);
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
                const found = findClip(selectedClipId);
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
              <button
                type="button"
                onClick={splitSelectedClipAtPlayhead}
                title="Cortar en el cursor (tecla S)"
                className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:border-white/40"
              >
                Cortar
              </button>
              <button
                type="button"
                onClick={copySelectedClip}
                className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:border-white/40"
              >
                Copiar
              </button>
              <button
                type="button"
                onClick={pasteClipboard}
                disabled={!clipboardClip}
                className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:border-white/40 disabled:opacity-30"
              >
                Pegar
              </button>
              <button
                type="button"
                onClick={duplicateSelectedClip}
                className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:border-white/40"
              >
                Duplicar
              </button>
              <button
                type="button"
                onClick={deleteSelectedClip}
                className="rounded-full border border-red-400/30 px-3 py-1.5 text-xs text-red-300 hover:border-red-400"
              >
                Eliminar
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting || pendingDrops.length > 0 || tracks.every((t) => t.clips.length === 0)}
            className="rounded-full border border-neon-cyan/40 bg-onyx-black px-5 py-2 font-display text-xs font-semibold text-neon-cyan transition-all duration-300 hover:border-neon-cyan hover:shadow-[0_0_18px_rgba(102,252,241,0.4)] disabled:opacity-40"
          >
            {isExporting ? `Exportando... ${Math.round(exportProgress * 100)}%` : "Exportar y Sincronizar"}
          </button>
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
          <SampleBrowserPanel onAddSample={handleQuickAddSample} />
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
            {selectedClipId && (
              <span className="text-[10px] text-white/30">
                Tecla S: cortar en el cursor · Delete: borrar · arrastrá las esquinas superiores para hacer fade
              </span>
            )}
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
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      seekTo((e.clientX - rect.left) / effectivePixelsPerSecond);
                    }}
                  >
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

                {tracks.map((track) => (
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
                      className={`relative flex-1 border-b bg-black/20 transition-colors duration-100 ${
                        dragHoverTrackId === track.id && dragOriginTrackId !== null && dragOriginTrackId !== track.id
                          ? "border-white/10 bg-neon-cyan/10 ring-1 ring-inset ring-neon-cyan/40"
                          : "border-white/10"
                      }`}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => handleTrackDrop(e, track.id)}
                      onPointerMove={handleLanePointerMove}
                      onPointerUp={handleLanePointerUp}
                    >
                      {track.clips.map((clip) => {
                        const isDragging = dragRef.current?.clipId === clip.id;
                        const isTrimming = trimDragRef.current?.clipId === clip.id;
                        const isFading = fadeDragRef.current?.clipId === clip.id;
                        let effective = clip;
                        if (isTrimming && trimPreview) effective = { ...effective, ...trimPreview };
                        if (isFading && fadePreview) effective = { ...effective, ...fadePreview };
                        const startSeconds =
                          isDragging && dragPreviewStartSeconds != null
                            ? dragPreviewStartSeconds
                            : effective.startSeconds;
                        const widthPx = Math.max(
                          3,
                          displayDurationFor(effective, projectTempoBpm) * effectivePixelsPerSecond,
                        );
                        const isSelected = selectedClipId === clip.id;
                        const visiblePeaks = slicePeaksForWindow(
                          clip.peaks,
                          effective.sourceOffsetSeconds,
                          effective.sourceDurationSeconds,
                          clip.buffer.duration,
                        );
                        const fadeInPx = effective.fadeInSeconds * effectivePixelsPerSecond;
                        const fadeOutPx = effective.fadeOutSeconds * effectivePixelsPerSecond;
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
                              opacity: isDragging ? 0.65 : 1,
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
                                    stroke="#fff"
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
                                    stroke="#fff"
                                    strokeWidth={1.5}
                                    opacity={0.85}
                                  />
                                )}
                              </svg>
                            )}
                            <span className="pointer-events-none absolute left-1 top-0.5 truncate text-[9px] font-semibold text-white/80">
                              {clip.sampleName}
                            </span>
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
                            {isSelected && (
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
