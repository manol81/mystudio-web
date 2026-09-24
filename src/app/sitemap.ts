import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import {
  fetchPublicProfileIdsFromServer,
  fetchRecentPostIdsFromServer,
} from "@/lib/serverCommunity";

// Rutas públicas + las publicaciones recientes de la Comunidad (leídas
// por REST desde el servidor). Next cachea este archivo; se regenera
// cada hora, suficiente para un feed que crece de a pocas publicaciones.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
    // /samples NO va acá: el catálogo exige sesión para leerse (ver
    // firestore.rules), así que un buscador solo vería una pantalla
    // vacía. Vuelve el día que la ficha de cada sample sea pública.
    { url: `${SITE_URL}/ayuda`, changeFrequency: "monthly", priority: 0.5 },
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

  return [...staticRoutes, ...postRoutes, ...profileRoutes];
}
