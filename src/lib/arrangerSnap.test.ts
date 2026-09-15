// src/lib/arrangerSnap.test.ts
//
// El imán es de esas cosas que "se sienten" y por eso casi nunca se
// prueban, hasta que alguien toca el zoom y todo se pega mal. Los casos
// de acá fijan justamente lo que no se ve: que el radio esté en
// píxeles y no en segundos, que la posición se mida siempre contra el
// mouse crudo, y que nada pueda empujar un clip antes del cero.

import { describe, expect, it } from "vitest";
import { computeSnappedStart, type SnapRequest } from "./arrangerSnap";

// 100 px por segundo, umbral de 10 px = 0,1 s de tolerancia.
// Grilla de 0,5 s = la negra a 120 BPM.
function request(over: Partial<SnapRequest> = {}): SnapRequest {
  return {
    rawStartSeconds: 0,
    displayDuration: 2,
    pixelsPerSecond: 100,
    gridSeconds: 0.5,
    neighbours: [],
    thresholdPx: 10,
    ...over,
  };
}

describe("imán a la grilla", () => {
  it("pega al paso de grilla más cercano", () => {
    // El caso reportado: poner un clip "en el compás 5" era imposible,
    // caía en 4,97 y el arreglo se desfasaba solo.
    const result = computeSnappedStart(request({ rawStartSeconds: 4.97 }));
    expect(result.startSeconds).toBeCloseTo(5, 6);
    expect(result.guideSeconds).toBeCloseTo(5, 6);
  });

  it("no pega si está lejos: el clip sigue al mouse", () => {
    // 4,7 está a 30 px de 4,5 y de 5,0 — más que el umbral de 10.
    const result = computeSnappedStart(request({ rawStartSeconds: 4.7 }));
    expect(result.startSeconds).toBeCloseTo(4.7, 6);
    expect(result.guideSeconds).toBeNull();
  });

  it("también deja que el clip TERMINE en una línea", () => {
    // Un clip que NO dura un número redondo de pasos (2,3 s con grilla
    // de 0,5): su inicio queda a 22 px de la línea más cercana, o sea
    // fuera del radio, pero su FINAL cae a 2 px de la línea de 5,0.
    // Poder pegarlo por el final es lo que permite que algo desemboque
    // exacto en el compás siguiente, y es la mitad de para qué sirve
    // una grilla.
    const result = computeSnappedStart(
      request({ rawStartSeconds: 2.72, displayDuration: 2.3 }),
    );
    expect(result.startSeconds).toBeCloseTo(2.7, 6);
    expect(result.guideSeconds).toBeCloseTo(5, 6); // la guía marca el FINAL
  });

  it("cuando el inicio y el final empatan, la guía marca el INICIO", () => {
    // Un clip que dura un número redondo de pasos empieza Y termina
    // sobre la grilla al mismo tiempo, y las dos opciones dan la misma
    // posición. Lo que cambia es dónde se dibuja la guía, y ahí conviene
    // el borde que la persona está arrastrando.
    const result = computeSnappedStart(request({ rawStartSeconds: 4.97, displayDuration: 2 }));
    expect(result.startSeconds).toBeCloseTo(5, 6);
    expect(result.guideSeconds).toBeCloseTo(5, 6);
  });

  it("con la grilla apagada no pega a nada", () => {
    const result = computeSnappedStart(request({ rawStartSeconds: 4.97, gridSeconds: 0 }));
    expect(result.startSeconds).toBeCloseTo(4.97, 6);
    expect(result.guideSeconds).toBeNull();
  });

  it("el radio está en PÍXELES, no en segundos", () => {
    // La misma distancia en segundos (0,08 s) pega con zoom alto y no
    // pega con zoom bajo. Si el radio se midiera en segundos, alejarse
    // haría que los clips se peguen a cosas que en pantalla están
    // lejísimos.
    const cerca = computeSnappedStart(
      request({ rawStartSeconds: 4.92, pixelsPerSecond: 100 }), // 8 px
    );
    expect(cerca.startSeconds).toBeCloseTo(5, 6);

    const lejos = computeSnappedStart(
      request({ rawStartSeconds: 4.92, pixelsPerSecond: 300 }), // 24 px
    );
    expect(lejos.startSeconds).toBeCloseTo(4.92, 6);
  });
});

describe("imán clip contra clip", () => {
  const vecino = [{ startSeconds: 10, displayDuration: 4 }]; // ocupa 10 → 14

  it("encadena: mi inicio se pega al final del otro", () => {
    const result = computeSnappedStart(
      request({ rawStartSeconds: 13.95, neighbours: vecino, gridSeconds: 0 }),
    );
    expect(result.startSeconds).toBeCloseTo(14, 6);
  });

  it("mi final se pega al inicio del otro", () => {
    // Un clip de 2 s que termine justo donde arranca el vecino empieza en 8.
    const result = computeSnappedStart(
      request({ rawStartSeconds: 8.03, displayDuration: 2, neighbours: vecino, gridSeconds: 0 }),
    );
    expect(result.startSeconds).toBeCloseTo(8, 6);
    expect(result.guideSeconds).toBeCloseTo(10, 6);
  });

  it("alinea inicios entre pistas", () => {
    const result = computeSnappedStart(
      request({ rawStartSeconds: 10.05, neighbours: vecino, gridSeconds: 0 }),
    );
    expect(result.startSeconds).toBeCloseTo(10, 6);
  });

  it("sigue funcionando con la grilla apagada", () => {
    // Son dos imanes independientes: encadenar loops no necesita
    // grilla, y por eso este nunca se apaga.
    const result = computeSnappedStart(
      request({ rawStartSeconds: 13.98, neighbours: vecino, gridSeconds: 0 }),
    );
    expect(result.startSeconds).toBeCloseTo(14, 6);
  });
});

describe("los dos juntos", () => {
  it("gana el candidato más cercano al mouse", () => {
    // Vecino terminando en 14,0 y línea de grilla en 14,5. El mouse en
    // 14,03 está a 3 px del vecino y a 47 de la grilla.
    const result = computeSnappedStart(
      request({
        rawStartSeconds: 14.03,
        neighbours: [{ startSeconds: 10, displayDuration: 4 }],
        gridSeconds: 0.5,
      }),
    );
    expect(result.startSeconds).toBeCloseTo(14, 6);
  });
});

describe("límites", () => {
  it("el cero siempre atrae", () => {
    const result = computeSnappedStart(request({ rawStartSeconds: 0.04, gridSeconds: 0 }));
    expect(result.startSeconds).toBe(0);
  });

  it("nunca devuelve un tiempo negativo", () => {
    // Un candidato que empujaría el clip antes del cero no es una
    // posición válida: la línea de tiempo no tiene tiempos negativos.
    const result = computeSnappedStart(
      request({
        rawStartSeconds: 0.02,
        displayDuration: 5,
        neighbours: [{ startSeconds: 1, displayDuration: 2 }],
      }),
    );
    expect(result.startSeconds).toBeGreaterThanOrEqual(0);
  });

  it("un arreglo vacío y sin grilla no cambia nada", () => {
    const result = computeSnappedStart(request({ rawStartSeconds: 7.3, gridSeconds: 0 }));
    expect(result.startSeconds).toBeCloseTo(7.3, 6);
    expect(result.guideSeconds).toBeNull();
  });
});
