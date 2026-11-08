const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
class SocialError extends Error{constructor(message,status=400){super(message);this.status=status;}}
function fixture(options={}){
 let destinations=0;const lead={id:`lead:${id(2)}`,kind:'leads',legacy:{id:id(2),table:'leads'},data:{name:'Synthetic'}};const state={records:[lead],version:1,sourceRevision:'revision'};
 const modules={
  'next/server':{NextResponse:{json:Response.json}},'@/lib/accounts':{protectedRoute:f=>f},'@/lib/tenant-context':{currentAccount:()=>({companyId:id(1),brokerId:id(11)})},
  '@/lib/request-security':{hasSameOrigin:()=>true,hasSafeRequestSize:()=>true,consumeRateLimit:async()=>true},'@/lib/evolution/model':{canAccess:()=>true,CrmError:class extends Error{}},
  '@/lib/evolution/server':{getEvolutionSnapshot:async()=>({state}),EvolutionServerError:class extends Error{}},'@/lib/ai/tenant-settings-server':{readTenantAISettings:async()=>({brokerAssistantEnabled:true})},
  '@/lib/lead-channel-server':{leadMessageDestination:async()=>{destinations++;if(options.denied&&destinations===2)throw new SocialError('Carteira alterada',403);return destinations===2&&options.changed?{channel:'instagram',threadId:id(5)}:{channel:options.social?'instagram':'whatsapp',threadId:options.social?id(5):null};}},
  '@/lib/social-model':{SocialError},'@/lib/social-messaging':{readSocialInbox:async()=>({contacts:[{id:id(5),leadId:id(2),messages:[{id:id(7),direction:'incoming',text:'Quero casa',mediaType:null}]}]})},'@/lib/social-audio':{transcribeSocialAudio:async()=>null},
  '@/lib/supabase':{supabaseRequest:async resource=>resource.startsWith('conversations?')?[{id:id(3),company_id:id(1),lead_id:id(2)}]:[{id:id(4),company_id:id(1),conversation_id:id(3),direction:'incoming',content:'Quero casa'}]},
  '@/lib/ai/broker-assistant':{BrokerAssistantError:class extends Error{},generateBrokerAssistance:async input=>{assert.equal(input.messages.length,1);return{reply:'Test',changes:[],summary:[]};}},
  '@/lib/ai/audio-transcription':{audioNeedsTranscription:()=>false,audioTranscriptText:()=>null,transcribeConversationAudio:async()=>null},
 };
 const mod={exports:{}};const src=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../app/api/conversations/assist/route.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(src,{module:mod,exports:mod.exports,require:n=>modules[n]||require(n),Buffer,Date,console});
 return()=>mod.exports.POST(new Request('https://example.test/api/conversations/assist',{method:'POST',headers:{origin:'https://example.test'},body:JSON.stringify({leadId:id(2),sector:'automatic'})}));
}
(async()=>{
 assert.equal((await fixture()()).status,200);assert.equal((await fixture({social:true})()).status,200);
 assert.equal((await fixture({changed:true})()).status,409,'channel/thread changes after inference invalidate response');
 assert.equal((await fixture({social:true,denied:true})()).status,403,'revoked social portfolio access is preserved, not generic 503');
 console.log('PASS assistant social routes: channel-specific chronology, post-inference destination recheck and accurate access denial.');
})().catch(error=>{console.error(error);process.exit(1);});
