"use client";

// AuthProvider — mismo rol que AuthService (ChangeNotifier) del lado de
// Flutter: escucha el estado de sesión de Firebase Auth en tiempo real
// y lo expone al resto del árbol de componentes vía Context, para que
// cualquier pantalla sepa si el visitante es invitado o usuario
// logueado sin tener que suscribirse a Firebase por su cuenta.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { ensureUserProfile, watchUserProfile, type UserProfile } from "@/lib/UserProfileService";

interface AuthContextValue {
  user: User | null;
  // true mientras todavía no llegó la primera respuesta de
  // onAuthStateChanged — evita un parpadeo mostrando "invitado" un
  // instante antes de confirmar que en realidad hay sesión guardada.
  loading: boolean;
  // Perfil de Firestore (/users/{uid}) — nickname, no confundir con
  // `user` (Firebase Auth). null mientras carga o si el nickname
  // todavía no se eligió (ver UserProfileService.ts).
  profile: UserProfile | null;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  profile: null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) {
      // Wrapped en microtask (mismo criterio ya usado en otras
      // pantallas de este proyecto) para que el linter de React no lo
      // trate como un setState síncrono dentro del cuerpo del efecto.
      queueMicrotask(() => setProfile(null));
      return;
    }
    // Fire-and-forget: no bloquea el resto de la app esperando a que
    // termine de crear el doc — watchUserProfile ya lo refleja apenas
    // exista, sin importar el orden exacto en que resuelvan las dos.
    void ensureUserProfile(user.uid, user.email);
    return watchUserProfile(user.uid, setProfile);
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, loading, profile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
