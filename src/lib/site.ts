// src/lib/site.ts
//
// Identidad pública del sitio — UN solo lugar para el nombre, la URL
// canónica y la descripción que usan metadata, OpenGraph, sitemap y
// robots. Antes cada archivo tenía su propia versión ("My Studio
// Cloud", "MY STUDIO", "My Pocket Studio"...): ver Fase 0 del informe
// "Radiografía MY STUDIO".

export const SITE_NAME = "MY STUDIO";
export const SITE_URL = "https://mystudio-web.vercel.app";
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
