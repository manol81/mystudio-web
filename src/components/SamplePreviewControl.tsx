"use client";

// Botón de pre-escucha + forma de onda + la ficha de cómo va a sonar.
// Lo comparten el catálogo (/samples) y el panel del Arranger, que
// tienen tarjetas de forma muy distinta pero necesitan exactamente el
// mismo comportamiento de audio.
//
// ─── Por qué no usa SamplePlayer ──────────────────────────────────────
//
// SamplePlayer es un `<audio src>` nativo: reproduce en streaming sin
// esperar la descarga completa, y para el feed de la Comunidad (donde
// hay que saber en qué segundo comentar) sigue siendo lo correcto. Pero
// no puede estirar al tempo del proyecto ni transponer, que es
// justamente el punto de todo esto.
//
// La latencia que eso costaría (bajar el archivo entero antes de que
// suene) queda en gran parte cubierta por la forma de onda: para
// dibujarla ya se bajó y decodificó el audio de las tarjetas visibles,
// así que al tocar Play casi siempre ya está en la caché y arranca al
// instante. Las dos funciones se pagan entre sí.

import { useEffect, useRef, useState } from "react";
import {
  camelotLabel,
  isExtremeStretch,
  resolvePreviewTransform,
  type PreviewSpec,
} from "@/lib/sampleAffinity";
import { currentPreviewSampleId, startPreview, stopPreview } from "@/lib/samplePreview";
import { useSamplePeaks } from "@/lib/useSamplePeaks";
import { SampleWaveform } from "@/components/SampleWaveform";

// AudioContext propio para las pantallas que no tienen uno (el
// catálogo). El Arranger pasa el SUYO: sin eso, alinear la pre-escucha
// con el compás que está sonando sería imposible — dos contextos
// distintos tienen relojes distintos y el `currentTime` de uno no
// significa nada para el otro.
//
// Llega como FUNCIÓN y no como valor a propósito. El Arranger crea su
// contexto en un efecto, así que durante el primer render su ref
// todavía es null; si esto recibiera el valor leído en ese render, la
// primera pre-escucha se armaría sobre el contexto de respaldo mientras
// `getSyncContextTime` devuelve instantes del contexto del Arranger —
// dos relojes distintos, y el sample entrando en cualquier lado.
// Pedido en el momento de reproducir, siempre es el que corresponde.
let fallbackContext: AudioContext | null = null;
function resolveContext(preferred: AudioContext | null | undefined): AudioContext {
  if (preferred) return preferred;
  if (!fallbackContext) fallbackContext = new AudioContext();
  return fallbackContext;
}

export interface PreviewSampleInfo extends PreviewSpec {
  name: string;
}

export function SamplePreviewControl({
  sample,
  projectBpm,
  projectKey,
  matchProject,
  isPlaying,
  onRequestPlay,
  onStopped,
  getAudioContext,
  getSyncContextTime,
  color = "#66FCF1",
  waveformHeight = 28,
}: {
  sample: PreviewSampleInfo;
  projectBpm: number | null;
  projectKey: string | null;
  /** false = escuchar el original, tal cual se subió. */
  matchProject: boolean;
  isPlaying: boolean;
  onRequestPlay: () => void;
  onStopped: () => void;
  /** El AudioContext a usar, pedido en el momento de reproducir (ver la nota de resolveContext). */
  getAudioContext?: () => AudioContext | null;
  /** Instante donde cae el próximo compás del arreglo en curso, o null. */
  getSyncContextTime?: () => number | null;
  color?: string;
  waveformHeight?: number;
}) {
  const { elementRef, peaks } = useSamplePeaks(sample.sampleId, sample.audioPath);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);

  const transform = resolvePreviewTransform(sample, {
    matchProject,
    projectBpm,
    projectKey,
  });
  const stretched = Math.abs(transform.rate - 1) > 0.005;
  const transposed = transform.semitones !== 0;
  const extreme = isExtremeStretch(stretched ? transform.rate : null);

  // Al desmontarse (se cerró el panel, cambió el filtro y esta tarjeta
  // salió de la lista) hay que callar lo que esta tarjeta puso a sonar
  // — pero SOLO si sigue siendo lo que suena: si mientras tanto otra
  // tarjeta tomó el relevo, pararla sería matar la de ella.
  useEffect(() => {
    const id = sample.sampleId;
    return () => {
      if (currentPreviewSampleId() === id) stopPreview();
    };
  }, [sample.sampleId]);

  async function beginPreview() {
    setError(false);
    setIsLoading(true);
    onRequestPlay();
    try {
      await startPreview(
        resolveContext(getAudioContext?.()),
        sample,
        {
          matchProject,
          projectBpm,
          projectKey,
          startAtContextTime: getSyncContextTime?.() ?? null,
        },
        onStopped,
      );
    } catch {
      // Un sample que no se puede bajar no justifica un cartel rojo en
      // el medio de la pantalla: se marca en su propia tarjeta y el
      // resto del catálogo sigue funcionando.
      setError(true);
      onStopped();
    } finally {
      setIsLoading(false);
    }
  }

  function handleToggle() {
    if (isPlaying) {
      stopPreview();
      onStopped();
      return;
    }
    void beginPreview();
  }

  // Cambiar entre "al tempo del proyecto" y "original" MIENTRAS suena
  // tiene que escucharse en el acto: es una comparación A/B, y hacer
  // que el usuario pare y vuelva a arrancar la arruina. No se
  // reacciona a los cambios de BPM/tonalidad del proyecto por el mismo
  // motivo invertido: se editan con el teclado, dígito por dígito, y
  // reiniciar en cada tecla sería un tartamudeo.
  const wasMatchingRef = useRef(matchProject);
  useEffect(() => {
    const changed = wasMatchingRef.current !== matchProject;
    wasMatchingRef.current = matchProject;
    if (!changed || !isPlaying) return;
    void beginPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchProject]);

  return (
    <div ref={elementRef} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleToggle();
          }}
          aria-label={isPlaying ? `Parar ${sample.name}` : `Escuchar ${sample.name}`}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors duration-200 ${
            isPlaying
              ? "border-neon-cyan bg-neon-cyan/20 text-neon-cyan"
              : "border-white/20 text-white/60 hover:border-white/50 hover:text-white"
          }`}
        >
          {isLoading ? (
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-neon-cyan" />
          ) : isPlaying ? (
            <span className="block h-2.5 w-2.5 rounded-[1px] bg-current" />
          ) : (
            <span className="ml-0.5 block h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-current" />
          )}
        </button>

        <SampleWaveform
          peaks={peaks}
          color={isPlaying ? color : "rgba(255,255,255,0.35)"}
          heightPx={waveformHeight}
          className="min-w-0 flex-1"
        />
      </div>

      <div className="flex flex-wrap items-center gap-1 text-[10px] leading-none">
        {sample.originalBpm > 0 && (
          <span className="text-white/40">{Math.round(sample.originalBpm)} BPM</span>
        )}
        {camelotLabel(sample.sampleKey) && (
          <span
            className="rounded px-1 py-0.5 text-white/50 ring-1 ring-inset ring-white/15"
            title={`${sample.sampleKey} — código Camelot para mezclar por tonalidad`}
          >
            {camelotLabel(sample.sampleKey)}
          </span>
        )}
        {/* Lo que va a PASARLE al sample, no lo que es. Se muestra solo
            cuando el motor efectivamente lo va a tocar. */}
        {stretched && (
          <span
            className={extreme ? "text-amber-300/90" : "text-neon-cyan/70"}
            title={
              extreme
                ? "El estiramiento es grande y se va a notar — buscá un sample más cerca del tempo del proyecto, o cambiale el BPM original al clip"
                : `Se estira de ${Math.round(sample.originalBpm)} a ${Math.round(projectBpm ?? 0)} BPM`
            }
          >
            ×{transform.rate.toFixed(2)}
            {extreme ? " ⚠" : ""}
          </span>
        )}
        {transposed && (
          <span
            className="text-neon-cyan/70"
            title={`Se transpone ${transform.semitones} semitonos para entrar en la tonalidad del proyecto`}
          >
            {transform.semitones > 0 ? "+" : ""}
            {transform.semitones} st
          </span>
        )}
        {error && <span className="text-red-300/80">no se pudo cargar</span>}
      </div>
    </div>
  );
}
