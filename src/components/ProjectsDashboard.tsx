"use client";

// Dashboard de proyectos — lee en tiempo real
// /users/{uid}/projects (ver firestore.rules), la MISMA colección que
// escribe CloudSyncService.uploadProject() del lado de Flutter. No hay
// backend propio: esta pantalla es un consumidor más de la misma fuente
// de verdad que ya usa la app.
//
// Vista de Lista (reemplaza la cuadrícula original): una fila por
// proyecto, info a la izquierda (nombre, fecha, BPM) y acciones
// agrupadas a la derecha — "▶ Escuchar" (preview rápido con
// ProjectViewer, sin entrar al editor) para reconocer de oído cuál
// proyecto es cuál antes de comprometerse a abrirlo, más Editar/Descargar.

import { useEffect, useState } from "react";
import { collection, onSnapshot, type Timestamp } from "firebase/firestore";
import { ref, getDownloadURL } from "firebase/storage";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { db, storage } from "@/lib/firebase";
import { ProjectViewer } from "@/components/ProjectViewer";
import { PublishModal } from "@/components/PublishModal";

interface CloudProject {
  cloudId: string;
  title: string;
  tempoBpm: number;
  updatedAt: Timestamp | null;
  sizeBytes: number;
  storagePath: string;
}

function formatDate(updatedAt: Timestamp | null): string {
  if (!updatedAt) return "Sin fecha";
  return updatedAt.toDate().toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function ProjectsDashboard() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<CloudProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [viewingProject, setViewingProject] = useState<CloudProject | null>(null);
  const [publishingProject, setPublishingProject] = useState<CloudProject | null>(null);

  useEffect(() => {
    if (!user) return;

    const unsubscribe = onSnapshot(
      collection(db, "users", user.uid, "projects"),
      (snapshot) => {
        setProjects(
          snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
              cloudId: doc.id,
              title: (data.title as string) ?? "",
              tempoBpm: (data.tempoBpm as number) ?? 120,
              updatedAt: (data.updatedAt as Timestamp) ?? null,
              sizeBytes: (data.sizeBytes as number) ?? 0,
              storagePath: (data.storagePath as string) ?? "",
            };
          }),
        );
        setLoading(false);
      },
      () => setLoading(false),
    );

    return unsubscribe;
  }, [user]);

  async function handleDownload(project: CloudProject) {
    setDownloadingId(project.cloudId);
    try {
      const url = await getDownloadURL(ref(storage, project.storagePath));
      // El bucket de Storage no está bajo nuestro dominio, así que un
      // <a download> normal no controla el nombre de archivo final (el
      // navegador respeta el que venga del bucket) — igual abre el flujo
      // de descarga nativo del navegador, que es lo que importa acá.
      const link = document.createElement("a");
      link.href = url;
      link.rel = "noopener noreferrer";
      link.click();
    } finally {
      setDownloadingId(null);
    }
  }

  if (loading) {
    return (
      <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-graphite p-8 text-center">
        <p className="text-xs text-white/40">Cargando proyectos...</p>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-graphite p-8 text-center">
        <p className="font-display text-sm font-semibold uppercase tracking-widest text-white/40">
          Tus Proyectos
        </p>
        <p className="mt-2 text-xs text-white/30">
          Todavía no sincronizaste ningún proyecto desde la app.
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-2.5">
      {projects.map((project) => (
        <div
          key={project.cloudId}
          className="flex flex-col gap-3 rounded-xl border border-white/10 bg-graphite px-5 py-4 text-left transition-colors duration-200 hover:border-neon-cyan/30 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
        >
          <div className="min-w-0">
            <p className="truncate font-display text-base font-semibold text-white">
              {project.title || "Sin título"}
            </p>
            <p className="mt-1 text-xs text-white/40">
              {formatDate(project.updatedAt)} · {Math.round(project.tempoBpm)} BPM
            </p>
          </div>

          {/* Grupo de acciones — flex-wrap + whitespace-nowrap en cada
              botón: en pantallas angostas los botones bajan de línea
              como bloque entero, nunca se cortan a mitad de texto. */}
          <div className="flex flex-wrap gap-2 sm:shrink-0 sm:flex-nowrap">
            <button
              type="button"
              onClick={() => setViewingProject(project)}
              className="flex items-center justify-center gap-1 whitespace-nowrap rounded-full border border-neon-cyan/30 bg-neon-cyan/10 px-4 py-1.5 text-xs font-semibold text-neon-cyan transition-all duration-200 hover:border-neon-cyan hover:shadow-[0_0_14px_rgba(102,252,241,0.35)]"
            >
              ▶ Escuchar
            </button>
            <Link
              href={`/arranger?open=${encodeURIComponent(project.cloudId)}`}
              className="flex items-center justify-center gap-1 whitespace-nowrap rounded-full border border-white/20 px-4 py-1.5 text-xs font-semibold text-white/70 transition-all duration-200 hover:border-neon-cyan/50 hover:text-neon-cyan"
            >
              ✎ Editar en Arranger
            </Link>
            <button
              type="button"
              onClick={() => handleDownload(project)}
              disabled={downloadingId === project.cloudId}
              className="flex items-center justify-center gap-2 whitespace-nowrap rounded-full border border-neon-cyan/30 px-4 py-1.5 text-xs font-semibold text-neon-cyan transition-all duration-200 hover:border-neon-cyan hover:shadow-[0_0_14px_rgba(102,252,241,0.35)] disabled:opacity-50"
            >
              {downloadingId === project.cloudId ? "..." : "↓ Descargar"}
            </button>
            <button
              type="button"
              onClick={() => setPublishingProject(project)}
              className="flex items-center justify-center gap-1 whitespace-nowrap rounded-full border border-white/20 px-4 py-1.5 text-xs font-semibold text-white/70 transition-all duration-200 hover:border-neon-cyan/50 hover:text-neon-cyan"
            >
              🌐 Publicar en Comunidad
            </button>
          </div>
        </div>
      ))}

      {viewingProject && (
        <ProjectViewer
          projectId={viewingProject.cloudId}
          storagePath={viewingProject.storagePath}
          title={viewingProject.title}
          onClose={() => setViewingProject(null)}
        />
      )}

      {publishingProject && (
        <PublishModal
          project={{
            cloudId: publishingProject.cloudId,
            title: publishingProject.title,
            storagePath: publishingProject.storagePath,
          }}
          onClose={() => setPublishingProject(null)}
        />
      )}
    </div>
  );
}
