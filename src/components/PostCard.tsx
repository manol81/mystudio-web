"use client";

// Tarjeta de publicación del Feed de la Comunidad — consume un
// CommunityPost REAL (ver CommunityService.ts), ya no data simulada.
//
// "audioUrl" del documento NO es un archivo de audio simple: es la URL
// de descarga del MISMO respaldo .mystudio (ZIP con manifest.json +
// WAVs de cada pista) que ya usa ProjectsDashboard — así que
// reproducirlo requiere el mismo motor multipista que ProjectViewer,
// no un <audio src> plano (que intentaría reproducir un ZIP como si
// fuera un archivo de sonido). Al tocar "Escuchar" se abre exactamente
// ese mismo componente, ya probado.
//
// La "forma de onda" sigue siendo decorativa (no hay picos reales
// hasta que ProjectViewer decodifica el audio adentro del visor) — se
// deriva con un hash determinístico del id del post, no de
// Math.random(), para no romper la hidratación SSR/CSR.

import { useState } from "react";
import { Heart } from "lucide-react";
import { ProjectViewer } from "@/components/ProjectViewer";
import { formatRelativeTime, type CommunityPost } from "@/lib/CommunityService";

const AVATAR_COLORS = ["#66FCF1", "#C792EA", "#FFB86C", "#82E0AA"];
const WAVEFORM_BARS = 40;

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

function fakeWaveformHeights(seed: number): number[] {
  return Array.from({ length: WAVEFORM_BARS }, (_, i) => {
    const t = i / WAVEFORM_BARS;
    const wave =
      Math.sin(t * Math.PI * (4 + (seed % 5))) * 0.5 +
      Math.sin(t * Math.PI * (11 + (seed % 7) * 2)) * 0.3 +
      0.5;
    return Math.max(0.12, Math.min(1, Math.abs(wave)));
  });
}

export function PostCard({ post }: { post: CommunityPost }) {
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const hash = hashString(post.id || post.authorId);
  const avatarColor = AVATAR_COLORS[hash % AVATAR_COLORS.length];
  const heights = fakeWaveformHeights(hash);

  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-graphite p-5 transition-colors duration-200 hover:border-neon-cyan/30">
      {/* Autor */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold text-onyx-black"
          style={{ backgroundColor: avatarColor }}
        >
          {post.authorName.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{post.authorName}</p>
          <p className="text-xs text-white/40">{formatRelativeTime(post.createdAt)}</p>
        </div>
      </div>

      {/* Título de la canción */}
      <div>
        <p className="truncate font-display text-lg font-semibold text-white">{post.title}</p>
        <p className="text-xs uppercase tracking-wide text-white/40">{post.genre}</p>
        {post.description && (
          <p className="mt-1.5 line-clamp-2 text-xs text-white/50">{post.description}</p>
        )}
      </div>

      {/* Reproductor — abre el visor multipista real (ProjectViewer) */}
      <button
        type="button"
        onClick={() => setIsViewerOpen(true)}
        className="flex items-center gap-3 rounded-xl bg-onyx-black px-3 py-3 text-left transition-colors duration-200 hover:bg-white/5"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neon-cyan/15 text-neon-cyan">
          <span className="ml-0.5 block h-0 w-0 border-y-[7px] border-l-[11px] border-y-transparent border-l-current" />
        </span>
        <svg viewBox={`0 0 ${WAVEFORM_BARS * 3} 32`} className="h-8 w-full" preserveAspectRatio="none">
          {heights.map((h, i) => (
            <rect
              key={i}
              x={i * 3}
              y={16 - (h * 28) / 2}
              width={1.6}
              height={h * 28}
              rx={0.8}
              fill="rgba(102,252,241,0.6)"
            />
          ))}
        </svg>
      </button>

      {/* Interacción */}
      <div className="flex items-center gap-4 text-xs text-white/40">
        <span className="flex items-center gap-1.5">
          <Heart size={14} /> {post.likesCount}
        </span>
      </div>

      {isViewerOpen && (
        <ProjectViewer
          projectId={post.id}
          storagePath={post.audioUrl}
          title={post.title}
          onClose={() => setIsViewerOpen(false)}
        />
      )}
    </article>
  );
}
