import type { LeadInput, LeadLifecycleStatus } from './leads';
import { budgetCeiling } from './property-matching';

const normalize = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const IMPORT_LIMIT = 500;
export const IMPORT_BYTES = 2_000_000;
export const leadImportTemplate = '\uFEFFNome;Telefone;Email;Objetivo;Tipo de imóvel;Região;Orçamento;Último contato;Status;Corretor;Observações\r\n';
const aliases: Record<string, string[]> = {
  name: ['nome','name','cliente'], phone: ['telefone','phone','celular','whatsapp'], email: ['email'],
  goal: ['objetivo','interesse','goal'], propertyType: ['tipo','tipoimovel','tipodeimovel','propertytype'],
  region: ['regiao','bairro','region'], budget: ['orcamento','investimento','budget','valor'],
  details: ['observacoes','detalhes','details'], assignedTo: ['corretor','responsavel','assignedto'],
  lifecycleStatus: ['status','etapa','lifecyclestatus'], lastContactAt: ['ultimocontato','dataultimocontato','lastcontactat'],
};
const statuses: LeadLifecycleStatus[] = ['Novo','Em atendimento','Visita','Proposta','Convertido','Perdido'];
export function importPhone(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
}
export function validateImportLead(raw: unknown): LeadInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Cadastro inválido.');
  const row = raw as Record<string, unknown>;
  const read = (key: string, max = 160) => {
    const v = row[key];
    if (v != null && typeof v !== 'string') throw Error(`Campo ${key} inválido.`);
    const text = typeof v === 'string' ? v.trim() : '';
    if (text.length > max) throw Error(`Campo ${key} muito longo (máximo ${max} caracteres).`);
    return text;
  };
  const name = read('name',120), phoneText = read('phone',30), phone = importPhone(phoneText), email = read('email').toLowerCase();
  if (!name || (!phone && !email)) throw Error('Informe nome e telefone ou e-mail.');
  if (phoneText && (!/^[+\d\s().-]+$/.test(phoneText) || !/^\d{10,15}$/.test(phone))) throw Error('Telefone inválido. Inclua DDD.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Error('E-mail inválido.');
  const goalText = read('goal',50), typeText = read('propertyType',50);
  const goal = ({comprar:'Comprar',compra:'Comprar',venda:'Comprar',alugar:'Alugar',aluguel:'Alugar',investir:'Investir',investimento:'Investir'} as Record<string,string>)[normalize(goalText)];
  const propertyType = ({casa:'Casa',apartamento:'Apartamento',apto:'Apartamento',terreno:'Terreno',comercial:'Comercial',galpao:'Galpão',outro:'Outro'} as Record<string,string>)[normalize(typeText)];
  if (goalText && normalize(goalText)!=='naoinformado' && !goal) throw Error('Objetivo: use Comprar, Alugar ou Investir.');
  if (typeText && normalize(typeText)!=='naoinformado' && !propertyType) throw Error('Tipo: use Casa, Apartamento, Terreno, Comercial, Galpão ou Outro.');
  const rawDate = read('lastContactAt',40), br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(rawDate);
  const dateText = br ? `${br[3]}-${br[2]}-${br[1]}` : rawDate;
  const date = dateText ? new Date(dateText) : null;
  if (date && (Number.isNaN(date.getTime()) || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(dateText) || date.toISOString().slice(0,10)!==dateText.slice(0,10))) throw Error('Último contato: use uma data válida, como 15/07/2026.');
  const rawStatus = read('lifecycleStatus',30), status = statuses.find(s=>normalize(s)===normalize(rawStatus));
  if (rawStatus && !status) throw Error('Status inválido. Use Novo, Em atendimento, Visita, Proposta, Convertido ou Perdido.');
  const rawBudget = read('budget',100);
  const ceiling = budgetCeiling(rawBudget);
  if(rawBudget && normalize(rawBudget)!=='naoinformado' && !ceiling)throw Error('Orçamento inválido. Use o valor máximo em reais, como 500000 ou Até R$ 500 mil.');
  const budget = ceiling ? `Até R$ ${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(ceiling)}` : 'Não informado';
  return { name, phone, email:email||null, goal:goal||'Não informado', propertyType:propertyType||'Não informado', region:read('region')||'Não informado', budget, details:read('details',1000)||null, assignedTo:read('assignedTo',120)||null, lifecycleStatus:status||'Novo', lastContactAt:date?.toISOString()||null, source:'Importação CSV' };
}
export function parseLeadImport(text: string): LeadInput[] {
  const source = text.replace(/^\uFEFF/,'');
  const first = source.split(/\r?\n/)[0];
  const sep = (first.match(/;/g)||[]).length >= (first.match(/,/g)||[]).length ? ';' : ',';
  const rows: string[][] = []; let row: string[] = [], value='', quoted=false;
  for(let i=0;i<source.length;i++) {
    const c=source[i];
    if(c==='"') { if(quoted && source[i+1]==='"'){value+='"';i++;} else quoted=!quoted; }
    else if(c===sep && !quoted){row.push(value.trim());value='';}
    else if((c==='\n'||c==='\r') && !quoted){row.push(value.trim());if(row.some(Boolean))rows.push(row);row=[];value='';if(c==='\r'&&source[i+1]==='\n')i++;}
    else value+=c;
  }
  if(quoted)throw Error('Aspas não fechadas no arquivo CSV.');
  row.push(value.trim());if(row.some(Boolean))rows.push(row);
  if(rows.length<2)throw Error('Preencha o modelo com pelo menos um cliente.');
  if(rows.length-1>IMPORT_LIMIT)throw Error(`Divida a planilha em arquivos de até ${IMPORT_LIMIT} clientes.`);
  const headers=rows.shift()!.map(normalize);
  const indexes=Object.fromEntries(Object.entries(aliases).map(([key,names])=>[key,headers.findIndex(h=>names.includes(h))]));
  if(indexes.name<0 || (indexes.phone<0&&indexes.email<0))throw Error('Inclua as colunas Nome e Telefone ou E-mail.');
  return rows.map((cells,i)=>{
    if(cells.length!==headers.length)throw Error(`Registro ${i+1}: quantidade de colunas diferente do cabeçalho.`);
    try{return validateImportLead(Object.fromEntries(Object.entries(indexes).map(([key,index])=>[key,index<0?'':cells[index]])));}
    catch(error){throw Error(`Registro ${i+1}: ${error instanceof Error?error.message:'Dados inválidos.'}`);}
  });
}
