const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDatabase, seedCompanies, id, migration, isolationMigration } = require('./helpers/tenant-test-database.cjs');
const target = '20261118010000_instagram_native_login.sql';

// Actual migrations, synthetic tenants/accounts/tokens and no provider/network.
(async () => {
  const db = await createDatabase();
  try {
    for (const name of fs.readdirSync(path.resolve(__dirname, '../../../supabase/migrations'))
      .filter(name => name.endsWith('.sql') && name > isolationMigration && name < target).sort()) await db.exec(migration(name));
    await seedCompanies(db);
    const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
    const future = days => new Date(Date.now() + days * 86400000).toISOString();
    const legacy = (company, external, page, channel = 'instagram', actor = id(company * 10 + 1)) => scalar(
      'SELECT bind_social_account($1,$2,$3,$4,$5,$6,$7,$8)', [id(company), actor, channel, external, page, 'Legacy fixture', 'encrypted-fixture-facebook', 'v26.0']);
    const native = (options = {}) => {
      const input = { company: id(1), actor: id(11), external: '456', name: 'Native fixture', token: 'encrypted-fixture-instagram', version: 'v26.0', expiry: future(60), ...options };
      return scalar('SELECT bind_instagram_account($1,$2,$3,$4,$5,$6,$7)', Object.values(input));
    };
    const disconnect = (company = 1, channel = 'instagram') => scalar("SELECT configure_social_account($1,$2,$3,'disconnect',NULL)", [id(company), id(company * 10 + 1), channel]);
    const receive = (account, lead, mid, recipient = '777') => scalar(
      "SELECT receive_social_message($1,$2,$3,$4,'Olá','[]',NULL,$5)", [account, id(lead), recipient, mid, new Date().toISOString()]);
    const handoff = (thread, mode = 'human') => scalar('SELECT social_handoff($1,$2,$3,$4)', [id(1), id(11), thread, mode]);
    const enqueue = (thread, key) => scalar("SELECT enqueue_social_batch($1,$2,$3,$4,$5,'human',NULL)", [id(1), thread, id(11), key, JSON.stringify([{ content: 'Mensagem de teste', media: [] }])]);
    const claim = message => scalar('SELECT claim_social_message($1,$2)', [id(1), message]);
    const inbox = () => scalar("SELECT read_social_inbox($1,$2,'instagram')", [id(1), id(11)]);
    const ready = account => scalar('SELECT public.social_account_is_ready(a) FROM social_accounts a WHERE id=$1', [account]);
    const oauth = (state, provider = 'facebook', channel = null) => db.query(
      'INSERT INTO social_oauth_requests(state_hash,company_id,broker_id,redirect_uri,expires_at,channel,login_provider) VALUES($1,$2,$3,$4,now()+interval \'10 minutes\',$5,$6)',
      [state, id(1), id(11), 'https://www.imobflow.net.br/api/integrations/meta/social/callback', channel, provider]);

    const legacyAccount = await legacy(1, '456', '123');
    const facebookAccount = await legacy(1, '123', '123', 'facebook');
    const legacyMessage = await receive(legacyAccount, 701, 'same-external-message');
    await db.query('INSERT INTO social_authorizations(company_id,broker_id,token_ciphertext,expires_at) VALUES($1,$2,$3,$4)', [id(1), id(11), 'encrypted-fixture-facebook-oauth', future(1)]);
    await db.query('INSERT INTO social_oauth_requests(state_hash,company_id,broker_id,redirect_uri,expires_at) VALUES($1,$2,$3,$4,$5)', ['pre-migration-state', id(1), id(11), 'https://www.imobflow.net.br/api/integrations/meta/social/callback', future(1)]);
    await db.exec(migration(target));
    assert.deepEqual((await db.query('SELECT login_provider,token_expires_at FROM social_accounts WHERE id=$1', [legacyAccount])).rows[0], { login_provider: 'facebook', token_expires_at: null });
    assert.deepEqual((await db.query("SELECT login_provider,channel FROM social_oauth_requests WHERE state_hash='pre-migration-state'")).rows[0], { login_provider: 'facebook', channel: null });
    assert.equal(await ready(legacyAccount), true);
    assert.equal((await inbox()).find(thread => thread.id === legacyMessage.threadId).enabled, true);

    await oauth('native-state', 'instagram', 'instagram');
    await oauth('facebook-state', 'facebook', 'facebook');
    await assert.rejects(() => oauth('bad-provider', 'unknown', 'instagram'), /check constraint/);
    await assert.rejects(() => oauth('bad-channel', 'instagram', 'facebook'), /check constraint/);
    await assert.rejects(() => oauth('missing-channel', 'instagram', null), /check constraint/);
    assert.equal((await db.query("DELETE FROM social_oauth_requests WHERE state_hash='native-state' AND login_provider='facebook' RETURNING state_hash")).rows.length, 0);
    assert.equal((await db.query("DELETE FROM social_oauth_requests WHERE state_hash='native-state' AND login_provider='instagram' AND channel='instagram' RETURNING state_hash")).rows.length, 1);
    assert.equal(await scalar("SELECT count(*)::int FROM social_oauth_requests WHERE state_hash='facebook-state'"), 1, 'consuming IG state preserves Facebook state');

    await assert.rejects(() => native(), /social_account_disconnect_required/, 'same account under another provider is still a different connection');
    await assert.rejects(() => native({ company: id(2), actor: id(21) }), /social_account_bound/, 'global IG ownership spans providers');
    await assert.rejects(() => native({ actor: id(21) }), /social_forbidden/);
    await assert.rejects(() => native({ actor: null }), /social_forbidden/);
    await db.query('UPDATE broker_accounts SET active=false WHERE id=$1', [id(11)]);
    await assert.rejects(() => native(), /social_forbidden/);
    await db.query('UPDATE broker_accounts SET active=true WHERE id=$1', [id(11)]);
    await db.query("INSERT INTO broker_accounts(id,company_id,name,name_key,password_hash,role,active,email,email_key) VALUES($1,$2,'Corretor','corretor','scrypt-v1$fixture','broker',true,'broker@example.test','broker@example.test')", [id(12), id(1)]);
    await assert.rejects(() => native({ actor: id(12) }), /social_forbidden/);
    for (const invalid of [{ external: null }, { external: 'abc' }, { token: null }, { token: '' }, { version: null }, { version: 'https://unsafe' }, { expiry: null }, { expiry: future(-1) }, { expiry: future(62) }, { expiry: 'infinity' }]) {
      await assert.rejects(() => native(invalid), /social_invalid/);
    }
    await assert.rejects(() => db.query("UPDATE social_accounts SET login_provider='instagram' WHERE id=$1", [legacyAccount]), /social_account_identity_immutable/);
    await assert.rejects(() => db.query('UPDATE social_accounts SET company_id=$1 WHERE id=$2', [id(2), legacyAccount]), /social_account_identity_immutable/);

    await handoff(legacyMessage.threadId);
    const legacyQueued = (await enqueue(legacyMessage.threadId, 'legacy-pending'))[0];
    await db.query("UPDATE social_messages SET status='sending' WHERE id=$1", [legacyQueued]);
    await assert.rejects(() => disconnect(), /social_sending/);
    await db.query("UPDATE social_messages SET status='pending' WHERE id=$1", [legacyQueued]);
    await disconnect();
    assert.equal(await scalar('SELECT token_ciphertext FROM social_authorizations WHERE company_id=$1', [id(1)]), 'encrypted-fixture-facebook-oauth');
    assert.equal(await scalar('SELECT enabled FROM social_accounts WHERE id=$1', [facebookAccount]), true);
    assert.equal(await scalar('SELECT status FROM social_messages WHERE id=$1', [legacyQueued]), 'failed');
    await assert.rejects(() => legacy(1, '456', '123', 'instagram', null), /social_connection_unavailable/, 'legacy environment fallback cannot override disconnect');

    await db.exec('SET ROLE service_role');
    const nativeAccount = await native();
    await db.exec('RESET ROLE');
    assert.notEqual(nativeAccount, legacyAccount);
    assert.deepEqual((await db.query('SELECT channel,account_id,page_id,login_provider FROM social_accounts WHERE id=$1', [nativeAccount])).rows[0], {
      channel: 'instagram', account_id: '456', page_id: '456', login_provider: 'instagram',
    });
    assert.equal(await ready(nativeAccount), true, 'native IG is ready without a Facebook Page');
    await assert.rejects(() => receive(nativeAccount, 701, 'do-not-mix'), /social_identity_conflict/, 'native recipient cannot inherit legacy lead/history');
    const nativeMessage = await receive(nativeAccount, 702, 'same-external-message');
    assert.notEqual(nativeMessage.threadId, legacyMessage.threadId);
    assert.notEqual(nativeMessage.leadId, legacyMessage.leadId);
    assert.equal(await scalar("SELECT interest_profile->>'socialLoginProvider' FROM leads WHERE id=$1", [id(702)]), 'instagram');
    assert.equal((await inbox()).find(thread => thread.id === nativeMessage.threadId).loginProvider, 'instagram');
    assert.equal((await inbox()).find(thread => thread.id === nativeMessage.threadId).enabled, true);
    assert.equal((await inbox()).find(thread => thread.id === legacyMessage.threadId).enabled, false);
    assert.equal(await native({ token: 'renewed-ciphertext', expiry: future(59) }), nativeAccount, 'renewal preserves account UUID');
    assert.equal(await scalar('SELECT account_id FROM social_threads WHERE id=$1', [nativeMessage.threadId]), nativeAccount);
    assert.equal(await scalar('SELECT token_ciphertext FROM social_accounts WHERE id=$1', [nativeAccount]), 'renewed-ciphertext');
    await assert.rejects(() => native({ external: '789' }), /social_account_disconnect_required/);
    await assert.rejects(() => legacy(1, '456', '123'), /social_account_disconnect_required/);
    await assert.rejects(() => db.query("UPDATE social_accounts SET enabled=true WHERE id=$1", [legacyAccount]), /unique|duplicate/);
    await assert.rejects(() => db.query("UPDATE social_accounts SET login_provider='facebook' WHERE id=$1", [nativeAccount]), /social_account_identity_immutable/);
    await assert.rejects(() => db.query('UPDATE social_accounts SET token_expires_at=NULL WHERE id=$1', [nativeAccount]), /check constraint/);
    await assert.rejects(() => db.query("UPDATE social_accounts SET page_id='999' WHERE id=$1", [nativeAccount]), /check constraint/);

    await handoff(nativeMessage.threadId);
    const expiringQueued = (await enqueue(nativeMessage.threadId, 'native-expiring'))[0];
    await db.query("UPDATE social_accounts SET token_expires_at=now()-interval '1 minute' WHERE id=$1", [nativeAccount]);
    assert.equal(await ready(nativeAccount), false);
    assert.equal((await inbox()).find(thread => thread.id === nativeMessage.threadId).enabled, false);
    await assert.rejects(() => enqueue(nativeMessage.threadId, 'native-after-expiry'), /social_connection_unavailable/);
    assert.equal(await claim(expiringQueued), null, 'queued message cannot dispatch after token expiry');
    assert.equal(await scalar('SELECT status FROM social_messages WHERE id=$1', [expiringQueued]), 'failed');
    await native();
    await handoff(nativeMessage.threadId, 'automatic');
    const queuedBeforeExpiry = await receive(nativeAccount, 702, 'queued-before-expiry');
    assert.equal(await scalar('SELECT status FROM social_ai_jobs WHERE message_id=$1', [queuedBeforeExpiry.messageId]), 'pending');
    await db.query("UPDATE social_accounts SET token_expires_at=now()-interval '1 minute' WHERE id=$1", [nativeAccount]);
    assert.equal(await scalar('SELECT claim_social_ai_job($1,$2,$3)', [id(8801), id(1), queuedBeforeExpiry.messageId]), null, 'AI queued before expiry must not start a paid turn after expiry');
    assert.equal(await scalar('SELECT status FROM social_ai_jobs WHERE message_id=$1', [queuedBeforeExpiry.messageId]), 'failed');
    assert.equal(await scalar('SELECT error_code FROM social_ai_jobs WHERE message_id=$1', [queuedBeforeExpiry.messageId]), 'connection_unavailable');
    const expiredInbound = await receive(nativeAccount, 702, 'expired-token-inbound');
    assert.equal(expiredInbound.saved, true, 'expiry of outbound credential does not discard a verified incoming lead');
    assert.equal(await scalar('SELECT count(*)::int FROM social_ai_jobs WHERE message_id=$1', [expiredInbound.messageId]), 0, 'expired connection does not schedule paid AI');
    await native();
    const freshInbound = await receive(nativeAccount, 702, 'renewed-token-inbound');
    assert.equal(await scalar('SELECT count(*)::int FROM social_ai_jobs WHERE message_id=$1', [freshInbound.messageId]), 1);
    await handoff(nativeMessage.threadId);
    const sendable = (await enqueue(nativeMessage.threadId, 'native-sendable'))[0];
    assert.equal((await claim(sendable)).accountId, nativeAccount);
    assert.equal(await claim(sendable), null, 'provider namespace does not change single dispatch semantics');
    await assert.rejects(() => disconnect(), /social_sending/);
    await db.query("UPDATE social_messages SET status='sent' WHERE id=$1", [sendable]);
    const cancelled = (await enqueue(nativeMessage.threadId, 'native-cancelled'))[0];
    await disconnect();
    assert.equal(await disconnect(), true);
    assert.equal(await scalar('SELECT status FROM social_messages WHERE id=$1', [cancelled]), 'failed');
    assert.equal(await scalar('SELECT token_ciphertext FROM social_accounts WHERE id=$1', [nativeAccount]), null);
    assert.equal(await scalar('SELECT token_ciphertext FROM social_authorizations WHERE company_id=$1', [id(1)]), 'encrypted-fixture-facebook-oauth');
    assert.equal(await native(), nativeAccount, 'reconnect native restores only native identity');
    await disconnect();
    assert.equal(await legacy(1, '456', '123'), legacyAccount, 'switch back restores original Facebook namespace');
    assert.equal(await scalar('SELECT account_id FROM social_threads WHERE id=$1', [nativeMessage.threadId]), nativeAccount);
    await assert.rejects(() => native({ company: id(2), actor: id(21) }), /social_account_bound/, 'archived native identity cannot move companies');
    await assert.rejects(() => legacy(2, '456', '999'), /social_account_bound/);
    await assert.rejects(() => db.query("INSERT INTO social_accounts(company_id,channel,account_id,page_id,name,login_provider,token_expires_at) VALUES($1,'instagram','456','456','Cannot take account','instagram',now()+interval '1 day')", [id(2)]), /social_account_bound/, 'insert guard enforces ownership even outside binding RPC');

    // Native page_id is a sentinel, not a Page ownership claim. Equal numeric
    // IDs across different providers' resource types must not invent a link.
    const unrelatedFacebook = await legacy(2, '456', '456', 'facebook');
    assert.equal(await ready(unrelatedFacebook), true);
    const unrelatedNative = await native({ company: id(2), actor: id(21), external: '123' });
    assert.equal(await ready(unrelatedNative), true);
    assert.equal(await scalar('SELECT enabled FROM social_accounts WHERE id=$1', [facebookAccount]), true);

    for (const role of ['anon', 'authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      try {
        await assert.rejects(() => native(), /permission denied/);
        await assert.rejects(() => db.query('SELECT login_provider,token_expires_at FROM social_accounts'), /permission denied/);
        await assert.rejects(() => db.query('UPDATE social_oauth_requests SET login_provider=\'instagram\''), /permission denied/);
      } finally { await db.exec('RESET ROLE'); }
    }
    await disconnect(1, 'facebook');
    assert.equal(await scalar('SELECT count(*)::int FROM social_authorizations WHERE company_id=$1', [id(1)]), 0, 'Facebook disconnect keeps its existing authorization-clearing behavior');
    assert.equal(await scalar('SELECT enabled FROM social_accounts WHERE id=$1', [legacyAccount]), true, 'Facebook disconnect does not disable connected Instagram');
    console.log('PASS native Instagram SQL: legacy migration compatibility, provider-scoped OAuth/history, cross-provider tenant ownership, Page-free readiness, active owner, renewal, expiry guards, received leads, single dispatch, disconnect/in-flight protection and Facebook authorization isolation.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exit(1); });
