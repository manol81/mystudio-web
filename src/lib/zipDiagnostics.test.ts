import { describe, expect, it } from "vitest";
import { describeBrokenArchive, looksLikeZip } from "./zipDiagnostics";

function bytesOf(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function zipBytes(extra = 64): Uint8Array {
  const head = bytesOf("PK\u0003\u0004");
  const out = new Uint8Array(head.length + extra);
  out.set(head, 0);
  return out;
}

describe("looksLikeZip", () => {
  it("reconoce una entrada local", () => {
    expect(looksLikeZip(zipBytes())).toBe(true);
  });

  it("reconoce un ZIP vacío (solo end of central directory)", () => {
    expect(looksLikeZip(bytesOf("PK\u0005\u0006"))).toBe(true);
  });

  it("no confunde cualquier cosa que empiece con PK", () => {
    expect(looksLikeZip(bytesOf("PKZZ"))).toBe(false);
  });

  it("no explota con un archivo más corto que la firma", () => {
    expect(looksLikeZip(new Uint8Array([0x50]))).toBe(false);
  });
});

describe("describeBrokenArchive", () => {
  it("un archivo vacío se explica como descarga incompleta", () => {
    const msg = describeBrokenArchive(new Uint8Array(0), "Primero.mystudio")!;
    expect(msg).toContain("vacío");
    expect(msg).toContain("Primero.mystudio");
  });

  // El caso que más pasa: la descarga falla, el navegador guarda la
  // respuesta del servidor igual, y el archivo PARECE un proyecto.
  it("el XML de error de Storage se explica, con el motivo adentro", () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code>' +
      "<Message>Anonymous caller does not have storage.objects.get access.</Message></Error>";
    const msg = describeBrokenArchive(bytesOf(xml))!;
    expect(msg).toContain("error que devolvió el servidor");
    expect(msg).toContain("storage.objects.get");
  });

  it("una página HTML se explica como enlace vencido o con sesión", () => {
    const msg = describeBrokenArchive(bytesOf("<!DOCTYPE html><html><body>Iniciá sesión"))!;
    expect(msg).toContain("página web");
  });

  it("un JSON de error también se detecta", () => {
    const msg = describeBrokenArchive(bytesOf('{"error":{"code":403,"message":"nope"}}'))!;
    expect(msg).toContain("error que devolvió el servidor");
  });

  it("un MP3 con etiqueta ID3 se nombra como MP3", () => {
    const msg = describeBrokenArchive(bytesOf("ID3\u0003\u0000"), "mezcla.mp3")!;
    expect(msg).toContain("es un MP3");
  });

  it("un MP3 sin etiqueta (frame sync) también", () => {
    const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0x00]);
    expect(describeBrokenArchive(mp3)).toContain("es un MP3");
  });

  it("un WAV se nombra como WAV", () => {
    expect(describeBrokenArchive(bytesOf("RIFF....WAVEfmt "))).toContain("es un WAV");
  });

  // La firma está bien y el contenido no: el índice del ZIP vive al
  // final, así que un archivo cortado se ve intacto por delante.
  it("un ZIP con la firma correcta se explica como archivo cortado", () => {
    const msg = describeBrokenArchive(zipBytes(4096), "Primero.mystudio")!;
    expect(msg).toContain("incompleto");
    expect(msg).toContain("KB");
  });

  it("lo desconocido no se inventa: dice cómo se consigue un proyecto", () => {
    const junk = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
    const msg = describeBrokenArchive(junk)!;
    expect(msg).toContain("no es un proyecto .mystudio válido");
    expect(msg).toContain("Exportar proyecto");
  });

  it("el nombre del archivo aparece solo si se pasó", () => {
    expect(describeBrokenArchive(zipBytes(), "x.mystudio")).toContain("«x.mystudio»");
    expect(describeBrokenArchive(zipBytes())).not.toContain("«");
  });
});
