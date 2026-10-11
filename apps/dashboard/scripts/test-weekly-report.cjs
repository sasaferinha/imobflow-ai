const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript');
const mod={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/evolution/weekly-report.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports,Date,Set});
const {previousReportWeek,weeklyReport}=mod.exports;
assert.equal(previousReportWeek(new Date('2026-10-12T02:00:00Z')).key,'2026-09-28','Sunday night in São Paulo');
assert.equal(previousReportWeek(new Date('2026-10-12T03:00:00Z')).key,'2026-10-05');
const result=weeklyReport({records:[{id:'1',kind:'leads',createdAt:'2026-10-05T03:00:00Z',data:{}},{id:'2',kind:'leads',createdAt:'2026-10-12T03:00:00Z',data:{}},{id:'3',kind:'cases',createdAt:'2026-10-05T02:00:00Z',data:{status:'Aberto'}}],events:[]},new Date('2026-10-12T12:00:00Z'));
assert.match(result.text,/Novos leads: 1/);assert.match(result.text,/Novos atendimentos: 0/);assert.match(result.text,/1 atendimentos abertos/);assert.match(result.text,/sem reconstruir histórico ausente/);
const offsets=weeklyReport({records:[{kind:'leads',createdAt:'2026-10-05T00:00:00-03:00',data:{}},{kind:'leads',createdAt:'2026-10-12T03:00:00+00:00',data:{}},{kind:'leads',createdAt:'invalid',data:{}},{kind:'followups',createdAt:'2026-10-05T10:00:00Z',data:{status:'Respondida',dueAt:'2026-10-08T10:00:00Z'}},{kind:'followups',createdAt:'2026-10-05T10:00:00Z',data:{status:'Pendente',dueAt:'2026-10-08T10:00:00Z'}}],events:[]},new Date('2026-10-12T12:00:00Z'));
assert.match(offsets.text,/Novos leads: 1/,'equivalent offset dates respect inclusive start and exclusive end');
assert.match(offsets.text,/1 cobranças vencidas/,'answered followups await manager review, not a broker response');
const caseRecord = (id, status='Ganho') => ({id,kind:'cases',createdAt:'2026-09-01T12:00:00Z',data:{status}});
const transition = (id, recordId, at, from, to) => ({id,recordId,at,changes:{status:{from,to}}});
const correction = (id, recordId, mode, requestId=id) => ({id,recordId,at:'2026-10-09T12:00:00Z',registration:{action:'correct_close',requestId,fingerprint:JSON.stringify({caseId:recordId,data:{mode}})}});
const outcomes = weeklyReport({records:[
  caseRecord('confirmed'),caseRecord('undone','Aberto'),caseRecord('confirmed-again'),
  caseRecord('confirmed-next-week'),caseRecord('imported-without-history'),
  {id:'unrelated',kind:'tasks',createdAt:'2026-09-01T12:00:00Z',data:{status:'Ganho'}},
],events:[
  transition('won-1','confirmed','2026-10-05T00:00:00-03:00','Aberto','Ganho'),
  transition('won-2','undone','2026-10-06T12:00:00Z','Aberto','Ganho'),
  transition('undo-2','undone','2026-10-07T12:00:00Z','Ganho','Aberto'),
  correction('undo-registration','undone','reopen'),
  transition('won-3','confirmed-again','2026-10-06T12:00:00Z','Aberto','Ganho'),
  transition('undo-3','confirmed-again','2026-10-07T12:00:00Z','Ganho','Aberto'),
  transition('won-3-again','confirmed-again','2026-10-08T12:00:00Z','Aberto','Ganho'),
  transition('won-4-again','confirmed-next-week','2026-10-12T03:00:00Z','Aberto','Ganho'),
  transition('won-4','confirmed-next-week','2026-10-06T12:00:00Z','Aberto','Ganho'),
  transition('undo-4','confirmed-next-week','2026-10-07T12:00:00Z','Ganho','Aberto'),
  transition('wrong-kind','unrelated','2026-10-07T12:00:00Z','Aberto','Ganho'),
  transition('missing-case','missing','2026-10-07T12:00:00Z','Aberto','Ganho'),
  correction('edit-1','confirmed','edit'),correction('replayed-edit-1','confirmed','edit','edit-1'),
  correction('edit-2','confirmed','edit'),correction('unknown','missing','edit'),
  {id:'bad-json',recordId:'confirmed',at:'2026-10-09T12:00:00Z',registration:{action:'correct_close',requestId:'bad-json',fingerprint:'invalid'}},
  {id:'wrong-case',recordId:'confirmed',at:'2026-10-09T12:00:00Z',registration:{action:'correct_close',requestId:'wrong-case',fingerprint:JSON.stringify({caseId:'missing',data:{mode:'edit'}})}},
]},new Date('2026-10-12T12:00:00Z'));
assert.match(outcomes.text,/Fechamentos registrados na semana e ainda confirmados: 2\./,'undo excludes a win; same-week reclosure counts once; a later reclosure belongs to its latest week even when events are not sorted');
assert.match(outcomes.text,/Correções de dados de fechamento na semana: 2\./,'count recorded edit actions once per request, without accepting malformed or unrelated historical evidence');
assert.match(outcomes.text,/Fechamentos desfeitos na semana: 3\./,'count case status reversals without double-counting their registration event');
assert.match(outcomes.text,/permanecem ganhos na geração deste resumo/,'the report explains it is evaluated against current confirmed outcomes');
assert.equal(outcomes.key,'2026-10-05');assert.equal(outcomes.title,'Resumo semanal · 2026-10-05','scheduler key/title remain stable');
const laterUndo=weeklyReport({records:[caseRecord('later','Aberto')],events:[transition('close','later','2026-10-06T12:00:00Z','Aberto','Ganho'),transition('reopen','later','2026-10-12T04:00:00Z','Ganho','Aberto')]},new Date('2026-10-12T12:00:00Z'));
assert.match(laterUndo.text,/ainda confirmados: 0\./,'a closure already reversed when the report is generated is not a current gain');
assert.match(laterUndo.text,/Fechamentos desfeitos na semana: 0\./,'reopening actions use the report period, independent of the current outcome');
console.log('Weekly report: São Paulo week boundaries, current confirmed outcomes, correction/reopening actions, and no fabricated history passed.');
