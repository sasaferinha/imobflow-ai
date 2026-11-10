/** A real loading fallback: no timer or artificial minimum duration. */
export default function PanelLoading() {
  return <section className="panel-loading" role="status" aria-label="Carregando painel" aria-busy="true">
    <span className="panel-loading-label">Preparando seu espaço de trabalho…</span>
    <div className="panel-loading-heading" aria-hidden="true" />
    <div className="panel-loading-stats" aria-hidden="true">{[0, 1, 2].map(item => <div key={item} />)}</div>
    <div className="panel-loading-body" aria-hidden="true">{[0, 1, 2, 3].map(item => <div key={item} />)}</div>
  </section>;
}
