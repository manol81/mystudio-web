"use client";

// Project Web Player — vista de solo lectura para escuchar un respaldo
// .mystudio directo desde el navegador, sin pasar por la app. El
// formato es el MISMO que arma ProjectBackupService.exportProject() en
// Flutter: un ZIP con manifest.json (pistas + clips) y los WAV de cada
// clip. Un track puede tener VARIOS clips (Fase 2 de la app) — cada uno
// con su propio audioFileName y startBeat.
//
// Nota sobre startBeat: pese al nombre (herencia de un diseño viejo
// pensado en compases), acá es un offset en SEGUNDOS — mismo criterio
// que documenta CLAUDE.md del lado de Flutter. Se usa tal cual para
// programar cuándo arranca cada clip en el AudioContext.
//
// Nota sobre paneo: NO se usa el StereoPannerNode nativo del navegador
// a propósito — su curva no es exactamente la misma que la fórmula de
// paneo de potencia constante que ya usan el motor nativo (Oboe) y el
// filtro de FFmpeg al exportar (ver native_engine.cpp / CLAUDE.md). Acá
// se reimplementa la MISMA fórmula (theta = (pan+1)*PI/4, leftGain =
// cos(theta)*volume, rightGain = sin(theta)*volume) con dos GainNodes,
// para que sea consistente con cómo suena en el resto del ecosistema.
//
// Sin recorte no destructivo: project_backup_service.dart exporta el
// WAV completo de cada clip, no la ventana recortada (sourceTrimStart/
// DurationFrames no viaja en el manifest) — así que un clip cortado con
// la tijera en la app suena completo acá. Es una limitación real del
// formato .mystudio en sí, no de este componente.
//
// Por qué se descarga vía /api/download-proxy y no con fetch() directo:
// CUALQUIER lectura de Storage hecha por JS en el navegador (getBytes()
// O getDownloadURL() + fetch(), da igual cuál) necesita que el bucket
// tenga CORS configurado explícitamente (gsutil/gcloud) — dos intentos
// reales terminaron en storage/retry-limit-exceeded y después en
// "Failed to fetch". El botón "Descargar" de ProjectsDashboard sí
// funciona con un <a href> normal porque eso es una navegación del
// navegador, no una lectura por JS — nunca pasa por CORS. En vez de
// pedir que se instale el CLI de Google Cloud para configurar el
// bucket, la ruta /api/download-proxy hace el fetch server-to-server
// (Node no tiene restricción de CORS, es un concepto exclusivo del
// navegador) y devuelve los bytes desde nuestro propio origen.
//
// Play/Stop — MISMA semántica que _onStopAll en mixer_screen.dart:
// Stop mientras suena = pausa (el cursor queda donde estaba, no se
// resetea). Stop una SEGUNDA vez sin haber tocado Play en el medio =
// recién ahí vuelve al principio ("stop doble", como cualquier DAW).
// Reimplementado acá con AudioBufferSourceNode.start(when, offset) —
// Web Audio no tiene pause/resume nativo, así que "resumir" es crear
// nodos nuevos arrancando en el offset correcto de cada clip.

import { useCallback, useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import { STEMS_MANIFEST, type StemsManifest } from "@/lib/stemsExport";
import { ref, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";
import {
  projectHasEffects,
  renderProjectMix,
  toAudioBuffer,
  type MixdownTrack,
} from "@/lib/projectMixdown";
import {
  DEFAULT_MASTER_FX,
  NO_TRACK_FX,
  parseMasterFx,
  parseTrackFx,
  type MasterFx,
  type TrackFx,
} from "@/lib/trackEffects";

interface ManifestClip {
  audioFileName: string;
  startBeat: number;
  durationSamples: number;
  sampleRate: number;
}

interface ManifestTrack {
  name: string;
  volume: number;
  pan: number;
  isMuted: boolean;
  isSolo: boolean;
  clips: ManifestClip[];
  // Efectos por pista (formatVersion 2). Ausente en respaldos viejos.
  fx?: unknown;
}

interface Manifest {
  formatVersion: number;
  project: { title: string; tempoBpm: number; masterFx?: unknown };
  tracks: ManifestTrack[];
}

interface DecodedClip {
  startBeat: number;
  buffer: AudioBuffer;
  // null mientras el pico todavía no se calculó (fase de "shadow
  // waveform") — pares [min,max] una vez que sí, ver computePeaks.
  peaks: Float32Array | null;
}

interface RuntimeTrack {
  name: string;
  volume: number;
  pan: number;
  isMuted: boolean;
  isSolo: boolean;
  fx: TrackFx;
  clips: DecodedClip[];
  color: string;
}

interface CachedProject {
  tracks: RuntimeTrack[];
  totalDuration: number;
  master: MasterFx;
  /// Mezcla ya procesada con efectos, o null si el proyecto no tiene
  /// (ver playFrom: sin efectos se reproduce clip por clip como
  /// siempre). Se guarda en la caché de sesión junto con los clips
  /// para no volver a renderizar al reabrir el mismo proyecto.
  renderedMix: AudioBuffer | null;
}

// Caché en memoria de la SESIÓN del navegador (vive fuera del
// componente a propósito, para sobrevivir a que el usuario cierre el
// modal y reabra el mismo proyecto, o navegue entre varios). Guarda los
// AudioBuffers ya decodificados + picos ya calculados — AudioBuffer no
// está atado al AudioContext que lo decodificó (es solo un contenedor
// de PCM), así que es válido reutilizarlo con un AudioContext nuevo en
// cada apertura del visor. Se pierde al recargar la página a propósito:
// no vale la pena persistir buffers de audio grandes en IndexedDB.
const sessionCache = new Map<string, CachedProject>();

// Paleta de acentos por pista — más "premium"/legible que un único
// color plano para todo: cada pista se distingue de un vistazo, mismo
// criterio visual de cualquier DAW real.
const TRACK_COLORS = ["#66FCF1", "#C792EA", "#FFB86C", "#FF6AC1", "#82E0AA", "#7AA2F7"];

const PEAK_BUCKETS = 240;
const ROW_HEIGHT = 48;
const RULER_HEIGHT = 24;

// Ancho de la columna de nombre de pista (w-24 = 96px) + separación
// (gap-3 = 12px) — la regla y el cabezal de reproducción se dibujan
// FUERA de esa columna (mismo criterio que cada fila de pista, que solo
// arranca a dibujar clips después de su propio label), así que tienen
// que conocer ese mismo desplazamiento para alinear con el origen real
// del audio (t=0) en vez del borde izquierdo del contenedor entero.
const LABEL_COLUMN_PX = 96;
const LABEL_GAP_PX = 12;
const TIMELINE_OFFSET_PX = LABEL_COLUMN_PX + LABEL_GAP_PX;

function constantPowerGains(volume: number, pan: number): { left: number; right: number } {
  const theta = (pan + 1.0) * (Math.PI / 4.0);
  return { left: Math.cos(theta) * volume, right: Math.sin(theta) * volume };
}

// Picos min/max por bucket — misma idea que waveform_extractor.dart del
// lado de Flutter, calculado UNA vez por clip al decodificar (no en
// cada render), independiente del ancho final en píxeles.
function computePeaks(buffer: AudioBuffer, numBuckets: number): Float32Array {
  const data = buffer.getChannelData(0); // todo lo grabado en la app es mono
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

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function rulerStep(totalDuration: number, pxPerSecond: number): number {
  const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  return candidates.find((s) => s * pxPerSecond >= 56) ?? 600;
}

// ─── Forma de onda de un clip (canvas) ─────────────────────────────────

function ClipWaveform({
  peaks,
  color,
  widthPx,
  heightPx,
}: {
  peaks: Float32Array | null;
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

    if (!peaks) {
      // "Shadow waveform": todavía no se calcularon los picos reales
      // (el clip ya es audible igual, decodeAudioData ya terminó) — un
      // bloque parejo de baja opacidad ocupando todo el ancho del clip
      // marca el lugar mientras tanto. El redondeo de esquinas lo pone
      // gratis el overflow-hidden del contenedor padre.
      ctx.fillStyle = `${color}33`;
      ctx.fillRect(0, 0, widthPx, heightPx);
      return;
    }

    ctx.fillStyle = color;
    const numBuckets = peaks.length / 2;
    const barWidth = widthPx / numBuckets;
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

  return (
    <canvas
      ref={canvasRef}
      style={{ width: widthPx, height: heightPx }}
      className={peaks ? undefined : "animate-pulse"}
    />
  );
}

// ─── Componente principal ───────────────────────────────────────────────

export function ProjectViewer({
  projectId,
  storagePath,
  stemsUrl,
  title,
  onClose,
}: {
  projectId: string;
  storagePath: string;
  /// Paquete de pistas livianas de la publicación (ver stemsExport.ts).
  /// Cuando existe se usa SIEMPRE, incluso para el autor: pesa una
  /// fracción del proyecto real, se descarga mucho más rápido y es lo
  /// único que puede leer alguien que no sea su dueño.
  stemsUrl?: string | null;
  title: string;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [tracks, setTracks] = useState<RuntimeTrack[]>([]);
  const [totalDuration, setTotalDuration] = useState(0);
  // Mezcla renderizada con efectos (null = proyecto sin efectos, se
  // reproduce por el camino de siempre).
  const [renderedMix, setRenderedMix] = useState<AudioBuffer | null>(null);

  // Escuchar "por dentro" (2026-09): silenciar o destacar pistas
  // mientras suena. Arranca con lo que traía el proyecto y a partir de
  // ahí manda lo que toque el oyente, sin modificar nada del original.
  const [mutedTracks, setMutedTracks] = useState<Set<number>>(new Set());
  const [soloTracks, setSoloTracks] = useState<Set<number>>(new Set());
  // Ganancias vivas por pista, para que silenciar sea instantáneo en
  // los proyectos sin efectos (los que se reproducen clip por clip).
  const trackGainsRef = useRef<Map<number, { left: GainNode; right: GainNode }>>(new Map());
  const [isRerendering, setIsRerendering] = useState(false);
  // Efectos del máster del proyecto, para poder rehacer la mezcla
  // cuando el oyente silencia una pista.
  const masterFxRef = useRef<MasterFx>(DEFAULT_MASTER_FX);
  // Segundo donde retomar después de rehacer la mezcla: playFrom lee
  // renderedMix del estado, que en ese mismo tick todavía es el viejo.
  const pendingResumeRef = useRef<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadSeconds, setPlayheadSeconds] = useState(0);
  const [containerWidth, setContainerWidth] = useState(600);

  const audioContextRef = useRef<AudioContext | null>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const playStartContextTimeRef = useRef(0);
  const playheadAtStartRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const autoStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Declarada acá arriba a propósito: la limpieza del efecto de
  // carga la usa, y el linter de React exige que una función esté
  // declarada antes de quien la referencia.
  function stopAllSources() {
    for (const source of activeSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // ya se había detenido solo (llegó al final del buffer) — no pasa nada
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

  // ─── Carga ──────────────────────────────────────────────────────────────
  // Dos caminos:
  //   1. Caché de sesión (projectId ya abierto antes en esta pestaña):
  //      instantáneo, ni red ni descompresión ni decodificación.
  //   2. Descarga → descomprime → decodifica (fase 1, habilita Play) →
  //      calcula picos en segundo plano, un clip a la vez (fase 2,
  //      reemplaza cada "shadow waveform" por la onda real a medida que
  //      va terminando, sin trabar la reproducción ni la UI).
  useEffect(() => {
    let cancelled = false;
    const peakTimeouts: ReturnType<typeof setTimeout>[] = [];

    async function load() {
      const cached = sessionCache.get(projectId);
      if (cached) {
        const ctx = new AudioContext();
        audioContextRef.current = ctx;
        setTracks(cached.tracks);
        setTotalDuration(cached.totalDuration);
        setRenderedMix(cached.renderedMix);
        setStatus("ready");
        return;
      }

      try {
        if (stemsUrl) {
          await loadFromStems(stemsUrl);
          return;
        }
        const downloadUrl = await getDownloadURL(ref(storage, storagePath));
        const response = await fetch(
          `/api/download-proxy?url=${encodeURIComponent(downloadUrl)}`,
        );
        if (!response.ok) {
          throw new Error(`No se pudo descargar el archivo (HTTP ${response.status}).`);
        }
        const bytes = await response.arrayBuffer();
        const zip = await JSZip.loadAsync(bytes);

        const manifestFile = zip.file("manifest.json");
        if (!manifestFile) {
          throw new Error("El respaldo no tiene manifest.json — archivo inválido.");
        }
        const manifest: Manifest = JSON.parse(await manifestFile.async("string"));

        const ctx = new AudioContext();
        audioContextRef.current = ctx;

        // Fase 1: SOLO decodificar. Es lo mínimo indispensable para que
        // Play funcione — el cálculo de picos (waveform real) queda
        // para la fase 2, en segundo plano.
        const runtimeTracks: RuntimeTrack[] = [];
        for (const track of manifest.tracks) {
          const decodedClips: DecodedClip[] = [];
          for (const clip of track.clips) {
            const audioFile = zip.file(clip.audioFileName);
            if (!audioFile) continue; // clip huérfano, mismo criterio que el export en Flutter
            const arrayBuffer = await audioFile.async("arraybuffer");
            const buffer = await ctx.decodeAudioData(arrayBuffer);
            decodedClips.push({ startBeat: clip.startBeat, buffer, peaks: null });
          }
          runtimeTracks.push({
            name: track.name,
            volume: track.volume,
            pan: track.pan,
            isMuted: track.isMuted,
            isSolo: track.isSolo,
            fx: parseTrackFx(track.fx),
            clips: decodedClips,
            color: TRACK_COLORS[runtimeTracks.length % TRACK_COLORS.length],
          });
        }

        if (cancelled) return;

        const maxEnd = runtimeTracks
          .flatMap((t) => t.clips.map((c) => c.startBeat + c.buffer.duration))
          .reduce((max, end) => Math.max(max, end), 0);

        // Efectos (2026-09): si el proyecto los usa, se renderiza la
        // mezcla entera con el DSP portado del motor (projectMixdown)
        // y se reproduce ESE buffer. Sin efectos, nada cambia: cada
        // clip sigue siendo su propio AudioBufferSourceNode.
        // masterFx llegó al manifest en formatVersion 2.
        const master = manifest.project.masterFx
          ? parseMasterFx(manifest.project.masterFx)
          : DEFAULT_MASTER_FX;
        const mixdownTracks: MixdownTrack[] = runtimeTracks.map((t) => ({
          volume: t.volume,
          pan: t.pan,
          isMuted: t.isMuted,
          isSolo: t.isSolo,
          fx: t.fx,
          clips: t.clips.map((c) => ({ startSeconds: c.startBeat, buffer: c.buffer })),
        }));
        masterFxRef.current = master;
        let mix: AudioBuffer | null = null;
        if (projectHasEffects(mixdownTracks)) {
          const rendered = renderProjectMix(mixdownTracks, master, ctx.sampleRate);
          mix = toAudioBuffer(rendered, ctx, ctx.sampleRate);
        }

        setTracks(runtimeTracks);
        setTotalDuration(maxEnd);
        setRenderedMix(mix);
        setMutedTracks(
          new Set(runtimeTracks.flatMap((t, i) => (t.isMuted ? [i] : []))),
        );
        setSoloTracks(
          new Set(runtimeTracks.flatMap((t, i) => (t.isSolo ? [i] : []))),
        );
        setStatus("ready"); // Play ya funciona acá — todavía con shadow waveforms

        // Fase 2: un clip por vez, en macrotasks separadas (dejan
        // respirar al hilo principal entre cada uno — Play, el
        // cabezal animado y el resto de la UI siguen respondiendo).
        // Se muta `runtimeTracks` in-place para que, al terminar,
        // tenga los picos completos y sirva tal cual para la caché.
        let remaining = runtimeTracks.reduce((sum, t) => sum + t.clips.length, 0);
        if (remaining === 0) {
          sessionCache.set(projectId, {
            tracks: runtimeTracks,
            totalDuration: maxEnd,
            master,
            renderedMix: mix,
          });
        }
        runtimeTracks.forEach((track, ti) => {
          track.clips.forEach((clip, ci) => {
            const timeoutId = setTimeout(() => {
              if (cancelled) return;
              const peaks = computePeaks(clip.buffer, PEAK_BUCKETS);
              runtimeTracks[ti].clips[ci].peaks = peaks;
              setTracks((prev) =>
                prev.map((t, tIdx) =>
                  tIdx !== ti
                    ? t
                    : {
                        ...t,
                        clips: t.clips.map((c, cIdx) =>
                          cIdx !== ci ? c : { ...c, peaks },
                        ),
                      },
                ),
              );
              remaining -= 1;
              if (remaining === 0) {
                // Todos los picos listos: cachear la versión completa
                // para que la próxima apertura de este proyecto, en lo
                // que dure la sesión, sea instantánea y sin sombras.
                sessionCache.set(projectId, {
            tracks: runtimeTracks,
            totalDuration: maxEnd,
            master,
            renderedMix: mix,
          });
              }
            }, 0);
            peakTimeouts.push(timeoutId);
          });
        });
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : String(err));
          setStatus("error");
        }
      }
    }

    /// Carga desde el paquete liviano: un MP3 por pista, todos
    /// alineados desde 0 y con sus efectos, volumen y paneo ya
    /// aplicados. Por eso las pistas quedan con fx neutro y sin
    /// mezcla que renderizar: se reproducen tal cual, y silenciar una
    /// es instantáneo.
    async function loadFromStems(url: string) {
      const response = await fetch(`/api/download-proxy?url=${encodeURIComponent(url)}`);
      if (!response.ok) {
        throw new Error(`No se pudieron descargar las pistas (HTTP ${response.status}).`);
      }
      const zip = await JSZip.loadAsync(await response.arrayBuffer());
      const manifestFile = zip.file(STEMS_MANIFEST);
      if (!manifestFile) throw new Error("El paquete de pistas está incompleto.");
      const manifest: StemsManifest = JSON.parse(await manifestFile.async("string"));

      const ctx = new AudioContext();
      audioContextRef.current = ctx;

      const runtimeTracks: RuntimeTrack[] = [];
      for (const stem of manifest.stems) {
        const file = zip.file(stem.file);
        if (!file) continue;
        const buffer = await ctx.decodeAudioData(await file.async("arraybuffer"));
        runtimeTracks.push({
          name: stem.name,
          volume: 1,
          pan: 0,
          isMuted: false,
          isSolo: false,
          fx: NO_TRACK_FX,
          clips: [{ startBeat: 0, buffer, peaks: null }],
          color: TRACK_COLORS[runtimeTracks.length % TRACK_COLORS.length],
        });
      }

      if (cancelled) return;
      const maxEnd = runtimeTracks.reduce(
        (max, t) => Math.max(max, t.clips[0]?.buffer.duration ?? 0),
        0,
      );
      setTracks(runtimeTracks);
      setTotalDuration(maxEnd || manifest.durationSeconds);
      setRenderedMix(null);
      setMutedTracks(new Set());
      setSoloTracks(new Set());
      setStatus("ready");

      // Picos en segundo plano, igual que en el camino del proyecto
      // completo: Play ya funciona con la forma de onda de sombra.
      runtimeTracks.forEach((track, ti) => {
        const timeoutId = setTimeout(() => {
          if (cancelled) return;
          const clip = track.clips[0];
          if (!clip) return;
          clip.peaks = computePeaks(clip.buffer, PEAK_BUCKETS);
          setTracks((prev) => prev.map((t, i) => (i === ti ? { ...t } : t)));
        }, 0);
        peakTimeouts.push(timeoutId);
      });
    }

    load();

    return () => {
      cancelled = true;
      peakTimeouts.forEach(clearTimeout);
      stopAllSources();
      audioContextRef.current?.close();
      audioContextRef.current = null;
    };
  }, [projectId, storagePath, stemsUrl]);

  // ─── Ajusta el zoom para que el proyecto completo entre en el ancho
  // disponible, sin scroll horizontal — se remide si la ventana cambia
  // de tamaño mientras el modal está abierto.
  useEffect(() => {
    if (status !== "ready") return;
    function measure() {
      if (timelineRef.current) setContainerWidth(timelineRef.current.clientWidth);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [status]);

  // SIN piso mínimo a propósito: un piso (Math.max con una constante)
  // es exactamente lo que rompía "ver la canción completa sin scroll"
  // para audio largo — a partir de cierta duración, el piso forzaba un
  // ancho de contenido MAYOR al del contenedor, y como el timeline usa
  // overflow-x-hidden (deliberado, para nunca tener scroll horizontal),
  // ese excedente quedaba directamente invisible en vez de scrolleable.
  // Dividir el ancho disponible por la duración total SIEMPRE da un
  // ancho de contenido que entra exacto en el contenedor, sin importar
  // cuán larga sea la canción.
  const pxPerSecond =
    totalDuration > 0 ? (containerWidth - TIMELINE_OFFSET_PX) / totalDuration : 40;

  // ─── Motor de reproducción ──────────────────────────────────────────────


  /// Qué pistas suenan según lo que eligió el OYENTE. Misma regla que
  /// el mixer: destacar alguna silencia al resto, y silenciar gana
  /// siempre.
  const isTrackAudible = useCallback(
    (index: number) => {
      if (mutedTracks.has(index)) return false;
      if (soloTracks.size > 0) return soloTracks.has(index);
      return true;
    },
    [mutedTracks, soloTracks],
  );

  /// Silencia o destaca una pista. En un proyecto sin efectos el cambio
  /// es inmediato: se mueve la ganancia del nodo y listo. Con efectos
  /// hay que volver a mezclar, porque el audio procesado vive en un
  /// único buffer ya sumado (el compresor y la reverb dependen de qué
  /// pistas entran, así que no alcanza con bajar un volumen).
  function toggleTrack(index: number, kind: "mute" | "solo") {
    const nextMuted = new Set(mutedTracks);
    const nextSolo = new Set(soloTracks);
    if (kind === "mute") {
      if (nextMuted.has(index)) nextMuted.delete(index);
      else nextMuted.add(index);
    } else {
      if (nextSolo.has(index)) nextSolo.delete(index);
      else nextSolo.add(index);
    }
    setMutedTracks(nextMuted);
    setSoloTracks(nextSolo);

    const audibleWith = (i: number) => {
      if (nextMuted.has(i)) return false;
      if (nextSolo.size > 0) return nextSolo.has(i);
      return true;
    };

    if (!renderedMix) {
      // Sin efectos: basta con mover las ganancias ya conectadas.
      for (const [i, track] of tracks.entries()) {
        const nodes = trackGainsRef.current.get(i);
        if (!nodes) continue;
        const { left, right } = constantPowerGains(track.volume, track.pan);
        const on = audibleWith(i);
        nodes.left.gain.value = on ? left : 0;
        nodes.right.gain.value = on ? right : 0;
      }
      return;
    }

    // Con efectos: rehacer la mezcla con las pistas que quedan y
    // retomar donde estaba sonando.
    void rerenderMix(audibleWith);
  }

  async function rerenderMix(audibleWith: (index: number) => boolean) {
    const ctx = audioContextRef.current;
    if (!ctx) return;
    const wasPlaying = isPlaying;
    const resumeAt = playheadSeconds;
    setIsRerendering(true);
    stopAllSources();
    setIsPlaying(false);
    try {
      const mixdownTracks: MixdownTrack[] = tracks.map((t, i) => ({
        volume: t.volume,
        pan: t.pan,
        // Lo que decidió el oyente reemplaza al mute/solo del proyecto.
        isMuted: !audibleWith(i),
        isSolo: false,
        fx: t.fx,
        clips: t.clips.map((c) => ({ startSeconds: c.startBeat, buffer: c.buffer })),
      }));
      const rendered = renderProjectMix(mixdownTracks, masterFxRef.current, ctx.sampleRate);
      const buffer = toAudioBuffer(rendered, ctx, ctx.sampleRate);
      setRenderedMix(buffer);
      if (wasPlaying) {
        // playFrom lee renderedMix del estado, que todavía no se
        // actualizó en este tick: se reprograma en el efecto de abajo.
        pendingResumeRef.current = resumeAt;
      }
    } catch (err) {
      console.error("No se pudo rehacer la mezcla:", err);
    } finally {
      setIsRerendering(false);
    }
  }

  /// Arranca (o resume) la reproducción desde [fromSeconds]. Para clips
  /// que ya empezaron antes de ese punto, los arranca con un offset
  /// DENTRO de su propio buffer (source.start(when, offset)) — así
  /// "resumir" suena continuo, no vuelve a arrancar el clip desde cero.
  function playFrom(fromSeconds: number) {
    const ctx = audioContextRef.current;
    if (!ctx || tracks.length === 0 || totalDuration <= 0) return;
    if (ctx.state === "suspended") ctx.resume();
    stopAllSources();

    const clamped = Math.max(0, Math.min(totalDuration, fromSeconds));
    const startContextTime = ctx.currentTime;
    playStartContextTimeRef.current = startContextTime;
    playheadAtStartRef.current = clamped;

    const sources: AudioBufferSourceNode[] = [];
    trackGainsRef.current.clear();

    // Proyecto CON efectos: ya está todo mezclado y procesado en un
    // solo buffer estéreo (volumen, paneo, mute/solo, EQ, compresor,
    // reverb y limitador incluidos), así que se reproduce tal cual.
    // Resumir desde el medio es el mismo offset de siempre.
    if (renderedMix) {
      const source = ctx.createBufferSource();
      source.buffer = renderedMix;
      source.connect(ctx.destination);
      source.start(startContextTime, clamped);
      activeSourcesRef.current = [source];
      setIsPlaying(true);
      // La mezcla dura MÁS que el proyecto cuando hay reverb (la cola
      // sigue sonando después de la última nota): el cursor se detiene
      // al final del audio, pero el sonido se deja terminar.
      startPlayheadAnimation(clamped, renderedMix.duration);
      return;
    }

    for (const [index, track] of tracks.entries()) {
      if (track.clips.length === 0) continue;

      const { left, right } = constantPowerGains(track.volume, track.pan);
      // Los nodos se crean SIEMPRE, aunque la pista esté silenciada: así
      // volver a activarla es cambiar una ganancia, sin reprogramar la
      // reproducción ni cortar el audio.
      const audible = isTrackAudible(index);
      const gainL = ctx.createGain();
      gainL.gain.value = audible ? left : 0;
      const gainR = ctx.createGain();
      gainR.gain.value = audible ? right : 0;
      trackGainsRef.current.set(index, { left: gainL, right: gainR });
      const merger = ctx.createChannelMerger(2);
      gainL.connect(merger, 0, 0);
      gainR.connect(merger, 0, 1);
      merger.connect(ctx.destination);

      for (const clip of track.clips) {
        const clipEnd = clip.startBeat + clip.buffer.duration;
        if (clipEnd <= clamped) continue; // ya terminó antes del punto de reanudación

        const bufferOffset = Math.max(0, clamped - clip.startBeat);
        const when = startContextTime + Math.max(0, clip.startBeat - clamped);

        const source = ctx.createBufferSource();
        source.buffer = clip.buffer;
        source.connect(gainL);
        source.connect(gainR);
        source.start(when, bufferOffset);
        sources.push(source);
      }
    }

    activeSourcesRef.current = sources;
    setIsPlaying(true);
    startPlayheadAnimation(clamped, totalDuration);
  }

  /// Anima el cabezal y programa el auto-stop. [audioEndSeconds] puede
  /// ser mayor que `totalDuration` (cola de reverb): el cursor nunca
  /// pasa del final del proyecto, pero el audio se deja terminar.
  function startPlayheadAnimation(fromSeconds: number, audioEndSeconds: number) {
    const tick = () => {
      const c = audioContextRef.current;
      if (!c) return;
      const elapsed = c.currentTime - playStartContextTimeRef.current;
      setPlayheadSeconds(Math.min(totalDuration, playheadAtStartRef.current + elapsed));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    const remaining = Math.max(0, audioEndSeconds - fromSeconds);
    autoStopTimeoutRef.current = setTimeout(() => {
      stopAllSources();
      setPlayheadSeconds(totalDuration);
      setIsPlaying(false);
    }, remaining * 1000 + 150);
  }

  // Retoma la reproducción con la mezcla nueva, una vez que React ya
  // aplicó el buffer rehecho (ver rerenderMix).
  useEffect(() => {
    if (pendingResumeRef.current === null || !renderedMix) return;
    const resumeAt = pendingResumeRef.current;
    pendingResumeRef.current = null;
    queueMicrotask(() => playFrom(resumeAt));
    // playFrom cambia en cada render y agregarlo dispararía el efecto
    // sin parar; lo que importa acá es el buffer nuevo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderedMix]);


  /// Pausa: el cursor queda EXACTAMENTE donde estaba, no se resetea.
  function pausePlayback() {
    const ctx = audioContextRef.current;
    if (!ctx) return;
    const elapsed = ctx.currentTime - playStartContextTimeRef.current;
    const pos = Math.min(totalDuration, playheadAtStartRef.current + elapsed);
    stopAllSources();
    setPlayheadSeconds(pos);
    setIsPlaying(false);
  }

  function handlePlayButton() {
    if (isPlaying) return; // mismo no-op que playAll() si ya está sonando
    playFrom(playheadSeconds);
  }

  /// Mismo comportamiento que _onStopAll en mixer_screen.dart: primer
  /// toque = pausa (conserva posición); si YA estaba pausado/detenido,
  /// un segundo toque recién ahí vuelve al principio.
  function handleStopButton() {
    if (isPlaying) {
      pausePlayback();
    } else {
      setPlayheadSeconds(0);
    }
  }

  function seekTo(seconds: number) {
    const clamped = Math.max(0, Math.min(totalDuration, seconds));
    if (isPlaying) {
      playFrom(clamped); // ya hace stopAllSources() antes de reprogramar
    } else {
      setPlayheadSeconds(clamped);
    }
  }

  function handleTimelinePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Los controles de cada pista (M/S) viven DENTRO de este contenedor,
    // así que su pointerdown burbujea hasta acá. Sin este corte pasaban
    // dos cosas a la vez: el seek los interpretaba como un click en la
    // columna de nombres (x < offset → segundo 0, la canción volvía al
    // principio) y, peor, setPointerCapture se robaba el puntero, con lo
    // cual el pointerup ya no caía sobre el botón y su onClick NUNCA se
    // disparaba. De ahí que silenciar/destacar pareciera no funcionar.
    if ((e.target as HTMLElement).closest("button")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // La columna de nombres tampoco es línea de tiempo: un click ahí no
    // tiene por qué mover el cabezal.
    if (e.clientX - rect.left < TIMELINE_OFFSET_PX) return;
    const target = e.currentTarget;
    const seekFromClientX = (clientX: number) => {
      // TIMELINE_OFFSET_PX: mismo motivo que en la regla/cabezal — el
      // click se mide contra el contenedor ENTERO, pero t=0 arranca
      // recién después de la columna del nombre de pista.
      const x = Math.max(0, clientX - rect.left - TIMELINE_OFFSET_PX);
      seekTo(x / pxPerSecond);
    };
    seekFromClientX(e.clientX);
    target.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => seekFromClientX(ev.clientX);
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  }

  const ticks = totalDuration > 0 ? buildTicks(totalDuration, pxPerSecond) : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-2xl border border-white/10 bg-graphite shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <h2 className="truncate font-display text-lg font-semibold text-white">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white/40 transition-colors hover:text-white"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        {status === "loading" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-neon-cyan/30 border-t-neon-cyan" />
            <p className="text-xs text-white/40">
              Descargando y decodificando el proyecto...
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 px-6 text-center">
            <p className="text-sm text-red-400">
              No se pudo cargar el proyecto.
            </p>
            <p className="text-xs text-white/40">{errorMessage}</p>
          </div>
        )}

        {status === "ready" && (
          <>
            {/* ─── Transporte central ─── */}
            <div className="flex flex-col items-center gap-2 border-b border-white/10 px-6 py-5">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={handlePlayButton}
                  className={`flex h-14 w-14 items-center justify-center rounded-full border transition-all duration-200 ${
                    isPlaying
                      ? "border-neon-cyan bg-neon-cyan/15 text-neon-cyan shadow-[0_0_20px_rgba(102,252,241,0.45)]"
                      : "border-neon-cyan/40 bg-onyx-black text-neon-cyan hover:border-neon-cyan hover:shadow-[0_0_20px_rgba(102,252,241,0.45)]"
                  }`}
                  aria-label="Play"
                >
                  <span className="ml-1 block h-0 w-0 border-y-[9px] border-l-[15px] border-y-transparent border-l-current" />
                </button>
                <button
                  type="button"
                  onClick={handleStopButton}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-onyx-black text-white/70 transition-all duration-200 hover:border-white/50 hover:text-white"
                  aria-label="Stop"
                >
                  <span className="block h-3.5 w-3.5 bg-current" />
                </button>
              </div>
              <p className="font-display text-xs tabular-nums text-white/50">
                {formatTime(playheadSeconds)} / {formatTime(totalDuration)}
              </p>
            </div>

            {/* ─── Línea de tiempo ─── */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-5">
              <div
                ref={timelineRef}
                className="relative w-full cursor-pointer select-none"
                onPointerDown={handleTimelinePointerDown}
              >
                {/* Regla de tiempo — mismo desplazamiento (columna de
                    nombre + gap) que cada fila de pista, para que t=0
                    caiga exactamente donde arrancan los clips, no en el
                    borde izquierdo del contenedor entero. */}
                <div className="flex items-center gap-3" style={{ height: RULER_HEIGHT }}>
                  <div className="w-24 shrink-0" />
                  <div className="relative h-full flex-1">
                    {ticks.map((t) => (
                      <div
                        key={t}
                        className="absolute top-0 flex h-full flex-col items-start"
                        style={{ left: t * pxPerSecond }}
                      >
                        <div className="h-2 w-px bg-white/20" />
                        <span className="mt-0.5 text-[10px] tabular-nums text-white/35">
                          {formatTime(t)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Cabezal de reproducción — atraviesa regla + pistas.
                    Se dibuja relativo al contenedor ENTERO (no a la
                    columna de la derecha), así que necesita el mismo
                    TIMELINE_OFFSET_PX sumado a mano. */}
                <div
                  className="pointer-events-none absolute z-10 w-px bg-neon-cyan shadow-[0_0_6px_rgba(102,252,241,0.8)]"
                  style={{
                    left: TIMELINE_OFFSET_PX + playheadSeconds * pxPerSecond,
                    top: 0,
                    bottom: 0,
                  }}
                >
                  <div className="absolute -left-1 -top-0.5 h-2 w-2 rounded-full bg-neon-cyan" />
                </div>

                <div className="flex flex-col gap-1.5 pt-1">
                  {tracks.map((track, i) => {
                    const audible = isTrackAudible(i);
                    return (
                    <div key={i} className="flex items-center gap-3">
                      <div className="flex w-24 shrink-0 items-center gap-1 truncate text-xs">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: track.color }}
                        />
                        <span className={`truncate ${audible ? "text-white/60" : "text-white/25"}`}>
                          {track.name}
                        </span>
                        {/* Silenciar y destacar, en vivo: escuchar la
                            canción por dentro es lo que diferencia a un
                            proyecto multipista de un archivo de audio. */}
                        <button
                          type="button"
                          onClick={() => toggleTrack(i, "mute")}
                          disabled={isRerendering}
                          title={mutedTracks.has(i) ? "Volver a escuchar" : "Silenciar"}
                          className={`ml-auto rounded px-1 text-[10px] font-bold transition-colors duration-150 disabled:opacity-40 ${
                            mutedTracks.has(i)
                              ? "bg-red-400/20 text-red-300"
                              : "text-white/30 hover:text-white/70"
                          }`}
                        >
                          M
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleTrack(i, "solo")}
                          disabled={isRerendering}
                          title={soloTracks.has(i) ? "Dejar de destacar" : "Escuchar solo esta"}
                          className={`rounded px-1 text-[10px] font-bold transition-colors duration-150 disabled:opacity-40 ${
                            soloTracks.has(i)
                              ? "bg-neon-cyan/20 text-neon-cyan"
                              : "text-white/30 hover:text-white/70"
                          }`}
                        >
                          S
                        </button>
                      </div>
                      <div
                        className="relative rounded bg-onyx-black"
                        style={{ height: ROW_HEIGHT, flex: 1 }}
                      >
                        {track.clips.map((clip, ci) => {
                          const widthPx = Math.max(clip.buffer.duration * pxPerSecond, 3);
                          return (
                            <div
                              key={ci}
                              className="absolute top-1 bottom-1 overflow-hidden rounded-sm border"
                              style={{
                                left: clip.startBeat * pxPerSecond,
                                width: widthPx,
                                backgroundColor: `${track.color}1F`,
                                borderColor: `${track.color}55`,
                              }}
                            >
                              <ClipWaveform
                                peaks={clip.peaks}
                                color={track.color}
                                widthPx={widthPx}
                                heightPx={ROW_HEIGHT - 8}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function buildTicks(totalDuration: number, pxPerSecond: number): number[] {
  const step = rulerStep(totalDuration, pxPerSecond);
  const ticks: number[] = [];
  for (let t = 0; t <= totalDuration; t += step) ticks.push(t);
  return ticks;
}
