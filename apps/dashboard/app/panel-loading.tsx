/** A real loading fallback: no timer or artificial minimum duration. */
export default function PanelLoading() {
  return <section className="panel-loading" role="status" aria-label="Carregando painel" aria-busy="true">
    <div className="panel-loading-card">
      <span className="panel-loading-spinner" aria-hidden="true" />
      <span className="panel-loading-label">Montando…</span>
    </div>
  </section>;
}
