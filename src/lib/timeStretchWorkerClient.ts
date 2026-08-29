// src/lib/timeStretchWorkerClient.ts
//
// Puente entre el hilo principal y src/workers/timeStretch.worker.ts —
// arma el Worker de forma PEREZOSA (nunca durante SSR: este archivo lo
// importa arranger/page.tsx, un "use client", pero `new Worker(...)`
// solo se ejecuta la primera vez que hace falta, dentro de una
// función, nunca en el scope superior del módulo) y arma el
// request/response por `requestId` ya que postMessage no tiene noción
// de "respuesta a esta llamada en particular".

interface StretchResult {
  left: Float32Array;
  right: Float32Array | null;
  frameCount: number;
}

interface PendingEntry {
  resolve: (result: StretchResult) => void;
  reject: (error: Error) => void;
}

let worker: Worker | null = null;
let requestCounter = 0;
const pending = new Map<string, PendingEntry>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../workers/timeStretch.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (event) => {
    const data = event.data as
      | { type: "stretch-result"; requestId: string; left: Float32Array; right: Float32Array | null; frameCount: number }
      | { type: "stretch-error"; requestId: string; message: string };
    const entry = pending.get(data.requestId);
    if (!entry) return;
    pending.delete(data.requestId);
    if (data.type === "stretch-error") {
      entry.reject(new Error(data.message));
    } else {
      entry.resolve({ left: data.left, right: data.right, frameCount: data.frameCount });
    }
  };
  worker.onerror = (event) => {
    // Un error a nivel del Worker entero (no de un mensaje puntual) —
    // rechaza TODO lo pendiente, si no quedarían promesas colgadas
    // para siempre.
    for (const entry of pending.values()) {
      entry.reject(new Error(event.message || "Error desconocido en el worker de time-stretch"));
    }
    pending.clear();
  };
  return worker;
}

/**
 * Estira `left`/`right` (canales PLANOS, ya copiados por el llamador —
 * ver la nota de "transfer" abajo) al ratio `rate`, preservando el
 * tono, corriendo el DSP en el Worker (fuera del hilo principal).
 */
export function stretchChannelsInWorker(
  left: Float32Array,
  right: Float32Array | null,
  rate: number,
): Promise<StretchResult> {
  const w = getWorker();
  const requestId = `${Date.now()}_${requestCounter++}`;
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    // Transferir (no copiar) los ArrayBuffer hacia el worker es lo que
    // hace esto zero-copy — pero DEJA `left`/`right` INUTILIZABLES en
    // este hilo después de esta llamada. El llamador (timeStretch.ts)
    // ya les pasa COPIAS descartables, nunca los canales originales
    // del AudioBuffer decodificado (que hace falta seguir usando para
    // otros rates).
    const transfer: Transferable[] = [left.buffer];
    if (right) transfer.push(right.buffer);
    w.postMessage({ type: "stretch", requestId, left, right, rate }, transfer);
  });
}
