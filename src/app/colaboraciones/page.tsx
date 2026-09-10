"use client";

// Colaboraciones — la constancia de con quién trabajaste.
//
// Hasta acá el vínculo entre dos personas existía únicamente como un
// documento escondido dentro de la publicación (`collab_requests`), y
// eso hacía que después de aceptar a alguien la relación se evaporara:
// el autor lo perdía de vista apenas respondía, el colaborador solo lo
// veía en su lista de pedidos enviados, y no había ningún canal para
// hablarse. Esta página junta las dos puntas en un solo lugar y le da a
// cada colaboración su conversación.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Handshake, MessageCircle, Music2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { LoginModal } from "@/components/LoginModal";
import { CollabThread } from "@/components/CollabThread";
import {
  daysUntilExpiry,
  fetchMyCollaborations,
  hasUnreadMessages,
  isDeliveryExpired,
  otherParticipant,
  type CollabRequest,
} from "@/lib/CollabService";
import { fetchCommunityPost } from "@/lib/CommunityService";

interface PostInfo {
  title: string;
  authorName: string;
}

function threadKey(c: CollabRequest): string {
  return `${c.postId}__${c.requesterUid}`;
}

function StatusChip({ status }: { status: CollabRequest["status"] }) {
  const map = {
    accepted: { text: "En marcha", cls: "bg-neon-cyan/15 text-neon-cyan" },
    pending: { text: "Esperando respuesta", cls: "bg-white/10 text-white/50" },
    rejected: { text: "Sin acuerdo", cls: "bg-red-400/10 text-red-300/70" },
  } as const;
  const { text, cls } = map[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{text}</span>
  );
}

export default function CollaborationsPage() {
  const { user, profile, loading } = useAuth();
  const [collabs, setCollabs] = useState<CollabRequest[] | null>(null);
  const [posts, setPosts] = useState<Map<string, PostInfo>>(new Map());
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [readLocally, setReadLocally] = useState<Set<string>>(new Set());
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const list = await fetchMyCollaborations(user.uid);
      setCollabs(list);
      // El pedido no guarda el título del tema ni el nombre del autor:
      // se resuelven leyendo la publicación, que es pública. Así los
      // pedidos que ya existían siguen funcionando sin migrar nada.
      const ids = [...new Set(list.map((c) => c.postId))];
      const entries = await Promise.all(
        ids.map(async (id) => {
          const post = await fetchCommunityPost(id).catch(() => null);
          return [
            id,
            { title: post?.title ?? "Tema", authorName: post?.authorName ?? "" },
          ] as const;
        }),
      );
      setPosts(new Map(entries));
    } catch {
      setError("No se pudieron cargar tus colaboraciones.");
      setCollabs([]);
    }
  }, [user]);

  useEffect(() => {
    // Microtask por el linter de React, igual que en la Bandeja de
    // Entrada: el estado recién se toca cuando vuelve la consulta.
    queueMicrotask(() => void load());
  }, [load]);

  const groups = useMemo(() => {
    const all = collabs ?? [];
    return {
      accepted: all.filter((c) => c.status === "accepted"),
      pending: all.filter((c) => c.status === "pending"),
      rejected: all.filter((c) => c.status === "rejected"),
    };
  }, [collabs]);

  if (loading) {
    return <div className="px-6 py-10 text-sm text-white/40">Cargando…</div>;
  }

  if (!user) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/5 text-white/30">
          <Handshake size={26} />
        </div>
        <h1 className="font-display text-2xl font-bold text-white">
          Cola<span className="text-neon-cyan">boraciones</span>
        </h1>
        <p className="max-w-sm text-sm text-white/50">
          Iniciá sesión para ver con quién estás trabajando y hablar con esa persona.
        </p>
        <button
          type="button"
          onClick={() => setIsLoginOpen(true)}
          className="rounded-full border border-neon-cyan/40 bg-onyx-black px-6 py-2 font-display text-sm font-semibold text-neon-cyan transition-all duration-300 hover:border-neon-cyan hover:shadow-[0_0_18px_rgba(102,252,241,0.4)]"
        >
          Iniciar Sesión
        </button>
        {isLoginOpen && <LoginModal onClose={() => setIsLoginOpen(false)} />}
      </div>
    );
  }

  const myUid = user.uid;

  function renderCard(c: CollabRequest) {
    const key = threadKey(c);
    const iAmAuthor = c.postAuthorId === myUid;
    const info = posts.get(c.postId);
    const otherUid = otherParticipant(c, myUid);
    const otherName = iAmAuthor ? c.requesterName : info?.authorName || "el autor";
    const unread = hasUnreadMessages(c, myUid) && !readLocally.has(key);
    const days = daysUntilExpiry(c.expiresAt);
    const hasLiveDelivery = Boolean(c.deliveryUrl) && !isDeliveryExpired(c.expiresAt);

    return (
      <li key={key} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={c.status} />
          <span className="rounded-full bg-neon-cyan/10 px-2 py-0.5 text-[10px] font-semibold text-neon-cyan">
            {c.role}
          </span>
          <span className="text-[11px] text-white/35">
            {iAmAuthor ? "en tu canción" : "vos aportás"}
          </span>
        </div>

        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-white/80">
          <Music2 size={14} className="shrink-0 text-white/30" />
          <Link href={`/p/${c.postId}`} className="font-semibold text-white hover:text-neon-cyan">
            {info?.title ?? "Tema"}
          </Link>
          <span className="text-white/35">con</span>
          <Link href={`/u/${otherUid}`} className="font-semibold text-white hover:text-neon-cyan">
            {otherName}
          </Link>
        </p>

        {c.message && (
          <p className="mt-1.5 text-xs leading-relaxed text-white/45">“{c.message}”</p>
        )}

        {hasLiveDelivery && (
          <p className="mt-2 text-xs text-orange-300">
            {iAmAuthor
              ? c.downloadedAt
                ? "Ya bajaste su pista a la app."
                : `Su pista te está esperando — se borra en ${days} ${
                    days === 1 ? "día" : "días"
                  }.`
              : c.downloadedAt
                ? "El autor ya bajó tu pista."
                : `Tu pista está subida — vence en ${days} ${days === 1 ? "día" : "días"}.`}
          </p>
        )}

        {c.status === "accepted" && (
          <>
            <button
              type="button"
              onClick={() => {
                setOpenThread(openThread === key ? null : key);
                if (unread) setReadLocally((prev) => new Set(prev).add(key));
              }}
              className="mt-3 flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/60 transition-colors hover:border-white/40 hover:text-white"
            >
              <MessageCircle size={13} />
              {openThread === key ? "Cerrar conversación" : "Conversación"}
              {unread && (
                <span className="ml-1 h-2 w-2 rounded-full bg-neon-cyan" aria-label="sin leer" />
              )}
            </button>
            {openThread === key && (
              <div className="mt-3 border-t border-white/10 pt-3">
                <CollabThread
                  request={c}
                  myUid={myUid}
                  myName={profile?.username ?? "Usuario"}
                  onRead={() => setReadLocally((prev) => new Set(prev).add(key))}
                />
              </div>
            )}
          </>
        )}
      </li>
    );
  }

  const isEmpty = collabs !== null && collabs.length === 0;

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <h1 className="font-display text-3xl font-bold text-white">
        Cola<span className="text-neon-cyan">boraciones</span>
      </h1>
      <p className="mt-1 text-sm text-white/50">
        Con quién estás trabajando, en qué tema y cómo va. Cada colaboración aceptada tiene
        su propia conversación.
      </p>

      {error && <p className="mt-6 text-sm text-red-300">{error}</p>}
      {collabs === null && !error && <p className="mt-6 text-sm text-white/40">Cargando…</p>}

      {isEmpty && (
        <div className="mt-10 rounded-xl border border-white/10 bg-white/[0.03] p-6 text-center">
          <p className="text-sm text-white/60">Todavía no colaboraste con nadie.</p>
          <p className="mt-1.5 text-xs text-white/40">
            Publicá un tema marcando qué instrumento te falta, o buscá en la Comunidad una
            canción donde puedas sumar lo tuyo.
          </p>
        </div>
      )}

      {groups.accepted.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-sm font-semibold text-white">En marcha</h2>
          <ul className="mt-3 flex flex-col gap-2">{groups.accepted.map(renderCard)}</ul>
        </section>
      )}

      {groups.pending.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-sm font-semibold text-white">Esperando respuesta</h2>
          <ul className="mt-3 flex flex-col gap-2">{groups.pending.map(renderCard)}</ul>
        </section>
      )}

      {groups.rejected.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-sm font-semibold text-white/50">Sin acuerdo</h2>
          <ul className="mt-3 flex flex-col gap-2 opacity-60">
            {groups.rejected.map(renderCard)}
          </ul>
        </section>
      )}
    </div>
  );
}
