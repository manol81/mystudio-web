import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import {
  fetchPublicProfileIdsFromServer,
  fetchRecentPostIdsFromServer,
} from "@/lib/serverCommunity";
import { fetchSamplesFromServer } from "@/lib/serverSamples";
import { GUIDES } from "@/lib/guides";

// Rutas públicas + las publicaciones recientes de la Comunidad (leídas
// por REST desde el servidor). Next cachea este archivo; se regenera
// cada hora, suficiente para un feed que crece de a pocas publicaciones.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/samples`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE_URL}/ayuda`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/guias`, changeFrequency: "weekly", priority: 0.8 },
    // Las guías son contenido propio y estable: la prioridad alta es
    // deliberada, son lo que puede traer gente que todavía no conoce
    // la app.
    ...GUIDES.map((guide) => ({
      url: `${SITE_URL}/guias/${guide.slug}`,
      lastModified: new Date(guide.updated ?? guide.published),
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    { url: `${SITE_URL}/cuenta/eliminar`, changeFrequency: "yearly", priority: 0.2 },
  ];

  let postRoutes: MetadataRoute.Sitemap = [];
  try {
    const posts = await fetchRecentPostIdsFromServer(200);
    postRoutes = posts.map(({ id, createdAt }) => ({
      url: `${SITE_URL}/p/${id}`,
      lastModified: createdAt ?? undefined,
      changeFrequency: "monthly",
      priority: 0.7,
    }));
  } catch {
    // Sin Firestore alcanzable en build: el sitemap sale igual, solo
    // con las rutas estáticas.
  }

  // Los perfiles públicos son páginas de contenido real (apodo,
  // presentación, publicaciones y colaboraciones de esa persona) y
  // crecen solas con cada usuario nuevo. Van en su propio try: que
  // falten los perfiles no puede dejar al sitemap sin las canciones.
  let profileRoutes: MetadataRoute.Sitemap = [];
  try {
    const uids = await fetchPublicProfileIdsFromServer(300);
    profileRoutes = uids.map((uid) => ({
      url: `${SITE_URL}/u/${uid}`,
      changeFrequency: "weekly",
      priority: 0.4,
    }));
  } catch {
    // Mismo criterio que arriba.
  }

  // Una ficha por sample. Es lo que más crece con el tiempo: cada
  // sonido que se sube desde el panel de admin entra acá solo.
  let sampleRoutes: MetadataRoute.Sitemap = [];
  try {
    const samples = await fetchSamplesFromServer();
    sampleRoutes = samples.map((sample) => ({
      url: `${SITE_URL}/samples/${sample.id}`,
      changeFrequency: "monthly",
      priority: 0.5,
    }));
  } catch {
    // Mismo criterio que arriba: que falte una sección no puede dejar
    // al sitemap sin las demás.
  }

  return [...staticRoutes, ...postRoutes, ...profileRoutes, ...sampleRoutes];
}
