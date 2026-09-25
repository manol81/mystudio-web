// src/lib/analytics.ts
//
// Analítica de producto de la WEB (Firebase Analytics / GA4).
//
// ⚠️ GA4 ya estaba instalado (ver firebase.ts): la web venía mandando
// `page_view` desde la Fase 0. Lo que NO existía era un solo evento de
// NEGOCIO, y esa es la diferencia que importa: saber cuánta gente entra
// no dice nada sobre si la web sirve para algo. La pregunta real es
// cuántos de los que llegan terminan bajando la app o creando una
// cuenta — y eso no se medía en ningún lado.
//
// Mismo diseño que `analytics_service.dart` en la app, a propósito:
// una fachada con UN método por evento, nombres fijos en snake_case, y
// los llamadores no arman strings ni objetos sueltos. Sin eso, el mismo
// evento termina en el panel con tres nombres distintos y ninguno sirve.
//
// Qué NO se manda: emails, apodos, títulos de canciones, texto de
// mensajes. Solo identificadores que ya son públicos (el id de un
// sample, el slug de una guía) y conteos — coherente con lo declarado
// en la política de privacidad.
//
// Nada de acá lanza. Un fallo de analítica no puede romper una acción
// real de la persona.

import { analytics } from "@/lib/firebase";

type Params = Record<string, string | number | boolean>;

async function log(name: string, params?: Params): Promise<void> {
  try {
    // `analytics` se resuelve async en el cliente (import diferido +
    // isSupported), así que puede ser null: durante SSR, en las
    // primeras décimas de la carga, o en un navegador donde el SDK no
    // funciona (Safari privado). El evento se pierde, la acción no.
    if (!analytics) return;
    const { logEvent } = await import("firebase/analytics");
    logEvent(analytics, name, params);
  } catch {
    // Sin red, con un bloqueador de rastreo, o Firebase todavía no
    // listo. No se reintenta: un evento perdido no vale una cola.
  }
}

/// De dónde salió el click. Es lo que convierte "23 clicks" en algo
/// accionable: si todos salen de la portada y ninguno de las guías,
/// las guías no están cumpliendo su función.
export type ClickSource =
  | "landing"
  | "guias"
  | "guia"
  | "ayuda"
  | "sample"
  | "post"
  | "sidebar";

// ─── Conversión: de visitante a usuario ────────────────────────────────

/// El click a Google Play. Es LA conversión de la web: todo lo demás
/// —el SEO, las guías, el Banco de Sonidos— existe para que esto pase.
export function playStoreClicked(source: ClickSource): void {
  void log("play_store_click", { source });
}

/// Abrió el formulario de registro (no necesariamente lo completó).
export function signupStarted(source: ClickSource): void {
  void log("signup_started", { source });
}

/// Creó la cuenta de verdad. El par con el anterior da el abandono del
/// formulario, que es donde se pierde gente sin que nadie se entere.
export function signupCompleted(): void {
  void log("signup_completed");
}

export function signinCompleted(): void {
  void log("signin_completed");
}

// ─── Contenido: qué de lo que escribimos sirve ─────────────────────────

/// Se abrió una guía. `slug` y no el título: es corto, estable, y es lo
/// que también aparece en Search Console, así que las dos fuentes se
/// pueden cruzar.
export function guideOpened(slug: string): void {
  void log("guide_opened", { slug });
}

/// Se escuchó la pre-escucha de un sample desde su ficha pública.
export function samplePreviewed(sampleId: string): void {
  void log("sample_previewed", { sample_id: sampleId });
}

/// Se reprodujo una canción de la Comunidad.
export function postPlayed(): void {
  void log("post_played");
}

/// Se abrió el Arranger. Junto con project_saved dice cuánta gente
/// llega a la herramienta y cuánta termina produciendo algo.
export function arrangerOpened(): void {
  void log("arranger_opened");
}

export function projectSaved(): void {
  void log("project_saved");
}
