const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE social_oauth_requests (state_hash text PRIMARY KEY, expires_at timestamptz NOT NULL); INSERT INTO social_oauth_requests VALUES ('existing', now() + interval '10 minutes');");
    await db.exec(fs.readFileSync(path.resolve(__dirname, '../../../supabase/migrations/20261115100000_social_oauth_channel.sql'), 'utf8'));
    assert.equal((await db.query("SELECT channel FROM social_oauth_requests WHERE state_hash='existing'")).rows[0].channel, null, 'migration preserves existing requests without inventing a channel');
    for (const channel of ['instagram', 'facebook', null]) await db.query('INSERT INTO social_oauth_requests(state_hash,expires_at,channel) VALUES($1,now(),$2)', [channel || 'legacy', channel]);
    await assert.rejects(() => db.query("INSERT INTO social_oauth_requests(state_hash,expires_at,channel) VALUES('invalid',now(),'whatsapp')"), /check constraint/);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM social_oauth_requests')).rows[0].count, 4);
    console.log('PASS social OAuth channel SQL: nullable compatibility, valid channel enums and rejected unknown channel.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
