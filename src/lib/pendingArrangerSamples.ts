// src/lib/pendingArrangerSamples.ts
//
// Puente entre /samples (el catálogo completo del Banco de Sonidos) y
// /arranger: cuando el usuario selecciona varios samples y toca "Enviar
// al Arranger", no hay forma de pasarle ese array directo por props
// (son dos rutas/páginas distintas) — se deja acá, en una variable de
// MÓDULO (fuera de React, mismo patrón que sampleBufferCache.ts), y el
// Arranger la consume una única vez al montar. Sobrevive a la
// navegación porque Next.js App Router hace un transition del lado del
// cliente (no un reload de página completo) entre rutas de la misma app.

import type { ArrangerSample } from "@/components/SampleBrowserPanel";

let pending: ArrangerSample[] | null = null;

/** Deja encolados los samples elegidos en /samples, antes de navegar a /arranger. */
export function queueSamplesForArranger(samples: ArrangerSample[]): void {
  pending = samples;
}

/** Se consume UNA sola vez — llamadas siguientes devuelven null hasta la próxima queueSamplesForArranger(). */
export function takeQueuedSamplesForArranger(): ArrangerSample[] | null {
  const result = pending;
  pending = null;
  return result;
}
