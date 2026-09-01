// src/components/PostCard.tsx
//
// Tarjeta de publicación — TEMPORAL/simulada (Paso 2 de la
// transformación a plataforma de comunidad): ilustra cómo se va a ver
// el feed antes de que exista el backend real (posts, likes, audio
// subido por usuarios). Todo achá adentro es data de mentira, fija —
// nada se lee de Firestore todavía.
//
// La "forma de onda" es un SVG generado con una fórmula determinística
// (seno, con un offset por tarjeta) — a propósito NO usa Math.random():
// un valor aleatorio en cada render rompería la hidratación SSR/CSR
// (el server y el cliente dibujarían formas distintas).

import { Heart, MessageCircle, Play } from "lucide-react";

export interface PostCardData {
  username: string;
  songTitle: string;
  genre: string;
  timeAgo: string;
  likeCount: number;
  commentCount: number;
  /** Cambia la forma de la "onda" y el color del avatar entre tarjetas — puramente estético, sin significado real. */
  seed: number;
}

const AVATAR_COLORS = ["#66FCF1", "#C792EA", "#FFB86C", "#82E0AA"];
const WAVEFORM_BARS = 48;

function fakeWaveformHeights(seed: number): number[] {
  return Array.from({ length: WAVEFORM_BARS }, (_, i) => {
    const t = i / WAVEFORM_BARS;
    // Superposición de un par de senoidales con distinta frecuencia —
    // da un perfil "irregular" creíble en vez de una onda perfecta,
    // sin dejar de ser 100% determinístico (mismo seed = misma forma
    // siempre, tanto en el server como en el cliente).
    const wave =
      Math.sin(t * Math.PI * (4 + seed)) * 0.5 + Math.sin(t * Math.PI * (11 + seed * 2)) * 0.3 + 0.5;
    return Math.max(0.12, Math.min(1, Math.abs(wave)));
  });
}

export function PostCard({ post }: { post: PostCardData }) {
  const heights = fakeWaveformHeights(post.seed);
  const avatarColor = AVATAR_COLORS[post.seed % AVATAR_COLORS.length];

  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-graphite p-5 transition-colors duration-200 hover:border-neon-cyan/30">
      {/* Autor */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold text-onyx-black"
          style={{ backgroundColor: avatarColor }}
        >
          {post.username.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{post.username}</p>
          <p className="text-xs text-white/40">{post.timeAgo}</p>
        </div>
      </div>

      {/* Título de la canción */}
      <div>
        <p className="truncate font-display text-lg font-semibold text-white">{post.songTitle}</p>
        <p className="text-xs uppercase tracking-wide text-white/40">{post.genre}</p>
      </div>

      {/* Reproductor visual — placeholder, no reproduce nada todavía */}
      <div className="flex items-center gap-3 rounded-xl bg-onyx-black px-3 py-3">
        <button
          type="button"
          disabled
          title="Reproducción todavía no disponible — esto es un placeholder"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neon-cyan/15 text-neon-cyan disabled:cursor-not-allowed"
        >
          <Play size={16} className="ml-0.5" fill="currentColor" />
        </button>
        <svg viewBox={`0 0 ${WAVEFORM_BARS * 3} 32`} className="h-8 w-full" preserveAspectRatio="none">
          {heights.map((h, i) => (
            <rect
              key={i}
              x={i * 3}
              y={16 - (h * 28) / 2}
              width={1.6}
              height={h * 28}
              rx={0.8}
              fill={i < WAVEFORM_BARS * 0.3 ? "#66FCF1" : "rgba(255,255,255,0.25)"}
            />
          ))}
        </svg>
      </div>

      {/* Interacción — fija, decorativa */}
      <div className="flex items-center gap-4 text-xs text-white/40">
        <span className="flex items-center gap-1.5">
          <Heart size={14} /> {post.likeCount}
        </span>
        <span className="flex items-center gap-1.5">
          <MessageCircle size={14} /> {post.commentCount}
        </span>
      </div>
    </article>
  );
}
