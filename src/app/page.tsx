"use client";

// Comunidad (Feed) — raíz de MY STUDIO Web. El dashboard de proyectos
// que antes vivía acá se mudó a /projects (ver ese archivo).
//
// Ahora consume community_posts REAL (ver CommunityService.ts) con
// scroll infinito paginado por CURSOR: se pide un primer lote, y cada
// lote siguiente arranca después del último doc ya cargado — el costo
// de cada lote es siempre el mismo, sin importar cuánto se scrolleó.
// El disparador es un IntersectionObserver nativo (sin dependencias
// nuevas) sobre un elemento "centinela" invisible al final de la
// lista: cuando entra en el viewport, se pide el próximo lote.

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { LoginModal } from "@/components/LoginModal";
import { PostCard } from "@/components/PostCard";
import {
  fetchBlockedAuthorIds,
  fetchCommunityPostsPage,
  type CommunityPost,
} from "@/lib/CommunityService";
import type { DocumentData, QueryDocumentSnapshot } from "firebase/firestore";

export default function CommunityFeedPage() {
  const { user, loading } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingInitial, setIsLoadingInitial] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [blockedAuthorIds, setBlockedAuthorIds] = useState<Set<string>>(new Set());

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Evita pedir el mismo lote dos veces si dos disparos del observer
  // (o un remount de StrictMode en desarrollo) se solapan antes de que
  // termine de resolver el primer pedido.
  const isFetchingRef = useRef(false);

  const loadInitialPage = useCallback(async () => {
    isFetchingRef.current = true;
    setIsLoadingInitial(true);
    setFeedError(null);
    try {
      const page = await fetchCommunityPostsPage(null);
      setPosts(page.posts);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch (err) {
      setFeedError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingInitial(false);
      isFetchingRef.current = false;
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (isFetchingRef.current || !hasMore) return;
    isFetchingRef.current = true;
    setIsLoadingMore(true);
    try {
      const page = await fetchCommunityPostsPage(cursor);
      setPosts((prev) => [...prev, ...page.posts]);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch (err) {
      setFeedError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingMore(false);
      isFetchingRef.current = false;
    }
  }, [cursor, hasMore]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      await loadInitialPage();
      // Se pide UNA vez al cargar el feed — no en tiempo real: un
      // bloqueo hecho en otra pestaña/sesión recién se refleja la
      // próxima vez que se entra a la Comunidad, no hace falta más.
      try {
        setBlockedAuthorIds(await fetchBlockedAuthorIds(user.uid));
      } catch {
        // si falla, simplemente no se filtra nada — no vale la pena
        // romper el feed entero por esto.
      }
    })();
  }, [user, loadInitialPage]);

  function handlePostBlocked(authorId: string) {
    setBlockedAuthorIds((prev) => new Set(prev).add(authorId));
  }

  const visiblePosts = posts.filter((post) => !blockedAuthorIds.has(post.authorId));

  useEffect(() => {
    if (!user || isLoadingInitial || posts.length === 0) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "300px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [user, isLoadingInitial, posts.length, loadMore]);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-8 px-6 py-12">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Explora la <span className="text-neon-cyan">Comunidad</span>
        </h1>
        <p className="mt-2 text-sm text-white/50">
          Lo que está sonando ahora en MY STUDIO.
        </p>
      </div>

      {loading ? null : user ? (
        <div className="flex flex-col gap-6">
          {isLoadingInitial ? (
            <div className="flex justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-neon-cyan/30 border-t-neon-cyan" />
            </div>
          ) : feedError && posts.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-graphite p-8 text-center">
              <p className="text-sm text-red-400">No se pudo cargar la comunidad.</p>
              <p className="mt-1 text-xs text-white/40">{feedError}</p>
            </div>
          ) : posts.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-graphite p-10 text-center">
              <p className="text-sm text-white/60">
                La comunidad está tranquila hoy. ¡Sé el primero en publicar!
              </p>
            </div>
          ) : (
            <>
              {visiblePosts.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-graphite p-10 text-center">
                  <p className="text-sm text-white/60">
                    No hay nada para mostrar acá — bloqueaste a los autores de este lote.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {visiblePosts.map((post) => (
                    <PostCard key={post.id} post={post} onBlocked={handlePostBlocked} />
                  ))}
                </div>
              )}

              {/* Centinela invisible: al entrar en el viewport dispara la
                  carga del siguiente lote (ver el useEffect de arriba). */}
              <div ref={sentinelRef} className="h-1 w-full" />

              {isLoadingMore && (
                <div className="flex justify-center py-4">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-neon-cyan/30 border-t-neon-cyan" />
                </div>
              )}

              {!hasMore && !isLoadingMore && (
                <p className="pb-4 text-center text-xs text-white/30">
                  Has llegado al final del feed.
                </p>
              )}
            </>
          )}
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
