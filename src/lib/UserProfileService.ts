// src/lib/UserProfileService.ts
//
// Perfil de usuario en Firestore (/users/{uid}) — hasta ahora ese doc
// NUNCA se creaba (solo existían subcolecciones como
// /users/{uid}/projects, nunca el doc padre en sí). De paso que
// habilita el nickname, esta es la primera vez que el proyecto tiene
// un registro real por cuenta — también sirve para poder CONTAR
// cuántos usuarios están registrados (ver panel de admin / BI).
//
// Privado por diseño (mismas reglas ya existentes de /users/{uid}:
// solo el propio dueño puede leer/escribir) — el nickname viaja
// DENORMALIZADO como copia en cada community_post/comment al momento
// de crearlo (mismo criterio que authorName ya usaba con el email
// antes de esto), así que nadie necesita leer el perfil de OTRO
// usuario para ver su nombre público.
//
// Sin unicidad de nickname en esta primera versión a propósito — dos
// usuarios podrían elegir el mismo nombre. Forzar unicidad real
// necesitaría una colección de reserva aparte (transacción atómica
// sobre un doc "usernames/{nombreEnMinusculas}") — se puede sumar más
// adelante si hace falta (ej. para búsqueda de perfiles), no es
// necesario para que el nickname cumpla su función actual: dejar de
// mostrar el email real en público.

import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface UserProfile {
  email: string | null;
  username: string | null;
  /// Hasta cuándo el usuario vio sus notificaciones. Todo lo posterior
  /// cuenta como sin leer (ver NotificationsService.ts).
  notificationsSeenAt: Date | null;
}

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;

export function isValidUsername(value: string): boolean {
  return USERNAME_PATTERN.test(value);
}

/// Crea el doc de perfil si todavía no existe — se llama una vez por
/// sesión desde AuthContext al detectar sesión iniciada. No pisa un
/// username ya elegido si por lo que sea se llama de nuevo (por eso
/// primero chequea existencia, no usa un set con merge ciego).
export async function ensureUserProfile(uid: string, email: string | null): Promise<void> {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return;
  await setDoc(ref, { email, username: null, createdAt: serverTimestamp() });
}

export interface UsernamePropagation {
  posts: number;
  comments: number;
}

/// Guarda el apodo y lo PROPAGA a las copias denormalizadas en las
/// publicaciones y comentarios propios (ver comentario de cabecera:
/// authorName viaja como copia en cada doc). Sin esto, cambiar el
/// apodo dejaba el viejo en todo lo ya publicado — y los posts
/// anteriores a que existieran los apodos quedaron con el EMAIL como
/// authorName, visible en un feed que ahora es público.
///
/// firestore.rules permite este update solo al autor y solo al valor
/// exacto de users/{uid}.username — por eso el perfil se escribe
/// PRIMERO y recién después se tocan posts/comentarios. La propagación
/// es best-effort: si falla, el apodo igual quedó guardado.
export async function setUsername(uid: string, username: string): Promise<UsernamePropagation> {
  await setDoc(doc(db, "users", uid), { username, updatedAt: serverTimestamp() }, { merge: true });
  return propagateUsername(uid, username);
}

async function propagateUsername(uid: string, username: string): Promise<UsernamePropagation> {
  const result: UsernamePropagation = { posts: 0, comments: 0 };
  try {
    const [postsSnap, commentsSnap] = await Promise.all([
      getDocs(query(collection(db, "community_posts"), where("authorId", "==", uid))),
      getDocs(query(collectionGroup(db, "comments"), where("authorId", "==", uid))),
    ]);
    const stale = [...postsSnap.docs, ...commentsSnap.docs].filter(
      (d) => (d.data().authorName as string | undefined) !== username,
    );
    // writeBatch acepta hasta 500 operaciones — de a lotes por si
    // alguien tiene más publicaciones/comentarios que eso.
    for (let i = 0; i < stale.length; i += 400) {
      const batch = writeBatch(db);
      for (const d of stale.slice(i, i + 400)) batch.update(d.ref, { authorName: username });
      await batch.commit();
    }
    result.posts = stale.filter((d) => d.ref.parent.id === "community_posts").length;
    result.comments = stale.length - result.posts;
  } catch (err) {
    console.error("No se pudo propagar el apodo a publicaciones/comentarios:", err);
  }
  return result;
}

/// Suscripción en tiempo real al perfil PROPIO — un cambio de nickname
/// se refleja al instante en toda la app (sidebar, modal de publicar,
/// etc.) sin recargar. Usado desde AuthContext.
export function watchUserProfile(
  uid: string,
  onChange: (profile: UserProfile | null) => void,
): Unsubscribe {
  return onSnapshot(doc(db, "users", uid), (snap) => {
    if (!snap.exists()) {
      onChange(null);
      return;
    }
    const data = snap.data();
    const seenAt = data.notificationsSeenAt;
    onChange({
      email: (data.email as string) ?? null,
      username: (data.username as string) ?? null,
      notificationsSeenAt:
        seenAt && typeof seenAt.toDate === "function" ? seenAt.toDate() : null,
    });
  });
}
