"use client";

// Mini-reproductor de preview para una tarjeta del Banco de Sonidos.
//
// A propósito NO usa decodeAudioData/Web Audio API como ProjectViewer
// — acá no hace falta mezclar pistas ni dibujar waveform, es un único
// archivo en streaming. Un <audio> nativo referenciado (headless, sin
// mostrar los controles del navegador) alcanza y además reproduce
// progresivamente sin esperar a bajar el archivo entero.
//
// Por qué esto NO pasa por /api/download-proxy (a diferencia de
// ProjectViewer): esa ruta existe para esquivar CORS en lecturas por
// JS (fetch/getBytes/decodeAudioData). Un <audio src="..."> en cambio
// es una carga de MEDIA del navegador, igual que un <a href> o un
// <img src> — no dispara CORS porque el navegador nunca expone los
// bytes a JS, solo los reproduce. getDownloadURL() (la llamada al SDK
// que sí hacemos) nunca tuvo el problema; era exclusivo de leer el
// contenido del archivo con fetch/getBytes.
//
// `onTimeUpdate`/`seekRequest` son OPCIONALES — el Banco de Sonidos no
// los usa, solo el Feed de la Comunidad (ver PostCard.tsx), para saber
// en qué segundo comentar y para saltar a un comentario anclado ya
// existente. `seekRequest` lleva un `nonce`, no solo los segundos: así
// tocar el MISMO comentario dos veces seguidas también salta (si solo
// comparara el número de segundos, el efecto no se dispararía la
// segunda vez por ser un valor "igual" al anterior).

import { useEffect, useRef, useState, type MouseEvent } from "react";

export function SamplePlayer({
  src,
  isActive,
  onRequestPlay,
  onTimeUpdate,
  seekRequest,
}: {
  src: string;
  isActive: boolean;
  onRequestPlay: () => void;
  onTimeUpdate?: (currentSeconds: number) => void;
  seekRequest?: { seconds: number; nonce: number } | null;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  // Coordinación "un solo preview sonando a la vez" entre tarjetas: el
  // padre decide cuál es la activa; si esta deja de serlo, se pausa sola.
  useEffect(() => {
    if (!isActive) audioRef.current?.pause();
  }, [isActive]);

  useEffect(() => {
    if (!seekRequest) return;
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seekRequest.seconds;
    onRequestPlay();
    audio.play();
    // Dispara por nonce a propósito, no por el valor de seconds en sí
    // (ver comentario del encabezado) — onRequestPlay solo hace un
    // setState en el padre, no hace falta re-ejecutar el seek si
    // cambia de identidad entre renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekRequest?.nonce]);

  function handleToggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      onRequestPlay();
      audio.play();
    } else {
      audio.pause();
    }
  }

  // Click/tap sobre la barra = saltar a ese punto (y reproducir si
  // estaba pausado). Con preload="none" la duración puede no estar
  // todavía: en ese caso el salto se aplica apenas llega la metadata.
  function handleSeekOnBar(e: MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return; // sin layout (pestaña oculta) — nada que calcular
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const applySeek = () => {
      if (!audio.duration || !Number.isFinite(audio.duration)) return;
      audio.currentTime = ratio * audio.duration;
      setProgress(ratio);
    };
    if (audio.duration && Number.isFinite(audio.duration)) {
      applySeek();
    } else {
      audio.addEventListener("loadedmetadata", applySeek, { once: true });
    }
    if (audio.paused) {
      onRequestPlay();
      audio.play();
    }
  }

  return (
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        onClick={handleToggle}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all duration-200 ${
          isPlaying
            ? "border-neon-cyan bg-neon-cyan/15 text-neon-cyan shadow-[0_0_10px_rgba(102,252,241,0.4)]"
            : "border-white/20 text-white/70 hover:border-neon-cyan/50 hover:text-neon-cyan"
        }`}
        aria-label={isPlaying ? "Pausar preview" : "Reproducir preview"}
      >
        {isPlaying ? (
          <span className="flex gap-[3px]">
            <span className="block h-2.5 w-[3px] bg-current" />
            <span className="block h-2.5 w-[3px] bg-current" />
          </span>
        ) : (
          <span className="ml-0.5 block h-0 w-0 border-y-[5px] border-l-[8px] border-y-transparent border-l-current" />
        )}
      </button>

      {/* Zona de click más alta que la barra visible (py-2) para que
          sea fácil de tocar en el celular sin agrandar el diseño. */}
      <div
        role="slider"
        aria-label="Posición de reproducción"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        tabIndex={0}
        onClick={handleSeekOnBar}
        onKeyDown={(e) => {
          const audio = audioRef.current;
          if (!audio || !audio.duration) return;
          if (e.key === "ArrowRight") audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
          if (e.key === "ArrowLeft") audio.currentTime = Math.max(0, audio.currentTime - 5);
        }}
        className="group flex flex-1 cursor-pointer items-center py-2"
      >
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/10 transition-[height] group-hover:h-1.5">
          <div
            className="h-full rounded-full bg-neon-cyan transition-[width] duration-150"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>

      <audio
        ref={audioRef}
        src={src}
        preload="none"
        className="hidden"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          setProgress(0);
        }}
        onTimeUpdate={(e) => {
          const audio = e.currentTarget;
          if (audio.duration) setProgress(audio.currentTime / audio.duration);
          onTimeUpdate?.(audio.currentTime);
        }}
      />
    </div>
  );
}
