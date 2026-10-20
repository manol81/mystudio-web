// src/lib/googleAuth.ts
//
// Iniciar sesión con Google (2026-10-19), compartido por LoginModal y la
// eliminación de cuenta. Ventana emergente (popup) y no redirección: la
// redirección depende de cookies de terceros entre mystudio.rocks y el
// dominio de Firebase Auth, que los navegadores ya bloquean.

import { GoogleAuthProvider } from "firebase/auth";

/// Proveedor de Google que SIEMPRE muestra el selector de cuentas: sin
/// `select_account`, quien tiene una sola sesión de Google abierta entra
/// con esa sin poder elegir otra.
export function googleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}

/// true si la persona cerró la ventana de Google sin elegir: no es un
/// error que haya que mostrar.
export function isGoogleDismissed(code: string | undefined): boolean {
  return code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request";
}

/// Mensaje para los errores de Google que sí hay que explicar; null para
/// los que no tienen nada particular (se usa el mensaje genérico).
export function googleErrorMessage(code: string | undefined): string | null {
  switch (code) {
    case "auth/popup-blocked":
      return "El navegador bloqueó la ventana de Google. Permití ventanas emergentes para este sitio y probá de nuevo.";
    case "auth/account-exists-with-different-credential":
      return "Ya tenés una cuenta con ese email y contraseña. Entrá con tu contraseña.";
    case "auth/user-mismatch":
      return "Elegiste otra cuenta de Google. Elegí la misma con la que iniciaste sesión.";
    case "auth/unauthorized-domain":
    case "auth/operation-not-allowed":
      return "El inicio de sesión con Google no está habilitado para este sitio todavía.";
    default:
      return null;
  }
}
