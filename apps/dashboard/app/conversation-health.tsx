"use client";
import { useEffect, useState } from "react";
export function ConversationHealth() {
  const [data, setData] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const r = await fetch("/api/conversations/health");
        if (!r.ok) throw Error();
        const v = (await r.json()) as { data: Record<string, string> };
        if (active) {
          setData(v.data);
          setError(false);
        }
      } catch {
        if (active) setError(true);
      }
    };
    void load();
    const timer = setInterval(load, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const names: Record<string, string> = {
    database: "Banco de dados",
    webhook: "Recebimento",
    meta: "Envio WhatsApp",
    ai: "Atendimento",
    scheduler: "Agendador",
  };
  return (
    <details className="conversation-settings panel">
      <summary>Estado das integrações</summary>
      {error ? (
        <p role="status">Não foi possível verificar as integrações.</p>
      ) : data ? (
        <dl>
          {Object.entries(data).map(([key, value]) => (
            <div key={key}>
              <dt>{names[key]}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>Verificando…</p>
      )}
    </details>
  );
}
