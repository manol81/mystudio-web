"use client";

// Hilo de mensajes de una colaboración — la única mensajería privada de
// MY STUDIO, y a propósito no es un chat general: solo existe entre dos
// personas que ya se vincularon por una colaboración aceptada (ver
// CollabService.ts y firestore.rules).
//
// Antes de esto el circuito se cortaba justo en el momento más
// importante: aceptabas a alguien y después no había ninguna forma de
// hablar con esa persona ni de volver a encontrarla.

import { useCallback, useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import {
  fetchCollabMessages,
  markThreadSeen,
  MAX_THREAD_MESSAGE,
  sendCollabMessage,
  type CollabMessage,
  type CollabRequest,
} from "@/lib/CollabService";

function formatStamp(date: Date | null): string {
  if (!date) return "enviando…";
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay
    ? date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("es-AR", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function CollabThread({
  request,
  myUid,
  myName,
  onRead,
}: {
  request: CollabRequest;
  myUid: string;
  myName: string;
  /// Se llama cuando el hilo quedó marcado como leído, para que la lista
  /// de arriba apague su aviso sin recargar todo.
  onRead?: () => void;
}) {
  const [messages, setMessages] = useState<CollabMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setMessages(await fetchCollabMessages(request.postId, request.requesterUid));
      setError(null);
    } catch {
      setError("No se pudo abrir la conversación.");
      setMessages([]);
    }
  }, [request.postId, request.requesterUid]);

  useEffect(() => {
    // En microtask, mismo criterio que AuthContext: para el linter de
    // React esto es un setState síncrono dentro del efecto, aunque el
    // estado recién se toque cuando vuelve la consulta.
    queueMicrotask(() => void load());
  }, [load]);

  // Marcar como leído al abrir. Si falla no pasa nada grave: el aviso
  // vuelve a aparecer la próxima vez, que es el error preferible.
  useEffect(() => {
    if (!request.lastMessageAt || request.lastMessageSenderUid === myUid) return;
    markThreadSeen(request, myUid)
      .then(() => onRead?.())
      .catch(() => {});
    // onRead cambia de identidad en cada render del padre; incluirlo
    // volvería a marcar leído en bucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.postId, request.requesterUid, request.lastMessageAt, myUid]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      await sendCollabMessage({
        postId: request.postId,
        requesterUid: request.requesterUid,
        senderUid: myUid,
        senderName: myName,
        text,
      });
      setDraft("");
      await load();
    } catch {
      setError("No se pudo enviar. Probá de nuevo.");
    } finally {
      setSending(false);
    }
  }

  if (request.status !== "accepted") {
    return (
      <p className="rounded-lg bg-white/5 px-3 py-2 text-xs text-white/40">
        La conversación se abre cuando la colaboración está aceptada.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="max-h-72 overflow-y-auto pr-1">
        {messages === null && <p className="text-xs text-white/40">Abriendo conversación…</p>}
        {messages !== null && messages.length === 0 && (
          <p className="text-xs text-white/40">
            Todavía no se escribieron. Contale cómo imaginás su parte, o mandale una
            referencia.
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {(messages ?? []).map((m) => {
            const mine = m.senderUid === myUid;
            return (
              <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                    mine
                      ? "rounded-br-sm bg-neon-cyan/15 text-white/90"
                      : "rounded-bl-sm bg-white/8 text-white/80"
                  }`}
                >
                  {!mine && (
                    <p className="mb-0.5 text-[10px] font-semibold text-white/40">
                      {m.senderName}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {m.text}
                  </p>
                  <p className="mt-1 text-right text-[10px] text-white/30">
                    {formatStamp(m.createdAt)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
        <div ref={bottomRef} />
      </div>

      {error && <p className="text-xs text-red-300">{error}</p>}

      <div className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_THREAD_MESSAGE))}
          onKeyDown={(e) => {
            // Enter manda, Shift+Enter hace salto de línea.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder="Escribile…"
          className="flex-1 resize-none rounded-xl border border-white/10 bg-onyx-black px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-neon-cyan/50 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || draft.trim().length === 0}
          aria-label="Enviar mensaje"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-neon-cyan/40 bg-onyx-black text-neon-cyan transition-all duration-200 hover:border-neon-cyan disabled:opacity-30"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
