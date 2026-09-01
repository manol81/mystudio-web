"use client";

// Comunidad (Feed) — nueva raíz de MY STUDIO Web, primer paso de la
// transformación hacia una plataforma social (ver AppSidebar.tsx para
// el resto de la navegación). El dashboard de proyectos que antes
// vivía acá se mudó a /projects (ver ese archivo).
//
// Paso 2 (temporal): el feed de posts es 100% simulado — PostCard
// recibe data fija, no hay backend de posts/likes/audio subido
// todavía. Es para visualizar cómo va a lucir antes de construir esa
// parte real.

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { LoginModal } from "@/components/LoginModal";
import { PostCard, type PostCardData } from "@/components/PostCard";

const FAKE_POSTS: PostCardData[] = [
  {
    username: "alex_beats",
    songTitle: "Midnight Drive",
    genre: "Lo-Fi · Hip-Hop",
    timeAgo: "hace 2 horas",
    likeCount: 128,
    commentCount: 14,
    seed: 0,
  },
  {
    username: "luna.wave",
    songTitle: "Neon Dreams",
    genre: "Synthwave · EDM",
    timeAgo: "hace 5 horas",
    likeCount: 342,
    commentCount: 27,
    seed: 1,
  },
  {
    username: "sergio_prod",
    songTitle: "Sunset Loop",
    genre: "Cinematic",
    timeAgo: "hace 1 día",
    likeCount: 76,
    commentCount: 6,
    seed: 2,
  },
];

export default function CommunityFeedPage() {
  const { user, loading } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-8 px-6 py-12">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Explora la <span className="text-neon-cyan">Comunidad</span>
        </h1>
        <p className="mt-2 text-sm text-white/50">
          Lo que está sonando ahora en MY STUDIO — pronto vas a poder publicar tus propios arreglos acá.
        </p>
      </div>

      {loading ? null : user ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FAKE_POSTS.map((post) => (
            <PostCard key={post.username} post={post} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 self-center rounded-2xl border border-white/10 bg-graphite p-8 text-center">
          <p className="max-w-sm text-sm text-white/60">
            Iniciá sesión para ver la comunidad, sincronizar tus proyectos y acceder al banco de sonidos.
          </p>
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="rounded-full border border-neon-cyan/40 bg-onyx-black px-6 py-2 font-display text-sm font-semibold text-neon-cyan transition-all duration-300 hover:border-neon-cyan hover:shadow-[0_0_18px_rgba(102,252,241,0.4)]"
          >
            Iniciar Sesión
          </button>
        </div>
      )}

      {isModalOpen && <LoginModal onClose={() => setIsModalOpen(false)} />}
    </div>
  );
}
