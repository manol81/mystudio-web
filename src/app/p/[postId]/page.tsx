// /p/[postId] — URL propia de cada publicación de la Comunidad (Fase 0
// del informe "Radiografía MY STUDIO"). Server Component: resuelve el
// <title>/OpenGraph con la API REST de Firestore (lectura pública, sin
// SDK ni service account) para que WhatsApp/Instagram/Google muestren
// título, apodo y la imagen de la publicación al pegar el link. El
// contenido interactivo (audio, likes, comentarios) lo renderiza
// PostPermalink del lado del cliente con el SDK de siempre.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PostPermalink } from "@/components/PostPermalink";
import { fetchPostSummaryFromServer } from "@/lib/serverCommunity";
import { SITE_NAME, SITE_URL } from "@/lib/site";

export const revalidate = 300;

function describe(post: { title: string; authorName: string; genre: string; description: string }): string {
  if (post.description) return post.description;
  const genre = post.genre ? `${post.genre} · ` : "";
  return `${genre}Escuchá "${post.title}" de ${post.authorName} en la Comunidad de ${SITE_NAME}.`;
}

export async function generateMetadata({ params }: PageProps<"/p/[postId]">): Promise<Metadata> {
  const { postId } = await params;
  const post = await fetchPostSummaryFromServer(postId).catch(() => null);
  if (!post) return { title: "Publicación no encontrada", robots: { index: false } };

  const title = `${post.title} — ${post.authorName}`;
  const description = describe(post);
  const url = `${SITE_URL}/p/${postId}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: "music.song", title, description, url, siteName: SITE_NAME },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PostPage({ params }: PageProps<"/p/[postId]">) {
  const { postId } = await params;
  const post = await fetchPostSummaryFromServer(postId).catch(() => null);
  if (!post) notFound();
  return <PostPermalink postId={postId} />;
}
