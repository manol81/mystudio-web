"use client";

// Los picos de un sample, pedidos SOLO cuando su tarjeta se ve de verdad.
//
// El IntersectionObserver es la mitad importante: sin él, montar el
// catálogo dispararía una descarga por sample aunque el usuario nunca
// baje el scroll. Con él, se bajan los que están en pantalla (más un
// margen, para que la onda ya esté dibujada cuando la tarjeta termina
// de entrar) y la cola de samplePeaks.ts se encarga de que no sean más
// de dos a la vez.
//
// Se "arma" una sola vez por tarjeta y después el observer se
// desconecta: volver a pedir los picos al re-entrar en pantalla no
// serviría de nada, ya están cacheados a nivel de módulo.
//
// No hay ningún reset por cambio de `sampleId`, y no es un olvido: las
// listas que usan esto montan una tarjeta por sample con `key={id}`, o
// sea que un cambio de id es un componente nuevo. Meter un `setPeaks`
// en el cuerpo del efecto para cubrir un caso que no ocurre además
// chocaría con `react-hooks/set-state-in-effect`.

import { useEffect, useRef, useState } from "react";
import { CARD_PEAK_BUCKETS, getCachedPeaks, requestPeaks } from "./samplePeaks";

/** Cuánto antes de entrar en pantalla se empieza a pedir el audio. */
const PREFETCH_MARGIN = "200px";

export function useSamplePeaks(sampleId: string, audioPath: string) {
  const elementRef = useRef<HTMLDivElement>(null);
  // Desde la caché en el primer render: si este sample ya se escuchó o
  // se arrastró antes, la onda aparece sin parpadeo y sin red.
  const [peaks, setPeaks] = useState<Float32Array | null>(
    () => getCachedPeaks(sampleId, CARD_PEAK_BUCKETS) ?? null,
  );

  useEffect(() => {
    if (peaks) return; // ya resueltos
    const element = elementRef.current;
    if (!element || !audioPath) return; // sin ruta en Storage no hay de dónde bajarlo

    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void requestPeaks(sampleId, audioPath, CARD_PEAK_BUCKETS).then((result) => {
          if (!cancelled && result) setPeaks(result);
        });
      },
      { rootMargin: PREFETCH_MARGIN },
    );
    observer.observe(element);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [sampleId, audioPath, peaks]);

  return { elementRef, peaks };
}
