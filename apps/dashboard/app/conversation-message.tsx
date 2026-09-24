"use client";
import { dashboardFetch as fetch } from '@/lib/dashboard-transport';
/* eslint-disable @next/next/no-img-element -- authenticated private media proxy */
import { useState } from "react";
import type { DemoMessage } from "@/lib/demo-conversations";
import { announceDashboardChange } from "@/lib/dashboard-sync";
function AudioMessage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  return <div style={{ width: 300, maxWidth: '100%', marginBottom: 8 }}>
    <audio controls preload="none" aria-label="Ouvir áudio da conversa" src={src}
      style={{ width: '100%', maxWidth: '100%' }} onError={() => setFailed(true)} />
    {failed && <p role="status">Não foi possível reproduzir. O áudio pode ter expirado ou o formato não ser compatível com este navegador.</p>}
    <a href={src} download>Baixar áudio</a>
  </div>;
}
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
  onHide,
}: {
  message: DemoMessage;
  demo: boolean;
  onHide?: (messageId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState(false);
  async function hide() {
    if (!onHide || busy) return;
    setBusy(true); setNotice('');
    try { await onHide(message.id); setConfirming(false); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível remover a mensagem.'); }
    finally { setBusy(false); }
  }
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
      className={`bubble ${message.side}${message.hidden ? ' message-hidden' : ''}`}
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
      {message.audios?.map((src) => <AudioMessage key={src} src={src} />)}
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
      {!message.hidden && message.canHide && onHide && <div className="message-visibility-actions">
        {confirming ? <div role="group" aria-label="Confirmar remoção da mensagem">
          <p>{demo ? 'Remover da demonstração compartilhada da equipe?' : 'Remover do painel de toda a equipe? Isso não apaga a mensagem no WhatsApp nem cancela respostas automáticas. Os registros técnicos são preservados.'}</p>
          <button type="button" disabled={busy} onClick={() => void hide()}>{busy ? 'Removendo…' : 'Confirmar remoção'}</button>
          <button type="button" disabled={busy} onClick={() => setConfirming(false)}>Cancelar</button>
        </div> : <button type="button" aria-label="Remover mensagem do painel" onClick={() => setConfirming(true)}>Remover do painel</button>}
      </div>}
    </div>
  );
}
