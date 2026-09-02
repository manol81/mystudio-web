"use client";

// Tarjeta de publicación del Feed de la Comunidad — consume un
// CommunityPost REAL (ver CommunityService.ts), ya no data simulada.
//
// Reproducción: si el post ya tiene `audioPreviewUrl` (el MP3 liviano
// que genera PublishModal al publicar, ver audioPreviewExport.ts), se
// reproduce inline con SamplePlayer — mismo componente y misma
// coordinación "un solo audio sonando a la vez" que ya usa el Banco de
// Sonidos (isActive/onRequestPlay, manejado por el padre en page.tsx).
// Si todavía no existe (se está generando, o falló, o es un post
// publicado antes de esta función), cae de vuelta a abrir el visor
// multipista completo (ProjectViewer) sobre el .mystudio original —
// más pesado, pero siempre funciona.
//
// La "forma de onda" del estado sin preview sigue siendo decorativa —
// se deriva con un hash determinístico del id del post, no de
// Math.random(), para no romper la hidratación SSR/CSR.

import { useState } from "react";
import { Heart, MessageCircle, MoreVertical, ShieldOff, Flag } from "lucide-react";
import { CommentsModal } from "@/components/CommentsModal";
import { ProjectViewer } from "@/components/ProjectViewer";
import { ReportModal } from "@/components/ReportModal";
import { SamplePlayer } from "@/components/SamplePlayer";
import { useAuth } from "@/context/AuthContext";
import {
  blockUser,
  formatRelativeTime,
  toggleLike,
  type CommunityPost,
} from "@/lib/CommunityService";

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

export function PostCard({
  post,
  isLiked,
  onLikeToggled,
  onBlocked,
  isPlaying,
  onRequestPlay,
  commentsCount,
  onCommentAdded,
}: {
  post: CommunityPost;
  isLiked: boolean;
  onLikeToggled: (postId: string, liked: boolean, newLikesCount: number) => void;
  onBlocked: (authorId: string) => void;
  isPlaying: boolean;
  onRequestPlay: () => void;
  commentsCount: number;
  onCommentAdded: (postId: string) => void;
}) {
  const { user } = useAuth();
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const [isLiking, setIsLiking] = useState(false);
  const [playbackSeconds, setPlaybackSeconds] = useState<number | null>(null);
  const [seekRequest, setSeekRequest] = useState<{ seconds: number; nonce: number } | null>(null);
  const hash = hashString(post.id || post.authorId);
  const avatarColor = AVATAR_COLORS[hash % AVATAR_COLORS.length];
  const heights = fakeWaveformHeights(hash);
  const isOwnPost = user?.uid === post.authorId;

  async function handleBlock() {
    if (!user || isBlocking) return;
    setIsBlocking(true);
    try {
      await blockUser(user.uid, post.authorId);
      onBlocked(post.authorId);
    } finally {
      setIsBlocking(false);
      setIsMenuOpen(false);
    }
  }

  async function handleToggleLike() {
    if (!user || isLiking) return;
    setIsLiking(true);
    try {
      const nowLiked = await toggleLike(post.id, user.uid);
      onLikeToggled(post.id, nowLiked, post.likesCount + (nowLiked ? 1 : -1));
    } catch {
      // silencioso — si algo falló, el corazón queda como estaba y el
      // conteo real vuelve a quedar correcto en la próxima carga.
    } finally {
      setIsLiking(false);
    }
  }

  function handleSeekFromComment(seconds: number) {
    onRequestPlay();
    setSeekRequest({ seconds, nonce: Date.now() });
  }

  return (
    <article className="relative flex flex-col gap-4 rounded-2xl border border-white/10 bg-graphite p-5 transition-colors duration-200 hover:border-neon-cyan/30">
      {/* Autor */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold text-onyx-black"
          style={{ backgroundColor: avatarColor }}
        >
          {post.authorName.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{post.authorName}</p>
          <p className="text-xs text-white/40">{formatRelativeTime(post.createdAt)}</p>
        </div>

        {/* Menú de moderación — oculto en las publicaciones propias:
            reportarse/bloquearse a uno mismo no tiene sentido. */}
        {!isOwnPost && user && (
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setIsMenuOpen((prev) => !prev)}
              aria-label="Más opciones"
              className="flex h-7 w-7 items-center justify-center rounded-full text-white/40 transition-colors hover:bg-white/5 hover:text-white"
            >
              <MoreVertical size={16} />
            </button>

            {isMenuOpen && (
              <>
                {/* Backdrop invisible: cualquier click afuera del menú
                    lo cierra, sin necesitar un listener global. */}
                <div className="fixed inset-0 z-10" onClick={() => setIsMenuOpen(false)} />
                <div className="absolute right-0 top-8 z-20 w-48 overflow-hidden rounded-xl border border-white/10 bg-onyx-black shadow-2xl">
                  <button
                    type="button"
                    onClick={() => {
                      setIsMenuOpen(false);
                      setIsReportOpen(true);
                    }}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-xs text-white/70 transition-colors hover:bg-white/5 hover:text-white"
                  >
                    <Flag size={14} /> Reportar publicación
                  </button>
                  <button
                    type="button"
                    onClick={handleBlock}
                    disabled={isBlocking}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-xs text-white/70 transition-colors hover:bg-red-400/10 hover:text-red-300 disabled:opacity-50"
                  >
                    <ShieldOff size={14} />
                    {isBlocking ? "Bloqueando..." : `Bloquear a ${post.authorName}`}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Título de la canción */}
      <div>
        <p className="truncate font-display text-lg font-semibold text-white">{post.title}</p>
        <p className="text-xs uppercase tracking-wide text-white/40">{post.genre}</p>
        {post.description && (
          <p className="mt-1.5 line-clamp-2 text-xs text-white/50">{post.description}</p>
        )}
      </div>

      {/* Reproductor — preview liviano si ya existe, si no, abre el
          visor multipista completo sobre el .mystudio original. */}
      {post.audioPreviewUrl ? (
        <div className="rounded-xl bg-onyx-black px-3 py-3">
          <SamplePlayer
            src={post.audioPreviewUrl}
            isActive={isPlaying}
            onRequestPlay={onRequestPlay}
            onTimeUpdate={setPlaybackSeconds}
            seekRequest={seekRequest}
          />
        </div>
      ) : (
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
      )}

      {/* Interacción */}
      <div className="flex items-center gap-4 text-xs">
        <button
          type="button"
          onClick={handleToggleLike}
          disabled={!user || isLiking}
          aria-label={isLiked ? "Quitar me gusta" : "Me gusta"}
          className={`-ml-1.5 flex items-center gap-1.5 rounded-full px-1.5 py-1 transition-colors duration-200 disabled:cursor-not-allowed ${
            isLiked ? "text-neon-cyan" : "text-white/40 hover:text-white/70"
          }`}
        >
          <Heart size={14} fill={isLiked ? "currentColor" : "none"} /> {post.likesCount}
        </button>

        <button
          type="button"
          onClick={() => setIsCommentsOpen(true)}
          className="flex items-center gap-1.5 rounded-full px-1.5 py-1 text-white/40 transition-colors duration-200 hover:text-white/70"
        >
          <MessageCircle size={14} /> {commentsCount}
        </button>
      </div>

      {isViewerOpen && (
        <ProjectViewer
          projectId={post.id}
          storagePath={post.audioUrl}
          title={post.title}
          onClose={() => setIsViewerOpen(false)}
        />
      )}

      {isReportOpen && user && (
        <ReportModal
          postId={post.id}
          reportedAuthorId={post.authorId}
          reporterId={user.uid}
          onClose={() => setIsReportOpen(false)}
        />
      )}

      {isCommentsOpen && (
        <CommentsModal
          postId={post.id}
          postTitle={post.title}
          currentPlaybackSeconds={playbackSeconds}
          onSeek={handleSeekFromComment}
          onCommentAdded={() => onCommentAdded(post.id)}
          onClose={() => setIsCommentsOpen(false)}
        />
      )}
    </article>
  );
}
