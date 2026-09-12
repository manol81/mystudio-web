// scripts/samples.mjs
//
// Carga MASIVA de samples al Banco de Sonidos.
//
// Por qué existe: el panel web sube de a UNO, y cada sample son dos
// operaciones (el audio a Storage, la ficha a Firestore). Veinte samples
// son veinte trámites idénticos. Esto los hace todos de una corrida.
//
// Uso, en dos pasos:
//
//   1) node scripts/samples.mjs scan ./mis-samples
//      Recorre la carpeta y escribe `samples.csv` con una fila por
//      audio. Intenta adivinar BPM y tonalidad DESDE EL NOMBRE del
//      archivo, que es donde los packs suelen ponerlos
//      (`kick_90bpm_Am.wav`). Lo que no puede adivinar queda vacío.
//
//   2) Completás/corregís el CSV con cualquier editor o planilla.
//
//   3) node scripts/samples.mjs upload ./mis-samples
//      Valida TODO antes de tocar nada, y recién ahí sube.
//
// ─── Autenticación ────────────────────────────────────────────────────
//
// Por defecto usa Application Default Credentials:
//
//   gcloud auth application-default login
//
// Se prefiere eso a una clave de service account porque NO deja ningún
// archivo con acceso total al proyecto dado vuelta en el disco. Si
// igual necesitás usar una clave (por ejemplo en una máquina sin
// gcloud), pasá --key <ruta.json>.
//
// ─── Por qué el script se saltea las reglas ───────────────────────────
//
// firestore.rules y storage.rules exigen el custom claim admin para
// escribir en /samples. El Admin SDK no pasa por las reglas: actúa como
// el proyecto. Por eso esto corre en TU máquina y nunca en el cliente.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

const PROJECT_ID = "my-studio-4530a";
const BUCKET = "my-studio-4530a.firebasestorage.app";
const CSV_NAME = "samples.csv";
const AUDIO_EXTS = new Set([".wav", ".mp3"]);

// ─── Taxonomía ────────────────────────────────────────────────────────
//
// Se LEE de src/lib/sampleTaxonomy.ts en vez de duplicarse acá. Ese
// archivo es la fuente única que usan el panel de admin y el filtro del
// catálogo; una copia en este script se desincronizaría en silencio, y
// el síntoma sería un sample que existe pero que ningún filtro
// encuentra. Se parsea con expresiones regulares porque este script es
// JavaScript plano y no puede importar TypeScript.

function readTaxonomy() {
  const src = readFileSync(
    resolve(import.meta.dirname, "../src/lib/sampleTaxonomy.ts"),
    "utf8",
  );

  const arrayOf = (name) => {
    const m = src.match(new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`));
    if (!m) throw new Error(`No pude leer ${name} de sampleTaxonomy.ts`);
    return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  };

  const roots = arrayOf("KEY_ROOTS");
  return {
    types: arrayOf("SAMPLE_TYPES"),
    instruments: arrayOf("SAMPLE_INSTRUMENTS"),
    genres: arrayOf("SAMPLE_GENRES"),
    // Mismo armado que el TS: "N/A" + cada raíz en Major y Minor.
    keys: ["N/A", ...roots.flatMap((r) => [`${r} Major`, `${r} Minor`])],
  };
}

// ─── CSV ──────────────────────────────────────────────────────────────
//
// Mínimo y a mano: son seis columnas sin comas adentro salvo el nombre,
// y sumar una dependencia de CSV para esto sería desproporcionado. Se
// soportan comillas para el nombre, que es el único campo libre.

const COLUMNS = ["archivo", "name", "type", "instrument", "genre", "bpm", "key"];

function toCsvValue(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// ─── Adivinar BPM y tonalidad del nombre del archivo ──────────────────
//
// Heurística deliberadamente conservadora: ante la duda deja el campo
// vacío para que lo completes vos. Un dato inventado es peor que uno
// faltante — el faltante se ve, el inventado no.

function guessBpm(filename) {
  // "90bpm", "90 bpm", "bpm90" y, como último recurso, un número suelto
  // entre 60 y 200 rodeado de separadores.
  const explicit = filename.match(/(\d{2,3})\s*bpm/i) ?? filename.match(/bpm\s*(\d{2,3})/i);
  if (explicit) return Number(explicit[1]);
  const loose = filename.match(/[_\-\s](\d{2,3})[_\-\s.]/);
  if (loose) {
    const n = Number(loose[1]);
    if (n >= 60 && n <= 200) return n;
  }
  return "";
}

// Dos detalles que parecen menores y no lo son, los dos encontrados
// probando con nombres reales de packs:
//
//   · El orden de las alternativas importa. Con /(m|min|maj)/ la "m"
//     gana primero y "Cmaj" se lee como menor. Van de más larga a más
//     corta.
//   · NO se puede cerrar con \b. En "F#m_75bpm" el guion bajo es
//     carácter de palabra, así que entre "m" y "_" no hay borde y la
//     tonalidad no se detectaba. Se usa un negativo de letra.
const KEY_RE = /[_\-\s]([A-G][#b]?)\s*(minor|major|min|maj|m)(?![a-z])/i;

function guessKey(filename, validKeys) {
  const m = filename.match(KEY_RE);
  if (!m) return "";
  const root = m[1][0].toUpperCase() + (m[1][1] ?? "").replace(/B/i, "b");
  const suf = m[2].toLowerCase();
  const isMinor = suf === "m" || suf.startsWith("min");
  const candidate = `${root} ${isMinor ? "Minor" : "Major"}`;
  return validKeys.includes(candidate) ? candidate : "";
}

const BPM_RE = /[_\-\s]?\d{2,3}\s*bpm/i;

/**
 * Nombre legible.
 *
 * Saca del nombre justamente lo que se detectó como BPM y tonalidad —
 * no un patrón genérico — para no comerse un número o una letra que
 * formen parte del nombre real del sonido.
 */
function guessName(filename) {
  let s = basename(filename, extname(filename));
  s = s.replace(BPM_RE, " ");
  const k = s.match(KEY_RE);
  if (k) s = s.replace(k[0], " ");
  return s.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function listAudio(dir) {
  return readdirSync(dir)
    .filter((f) => AUDIO_EXTS.has(extname(f).toLowerCase()))
    .filter((f) => statSync(join(dir, f)).isFile())
    .sort();
}

// ─── scan ─────────────────────────────────────────────────────────────

function cmdScan(dir) {
  const tax = readTaxonomy();
  const files = listAudio(dir);
  if (files.length === 0) {
    console.error(`No encontré archivos .wav ni .mp3 en ${dir}`);
    process.exit(1);
  }

  const csvPath = join(dir, CSV_NAME);
  // Si ya existe un CSV, se respeta lo que hayas completado y solo se
  // agregan las filas de archivos nuevos. Volver a escanear después de
  // sumar audios no te borra el trabajo hecho.
  const previo = new Map();
  if (existsSync(csvPath)) {
    const lineas = readFileSync(csvPath, "utf8").split(/\r?\n/).filter(Boolean).slice(1);
    for (const l of lineas) {
      const v = parseCsvLine(l);
      if (v[0]) previo.set(v[0], v);
    }
  }

  const filas = files.map((f) => {
    if (previo.has(f)) return previo.get(f);
    return [
      f,
      guessName(f),
      "", // type
      "", // instrument
      "", // genre
      guessBpm(f),
      guessKey(f, tax.keys),
    ];
  });

  const csv = [COLUMNS.join(","), ...filas.map((r) => r.map(toCsvValue).join(","))].join("\n");
  writeFileSync(csvPath, csv + "\n", "utf8");

  const nuevos = filas.length - previo.size;
  console.log(`Escritos ${filas.length} registros en ${csvPath} (${nuevos} nuevos).`);
  console.log("\nCompletá las columnas vacías. Valores válidos:");
  console.log(`  type:       ${tax.types.join(" | ")}`);
  console.log(`  instrument: ${tax.instruments.join(" | ")}`);
  console.log(`  genre:      ${tax.genres.join(" | ")}`);
  console.log(`  key:        N/A, o "C Major" / "A Minor" (12 raíces × Major/Minor)`);
  console.log(`\nDespués: node scripts/samples.mjs upload ${dir}`);
}

// ─── upload ───────────────────────────────────────────────────────────

/**
 * Id estable derivado del nombre del archivo.
 *
 * Es lo que hace que correr el script dos veces ACTUALICE en vez de
 * duplicar: si te equivocaste en un BPM, lo corregís en el CSV, volvés
 * a correr y el mismo documento se pisa. Con ids al azar, la segunda
 * corrida te dejaba el catálogo duplicado y sin forma simple de saber
 * cuál era cuál.
 */
function idFor(filename) {
  return basename(filename, extname(filename))
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function cmdUpload(dir, keyPath) {
  const tax = readTaxonomy();
  const csvPath = join(dir, CSV_NAME);
  if (!existsSync(csvPath)) {
    console.error(`No existe ${csvPath}. Corré primero: node scripts/samples.mjs scan ${dir}`);
    process.exit(1);
  }

  const lineas = readFileSync(csvPath, "utf8").split(/\r?\n/).filter(Boolean);
  const filas = lineas.slice(1).map(parseCsvLine);

  // ─── Validar TODO antes de subir nada ───
  //
  // A propósito se valida el lote entero y recién después se sube: una
  // corrida a medias deja el catálogo en un estado que hay que auditar a
  // mano para saber qué entró y qué no.
  const errores = [];
  const vistos = new Set();
  const items = [];

  for (const [i, v] of filas.entries()) {
    const linea = i + 2; // +1 por el encabezado, +1 porque las planillas cuentan desde 1
    const [archivo, name, type, instrument, genre, bpmRaw, key] = v;
    const donde = `fila ${linea} (${archivo || "sin archivo"})`;

    if (!archivo) { errores.push(`${donde}: falta el nombre del archivo`); continue; }
    const ruta = join(dir, archivo);
    if (!existsSync(ruta)) { errores.push(`${donde}: el archivo no existe`); continue; }

    const id = idFor(archivo);
    if (vistos.has(id)) {
      errores.push(`${donde}: dos archivos generan el mismo id "${id}" — renombrá uno`);
      continue;
    }
    vistos.add(id);

    if (!name) errores.push(`${donde}: falta name`);
    if (!tax.types.includes(type)) errores.push(`${donde}: type "${type}" no es válido`);
    if (!tax.instruments.includes(instrument)) errores.push(`${donde}: instrument "${instrument}" no es válido`);
    if (!tax.genres.includes(genre)) errores.push(`${donde}: genre "${genre}" no es válido`);
    if (!tax.keys.includes(key)) errores.push(`${donde}: key "${key}" no es válida`);

    const bpm = Number(bpmRaw);
    if (!Number.isFinite(bpm) || bpm <= 0) errores.push(`${donde}: bpm "${bpmRaw}" no es un número`);

    items.push({ id, ruta, archivo, name, type, instrument, genre, bpm, key });
  }

  if (errores.length > 0) {
    console.error(`\n${errores.length} problema(s). No se subió nada:\n`);
    for (const e of errores) console.error(`  • ${e}`);
    console.error("\nCorregí el CSV y volvé a correr.");
    process.exit(1);
  }

  // ─── Subir ───
  initializeApp({
    credential: keyPath
      ? cert(JSON.parse(readFileSync(keyPath, "utf8")))
      : applicationDefault(),
    projectId: PROJECT_ID,
    storageBucket: BUCKET,
  });
  const db = getFirestore();
  const bucket = getStorage().bucket();

  console.log(`Subiendo ${items.length} samples…\n`);
  let n = 0;
  for (const it of items) {
    const ext = extname(it.archivo).toLowerCase().slice(1);
    const audioPath = `samples/${it.id}/audio.${ext}`;

    await bucket.upload(it.ruta, {
      destination: audioPath,
      metadata: { contentType: ext === "mp3" ? "audio/mpeg" : "audio/wav" },
    });

    // merge para no perder createdAt si el sample ya existía: re-subir
    // para corregir un dato no debería cambiarle la fecha de alta.
    await db.collection("samples").doc(it.id).set(
      {
        name: it.name,
        type: it.type,
        instrument: it.instrument,
        genre: it.genre,
        bpm: it.bpm,
        key: it.key,
        audioPath,
        sizeBytes: statSync(it.ruta).size,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    n++;
    console.log(`  [${n}/${items.length}] ${it.name}  →  ${it.id}`);
  }
  console.log(`\nListo. ${n} samples en el catálogo.`);
}

// ─── Entrada ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const keyIdx = args.indexOf("--key");
const keyPath = keyIdx >= 0 ? args[keyIdx + 1] : null;
if (keyIdx >= 0) args.splice(keyIdx, 2);

const [cmd, dirArg] = args;
const dir = dirArg ? resolve(dirArg) : null;

if (!cmd || !dir || !["scan", "upload"].includes(cmd)) {
  console.error(`Uso:
  node scripts/samples.mjs scan   <carpeta>        genera/actualiza samples.csv
  node scripts/samples.mjs upload <carpeta>        valida y sube todo

Opcional: --key <service-account.json> si no usás
          "gcloud auth application-default login".`);
  process.exit(1);
}

if (!existsSync(dir)) {
  console.error(`No existe la carpeta ${dir}`);
  process.exit(1);
}

if (cmd === "scan") cmdScan(dir);
else await cmdUpload(dir, keyPath);
