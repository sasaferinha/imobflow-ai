// Metadata-only PostgREST seam used by the real bridge/reader integration tests.
const assert = require('node:assert/strict');

async function stageMessageQuery(db, resource, params) {
  assert.ok(['messages', 'message_delivery_events'].includes(resource));
  const values = [], conditions = [];
  const add = value => { values.push(value); return `$${values.length}`; };
  const eq = key => { const value = params.get(key); assert.ok(value?.startsWith('eq.'), key); return value.slice(3); };
  conditions.push(`company_id=${add(eq('company_id'))}`);
  const limit = Number(params.get('limit'));
  assert.ok(Number.isSafeInteger(limit) && limit > 0 && limit <= 16);
  const columns = params.get('select');
  let order = '';
  if (resource === 'messages') {
    assert.equal(columns, 'id,company_id,conversation_id,direction,sender_type,created_at,delivery_status,external_message_id');
    conditions.push(`conversation_id=${add(eq('conversation_id'))}`);
    for (const key of ['direction', 'sender_type']) {
      const value = params.get(key);
      assert.match(value, /^in\.\(.+\)$/);
      const items = value.slice(4, -1).split(',').map(item => item.replace(/^"|"$/g, ''));
      conditions.push(`${key}=ANY(${add(items)}::text[])`);
    }
    if (params.has('created_at')) {
      assert.ok(params.get('created_at').startsWith('gt.'));
      conditions.push(`created_at>${add(params.get('created_at').slice(3))}::timestamptz`);
    }
    if (params.has('or')) {
      assert.equal(params.get('or'), '(delivery_status.in.(sent,delivered,read),and(delivery_status.is.null,external_message_id.not.is.null))');
      conditions.push("(delivery_status IN ('sent','delivered','read') OR (delivery_status IS NULL AND external_message_id IS NOT NULL))");
    }
    if (params.has('and')) {
      const cursor = params.get('and').match(/^\(or\(created_at\.gt\.(.+),and\(created_at\.eq\.(.+),id\.gt\.([0-9a-f-]+)\)\)\)$/);
      assert.ok(cursor); assert.equal(cursor[1], cursor[2]);
      conditions.push(`(created_at,id)>(${add(cursor[1])}::timestamptz,${add(cursor[3])}::uuid)`);
    }
    assert.ok(['created_at.asc,id.asc', 'created_at.desc,id.desc'].includes(params.get('order')));
    order = params.get('order').endsWith('desc') ? 'ORDER BY created_at DESC,id DESC' : 'ORDER BY created_at ASC,id ASC';
  } else {
    assert.equal(columns, 'external_message_id,status');
    const externalIds = params.get('external_message_id');
    assert.match(externalIds, /^in\.\(.+\)$/);
    conditions.push(`external_message_id=ANY(${add(JSON.parse(`[${externalIds.slice(4, -1)}]`))}::text[])`);
  }
  const result = await db.query(`SELECT to_jsonb(q) payload FROM (SELECT ${columns} FROM public.${resource} WHERE ${conditions.join(' AND ')} ${order} LIMIT ${limit}) q`, values);
  return result.rows.map(row => row.payload);
}

module.exports = { stageMessageQuery };
