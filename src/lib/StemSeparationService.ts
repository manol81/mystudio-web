// src/lib/StemSeparationService.ts
//
// Separación en stems (voz/batería/bajo/resto) de la mezcla completa
// de un proyecto. Analizado como feature de lead técnico: separar
// stems con calidad real (Demucs y similares) es demasiado pesado
// para correr on-device en un celular, así que la decisión fue
// integrar un proveedor externo (candidato: LALAL.AI API, plan Pro con
// acceso a API + multi-stem) en vez de construir/hostear un modelo
// propio — ver la conversación de diseño para el detalle de las
// alternativas descartadas.
//
// ESTADO ACTUAL: esta es una implementación STUB. Todavía no hay una
// cuenta de LALAL.AI confirmada ni se revisó su ToS para redistribuir
// el resultado a usuarios finales de una app de terceros (mismo tipo
// de chequeo que ya se hizo con LANDR para samples). Hasta que eso se
// confirme, `separateIntoStems` simula el flujo completo (delay +
// progreso) y devuelve la MISMA mezcla repetida como si fueran 4
// stems distintos, para poder construir y probar toda la UI sin
// depender todavía de una API paga.
//
// Cuando se confirme el proveedor: reemplazar el cuerpo de esta
// función por un POST a una nueva ruta /api/stem-split (Next.js API
// route, mismo patrón que /api/download-proxy) que guarde la API key
// del lado del servidor y haga de proxy hacia el proveedor real — la
// key NUNCA debe viajar al cliente. La firma de la función (recibe un
// Blob de audio, devuelve StemResult[]) está pensada para no tener que
// tocar ningún componente de UI en ese momento.

export interface StemResult {
  label: string;
  blob: Blob;
}

const STUB_STEM_LABELS = ["Voz", "Batería", "Bajo", "Resto"];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/// Simula la separación en stems de `mixdownBlob` (la mezcla completa
/// ya renderizada, ver audioPreviewExport.ts). `onProgress` (0-1) cubre
/// el tiempo total de la simulación. Devuelve SIEMPRE la misma mezcla
/// bajo 4 etiquetas — es un stub, no una separación real todavía.
export async function separateIntoStems(
  mixdownBlob: Blob,
  onProgress?: (ratio: number) => void,
): Promise<StemResult[]> {
  const steps = STUB_STEM_LABELS.length;
  for (let i = 0; i < steps; i++) {
    await delay(500);
    onProgress?.((i + 1) / steps);
  }
  return STUB_STEM_LABELS.map((label) => ({ label, blob: mixdownBlob }));
}

export const STEM_SEPARATION_IS_STUB = true;
