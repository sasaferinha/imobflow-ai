const assert = require('node:assert/strict');
const {createDatabase, seedCompanies, migration, id} = require('./helpers/tenant-test-database.cjs');

(async () => {
  const db = await createDatabase();
  try {
    await db.exec(migration('20260912221000_message_recovery.sql'));
    await db.exec(migration('20260914120000_inbound_recovery.sql'));
    await db.exec(migration('20260929050000_attendance_turns.sql'));
    await seedCompanies(db);
    await db.query("UPDATE conversations SET assigned_to=NULL,bot_paused=false,external_conversation_id='whatsapp:5535999990001',phone_number_id='12345'");
    await db.query("UPDATE inbound_reply_jobs SET state='done'");
    let serial=0;
    const company=id(1), conversation=id(501), lead=id(101);
    const one=async(sql,params=[]) => (await db.query(sql,params)).rows[0];
    const add=async(content,companyId=company,conversationId=conversation,age='0 seconds') => {
      const external='turn-fixture-'+(++serial);
      await db.query("INSERT INTO messages(company_id,conversation_id,direction,sender_type,content,external_message_id,created_at) VALUES($1,$2,'incoming','client',$3,$4,now()-$5::interval)",[companyId,conversationId,content,external,age]);
      return external;
    };
    const quiet=()=>db.query("UPDATE inbound_reply_jobs SET received_at=clock_timestamp()-interval '4 seconds'");
    const claim=async(companyId=company,conversationId=conversation)=>(await one('SELECT claim_attendance_turn($1,$2) result',[companyId,conversationId])).result;
    const release=turn=>db.query('SELECT release_attendance_turn($1,$2,$3)',[company,conversation,turn.token]);
    const enqueue=async(turn,content='Resposta organizada.\n\nQual bairro você prefere?',patch={},version=null)=>(await one('SELECT enqueue_attendance_turn($1,$2,$3,$4,$5,$6,$7,false) result',[company,conversation,turn.token,turn.watermark,content,JSON.stringify(patch),version])).result;
    const jobs=async()=> (await db.query('SELECT state,arrival_sequence FROM inbound_reply_jobs WHERE company_id=$1 ORDER BY arrival_sequence',[company])).rows;
    const leadVersion=async()=>(await one('SELECT updated_at FROM leads WHERE id=$1',[lead])).updated_at;

    // Different webhook events in one burst make one durable turn, preserving
    // separate short answers even when Meta gives identical/older timestamps.
    const first=await add('Comprar'),second=await add('Casa'),third=await add('Lavras',company,conversation,'2 seconds');
    assert.equal((await claim()).status,'deferred','wait for a quiet period');
    await quiet();
    const [a,b]=await Promise.all([claim(),claim()]);
    assert.equal(a.status,'claimed'); assert.equal(b.status,'deferred','only one worker owns the conversation');
    assert.deepEqual(a.messages.map(m=>m.externalMessageId),[first,second,third]);
    assert.deepEqual(a.messages.map(m=>m.message),['Comprar','Casa','Lavras']);
    assert.equal(a.overflow,false);
    assert.equal(a.lastReply,null,'no outgoing message must not count as a seen summary');
    const version=await leadVersion();
    const result=await enqueue(a,undefined,{purpose:'Venda',propertyType:'Casa',city:'Lavras'},version);
    assert.equal(result.status,'queued');
    assert.deepEqual((await one('SELECT interest_profile FROM leads WHERE id=$1',[lead])).interest_profile,
      {city:'Lavras',parkingSpaces:2,purpose:'Venda',propertyType:'Casa'});
    assert.equal((await enqueue(a)).messageId,result.messageId,'enqueue retry cannot create another outgoing message');
    await db.query("UPDATE message_outbox SET state='sent',provider_attempted_at=now() WHERE id=$1",[result.messageId]);
    await db.query("UPDATE messages SET delivery_status='sent' WHERE id=$1",[result.messageId]);
    assert.equal((await claim()).status,'ignored','consumed burst is not replayed');
    assert.equal((await one('SELECT claim_attendance_reply($1,$2,$3,$4) ok',[company,conversation,first,'reply:'+first])).ok,false,'late legacy callback cannot reply after the new turn');
    assert.equal((await one('SELECT claim_attendance_reply($1,$2,$3,$4) ok',[company,conversation,first,'handoff:'+first])).ok,false,'legacy handoff key is also fenced');
    assert.ok((await jobs()).every(j=>j.state==='done'));
    console.log('PASS attendance turns: durable per-conversation lease, quiet period, ordered burst, one enqueue and atomic profile');

    await add('Centro'); await quiet(); const stale=await claim();
    assert.equal(stale.lastReply,'Resposta organizada.\n\nQual bairro você prefere?','claim includes the latest confirmed outgoing content');
    await add('Na verdade, Vila Nova');
    const countBefore=(await one("SELECT count(*)::int n FROM message_outbox")).n;
    assert.equal((await enqueue(stale,'Stale',{regions:['Centro']},await leadVersion())).status,'superseded');
    assert.equal((await one("SELECT count(*)::int n FROM message_outbox")).n,countBefore);
    assert.equal((await one('SELECT interest_profile FROM leads WHERE id=$1',[lead])).interest_profile.regions,undefined,'obsolete extraction does not mutate the profile');
    await quiet(); const replacement=await claim();
    assert.deepEqual(replacement.messages.map(m=>m.message),['Centro','Na verdade, Vila Nova'],'superseded turn loses no client input');
    await release(stale);
    assert.equal((await claim()).status,'deferred','old worker cannot release successor');
    await release(replacement);

    const cas=await claim();
    assert.equal((await enqueue(cas,'CAS conflict',{regions:['Centro']},'2000-01-01T00:00:00Z')).status,'superseded');
    const emptyCas=await claim();
    assert.equal((await enqueue(emptyCas,'Read-only stale reply',{},'2000-01-01T00:00:00Z')).status,'superseded','unchanged profile still validates the snapshot used to compose a reply');
    assert.equal((await one("SELECT count(*)::int n FROM message_outbox")).n,countBefore,'profile CAS conflict cannot spam an acknowledgement');
    const current=await claim();
    const recentDuplicate=await enqueue(current,'  RESPOSTA ORGANIZADA.   Qual bairro você prefere? ',{regions:['Vila Nova']},await leadVersion());
    assert.equal(recentDuplicate.status,'suppressed','recent identical message is suppressed despite cosmetic whitespace/case');
    assert.deepEqual((await one('SELECT interest_profile FROM leads WHERE id=$1',[lead])).interest_profile.regions,['Vila Nova'],'suppression still commits valid preference changes');
    assert.equal((await claim()).status,'ignored');

    // New input after the atomic enqueue must invalidate a not-yet-started POST,
    // but already-applied preferences/consumed inputs must not be interpreted twice.
    await add('500 mil'); await quiet(); const toSend=await claim();
    const queued=await enqueue(toSend,'Entendido. Você pretende financiar?',{budgetMax:500000},await leadVersion());
    assert.equal((await one('SELECT claim_outbox_message_v2($1,$2) ok',[company,queued.messageId])).ok,true);
    await add('Sim');
    assert.equal((await one('SELECT mark_outbox_provider_attempt($1,$2,1) ok',[company,queued.messageId])).ok,false);
    assert.equal((await one('SELECT state FROM message_outbox WHERE id=$1',[queued.messageId])).state,'cancelled');
    assert.equal((await one('SELECT delivery_error_code FROM messages WHERE id=$1',[queued.messageId])).delivery_error_code,-29001);
    await quiet(); const next=await claim(); assert.deepEqual(next.messages.map(m=>m.message),['Sim']);
    assert.equal((await one('SELECT interest_profile FROM leads WHERE id=$1',[lead])).interest_profile.budgetMax,500000);
    const nextQueued=await enqueue(next,'Posso registrar o financiamento?');
    await db.query('SELECT claim_outbox_message_v2($1,$2)',[company,nextQueued.messageId]);
    assert.equal((await one('SELECT mark_outbox_provider_attempt($1,$2,1) ok',[company,nextQueued.messageId])).ok,true);
    assert.equal((await one('SELECT mark_outbox_provider_attempt($1,$2,1) ok',[company,nextQueued.messageId])).ok,false,'same provider attempt marked once');
    await add('Quanto é a entrada?'); await quiet();
    assert.equal((await claim()).status,'deferred','new worker waits for already-started provider attempt');
    await db.query("UPDATE message_outbox SET state='uncertain' WHERE id=$1",[nextQueued.messageId]);
    const uncertainNext=await claim(); assert.deepEqual(uncertainNext.messages.map(m=>m.message),['Quanto é a entrada?'],'ambiguous send is never replayed as inbound');
    await release(uncertainNext);
    console.log('PASS supersession/CAS without profile corruption, identical-content guard, provider-time fencing and ambiguous delivery safety');

    // Human takeover and tenant boundaries are rechecked, not trusted from the
    // original webhook, even when they happen while extraction is in flight.
    const takeover=await claim();
    await db.query('UPDATE conversations SET bot_paused=true WHERE id=$1',[conversation]);
    assert.equal((await enqueue(takeover,'Do not send')).status,'cancelled');
    assert.equal((await claim()).status,'ignored');
    await db.query('UPDATE conversations SET bot_paused=false WHERE id=$1',[conversation]);
    assert.equal((await claim(id(2),conversation)).status,'ignored');
    await add('Outro teste'); await quiet(); const expiry=await claim();
    await db.query("UPDATE attendance_turns SET lease_until=clock_timestamp()-interval '1 second' WHERE company_id=$1",[company]);
    const successor=await claim(); assert.equal(successor.status,'claimed'); assert.notEqual(successor.token,expiry.token);
    assert.equal((await enqueue(expiry,'Expired')).status,'superseded');
    const humanVersion=await leadVersion();
    await db.query("INSERT INTO messages(company_id,conversation_id,direction,sender_type,content,created_at) VALUES($1,$2,'outgoing','human','Atendimento humano',clock_timestamp())",[company,conversation]);
    assert.equal((await enqueue(successor,'No overlap',{city:'Outra cidade'},humanVersion)).status,'cancelled');
    await db.query("UPDATE inbound_reply_jobs SET state='cancelled' WHERE company_id=$1 AND state='pending'",[company]);
    console.log('PASS takeover, expired token fencing and tenant checks');

    // Existing recovery entry point returns one representative, retaining the
    // complete pending burst for the turn worker rather than dropping fragments.
    const recoveredCompany=id(2),recoveredConversation=id(601);
    await add('Comprar',recoveredCompany,recoveredConversation); await add('Casa',recoveredCompany,recoveredConversation);
    await quiet(); await db.query("UPDATE inbound_reply_jobs SET next_attempt_at=now()-interval '1 minute' WHERE state='pending'");
    const recovered=(await one('SELECT claim_missing_inbound_reply() job')).job;
    assert.equal(recovered.companyId,recoveredCompany);
    assert.equal(recovered.message,'Casa');
    assert.equal((await one("SELECT count(*)::int n FROM inbound_reply_jobs WHERE company_id=$1 AND state='pending'",[recoveredCompany])).n,2);
    assert.equal((await one('SELECT claim_missing_inbound_reply() job')).job,null,'recovery lease is bounded');
    const recoveredTurn=await claim(recoveredCompany,recoveredConversation);
    assert.deepEqual(recoveredTurn.messages.map(m=>m.message),['Comprar','Casa']);
    await db.query('SELECT release_attendance_turn($1,$2,$3)',[recoveredCompany,recoveredConversation,recoveredTurn.token]);
    await db.query("UPDATE inbound_reply_jobs SET state='done' WHERE company_id=$1",[recoveredCompany]);

    // A legacy outbox already existing must win regardless of a stale reserved
    // attendance_replies state: rollout must never re-send historic messages.
    const legacyExternal=await add('Mensagem antiga',recoveredCompany,recoveredConversation);
    await db.query("INSERT INTO attendance_replies(company_id,conversation_id,dedup_key) VALUES($1,$2,$3)",[recoveredCompany,recoveredConversation,'reply:'+legacyExternal]);
    await db.query('SELECT enqueue_conversation_message($1,$2,$3,$4,NULL)',[recoveredCompany,recoveredConversation,'reply:'+legacyExternal,'Resposta antiga']);
    await db.query("UPDATE attendance_replies SET state='reserved' WHERE company_id=$1",[recoveredCompany]);
    await quiet(); assert.equal((await claim(recoveredCompany,recoveredConversation)).status,'ignored');
    assert.equal((await one("SELECT state FROM inbound_reply_jobs j JOIN messages m ON m.company_id=j.company_id AND m.id=j.message_id WHERE m.external_message_id=$1",[legacyExternal])).state,'done');

    // Manual outbox rows preserve their old protocol and are not superseded by
    // customer typing, as the new cancellation applies only to automatic turns.
    await db.query("UPDATE conversations SET assigned_broker_id=$1,assigned_to='Dono 2' WHERE id=$2",[id(21),recoveredConversation]);
    const manual=(await one('SELECT enqueue_conversation_message($1,$2,$3,$4,$5) id',[recoveredCompany,recoveredConversation,'manual-fixture','Mensagem humana',id(21)])).id;
    await db.query('SELECT claim_outbox_message_v2($1,$2)',[recoveredCompany,manual]);
    await add('Mais uma pergunta',recoveredCompany,recoveredConversation);
    assert.equal((await one('SELECT mark_outbox_provider_attempt($1,$2,1) ok',[recoveredCompany,manual])).ok,true);
    console.log('PASS bounded recovery keeps burst fragments, rollout does not replay old outbox, manual sends unchanged');

    await db.query("UPDATE messages SET created_at=now()-interval '1 hour' WHERE company_id=$1 AND sender_type='human'",[company]);
    const valid=await add('Mensagem válida'); await add('Data inválida',company,conversation,'-10 minutes');
    await quiet(); const validTurn=await claim();
    assert.equal(validTurn.status,'claimed');
    assert.deepEqual(validTurn.messages.map(m=>m.externalMessageId),[valid],'invalid provider timestamp cannot poison a valid earlier turn');
    assert.equal((await enqueue(validTurn,'Resposta à mensagem válida')).status,'queued');

    // A pending automatic reply that will be superseded must not suppress its
    // successor, otherwise neither copy would ever reach the provider.
    await add('Repete a pergunta'); await quiet(); const pendingRepeat=await claim();
    assert.equal(pendingRepeat.lastReply,null,'a pending newer outgoing cannot reuse an older confirmed summary');
    assert.equal((await enqueue(pendingRepeat,'Resposta à mensagem válida')).status,'queued');

    await add('Quero um corretor'); await quiet(); const handoff=await claim();
    const handoffResult=(await one('SELECT enqueue_attendance_turn($1,$2,$3,$4,$5,$6,$7,true) result',
      [company,conversation,handoff.token,handoff.watermark,'Vou chamar um corretor para você.','{}',null])).result;
    assert.equal((await one('SELECT bot_paused FROM conversations WHERE id=$1',[conversation])).bot_paused,false,'enqueue handoff does not cancel its own outbox');
    await add('E quanto custa?'); await quiet();
    assert.equal((await claim()).status,'deferred','new typing cannot race or erase the queued human handoff');
    assert.equal((await one('SELECT claim_outbox_message_v2($1,$2) ok',[company,handoffResult.messageId])).ok,true);
    assert.equal((await one('SELECT mark_outbox_provider_attempt($1,$2,1) ok',[company,handoffResult.messageId])).ok,true,'handoff survives a newer inbound watermark');
    assert.equal((await one('SELECT bot_paused FROM conversations WHERE id=$1',[conversation])).bot_paused,false,'retryable handoff must not be paused before provider result');
    await db.query("SELECT finish_outbox_attempt($1,$2,1,'pending',130429,NULL,now()+interval '1 minute')",[company,handoffResult.messageId]);
    assert.equal((await one('SELECT reconcile_attendance_handoffs($1,$2) n',[company,conversation])).n,0,'retryable rate limit does not pause bot or cancel handoff');
    await db.query("UPDATE message_outbox SET next_attempt_at=now()-interval '1 minute' WHERE id=$1",[handoffResult.messageId]);
    assert.equal((await one('SELECT claim_outbox_message_v2($1,$2) ok',[company,handoffResult.messageId])).ok,true,'normal bounded retry can claim handoff again');
    assert.equal((await one('SELECT mark_outbox_provider_attempt($1,$2,2) ok',[company,handoffResult.messageId])).ok,true);
    await db.query("SELECT finish_outbox_attempt($1,$2,2,'uncertain',NULL,NULL,NULL)",[company,handoffResult.messageId]);
    await add('Você ainda está aí?'); await quiet(); assert.equal((await claim()).status,'ignored','handoff survives a worker crash/provider ambiguity');
    assert.equal((await one('SELECT bot_paused FROM conversations WHERE id=$1',[conversation])).bot_paused,true,'claim repairs missed terminal handoff reconciliation durably');
    assert.equal((await one('SELECT reconcile_attendance_handoffs($1,$2) n',[company,conversation])).n,0,'handoff reconciliation is idempotent');
    await db.query('UPDATE conversations SET bot_paused=false WHERE id=$1',[conversation]);
    await add('Pode repetir?'); await quiet(); const uncertainRepeat=await claim();
    assert.equal((await enqueue(uncertainRepeat,'Vou chamar um corretor para você.')).status,'suppressed','ambiguous handoff is not duplicated');

    const legacyLive=await add('Resposta de worker antigo'); await quiet();
    await db.query("INSERT INTO attendance_replies(company_id,conversation_id,dedup_key) VALUES($1,$2,$3)",[company,conversation,'reply:'+legacyLive]);
    assert.equal((await claim()).status,'deferred','live pre-deploy worker gets a chance to finish');
    await db.query("UPDATE attendance_replies SET created_at=now()-interval '3 minutes' WHERE company_id=$1 AND dedup_key=$2",[company,'reply:'+legacyLive]);
    const migrated=await claim(); assert.equal(migrated.status,'claimed');
    assert.equal((await one('SELECT state FROM attendance_replies WHERE company_id=$1 AND dedup_key=$2',[company,'reply:'+legacyLive])).state,'uncertain','stale worker cannot enqueue after being superseded');
    await enqueue(migrated,'Turno recuperado com segurança.');
    await db.query("UPDATE leads SET interest_profile=interest_profile||'{\"correctionField\":\"city\",\"correctionRequested\":true}'::jsonb WHERE id=$1",[lead]);
    assert.equal((await one('SELECT merge_attendance_profile($1,$2,$3,$4) ok',[company,lead,await leadVersion(),'{"city":"São João","correctionField":null,"correctionRequested":false,"propertyType":null}'])).ok,true);
    const corrected=(await one('SELECT interest_profile FROM leads WHERE id=$1',[lead])).interest_profile;
    assert.equal(corrected.correctionField,undefined,'explicit null clears only the old correction target');
    assert.equal(corrected.propertyType,'Casa','other nulls do not erase known preferences');
    await add('Quero mudar outra coisa'); await quiet(); const genericCorrection=await claim();
    await enqueue(genericCorrection,'Qual informação você quer mudar?',{correctionRequested:true},await leadVersion());
    assert.equal((await one('SELECT interest_profile FROM leads WHERE id=$1',[lead])).interest_profile.correctionField,undefined,'generic correction does not revive the previous city target');
    await db.query("INSERT INTO messages(company_id,conversation_id,direction,sender_type,content,external_message_id) SELECT $1,$2,'incoming','client','Fragmento '||n,'overflow-'||n FROM generate_series(1,41) n",[company,conversation]);
    await quiet(); const overflow=await claim();
    assert.equal(overflow.overflow,true); assert.equal(overflow.messages.length,40,'unusual flood has bounded content for safe handoff');
    const overflowResult=(await one('SELECT enqueue_attendance_turn($1,$2,$3,$4,$5,$6,$7,true) result',
      [company,conversation,overflow.token,overflow.watermark,'Recebi suas mensagens. Um corretor vai continuar com você.','{}',null])).result;
    assert.equal(overflowResult.status,'queued');
    assert.equal((await one("SELECT count(*)::int n FROM inbound_reply_jobs WHERE company_id=$1 AND state='pending'",[company])).n,0);
    assert.equal((await one("SELECT count(*)::int n FROM messages WHERE company_id=$1 AND external_message_id LIKE 'overflow-%'",[company])).n,41,'all original messages remain available to the human');
    await db.query('SELECT claim_outbox_message_v2($1,$2)',[company,overflowResult.messageId]);
    await db.query('SELECT mark_outbox_provider_attempt($1,$2,1)',[company,overflowResult.messageId]);
    await db.query("SELECT finish_outbox_attempt($1,$2,1,'sent',NULL,'wamid.handoff-final',NULL)",[company,overflowResult.messageId]);
    assert.equal((await one('SELECT change_conversation_owner($1,$2,$3,false) ok',[company,lead,id(11)])).ok,true);
    assert.equal((await one('SELECT change_conversation_owner($1,$2,$3,true) ok',[company,lead,id(11)])).ok,true);
    assert.equal((await one('SELECT reconcile_attendance_handoffs($1,$2) n',[company,conversation])).n,0,'manual claim and release atomically dismiss late handoff bookkeeping');
    assert.equal((await one('SELECT bot_paused FROM conversations WHERE id=$1',[conversation])).bot_paused,false,'explicitly resumed bot is not paused by stale handoff');
    const recoveryValid=await add('Resposta válida pendente');
    const recoveryExpired=await add('Mensagem atrasada expirada',company,conversation,'25 hours');
    await db.query("UPDATE inbound_reply_jobs SET next_attempt_at=now()-interval '1 minute' WHERE company_id=$1 AND state='pending'",[company]);
    const validRecovery=(await one('SELECT claim_missing_inbound_reply() job')).job;
    assert.equal(validRecovery.incomingExternalMessageId,recoveryValid,'late expired arrival cannot cancel valid recovery work');
    assert.equal((await one('SELECT state FROM inbound_reply_jobs j JOIN messages m ON m.company_id=j.company_id AND m.id=j.message_id WHERE m.external_message_id=$1',[recoveryExpired])).state,'cancelled');
    console.log('PASS invalid timestamp fence, pending duplicate safety, durable handoff, ambiguous duplicate suppression, rollout lease and bounded overflow');

    for(const role of ['anon','authenticated']) {
      await db.exec('SET ROLE '+role);
      await assert.rejects(()=>claim(),e=>e.code==='42501');
      await assert.rejects(()=>db.query('SELECT * FROM attendance_turns'),e=>e.code==='42501');
      await assert.rejects(()=>db.query('SELECT release_attendance_turn($1,$2,$3)',[company,conversation,successor.token]),e=>e.code==='42501');
      await assert.rejects(()=>enqueue(successor,'Forbidden'),e=>e.code==='42501');
      await db.exec('RESET ROLE');
    }
    console.log('PASS new attendance RPCs and lease table are service-only');
  } finally { await db.close(); }
})().catch(error=>{ console.error(error); process.exitCode=1; });
