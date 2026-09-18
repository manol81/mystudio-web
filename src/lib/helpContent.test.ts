import { describe, expect, it } from "vitest";
import { HELP_SECTIONS, parseHelpText } from "./helpContent";

describe("HELP_SECTIONS", () => {
  it("cada ancla es única y apta para una URL", () => {
    // La app enlaza a /ayuda#<id>: un id repetido o con espacios haría
    // que el enlace aterrice en otra sección o en ninguna.
    const ids = HELP_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("ninguna sección queda vacía", () => {
    for (const s of HELP_SECTIONS) expect(s.items.length).toBeGreaterThan(0);
  });

  it("todas las negritas están cerradas", () => {
    // Un ** sin pareja no rompe la página (se muestra literal), pero es
    // un error de tipeo en la guía: que lo agarre el test y no un usuario.
    const texts = HELP_SECTIONS.flatMap((s) => [
      s.intro ?? "",
      ...s.items.flatMap((item) => (typeof item === "string" ? [item] : item.steps)),
    ]);
    for (const t of texts) expect((t.match(/\*\*/g) ?? []).length % 2).toBe(0);
  });
});

describe("parseHelpText", () => {
  it("separa texto normal y negrita", () => {
    expect(parseHelpText("Tocá **Grabar** y listo")).toEqual([
      { text: "Tocá ", bold: false },
      { text: "Grabar", bold: true },
      { text: " y listo", bold: false },
    ]);
  });

  it("empieza y termina en negrita sin tramos vacíos", () => {
    expect(parseHelpText("**A** y **B**")).toEqual([
      { text: "A", bold: true },
      { text: " y ", bold: false },
      { text: "B", bold: true },
    ]);
  });

  it("un ** sin cerrar queda como texto literal", () => {
    expect(parseHelpText("antes **sin cerrar")).toEqual([
      { text: "antes **sin cerrar", bold: false },
    ]);
  });
});
