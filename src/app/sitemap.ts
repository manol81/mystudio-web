import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { fetchRecentPostIdsFromServer } from "@/lib/serverCommunity";

// Rutas públicas + las publicaciones recientes de la Comunidad (leídas
// por REST desde el servidor). Next cachea este archivo; se regenera
// cada hora, suficiente para un feed que crece de a pocas publicaciones.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/samples`, changeFrequency: "weekly", priority: 0.6 },
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

  return [...staticRoutes, ...postRoutes];
}
