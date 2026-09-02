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
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  Timestamp,
  updateDoc,
  type QueryDocumentSnapshot,
  type DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

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
    title: (data.title as string) ?? "Sin título",
    authorName: (data.authorName as string) ?? "Usuario",
    audioUrl: (data.audioUrl as string) ?? "",
  };
}
