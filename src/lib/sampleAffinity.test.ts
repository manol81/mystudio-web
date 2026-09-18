// src/lib/sampleAffinity.test.ts
//
// Estas reglas son musicales, no de programación: un error acá no
// rompe nada visible — simplemente esconde samples que servían, o
// transpone una guitarra media octava para el lado equivocado, y el
// usuario piensa que el Banco de Sonidos es malo. Por eso los casos
// están escritos contra relaciones armónicas CONOCIDAS (la relativa de
// A Minor es C Major, su quinta es E Minor) en vez de contra los
// números que devuelve la implementación.

import { describe, expect, it } from "vitest";
import {
  affinityFor,
  camelotFor,
  camelotLabel,
  keyLabel,
  keyTooltip,
  isExtremeStretch,
  keysAreCompatible,
  parseSampleKey,
  stretchRatioFor,
  tempoDistance,
  transposeKey,
  transposeSemitonesFor,
} from "./sampleAffinity";
import { SAMPLE_KEYS } from "./sampleTaxonomy";

describe("parseSampleKey", () => {
  it("lee el formato del catálogo", () => {
    expect(parseSampleKey("A Minor")).toEqual({ pitchClass: 9, mode: "minor" });
    expect(parseSampleKey("C Major")).toEqual({ pitchClass: 0, mode: "major" });
    expect(parseSampleKey("F# Minor")).toEqual({ pitchClass: 6, mode: "minor" });
    expect(parseSampleKey("Eb Major")).toEqual({ pitchClass: 3, mode: "major" });
  });

  it("acepta enarmónicos que no están en SAMPLE_KEYS", () => {
    // Los nombres de archivo de los packs reales usan Db y D# aunque el
    // catálogo ofrezca C# y Eb — la heurística del script de carga
    // masiva puede haberlos dejado escritos así.
    expect(parseSampleKey("Db Major")?.pitchClass).toBe(1);
    expect(parseSampleKey("D# Minor")?.pitchClass).toBe(3);
  });

  it("tolera mayúsculas, minúsculas y abreviaturas", () => {
    expect(parseSampleKey("a min")).toEqual({ pitchClass: 9, mode: "minor" });
    expect(parseSampleKey("Am")).toEqual({ pitchClass: 9, mode: "minor" });
    expect(parseSampleKey("eb MAJOR")).toEqual({ pitchClass: 3, mode: "major" });
  });

  it("'maj' no se lee como menor por culpa de la 'm' inicial", () => {
    // El mismo bug que ya apareció en la heurística de nombres de
    // archivo (ver scripts/samples.mjs): preguntar por "m" antes que
    // por "maj" convierte todos los mayores en menores.
    expect(parseSampleKey("C maj")?.mode).toBe("major");
  });

  it("sin tonalidad no es un error", () => {
    // Percusión y FX: usables en cualquier proyecto, nunca se descartan.
    expect(parseSampleKey("N/A")).toBeNull();
    expect(parseSampleKey("")).toBeNull();
    expect(parseSampleKey(null)).toBeNull();
    expect(parseSampleKey("Sol mayor")).toBeNull(); // no soportado: solo notación anglosajona
  });
});

describe("camelotFor", () => {
  it("clava los anclajes de la rueda", () => {
    expect(camelotLabel("A Minor")).toBe("8A");
    expect(camelotLabel("C Major")).toBe("8B");
  });

  it("subir una quinta avanza exactamente un número", () => {
    // A → E → B, el círculo de quintas.
    expect(camelotLabel("E Minor")).toBe("9A");
    expect(camelotLabel("B Minor")).toBe("10A");
    expect(camelotLabel("G Major")).toBe("9B");
  });

  it("bajar una quinta retrocede un número", () => {
    expect(camelotLabel("D Minor")).toBe("7A");
    expect(camelotLabel("F Major")).toBe("7B");
  });

  it("da la vuelta completa sin agujeros", () => {
    // Las 24 tonalidades tienen que ocupar las 24 casillas, una cada
    // una: si dos cayeran en la misma, el filtro dejaría pasar cosas
    // que chocan.
    const roots = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];
    const codes = new Set<string>();
    for (const root of roots) {
      for (const mode of ["Major", "Minor"]) {
        const parsed = parseSampleKey(`${root} ${mode}`);
        expect(parsed).not.toBeNull();
        const code = camelotFor(parsed!);
        expect(code.number).toBeGreaterThanOrEqual(1);
        expect(code.number).toBeLessThanOrEqual(12);
        codes.add(`${code.number}${code.letter}`);
      }
    }
    expect(codes.size).toBe(24);
  });
});

describe("keysAreCompatible", () => {
  it("la relativa mayor entra", () => {
    expect(keysAreCompatible("A Minor", "C Major")).toBe(true);
    expect(keysAreCompatible("C Major", "A Minor")).toBe(true);
  });

  it("las quintas vecinas entran", () => {
    expect(keysAreCompatible("A Minor", "E Minor")).toBe(true);
    expect(keysAreCompatible("A Minor", "D Minor")).toBe(true);
  });

  it("una tonalidad lejana no entra", () => {
    // Eb Major está al otro lado de la rueda de A Minor: comparten
    // muy pocas notas y el choque se escucha.
    expect(keysAreCompatible("A Minor", "Eb Major")).toBe(false);
    expect(keysAreCompatible("A Minor", "F# Major")).toBe(false);
  });

  it("los vecinos 12 y 1 son vecinos de verdad", () => {
    // Es una RUEDA: si la comparación fuera una resta simple, el salto
    // de 12A a 1A (Ab Minor → Eb Minor, una quinta justa) daría 11 de
    // distancia y quedaría marcado como incompatible.
    expect(keysAreCompatible("Eb Minor", "G# Minor")).toBe(true);
  });

  it("sin tonalidad, siempre entra", () => {
    expect(keysAreCompatible("A Minor", "N/A")).toBe(true); // un bombo
    expect(keysAreCompatible("", "Eb Major")).toBe(true); // proyecto sin tonalidad definida
    expect(keysAreCompatible(null, null)).toBe(true);
  });
});

describe("transposeSemitonesFor", () => {
  it("no toca lo que ya está en tono", () => {
    expect(transposeSemitonesFor("A Minor", "A Minor")).toBe(0);
  });

  it("no toca lo que YA ENTRA aunque no sea la misma tonalidad", () => {
    // La regla que se descubrió mirándolo en pantalla: E Minor es la
    // quinta de A Minor y suena perfecto tal cual. Llevarlo al tónico
    // costaría 5 semitonos, le cambiaría el cuerpo al instrumento y
    // metería artefactos del motor a cambio de nada.
    expect(transposeSemitonesFor("A Minor", "E Minor")).toBe(0);
    expect(transposeSemitonesFor("A Minor", "D Minor")).toBe(0);
    expect(transposeSemitonesFor("A Minor", "C Major")).toBe(0);
  });

  it("cuando no entra, busca el desplazamiento más chico que lo arregle", () => {
    // Eb Major está lejos de A Minor. Bajarlo 3 lo deja en C Major, la
    // relativa — mucho menos que los 5 que costaría clavarlo en A.
    const shift = transposeSemitonesFor("A Minor", "Eb Major");
    expect(shift).toBe(-3);
    expect(keysAreCompatible("A Minor", "C Major")).toBe(true);
  });

  it("el resultado SIEMPRE entra", () => {
    // La propiedad que de verdad importa: sea cual sea el sample, lo
    // que se escucha después de transponer tiene que ser compatible.
    const roots = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];
    for (const root of roots) {
      for (const mode of ["Major", "Minor"]) {
        const sampleKey = `${root} ${mode}`;
        const shift = transposeSemitonesFor("A Minor", sampleKey);
        const parsed = parseSampleKey(sampleKey)!;
        const shifted = ((parsed.pitchClass + shift) % 12 + 12) % 12;
        const shiftedName = `${roots[shifted]} ${mode}`;
        expect(keysAreCompatible("A Minor", shiftedName)).toBe(true);
      }
    }
  });

  it("elige siempre el camino más corto", () => {
    // De B Minor a C Minor son 1 semitono para arriba, no 11 para abajo.
    expect(transposeSemitonesFor("C Minor", "B Minor")).toBe(1);
    // Y al revés.
    expect(transposeSemitonesFor("B Minor", "C Minor")).toBe(-1);
  });

  it("nunca se pasa de media octava", () => {
    const roots = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];
    for (const root of roots) {
      const semitones = transposeSemitonesFor("A Minor", `${root} Minor`);
      expect(semitones).toBeGreaterThanOrEqual(-5);
      expect(semitones).toBeLessThanOrEqual(6);
    }
  });

  it("cuando los modos difieren apunta a la relativa, no al mismo tónico", () => {
    // Un sample en Major dentro de un proyecto en A Minor tiene que
    // terminar en C Major (la relativa), no en A Major — que metería
    // una tercera mayor peleándose con toda la armonía.
    expect(transposeSemitonesFor("A Minor", "C Major")).toBe(0);
    expect(transposeSemitonesFor("A Minor", "D Major")).toBe(-2); // D Major → C Major
    expect(transposeSemitonesFor("C Major", "A Minor")).toBe(0);
  });

  it("sin tonalidad no transpone nada", () => {
    // Transponer un bombo es puro daño: le cambia el cuerpo sin
    // ninguna ganancia armónica.
    expect(transposeSemitonesFor("A Minor", "N/A")).toBe(0);
    expect(transposeSemitonesFor("", "C Major")).toBe(0);
  });
});

describe("tempoDistance", () => {
  it("mide la diferencia directa", () => {
    expect(tempoDistance(120, 120)).toBe(0);
    expect(tempoDistance(110, 120)).toBe(10);
  });

  it("el medio tiempo y el doble cuentan como el mismo pulso", () => {
    // Un loop de 70 cae perfecto en un proyecto de 140: un compás suyo
    // por cada dos del proyecto.
    expect(tempoDistance(70, 140)).toBe(0);
    expect(tempoDistance(160, 80)).toBe(0);
  });

  it("sin tempo no es 'lejos', es 'no aplica'", () => {
    expect(tempoDistance(0, 120)).toBeNull();
    expect(tempoDistance(90, null)).toBeNull();
  });
});

describe("stretchRatioFor", () => {
  it("es el factor real que aplica el motor", () => {
    expect(stretchRatioFor(90, 120, "Loop")).toBeCloseTo(1.3333, 4);
  });

  it("los One-Shot no se estiran nunca", () => {
    // Espejo exacto de playbackRateFor en el Arranger: si esto y
    // aquello dejaran de coincidir, la ficha anunciaría un
    // estiramiento que no va a ocurrir.
    expect(stretchRatioFor(90, 120, "One-Shot")).toBeNull();
  });

  it("avisa cuando el estiramiento se va a escuchar", () => {
    expect(isExtremeStretch(stretchRatioFor(70, 140, "Loop"))).toBe(true); // ×2
    expect(isExtremeStretch(stretchRatioFor(115, 120, "Loop"))).toBe(false);
    expect(isExtremeStretch(null)).toBe(false);
  });
});

describe("affinityFor", () => {
  const project = { bpm: 120, key: "A Minor" };

  function rank(sample: { bpm: number; key: string; type: string }) {
    return affinityFor(sample, project.bpm, project.key).rank;
  }

  it("la tonalidad pesa más que el tempo", () => {
    // Un sample en tono pero 20 BPM lejos gana contra uno con el tempo
    // clavado en una tonalidad que pelea: el tempo se estira, la
    // tonalidad no se arregla sola.
    const enTono = { bpm: 100, key: "C Major", type: "Loop" };
    const enTempo = { bpm: 120, key: "Eb Major", type: "Loop" };
    expect(rank(enTono)).toBeLessThan(rank(enTempo));
  });

  it("a igual tonalidad, gana el tempo más cercano", () => {
    expect(rank({ bpm: 118, key: "A Minor", type: "Loop" })).toBeLessThan(
      rank({ bpm: 95, key: "A Minor", type: "Loop" }),
    );
  });

  it("los One-Shot quedan en el medio, no al final", () => {
    // Son usables siempre, pero quien ordena por afinidad casi siempre
    // busca un loop que encaje.
    const oneShot = { bpm: 0, key: "N/A", type: "One-Shot" };
    const loopCercano = { bpm: 121, key: "A Minor", type: "Loop" };
    const loopQuePelea = { bpm: 120, key: "F# Major", type: "Loop" };
    expect(rank(loopCercano)).toBeLessThan(rank(oneShot));
    expect(rank(oneShot)).toBeLessThan(rank(loopQuePelea));
  });

  it("informa además de ordenar", () => {
    const score = affinityFor({ bpm: 90, key: "D Major", type: "Loop" }, 120, "A Minor");
    expect(score.keyFits).toBe(false);
    expect(score.semitones).toBe(-2); // D Major → C Major, la relativa de A Minor
    expect(score.stretchRatio).toBeCloseTo(1.3333, 4);
  });
});

describe("transponer una tonalidad", () => {
  it("mueve la tónica y conserva el modo", () => {
    expect(transposeKey("G Minor", 2)).toBe("A Minor");
    expect(transposeKey("C Major", 4)).toBe("E Major");
  });

  it("baja y da la vuelta por el otro lado", () => {
    expect(transposeKey("C Minor", -1)).toBe("B Minor");
    expect(transposeKey("B Major", 1)).toBe("C Major");
  });

  it("con cero devuelve lo mismo", () => {
    expect(transposeKey("Eb Major", 0)).toBe("Eb Major");
  });

  it("de lo que no tiene tonalidad no inventa nada", () => {
    expect(transposeKey("N/A", 3)).toBeNull();
    expect(transposeKey("", 3)).toBeNull();
    expect(transposeKey(null, 3)).toBeNull();
  });

  it("lo que devuelve es SIEMPRE un nombre que el catálogo conoce", () => {
    // Si devolviera "A# Minor" en vez de "Bb Minor", el <select> del
    // clip se quedaría sin opción seleccionada y el valor se perdería
    // al guardar.
    for (const raw of ["C Major", "A Minor", "F# Minor", "Bb Major"]) {
      for (let shift = -12; shift <= 12; shift++) {
        const moved = transposeKey(raw, shift)!;
        expect(SAMPLE_KEYS as readonly string[]).toContain(moved);
      }
    }
  });

  it("transponer lo que YA entra por lo que falta lo deja compatible", () => {
    // Es la propiedad que sostiene el botón "Adaptar": partir de cómo
    // suena, sumar lo que falta, y quedar adentro.
    for (const projectKey of ["A Minor", "C Major", "F# Minor"]) {
      for (const clipKey of ["G Minor", "Eb Major", "B Major", "D Minor"]) {
        const missing = transposeSemitonesFor(projectKey, clipKey);
        const sounding = transposeKey(clipKey, missing)!;
        expect(keysAreCompatible(projectKey, sounding)).toBe(true);
      }
    }
  });
});

describe("keyLabel", () => {
  it("muestra la notación corta, no el código Camelot", () => {
    expect(keyLabel("A Minor")).toBe("A min");
    expect(keyLabel("C Major")).toBe("C maj");
    expect(keyLabel("F# Minor")).toBe("F# min");
    expect(keyLabel("Eb Major")).toBe("Eb maj");
  });

  it("normaliza cómo se haya cargado la ficha", () => {
    expect(keyLabel("a minor")).toBe("A min");
    expect(keyLabel("Am")).toBe("A min");
    expect(keyLabel("C maj")).toBe("C maj");
  });

  it("sin tonalidad no muestra nada", () => {
    expect(keyLabel("N/A")).toBeNull();
    expect(keyLabel("")).toBeNull();
    expect(keyTooltip(null)).toBeNull();
  });

  it("el tooltip conserva el nombre completo y el código Camelot", () => {
    expect(keyTooltip("A Minor")).toBe("A Minor · Camelot 8A");
  });
});
