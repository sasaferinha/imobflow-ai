"use client";
import { useState } from "react";
import { defaultBusinessHours, type BusinessHours } from "@/lib/business-hours";
export function ConversationSettings() {
  const [settings, setSettings] = useState<BusinessHours>(defaultBusinessHours);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function load() {
    if (ready) return;
    setBusy(true);
    try {
      const r = await fetch("/api/conversations/settings");
      const result = (await r.json()) as {
        data: BusinessHours;
        error?: string;
      };
      if (!r.ok) throw Error(result.error);
      setSettings(result.data);
      setReady(true);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Não foi possível carregar.");
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      const r = await fetch("/api/conversations/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...settings,
          holidays: settings.holidays.filter((d) => d.trim()),
        }),
      });
      const result = (await r.json()) as { error?: string };
      if (!r.ok) throw Error(result.error);
      setNotice("Horários salvos.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      className="conversation-settings panel"
      onToggle={(e) => {
        if (e.currentTarget.open) void load();
      }}
    >
      <summary>Horário de atendimento</summary>
      <fieldset disabled={!ready || busy}>
        <legend>Configuração da empresa</legend>
        <label>
          Abertura
          <input
            type="time"
            value={settings.opens}
            onChange={(e) =>
              setSettings({ ...settings, opens: e.target.value })
            }
          />
        </label>
        <label>
          Fechamento
          <input
            type="time"
            value={settings.closes}
            onChange={(e) =>
              setSettings({ ...settings, closes: e.target.value })
            }
          />
        </label>
        <label>
          Fuso horário
          <input
            value={settings.timeZone}
            onChange={(e) =>
              setSettings({ ...settings, timeZone: e.target.value })
            }
          />
        </label>
        <div>
          {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((day, i) => (
            <label key={day}>
              <input
                type="checkbox"
                checked={settings.weekdays.includes(i)}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    weekdays: e.target.checked
                      ? [...settings.weekdays, i]
                      : settings.weekdays.filter((d) => d !== i),
                  })
                }
              />
              {day}
            </label>
          ))}
        </div>
        <label>
          Datas sem atendimento (AAAA-MM-DD, uma por linha)
          <textarea
            value={settings.holidays.join("\n")}
            onChange={(e) =>
              setSettings({ ...settings, holidays: e.target.value.split("\n") })
            }
          />
        </label>
        <label>
          Mensagem de ausência
          <textarea
            maxLength={1000}
            value={settings.awayMessage}
            onChange={(e) =>
              setSettings({ ...settings, awayMessage: e.target.value })
            }
          />
        </label>
        <button type="button" onClick={() => void save()}>
          Salvar horários
        </button>
      </fieldset>
      <p role="status">{busy ? "Carregando…" : notice}</p>
    </details>
  );
}
