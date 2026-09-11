"use client";
/* eslint-disable @next/next/no-img-element -- authenticated private media proxy */
import { useState } from "react";
import type { DemoMessage } from "@/lib/demo-conversations";
import { announceDashboardChange } from "@/lib/dashboard-sync";
function Photo({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return failed ? (
    <span role="status">Foto indisponível ou expirada.</span>
  ) : (
    <div>
      {!loaded && <span>Carregando foto…</span>}
      <img
        src={src}
        alt="Foto da conversa"
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
export function ConversationMessageBubble({
  message,
  demo,
}: {
  message: DemoMessage;
  demo: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function retry() {
    setBusy(true);
    try {
      const r = await fetch("/api/conversations/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: message.id }),
      });
      const v = (await r.json()) as { error?: string };
      if (!r.ok) throw Error(v.error);
      announceDashboardChange("conversations");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Não foi possível repetir.");
    } finally {
      setBusy(false);
    }
  }
  const labels = {
    pending: "Pendente",
    sent: "Enviado",
    delivered: "Entregue",
    read: "Lido",
    failed: "Falhou",
  };
  return (
    <div
      className={`bubble ${message.side}`}
      data-delivery={message.deliveryStatus}
    >
      {message.images?.length ? (
        <div className="message-property-images">
          {message.images.slice(0, 5).map((src, i) => (
            <Photo key={`${src}-${i}`} src={src} />
          ))}
        </div>
      ) : null}
      {message.propertyTitle && <strong>{message.propertyTitle}</strong>}
      <p>{message.text}</p>
      <small>
        {message.time} ·{" "}
        {demo
          ? "Demonstração"
          : message.sender ||
            (message.side === "incoming" ? "Cliente" : "Corretor")}
        {!demo && message.deliveryStatus
          ? ` · ${labels[message.deliveryStatus]}`
          : ""}
      </small>
      {message.deliveryError && <p role="status">{message.deliveryError}</p>}
      {!demo && message.nextAttemptAt && (
        <small>Nova tentativa agendada · {message.attempts}/3 tentativas</small>
      )}
      {!demo && message.canRetry && (
        <button type="button" disabled={busy} onClick={() => void retry()}>
          Tentar novamente
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
