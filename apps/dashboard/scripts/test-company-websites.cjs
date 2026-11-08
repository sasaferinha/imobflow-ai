const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { createDatabase, seedCompanies, id, migration, isolationMigration } = require('./helpers/tenant-test-database.cjs');
function load(file, dependencies = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: name => { if (!(name in dependencies)) throw Error(`Unexpected import ${name}`); return dependencies[name]; }, URL, Buffer, console, Date, Response });
  return module.exports;
}
const model = load('lib/website/model.ts'), content = model.defaultSiteContent('Horizonte · empresa fictícia');
assert.equal(model.validateSiteContent(content).brandName, content.brandName);
const plain = value => JSON.parse(JSON.stringify(value));
const legacyContent = { ...content, heroImageUrl: 'https://images.example.com/preserved.jpg', promotion: { enabled: true, title: 'Campanha preservada', text: 'Texto existente', imageUrl: 'https://images.example.com/banner.jpg', linkUrl: 'https://example.com/campaign', linkLabel: 'Conhecer' }, video: { enabled: true, title: 'Vídeo existente', url: 'https://youtu.be/dQw4w9WgXcQ' } };
delete legacyContent.layout;
assert.equal(content.layout, 'classic');
assert.deepEqual(plain(model.SITE_LAYOUTS).map(item => [item.id, item.name]), [['classic','Clássico'],['modern','Moderno'],['catalog','Vitrine']]);
const legacyBefore = JSON.stringify(legacyContent);
assert.deepEqual(plain(model.validateSiteContent(legacyContent)), { layout: 'classic', ...legacyContent }, 'legacy normalization adds only the default layout');
assert.equal(JSON.stringify(legacyContent), legacyBefore, 'validation never mutates saved legacy content');
for (const layout of ['classic','modern','catalog']) {
  const input = { ...legacyContent, layout };
  assert.deepEqual(plain(model.validateSiteContent(JSON.parse(JSON.stringify(input)))), input, 'each layout survives JSON roundtrip without changing brand/content');
}
for (const layout of [null, undefined, '', 'unknown', 'Classic', ' classic ', 0, false, {}, []]) assert.throws(() => model.validateSiteContent({ ...legacyContent, layout }), /modelo de site válido/);
const missingRequired = { ...legacyContent }; delete missingRequired.heroTitle;
assert.throws(() => model.validateSiteContent(missingRequired), 'compatibility must not relax existing required fields');
assert.throws(() => model.validateSiteContent({ ...legacyContent, extra: true }), 'compatibility must not allow unknown fields');
for (const url of ['javascript:alert(1)','data:text/html,test','http://example.com','https://127.0.0.1/x','https://user:password@example.com','//example.com','https://localhost/x','https://sub.internal/x']) assert.throws(() => model.safeWebsiteUrl(url));
assert.equal(model.videoEmbedUrl('https://youtu.be/dQw4w9WgXcQ'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
assert.equal(model.videoEmbedUrl('https://vimeo.com/12345'), 'https://player.vimeo.com/video/12345');
assert.equal(model.videoEmbedUrl('https://media.example.com/video.mp4'), 'https://media.example.com/video.mp4');
assert.throws(() => model.videoEmbedUrl('https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ'));
assert.throws(() => model.validateSiteContent({ ...content, companyId: 'foreign' }));
assert.throws(() => model.validateSiteContent({ ...content, primaryColor: 'red;position:fixed' }));
assert.throws(() => model.validateSiteContent({ ...content, video: { enabled: true, title: '', url: '' } }));
const projected = model.projectPublicProperty({ id:'p1', title:'Casa teste', purpose:'Venda', status:'Disponível', images:['javascript:alert(1)','https://images.example.com/house.jpg'], price:500000, ownerId:'PRIVATE', address:'PRIVATE', notes:'PRIVATE', commission:'PRIVATE', features:'Piscina' });
assert.equal(projected.images.length,1); assert(!JSON.stringify(projected).includes('PRIVATE'));
for (const status of ['Vendido','Alugado','Reservado','Arquivado','Desconhecido']) assert.equal(model.projectPublicProperty({ id:'p1', title:'Casa', purpose:'Venda', status }),null);

(async () => {
  const db = await createDatabase();
  try {
    for (const file of fs.readdirSync(path.resolve(__dirname,'../../../supabase/migrations')).filter(f => f.endsWith('.sql') && f>isolationMigration && f<='20261108000000_company_websites.sql').sort()) await db.exec(migration(file));
    await seedCompanies(db);
    const command = (action, version, actor=11, role='owner', company=1, document=content) => db.query('SELECT save_company_website($1,$2,$3,$4,$5,$6::jsonb) result',[id(company),id(actor),role,version,action,JSON.stringify(document)]);
    await db.exec('SET ROLE service_role');
    const saved = (await command('save',0)).rows[0].result;
    assert.equal(saved.version,1); assert.equal(saved.published,null,'draft not public');
    await assert.rejects(() => command('publish',0),/website_conflict/);
    await assert.rejects(() => command('publish',1,21),/website_forbidden/);
    const first = (await command('publish',1)).rows[0].result;
    assert.equal(first.published.brandName,content.brandName); assert.equal(first.version,2);
    const changed = {...content,layout:'modern',heroTitle:'Uma nova campanha'};
    const draft = (await command('save',2,11,'owner',1,changed)).rows[0].result;
    assert.equal(draft.published.heroTitle,content.heroTitle,'saving keeps public snapshot unchanged');
    assert.equal(draft.draft.layout,'modern'); assert.equal(draft.published.layout,'classic','saving a layout never publishes it implicitly');
    const second = (await command('publish',3,11,'owner',1,changed)).rows[0].result;
    assert.equal(second.previous.heroTitle,content.heroTitle);
    assert.equal(second.published.layout,'modern'); assert.equal(second.previous.layout,'classic');
    const restore = (await command('restore',4)).rows[0].result; assert.equal(restore.published.heroTitle,content.heroTitle);
    assert.equal(restore.published.layout,'classic','restore includes the former layout');
    const stopped = (await command('unpublish',5)).rows[0].result; assert.equal(stopped.published,null); assert.equal(stopped.published_at,null);
    await command('restore',6);
    const ph = `scrypt-v1$${'a'.repeat(32)}$${'b'.repeat(128)}`;
    const access = (actor=11,company=1,action='create',account=901) => db.query('SELECT manage_website_marketing($1,$2,$3,$4,$5,$6,$7)',[id(company),id(actor),action,id(account),'Marketing fictício','marketing@ficticia.test',ph]);
    await assert.rejects(() => access(21),/website_forbidden/);
    await access();
    assert.equal((await db.query('SELECT website_can_edit($1,$2,$3) ok',[id(1),id(901),'marketing'])).rows[0].ok,true);
    await assert.rejects(() => command('publish',7,901,'marketing',2),/website_forbidden/);
    const marketed = (await command('publish',7,901,'marketing',1,changed)).rows[0].result; assert.equal(marketed.updated_role,'marketing');
    await assert.rejects(() => access(901,1,'deactivate'),/website_forbidden/,'marketing cannot manage access');
    const token='c'.repeat(64);
    assert.equal((await db.query('SELECT issue_website_session($1,$2,$3) ok',[id(901),'wrong',token])).rows[0].ok,false);
    assert.equal((await db.query('SELECT issue_website_session($1,$2,$3) ok',[id(901),ph,token])).rows[0].ok,true);
    assert.equal((await db.query('SELECT * FROM read_website_session($1)',[token])).rows[0].company_id,id(1));
    assert.equal((await db.query('SELECT * FROM account_session($1)',[token])).rows.length,0,'marketing token never grants CRM access');
    await access(11,1,'deactivate');
    assert.equal((await db.query('SELECT * FROM read_website_session($1)',[token])).rows.length,0,'deactivation revokes sessions');
    await assert.rejects(()=>access(11,1,'reset-password'),/website_not_found/,'password reset cannot revive deactivated account');
    await assert.rejects(() => command('save',8,901,'marketing'),/website_forbidden/);
    const catalog = () => db.query('SELECT website_catalog($1) catalog',[id(1)]);
    const before = (await catalog()).rows[0].catalog; assert.equal(before.length,1); assert.equal(before[0].id,id(301));
    assert(!JSON.stringify(before).includes('address')); assert(!JSON.stringify(before).includes(id(401)),'other tenant never exposed');
    await db.exec('RESET ROLE');
    await db.query("UPDATE properties SET price=620000,images='[\"https://images.example.com/new.jpg\"]',address='PRIVATE STREET' WHERE id=$1",[id(301)]);
    await db.exec('SET ROLE service_role');
    const updated = (await catalog()).rows[0].catalog; assert.equal(updated[0].price,620000); assert.equal(updated[0].images[0],'https://images.example.com/new.jpg'); assert(!JSON.stringify(updated).includes('PRIVATE STREET'));
    await db.exec('RESET ROLE'); await db.query("UPDATE properties SET status='Vendido' WHERE id=$1",[id(301)]); await db.exec('SET ROLE service_role');
    assert.equal((await catalog()).rows[0].catalog.length,0,'sold property leaves catalogue immediately');
    await db.exec('RESET ROLE');
    const workspace={companyId:id(1),version:1,records:[
      {id:`property:${id(301)}`,kind:'properties',legacy:{table:'properties',id:id(301)},data:{status:'Disponível',price:1,features:'Varanda',notes:'PRIVATE OVERLAY'}},
      {id:`property:${id(399)}`,kind:'properties',data:{name:'Deleted canonical ghost',status:'Disponível',purpose:'Venda',price:100}},
      {id:id(801),kind:'properties',data:{name:'Native property',status:'Disponível',purpose:'Aluguel',price:2000,notes:'PRIVATE NATIVE',ownerId:'PRIVATE OWNER',address:'PRIVATE ADDRESS'}}
    ],members:[],settings:{},events:[]};
    await db.query('INSERT INTO crm_evolution_workspaces(company_id,version,document,updated_by) VALUES($1,1,$2::jsonb,$3)',[id(1),JSON.stringify(workspace),id(11)]);
    await db.exec('SET ROLE service_role');
    const native=(await catalog()).rows[0].catalog;assert.equal(native.length,1);assert.equal(native[0].id,id(801));assert(!JSON.stringify(native).includes('PRIVATE'),'native property is allowlisted too');
    await db.exec('RESET ROLE');await db.query("UPDATE properties SET status='Disponível' WHERE id=$1",[id(301)]);await db.exec('SET ROLE service_role');
    const overlay=(await catalog()).rows[0].catalog.find(p=>p.id===id(301));assert.equal(overlay.price,620000,'canonical fields beat stale overlay');assert.equal(overlay.features,'Varanda','only noncanonical public fields are overlaid');
    await db.exec('RESET ROLE');await db.query('UPDATE website_marketing_accounts SET active=true WHERE id=$1',[id(901)]);await db.exec('SET ROLE service_role');
    const expiring='d'.repeat(64);await db.query('SELECT issue_website_session($1,$2,$3)',[id(901),ph,expiring]);
    await db.exec('RESET ROLE');await db.query("UPDATE website_marketing_sessions SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE token_hash=$1",[expiring]);await db.exec('SET ROLE service_role');
    assert.equal((await db.query('SELECT * FROM read_website_session($1)',[expiring])).rows.length,0,'expired marketing session denied');
    const revoked='e'.repeat(64);await db.query('SELECT issue_website_session($1,$2,$3)',[id(901),ph,revoked]);await db.query('SELECT revoke_website_session($1)',[revoked]);assert.equal((await db.query('SELECT * FROM read_website_session($1)',[revoked])).rows.length,0,'logout revokes session');
    const resetToken='9'.repeat(64),newHash=`scrypt-v1$${'f'.repeat(32)}$${'a'.repeat(128)}`;
    await db.query('SELECT issue_website_session($1,$2,$3)',[id(901),ph,resetToken]);
    await assert.rejects(()=>db.query('SELECT manage_website_marketing($1,$2,$3,$4,$5,$6,$7)',[id(2),id(21),'reset-password',id(901),'','',newHash]),/website_not_found/,'foreign owner cannot reset account');
    await db.query('SELECT manage_website_marketing($1,$2,$3,$4,$5,$6,$7)',[id(1),id(11),'reset-password',id(901),'','',newHash]);
    assert.equal((await db.query('SELECT * FROM read_website_session($1)',[resetToken])).rows.length,0,'reset revokes every old session');
    assert.equal((await db.query('SELECT issue_website_session($1,$2,$3) ok',[id(901),ph,'8'.repeat(64)])).rows[0].ok,false,'old password hash cannot issue session after reset');
    assert.equal((await db.query('SELECT issue_website_session($1,$2,$3) ok',[id(901),newHash,'7'.repeat(64)])).rows[0].ok,true,'new password hash can authenticate');
    // Existing JSON rows need no migration. Their absent layout stays intact
    // until edited, and each read normalizes it without replacing any content.
    const legacySaved=(await command('save',0,21,'owner',2,legacyContent)).rows[0].result;
    assert.deepEqual(legacySaved.draft,legacyContent);
    const legacyPublished=(await command('publish',1,21,'owner',2,legacyContent)).rows[0].result;
    assert.equal(model.validateSiteContent(legacyPublished.published).layout,'classic');
    const catalogContent={...legacyContent,layout:'catalog'};
    const catalogDraft=(await command('save',2,21,'owner',2,catalogContent)).rows[0].result;
    assert.equal(catalogDraft.draft.layout,'catalog'); assert.deepEqual(catalogDraft.published,legacyContent);
    const catalogLive=(await command('publish',3,21,'owner',2,catalogContent)).rows[0].result;
    assert.equal(catalogLive.published.layout,'catalog'); assert.deepEqual(catalogLive.previous,legacyContent);
    const restoredLegacy=(await command('restore',4,21,'owner',2)).rows[0].result;
    assert.deepEqual(restoredLegacy.published,legacyContent); assert.deepEqual(plain(model.validateSiteContent(restoredLegacy.published)),{layout:'classic',...legacyContent});
    for(const role of ['anon','authenticated']) { await db.exec(`RESET ROLE; SET ROLE ${role}`); await assert.rejects(()=>db.query('SELECT * FROM company_websites'),e=>e.code==='42501'); await assert.rejects(()=>command('publish',8),e=>e.code==='42501'); await assert.rejects(()=>catalog(),e=>e.code==='42501'); await assert.rejects(()=>db.query('SELECT * FROM website_marketing_accounts'),e=>e.code==='42501'); }
    console.log('PASS websites SQL/model: fictitious tenants; draft/publish/restore, CAS, isolation, marketing login/revocation/no CRM access, live price/photos/sold status, public projection and URL validation.');
  } finally { await db.close(); }
})().catch(e => { console.error(e); process.exitCode=1; });
