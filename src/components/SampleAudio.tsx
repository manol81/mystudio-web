"use client";

// El reproductor de la ficha pública de un sample.
//
// Es un <audio> nativo —sin JavaScript propio para reproducir, y suena
// a su velocidad real, que es lo honesto para una ficha— envuelto en la
// mínima capa de cliente que hace falta para registrar que alguien lo
// escuchó. La página es un Server Component y no puede medir nada.
//
// `onPlay` y no `onPlaying`: cuenta la INTENCIÓN de escuchar. Si el
// archivo tarda o falla, esa persona igual quiso oírlo, y eso es lo que
// importa saber.

import { useRef } from "react";
import { samplePreviewed } from "@/lib/analytics";

export function SampleAudio({ sampleId, src }: { sampleId: string; src: string }) {
  // Un solo evento por visita, no uno por cada play/pause: quien
  // escucha tres veces el mismo loop no son tres personas interesadas.
  const logged = useRef(false);

  return (
    <audio
      controls
      preload="none"
      src={src}
      className="w-full"
      onPlay={() => {
        if (logged.current) return;
        logged.current = true;
        samplePreviewed(sampleId);
      }}
    >
      Tu navegador no puede reproducir este audio.
    </audio>
  );
}
