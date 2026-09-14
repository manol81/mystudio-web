// src/lib/AdminService.ts
//
// Operaciones exclusivas de administración — todas dependen de que la
// cuenta tenga el custom claim admin:true (ver firestore.rules /
// scripts/set-admin-claim.mjs), sin eso cualquier llamada acá falla
// con permission-denied. La UI que las usa ya filtra el acceso con
// useAdminCheck() antes de mostrarse, pero la seguridad REAL vive en
// las reglas del servidor, no en que la pantalla esté oculta.

import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  Timestamp,
  updateDoc,
  where,
  type CollectionReference,
  type QueryDocumentSnapshot,
  type DocumentData,
} from "firebase/firestore";
import { deleteObject, ref as storageRef } from "firebase/storage";
import { db, storage } from "@/lib/firebase";

export interface Report {
  id: string;
  postId: string;
  reportedAuthorId: string;
  reporterId: string;
  reason: string;
  details: string;
  status: string;
  createdAt: Timestamp | null;
}

function toReport(d: QueryDocumentSnapshot<DocumentData>): Report {
  const data = d.data();
  return {
    id: d.id,
    postId: (data.postId as string) ?? "",
    reportedAuthorId: (data.reportedAuthorId as string) ?? "",
    reporterId: (data.reporterId as string) ?? "",
    reason: (data.reason as string) ?? "",
    details: (data.details as string) ?? "",
    status: (data.status as string) ?? "pending",
    createdAt: (data.createdAt as Timestamp) ?? null,
  };
}

export async function fetchReports(): Promise<Report[]> {
  const snapshot = await getDocs(query(collection(db, "reports"), orderBy("createdAt", "desc")));
  return snapshot.docs.map(toReport);
}

export async function updateReportStatus(
  reportId: string,
  status: "reviewed" | "dismissed",
): Promise<void> {
  await updateDoc(doc(db, "reports", reportId), { status });
}

export interface ReportedPost {
  id: string;
  // El uid del autor REAL del post, leído del post mismo. El reporte
  // trae un `reportedAuthorId`, pero lo escribió quien denunció: sirve
  // para agrupar, no para decidir qué archivos de Storage borrar. Las
  // rutas del preview y del ZIP de pistas se arman con este.
  authorId: string;
  title: string;
  authorName: string;
  audioUrl: string;
}

/// El reporte solo guarda el `postId` (ver firestore.rules — reports y
/// community_posts son colecciones separadas a propósito, ninguna
/// depende de la otra para existir), así que para "descargar el
/// proyecto reclamado" hace falta resolver el post primero. null si el
/// post ya no existe (por ejemplo, si el autor lo borró después de
/// publicarlo).
export async function fetchReportedPost(postId: string): Promise<ReportedPost | null> {
  const snap = await getDoc(doc(db, "community_posts", postId));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    id: snap.id,
    authorId: (data.authorId as string) ?? "",
    title: (data.title as string) ?? "Sin título",
    authorName: (data.authorName as string) ?? "Usuario",
    audioUrl: (data.audioUrl as string) ?? "",
  };
}

// ─── Estadísticas ────────────────────────────────────────────────────
//
// Conteos directos de Firestore vía getCountFromServer — factura como
// UNA lectura sin importar cuántos documentos haya la colección, no
// hace falta bajarlos todos para mostrar un número. Deliberadamente
// NO incluye "usuarios activos por fecha" ni "tendencias": eso ya lo
// da Firebase Analytics (conectado desde el principio, ver
// lib/firebase.ts) sin escribir una sola línea de código — reconstruir
// ese tipo de dashboard acá sería duplicar algo que ya existe gratis.
// Tampoco incluye "espacio disponible en Storage/Firestore": es
// información de facturación de Google Cloud, ningún SDK de cliente
// la expone — se ve en Firebase Console → Uso y Facturación.

export interface PlatformStats {
  usersCount: number;
  postsCount: number;
  samplesCount: number;
  totalReportsCount: number;
  pendingReportsCount: number;
}

export async function fetchPlatformStats(): Promise<PlatformStats> {
  const [users, posts, samples, totalReports, pendingReports] = await Promise.all([
    getCountFromServer(collection(db, "users")),
    getCountFromServer(collection(db, "community_posts")),
    getCountFromServer(collection(db, "samples")),
    getCountFromServer(collection(db, "reports")),
    getCountFromServer(query(collection(db, "reports"), where("status", "==", "pending"))),
  ]);
  return {
    usersCount: users.data().count,
    postsCount: posts.data().count,
    samplesCount: samples.data().count,
    totalReportsCount: totalReports.data().count,
    pendingReportsCount: pendingReports.data().count,
  };
}

// ─── Moderación: borrar una publicación ajena ────────────────────────
//
// Hasta ahora el panel de reportes solo podía marcar un reporte como
// "revisado": el contenido denunciado seguía publicado, y la única
// salida real era pedirle al autor que lo borrara o entrar a mano por
// Firebase Console. Las reglas ahora dejan borrar al admin (ver la
// función isAdmin() en firestore.rules), acá está el barrido completo.
//
// Lo que NO se toca, a propósito: el `.mystudio` del autor en
// `users/{uid}/projects`. Eso es su proyecto, no la publicación —
// despublicar no es confiscarle el trabajo. Lo que sí se va es todo lo
// que existía SOLO por estar publicado: el preview y el ZIP de pistas,
// los dos de lectura pública.

export interface AdminDeletePostResult {
  likes: number;
  comments: number;
  collabRequests: number;
  storageObjects: number;
}

/// Borra una publicación con TODO lo que cuelga de ella.
///
/// Firestore no borra subcolecciones en cascada: si se borrara solo el
/// documento, los likes, comentarios, pedidos de colaboración y sus
/// hilos quedarían vivos colgando de un padre inexistente — invisibles
/// desde la app y ya imposibles de alcanzar para borrarlos después. Por
/// eso el documento padre se borra ÚLTIMO: si algo falla a mitad de
/// camino, el post sigue ahí y se puede reintentar.
export async function deletePostAsAdmin(post: {
  id: string;
  authorId: string;
}): Promise<AdminDeletePostResult> {
  const postRef = doc(db, "community_posts", post.id);
  const result: AdminDeletePostResult = {
    likes: 0,
    comments: 0,
    collabRequests: 0,
    storageObjects: 0,
  };

  result.likes = await deleteEntireCollection(collection(postRef, "likes"));
  result.comments = await deleteEntireCollection(collection(postRef, "comments"));

  // El hilo de mensajes vive DENTRO de cada pedido, así que se vacía
  // antes de borrar el pedido — al revés quedarían huérfanos.
  const requests = await getDocs(collection(postRef, "collab_requests"));
  for (const request of requests.docs) {
    await deleteEntireCollection(collection(request.ref, "messages"));
    await deleteDoc(request.ref);
    result.collabRequests++;
  }

  // Rutas EXACTAS, sin listar la carpeta: las reglas de Storage dan
  // permiso sobre el objeto, no sobre el prefijo (mismo criterio que
  // AccountDeletionService con las pistas de colaboración). Que un
  // archivo no exista es un final válido, no un error: las
  // publicaciones viejas no tienen ZIP de pistas, y un preview puede
  // haber fallado al generarse.
  for (const path of [
    `community_previews/${post.authorId}/${post.id}`,
    `community_stems/${post.authorId}/${post.id}.zip`,
  ]) {
    try {
      await deleteObject(storageRef(storage, path));
      result.storageObjects++;
    } catch (err) {
      if ((err as { code?: string }).code !== "storage/object-not-found") throw err;
    }
  }

  await deleteDoc(postRef);
  return result;
}

/// Vacía una colección de a páginas y devuelve cuántos documentos
/// borró. De a 400 porque un post con suerte puede tener miles de
/// likes y un `getDocs` sin límite los traería todos a memoria.
async function deleteEntireCollection(col: CollectionReference): Promise<number> {
  let total = 0;
  for (;;) {
    const page = await getDocs(query(col, limit(400)));
    if (page.empty) return total;
    await Promise.all(page.docs.map((d) => deleteDoc(d.ref)));
    total += page.size;
    if (page.size < 400) return total;
  }
}

// ─── Edición de un sample ya publicado ───────────────────────────────
//
// Corregir un BPM mal cargado obligaba a borrar el sample y volver a
// subirlo: perdías el id, la fecha de alta y el archivo tenía que
// viajar de nuevo. Ninguno de estos cuatro campos describe al AUDIO,
// solo cómo se lo encuentra — cambiarlos no invalida el archivo.
//
// `audioPath` y `sizeBytes` quedan deliberadamente afuera: son el
// vínculo con el objeto real en Storage. Reescribirlos desde un
// formulario dejaría la ficha apuntando a un archivo que no existe, y
// el sample se vería en el catálogo pero no sonaría.

export interface SampleMetadataPatch {
  name: string;
  type: string;
  instrument: string;
  genre: string;
  bpm: number;
  key: string;
}

export async function updateSampleMetadata(
  sampleId: string,
  patch: SampleMetadataPatch,
): Promise<void> {
  await updateDoc(doc(db, "samples", sampleId), { ...patch });
}
