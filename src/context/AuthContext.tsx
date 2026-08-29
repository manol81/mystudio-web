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

interface AuthContextValue {
  user: User | null;
  // true mientras todavía no llegó la primera respuesta de
  // onAuthStateChanged — evita un parpadeo mostrando "invitado" un
  // instante antes de confirmar que en realidad hay sesión guardada.
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
