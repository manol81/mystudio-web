"use client";

// Mensajes — conversaciones privadas entre usuarios.
//
// Es la pantalla nueva del circuito: hasta ahora la única forma de
// hablarle a alguien era haber aceptado una colaboración con esa persona
// en una canción concreta, así que no había manera de escribirle a quien
// te gustó lo que publicó. Eso sigue existiendo aparte, en
// /colaboraciones, porque una conversación atada a un tema con una
// entrega que vence no es lo mismo que una charla.
//
// Las solicitudes van ARRIBA y separadas: son lo único acá que espera
// una decisión, no solo una mirada. Es el mismo criterio con el que la
// Bandeja de Entrada pone los pedidos de colaboración antes que las
// novedades.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, MessageSquare, Trash2 } from "lucide-react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { LoginModal } from "@/components/LoginModal";
import { DirectThread } from "@/components/DirectThread";
import {
  deleteConversation,
  fetchConversations,
  hasUnread,
  otherName,
  otherParticipant,
  type Conversation,
} from "@/lib/DirectMessageService";

function formatRelative(date: Date | null): string {
  if (!date) return "";
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "recién";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} d`;
  return date.toLocaleDateString("es-AR");
}

function ConversationRow({
  conv,
  myUid,
  isOpen,
  onOpen,
}: {
  conv: Conversation;
  myUid: string;
  isOpen: boolean;
  onOpen: () => void;
}) {
  const unread = hasUnread(conv, myUid);
  const waiting = conv.status === "pending" && conv.startedBy === myUid;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors duration-200 ${
        isOpen
          ? "border-neon-cyan/40 bg-neon-cyan/5"
          : "border-white/10 bg-graphite hover:border-white/25"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-white">
            {otherName(conv, myUid)}
          </span>
          {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-neon-cyan" />}
        </div>
        <p className="mt-0.5 truncate text-xs text-white/40">
          {conv.lastMessageSenderUid === myUid ? "Vos: " : ""}
          {conv.lastMessageText}
        </p>
        {waiting && (
          <p className="mt-1 text-[10px] text-white/30">Esperando que acepte</p>
        )}
      </div>
      <span className="shrink-0 text-[10px] text-white/25">
        {formatRelative(conv.lastMessageAt)}
      </span>
    </button>
  );
}

export default function MessagesPage() {
  const { user, profile, loading } = useAuth();
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setConversations(await fetchConversations(user.uid));
      setError(null);
    } catch {
      setError("No se pudieron cargar tus conversaciones.");
      setConversations([]);
    }
  }, [user]);

  useEffect(() => {
    // Microtask por el linter de React, igual que en /colaboraciones: el
    // estado recién se toca cuando vuelve la consulta.
    queueMicrotask(() => void load());
  }, [load]);

  const { requests, threads } = useMemo(() => {
    const all = conversations ?? [];
    const uid = user?.uid ?? "";
    return {
      // Solicitudes = alguien me escribió por primera vez y todavía no
      // decidí. Lo que abrí yo y está esperando respuesta NO va acá: no
      // espera nada mío.
      requests: all.filter((c) => c.status === "pending" && c.startedBy !== uid),
      threads: all.filter((c) => !(c.status === "pending" && c.startedBy !== uid)),
    };
  }, [conversations, user]);

  const open = useMemo(
    () => (conversations ?? []).find((c) => c.id === openId) ?? null,
    [conversations, openId],
  );

  async function handleDelete(conv: Conversation) {
    // Borrar deja el par LIBRE para empezar de nuevo, así que no sirve
    // para sacarse a alguien de encima — para eso está rechazar, que es
    // permanente. Se dice, porque no es evidente.
    const name = otherName(conv, user?.uid ?? "");
    if (
      !window.confirm(
        `Vas a borrar la conversación con ${name} y todos sus mensajes, para los dos. ` +
          `No se puede deshacer, y esa persona va a poder volver a escribirte.`,
      )
    ) {
      return;
    }
    try {
      await deleteConversation(conv.id);
      setOpenId(null);
      await load();
    } catch {
      setError("No se pudo borrar la conversación.");
    }
  }

  if (loading) {
    return <div className="px-6 py-10 text-sm text-white/40">Cargando…</div>;
  }

  if (!user) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/5 text-white/30">
          <MessageSquare size={26} />
        </div>
        <h1 className="font-display text-2xl font-bold text-white">
          Men<span className="text-neon-cyan">sajes</span>
        </h1>
        <p className="max-w-sm text-sm text-white/50">
          Iniciá sesión para escribirte con otros músicos de la Comunidad.
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

  const myName = profile?.username ?? "Usuario";

  return (
    <div className="px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <h1 className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">
          Men<span className="text-neon-cyan">sajes</span>
        </h1>
        <p className="mt-1 text-xs text-white/40">
          Conversaciones privadas. Para hablar de una canción en la que estás colaborando,{" "}
          <Link href="/colaboraciones" className="text-white/60 hover:text-neon-cyan">
            usá Colaboraciones
          </Link>
          .
        </p>

        {error && (
          <p className="mt-4 text-xs text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
          {/* En pantalla chica se ve una cosa por vez: la lista, o el
              hilo abierto con su botón de volver. */}
          <div className={`flex-col gap-5 ${open ? "hidden lg:flex" : "flex"}`}>
            {requests.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className="font-display text-[11px] font-semibold uppercase tracking-widest text-white/40">
                  Solicitudes ({requests.length})
                </h2>
                <p className="-mt-1 text-[11px] text-white/30">
                  Gente que te escribió por primera vez. No te llegan notificaciones
                  hasta que aceptes.
                </p>
                {requests.map((conv) => (
                  <ConversationRow
                    key={conv.id}
                    conv={conv}
                    myUid={user.uid}
                    isOpen={conv.id === openId}
                    onOpen={() => setOpenId(conv.id)}
                  />
                ))}
              </section>
            )}

            <section className="flex flex-col gap-2">
              <h2 className="font-display text-[11px] font-semibold uppercase tracking-widest text-white/40">
                Conversaciones
              </h2>
              {conversations === null && (
                <p className="text-xs text-white/30">Cargando…</p>
              )}
              {conversations !== null && threads.length === 0 && (
                <p className="rounded-xl border border-white/10 bg-graphite px-4 py-6 text-xs text-white/40">
                  Todavía no hablaste con nadie. Entrá al perfil de alguien que te guste lo
                  que publica y tocá «Enviar mensaje».
                </p>
              )}
              {threads.map((conv) => (
                <ConversationRow
                  key={conv.id}
                  conv={conv}
                  myUid={user.uid}
                  isOpen={conv.id === openId}
                  onOpen={() => setOpenId(conv.id)}
                />
              ))}
            </section>
          </div>

          <div className={open ? "block" : "hidden lg:block"}>
            {open ? (
              <div className="flex h-[70vh] flex-col rounded-2xl border border-white/10 bg-graphite p-4">
                <div className="mb-3 flex items-center justify-between gap-3 border-b border-white/10 pb-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setOpenId(null)}
                      className="text-white/40 transition-colors duration-200 hover:text-white lg:hidden"
                      aria-label="Volver"
                    >
                      <ArrowLeft size={16} />
                    </button>
                    <Link
                      href={`/u/${otherParticipant(open, user.uid)}`}
                      className="truncate font-display text-sm font-semibold text-white transition-colors duration-200 hover:text-neon-cyan"
                    >
                      {otherName(open, user.uid)}
                    </Link>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(open)}
                    className="flex shrink-0 items-center gap-1.5 text-[11px] text-white/30 transition-colors duration-200 hover:text-red-300"
                  >
                    <Trash2 size={12} />
                    Borrar
                  </button>
                </div>
                <DirectThread
                  key={open.id}
                  conversation={open}
                  myUid={user.uid}
                  myName={myName}
                  onChanged={load}
                />
              </div>
            ) : (
              <div className="flex h-[70vh] items-center justify-center rounded-2xl border border-dashed border-white/10 text-xs text-white/25">
                Elegí una conversación
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
