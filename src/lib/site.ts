// src/lib/site.ts
//
// Identidad pública del sitio — UN solo lugar para el nombre, la URL
// canónica y la descripción que usan metadata, OpenGraph, sitemap y
// robots. Antes cada archivo tenía su propia versión ("My Studio
// Cloud", "MY STUDIO", "My Pocket Studio"...): ver Fase 0 del informe
// "Radiografía MY STUDIO".

export const SITE_NAME = "MY STUDIO";
// Dominio propio desde el 2026-09-24. `mystudio-web.vercel.app` y
// `www.mystudio.rocks` siguen andando: los dos redirigen acá con un 308
// que pone Vercel, así que ningún link viejo se rompe — pero el
// canónico, el sitemap y los OpenGraph tienen que apuntar a UNO solo o
// Google reparte el mismo contenido entre dos direcciones.
export const SITE_URL = "https://mystudio.rocks";
// Título por defecto de la home. NO es `SITE_NAME` a secas, y el
// motivo es el mismo que se razonó para la ficha de Play (ver CLAUDE.md
// sección 7): el título es el campo que más pesa en un buscador, y
// "MY STUDIO" no contiene una sola palabra que alguien escriba. El que
// hay que ganar es a quien busca "grabador multipista".
// Las páginas internas lo sobreescriben y el template les agrega
// " · MY STUDIO".
export const SITE_TITLE = "MY STUDIO — Grabador multipista para Android, en español";
export const SITE_DESCRIPTION =
  "Grabá, mezclá y compartí tu música. Estudio multipista para músicos, en español: app Android + comunidad web.";
export const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.aquiles.mystudio.pocket";

// Proyecto de Firebase — misma config pública que src/lib/firebase.ts.
// Se usa desde el SERVIDOR (generateMetadata de /p/[postId]) vía la
// API REST de Firestore, que respeta las mismas reglas (lectura pública
// de community_posts) sin necesitar el SDK ni una service account.
export const FIREBASE_PROJECT_ID = "my-studio-4530a";
export const FIREBASE_WEB_API_KEY = "AIzaSyBks64A1cGss_t3hGSea_UaHc2VfD-81f0";
