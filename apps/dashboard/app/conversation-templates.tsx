"use client";
import { useState } from "react";
import { announceDashboardChange } from "@/lib/dashboard-sync";
type Template = {
  name: string;
  language: string;
  purpose: string;
  parameters: string[];
  approved: boolean;
};
export function ConversationTemplates({ leadId }: { leadId: string }) {
  const [items, setItems] = useState<Template[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [requestKeys] = useState(() => new Map<string, string>());
  async function load() {
    if (ready) return;
    setBusy(true);
    try {
      const r = await fetch("/api/conversations/templates");
      const v = (await r.json()) as { data: Template[]; error?: string };
      if (!r.ok) throw Error(v.error);
      setItems(v.data);
      setReady(true);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Falha ao carregar.");
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      const r = await fetch("/api/conversations/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(items),
      });
      const v = (await r.json()) as { error?: string };
      if (!r.ok) throw Error(v.error);
      setNotice("Modelos salvos. A aprovação é feita na Meta.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }
  async function send(t: Template) {
    setBusy(true);
    const fingerprint = leadId + JSON.stringify(t);
    const requestId = requestKeys.get(fingerprint) || crypto.randomUUID();
    requestKeys.set(fingerprint, requestId);
    try {
      const r = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          requestId,
          templateName: t.name,
          content: `Modelo: ${t.name} (${t.language}) · ${t.purpose}`,
        }),
      });
      const v = (await r.json()) as { error?: string };
      if (!r.ok) throw Error(v.error);
      requestKeys.delete(fingerprint);
      announceDashboardChange("conversations");
      setNotice("Solicitação registrada. Confira o status na conversa.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Falha ao enviar.");
    } finally {
      setBusy(false);
    }
  }
  const update = (i: number, patch: Partial<Template>) =>
    setItems(items.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  return (
    <details
      className="conversation-settings panel"
      onToggle={(e) => {
        if (e.currentTarget.open) void load();
      }}
    >
      <summary>Modelos de mensagem</summary>
      <p>
        Fora de 24 horas, use um modelo aprovado. Aguardando configuração da
        Meta até que um modelo seja cadastrado e aprovado.
      </p>
      <fieldset disabled={!ready || busy}>
        {items.map((t, i) => (
          <fieldset key={i}>
            <legend>Modelo {i + 1}</legend>
            <label>
              Nome exato na Meta
              <input
                value={t.name}
                onChange={(e) => update(i, { name: e.target.value })}
              />
            </label>
            <label>
              Idioma
              <input
                value={t.language}
                onChange={(e) => update(i, { language: e.target.value })}
              />
            </label>
            <label>
              Finalidade
              <input
                value={t.purpose}
                onChange={(e) => update(i, { purpose: e.target.value })}
              />
            </label>
            <label>
              Parâmetros de texto, um por linha
              <textarea
                value={t.parameters.join("\n")}
                onChange={(e) =>
                  update(i, {
                    parameters: e.target.value
                      ? e.target.value.split("\n")
                      : [],
                  })
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={t.approved}
                onChange={(e) => update(i, { approved: e.target.checked })}
              />
              Já foi aprovado na Meta
            </label>
            <button
              type="button"
              onClick={() => setItems(items.filter((_, j) => i !== j))}
            >
              Remover
            </button>
            <button
              type="button"
              disabled={!t.approved}
              onClick={() => void send(t)}
            >
              Enviar modelo salvo
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          disabled={items.length >= 20}
          onClick={() =>
            setItems([
              ...items,
              {
                name: "",
                language: "pt_BR",
                purpose: "",
                parameters: [],
                approved: false,
              },
            ])
          }
        >
          Adicionar modelo
        </button>
        <button type="button" onClick={() => void save()}>
          Salvar modelos
        </button>
      </fieldset>
      <p role="status">{busy ? "Processando…" : notice}</p>
    </details>
  );
}
