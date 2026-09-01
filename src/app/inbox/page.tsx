"use client";

// Bandeja de Entrada — placeholder. El link del Sidebar tiene que
// llevar a algún lado; la mensajería real (DMs, notificaciones) es
// parte de una fase futura de la plataforma de comunidad, no de esta
// etapa (reestructuración del layout + feed simulado).

import { MessageSquare } from "lucide-react";

export default function InboxPage() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/5 text-white/30">
        <MessageSquare size={26} />
      </div>
      <h1 className="font-display text-2xl font-bold text-white">
        Bandeja de <span className="text-neon-cyan">Entrada</span>
      </h1>
      <p className="max-w-sm text-sm text-white/50">
        Los mensajes directos y notificaciones de la comunidad llegan en una próxima etapa.
      </p>
    </div>
  );
}
