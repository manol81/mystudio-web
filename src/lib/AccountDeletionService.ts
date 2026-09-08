// src/lib/AccountDeletionService.ts
//
// Eliminación de cuenta self-service — ESPEJO EXACTO de
// account_deletion_service.dart en la app Android (Google Play exige
// poder borrar la cuenta desde la app Y desde una URL web: esta es la
// URL, /cuenta/eliminar). Si se cambia un paso acá, cambiarlo también
// allá.
//
// Todo del lado del cliente con las reglas de Firestore/Storage (no hay
// Cloud Functions en el proyecto). Orden deliberado:
//   1. Re-autenticar con la contraseña (Firebase exige login reciente
//      para deleteUser, y de paso frena el clic accidental).
//   2. Borrar TODO lo que dejó el uid en la nube ANTES de borrar el
//      usuario de Auth — después ya no hay credenciales que pasen las
//      reglas y los datos quedarían huérfanos para siempre.
//   3. deleteUser al final.
// Si algo falla a mitad de camino la cuenta sigue existiendo y se
// puede reintentar: cada paso es idempotente.
//
// Lo que NO se puede borrar desde el cliente y queda (declarado en la
// política de privacidad): los "likes" que este usuario dio en posts
// ajenos (community_posts/*/likes/{uid}, un doc sin más dato que una
// fecha; no se puede consultar por id de doc en un collectionGroup) y
// los reportes de moderación que envió (reports, solo admin).

import {
  EmailAuthProvider,
  deleteUser,
  reauthenticateWithCredential,
  type User,
} from "firebase/auth";
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDocs,
  limit,
  query,
  where,
  writeBatch,
  type CollectionReference,
  type DocumentReference,
} from "firebase/firestore";
import { deleteObject, listAll, ref, type StorageReference } from "firebase/storage";
import { db, storage } from "@/lib/firebase";

export type AccountDeletionStep =
  | "reauthenticating"
  | "deletingCommunity"
  | "deletingProjects"
  | "deletingProfile"
  | "deletingAuthUser";

export const ACCOUNT_DELETION_STEP_LABELS: Record<AccountDeletionStep, string> = {
  reauthenticating: "Verificando tu contraseña…",
  deletingCommunity: "Borrando publicaciones y comentarios…",
  deletingProjects: "Borrando proyectos de la nube…",
  deletingProfile: "Borrando tu perfil…",
  deletingAuthUser: "Eliminando la cuenta…",
};

export class WrongPasswordError extends Error {
  constructor() {
    super("La contraseña no es correcta.");
    this.name = "WrongPasswordError";
  }
}

export async function deleteAccount(
  user: User,
  password: string,
  onProgress?: (step: AccountDeletionStep) => void,
): Promise<void> {
  if (!user.email) throw new Error("La cuenta no tiene email asociado.");
  const uid = user.uid;

  onProgress?.("reauthenticating");
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    if (
      code === "auth/wrong-password" ||
      code === "auth/invalid-credential" ||
      code === "auth/user-mismatch"
    ) {
      throw new WrongPasswordError();
    }
    throw err;
  }

  onProgress?.("deletingCommunity");
  await deleteCommunityFootprint(uid);

  onProgress?.("deletingProjects");
  await deleteStorageFolder(ref(storage, `users/${uid}/projects`));
  await deleteCollection(collection(db, "users", uid, "projects"));

  onProgress?.("deletingProfile");
  await deleteCollection(collection(db, "users", uid, "blockedUsers"));
  await deleteDoc(doc(db, "users", uid));

  onProgress?.("deletingAuthUser");
  await deleteUser(user);
}

/// Publicaciones propias (con sus likes/comentarios y su preview en
/// Storage) + comentarios propios en publicaciones ajenas.
async function deleteCommunityFootprint(uid: string): Promise<void> {
  const posts = await getDocs(
    query(collection(db, "community_posts"), where("authorId", "==", uid)),
  );
  for (const post of posts.docs) {
    // Subcolecciones primero: borrar el doc padre NO borra las
    // subcolecciones. firestore.rules deja al autor del post borrar
    // likes/comentarios ajenos dentro de SU post.
    await deleteCollection(collection(post.ref, "likes"));
    await deleteCollection(collection(post.ref, "comments"));
    await deleteDoc(post.ref);
  }
  await deleteStorageFolder(ref(storage, `community_previews/${uid}`));

  const comments = await getDocs(
    query(collectionGroup(db, "comments"), where("authorId", "==", uid)),
  );
  await deleteRefs(comments.docs.map((d) => d.ref));
}

async function deleteCollection(col: CollectionReference): Promise<void> {
  // De a páginas: un post viral puede tener miles de likes.
  for (;;) {
    const page = await getDocs(query(col, limit(400)));
    if (page.empty) return;
    await deleteRefs(page.docs.map((d) => d.ref));
    if (page.size < 400) return;
  }
}

async function deleteRefs(refs: DocumentReference[]): Promise<void> {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    for (const r of refs.slice(i, i + 400)) batch.delete(r);
    await batch.commit();
  }
}

async function deleteStorageFolder(folder: StorageReference): Promise<void> {
  let listing;
  try {
    listing = await listAll(folder);
  } catch (err) {
    if ((err as { code?: string }).code === "storage/object-not-found") return;
    throw err;
  }
  for (const item of listing.items) {
    try {
      await deleteObject(item);
    } catch (err) {
      if ((err as { code?: string }).code !== "storage/object-not-found") throw err;
    }
  }
  for (const prefix of listing.prefixes) await deleteStorageFolder(prefix);
}
