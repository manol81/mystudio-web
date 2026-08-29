// scripts/set-admin-claim.mjs
//
// Uso (una vez por cuenta que necesite subir samples al Banco de
// Sonidos):
//
//   node scripts/set-admin-claim.mjs <email> <ruta-a-service-account.json>
//
// Por qué existe este script: firestore.rules y storage.rules exigen
// request.auth.token.admin == true para escribir en /samples — un
// custom claim de Firebase Auth. Los custom claims SOLO se pueden
// setear con el Admin SDK autenticado con una service account, nunca
// desde el cliente (si el cliente pudiera auto-otorgárselo, esas
// reglas de seguridad no protegerían nada). Este script es la única
// vía para dar de alta un admin.
//
// La clave de la service account se descarga desde Firebase Console →
// engranaje ⚙ → Configuración del proyecto → Cuentas de servicio →
// "Generar nueva clave privada". Da acceso TOTAL al proyecto de
// Firebase — guardala fuera de este repo (p.ej. tu carpeta de usuario)
// y nunca la commitees (el .gitignore raíz ya excluye
// *serviceAccount*.json y *firebase-adminsdk*.json como red de
// seguridad extra, pero no dependas de eso).

import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const [, , email, keyPath] = process.argv;

if (!email || !keyPath) {
  console.error(
    "Uso: node scripts/set-admin-claim.mjs <email> <ruta-a-service-account.json>",
  );
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(keyPath, "utf8"));

initializeApp({ credential: cert(serviceAccount) });

const auth = getAuth();
const user = await auth.getUserByEmail(email);
await auth.setCustomUserClaims(user.uid, { admin: true });

console.log(`✓ ${email} (uid: ${user.uid}) ahora tiene el claim admin:true.`);
console.log(
  "Si ya tenía sesión abierta en el navegador, no hace falta re-loguearse: " +
    "/admin/upload-sample fuerza un refresh del token al cargar la página.",
);
