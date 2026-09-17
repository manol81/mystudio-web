// src/lib/clipCrossfade.test.ts

import { describe, expect, it } from "vitest";
import {
  EDGE_DECLICK_SECONDS,
  overlapChains,
  resolveTrackFades,
  type CrossfadeClip,
} from "./clipCrossfade";

function clip(
  id: string,
  startSeconds: number,
  displayDuration: number,
  fadeInSeconds = 0,
  fadeOutSeconds = 0,
): CrossfadeClip {
  return { id, startSeconds, displayDuration, fadeInSeconds, fadeOutSeconds };
}

describe("declick", () => {
  it("pone un fade cortísimo en cada borde duro", () => {
    // El chasquido de una junta es un salto instantáneo de amplitud.
    const fades = resolveTrackFades([clip("a", 0, 4)]).get("a")!;
    expect(fades.fadeInSeconds).toBe(EDGE_DECLICK_SECONDS);
    expect(fades.fadeOutSeconds).toBe(EDGE_DECLICK_SECONDS);
    expect(fades.crossfadeIn).toBe(false);
  });

  it("es LINEAL, no de potencia constante", () => {
    // No cruza nada: no hay nada del otro lado que compensar. Además es
    // lo que hace el motor nativo con los fades.
    const fades = resolveTrackFades([clip("a", 0, 4)]).get("a")!;
    expect(fades.fadeInShape).toBe("linear");
    expect(fades.fadeOutShape).toBe("linear");
  });

  it("no pisa el fade que puso la persona", () => {
    const fades = resolveTrackFades([clip("a", 0, 4, 1.5, 0)]).get("a")!;
    expect(fades.fadeInSeconds).toBe(1.5);
    expect(fades.fadeOutSeconds).toBe(EDGE_DECLICK_SECONDS);
  });

  it("en un clip más corto que el propio declick no se come más de la mitad", () => {
    const fades = resolveTrackFades([clip("a", 0, 0.002)]).get("a")!;
    expect(fades.fadeInSeconds).toBe(0.001);
    expect(fades.fadeOutSeconds).toBe(0.001);
  });
});

describe("crossfade por solape", () => {
  it("el solape se convierte en cruce en los DOS clips", () => {
    const fades = resolveTrackFades([clip("a", 0, 4), clip("b", 3, 4)]);
    expect(fades.get("a")!.fadeOutSeconds).toBe(1);
    expect(fades.get("a")!.crossfadeOut).toBe(true);
    expect(fades.get("b")!.fadeInSeconds).toBe(1);
    expect(fades.get("b")!.crossfadeIn).toBe(true);
  });

  it("el cruce usa potencia constante", () => {
    // Dos rampas lineales sumadas dan un pozo de −3 dB justo en la
    // junta: se escucha como un bajón de volumen, que es lo contrario
    // de lo que se buscaba.
    const fades = resolveTrackFades([clip("a", 0, 4), clip("b", 3, 4)]);
    expect(fades.get("a")!.fadeOutShape).toBe("equalPower");
    expect(fades.get("b")!.fadeInShape).toBe("equalPower");
    // El borde que NO cruza sigue siendo lineal.
    expect(fades.get("a")!.fadeInShape).toBe("linear");
  });

  it("los bordes de afuera de la cadena siguen con declick", () => {
    const fades = resolveTrackFades([clip("a", 0, 4), clip("b", 3, 4)]);
    expect(fades.get("a")!.fadeInSeconds).toBe(EDGE_DECLICK_SECONDS);
    expect(fades.get("b")!.fadeOutSeconds).toBe(EDGE_DECLICK_SECONDS);
  });

  it("un cruce nunca dura más que el clip más corto", () => {
    // "b" dura 0,5 s y queda tapado casi entero por "a".
    const fades = resolveTrackFades([clip("a", 0, 10), clip("b", 1, 0.5)]);
    expect(fades.get("b")!.fadeInSeconds).toBe(0.5);
    expect(fades.get("a")!.fadeOutSeconds).toBe(0.5);
  });

  it("dos clips que apenas se TOCAN no cruzan, solo declickean", () => {
    // Es el caso más común: loops encadenados uno atrás del otro.
    const fades = resolveTrackFades([clip("a", 0, 4), clip("b", 4, 4)]);
    expect(fades.get("a")!.crossfadeOut).toBe(false);
    expect(fades.get("a")!.fadeOutSeconds).toBe(EDGE_DECLICK_SECONDS);
    expect(fades.get("b")!.fadeInSeconds).toBe(EDGE_DECLICK_SECONDS);
  });

  it("un fade a mano más largo que el solape gana", () => {
    const fades = resolveTrackFades([clip("a", 0, 4, 0, 2), clip("b", 3.5, 4)]);
    expect(fades.get("a")!.fadeOutSeconds).toBe(2);
    expect(fades.get("a")!.crossfadeOut).toBe(true);
  });

  it("no depende del orden en que vengan los clips", () => {
    const enOrden = resolveTrackFades([clip("a", 0, 4), clip("b", 3, 4)]);
    const alReves = resolveTrackFades([clip("b", 3, 4), clip("a", 0, 4)]);
    expect(alReves.get("a")).toEqual(enOrden.get("a"));
    expect(alReves.get("b")).toEqual(enOrden.get("b"));
  });
});

describe("cadenas de solape", () => {
  it("los clips sueltos quedan cada uno en su cadena", () => {
    const chains = overlapChains([clip("a", 0, 2), clip("b", 5, 2)]);
    expect(chains.map((c) => c.map((x) => x.id))).toEqual([["a"], ["b"]]);
  });

  it("dos que se solapan van juntos", () => {
    const chains = overlapChains([clip("a", 0, 4), clip("b", 3, 4)]);
    expect(chains.map((c) => c.map((x) => x.id))).toEqual([["a", "b"]]);
  });

  it("encadena de a uno: a-b y b-c dejan a los TRES en la misma cadena", () => {
    // Aunque "a" y "c" no se toquen entre sí. Hay que aplanarlos juntos:
    // partir la cadena por el medio volvería a dejar un solape.
    const chains = overlapChains([clip("a", 0, 4), clip("b", 3, 4), clip("c", 6, 4)]);
    expect(chains.map((c) => c.map((x) => x.id))).toEqual([["a", "b", "c"]]);
  });

  it("una cadena corta y otra aparte", () => {
    const chains = overlapChains([clip("a", 0, 4), clip("b", 3, 4), clip("c", 20, 4)]);
    expect(chains.map((c) => c.map((x) => x.id))).toEqual([["a", "b"], ["c"]]);
  });

  it("tocarse justo NO es solaparse", () => {
    // Si contara, cada cadena de loops encadenados se aplanaría a un
    // solo WAV gigante sin ninguna necesidad.
    const chains = overlapChains([clip("a", 0, 4), clip("b", 4, 4)]);
    expect(chains.length).toBe(2);
  });

  it("un clip metido ENTERO adentro de otro sigue en la misma cadena", () => {
    const chains = overlapChains([clip("a", 0, 10), clip("b", 2, 1), clip("c", 5, 1)]);
    expect(chains.map((c) => c.map((x) => x.id))).toEqual([["a", "b", "c"]]);
  });

  it("sin clips no hay cadenas", () => {
    expect(overlapChains([])).toEqual([]);
  });
});
