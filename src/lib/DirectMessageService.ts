// src/lib/DirectMessageService.ts
//
// Mensajes directos entre usuarios — la primera mensajería de MY STUDIO
// que NO exige una colaboración previa.
//
// La otra (CollabService.ts, `collab_requests/{uid}/messages`) sigue
// existiendo y sigue atada a una canción, con su entrega y su
// vencimiento de 7 días. No se fusionaron a propósito: la conversación
// de un tema puntual se perdería entre charlas sueltas, y al revés.
//
// Hasta ahora no había chat general por una razón escrita en CLAUDE.md:
// mensajes privados entre desconocidos crean superficie de spam y acoso
// que después hay que moderar, y este proyecto no tiene equipo de
// moderación. Lo que permite abrirlo igual son tres límites que viven en
// firestore.rules, no acá — este archivo solo los acompaña:
//
//   1. UNA conversación por par de personas, para siempre: el id es los
//      dos uid ordenados y unidos por "__". No hay forma de abrir un
//      segundo hilo con alguien, así que no se puede inundar a nadie.
//   2. Una aproximación en frío es UN texto (`openingText`), no un
//      hilo. La subcolección `messages` está cerrada mientras el estado
//      sea "pending". Quien manda una solicitud NO puede seguir
//      escribiendo hasta que la acepten.
//   3. Rechazar es definitivo: el documento queda como "rejected" en vez
//      de borrarse, y crear exige que no exista. Esa persona no puede
//      volver a escribirte nunca más.
//
// El bloqueo se aplica acá, filtrando: las reglas NO rechazan el mensaje
// de alguien a quien bloqueaste, porque un `permission-denied` le
// avisaría que lo bloqueaste y en todo el proyecto el bloqueo es
// invisible para el bloqueado. Lo mismo hace la Cloud Function antes de
// mandar el push (ver functions/src/index.ts) — sin eso el bloqueado
// seguiría haciendo sonar el teléfono aunque su conversación no se vea.

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { fetchBlockedAuthorIds } from "@/lib/CommunityService";

/// Tope de un mensaje, el MISMO que valida firestore.rules y que usa la
/// app (kMaxDirectMessageLength en direct_message_service.dart).
/// Pasarse hace que las reglas rechacen la escritura entera.
export const MAX_DIRECT_MESSAGE = 1000;

/// Cuánto se guarda del último mensaje como resumen en la conversación.
/// Es lo único que se ve en la lista sin abrir el hilo, y el tope está
/// también en las reglas.
const PREVIEW_LENGTH = 140;

/// Cuántas conversaciones se traen. Más que esto no sirve: quien tenga
/// cien necesita buscar, no scrollear.
const MAX_CONVERSATIONS = 60;

export type ConversationStatus = "pending" | "accepted" | "rejected";

export interface Conversation {
  id: string;
  participants: string[];
  /// Apodo de cada participante, denormalizado. Cada uno solo puede
  /// escribir el suyo (lo exigen las reglas), así que nadie aparece con
  /// el nombre de otro.
  names: Record<string, string>;
  startedBy: string;
  recipient: string;
  status: ConversationStatus;
  /// El texto con el que se abrió la conversación. Vive acá y no en
  /// `messages` porque es el único mensaje que se puede mandar en frío:
  /// las reglas mantienen la subcolección cerrada hasta que se acepta.
  /// Las dos pantallas lo dibujan como el primer globo del hilo.
  openingText: string;
  createdAt: Date | null;
  lastMessageAt: Date | null;
  lastMessageText: string;
  lastMessageSenderUid: string;
  seenAt: Record<string, Date | null>;
}

export interface DirectMessage {
  id: string;
  senderUid: string;
  senderName: string;
  text: string;
  createdAt: Date | null;
}

function toDate(value: unknown): Date | null {
  return value instanceof Timestamp ? value.toDate() : null;
}

/// El id de la conversación entre dos personas: sus uid ORDENADOS y
/// unidos por "__".
///
/// Que sea derivado y no aleatorio es lo que garantiza una sola
/// conversación por par — desde las dos puntas se calcula el mismo id,
/// así que no existe la posibilidad de dos hilos paralelos ni de abrir
/// hilos nuevos para esquivar un rechazo. Las reglas verifican esta
/// misma forma al crear.
export function conversationId(a: string, b: string): string {
  return a < b ? `${a}__${b}` : `${b}__${a}`;
}

export function otherParticipant(conv: Conversation, myUid: string): string {
  return conv.participants.find((uid) => uid !== myUid) ?? myUid;
}

export function otherName(conv: Conversation, myUid: string): string {
  return conv.names[otherParticipant(conv, myUid)] ?? "Alguien";
}

/// ¿Hay algo sin leer para [myUid] en esta conversación?
///
/// Se responde con lo que ya viaja en el documento de la conversación,
/// sin abrir el hilo: por eso `lastMessageAt` y `lastMessageSenderUid`
/// viven arriba y no solo adentro de cada mensaje.
export function hasUnread(conv: Conversation, myUid: string): boolean {
  if (!conv.lastMessageAt) return false;
  if (conv.lastMessageSenderUid === myUid) return false;
  const seen = conv.seenAt[myUid] ?? null;
  return seen === null || conv.lastMessageAt > seen;
}

function fromSnapshot(id: string, data: Record<string, unknown>): Conversation {
  const rawSeen = (data.seenAt as Record<string, unknown>) ?? {};
  const seenAt: Record<string, Date | null> = {};
  for (const [uid, value] of Object.entries(rawSeen)) seenAt[uid] = toDate(value);
  return {
    id,
    participants: (data.participants as string[]) ?? [],
    names: (data.names as Record<string, string>) ?? {},
    startedBy: (data.startedBy as string) ?? "",
    recipient: (data.recipient as string) ?? "",
    status: (data.status as ConversationStatus) ?? "pending",
    openingText: (data.openingText as string) ?? "",
    createdAt: toDate(data.createdAt),
    lastMessageAt: toDate(data.lastMessageAt),
    lastMessageText: (data.lastMessageText as string) ?? "",
    lastMessageSenderUid: (data.lastMessageSenderUid as string) ?? "",
    seenAt,
  };
}

function messagesRef(convId: string) {
  return collection(db, "conversations", convId, "messages");
}

export async function fetchConversation(convId: string): Promise<Conversation | null> {
  const snap = await getDoc(doc(db, "conversations", convId));
  if (!snap.exists()) return null;
  return fromSnapshot(snap.id, snap.data());
}

/// Todas las conversaciones de esta persona, más recientes primero.
///
/// Es UNA consulta (participants array-contains) y el reparto entre
/// aceptadas y solicitudes se hace acá: montar dos consultas con índices
/// distintos para separar por estado no aporta nada a esta escala.
///
/// Lo bloqueado y lo rechazado se descarta en este punto y no en la
/// pantalla: si se filtrara más tarde, seguiría contando para el número
/// del menú, que es justo lo que la persona pidió no ver.
export async function fetchConversations(uid: string): Promise<Conversation[]> {
  const [snap, blocked] = await Promise.all([
    getDocs(
      query(
        collection(db, "conversations"),
        where("participants", "array-contains", uid),
        orderBy("lastMessageAt", "desc"),
        limit(MAX_CONVERSATIONS),
      ),
    ),
    fetchBlockedAuthorIds(uid).catch(() => new Set<string>()),
  ]);

  return snap.docs
    .map((d) => fromSnapshot(d.id, d.data()))
    .filter((conv) => {
      // Una conversación rechazada sobrevive como lápida para que quien
      // la abrió no pueda volver a intentarlo. No tiene por qué seguir
      // ocupando lugar en la lista de nadie.
      if (conv.status === "rejected") return false;
      return !blocked.has(otherParticipant(conv, uid));
    });
}

/// Cuántas conversaciones tienen algo sin leer. Alimenta el contador del
/// menú, así que tiene que coincidir exactamente con lo que después se
/// ve adentro — por eso reusa fetchConversations y no una consulta
/// propia que podría contar otra cosa.
export async function countUnreadConversations(uid: string): Promise<number> {
  const list = await fetchConversations(uid);
  return list.filter((conv) => hasUnread(conv, uid)).length;
}

export interface StartConversationResult {
  conversation: Conversation;
  /// true si la conversación se creó recién en esta llamada.
  created: boolean;
}

/// Abre una conversación, o devuelve la que ya existía.
///
/// El estado inicial NO lo decide esta función sola: pide "accepted"
/// cuando el destinatario ya sigue a quien escribe, y las reglas lo
/// verifican con un exists() sobre el documento de seguidor. Si el
/// cliente mintiera, la escritura se rechaza entera.
///
/// La dirección de ese "ya te sigue" importa y es fácil invertirla:
/// seguir a alguien NO lo autoriza a escribirte. Que te sigan a vos sí
/// es haber elegido escuchar a esa persona, y por eso su mensaje no
/// necesita pasar por Solicitudes.
export async function startConversation(params: {
  myUid: string;
  myName: string;
  otherUid: string;
  otherName: string;
  text: string;
}): Promise<StartConversationResult> {
  const { myUid, otherUid } = params;
  if (myUid === otherUid) throw new Error("No podés escribirte a vos mismo.");

  const text = params.text.trim().slice(0, MAX_DIRECT_MESSAGE);
  if (!text) throw new Error("Escribí algo antes de enviar.");

  const id = conversationId(myUid, otherUid);
  const existing = await fetchConversation(id);
  if (existing) {
    if (existing.status === "rejected") {
      throw new Error("Esta persona no quiere recibir mensajes tuyos.");
    }
    return { conversation: existing, created: false };
  }

  // ¿El destinatario ya me sigue? Si sí, el mensaje no es una
  // aproximación en frío y entra directo.
  let followsMe = false;
  try {
    const follower = await getDoc(
      doc(db, "public_profiles", myUid, "followers", otherUid),
    );
    followsMe = follower.exists();
  } catch {
    // Sin poder confirmarlo, se manda como solicitud: equivocarse hacia
    // el lado prudente cuesta un toque de "Aceptar", al revés cuesta un
    // mensaje que no debía notificar.
  }

  const participants = [myUid, otherUid].sort();
  const payload = {
    participants,
    names: {
      [myUid]: params.myName.slice(0, 30),
      [otherUid]: params.otherName.slice(0, 30),
    },
    startedBy: myUid,
    recipient: otherUid,
    status: followsMe ? "accepted" : "pending",
    openingText: text,
    createdAt: serverTimestamp(),
    lastMessageAt: serverTimestamp(),
    lastMessageText: text.slice(0, PREVIEW_LENGTH),
    lastMessageSenderUid: myUid,
    seenAt: {},
  };
  await setDoc(doc(db, "conversations", id), payload);

  const conversation = await fetchConversation(id);
  if (!conversation) throw new Error("No se pudo abrir la conversación.");
  return { conversation, created: true };
}

/// Acepta una solicitud. Solo puede hacerlo el destinatario, y solo
/// mientras esté pendiente: las reglas no dejan volver de "rejected".
export async function acceptConversation(convId: string): Promise<void> {
  await updateDoc(doc(db, "conversations", convId), { status: "accepted" });
}

/// Rechaza una solicitud. NO borra el documento a propósito: quedando
/// como "rejected", un create nuevo es imposible (crear exige que el
/// documento no exista) y esa persona no puede volver a escribirte.
/// Borrarlo dejaría el camino libre para insistir.
export async function rejectConversation(convId: string): Promise<void> {
  await updateDoc(doc(db, "conversations", convId), { status: "rejected" });
}

export async function fetchDirectMessages(
  convId: string,
  max = 100,
): Promise<DirectMessage[]> {
  const snap = await getDocs(
    query(messagesRef(convId), orderBy("createdAt", "asc"), limit(max)),
  );
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      senderUid: (data.senderUid as string) ?? "",
      senderName: (data.senderName as string) ?? "Alguien",
      text: (data.text as string) ?? "",
      createdAt: toDate(data.createdAt),
    };
  });
}

/// Manda un mensaje y deja el resumen en la conversación.
///
/// Son dos escrituras y no una transacción, igual que en el hilo de
/// colaboración: si la segunda falla, el mensaje ya quedó guardado y se
/// ve al abrir el hilo. Perder el aviso es mucho menos grave que perder
/// el mensaje.
export async function sendDirectMessage(params: {
  convId: string;
  senderUid: string;
  senderName: string;
  text: string;
}): Promise<void> {
  const text = params.text.trim().slice(0, MAX_DIRECT_MESSAGE);
  if (!text) return;
  await addDoc(messagesRef(params.convId), {
    senderUid: params.senderUid,
    senderName: params.senderName.slice(0, 30),
    text,
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(db, "conversations", params.convId), {
    lastMessageAt: serverTimestamp(),
    lastMessageText: text.slice(0, PREVIEW_LENGTH),
    lastMessageSenderUid: params.senderUid,
    [`names.${params.senderUid}`]: params.senderName.slice(0, 30),
  });
}

/// Marca la conversación como leída. Cada uno escribe SU propia clave
/// del mapa — las reglas no dejan tocar la del otro.
export async function markConversationSeen(
  convId: string,
  myUid: string,
): Promise<void> {
  await updateDoc(doc(db, "conversations", convId), {
    [`seenAt.${myUid}`]: serverTimestamp(),
  });
}

/// Vacía el hilo y borra la conversación, EN ESE ORDEN: Firestore no
/// borra subcolecciones en cascada, y al revés quedarían mensajes vivos
/// colgando de un padre inexistente, invisibles y ya inalcanzables.
///
/// Ojo: borrar deja el par libre para empezar de nuevo. Para sacarse a
/// alguien de encima de forma permanente está rechazar, no esto.
export async function deleteConversation(convId: string): Promise<void> {
  const snap = await getDocs(messagesRef(convId));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  await deleteDoc(doc(db, "conversations", convId));
}

/// Todas las conversaciones de una persona, sin filtrar por bloqueo ni
/// por estado. La usa la eliminación de cuenta, que tiene que llevarse
/// también lo rechazado y lo que venga de alguien bloqueado.
export async function fetchAllConversationIds(uid: string): Promise<string[]> {
  const snap = await getDocs(
    query(collection(db, "conversations"), where("participants", "array-contains", uid)),
  );
  return snap.docs.map((d) => d.id);
}
