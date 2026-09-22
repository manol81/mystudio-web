"use client";

// /admin/pro — dar y sacar MY STUDIO PRO a mano.
//
// Pedido: que las cuentas de admin tengan PRO, y poder dárselo a quien
// se elija (testers, músicos invitados, quien reporta algo bueno) sin
// pasar por una compra de Play.
//
// La seguridad REAL está en firestore.rules, no acá: solo un admin
// puede tocar esos campos, y ni el propio dueño puede dárselos (probado
// en test/firestore_rules/pro_grant_rules_test.mjs). Esta pantalla
// oculta lo que no corresponde, que es otra cosa.
//
// El filtro es LOCAL, sobre la lista ya cargada: Firestore no busca por
// subcadena y montar un índice de búsqueda para una pantalla que usa
// una sola persona sería desproporcionado. Mismo criterio que
// /admin/posts.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Crown, Search } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useAdminCheck } from "@/lib/useAdminCheck";
import { fetchUsers, setUserPro, type AdminUser } from "@/lib/AdminService";

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}

export default function AdminProPage() {
  const { user } = useAuth();
  const adminCheck = useAdminCheck();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [filter, setFilter] = useState("");
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (adminCheck !== "authorized") return;
    try {
      setUsers(await fetchUsers());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setUsers([]);
    }
  }, [adminCheck]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function toggle(target: AdminUser) {
    if (!user) return;
    setBusyUid(target.uid);
    setError(null);
    try {
      await setUserPro(target.uid, !target.isPro, user.uid);
      // Se actualiza en el lugar en vez de recargar la lista entera:
      // son 200 lecturas cada vez y el cambio es de un solo campo.
      setUsers((prev) =>
        (prev ?? []).map((u) =>
          u.uid === target.uid
            ? { ...u, isPro: !target.isPro, proGrantedBy: user.uid, proGrantedAt: new Date() }
            : u,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyUid(null);
    }
  }

  if (adminCheck === "checking") {
    return <p className="px-6 py-16 text-center text-sm text-white/40">Verificando…</p>;
  }
  if (adminCheck !== "authorized") {
    return (
      <p className="px-6 py-16 text-center text-sm text-white/40">
        Esta sección es solo para administradores.
      </p>
    );
  }

  const term = filter.trim().toLowerCase();
  const visible = (users ?? []).filter(
    (u) =>
      !term ||
      u.username.toLowerCase().includes(term) ||
      u.email.toLowerCase().includes(term),
  );
  const proCount = (users ?? []).filter((u) => u.isPro).length;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-xs text-white/40 transition-colors hover:text-white"
      >
        <ArrowLeft size={13} /> Panel
      </Link>

      <h1 className="mt-3 font-display text-3xl font-bold text-white">
        Cuentas <span className="text-neon-cyan">PRO</span>
      </h1>
      <p className="mt-1 text-sm text-white/50">
        Dale o sacale MY STUDIO PRO a cualquier cuenta. Es independiente de las compras de Google
        Play: quien compró sigue siendo PRO aunque acá figure en no.
      </p>
      <p className="mt-1 text-xs text-white/35">
        Ojo: el PRO otorgado acá va con la CUENTA, así que la persona lo tiene cuando inicia
        sesión en la app.
      </p>

      <div className="mt-6 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
        <Search size={15} className="shrink-0 text-white/30" />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar por apodo o email…"
          className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/25"
        />
      </div>

      {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
      {users === null && <p className="mt-6 text-sm text-white/40">Cargando cuentas…</p>}

      {users !== null && (
        <p className="mt-4 text-xs text-white/35">
          {visible.length} de {users.length} cuentas · {proCount} con PRO
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {visible.map((u) => (
          <li
            key={u.uid}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-graphite px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-semibold text-white">
                {u.username || <span className="text-white/40">Sin apodo</span>}
                {u.isPro && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-300/10 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
                    <Crown size={11} /> PRO
                  </span>
                )}
              </p>
              <p className="truncate text-xs text-white/40">{u.email || u.uid}</p>
              <p className="mt-0.5 text-[11px] text-white/25">
                Alta {formatDate(u.createdAt)}
                {u.isPro && u.proGrantedAt && ` · PRO desde ${formatDate(u.proGrantedAt)}`}
              </p>
            </div>

            <button
              type="button"
              disabled={busyUid === u.uid}
              onClick={() => void toggle(u)}
              className={`shrink-0 whitespace-nowrap rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                u.isPro
                  ? "border-white/20 text-white/60 hover:border-white/40 hover:text-white"
                  : "border-amber-300/40 text-amber-200 hover:border-amber-300"
              }`}
            >
              {busyUid === u.uid ? "Guardando…" : u.isPro ? "Quitar PRO" : "Dar PRO"}
            </button>
          </li>
        ))}
      </ul>

      {users !== null && visible.length === 0 && (
        <p className="mt-6 text-sm text-white/40">Ninguna cuenta coincide con ese filtro.</p>
      )}
    </div>
  );
}
