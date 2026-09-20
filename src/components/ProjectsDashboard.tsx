"use client";

// Dashboard de proyectos — lee en tiempo real
// /users/{uid}/projects (ver firestore.rules), la MISMA colección que
// escribe CloudSyncService.uploadProject() del lado de Flutter. No hay
// backend propio: esta pantalla es un consumidor más de la misma fuente
// de verdad que ya usa la app.
//
// Vista de Lista (reemplaza la cuadrícula original): una tarjeta por
// proyecto, con el NOMBRE arriba en su propio renglón y las acciones
// debajo — nombre y botones compartiendo fila era lo que truncaba los
// títulos (ver el comentario de la tarjeta). "Escuchar" es el destacado:
// abre el preview con ProjectViewer, sin entrar al editor, que es como
// se reconoce de oído cuál proyecto es cuál antes de abrirlo.

import { useEffect, useState } from "react";
import { Download, Globe, Pencil, Play, SlidersHorizontal } from "lucide-react";
import { collection, onSnapshot, type Timestamp } from "firebase/firestore";
import { ref, getDownloadURL } from "firebase/storage";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { db, storage } from "@/lib/firebase";
import { ProjectViewer } from "@/components/ProjectViewer";
import { PublishModal } from "@/components/PublishModal";
import { StemSplitModal } from "@/components/StemSplitModal";
import { Tooltip } from "@/components/Tooltip";

interface CloudProject {
  cloudId: string;
  title: string;
  tempoBpm: number;
  updatedAt: Timestamp | null;
  sizeBytes: number;
  storagePath: string;
}

/** Tamaño del respaldo, en la unidad que se lea de un vistazo. */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
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
  const [splittingProject, setSplittingProject] = useState<CloudProject | null>(null);

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
      <div className="w-full max-w-4xl rounded-2xl border border-white/10 bg-graphite p-8 text-center">
        <p className="text-xs text-white/40">Cargando proyectos...</p>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="w-full max-w-4xl rounded-2xl border border-white/10 bg-graphite p-8 text-center">
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
    <div className="flex w-full max-w-4xl flex-col gap-2.5">
      {projects.map((project) => (
        // El NOMBRE va en su propio renglón, arriba de las acciones, y
        // ya no comparte fila con ellas.
        //
        // Antes la fila de botones era `flex-nowrap` y no se achicaba
        // nunca, así que en cuanto el ancho disponible no alcanzaba, lo
        // único que cedía era la columna del título: un proyecto llamado
        // "Primero" se veía como "Pr…" (reportado con captura). Poner el
        // nombre arriba lo saca de esa pelea por completo — y de paso se
        // lee antes que los botones, que es el orden en que uno busca un
        // proyecto.
        <div
          key={project.cloudId}
          className="flex flex-col gap-3 rounded-xl border border-white/10 bg-graphite px-5 py-4 text-left transition-colors duration-200 hover:border-neon-cyan/30"
        >
          <div className="min-w-0">
            {/* break-words y no truncate: un nombre largo baja de línea
                en vez de cortarse. line-clamp-2 le pone un techo para
                que un título absurdo no empuje los botones fuera de la
                vista. */}
            <h3 className="line-clamp-2 break-words font-display text-lg font-semibold leading-snug text-white">
              {project.title || "Sin título"}
            </h3>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-white/40">
              <span>{formatDate(project.updatedAt)}</span>
              <span className="text-white/20">·</span>
              <span>{Math.round(project.tempoBpm)} BPM</span>
              {project.sizeBytes > 0 && (
                <>
                  <span className="text-white/20">·</span>
                  <span>{formatSize(project.sizeBytes)}</span>
                </>
              )}
            </p>
          </div>

          {/* Acciones: "Escuchar" destacado (es lo que se hace para
              reconocer cuál proyecto es cuál) y el resto en el mismo
              peso visual. flex-wrap + whitespace-nowrap: en pantallas
              angostas los botones bajan de línea enteros, nunca se
              cortan a mitad de texto. */}
          <div className="flex flex-wrap gap-2">
            <Tooltip text="Reproducir sin abrir el editor completo">
              <button
                type="button"
                onClick={() => setViewingProject(project)}
                className="flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-neon-cyan/30 bg-neon-cyan/10 px-4 py-1.5 text-xs font-semibold text-neon-cyan transition-all duration-200 hover:border-neon-cyan hover:shadow-[0_0_14px_rgba(102,252,241,0.35)]"
              >
                <Play size={13} />
                Escuchar
              </button>
            </Tooltip>
            <Tooltip text="Abrir este proyecto en el editor multipista para seguir editándolo">
              <Link
                href={`/arranger?open=${encodeURIComponent(project.cloudId)}`}
                className="flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-white/20 px-4 py-1.5 text-xs font-semibold text-white/70 transition-all duration-200 hover:border-neon-cyan/50 hover:text-neon-cyan"
              >
                <Pencil size={13} />
                Editar
              </Link>
            </Tooltip>
            <Tooltip text="Bajar el respaldo completo (.mystudio) a tu computadora">
              <button
                type="button"
                onClick={() => handleDownload(project)}
                disabled={downloadingId === project.cloudId}
                className="flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-white/20 px-4 py-1.5 text-xs font-semibold text-white/70 transition-all duration-200 hover:border-neon-cyan/50 hover:text-neon-cyan disabled:opacity-50"
              >
                <Download size={13} />
                {downloadingId === project.cloudId ? "Bajando…" : "Descargar"}
              </button>
            </Tooltip>
            <Tooltip text="Compartir este proyecto en el feed público de la Comunidad">
              <button
                type="button"
                onClick={() => setPublishingProject(project)}
                className="flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-white/20 px-4 py-1.5 text-xs font-semibold text-white/70 transition-all duration-200 hover:border-neon-cyan/50 hover:text-neon-cyan"
              >
                <Globe size={13} />
                Publicar
              </button>
            </Tooltip>
            <Tooltip text="Extraer voz, batería, bajo y resto de la mezcla (beta)">
              <button
                type="button"
                onClick={() => setSplittingProject(project)}
                className="flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-white/20 px-4 py-1.5 text-xs font-semibold text-white/70 transition-all duration-200 hover:border-neon-cyan/50 hover:text-neon-cyan"
              >
                <SlidersHorizontal size={13} />
                Separar en stems
              </button>
            </Tooltip>
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

      {splittingProject && (
        <StemSplitModal
          project={{
            cloudId: splittingProject.cloudId,
            title: splittingProject.title,
            storagePath: splittingProject.storagePath,
          }}
          onClose={() => setSplittingProject(null)}
        />
      )}
    </div>
  );
}
