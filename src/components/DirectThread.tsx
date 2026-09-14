"use client";

// Hilo de una conversación privada entre dos usuarios.
//
// Se parece al de colaboración (CollabThread.tsx) pero no es el mismo, y
// la diferencia que importa está arriba de todo: acá el PRIMER mensaje
// no vive en la subcolección sino en el documento de la conversación
// (`openingText`). Eso no es un capricho de modelado — es lo que hace
// que una aproximación en frío sea un solo texto y no un hilo donde
// alguien pueda descargar veinte mensajes antes de que le contesten.
// Las reglas mantienen `messages` cerrada mientras el estado sea
// "pending", así que el tope no depende de que esta pantalla no muestre
// el campo de texto.
//
// Sin listener en vivo, igual que el resto del proyecto: se lee al abrir
// y después de mandar. Dos personas escribiéndose no necesitan tiempo
// real, y un listener abierto cuesta lecturas en cada pantalla montada.

import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, Check, Send, X } from "lucide-react";
import {
  acceptConversation,
  fetchDirectMessages,
  markConversationSeen,
  MAX_DIRECT_MESSAGE,
  otherName,
  otherParticipant,
  rejectConversation,
  sendDirectMessage,
  type Conversation,
  type DirectMessage,
} from "@/lib/DirectMessageService";
import { blockUser } from "@/lib/CommunityService";

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

function Bubble({
  mine,
  name,
  text,
  stamp,
}: {
  mine: boolean;
  name: string;
  text: string;
  stamp: string;
}) {
  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${
          mine ? "bg-neon-cyan/15 text-white" : "bg-white/5 text-white/90"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{text}</p>
      </div>
      <span className="mt-1 text-[10px] text-white/30">
        {mine ? "Vos" : name} · {stamp}
      </span>
    </div>
  );
}

export function DirectThread({
  conversation,
  myUid,
  myName,
  onChanged,
}: {
  conversation: Conversation;
  myUid: string;
  myName: string;
  /// Se llama cuando cambió algo que la lista de afuera tiene que
  /// reflejar: se aceptó, se rechazó, se leyó o se mandó un mensaje.
  onChanged?: () => void;
}) {
  const [messages, setMessages] = useState<DirectMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const convId = conversation.id;
  const isAccepted = conversation.status === "accepted";
  const iStarted = conversation.startedBy === myUid;
  const theirName = otherName(conversation, myUid);
  const theirUid = otherParticipant(conversation, myUid);

  const load = useCallback(async () => {
    // Mientras está pendiente la subcolección está cerrada por reglas:
    // pedirla daría permission-denied. El único texto que existe es
    // `openingText`, que se dibuja igual más abajo.
    if (!isAccepted) {
      setMessages([]);
      return;
    }
    try {
      setMessages(await fetchDirectMessages(convId));
      setError(null);
    } catch {
      setError("No se pudo abrir la conversación.");
      setMessages([]);
    }
  }, [convId, isAccepted]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  // Marcar como leído al abrir. Es la única escritura que dispara sola
  // esta pantalla, y si falla no se le dice nada al usuario: el peor
  // caso es que el aviso siga encendido un rato más.
  useEffect(() => {
    let cancelled = false;
    void markConversationSeen(convId, myUid)
      .then(() => {
        if (!cancelled) onChanged?.();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // onChanged deliberadamente afuera: cambia de identidad en cada
    // render del padre y volvería a marcar leído en loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId, myUid]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      await sendDirectMessage({ convId, senderUid: myUid, senderName: myName, text });
      setDraft("");
      await load();
      onChanged?.();
    } catch {
      setError("No se pudo enviar. Probá de nuevo.");
    } finally {
      setSending(false);
    }
  }

  async function handleAccept() {
    setWorking(true);
    setError(null);
    try {
      await acceptConversation(convId);
      onChanged?.();
    } catch {
      setError("No se pudo aceptar la conversación.");
    } finally {
      setWorking(false);
    }
  }

  async function handleReject(alsoBlock: boolean) {
    const question = alsoBlock
      ? `Vas a rechazar y bloquear a ${theirName}. No va a poder volver a escribirte y dejás de ver lo suyo en la Comunidad. No se entera de nada de esto.`
      : `Vas a rechazar el mensaje de ${theirName}. No va a poder volver a escribirte.`;
    if (!window.confirm(question)) return;

    setWorking(true);
    setError(null);
    try {
      // Rechazar NO borra el documento: queda como "rejected" y eso es
      // lo que impide que esa persona abra una conversación nueva
      // (crear exige que el documento no exista). Borrarlo dejaría el
      // camino libre para insistir.
      await rejectConversation(convId);
      if (alsoBlock) await blockUser(myUid, theirUid);
      onChanged?.();
    } catch {
      setError("No se pudo rechazar la conversación.");
    } finally {
      setWorking(false);
    }
  }

  const remaining = MAX_DIRECT_MESSAGE - draft.length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-1 py-2">
        {/* El texto con el que se abrió la conversación siempre va
            primero: es un mensaje real, solo que guardado arriba. */}
        <Bubble
          mine={iStarted}
          name={theirName}
          text={conversation.openingText}
          stamp={formatStamp(conversation.createdAt)}
        />

        {messages === null && <p className="text-xs text-white/30">Cargando…</p>}
        {messages?.map((m) => (
          <Bubble
            key={m.id}
            mine={m.senderUid === myUid}
            name={m.senderName}
            text={m.text}
            stamp={formatStamp(m.createdAt)}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="px-1 pb-2 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}

      {/* Pendiente y soy quien recibe: decido. Hasta que no acepte, la
          otra persona no puede mandar un segundo mensaje. */}
      {!isAccepted && !iStarted && (
        <div className="rounded-xl border border-white/10 bg-onyx-black p-3">
          <p className="mb-3 text-xs text-white/50">
            {theirName} te escribió por primera vez. Si aceptás se abre la conversación y
            vas a recibir sus mensajes; si rechazás, no va a poder volver a escribirte.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleAccept}
              disabled={working}
              className="flex items-center gap-1.5 rounded-full border border-neon-cyan/40 px-4 py-1.5 text-xs font-semibold text-neon-cyan transition-colors duration-200 hover:border-neon-cyan disabled:opacity-50"
            >
              <Check size={13} />
              Aceptar
            </button>
            <button
              type="button"
              onClick={() => handleReject(false)}
              disabled={working}
              className="flex items-center gap-1.5 rounded-full border border-white/20 px-4 py-1.5 text-xs text-white/60 transition-colors duration-200 hover:border-white/40 hover:text-white disabled:opacity-50"
            >
              <X size={13} />
              Rechazar
            </button>
            <button
              type="button"
              onClick={() => handleReject(true)}
              disabled={working}
              className="flex items-center gap-1.5 rounded-full border border-red-400/30 px-4 py-1.5 text-xs text-red-300 transition-colors duration-200 hover:border-red-400 hover:bg-red-400/10 disabled:opacity-50"
            >
              <Ban size={13} />
              Rechazar y bloquear
            </button>
          </div>
        </div>
      )}

      {/* Pendiente y lo mandé yo: no hay campo de texto, y no es una
          decisión de la pantalla — las reglas rechazarían la escritura
          igual. Decirlo claro evita que parezca que se rompió algo. */}
      {!isAccepted && iStarted && (
        <p className="rounded-xl border border-white/10 bg-onyx-black p-3 text-xs text-white/40">
          Tu mensaje está esperando que {theirName} lo acepte. Hasta que eso pase no podés
          mandar otro.
        </p>
      )}

      {isAccepted && (
        <div className="flex items-end gap-2 border-t border-white/10 pt-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_DIRECT_MESSAGE))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            rows={2}
            placeholder={`Escribile a ${theirName}…`}
            className="flex-1 resize-none rounded-xl border border-white/15 bg-onyx-black px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-200 focus:border-neon-cyan"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || draft.trim().length === 0}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-neon-cyan/40 text-neon-cyan transition-colors duration-200 hover:border-neon-cyan disabled:opacity-40"
            aria-label="Enviar"
          >
            <Send size={15} />
          </button>
        </div>
      )}

      {isAccepted && remaining < 100 && (
        <p className="pt-1 text-right text-[10px] text-white/30">{remaining}</p>
      )}
    </div>
  );
}
