// src/lib/zipDiagnostics.ts
//
// Qué es REALMENTE el archivo que alguien intentó abrir como .mystudio.
//
// JSZip, cuando lo que recibe no es un ZIP, dice "Corrupted zip: can't
// find end of central directory". Es cierto y es inútil: la persona no
// tiene forma de saber si el archivo se bajó a medias, si le mandaron
// otra cosa, o si la descarga devolvió una página de error que el
// navegador guardó igual con extensión .mystudio — que es el caso más
// común, porque una descarga fallida NO se ve como un error: se ve como
// un archivo.
//
// Mirar los primeros bytes alcanza para distinguirlos, porque casi todo
// formato empieza con una firma fija. Esto no valida el ZIP (de eso se
// encarga JSZip): responde la única pregunta que le sirve a quien está
// mirando el cartel — qué pasó y a quién reclamarle.

/// Los primeros bytes como texto ASCII, para comparar firmas sin
/// depender de TextDecoder ni del encoding real del archivo.
function ascii(bytes: Uint8Array, length: number): string {
  let out = "";
  for (let i = 0; i < Math.min(length, bytes.length); i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function formatSize(byteLength: number): string {
  if (byteLength < 1024) return `${byteLength} bytes`;
  if (byteLength < 1024 * 1024) return `${Math.round(byteLength / 1024)} KB`;
  return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`;
}

/// true si empieza con la firma de un ZIP: entrada local (PK\x03\x04) o
/// archivo vacío (PK\x05\x06, el "end of central directory" solo).
export function looksLikeZip(bytes: Uint8Array): boolean {
  const head = ascii(bytes, 4);
  return head === "PK\u0003\u0004" || head === "PK\u0005\u0006";
}

/// El texto de <Message> de un error XML de Google Cloud Storage, si
/// está. Es la frase que explica por qué falló la descarga
/// ("Anonymous caller does not have storage.objects.get access...").
function xmlMessage(text: string): string | null {
  const match = /<Message>([^<]{1,200})<\/Message>/i.exec(text);
  return match ? match[1].trim() : null;
}

/**
 * Un mensaje en castellano que explica qué es este archivo y qué hacer,
 * o `null` si parece un ZIP de verdad y el problema es otro.
 *
 * [fileName] se usa solo para el texto; el diagnóstico sale siempre del
 * contenido, porque la extensión es justamente lo que miente en el caso
 * que más pasa (una página de error guardada como `.mystudio`).
 */
export function describeBrokenArchive(bytes: Uint8Array, fileName?: string): string | null {
  const name = fileName ? `«${fileName}» ` : "";
  const size = formatSize(bytes.byteLength);

  if (bytes.byteLength === 0) {
    return `El archivo ${name}está vacío (0 bytes). La descarga no llegó a completarse: pedí que te lo manden de nuevo.`;
  }

  // Empieza con el texto de una respuesta HTTP y no con bytes binarios:
  // lo que se guardó es la RESPUESTA DEL SERVIDOR, no el archivo.
  const head = ascii(bytes, 512);
  const trimmed = head.replace(/^﻿/, "").trimStart();

  if (/^<\?xml|^<Error/i.test(trimmed)) {
    const detail = xmlMessage(head);
    return (
      `El archivo ${name}no es un proyecto: es el mensaje de error que devolvió el servidor al descargarlo` +
      (detail ? ` («${detail}»)` : "") +
      `. El enlace de descarga venció o no tenía permiso. Pedí uno nuevo.`
    );
  }

  if (/^<!doctype html|^<html/i.test(trimmed)) {
    return `El archivo ${name}no es un proyecto: es una página web que se guardó en su lugar (${size}). Suele pasar cuando el enlace de descarga pide iniciar sesión o ya venció.`;
  }

  if (/^\{|^\[/.test(trimmed) && /"error"/i.test(head)) {
    return `El archivo ${name}no es un proyecto: es el mensaje de error que devolvió el servidor al descargarlo. Pedí un enlace nuevo.`;
  }

  // Formatos que se confunden seguido con un proyecto: alguien manda el
  // audio en vez del proyecto, o el archivo llega con otra extensión.
  const signatures: { test: (b: Uint8Array, h: string) => boolean; what: string }[] = [
    { test: (_b, h) => h.startsWith("ID3"), what: "un MP3" },
    { test: (b) => b[0] === 0xff && (b[1] & 0xe0) === 0xe0, what: "un MP3" },
    { test: (_b, h) => h.startsWith("RIFF"), what: "un WAV" },
    { test: (_b, h) => h.startsWith("OggS"), what: "un audio OGG" },
    { test: (_b, h) => h.startsWith("fLaC"), what: "un FLAC" },
    { test: (_b, h) => h.startsWith("%PDF"), what: "un PDF" },
    { test: (_b, h) => h.startsWith("Rar!"), what: "un comprimido RAR" },
    { test: (_b, h) => h.startsWith("7z"), what: "un comprimido 7z" },
    { test: (b) => b[0] === 0x1f && b[1] === 0x8b, what: "un comprimido GZIP" },
  ];
  for (const sig of signatures) {
    if (sig.test(bytes, head)) {
      return `El archivo ${name}es ${sig.what}, no un proyecto .mystudio (${size}). Un proyecto se exporta desde la app con «Exportar proyecto» o se baja del Dashboard de la web.`;
    }
  }

  if (looksLikeZip(bytes)) {
    // Firma correcta pero JSZip no pudo leerlo: llegó cortado. El
    // índice de un ZIP va al FINAL, así que un archivo truncado
    // conserva el principio intacto y falla recién al abrirlo.
    return `El archivo ${name}está incompleto: llegó cortado (${size}) y le falta el final. Pedí que te lo manden de nuevo, o volvé a descargarlo.`;
  }

  return `El archivo ${name}no es un proyecto .mystudio válido (${size}). Un proyecto se exporta desde la app con «Exportar proyecto» o se baja del Dashboard de la web.`;
}
