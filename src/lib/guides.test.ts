import { describe, expect, it } from "vitest";
import { GUIDES, guideBySlug, relatedGuides } from "./guides";

// Lo que se prueba acá no es el texto (eso se lee), sino lo que se
// rompe en silencio y no se ve hasta que alguien llega de Google: un
// slug repetido, un "seguí leyendo" que apunta a una guía que ya no
// existe, un ancla duplicada que hace que el índice salte al lugar
// equivocado. Todo eso compila igual.

describe("catálogo de guías", () => {
  it("hay guías publicadas", () => {
    expect(GUIDES.length).toBeGreaterThan(0);
  });

  it("los slugs son únicos", () => {
    const slugs = GUIDES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  // El slug ES la URL: un espacio o un acento lo convierte en algo
  // escapado e ilegible, y cambiarlo después rompe los enlaces que ya
  // circulan.
  it("los slugs son seguros para una URL", () => {
    for (const guide of GUIDES) {
      expect(guide.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("cada guía tiene título, descripción y contenido", () => {
    for (const guide of GUIDES) {
      expect(guide.title.length).toBeGreaterThan(10);
      // La descripción es lo que se lee en el buscador debajo del
      // título: de más de ~160 caracteres, Google la corta.
      expect(guide.description.length).toBeGreaterThan(40);
      expect(guide.description.length).toBeLessThanOrEqual(200);
      expect(guide.blocks.length).toBeGreaterThan(3);
      expect(guide.minutes).toBeGreaterThan(0);
    }
  });

  it("las fechas son ISO y parseables", () => {
    for (const guide of GUIDES) {
      expect(guide.published).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(new Date(guide.published).getTime())).toBe(false);
    }
  });

  it("las anclas de cada guía son únicas dentro de ella", () => {
    for (const guide of GUIDES) {
      const ids = guide.blocks.filter((b) => b.kind === "h2").map((b) => b.id);
      expect(new Set(ids).size, `anclas repetidas en ${guide.slug}`).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("ninguna lista ni lista de pasos queda vacía", () => {
    for (const guide of GUIDES) {
      for (const block of guide.blocks) {
        if (block.kind === "ul" || block.kind === "steps") {
          expect(block.items.length, `bloque vacío en ${guide.slug}`).toBeGreaterThan(0);
        }
      }
    }
  });

  // Un `**` sin cerrar se dibuja literal en la página (misma regla que
  // la ayuda, ver parseHelpText).
  it("las negritas están cerradas", () => {
    for (const guide of GUIDES) {
      for (const block of guide.blocks) {
        const textos =
          block.kind === "ul" || block.kind === "steps" ? block.items : [block.text];
        for (const texto of textos) {
          const marcas = (texto.match(/\*\*/g) ?? []).length;
          expect(marcas % 2, `negrita sin cerrar en ${guide.slug}: "${texto.slice(0, 40)}…"`).toBe(0);
        }
      }
    }
  });
});

describe("enlaces entre guías", () => {
  it("cada relacionada existe", () => {
    for (const guide of GUIDES) {
      for (const slug of guide.related ?? []) {
        expect(guideBySlug(slug), `${guide.slug} enlaza a ${slug}, que no existe`).not.toBeNull();
      }
    }
  });

  it("ninguna guía se enlaza a sí misma", () => {
    for (const guide of GUIDES) {
      expect(relatedGuides(guide).map((g) => g.slug)).not.toContain(guide.slug);
    }
  });

  // Una guía a la que no llega ningún enlace interno solo es
  // alcanzable desde el sitemap: quien lee otra guía nunca la
  // encuentra. El índice /guias las lista a todas, pero el enlace
  // entre artículos es el que hace que alguien siga leyendo.
  it("toda guía recibe al menos un enlace de otra", () => {
    for (const guide of GUIDES) {
      const entrantes = GUIDES.filter((g) => (g.related ?? []).includes(guide.slug));
      expect(entrantes.length, `${guide.slug} es una hoja suelta`).toBeGreaterThan(0);
    }
  });

  it("guideBySlug devuelve null para algo que no existe", () => {
    expect(guideBySlug("no-existe")).toBeNull();
  });
});
