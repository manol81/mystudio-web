"use client";

// Panel de administrador — moderar publicaciones de la Comunidad.
//
// Por qué existe aparte de /admin/reports: los reportes solo muestran
// lo que ALGUIEN denunció. Esta pantalla lista todo el feed, que es lo
// que hace falta para sacar algo que está mal y que nadie reportó
// todavía (spam, un audio subido por error, una prueba que quedó
// publicada).
//
// El filtro de texto es LOCAL, sobre lo ya cargado: Firestore no sabe
// buscar por subcadena, y montar un índice de búsqueda para una
// pantalla que usa una sola persona sería desproporcionado. Por eso los
// lotes son grandes y hay "Cargar más".

import { useEffect, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import type { DocumentData, QueryDocumentSnapshot } from "firebase/firestore";
import { useAuth } from "@/context/AuthContext";
import { useAdminCheck } from "@/lib/useAdminCheck";
import { deletePostAsAdmin } from "@/lib/AdminService";
import {
  fetchCommunityPostsPage,
  formatRelativeTime,
  type CommunityPost,
} from "@/lib/CommunityService";

const PAGE_SIZE = 30;

export default function AdminPostsPage() {
  const { user } = useAuth();
  const adminCheck = useAdminCheck();

  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Primera página. El estado se toca DESPUÉS del await, no en el
  // cuerpo del efecto: un setState sincrónico ahí encadena renders
  // (mismo patrón que /admin/reports). `cancelled` cubre el caso de
  // desmontar la pantalla con el pedido en vuelo.
  useEffect(() => {
    if (adminCheck !== "authorized") return;
    let cancelled = false;

    (async () => {
      try {
        const page = await fetchCommunityPostsPage(null, PAGE_SIZE);
        if (cancelled) return;
        setPosts(page.posts);
        setCursor(page.cursor);
        setHasMore(page.hasMore);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [adminCheck]);

  async function loadMore() {
    setIsLoading(true);
    setError(null);
    try {
      const page = await fetchCommunityPostsPage(cursor, PAGE_SIZE);
      setPosts((prev) => [...prev, ...page.posts]);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDelete(post: CommunityPost) {
    // Se pide escribir el título en vez de un "¿Estás seguro?": esto
    // borra contenido de otra persona y no se puede deshacer, así que
    // conviene que cueste algo más que un Enter de reflejo.
    const typed = window.prompt(
      `Vas a borrar la publicación de ${post.authorName} con todo lo que cuelga de ella ` +
        `(me gusta, comentarios, pedidos de colaboración y sus mensajes, preview y pistas). ` +
        `No se puede deshacer.\n\nEscribí el título exacto para confirmar:\n${post.title}`,
    );
    if (typed === null) return;
    if (typed.trim() !== post.title.trim()) {
      setError("El título no coincide. No se borró nada.");
      return;
    }

    setError(null);
    setNotice(null);
    setDeletingId(post.id);
    try {
      const r = await deletePostAsAdmin(post);
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
      setNotice(
        `"${post.title}" se borró. ` +
          `${r.likes} me gusta, ${r.comments} comentarios, ` +
          `${r.collabRequests} pedidos de colaboración y ` +
          `${r.storageObjects} archivos de audio.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar la publicación.");
    } finally {
      setDeletingId(null);
    }
  }

  const needle = search.trim().toLowerCase();
  const visible = needle
    ? posts.filter(
        (p) =>
          p.title.toLowerCase().includes(needle) ||
          p.authorName.toLowerCase().includes(needle),
      )
    : posts;

  return (
    <div className="flex min-h-full flex-col items-center gap-8 px-6 py-16">
      <div className="text-center">
        <Link
          href="/admin"
          className="text-xs text-white/40 transition-colors duration-200 hover:text-white/70"
        >
          ← Panel de Admin
        </Link>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Moderar <span className="text-neon-cyan">Publicaciones</span>
        </h1>
      </div>

      {adminCheck === "checking" && <p className="text-xs text-white/40">Verificando permisos...</p>}

      {adminCheck === "signed-out" && (
        <p className="max-w-sm text-sm text-white/60">
          Iniciá sesión desde la página principal para continuar.
        </p>
      )}

      {adminCheck === "unauthorized" && (
        <p className="max-w-sm text-sm text-red-400">
          Tu cuenta ({user?.email}) no tiene permisos de administrador.
        </p>
      )}

      {adminCheck === "authorized" && (
        <div className="flex w-full max-w-3xl flex-col gap-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrar por título o autor…"
            className="w-full rounded-lg border border-white/15 bg-onyx-black px-4 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-200 focus:border-neon-cyan"
          />

          {error && (
            <p className="text-xs text-red-400" role="alert">
              {error}
            </p>
          )}
          {notice && <p className="text-xs text-neon-cyan">{notice}</p>}

          {visible.length === 0 && !isLoading && (
            <p className="py-8 text-center text-xs text-white/30">
              {needle ? "Nada coincide con ese filtro." : "No hay publicaciones."}
            </p>
          )}

          <ul className="flex flex-col gap-2">
            {visible.map((post) => (
              <li
                key={post.id}
                className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-graphite px-4 py-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/p/${post.id}`}
                    target="_blank"
                    className="block truncate text-sm text-white transition-colors duration-200 hover:text-neon-cyan"
                  >
                    {post.title}
                  </Link>
                  <p className="mt-0.5 truncate text-xs text-white/40">
                    {[
                      post.authorName,
                      post.genre,
                      `${post.likesCount} me gusta`,
                      formatRelativeTime(post.createdAt),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleDelete(post)}
                  disabled={deletingId === post.id}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border border-red-400/30 px-3 py-1.5 text-xs text-red-300 transition-colors duration-200 hover:border-red-400 hover:bg-red-400/10 disabled:opacity-50"
                >
                  <Trash2 size={13} />
                  {deletingId === post.id ? "Borrando…" : "Borrar"}
                </button>
              </li>
            ))}
          </ul>

          {isLoading && <p className="text-center text-xs text-white/40">Cargando…</p>}

          {hasMore && !isLoading && (
            <button
              type="button"
              onClick={loadMore}
              className="mx-auto rounded-full border border-white/15 px-5 py-2 text-xs text-white/60 transition-colors duration-200 hover:border-white/40 hover:text-white"
            >
              Cargar más
            </button>
          )}
        </div>
      )}
    </div>
  );
}
