// src/lib/firebase.ts
//
// Inicialización del SDK de Firebase para el dashboard web — MISMO
// proyecto de Firebase que usa la app móvil (ver firestore.rules /
// storage.rules en la raíz del workspace), solo que consumido acá con
// el SDK de JS en vez del de Flutter. Ninguna colección/regla se
// duplica: Auth/Firestore/Storage son agnósticos al framework que los
// consume.
//
// getApps().length evita reinicializar la app en cada hot-reload de
// Next.js en desarrollo (initializeApp lanzaría si ya existe una app
// con ese nombre).
//
// apiKey/authDomain/etc. NO son secretos — a diferencia de una service
// account key, esta config está pensada para viajar en el bundle del
// cliente (así funciona cualquier app de Firebase, incluida la app
// Android). La seguridad real la dan firestore.rules/storage.rules, no
// ocultar estos valores.

import { initializeApp, getApps, getApp, type FirebaseOptions } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { isSupported, type Analytics } from "firebase/analytics";

const firebaseConfig: FirebaseOptions = {
  apiKey: "AIzaSyBks64A1cGss_t3hGSea_UaHc2VfD-81f0",
  authDomain: "my-studio-4530a.firebaseapp.com",
  projectId: "my-studio-4530a",
  storageBucket: "my-studio-4530a.firebasestorage.app",
  messagingSenderId: "21725830541",
  appId: "1:21725830541:web:4c7b9458ab5c44db44b1c4",
  measurementId: "G-9BB6HN4GWH",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Analytics necesita window/indexedDB — no existe durante el render en
// el servidor (SSR/SSG de Next.js). isSupported() además descarta
// entornos donde el SDK no puede funcionar igual (ej. Safari en modo
// privado). analytics queda null en el server y en esos casos; recién
// se resuelve del lado del cliente.
export let analytics: Analytics | null = null;
if (typeof window !== "undefined") {
  isSupported().then((supported) => {
    if (supported) {
      // Import diferido: evita que el módulo de analytics se evalúe
      // en absoluto durante SSR.
      import("firebase/analytics").then(({ getAnalytics }) => {
        analytics = getAnalytics(app);
      });
    }
  });
}

export default app;
