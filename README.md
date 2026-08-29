# MY STUDIO — Web Arranger

Secuenciador multipista en el navegador para armar canciones con
samples del Banco de Sonidos, sincronizarlas como archivos `.mystudio`
y editar proyectos que vienen de la app móvil (MY STUDIO, Flutter +
motor de audio nativo en C++/Oboe) — o exportarlos de vuelta hacia ella.

Consume el **mismo** proyecto de Firebase que la app Android (Auth,
Firestore, Storage) — no hay backend propio.

## Funcionalidad principal

- Arrastrar y soltar samples del Banco de Sonidos a una línea de
  tiempo multipista, con volumen/pan/mute/solo por pista y por clip
  (fades, recorte no destructivo, pitch-shift).
- Time-stretching real (tempo) vía [SoundTouchJS](https://github.com/cutterbl/SoundTouchJS)
  corriendo en un Web Worker, y pitch-shifting real (tono) vía
  [signalsmith-stretch](https://github.com/Signalsmith-Audio/stretch)
  (WASM + AudioWorklet) — cada uno en una pasada independiente,
  cacheados globalmente, sin bloquear jamás el hilo principal.
- Regla de tiempo intercambiable entre segundos y compases/beats.
- Exportación a `.mystudio` (ZIP con `manifest.json` + WAVs) 100%
  compatible con `project_backup_service.dart` del lado Flutter, e
  importación del mismo formato para edición bidireccional.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript ·
Tailwind CSS v4 · Firebase JS SDK.

## Desarrollo local

```bash
npm install
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000).

```bash
npm run build   # build de producción
npm run lint    # ESLint
```

## Variables de entorno

Ninguna es obligatoria hoy: la configuración de cliente de Firebase
(`src/lib/firebase.ts`) está embebida directamente en el código —no es
información secreta, es el mismo criterio que usa cualquier app
Firebase, incluida la app Android—, así que el proyecto conecta sin
configurar nada extra en Vercel.

## Administración del Banco de Sonidos

Subir/dar de alta samples (`/admin/upload-sample`) requiere el custom
claim `admin: true` en Firebase Auth. Para otorgarlo:

```bash
node scripts/set-admin-claim.mjs <email> <ruta-a-service-account.json>
```

La clave de la service account se descarga desde Firebase Console →
Configuración del proyecto → Cuentas de servicio. **Nunca se commitea**
— guardala fuera de este repo (el `.gitignore` también la excluye como
red de seguridad extra).

## Deploy

Pensado para Vercel: conectar este repositorio, sin configuración
adicional de Root Directory (es un proyecto Next.js standalone, no una
subcarpeta de un monorepo).
