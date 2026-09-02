"use client";

// Modal de comentarios de una publicación — estilo SoundCloud: un
// comentario puede anclarse a un segundo exacto del preview MP3 (ver
// CommunityService.ts, campo timestampInAudio). Tocar el sello de
// tiempo de un comentario anclado hace saltar el reproductor de la
// tarjeta a ese punto exacto (vía la prop `onSeek`, implementada en
// PostCard.tsx con el `seekRequest` que ahora acepta SamplePlayer).
//
// `currentPlaybackSeconds` viaja desde PostCard (que lo recibe de
// SamplePlayer vía onTimeUpdate) — si es null, no hay preview
// reproduciéndose todavía y el checkbox de anclar queda deshabilitado;
// no tiene sentido anclar a "el segundo actual" si no hay ningún
// segundo actual.

import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  addComment,
  fetchComments,
  formatRelativeTime,
  type PostComment,
} from "@/lib/CommunityService";

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function CommentsModal({
  postId,
  postTitle,
  currentPlaybackSeconds,
  onSeek,
  onCommentAdded,
  onClose,
}: {
  postId: string;
  postTitle: string;
  currentPlaybackSeconds: number | null;
  onSeek: (seconds: number) => void;
  onCommentAdded: () => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [comments, setComments] = useState<PostComment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [anchorToCurrent, setAnchorToCurrent] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fetched = await fetchComments(postId);
        if (!cancelled) setComments(fetched);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [postId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user || !text.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const timestampInAudio = anchorToCurrent && currentPlaybackSeconds != null ? currentPlaybackSeconds : null;
      await addComment(postId, {
        authorId: user.uid,
        authorName: user.displayName ?? user.email ?? "Usuario",
        text: text.trim(),
        timestampInAudio,
      });
      setComments((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          authorId: user.uid,
          authorName: user.displayName ?? user.email ?? "Usuario",
          text: text.trim(),
          timestampInAudio,
          createdAt: null,
        },
      ]);
      onCommentAdded();
      setText("");
    } catch {
      // el textarea conserva lo escrito — el usuario puede reintentar
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl border border-white/10 bg-graphite shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <h2 className="truncate font-display text-lg font-semibold text-white">💬 {postTitle}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white/40 transition-colors hover:text-white"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <p className="py-8 text-center text-xs text-white/40">Cargando comentarios...</p>
          ) : loadError ? (
            <p className="py-8 text-center text-xs text-red-400">No se pudieron cargar los comentarios.</p>
          ) : comments.length === 0 ? (
            <p className="py-8 text-center text-xs text-white/40">
              Todavía no hay comentarios. ¡Sé el primero!
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {comments.map((comment) => (
                <li key={comment.id} className="flex gap-2.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neon-cyan/15 font-display text-xs font-semibold text-neon-cyan">
                    {comment.authorName.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-xs font-semibold text-white">{comment.authorName}</p>
                      <p className="shrink-0 text-[10px] text-white/30">
                        {formatRelativeTime(comment.createdAt)}
                      </p>
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-white/70">
                      {comment.timestampInAudio != null && (
                        <button
                          type="button"
                          onClick={() => onSeek(comment.timestampInAudio!)}
                          className="mr-1.5 inline-block rounded-full border border-neon-cyan/30 bg-neon-cyan/10 px-1.5 py-0.5 font-display text-[10px] font-semibold text-neon-cyan transition-colors hover:border-neon-cyan"
                        >
                          ▶ {formatTimestamp(comment.timestampInAudio)}
                        </button>
                      )}
                      {comment.text}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {user && (
          <form onSubmit={handleSubmit} className="border-t border-white/10 px-6 py-4">
            <textarea
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Escribí un comentario..."
              className="w-full resize-none rounded-lg border border-white/15 bg-onyx-black px-3 py-2 text-xs text-white placeholder:text-white/30 outline-none transition-colors duration-200 focus:border-neon-cyan focus:shadow-[0_0_0_1px_rgba(102,252,241,0.4)]"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <label
                className={`flex items-center gap-1.5 text-[11px] ${
                  currentPlaybackSeconds == null ? "text-white/25" : "text-white/50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={anchorToCurrent && currentPlaybackSeconds != null}
                  disabled={currentPlaybackSeconds == null}
                  onChange={(e) => setAnchorToCurrent(e.target.checked)}
                  className="accent-neon-cyan"
                />
                {currentPlaybackSeconds != null
                  ? `Anclar a ${formatTimestamp(currentPlaybackSeconds)}`
                  : "Anclar al momento actual (reproducí el preview primero)"}
              </label>
              <button
                type="submit"
                disabled={!text.trim() || isSubmitting}
                className="shrink-0 rounded-full border border-neon-cyan/40 bg-onyx-black px-4 py-1.5 font-display text-xs font-semibold text-neon-cyan transition-all duration-300 hover:border-neon-cyan hover:shadow-[0_0_14px_rgba(102,252,241,0.4)] disabled:opacity-50"
              >
                {isSubmitting ? "..." : "Comentar"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
