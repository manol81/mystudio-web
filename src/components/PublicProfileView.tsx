"use client";

// Perfil público de un usuario: su vidriera en la Comunidad. Muestra
// quién es, lo que publicó y lo que viene comentando, y deja seguirlo.
//
// Es la primera pantalla del proyecto donde un usuario existe como
// PERSONA y no solo como el autor de una publicación suelta. Hasta acá,
// si alguien te gustaba, no había forma de ver qué más había hecho.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Handshake, Heart, MessageCircle, Music, UserPlus, UserCheck } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { LoginModal } from "@/components/LoginModal";
import {
  fetchProfileActivity,
  fetchProfilePosts,
  fetchPublicProfile,
  isFollowing as checkIsFollowing,
  toggleFollow,
  type ProfileActivity,
  type ProfilePost,
  type PublicProfile,
} from "@/lib/PublicProfileService";
import { fetchAcceptedCollabs, type CollabRequest } from "@/lib/CollabService";
import { fetchCommunityPost } from "@/lib/CommunityService";

// Misma paleta que usa el feed para el avatar, derivada del nombre, así
// una persona tiene siempre el mismo color en todos lados.
const AVATAR_COLORS = ["#66FCF1", "#C792EA", "#FFB86C", "#FF6AC1", "#82E0AA", "#7AA2F7"];

function avatarColorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function formatDate(date: Date | null): string {
  return date ? date.toLocaleDateString("es-AR", { day: "numeric", month: "short" }) : "";
}

type Tab = "posts" | "activity" | "collabs";

/// Lo mínimo que hace falta de la publicación para contar una
/// colaboración: el pedido no guarda ni el título ni el nombre del
/// autor, y resolverlos leyendo el post (que es público) evita tener
/// que migrar los pedidos que ya existían.
interface CollabPostInfo {
  title: string;
  authorName: string;
}

export function PublicProfileView({ uid }: { uid: string }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [posts, setPosts] = useState<ProfilePost[]>([]);
  const [activity, setActivity] = useState<ProfileActivity[]>([]);
  // Colaboraciones aceptadas de esta persona, de las dos puntas: las que
  // recibió en sus temas y las que aportó en temas ajenos. Es
  // información que ya era pública (los pedidos se leen sin sesión);
  // acá solo se junta y se cuenta.
  const [collabs, setCollabs] = useState<CollabRequest[]>([]);
  const [collabPosts, setCollabPosts] = useState<Map<string, CollabPostInfo>>(new Map());
  const [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");
  const [tab, setTab] = useState<Tab>("posts");
  const [following, setFollowing] = useState(false);
  const [isFollowBusy, setIsFollowBusy] = useState(false);
  const [isLoginOpen, setIsLoginOpen] = useState(false);

  const isOwnProfile = user?.uid === uid;

  const load = useCallback(async () => {
    const [profileData, postsData, activityData, collabData] = await Promise.all([
      fetchPublicProfile(uid),
      fetchProfilePosts(uid),
      fetchProfileActivity(uid),
      // Un fallo acá no puede tumbar el perfil entero: sin
      // colaboraciones la página se ve como siempre.
      fetchAcceptedCollabs(uid).catch(() => [] as CollabRequest[]),
    ]);
    setPosts(postsData);
    setActivity(activityData);
    setCollabs(collabData);
    // Sin perfil creado pero con publicaciones, igual vale la pena
    // mostrar la página: el apodo sale de lo que publicó.
    if (!profileData && postsData.length === 0) {
      setStatus("missing");
      return;
    }
    // Sin perfil público guardado, el nombre sale de lo último que
    // publicó: la página sirve igual aunque la persona nunca haya
    // pasado por "Editar Perfil".
    setProfile(
      profileData ?? {
        uid,
        username: postsData[0]?.authorName ?? "",
        bio: "",
        followersCount: 0,
      },
    );
    setStatus("ready");
    if (user && user.uid !== uid) {
      setFollowing(await checkIsFollowing(uid, user.uid));
    }
    // Los títulos de los temas colaborados, después de pintar el
    // perfil: son una lectura por publicación y no vale la pena que
    // demoren el resto de la página.
    if (collabData.length > 0) {
      const ids = [...new Set(collabData.map((c) => c.postId))];
      const entries = await Promise.all(
        ids.map(async (id) => {
          const post = await fetchCommunityPost(id).catch(() => null);
          return [
            id,
            { title: post?.title ?? "un tema", authorName: post?.authorName ?? "" },
          ] as const;
        }),
      );
      setCollabPosts(new Map(entries));
    }
  }, [uid, user]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function handleFollow() {
    if (!user) {
      setIsLoginOpen(true);
      return;
    }
    if (isFollowBusy || isOwnProfile) return;
    setIsFollowBusy(true);
    // Optimista: el botón responde en el acto y se revierte si falla.
    const next = !following;
    setFollowing(next);
    setProfile((p) =>
      p ? { ...p, followersCount: Math.max(0, p.followersCount + (next ? 1 : -1)) } : p,
    );
    try {
      await toggleFollow(uid, user.uid);
    } catch (err) {
      console.error("No se pudo actualizar el seguimiento:", err);
      setFollowing(!next);
      setProfile((p) =>
        p ? { ...p, followersCount: Math.max(0, p.followersCount + (next ? -1 : 1)) } : p,
      );
    } finally {
      setIsFollowBusy(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <div className="h-24 animate-pulse rounded-2xl bg-white/5" />
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-white/5" />
          ))}
        </div>
      </div>
    );
  }

  if (status === "missing" || !profile) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="font-display text-2xl font-bold text-white">Perfil no encontrado</h1>
        <p className="max-w-sm text-sm text-white/50">
          Puede que esta persona todavía no haya elegido un apodo, o que su cuenta ya no exista.
        </p>
        <Link
          href="/"
          className="mt-2 rounded-full border border-neon-cyan/40 bg-onyx-black px-5 py-2 font-display text-xs font-semibold text-neon-cyan transition-all duration-300 hover:border-neon-cyan"
        >
          Ir a la Comunidad
        </Link>
      </div>
    );
  }

  const displayName = profile.username || posts[0]?.authorName || "Usuario";
  const totalLikes = posts.reduce((sum, p) => sum + p.likesCount, 0);

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <header className="flex items-start gap-4">
        <div
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full font-display text-2xl font-bold text-onyx-black"
          style={{ backgroundColor: avatarColorFor(displayName) }}
        >
          {displayName.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-2xl font-bold text-white">{displayName}</h1>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/50">
            <span>
              <span className="font-semibold text-white/80">{profile.followersCount}</span>{" "}
              {profile.followersCount === 1 ? "seguidor" : "seguidores"}
            </span>
            <span>
              <span className="font-semibold text-white/80">{posts.length}</span>{" "}
              {posts.length === 1 ? "publicación" : "publicaciones"}
            </span>
            <span>
              <span className="font-semibold text-white/80">{totalLikes}</span>{" "}
              {totalLikes === 1 ? "me gusta" : "me gusta"}
            </span>
          </div>
          {profile.bio && (
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-white/70">
              {profile.bio}
            </p>
          )}
        </div>
        {isOwnProfile ? (
          <span className="shrink-0 rounded-full border border-white/15 px-4 py-2 text-xs text-white/40">
            Tu perfil
          </span>
        ) : (
          <button
            type="button"
            onClick={() => void handleFollow()}
            disabled={isFollowBusy}
            className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 font-display text-xs font-semibold transition-all duration-300 disabled:opacity-50 ${
              following
                ? "border border-white/20 text-white/70 hover:border-white/40"
                : "border border-neon-cyan/40 bg-onyx-black text-neon-cyan hover:border-neon-cyan hover:shadow-[0_0_18px_rgba(102,252,241,0.4)]"
            }`}
          >
            {following ? <UserCheck size={14} /> : <UserPlus size={14} />}
            {following ? "Siguiendo" : "Seguir"}
          </button>
        )}
      </header>

      <div className="mt-8 flex gap-1 border-b border-white/10">
        {(
          [
            ["posts", `Publicaciones (${posts.length})`],
            ["activity", `Actividad (${activity.length})`],
            ["collabs", `Colaboraciones (${collabs.length})`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors duration-200 ${
              tab === value
                ? "border-neon-cyan text-neon-cyan"
                : "border-transparent text-white/50 hover:text-white/80"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "posts" ? (
        posts.length === 0 ? (
          <p className="mt-8 text-center text-sm text-white/40">
            Todavía no publicó nada en la Comunidad.
          </p>
        ) : (
          <ul className="mt-6 flex flex-col gap-2">
            {posts.map((post) => (
              <li key={post.id}>
                <Link
                  href={`/p/${post.id}`}
                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-graphite p-4 transition-colors duration-200 hover:border-white/25"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-white/40">
                    <Music size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{post.title}</p>
                    <p className="text-xs text-white/40">
                      {post.genre}
                      {post.createdAt && ` · ${formatDate(post.createdAt)}`}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-white/40">
                    <Heart size={13} /> {post.likesCount}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : tab === "activity" ? (
        activity.length === 0 ? (
        <p className="mt-8 text-center text-sm text-white/40">Todavía no comentó nada.</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {activity.map((item) => (
            <li key={item.id}>
              <Link
                href={`/p/${item.postId}`}
                className="flex items-start gap-3 rounded-xl border border-white/10 bg-graphite p-4 transition-colors duration-200 hover:border-white/25"
              >
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neon-cyan/10 text-neon-cyan">
                  <MessageCircle size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm text-white/70">{item.text}</p>
                  <p className="mt-1 text-[11px] text-white/30">{formatDate(item.createdAt)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        )
      ) : collabs.length === 0 ? (
        <p className="mt-8 text-center text-sm text-white/40">
          Todavía no colaboró con nadie.
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {collabs.map((c) => {
            // Dos puntas del mismo vínculo: o el tema es suyo y alguien
            // le sumó un instrumento, o aportó el suyo en un tema ajeno.
            const iAuthored = c.postAuthorId === uid;
            const info = collabPosts.get(c.postId);
            const otherUid = iAuthored ? c.requesterUid : c.postAuthorId;
            const otherName = iAuthored
              ? c.requesterName
              : info?.authorName || "otro usuario";
            return (
              <li
                key={`${c.postId}_${c.requesterUid}`}
                className="flex items-start gap-3 rounded-xl border border-white/10 bg-graphite p-4"
              >
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neon-cyan/10 text-neon-cyan">
                  <Handshake size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white/70">
                    {iAuthored ? (
                      <>
                        <Link
                          href={`/u/${otherUid}`}
                          className="font-semibold text-white hover:text-neon-cyan"
                        >
                          {otherName}
                        </Link>{" "}
                        sumó <span className="text-neon-cyan">{c.role}</span> a{" "}
                        <Link
                          href={`/p/${c.postId}`}
                          className="font-semibold text-white hover:text-neon-cyan"
                        >
                          {info?.title ?? "un tema"}
                        </Link>
                      </>
                    ) : (
                      <>
                        Aportó <span className="text-neon-cyan">{c.role}</span> en{" "}
                        <Link
                          href={`/p/${c.postId}`}
                          className="font-semibold text-white hover:text-neon-cyan"
                        >
                          {info?.title ?? "un tema"}
                        </Link>
                        , de{" "}
                        <Link
                          href={`/u/${otherUid}`}
                          className="font-semibold text-white hover:text-neon-cyan"
                        >
                          {otherName}
                        </Link>
                      </>
                    )}
                  </p>
                  <p className="mt-1 text-[11px] text-white/30">{formatDate(c.createdAt)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {isLoginOpen && <LoginModal onClose={() => setIsLoginOpen(false)} />}
    </div>
  );
}
