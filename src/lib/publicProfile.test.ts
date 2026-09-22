import { describe, expect, it } from "vitest";
import { publicProfileNeedsUpdate, usernamePrefixBounds } from "./PublicProfileService";

describe("publicProfileNeedsUpdate", () => {
  it("sin perfil público hay que crearlo", () => {
    // El caso reportado: quien eligió su apodo al publicar nunca tuvo
    // perfil público, así que /buscar no lo encontraba jamás.
    expect(publicProfileNeedsUpdate(undefined, "Nicox")).toBe(true);
  });

  it("un perfil viejo sin usernameLower se repara", () => {
    expect(publicProfileNeedsUpdate({ username: "Nicox" }, "Nicox")).toBe(true);
  });

  it("si cambió el apodo, se reescribe", () => {
    expect(
      publicProfileNeedsUpdate({ username: "Nico", usernameLower: "nico" }, "Nicox"),
    ).toBe(true);
  });

  it("si ya está al día no escribe nada", () => {
    // Importa: esto corre en cada inicio de sesión, y una escritura por
    // sesión sería gastar cuota sin motivo.
    expect(
      publicProfileNeedsUpdate({ username: "Nicox", usernameLower: "nicox" }, "Nicox"),
    ).toBe(false);
  });
});

describe("usernamePrefixBounds", () => {
  it("delimita todo lo que empieza con el prefijo", () => {
    const bounds = usernamePrefixBounds("Nic");
    expect(bounds).toEqual({ start: "nic", end: "nic" });
    // "nicox" cae DENTRO del rango: eso es buscar por prefijo.
    expect("nicox" >= bounds!.start && "nicox" <= bounds!.end).toBe(true);
    expect("ramiro" >= bounds!.start && "ramiro" <= bounds!.end).toBe(false);
  });

  it("con menos de dos letras no busca", () => {
    expect(usernamePrefixBounds("n")).toBeNull();
    expect(usernamePrefixBounds("  ")).toBeNull();
  });
});
