"use client";

// Comunidad (Feed) — raíz de MY STUDIO Web. El dashboard de proyectos
// que antes vivía acá se mudó a /projects (ver ese archivo).
//
// PÚBLICO desde la Fase 0 del informe "Radiografía MY STUDIO": las
// reglas de Firestore ya permitían leer community_posts sin sesión,
// pero esta pantalla no cargaba nada sin `user` — quien llegaba desde
// Google o un link compartido veía solo un botón de login. Ahora el
// feed se lee siempre; la sesión hace falta únicamente para
// interactuar (like, comentar, publicar, reportar). Un visitante ve
// además un encabezado de presentación con el link a Play Store.
//
// Consume community_posts REAL (ver CommunityService.ts) con scroll
// infinito paginado por CURSOR: se pide un primer lote, y cada lote
// siguiente arranca después del último doc ya cargado — el costo de
// cada lote es siempre el mismo, sin importar cuánto se scrolleó. El
// disparador es un IntersectionObserver nativo sobre un elemento
// "centinela" invisible al final de la lista.

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { LoginModal } from "@/components/LoginModal";
import { PostCard } from "@/components/PostCard";
import { VisitorHero } from "@/components/VisitorHero";
import { fetchFollowingUids } from "@/lib/PublicProfileService";
import { COLLAB_ROLES } from "@/lib/collabRoles";
import {
  fetchBlockedAuthorIds,
  fetchCommentCounts,
  fetchCommunityPostsPage,
  fetchPostsByAuthors,
  fetchPostsByWantedRole,
  fetchLikedPostIds,
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
  const [likedPostIds, setLikedPostIds] = useState<Set<string>>(new Set());
  const [playingPostId, setPlayingPostId] = useState<string | null>(null);
  const [commentCounts, setCommentCounts] = useState<Map<string, number>>(new Map());

  // Solapa del feed. "following" no pagina: trae de una las
  // publicaciones de a quiénes seguís, que por definición son muchas
  // menos que el feed completo (ver fetchPostsByAuthors).
  const [feedMode, setFeedMode] = useState<"all" | "following" | "collabs">("all");
  // Filtro de "dónde puedo tocar": null = todas las que buscan a
  // alguien, o un instrumento concreto.
  const [wantedRole, setWantedRole] = useState<string | null>(null);
  const [collabPosts, setCollabPosts] = useState<CommunityPost[] | null>(null);
  const [isLoadingCollabs, setIsLoadingCollabs] = useState(false);
  const [collabError, setCollabError] = useState<string | null>(null);
  const [followingPosts, setFollowingPosts] = useState<CommunityPost[] | null>(null);
  const [isLoadingFollowing, setIsLoadingFollowing] = useState(false);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Evita pedir el mismo lote dos veces si dos disparos del observer
  // (o un remount de StrictMode en desarrollo) se solapan antes de que
  // termine de resolver el primer pedido.
  const isFetchingRef = useRef(false);

  // Los likes son por usuario: sin sesión no hay nada que pedir. Los
  // conteos de comentarios sí son públicos.
  const uid = user?.uid ?? null;

  const loadInitialPage = useCallback(async () => {
    isFetchingRef.current = true;
    setIsLoadingInitial(true);
    setFeedError(null);
    try {
      const page = await fetchCommunityPostsPage(null);
      setPosts(page.posts);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
      const postIds = page.posts.map((p) => p.id);
      const [liked, counts] = await Promise.all([
        uid ? fetchLikedPostIds(uid, postIds) : Promise.resolve(new Set<string>()),
        fetchCommentCounts(postIds),
      ]);
      setLikedPostIds(liked);
      setCommentCounts(counts);
    } catch (err) {
      setFeedError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingInitial(false);
      isFetchingRef.current = false;
    }
  }, [uid]);

  const loadMore = useCallback(async () => {
    if (isFetchingRef.current || !hasMore) return;
    isFetchingRef.current = true;
    setIsLoadingMore(true);
    try {
      const page = await fetchCommunityPostsPage(cursor);
      setPosts((prev) => [...prev, ...page.posts]);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
      const postIds = page.posts.map((p) => p.id);
      const [liked, counts] = await Promise.all([
        uid ? fetchLikedPostIds(uid, postIds) : Promise.resolve(new Set<string>()),
        fetchCommentCounts(postIds),
      ]);
      setLikedPostIds((prev) => new Set([...prev, ...liked]));
      setCommentCounts((prev) => new Map([...prev, ...counts]));
    } catch (err) {
      setFeedError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingMore(false);
      isFetchingRef.current = false;
    }
  }, [cursor, hasMore, uid]);

  // Se espera a que Auth resuelva (loading=false) antes del primer lote
  // para no cargar el feed dos veces (una como visitante y otra ya con
  // sesión restaurada) — un instante de spinner, nunca un doble pedido.
  useEffect(() => {
    if (loading) return;
    (async () => {
      await loadInitialPage();
      if (!uid) {
        setBlockedAuthorIds(new Set());
        return;
      }
      // Se pide UNA vez al cargar el feed — no en tiempo real: un
      // bloqueo hecho en otra pestaña/sesión recién se refleja la
      // próxima vez que se entra a la Comunidad, no hace falta más.
      try {
        setBlockedAuthorIds(await fetchBlockedAuthorIds(uid));
      } catch {
        // si falla, simplemente no se filtra nada — no vale la pena
        // romper el feed entero por esto.
      }
    })();
  }, [loading, uid, loadInitialPage]);

  function handlePostBlocked(authorId: string) {
    setBlockedAuthorIds((prev) => new Set(prev).add(authorId));
  }

  function handleLikeToggled(postId: string, liked: boolean, newLikesCount: number) {
    setLikedPostIds((prev) => {
      const next = new Set(prev);
      if (liked) next.add(postId);
      else next.delete(postId);
      return next;
    });
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, likesCount: newLikesCount } : p)));
  }

  function handleCommentAdded(postId: string) {
    setCommentCounts((prev) => {
      const next = new Map(prev);
      next.set(postId, (next.get(postId) ?? 0) + 1);
      return next;
    });
  }

  // Carga perezosa de la solapa "Siguiendo": recién al entrar, y una
  // sola vez por visita a la página.
  useEffect(() => {
    if (feedMode !== "following" || !user || followingPosts !== null) return;
    let cancelled = false;
    queueMicrotask(() => setIsLoadingFollowing(true));
    void (async () => {
      try {
        const uids = await fetchFollowingUids(user.uid);
        const list = await fetchPostsByAuthors(uids);
        if (!cancelled) setFollowingPosts(list);
      } catch (err) {
        console.error("No se pudo cargar el feed de seguidos:", err);
        if (!cancelled) setFollowingPosts([]);
      } finally {
        if (!cancelled) setIsLoadingFollowing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [feedMode, user, followingPosts]);

  // Solapa de colaboraciones: sin instrumento elegido se filtran en el
  // cliente las publicaciones ya cargadas que piden algo; con uno
  // elegido se consulta por ese rol, que es lo que hace útil el filtro
  // para quien toca un instrumento concreto.
  useEffect(() => {
    if (feedMode !== "collabs") return;
    let cancelled = false;
    if (!wantedRole) {
      queueMicrotask(() => setCollabPosts(posts.filter((p) => p.wantedRoles.length > 0)));
      return;
    }
    queueMicrotask(() => {
      setIsLoadingCollabs(true);
      setCollabError(null);
    });
    void (async () => {
      try {
        const list = await fetchPostsByWantedRole(wantedRole);
        if (!cancelled) setCollabPosts(list);
      } catch (err) {
        console.error("No se pudieron cargar las colaboraciones:", err);
        if (!cancelled) {
          setCollabPosts([]);
          // Un índice recién creado tarda unos minutos en construirse y
          // hasta entonces Firestore rechaza la consulta. Sin este
          // mensaje, el fallo se vería igual que "no hay nada", que es
          // justo la conclusión equivocada.
          setCollabError(
            (err as { code?: string }).code === "failed-precondition"
              ? "El buscador se está preparando. Probá de nuevo en unos minutos."
              : "No se pudo buscar por instrumento. Probá de nuevo en un momento.",
          );
        }
      } finally {
        if (!cancelled) setIsLoadingCollabs(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [feedMode, wantedRole, posts]);

  const sourcePosts =
    feedMode === "following"
      ? (followingPosts ?? [])
      : feedMode === "collabs"
        ? (collabPosts ?? [])
        : posts;
  const visiblePosts = sourcePosts.filter((post) => !blockedAuthorIds.has(post.authorId));

  useEffect(() => {
    if (isLoadingInitial || posts.length === 0) return;
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
  }, [isLoadingInitial, posts.length, loadMore]);

  const requireLogin = () => setIsModalOpen(true);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-8 px-6 py-12">
      {!loading && !user && <VisitorHero onCreateAccount={requireLogin} />}

      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
          {user ? (
            <>
              Explora la <span className="text-neon-cyan">Comunidad</span>
            </>
          ) : (
            <>
              Lo que está <span className="text-neon-cyan">sonando ahora</span>
            </>
          )}
        </h1>
        <p className="mt-2 text-sm text-white/50">
          {user
            ? "Lo que está sonando ahora en MY STUDIO."
            : "Arreglos publicados por músicos de la Comunidad. Escuchalos sin cuenta; para comentar o dar like, iniciá sesión."}
        </p>
      </div>

      {/* Solapas del feed. "Buscan músicos" se muestra SIEMPRE, incluso
          sin cuenta: es la puerta de entrada para alguien que llega
          buscando dónde tocar. "Siguiendo" necesita sesión, porque sin
          cuenta no hay a quién seguir. */}
      <div className="flex gap-1 border-b border-white/10">
        {(
          [
            ["all", "Todo"],
            ["collabs", "Buscan músicos"],
            ...(user ? ([["following", "Siguiendo"]] as const) : []),
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFeedMode(value)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors duration-200 ${
              feedMode === value
                ? "border-neon-cyan text-neon-cyan"
                : "border-transparent text-white/50 hover:text-white/80"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {feedMode === "collabs" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-white/40">Tocás:</span>
          <button
            type="button"
            onClick={() => setWantedRole(null)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors duration-200 ${
              wantedRole === null
                ? "border-neon-cyan bg-neon-cyan/10 text-neon-cyan"
                : "border-white/15 text-white/50 hover:border-white/35 hover:text-white/80"
            }`}
          >
            Todo
          </button>
          {COLLAB_ROLES.map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => setWantedRole(role)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors duration-200 ${
                wantedRole === role
                  ? "border-neon-cyan bg-neon-cyan/10 text-neon-cyan"
                  : "border-white/15 text-white/50 hover:border-white/35 hover:text-white/80"
              }`}
            >
              {role}
            </button>
          ))}
        </div>
      )}

      {loading ||
      isLoadingInitial ||
      (feedMode === "following" && isLoadingFollowing) ||
      (feedMode === "collabs" && isLoadingCollabs) ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-neon-cyan/30 border-t-neon-cyan" />
        </div>
      ) : feedError && posts.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-graphite p-8 text-center">
          <p className="text-sm text-red-400">No se pudo cargar la comunidad.</p>
          <p className="mt-1 text-xs text-white/40">{feedError}</p>
        </div>
      ) : feedMode === "collabs" && sourcePosts.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-graphite p-10 text-center">
          <p className={`text-sm ${collabError ? "text-orange-300" : "text-white/60"}`}>
            {collabError
              ? collabError
              : wantedRole
                ? `Ninguna canción está buscando ${wantedRole.toLowerCase()} por ahora.`
                : "Todavía nadie pidió que le sumen un instrumento."}
          </p>
          <p className="mt-2 text-xs text-white/40">
            Al publicar podés marcar qué te falta, y quien toque eso te va a encontrar acá.
          </p>
        </div>
      ) : feedMode === "following" && sourcePosts.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-graphite p-10 text-center">
          <p className="text-sm text-white/60">Todavía no seguís a nadie.</p>
          <p className="mt-2 text-xs text-white/40">
            Entrá al perfil de quien te guste desde su nombre en el feed y tocá Seguir. Acá vas
            a ver solo lo que publican ellos.
          </p>
          <button
            type="button"
            onClick={() => setFeedMode("all")}
            className="mt-4 rounded-full border border-neon-cyan/40 bg-onyx-black px-5 py-2 font-display text-xs font-semibold text-neon-cyan transition-all duration-300 hover:border-neon-cyan"
          >
            Explorar la Comunidad
          </button>
        </div>
      ) : sourcePosts.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-graphite p-10 text-center">
          <p className="text-sm text-white/60">
            La comunidad está tranquila hoy. ¡Sé el primero en publicar!
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {visiblePosts.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-graphite p-10 text-center">
              <p className="text-sm text-white/60">
                No hay nada para mostrar acá — bloqueaste a los autores de este lote.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {visiblePosts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  isLiked={likedPostIds.has(post.id)}
                  onLikeToggled={handleLikeToggled}
                  onBlocked={handlePostBlocked}
                  isPlaying={playingPostId === post.id}
                  onRequestPlay={() => setPlayingPostId(post.id)}
                  commentsCount={commentCounts.get(post.id) ?? 0}
                  onCommentAdded={handleCommentAdded}
                  onRequireLogin={requireLogin}
                />
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
            <p className="pb-4 text-center text-xs text-white/30">Has llegado al final del feed.</p>
          )}
        </div>
      )}

      {isModalOpen && <LoginModal onClose={() => setIsModalOpen(false)} />}
    </div>
  );
}
