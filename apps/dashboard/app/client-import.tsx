'use client';
import { useRef, useState } from 'react';
import { dashboardFetch as fetch } from '@/lib/dashboard-transport';
import { announceDashboardChange } from '@/lib/dashboard-sync';
import { hasCommercialQualification, type LeadInput, type LeadProfile } from '@/lib/leads';
import { IMPORT_BYTES, leadImportTemplate, parseLeadImport } from '@/lib/lead-import';
import styles from './client-import.module.css';

export default function ClientImport({ onImported, onOpportunities, publicDemo=false }: { onImported:(leads:LeadProfile[])=>void; onOpportunities:()=>void; publicDemo?:boolean }) {
  const fileInput=useRef<HTMLInputElement>(null), busy=useRef(false), selection=useRef(0);
  const [rows,setRows]=useState<LeadInput[]>([]), [name,setName]=useState(''), [error,setError]=useState(''), [pending,setPending]=useState(false);
  const [result,setResult]=useState<{imported:number;skipped:number}|null>(null);
  const [page,setPage]=useState(0);
  async function choose(file?:File) {
    if(!file)return;
    const version=++selection.current;
    setRows([]);setName('');setError('');setResult(null);setPage(0);
    try {
      if(!file.name.toLowerCase().endsWith('.csv')||file.size>IMPORT_BYTES)throw Error('Selecione um CSV de até 2 MB. No Excel, use Salvar como CSV UTF-8.');
      const parsed=parseLeadImport(await file.text());
      if(version!==selection.current)return;
      setRows(parsed);setName(file.name);
    } catch(e){if(version===selection.current)setError(e instanceof Error?e.message:'Não foi possível ler o arquivo.');}
  }
  function template() {
    const url=URL.createObjectURL(new Blob([leadImportTemplate],{type:'text/csv;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='modelo-clientes-imobflow.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function submit() {
    if(busy.current||!rows.length)return;
    if(publicDemo){setError('A importação está disponível na conta de administrador da sua imobiliária.');return;}
    busy.current=true;setPending(true);setError('');
    try {
      const response=await fetch('/api/leads/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({leads:rows})});
      const body=await response.json() as {error?:string;data?:{imported:number;skipped:number;leads:LeadProfile[]}};
      if(!response.ok||!body.data)throw Error(body.error||'Não foi possível importar. Tente novamente.');
      setResult(body.data);setRows([]);onImported(body.data.leads);announceDashboardChange('leads');announceDashboardChange('opportunities');
    }catch(e){setError(e instanceof Error?e.message:'Não foi possível importar.');}
    finally{busy.current=false;setPending(false);}
  }
  const incomplete=rows.filter(row=>!hasCommercialQualification(row)).length;
  return <section className={styles.root} aria-label="Importar clientes antigos" aria-busy={pending}>
    <div className={styles.intro}><h2>Sua carteira também pode gerar oportunidades</h2><p>Traga clientes antigos por planilha. Objetivo, tipo de imóvel, bairro e orçamento ajudam a encontrar imóveis compatíveis.</p></div>
    <div className={styles.actions}><button type="button" onClick={template}>Baixar modelo CSV</button><button type="button" className="primary-button" disabled={pending} onClick={()=>fileInput.current?.click()}>{name?'Trocar arquivo':'Selecionar planilha'}</button><input ref={fileInput} type="file" hidden accept=".csv,text/csv" disabled={pending} onChange={e=>{void choose(e.target.files?.[0]);e.target.value='';}} /></div>
    <p className={styles.hint}>Até 500 clientes por arquivo, em CSV UTF-8. Nome e telefone ou e-mail são obrigatórios. Telefones brasileiros devem incluir DDD.</p>
    <details className={styles.help}><summary>Como preencher a planilha</summary><p>Objetivo: Comprar, Alugar ou Investir. Tipo: Casa, Apartamento, Terreno, Comercial, Galpão ou Outro. Região: bairro desejado. Orçamento: valor máximo em reais, por exemplo 500000 ou Até R$ 500 mil.</p><p>Último contato, status, corretor e observações são opcionais. Use o nome de um corretor ativo da sua empresa. Para último contato, use dia/mês/ano. Dados incompletos podem ser complementados em Leads.</p><p>A importação salva cadastros. Ela não lê o histórico do WhatsApp, não usa IA e não envia mensagens aos clientes.</p></details>
    {error&&<p className={styles.error} role="alert">{error}</p>}
    {result&&<div className={styles.result} role="status"><h3>Importação concluída</h3><p>{result.imported} clientes adicionados. {result.skipped} duplicados ignorados. Cadastros existentes foram preservados.</p><button type="button" onClick={onOpportunities}>Ver oportunidades</button></div>}
    {rows.length>0&&<><div className={styles.previewHead}><h3>Confira antes de importar</h3><span>{name} · {rows.length} clientes</span></div>{incomplete>0&&<p className={styles.hint}>{incomplete} cadastros com preferências incompletas. Complete esses dados em Leads para buscar oportunidades.</p>}<div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Prévia dos clientes"><table><thead><tr><th>Cliente / contato</th><th>Objetivo / imóvel</th><th>Bairro / orçamento</th><th>Corretor</th></tr></thead><tbody>{rows.slice(page*20,page*20+20).map((r,i)=><tr key={page*20+i}><td>{r.name}<small>{r.phone||r.email}</small></td><td>{r.goal}<small>{r.propertyType}</small></td><td>{r.region}<small>{r.budget}</small></td><td>{r.assignedTo||'Sem responsável'}</td></tr>)}</tbody></table></div><div className={styles.actions}><button type="button" disabled={page===0||pending} onClick={()=>setPage(p=>p-1)}>Anterior</button><span>Página {page+1} de {Math.ceil(rows.length/20)}</span><button type="button" disabled={(page+1)*20>=rows.length||pending} onClick={()=>setPage(p=>p+1)}>Próxima</button></div><div className={styles.confirm}><p>Duplicados por telefone ou e-mail serão ignorados dentro da sua empresa.</p><button type="button" className="primary-button" disabled={pending} onClick={()=>void submit()}>{pending?'Importando…':`Confirmar importação de ${rows.length} clientes`}</button></div></>}
  </section>;
}
