"use client";

// Panel de administrador — estadísticas básicas. Mismo criterio de
// gating (useAdminCheck) que el resto del panel.
//
// Alcance deliberadamente chico — ver el comentario en
// AdminService.ts sobre por qué "usuarios activos/tendencias" y
// "espacio en Storage" NO se reconstruyen acá (el primero ya existe
// gratis en Firebase Analytics; el segundo ni siquiera se puede leer
// desde el cliente).

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useAdminCheck } from "@/lib/useAdminCheck";
import { fetchPlatformStats, type PlatformStats } from "@/lib/AdminService";

const FIREBASE_PROJECT_ID = "my-studio-4530a";

function StatTile({ label, value, sublabel }: { label: string; value: number; sublabel?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-graphite p-5 text-left">
      <p className="font-display text-3xl font-bold text-white">{value.toLocaleString("es-AR")}</p>
      <p className="mt-1 text-xs text-white/50">{label}</p>
      {sublabel && <p className="text-[11px] text-white/30">{sublabel}</p>}
    </div>
  );
}

export default function AdminStatsPage() {
  const { user } = useAuth();
  const adminCheck = useAdminCheck();
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (adminCheck !== "authorized") return;
    (async () => {
      try {
        setStats(await fetchPlatformStats());
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
      }
    })();
  }, [adminCheck]);

  return (
    <div className="flex min-h-full flex-col items-center gap-8 px-6 py-16 text-center">
      <div>
        <Link
          href="/admin"
          className="text-xs text-white/40 transition-colors duration-200 hover:text-white/70"
        >
          ← Panel de Admin
        </Link>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
          📊 Estadísticas
        </h1>
      </div>

      {adminCheck === "checking" && (
        <p className="text-xs text-white/40">Verificando permisos...</p>
      )}

      {adminCheck === "signed-out" && (
        <p className="max-w-sm text-sm text-white/60">
          Iniciá sesión desde la página principal para continuar.
        </p>
      )}

      {adminCheck === "unauthorized" && (
        <p className="max-w-sm text-sm text-red-400">
          Tu cuenta ({user?.email}) no tiene permisos de administrador.
        </p>
      )}

      {adminCheck === "authorized" && (
        <div className="w-full max-w-2xl text-left">
          {isLoading ? (
            <p className="text-center text-xs text-white/40">Cargando estadísticas...</p>
          ) : loadError ? (
            <p className="text-center text-xs text-red-400">No se pudieron cargar las estadísticas.</p>
          ) : stats ? (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <StatTile label="Usuarios registrados" value={stats.usersCount} />
                <StatTile label="Publicaciones" value={stats.postsCount} />
                <StatTile label="Samples" value={stats.samplesCount} />
                <StatTile
                  label="Reportes pendientes"
                  value={stats.pendingReportsCount}
                  sublabel={`${stats.totalReportsCount} en total`}
                />
              </div>

              <p className="mt-4 text-[11px] text-white/30">
                &ldquo;Usuarios registrados&rdquo; cuenta cuentas que iniciaron sesión desde que
                este contador existe — una cuenta más vieja que no volvió a loguearse todavía no
                queda incluida acá (se suma sola la próxima vez que entre).
              </p>

              <div className="mt-8 rounded-2xl border border-white/10 bg-graphite p-6">
                <h2 className="font-display text-sm font-semibold text-white">
                  Usuarios activos y tendencias
                </h2>
                <p className="mt-1 text-xs text-white/50">
                  Ya está conectado desde el principio (Firebase Analytics) — no hace falta
                  reconstruirlo acá.
                </p>
                <a
                  href={`https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/analytics`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block rounded-full border border-neon-cyan/30 px-4 py-1.5 text-xs font-semibold text-neon-cyan transition-colors duration-200 hover:border-neon-cyan"
                >
                  Abrir Firebase Analytics ↗
                </a>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-graphite p-6">
                <h2 className="font-display text-sm font-semibold text-white">
                  Espacio en Storage / Firestore
                </h2>
                <p className="mt-1 text-xs text-white/50">
                  Es información de facturación de Google Cloud — ningún SDK de cliente la expone,
                  así que no se puede mostrar acá dentro.
                </p>
                <a
                  href={`https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/usage`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block rounded-full border border-neon-cyan/30 px-4 py-1.5 text-xs font-semibold text-neon-cyan transition-colors duration-200 hover:border-neon-cyan"
                >
                  Ver Uso y Facturación ↗
                </a>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
