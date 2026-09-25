"use client";

// Registra que se abrió una guía. Las guías son Server Components sin
// una línea de JavaScript propia —a propósito, para que carguen y se
// indexen enteras— así que este es el único pedacito de cliente que
// entra, y no dibuja nada.
//
// Sirve para responder la pregunta que decide si vale la pena escribir
// más: cuál de las guías lee la gente. Search Console dice cuántos
// hicieron click desde Google; esto dice qué pasó después, y cruza con
// play_store_click por el mismo `source`.

import { useEffect } from "react";
import { guideOpened } from "@/lib/analytics";

export function GuideViewTracker({ slug }: { slug: string }) {
  useEffect(() => {
    guideOpened(slug);
    // Solo al montar, y de nuevo si se navega a otra guía sin recargar
    // (el índice enlaza a todas, así que pasa seguido).
  }, [slug]);

  return null;
}
