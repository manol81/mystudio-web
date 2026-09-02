"use client";

// Hook compartido de gating admin — extraído de la lógica que ya
// tenía /admin/upload-sample para no duplicarla en cada pantalla
// nueva del panel (reportes, etc.).
//
// `forceRefresh` (default true): getIdTokenResult(true) fuerza bajar
// un token nuevo en vez de usar el cacheado — importante la primera
// vez que se otorga el claim a una cuenta que ya tenía sesión abierta
// (el token viejo no lo trae hasta su próxima renovación natural,
// hasta 1h después). Las PANTALLAS de admin en sí quieren esto
// (forceRefresh=true, el default). El Sidebar, que monta este hook en
// TODAS las páginas solo para decidir si mostrar el link "Admin", NO
// — forzar un refresh de token en cada carga de página para todo el
// mundo (incluidos usuarios que nunca van a ser admin) es​ tráfico de
// red desperdiciado; ahí alcanza con el token que ya está en caché.

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";

export type AdminCheck = "checking" | "authorized" | "unauthorized" | "signed-out";

export function useAdminCheck(forceRefresh = true): AdminCheck {
  const { user, loading } = useAuth();
  const [claimCheck, setClaimCheck] = useState<"pending" | "authorized" | "unauthorized">(
    "pending",
  );

  useEffect(() => {
    if (loading || !user) return;
    user
      .getIdTokenResult(forceRefresh)
      .then((result) => setClaimCheck(result.claims.admin === true ? "authorized" : "unauthorized"))
      .catch(() => setClaimCheck("unauthorized"));
  }, [user, loading, forceRefresh]);

  if (loading) return "checking";
  if (!user) return "signed-out";
  if (claimCheck === "pending") return "checking";
  return claimCheck;
}
