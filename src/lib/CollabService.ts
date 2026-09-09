// src/lib/CollabService.ts
//
// Pedidos de colaboración: alguien quiere sumar su instrumento a una
// canción publicada, el autor acepta o rechaza.
//
// La idea de fondo es que el colaborador NO graba en el navegador. Ahí
// no hay forma de compensar la latencia y su pista llegaría corrida;
// la app Android ya resuelve eso con el motor nativo y la calibración.
// Lo que da el permiso es el derecho a sumarse: el colaborador escucha
// el tema con el paquete liviano de pistas, que ya es público, graba lo
// suyo en la app y se lo manda al autor, que lo suma a su proyecto real
// en buena calidad. Por eso acá no viaja audio, solo la intención.
//
// Un documento por persona y por publicación, con el uid de quien pide
// como ID: nadie puede llenar de pedidos la misma canción. `postAuthorId`
// va denormalizado y validado en las reglas contra el autor real, que es
// lo que permite al autor listar de una sola consulta todo lo que
// recibió (mismo patrón que las notificaciones).

import {
  collectionGroup,
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

export type CollabStatus = "pending" | "accepted" | "rejected";

/// Cuántos días vive la pista que manda el colaborador antes de
/// borrarse. Es corto a propósito: un audio en buena calidad son
/// decenas de MB y el plan gratuito son 5 GB en total. El autor tiene
/// que bajarla a su app dentro de ese plazo.
///
/// ⚠️ El borrado REAL lo hace una regla de ciclo de vida del bucket,
/// configurada a mano en la consola de Google Cloud sobre el prefijo
/// `collab_deliveries/` — sin Cloud Functions no hay ningún proceso que
/// pueda correr solo. Acá se calcula la fecha, se muestran los días que
/// quedan y se deja de ofrecer lo vencido.
export const DELIVERY_LIFETIME_DAYS = 7;

/// Días que le quedan a una entrega, redondeando hacia arriba. 0 o
/// menos significa vencida.
export function daysUntilExpiry(expiresAt: Date | null): number {
  if (!expiresAt) return 0;
  return Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000);
}

export function isDeliveryExpired(expiresAt: Date | null): boolean {
  return daysUntilExpiry(expiresAt) <= 0;
}

export interface CollabRequest {
  postId: string;
  requesterUid: string;
  requesterName: string;
  postAuthorId: string;
  /// Qué instrumento o voz propone aportar (ver collabRoles.ts).
  role: string;
  message: string;
  status: CollabStatus;
  createdAt: Date | null;
  /// Audio que grabó el colaborador en la app, null hasta que lo manda.
  deliveryUrl: string | null;
  deliveredAt: Date | null;
  /// Cuándo deja de estar disponible. Ver DELIVERY_LIFETIME_DAYS.
  expiresAt: Date | null;
  /// Cuándo el autor la bajó a su app. Sirve para dejar de insistirle
  /// con el aviso de vencimiento.
  downloadedAt: Date | null;
}

export const MAX_COLLAB_MESSAGE = 500;

function toRequest(
  postId: string,
  id: string,
  data: Record<string, unknown>,
): CollabRequest {
  const createdAt = data.createdAt;
  return {
    postId,
    requesterUid: (data.requesterUid as string) ?? id,
    requesterName: (data.requesterName as string) ?? "Alguien",
    postAuthorId: (data.postAuthorId as string) ?? "",
    role: (data.role as string) ?? "",
    message: (data.message as string) ?? "",
    status: (data.status as CollabStatus) ?? "pending",
    createdAt: createdAt instanceof Timestamp ? createdAt.toDate() : null,
    deliveryUrl: (data.deliveryUrl as string) ?? null,
    deliveredAt: data.deliveredAt instanceof Timestamp ? data.deliveredAt.toDate() : null,
    expiresAt: data.expiresAt instanceof Timestamp ? data.expiresAt.toDate() : null,
    downloadedAt:
      data.downloadedAt instanceof Timestamp ? data.downloadedAt.toDate() : null,
  };
}

/// Crea el pedido. Si ya existe uno de esta persona en esta canción, las
/// reglas rechazan la escritura por el `createdAt == request.time` del
/// create, así que conviene chequear antes con `fetchMyRequest`.
export async function requestCollaboration(params: {
  postId: string;
  postAuthorId: string;
  requesterUid: string;
  requesterName: string;
  role: string;
  message: string;
}): Promise<void> {
  await setDoc(
    doc(db, "community_posts", params.postId, "collab_requests", params.requesterUid),
    {
      requesterUid: params.requesterUid,
      requesterName: params.requesterName,
      postAuthorId: params.postAuthorId,
      role: params.role,
      message: params.message.slice(0, MAX_COLLAB_MESSAGE),
      status: "pending",
      createdAt: serverTimestamp(),
    },
  );
}

export async function fetchMyRequest(
  postId: string,
  requesterUid: string,
): Promise<CollabRequest | null> {
  const snap = await getDoc(
    doc(db, "community_posts", postId, "collab_requests", requesterUid),
  );
  if (!snap.exists()) return null;
  return toRequest(postId, snap.id, snap.data());
}

/// Cancela el pedido propio.
export async function cancelCollaboration(
  postId: string,
  requesterUid: string,
): Promise<void> {
  await deleteDoc(doc(db, "community_posts", postId, "collab_requests", requesterUid));
}

/// Acepta o rechaza. Las reglas solo dejan hacerlo al autor del post.
export async function respondToCollaboration(
  postId: string,
  requesterUid: string,
  status: Exclude<CollabStatus, "pending">,
): Promise<void> {
  await updateDoc(
    doc(db, "community_posts", postId, "collab_requests", requesterUid),
    { status },
  );
}

/// Adjunta la pista que el colaborador grabó en la app. El archivo ya
/// tiene que estar subido a `collab_deliveries/{uid}/{postId}`. Las
/// reglas solo lo permiten si el pedido está aceptado.
export async function attachDelivery(
  postId: string,
  requesterUid: string,
  deliveryUrl: string,
): Promise<void> {
  const expiresAt = new Date(Date.now() + DELIVERY_LIFETIME_DAYS * 86_400_000);
  await updateDoc(doc(db, "community_posts", postId, "collab_requests", requesterUid), {
    deliveryUrl,
    deliveredAt: serverTimestamp(),
    expiresAt: Timestamp.fromDate(expiresAt),
  });
}

/// El autor marca que ya se la bajó a su app. A partir de ahí deja de
/// verse el aviso de vencimiento.
export async function markDeliveryDownloaded(
  postId: string,
  requesterUid: string,
): Promise<void> {
  await updateDoc(doc(db, "community_posts", postId, "collab_requests", requesterUid), {
    downloadedAt: serverTimestamp(),
  });
}

/// Todo lo que recibieron las publicaciones de esta persona.
export async function fetchReceivedRequests(
  postAuthorId: string,
  max = 50,
): Promise<CollabRequest[]> {
  const snap = await getDocs(
    query(
      collectionGroup(db, "collab_requests"),
      where("postAuthorId", "==", postAuthorId),
      orderBy("createdAt", "desc"),
      limit(max),
    ),
  );
  return snap.docs.flatMap((d) => {
    const postId = d.ref.parent.parent?.id;
    return postId ? [toRequest(postId, d.id, d.data())] : [];
  });
}

/// Los pedidos que hizo esta persona, para saber en qué quedó cada uno.
export async function fetchSentRequests(
  requesterUid: string,
  max = 50,
): Promise<CollabRequest[]> {
  const snap = await getDocs(
    query(
      collectionGroup(db, "collab_requests"),
      where("requesterUid", "==", requesterUid),
      orderBy("createdAt", "desc"),
      limit(max),
    ),
  );
  return snap.docs.flatMap((d) => {
    const postId = d.ref.parent.parent?.id;
    return postId ? [toRequest(postId, d.id, d.data())] : [];
  });
}
