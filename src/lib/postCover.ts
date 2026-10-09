// src/lib/postCover.ts
//
// La imagen de portada de una publicación (2026-10-09): lo que hace que
// el feed no sea una lista de reproductores iguales. Vive en
// `community_covers/{authorId}/{postId}.jpg` (lectura pública, ver
// storage.rules) y su URL en `community_posts/{postId}.coverUrl`, que el
// autor puede poner, cambiar o sacar cuando quiera.
//
// Se sube DESPUÉS de crear el post —la ruta lleva su id—, igual que el
// preview y el paquete de pistas. Si falla, la publicación queda igual,
// con la portada generada (ver PostCover en PostCard.tsx).

import { doc, updateDoc } from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { resizeImage, withVersion } from "@/lib/imageUpload";

export function postCoverPath(authorId: string, postId: string): string {
  return `community_covers/${authorId}/${postId}.jpg`;
}

/// Achica la imagen (1200 px de lado mayor, sin recortar: la tarjeta la
/// encuadra con object-cover), la sube y la deja en la publicación.
export async function setPostCover(
  post: { id: string; authorId: string },
  file: Blob,
): Promise<string> {
  const blob = await resizeImage(file, { maxSide: 1200 });
  const objectRef = ref(storage, postCoverPath(post.authorId, post.id));
  await uploadBytes(objectRef, blob, { contentType: "image/jpeg" });
  const url = withVersion(await getDownloadURL(objectRef));
  await updateDoc(doc(db, "community_posts", post.id), { coverUrl: url });
  return url;
}

export async function removePostCover(post: { id: string; authorId: string }): Promise<void> {
  await updateDoc(doc(db, "community_posts", post.id), { coverUrl: null });
  try {
    await deleteObject(ref(storage, postCoverPath(post.authorId, post.id)));
  } catch (err) {
    if ((err as { code?: string }).code !== "storage/object-not-found") {
      console.error("No se pudo borrar la portada vieja:", err);
    }
  }
}
