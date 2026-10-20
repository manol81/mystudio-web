import { describe, expect, it } from "vitest";
import { googleErrorMessage, googleProvider, isGoogleDismissed } from "./googleAuth";

describe("googleAuth", () => {
  it("cerrar la ventana de Google no es un error", () => {
    expect(isGoogleDismissed("auth/popup-closed-by-user")).toBe(true);
    expect(isGoogleDismissed("auth/cancelled-popup-request")).toBe(true);
    expect(isGoogleDismissed("auth/popup-blocked")).toBe(false);
    expect(isGoogleDismissed(undefined)).toBe(false);
  });

  it("explica los errores propios de Google y deja el resto al mensaje genérico", () => {
    expect(googleErrorMessage("auth/popup-blocked")).toMatch(/ventanas emergentes/);
    expect(googleErrorMessage("auth/account-exists-with-different-credential")).toMatch(/contraseña/);
    expect(googleErrorMessage("auth/network-request-failed")).toBeNull();
  });

  it("siempre muestra el selector de cuentas", () => {
    expect(googleProvider().getCustomParameters()).toEqual({ prompt: "select_account" });
  });
});
