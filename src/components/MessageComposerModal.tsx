"use client";

// Escribirle a alguien desde donde te lo cruzaste: su perfil, o un
// comentario que te dejó en la Bandeja de Entrada.
//
// Es un modal y no una navegación a /mensajes a propósito: el punto de
// esta función es contestarle a alguien en el momento en que te acordás
// de hacerlo. Mandarte a otra pantalla, con el hilo vacío y el contexto
// perdido, es la forma más segura de que no lo escribas.
//
// Qué pasa según el estado de la conversación, que es lo que hace que
// este modal sea más que un formulario:
//   · no existe          → se crea. Va como SOLICITUD, salvo que esa
//                          persona ya te siga (lo verifican las reglas).
//   · aceptada           → el texto entra como un mensaje más del hilo.
//   · pendiente, la abrí → no se puede mandar otro. Es el tope de un
//                          texto por aproximación en frío, y vive en las
//                          reglas, no acá.
//   · pendiente, la abrió el otro → hay algo esperando respuesta en
//                          Mensajes; se avisa en vez de crear nada.
//   · rechazada          → esa persona no quiere recibir mensajes tuyos.

import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  MAX_DIRECT_MESSAGE,
  sendDirectMessage,
  startConversation,
} from "@/lib/DirectMessageService";

type Phase = "idle" | "sending" | "sent" | "pending-sent" | "needs-answer" | "error";

export function MessageComposerModal({
  myUid,
  myName,
  recipientUid,
  recipientName,
  onClose,
}: {
  myUid: string;
  myName: string;
  recipientUid: string;
  recipientName: string;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isBusy = phase === "sending";
  const isDone = phase === "sent" || phase === "pending-sent" || phase === "needs-answer";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;

    setPhase("sending");
    setErrorMessage(null);
    try {
      const { conversation, created } = await startConversation({
        myUid,
        myName,
        otherUid: recipientUid,
        otherName: recipientName,
        text: body,
      });

      if (created) {
        setPhase(conversation.status === "accepted" ? "sent" : "pending-sent");
        return;
      }

      // Ya existía. Si está abierta, el texto entra como un mensaje más;
      // si sigue pendiente, no hay nada que mandar y hay que decir por
      // qué en vez de fallar con un permission-denied.
      if (conversation.status === "accepted") {
        await sendDirectMessage({
          convId: conversation.id,
          senderUid: myUid,
          senderName: myName,
          text: body,
        });
        setPhase("sent");
        return;
      }
      setPhase(conversation.startedBy === myUid ? "pending-sent" : "needs-answer");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "No se pudo enviar el mensaje.");
      setPhase("error");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      onClick={isBusy ? undefined : onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-graphite p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-xl font-semibold text-white">
          Escribirle a {recipientName}
        </h2>

        {isDone ? (
          <div className="mt-6 flex flex-col gap-4 text-center">
            <p className="text-sm text-white/70">
              {phase === "sent" && "Listo, se lo mandamos."}
              {phase === "pending-sent" &&
                `${recipientName} lo va a ver como una solicitud. Hasta que la acepte no vas a poder mandarle otro mensaje.`}
              {phase === "needs-answer" &&
                `${recipientName} ya te había escrito y tenés esa solicitud sin responder. Aceptala desde Mensajes y ahí se abre la conversación.`}
            </p>
            <div className="flex justify-center gap-2">
              <Link
                href="/mensajes"
                className="rounded-full border border-neon-cyan/40 px-5 py-2 font-display text-xs font-semibold text-neon-cyan transition-colors duration-200 hover:border-neon-cyan"
              >
                Ir a Mensajes
              </Link>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-white/20 px-5 py-2 text-xs text-white/60 transition-colors duration-200 hover:border-white/40 hover:text-white"
              >
                Cerrar
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
            <p className="text-xs text-white/50">
              Si nunca hablaron, este mensaje le llega como una solicitud: no le suena el
              teléfono hasta que la acepte, y es el único que podés mandarle hasta
              entonces. Aprovechalo para decirle quién sos.
            </p>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_DIRECT_MESSAGE))}
              rows={5}
              autoFocus
              placeholder="Hola, escuché tu tema y…"
              className="w-full resize-none rounded-lg border border-white/15 bg-onyx-black px-4 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition-colors duration-200 focus:border-neon-cyan"
            />
            <p className="-mt-2 text-right text-[10px] text-white/30">
              {MAX_DIRECT_MESSAGE - text.length}
            </p>

            {errorMessage && (
              <p className="text-xs text-red-400" role="alert">
                {errorMessage}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isBusy}
                className="rounded-full border border-white/20 px-5 py-2 text-xs text-white/60 transition-colors duration-200 hover:border-white/40 hover:text-white disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isBusy || text.trim().length === 0}
                className="rounded-full border border-neon-cyan/40 px-5 py-2 font-display text-xs font-semibold text-neon-cyan transition-colors duration-200 hover:border-neon-cyan disabled:opacity-40"
              >
                {isBusy ? "Enviando…" : "Enviar"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
