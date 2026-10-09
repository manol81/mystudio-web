// src/lib/profilePhoto.ts
//
// La foto de perfil (2026-10-09). Vive en Storage, en
// `avatars/{uid}/avatar.jpg` (lectura pública, ver storage.rules), y su
// URL en `public_profiles/{uid}.photoUrl` — el documento PÚBLICO, porque
// la ve cualquiera en el feed y en los perfiles, también sin sesión.
//
// NO se copia a cada publicación ni a cada comentario: quedaría vieja
// apenas la persona la cambia, y propagarla obligaría a reescribir todo
// lo que publicó. Se lee del perfil, con una caché por autor
// (`usePhotoUrl`), así que un feed con ocho tarjetas de tres personas
// hace tres lecturas.

import { useEffect, useState } from "react";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { ensurePublicProfile } from "@/lib/PublicProfileService";
import { resizeImage, withVersion } from "@/lib/imageUpload";

export function avatarPath(uid: string): string {
  return `avatars/${uid}/avatar.jpg`;
}

// ─── Caché por autor ─────────────────────────────────────────────────────

// Lo que se cachea del perfil público: la foto y si es PRO (el sello
// del feed y los beneficios, ver onUserProChanged en functions).
interface PublicFlags {
  photoUrl: string | null;
  isPro: boolean;
}

const cache = new Map<string, Promise<PublicFlags>>();
const listeners = new Map<string, Set<(url: string | null) => void>>();

function loadFlags(uid: string): Promise<PublicFlags> {
  let p = cache.get(uid);
  if (!p) {
    p = getDoc(doc(db, "public_profiles", uid))
      .then((snap) => ({
        photoUrl: snap.exists() ? ((snap.data().photoUrl as string) ?? null) : null,
        isPro: snap.exists() && snap.data().isPro === true,
      }))
      .catch(() => ({ photoUrl: null, isPro: false }));
    cache.set(uid, p);
  }
  return p;
}

function loadPhotoUrl(uid: string): Promise<string | null> {
  return loadFlags(uid).then((f) => f.photoUrl);
}

/// ¿Es PRO para el servidor? (`public_profiles.isPro`). false mientras carga.
export function useIsPro(uid: string | null | undefined): boolean {
  const [isPro, setIsPro] = useState(false);
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    void loadFlags(uid).then((f) => {
      if (alive) setIsPro(f.isPro);
    });
    return () => {
      alive = false;
    };
  }, [uid]);
  return uid ? isPro : false;
}

/// Avisa a todas las tarjetas de esa persona que la foto cambió (al
/// subir o sacar la propia, sin recargar la página).
function publish(uid: string, url: string | null) {
  const prev = cache.get(uid) ?? Promise.resolve({ photoUrl: null, isPro: false });
  cache.set(uid, prev.then((f) => ({ ...f, photoUrl: url })));
  listeners.get(uid)?.forEach((fn) => fn(url));
}

/// La foto de una persona, o null si no tiene (o mientras carga).
export function usePhotoUrl(uid: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    void loadPhotoUrl(uid).then((u) => {
      if (alive) setUrl(u);
    });
    const set = listeners.get(uid) ?? new Set();
    const fn = (u: string | null) => setUrl(u);
    set.add(fn);
    listeners.set(uid, set);
    return () => {
      alive = false;
      set.delete(fn);
    };
  }, [uid]);
  return uid ? url : null;
}

// ─── Subir y sacar ───────────────────────────────────────────────────────

/// Sube la foto (recortada al cuadrado y achicada a 512 px) y la deja en
/// el perfil público. Necesita apodo: el perfil público lo exige.
export async function setProfilePhoto(uid: string, username: string, file: File): Promise<string> {
  const blob = await resizeImage(file, { maxSide: 512, square: true });
  const objectRef = ref(storage, avatarPath(uid));
  await uploadBytes(objectRef, blob, { contentType: "image/jpeg" });
  const url = withVersion(await getDownloadURL(objectRef));
  // El perfil público puede no existir todavía (quien eligió apodo antes
  // de que existiera ensurePublicProfile): se crea primero, porque las
  // reglas validan el documento entero.
  await ensurePublicProfile(uid, username);
  await setDoc(
    doc(db, "public_profiles", uid),
    { photoUrl: url, updatedAt: serverTimestamp() },
    { merge: true },
  );
  publish(uid, url);
  return url;
}

export async function removeProfilePhoto(uid: string): Promise<void> {
  await setDoc(
    doc(db, "public_profiles", uid),
    { photoUrl: null, updatedAt: serverTimestamp() },
    { merge: true },
  );
  publish(uid, null);
  try {
    await deleteObject(ref(storage, avatarPath(uid)));
  } catch (err) {
    // Que no exista es un final válido; cualquier otra falla deja un
    // archivo huérfano, no un perfil roto: no vale la pena frenar.
    if ((err as { code?: string }).code !== "storage/object-not-found") {
      console.error("No se pudo borrar la foto vieja:", err);
    }
  }
}

// ─── Banner del perfil ampliado (PRO, 2026-10-09) ────────────────────────
//
// Mismo esquema que la foto: `banners/{uid}/banner.jpg` y
// `public_profiles/{uid}.bannerUrl`. Que sea PRO lo exigen las reglas de
// Firestore al guardar la URL (si no es PRO, la escritura falla y el
// archivo queda huérfano: por eso la pantalla solo lo ofrece a PRO).

export function bannerPath(uid: string): string {
  return `banners/${uid}/banner.jpg`;
}

export async function setProfileBanner(uid: string, file: File): Promise<string> {
  const blob = await resizeImage(file, { maxSide: 1600 });
  const objectRef = ref(storage, bannerPath(uid));
  await uploadBytes(objectRef, blob, { contentType: "image/jpeg" });
  const url = withVersion(await getDownloadURL(objectRef));
  await setDoc(doc(db, "public_profiles", uid), { bannerUrl: url, updatedAt: serverTimestamp() }, { merge: true });
  return url;
}

export async function removeProfileBanner(uid: string): Promise<void> {
  await setDoc(doc(db, "public_profiles", uid), { bannerUrl: null, updatedAt: serverTimestamp() }, { merge: true });
  try {
    await deleteObject(ref(storage, bannerPath(uid)));
  } catch (err) {
    if ((err as { code?: string }).code !== "storage/object-not-found") {
      console.error("No se pudo borrar el banner viejo:", err);
    }
  }
}
