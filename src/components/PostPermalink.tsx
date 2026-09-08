"use client";

// Página de UNA publicación (/p/[postId]) — la parte de cliente. El
// Server Component de la ruta ya resolvió título/descripción para
// OpenGraph vía REST (ver serverCommunity.ts); acá se carga el doc
// completo con el SDK (incluye las URLs de audio) y se reutiliza
// PostCard tal cual, con el mismo estado que maneja el feed pero para
// un solo post.

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { LoginModal } from "@/components/LoginModal";
import { PostCard } from "@/components/PostCard";
import {
  fetchCommentCounts,
  fetchCommunityPost,
  fetchLikedPostIds,
  type CommunityPost,
} from "@/lib/CommunityService";

export function PostPermalink({ postId }: { postId: string }) {
  const { user, loading } = useAuth();
  const [post, setPost] = useState<CommunityPost | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [isLiked, setIsLiked] = useState(false);
  const [commentsCount, setCommentsCount] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const uid = user?.uid ?? null;

  useEffect(() => {
    if (loading) return;
    (async () => {
      try {
        const loaded = await fetchCommunityPost(postId);
        if (!loaded) {
          setStatus("missing");
          return;
        }
        const [liked, counts] = await Promise.all([
          uid ? fetchLikedPostIds(uid, [postId]) : Promise.resolve(new Set<string>()),
          fetchCommentCounts([postId]),
        ]);
        setPost(loaded);
        setIsLiked(liked.has(postId));
        setCommentsCount(counts.get(postId) ?? 0);
        setStatus("ready");
      } catch {
        setStatus("error");
      }
    })();
  }, [loading, uid, postId]);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col gap-6 px-6 py-12">
      <Link
        href="/"
        className="inline-flex items-center gap-2 self-start text-xs text-white/50 transition-colors hover:text-neon-cyan"
      >
        <ArrowLeft size={14} /> Volver a la Comunidad
      </Link>

      {status === "loading" && (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-neon-cyan/30 border-t-neon-cyan" />
        </div>
      )}

      {status === "missing" && (
        <div className="rounded-2xl border border-white/10 bg-graphite p-10 text-center">
          <p className="text-sm text-white/60">Esta publicación ya no está disponible.</p>
        </div>
      )}

      {status === "error" && (
        <div className="rounded-2xl border border-white/10 bg-graphite p-10 text-center">
          <p className="text-sm text-red-400">No se pudo cargar la publicación. Probá de nuevo.</p>
        </div>
      )}

      {status === "ready" && post && (
        <PostCard
          post={post}
          isLiked={isLiked}
          onLikeToggled={(_, liked, newCount) => {
            setIsLiked(liked);
            setPost((prev) => (prev ? { ...prev, likesCount: newCount } : prev));
          }}
          onBlocked={() => setStatus("missing")}
          isPlaying={isPlaying}
          onRequestPlay={() => setIsPlaying(true)}
          commentsCount={commentsCount}
          onCommentAdded={() => setCommentsCount((n) => n + 1)}
          onRequireLogin={() => setIsModalOpen(true)}
        />
      )}

      {isModalOpen && <LoginModal onClose={() => setIsModalOpen(false)} />}
    </div>
  );
}
