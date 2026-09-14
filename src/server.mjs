import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {loadTopics,findTopic,topicSummary,liveTopicEnabled} from './topics.mjs';
import {configuration,fetchTopic,searchOne} from './pipeline/fetch.mjs';
import {classify} from './pipeline/classify.mjs';
import {buildReadingMap,ORDERS} from './engine.mjs';
import {normalizeQuestion,planQuestion,askTopic,widenFocus} from './ask.mjs';
import {extractComparison} from './pipeline/compare.mjs';
import {createOAuth,parseCookies} from './oauth.mjs';
import {fetchCollections,fetchContents,runCheckup,verifyUserApis} from './userdata.mjs';
import {createStore} from './store.mjs';
import {adviseTurn,inferProfile,FACT_KEYS} from './agent.mjs';
import {findPeers,MAX_SITUATIONS,situationValue} from './peers.mjs';
import {dailyBudget} from './budget.mjs';

const root=new URL('../',import.meta.url);
const topics=await loadTopics();

const FILES={
  '/':['public/index.html','text/html; charset=utf-8'],
  '/app.js':['public/app.js','text/javascript; charset=utf-8'],
  '/i18n.js':['public/i18n.js','text/javascript; charset=utf-8'],
  '/advisor.js':['public/advisor.js','text/javascript; charset=utf-8'],
  '/engine.js':['src/engine.mjs','text/javascript; charset=utf-8'],
  '/session.js':['public/session.js','text/javascript; charset=utf-8'],
  '/light.css':['public/light.css','text/css; charset=utf-8'],
  '/assets/icons/house.svg':['public/assets/icons/house.svg','image/svg+xml'],
  '/assets/icons/chat-centered-text.svg':['public/assets/icons/chat-centered-text.svg','image/svg+xml'],
  '/assets/icons/user.svg':['public/assets/icons/user.svg','image/svg+xml'],
  '/assets/icons/magnifying-glass.svg':['public/assets/icons/magnifying-glass.svg','image/svg+xml'],
  '/assets/icons/caret-right.svg':['public/assets/icons/caret-right.svg','image/svg+xml'],
  '/assets/icons/microphone.svg':['public/assets/icons/microphone.svg','image/svg+xml'],
  '/assets/icons/arrow-clockwise.svg':['public/assets/icons/arrow-clockwise.svg','image/svg+xml'],
  '/assets/icons/arrow-left.svg':['public/assets/icons/arrow-left.svg','image/svg+xml'],
  '/assets/icons/globe.svg':['public/assets/icons/globe.svg','image/svg+xml'],
  '/assets/icons/x.svg':['public/assets/icons/x.svg','image/svg+xml'],
  '/style.css':['public/style.css','text/css; charset=utf-8'],
  '/assets/home/hero-telescope.webp':['public/assets/home/hero-telescope.webp','image/webp'],
  '/assets/tone-hosts/rational.png':['public/assets/tone-hosts/rational.png','image/png'],
  '/assets/tone-hosts/sharp.png':['public/assets/tone-hosts/sharp.png','image/png'],
  '/assets/tone-hosts/empathy.png':['public/assets/tone-hosts/empathy.png','image/png'],
  '/assets/tone-hosts/humor.png':['public/assets/tone-hosts/humor.png','image/png'],
  '/assets/tone-hosts/realist.png':['public/assets/tone-hosts/realist.png','image/png'],
  '/assets/tone-hosts/longterm.png':['public/assets/tone-hosts/longterm.png','image/png'],
  '/assets/tone-hosts/challenge.png':['public/assets/tone-hosts/challenge.png','image/png'],
  '/assets/tone-hosts/socratic.png':['public/assets/tone-hosts/socratic.png','image/png'],
  '/assets/table/chair.png':['public/assets/table/chair.png','image/png'],
  '/assets/table/tabletop.webp':['public/assets/table/tabletop.webp','image/webp']
};

const CSP="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://*.zhimg.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const DEFAULT_LIVE_DAILY_LIMIT=200;
const DEFAULT_ADVICE_DAILY_LIMIT=600;
const PARTIAL_TTL_MS=3*60*1000;
const QUOTA_MESSAGE='今天的实时检索次数已用完，北京时间 0 点恢复。可以先看看示例。';

function send(res,status,value){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(value));
}

async function readBody(req,max=8192){
  let text='';
  for await(const chunk of req){
    text+=chunk;
    if(Buffer.byteLength(text)>max)throw new Error('请求过大');
  }
  return JSON.parse(text);
}

async function loadSnapshot(topicId){
  const raw=await readFile(new URL(`data/snapshot-${topicId}.json`,root),'utf8');
  return JSON.parse(raw);
}

// 离线样本的对比图由 scripts/build-comparison.mjs 预先生成；没有文件时不展示。
async function loadComparison(topicId){
  try{
    const file=JSON.parse(await readFile(new URL(`data/compare-${topicId}.json`,root),'utf8'));
    return {status:file.status,options:file.options,sides:file.sides,forks:file.forks,builtAt:file.builtAt,offline:true};
  }catch{return null;}
}

// 首页示例问题的离线结果（scripts/save-example.mjs 生成）：点开即出，不消耗实时次数，未配置实时也能看。
async function loadSavedExample(question){
  try{
    const saved=JSON.parse(await readFile(new URL(`data/examples/${askTopic(question,{queries:[]}).id}.json`,root),'utf8'));
    return saved.question===question?saved:null;
  }catch{return null;}
}

function validateRequest(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('请求格式不正确');
  if(typeof input.topicId!=='string')throw new Error('缺少话题');
  const order=input.order??'as-is';
  if(!ORDERS[order])throw new Error('排序方式不合法');
  const mode=input.mode??'snapshot';
  if(!['snapshot','live'].includes(mode))throw new Error('数据模式不合法');
  let situation=null;
  if(input.situation!=null){
    if(typeof input.situation!=='object'||Array.isArray(input.situation))throw new Error('处境格式不正确');
    const entries=Object.entries(input.situation);
    if(entries.length>8)throw new Error('处境字段过多');
    for(const [k,v] of entries){
      if(typeof k!=='string'||k.length>40)throw new Error('处境字段名不合法');
      if(typeof v!=='string'||v.length>40)throw new Error('处境取值不合法');
    }
    situation=Object.fromEntries(entries);
  }
  const conditions=Array.isArray(input.conditions)?input.conditions.slice(0,4):[];
  return {topicId:input.topicId,order,mode,situation,conditions,refresh:input.refresh===true};
}

function validateAsk(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('请求格式不正确');
  return {question:normalizeQuestion(input.question),refresh:input.refresh===true};
}

// 自由提问只在实时凭据齐全且显式开启试用时开放。
function askReady(env){
  return configuration(env).liveReady&&env.ZHIJING_ENABLE_PILOT==='1';
}
// 决策陪伴只需要模型；有知乎凭据时还能补充检索。
function adviceReady(env){
  return configuration(env).modelReady&&env.ZHIJING_ENABLE_PILOT==='1';
}

function validateAdvice(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('请求格式不正确');
  const ref=input.ref;
  let view;
  if(ref?.kind==='sample'&&typeof ref.topicId==='string'&&ref.topicId.length<=40)view={kind:'sample',topicId:ref.topicId};
  else if(ref?.kind==='ask')view={kind:'ask',question:normalizeQuestion(ref.question)};
  else throw new Error('缺少问题');
  const selections=(Array.isArray(input.selections)?input.selections:[]).slice(0,6)
    .filter(s=>Number.isInteger(s?.fork)&&s.fork>=0&&s.fork<10&&(s.branch===0||s.branch===1))
    .map(({fork,branch})=>({fork,branch}));
  const facts=(Array.isArray(input.facts)?input.facts:[]).slice(0,12)
    .map(f=>({key:f?.key,value:typeof f?.value==='string'?f.value.trim():''}))
    .filter(f=>Object.hasOwn(FACT_KEYS,f.key)&&f.value&&f.value.length<=40);
  const history=(Array.isArray(input.history)?input.history:[]).slice(-6)
    .map(h=>({role:h?.role==='assistant'?'assistant':'user',text:typeof h?.text==='string'?h.text.trim().slice(0,400):''}))
    .filter(h=>h.text);
  const message=typeof input.message==='string'?input.message.trim():'';
  if(message.length>300)throw new Error('一次说的话请控制在 300 字以内。');
  const focus=input.focus;
  if(focus!=null&&(typeof focus.recordId!=='string'||!['answer','comment'].includes(focus.kind)||typeof focus.text!=='string'||focus.text.length>4000))throw new Error('原话格式不正确');
  return {view,selections,facts,history,message,tone:typeof input.tone==='string'?input.tone:'',language:input.language==='en'?'en':'zh',
    focus:focus?{recordId:focus.recordId,kind:focus.kind,text:focus.text,commentIndex:focus.commentIndex??null}:null};
}
const sameOrigin=req=>!req.headers.origin||new URL(req.headers.origin).host===req.headers.host;

function incompleteCount(dataset){
  return dataset.records.filter(r=>['failed','partial'].includes(r.analysis?.status)).length;
}

export function createServer(env=process.env,dependencies={fetchTopic,classify}){
  const plan=dependencies.planQuestion||planQuestion;
  const extract=dependencies.extractComparison||extractComparison;
  const store=dependencies.store||createStore(env);
  const oauth=dependencies.oauth||createOAuth(env,{store});
  const advise=dependencies.advise||adviseTurn;
  const infer=dependencies.inferProfile||inferProfile;
  const searchAgent=dependencies.search||searchOne;
  const peersOf=dependencies.findPeers||findPeers;
  const peerCache=new Map(); // 问题 + 情况 → {expires, pending}：同样的情况 15 分钟内复用
  const readCollections=dependencies.fetchCollections||fetchCollections;
  const readContents=dependencies.fetchContents||fetchContents;
  const checkup=dependencies.runCheckup||runCheckup;
  const verify=dependencies.verifyUserApis||verifyUserApis;
  const checkups=new Map(); // 用户标识 → {expires, pending}：同一用户 15 分钟内复用体检结果
  const log=line=>(dependencies.log||console.info)(line);
  let inFlight=0;
  const datasets=new Map();
  const liveBudget=dailyBudget(env.ZHIJING_LIVE_DAILY_LIMIT,DEFAULT_LIVE_DAILY_LIMIT);
  const adviceBudget=dailyBudget(env.ZHIJING_ADVICE_DAILY_LIMIT,DEFAULT_ADVICE_DAILY_LIMIT);
  setInterval(()=>store.sweep().catch(()=>{}),3600*1000).unref();

  async function cached(key,{refresh=false,live=false},produce){
    const hit=datasets.get(key);
    if(hit&&Date.now()<hit.expires&&!(refresh&&hit.partial))return hit.pending;
    if(live&&!liveBudget.take())throw Object.assign(new Error('今日实时检索次数已用完'),{quota:true});
    const entry={expires:Date.now()+15*60*1000};
    entry.pending=produce();
    datasets.set(key,entry);
    try{
      const dataset=await entry.pending;
      // 部分结果短时缓存，避免公开访问时每个访客都重跑模型；「重新分析」带 refresh 可越过。
      if((dataset.meta.failedQueries||incompleteCount(dataset)||dataset.comparison?.status==='failed')&&datasets.get(key)===entry){
        entry.partial=true;entry.expires=Date.now()+PARTIAL_TTL_MS;
      }
      return dataset;
    }
    catch(error){if(datasets.get(key)===entry)datasets.delete(key);throw error;}
  }

  function getDataset(topic,mode,refresh=false){
    return cached(`${topic.id}:${mode}`,{refresh,live:mode==='live'&&configuration(env).liveReady},async()=>{
      if(mode==='snapshot'){
        const snapshot=await loadSnapshot(topic.id);
        return {...snapshot,comparison:await loadComparison(topic.id),meta:{...snapshot.meta,mode}};
      }
      if(!configuration(env).liveReady)throw new Error('实时模式未配置');
      const fetched=await dependencies.fetchTopic(topic,env);
      const records=await dependencies.classify(fetched.records,topic,env);
      return {records,meta:{...fetched.meta,mode,provenance:{
        text:'知乎本次检索原文；最多取每条内容的 3 条精选评论。',
        objections:'模型归类并校验引用来源。引用存在不代表异议关系或内容已被验证。'
      }}};
    });
  }

  function getAnswer(question,refresh){
    return cached(`ask:${question}`,{refresh,live:true},async()=>{
      const planned=await plan(question,env);
      if(planned.kind==='informational')throw Object.assign(new Error('信息查询类问题'),{informational:true});
      const fetched=await dependencies.fetchTopic(askTopic(question,planned),env);
      const topic=widenFocus(askTopic(question,planned),fetched.records);
      // 对比整理与异议归类并行，不增加等待时间。
      const [records,comparison]=await Promise.all([
        dependencies.classify(fetched.records,topic,env),
        extract(fetched.records,topic,env)
      ]);
      const dataset={topic,records,comparison,meta:{...fetched.meta,mode:'live',question,sessionKey:`ask:${question}`,planned:planned.planned,provenance:{
        text:'知乎本次检索原文；最多取每条内容的 3 条精选评论。',
        objections:'模型归类并校验引用来源。引用存在不代表异议关系或内容已被验证。'
      }}};
      // 存一份：15 分钟缓存过期后，决策陪伴仍能按编号取回原话。
      store.saveResult(`ask:${question}`,dataset).catch(()=>log(JSON.stringify({event:'store_failed',op:'saveResult'})));
      return dataset;
    });
  }

  // 决策陪伴要用的材料：示例样本、保存的示例、刚检索过的结果（内存或数据库）。不会为此发起新的检索。
  async function resolveDataset(view){
    if(view.kind==='sample'){
      let topic;
      try{topic=findTopic(topics,view.topicId);}catch{return null;}
      try{return {question:topic.title,dataset:await getDataset(topic,'snapshot')};}catch{return null;}
    }
    const saved=await loadSavedExample(view.question);
    if(saved)return {question:view.question,dataset:saved};
    const hit=datasets.get(`ask:${view.question}`);
    if(hit){try{return {question:view.question,dataset:await hit.pending};}catch{}}
    try{
      const stored=await store.loadResult(`ask:${view.question}`);
      return stored?{question:view.question,dataset:stored}:null;
    }catch{return null;}
  }

  async function handleAdvice(req,res,cookies){
    let input;
    try{input=validateAdvice(await readBody(req,16384));}
    catch(error){return send(res,400,{error:error.message||'输入无效'});}
    if(!adviceReady(env))return send(res,503,{error:'决策陪伴暂未开放。'});
    const found=await resolveDataset(input.view);
    if(!found)return send(res,410,{expired:true,error:'这次检索的结果已经过期，重新检索后再问知镜。'});
    if(found.dataset.comparison?.status!=='complete')return send(res,422,{error:'这个问题没有整理出两边的对比，知镜没法结合原话帮你梳理。'});
    const {user,facts,personalized}=await effectiveFacts(cookies,input.facts);
    if(inFlight>=4)return send(res,429,{error:'当前请求较多，请稍后再试。'});
    if(!adviceBudget.take())return send(res,429,{error:'今天的决策陪伴次数已用完，北京时间 0 点恢复。'});
    inFlight++;
    const started=Date.now();
    try{
      // 补充检索和实时检索共用每日次数。
      const search=configuration(env).zhihuReady?async query=>{
        if(!liveBudget.take())throw Object.assign(new Error('今日实时检索次数已用完'),{quota:true});
        return searchAgent(query,env);
      }:null;
      const result=await advise({...input,question:found.question,facts},found.dataset,env,{search});
      if(personalized){
        store.saveDecision(user.userId,{question:found.question,selections:result.selected.map(({label,when,lean})=>({label,when,lean})),note:result.advice?.text||''})
          .catch(()=>log(JSON.stringify({event:'store_failed',op:'saveDecision'})));
      }
      // 日志不记录用户的话、情况和原话。
      log(JSON.stringify({event:'advice',durationMs:Date.now()-started,points:result.points.length,
        speculative:result.points.filter(p=>p.basis==='speculation').length,counterpoints:result.counterpoints.length,
        proposals:result.factProposals.length,searched:!!result.search,found:result.search?.found?.length??0,dropped:result.dropped??0,facts:facts.length,personalized}));
      const {dropped,...body}=result;
      return send(res,200,{...body,personalized,factsUsed:facts.length});
    }catch(error){
      log(JSON.stringify({event:'advice_failed',durationMs:Date.now()-started,reason:error.reason||'upstream'}));
      return send(res,503,{error:'知镜这次没能想完，请稍后再试。'});
    }finally{inFlight--;}
  }

  // 打开了「记住我的情况」的登录用户，以数据库里确认过的情况为准；其余用户用页面上当次填写的情况。
  async function effectiveFacts(cookies,clientFacts){
    const user=oauth.available?await oauth.current(cookies):null;
    if(!user?.userId)return {user,facts:clientFacts,personalized:false};
    const account=await store.getUser(user.userId).catch(()=>null);
    if(!account?.personalize)return {user,facts:clientFacts,personalized:false};
    const facts=(await store.listFacts(user.userId)).filter(f=>f.status==='confirmed').slice(0,12).map(({key,value})=>({key,value}));
    return {user,facts,personalized:true};
  }

  // 找同路人：按用户的情况（先用他说的，再用他选的条件，最多 3 条）去知乎找处境相似的人。
  async function handlePeers(req,res,cookies){
    let input;
    try{input=validateAdvice(await readBody(req,16384));}
    catch(error){return send(res,400,{error:error.message||'输入无效'});}
    if(!adviceReady(env))return send(res,503,{error:'找同路人暂未开放。'});
    const found=await resolveDataset(input.view);
    if(!found)return send(res,410,{expired:true,error:'这次检索的结果已经过期，重新检索后再找。'});
    const block=found.dataset.comparison;
    if(block?.status!=='complete')return send(res,422,{error:'这个问题没有整理出两边的对比，没法找同路人。'});
    const {facts}=await effectiveFacts(cookies,input.facts);
    const situations=[
      ...facts.map((f,i)=>({id:'f'+i,label:FACT_KEYS[f.key],value:f.value})),
      ...input.selections.map(({fork,branch},i)=>{
        const f=block.forks[fork],b=f?.branches?.[branch];
        return b?{id:'c'+i,label:f.label,value:situationValue(f,b)}:null;
      }).filter(Boolean)
    ].slice(0,MAX_SITUATIONS);
    if(!situations.length)return send(res,400,{error:'先补充一条你的情况，或者在上面选一个更接近你的条件。'});
    const key=JSON.stringify([found.question,situations,found.dataset.comparison]);
    const hit=peerCache.get(key);
    if(hit&&Date.now()<hit.expires){
      try{const {dropped,...body}=await hit.pending;return send(res,200,{...body,cached:true});}catch{}
    }
    if(inFlight>=4)return send(res,429,{error:'当前请求较多，请稍后再试。'});
    if(!adviceBudget.take())return send(res,429,{error:'今天的次数已用完，北京时间 0 点恢复。'});
    inFlight++;
    const started=Date.now();
    if(peerCache.size>200)for(const [k,v] of peerCache)if(v.expires<Date.now())peerCache.delete(k);
    const search=configuration(env).zhihuReady?async query=>{
      if(!liveBudget.take())throw Object.assign(new Error('今日实时检索次数已用完'),{quota:true});
      return searchAgent(query,env);
    }:null;
    const entry={expires:Date.now()+15*60*1000};
    entry.pending=(async()=>({...await peersOf({question:found.question,options:block.options,situations},found.dataset,env,{search}),situations}))();
    peerCache.set(key,entry);
    try{
      const result=await entry.pending;
      // 空结果、部分失败和限额结果不进入成功缓存，允许再试。
      if((!result.peers.length||result.failed||result.quota)&&peerCache.get(key)===entry)peerCache.delete(key);
      // 日志不记录用户情况与原话。
      log(JSON.stringify({event:'peers',durationMs:Date.now()-started,situations:situations.length,queries:result.queries.length,searched:result.searched,
        peers:result.peers.length,fromDataset:result.peers.filter(p=>p.source.fromDataset).length,failed:result.failed,quota:!!result.quota,dropped:result.dropped??0}));
      const {dropped,...body}=result;
      return send(res,200,body);
    }catch(error){
      if(peerCache.get(key)===entry)peerCache.delete(key);
      log(JSON.stringify({event:'peers_failed',durationMs:Date.now()-started,reason:error.reason||'upstream'}));
      return send(res,503,{error:'这次没找成，请稍后再试。'});
    }finally{inFlight--;}
  }

  // 「我的情况」：只对读到了知乎资料的登录用户开放；打开「记住我的情况」后才写入数据库。
  async function handleProfile(req,res,url,cookies){
    if(req.method!=='GET'&&!sameOrigin(req))return send(res,403,{error:'请求来源不匹配'});
    if(req.method==='POST'&&!req.headers['content-type']?.startsWith('application/json'))return send(res,415,{error:'请发送 JSON 请求'});
    const user=oauth.available?await oauth.current(cookies):null;
    if(!user)return send(res,401,{error:'请先用知乎登录。',relogin:true});
    if(!user.userId)return send(res,409,{error:'没读到你的知乎资料，暂时不能保存你的情况。'});
    const id=user.userId;
    const snapshot=async()=>{
      const account=await store.getUser(id);
      const on=!!account?.personalize;
      return {personalize:on,consentAt:account?.consentAt||null,facts:on?await store.listFacts(id):[],decisions:on?await store.listDecisions(id):[]};
    };
    try{
      if(req.method==='GET'&&url.pathname==='/api/profile')return send(res,200,await snapshot());
      if(req.method==='DELETE'&&url.pathname==='/api/profile'){
        await store.deleteUser(id);
        log(JSON.stringify({event:'profile_deleted'}));
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Set-Cookie':await oauth.end(cookies)});
        return res.end('{"ok":true}');
      }
      if(req.method==='POST'&&url.pathname==='/api/profile/personalize'){
        const on=(await readBody(req))?.on===true;
        await store.setPersonalize(id,on);
        log(JSON.stringify({event:'personalize',on}));
        return send(res,200,await snapshot());
      }
      if(req.method==='POST'&&url.pathname==='/api/profile/facts'){
        const body=await readBody(req);
        if(!(await store.getUser(id))?.personalize)return send(res,409,{error:'先打开「记住我的情况」。'});
        if(body?.action==='add'){
          const key=Object.hasOwn(FACT_KEYS,body.key)?body.key:null;
          const value=typeof body.value==='string'?body.value.trim():'';
          if(!key||!value||value.length>40)return send(res,400,{error:'情况请写 1–40 个字。'});
          await store.addFact(id,{key,value,source:'declared',status:'confirmed',evidenceRef:typeof body.evidenceRef==='string'?body.evidenceRef.slice(0,200):''});
        }else if(body?.action==='confirm'){
          if(!await store.confirmFact(id,String(body.id)))return send(res,404,{error:'这条情况不存在或已过期。'});
        }else if(body?.action==='delete'){
          await store.deleteFact(id,String(body.id));
        }else return send(res,400,{error:'不支持的操作'});
        return send(res,200,await snapshot());
      }
      if(req.method==='POST'&&url.pathname==='/api/profile/infer'){
        const token=oauth.accessToken(cookies);
        if(!token)return send(res,401,{error:'知乎授权已过期（有效期 1 小时），重新登录后才能读取收藏。',relogin:true});
        if(!adviceReady(env)||!configuration(env).zhihuReady)return send(res,503,{error:'暂时不能读取收藏。'});
        if(!adviceBudget.take())return send(res,429,{error:'今天的次数已用完，北京时间 0 点恢复。'});
        let items;
        try{items=await readCollections(env,token);}
        catch(error){
          if(error.reason==='auth'){oauth.dropToken(cookies);return send(res,401,{error:'知乎授权已失效，请重新登录。',relogin:true});}
          return send(res,503,{error:'暂时读不到你的收藏，请稍后再试。'});
        }
        let proposals;
        try{proposals=await infer(items,env);}
        catch{return send(res,503,{error:'这次没能推测出来，请稍后再试。'});}
        const on=!!(await store.getUser(id))?.personalize;
        if(on)for(const p of proposals)await store.addFact(id,{key:p.key,value:p.value,source:'inferred',status:'pending',evidenceRef:p.evidenceRef}).catch(()=>{});
        log(JSON.stringify({event:'infer',collections:items.length,proposals:proposals.length,saved:on}));
        return send(res,200,{proposals,...await snapshot()});
      }
      return send(res,404,{error:'未找到页面'});
    }catch(error){
      if(error.reason==='limit')return send(res,409,{error:'记下的情况已经很多了，先删掉一些再加。'});
      log(JSON.stringify({event:'profile_failed'}));
      return send(res,503,{error:'暂时存不了，请稍后再试。'});
    }
  }

  async function handleAsk(req,res){
    let input;
    try{input=validateAsk(await readBody(req));}
    catch(error){return send(res,400,{error:error.message||'输入无效'});}
    const saved=input.refresh?null:await loadSavedExample(input.question);
    if(saved){
      log(JSON.stringify({event:'ask_saved',records:saved.records.length}));
      return send(res,200,{...buildReadingMap(saved.records,{topic:saved.topic,order:'attention',meta:{
        ...saved.meta,saved:true,savedAt:saved.savedAt,question:input.question,sessionKey:`ask:${input.question}`
      }}),comparison:saved.comparison});
    }
    if(!askReady(env))return send(res,503,{error:'实时检索暂未开放，可以先看看示例。'});
    if(inFlight>=4)return send(res,429,{error:'当前请求较多，请稍后再试。'});
    inFlight++;
    const requestId=randomUUID();
    const started=Date.now();
    res.setHeader('X-Request-ID',requestId);
    try{
      const dataset=await getAnswer(input.question,input.refresh);
      // 日志不记录问题原文、正文或评论。
      log(JSON.stringify({event:'ask',requestId,durationMs:Date.now()-started,records:dataset.records.length,incomplete:incompleteCount(dataset),failedQueries:dataset.meta.failedQueries||0,planned:dataset.meta.planned,comparison:dataset.comparison?.status||null,forks:dataset.comparison?.forks.length??0}));
      return send(res,200,{...buildReadingMap(dataset.records,{topic:dataset.topic,order:'attention',meta:{...dataset.meta,requestId,pilot:true}}),comparison:dataset.comparison||null});
    }catch(error){
      const reason=error.quota?'quota':error.informational?'informational':error.empty?'empty':'upstream';
      log(JSON.stringify({event:'ask_failed',requestId,durationMs:Date.now()-started,reason}));
      if(error.quota)return send(res,429,{error:QUOTA_MESSAGE});
      if(error.informational)return send(res,422,{informational:true,error:'这个问题更像查资料（政策、流程、数据），答案由规定决定，评论区很少有人争论，知镜帮不上忙。换一个需要做选择、想听听别人经验的问题试试。'});
      if(error.empty)return send(res,404,{error:'知乎上没搜到相关回答。换个说法试试，比如写成「A 还是 B」。'});
      return send(res,503,{error:'实时检索或模型分析暂不可用，请稍后重试，或先看看示例。系统没有用示例替换本次结果。'});
    }finally{inFlight--;}
  }

  return http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',CSP);
    const url=new URL(req.url,'http://localhost');
    try{
      if(req.method==='GET'&&url.pathname==='/api/health'){
        return send(res,200,{status:'ok'});
      }
      // ── 知乎登录 ──
      if(req.method==='GET'&&url.pathname==='/auth/login'){
        if(!oauth.available)return send(res,503,{error:'知乎登录暂未开放。'});
        const {location,cookie}=oauth.begin();
        res.writeHead(302,{Location:location,'Set-Cookie':cookie,'Cache-Control':'no-store'});
        return res.end();
      }
      if(req.method==='GET'&&oauth.available&&url.pathname===oauth.callbackPath
        &&['state','authorization_code','code'].some(key=>url.searchParams.has(key))){
        try{
          const {cookies,user,stateReturned}=await oauth.complete(url.searchParams,parseCookies(req.headers.cookie));
          log(JSON.stringify({event:'login',stateReturned,profile:!user.profileMissing}));
          res.writeHead(302,{Location:'/?login=ok','Set-Cookie':cookies,'Cache-Control':'no-store'});
        }catch(error){
          log(JSON.stringify({event:'login_failed',reason:error.reason||'upstream'}));
          res.writeHead(302,{Location:'/?login=failed','Set-Cookie':oauth.clearLoginCookie(),'Cache-Control':'no-store'});
        }
        return res.end();
      }
      if(req.method==='GET'&&url.pathname==='/api/me'){
        const user=oauth.available?await oauth.current(parseCookies(req.headers.cookie)):null;
        return send(res,200,{available:oauth.available,user:user?{name:user.name,headline:user.headline,avatar:user.avatar,canRemember:!!user.userId}:null});
      }
      // ── 登录用户的收藏：读取（从收藏里挑问题）与体检（评论区有没有人当场不同意） ──
      if((req.method==='GET'&&['/api/my/collections','/api/my/verify'].includes(url.pathname))||(req.method==='POST'&&url.pathname==='/api/my/checkup')){
        if(req.method==='POST'&&req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return send(res,403,{error:'请求来源不匹配'});
        const cookies=parseCookies(req.headers.cookie);
        const user=oauth.available?await oauth.current(cookies):null;
        if(!user)return send(res,401,{error:'请先用知乎登录。',relogin:true});
        const token=oauth.accessToken(cookies);
        if(!token)return send(res,401,{error:'知乎授权已过期（有效期 1 小时），重新登录后才能读取收藏。',relogin:true});
        if(!configuration(env).zhihuReady)return send(res,503,{error:'读取收藏暂不可用。'});
        const authFailed=()=>{oauth.dropToken(cookies);return send(res,401,{error:'知乎授权已失效，请重新登录。',relogin:true});};

        if(url.pathname==='/api/my/collections'){
          try{
            const items=await readCollections(env,token);
            log(JSON.stringify({event:'collections',count:items.length}));
            return send(res,200,{items:items.map(({summary,...rest})=>rest)});
          }catch(error){
            log(JSON.stringify({event:'collections_failed',reason:error.reason||'upstream'}));
            return error.reason==='auth'?authFailed():send(res,503,{error:'暂时读不到你的收藏，请稍后再试。'});
          }
        }

        if(url.pathname==='/api/my/verify'){
          const results=await verify(env,token);
          log(JSON.stringify({event:'verify',results:results.map(r=>`${r.id}:${r.status}`)}));
          const relogin=results.some(r=>[20001,401,403].includes(r.code));
          if(relogin)oauth.dropToken(cookies);
          return send(res,200,{results,relogin});
        }

        // 体检对象：近期收藏（默认），或本人发过的内容（答主视角）。
        if(!req.headers['content-type']?.startsWith('application/json'))return send(res,415,{error:'请发送 JSON 请求'});
        let source='collections',refresh=false;
        try{
          const input=await readBody(req);
          if(!input||typeof input!=='object'||Array.isArray(input)||!['collections','contents'].includes(input.source??'collections'))throw new Error();
          source=input.source??'collections';refresh=input.refresh===true;
        }catch{return send(res,400,{error:'体检对象无效，请选择收藏或本人内容。'});}
        if(!askReady(env))return send(res,503,{error:'体检暂未开放。'});
        // 读不到资料的用户没有 uid：按会话区分，避免体检结果串到别人身上；两种体检分开缓存。
        const key=source+':'+(user.uid||user.hashId||('sid:'+cookies.zj_sid));
        const hit=checkups.get(key);
        if(hit&&Date.now()<hit.expires&&!(refresh&&hit.partial)){
          try{return send(res,200,await hit.pending);}catch{}
        }
        if(inFlight>=4)return send(res,429,{error:'当前请求较多，请稍后再试。'});
        if(!liveBudget.take())return send(res,429,{error:QUOTA_MESSAGE});
        inFlight++;
        const started=Date.now();
        const entry={expires:Date.now()+15*60*1000};
        entry.pending=(async()=>({...await checkup(await (source==='contents'?readContents:readCollections)(env,token),env),source}))();
        checkups.set(key,entry);
        try{
          const result=await entry.pending;
          entry.partial=!!result.incomplete;
          if(entry.partial)entry.expires=Date.now()+PARTIAL_TTL_MS;
          log(JSON.stringify({event:'checkup',source,durationMs:Date.now()-started,checked:result.checked,matched:result.matched,pushback:result.pushback}));
          return send(res,200,result);
        }catch(error){
          if(checkups.get(key)===entry)checkups.delete(key);
          log(JSON.stringify({event:'checkup_failed',reason:error.reason||'upstream'}));
          return error.reason==='auth'?authFailed():send(res,503,{error:'收藏体检暂时不可用，请稍后再试。'});
        }finally{inFlight--;}
      }
      if(url.pathname==='/api/profile'||url.pathname.startsWith('/api/profile/')){
        return await handleProfile(req,res,url,parseCookies(req.headers.cookie));
      }
      if(req.method==='POST'&&(url.pathname==='/api/advice'||url.pathname==='/api/peers')){
        if(!sameOrigin(req))return send(res,403,{error:'请求来源不匹配'});
        if(!req.headers['content-type']?.startsWith('application/json'))return send(res,415,{error:'请发送 JSON 请求'});
        const cookies=parseCookies(req.headers.cookie);
        return url.pathname==='/api/peers'?await handlePeers(req,res,cookies):await handleAdvice(req,res,cookies);
      }
      if(req.method==='POST'&&url.pathname==='/auth/logout'){
        if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return send(res,403,{error:'请求来源不匹配'});
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Set-Cookie':await oauth.end(parseCookies(req.headers.cookie))});
        return res.end('{"ok":true}');
      }
      if(req.method==='GET'&&url.pathname==='/api/usage')return send(res,200,{
        scope:'process',timezone:'Asia/Shanghai',upstreamQuota:null,
        note:'本进程调用预算，重启清零；不是知乎平台剩余额度。实时分析或体检每次计一，陪伴补搜每次计一；缓存命中不计。',
        live:liveBudget.snapshot(),advice:adviceBudget.snapshot()
      });
      if(req.method==='GET'&&url.pathname==='/api/config'){
        const config=configuration(env);
        return send(res,200,{
          liveReady:config.liveReady&&topics.some(t=>liveTopicEnabled(t,env)),
          askReady:askReady(env),
          adviceReady:adviceReady(env),
          pilotEnabled:env.ZHIJING_ENABLE_PILOT==='1',
          zhihuReady:config.zhihuReady,
          modelReady:config.modelReady,
          orders:Object.values(ORDERS),
          topics:await Promise.all(topics.map(async topic=>{
            let snapshot=false;
            try{await loadSnapshot(topic.id);snapshot=topic.kind==='opinion';}catch{}
            return {...topicSummary(topic),availability:{snapshot,
              live:liveTopicEnabled(topic,env)&&config.liveReady,
              note:topic.kind==='informational'?'不适用于评论异议分析':snapshot?'可阅读离线样本':'样本准备中',
              liveNote:!liveTopicEnabled(topic,env)?'实时话题尚未开放验收':!config.liveReady?'实时服务未配置':topic.liveStatus==='pilot'?'内部试用，效果尚未验收':'实时可用'}};
          })),
          version:'0.2.0'
        });
      }
      if(req.method==='POST'&&(url.pathname==='/api/reading-map'||url.pathname==='/api/ask')){
        if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host){
          return send(res,403,{error:'请求来源不匹配'});
        }
        if(!req.headers['content-type']?.startsWith('application/json')){
          return send(res,415,{error:'请发送 JSON 请求'});
        }
        if(url.pathname==='/api/ask')return await handleAsk(req,res);

        let input;
        try{input=validateRequest(await readBody(req));}
        catch(error){return send(res,400,{error:error.message||'输入无效'});}

        let topic;
        try{topic=findTopic(topics,input.topicId);}
        catch{return send(res,404,{error:'未找到该话题'});}

        if(topic.kind==='informational'){
          return send(res,422,{error:'本引擎只适用于观点/经验型问题。信息/政策型问题的精选评论覆盖仅约 14%，无法支撑三态标记。'});
        }
        if(input.mode==='live'&&!liveTopicEnabled(topic,env))return send(res,422,{error:'该话题尚未通过实时开放门槛，请阅读可用离线样本。'});
        if(inFlight>=4)return send(res,429,{error:'当前请求较多，请稍后再试。'});
        inFlight++;
        const requestId=randomUUID();
        const started=Date.now();
        res.setHeader('X-Request-ID',requestId);
        try{
          const dataset=await getDataset(topic,input.mode,input.refresh);
          log(JSON.stringify({event:'reading_map',requestId,topicId:topic.id,mode:input.mode,durationMs:Date.now()-started,records:dataset.records.length,incomplete:incompleteCount(dataset),failedQueries:dataset.meta.failedQueries||0}));
          return send(res,200,{...buildReadingMap(dataset.records,{
            topic,
            situation:input.situation,
            order:input.order,
            conditions:input.conditions,
            meta:{...dataset.meta,requestId,pilot:input.mode==='live'&&topic.liveStatus==='pilot'}
          }),comparison:dataset.comparison||null});
        }catch(error){
          log(JSON.stringify({event:'reading_map_failed',requestId,topicId:topic.id,mode:input.mode,durationMs:Date.now()-started}));
          if(error.quota)return send(res,429,{error:QUOTA_MESSAGE});
          const liveHint=input.mode==='live'
            ?'实时检索或模型分析暂不可用。请检查服务端凭据与额度，或切换到精选样本。系统没有替换本次结果。'
            :'这个话题的样本暂不可用，请选择有离线样本的话题，或稍后重试。';
          return send(res,503,{error:liveHint});
        }finally{inFlight--;}
      }
      if(req.method==='GET'&&FILES[url.pathname]){
        const [file,type]=FILES[url.pathname];
        res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache'});
        return res.end(await readFile(new URL(file,root)));
      }
      send(res,404,{error:'未找到页面'});
    }catch{
      if(!res.headersSent)send(res,400,{error:'无法处理请求'});
      else res.end();
    }
  });
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||4318);
  const host=process.env.HOST||'127.0.0.1';
  const store=createStore(process.env);
  store.init().then(()=>console.log(`用户信息存储：${store.kind==='postgres'?'PostgreSQL 已连接':'内存（未配置 DATABASE_URL，重启即清空）'}`))
    .catch(error=>console.error('数据库连接失败：'+String(error.message).slice(0,200)));
  createServer(process.env,{fetchTopic,classify,store}).listen(port,host,()=>{
    const config=configuration();
    console.log(`知镜已启动 http://${host}:${port} · 话题 ${topics.length} 个 · 精选样本可用 · 实时模式${config.liveReady?'已配置':'未配置'} · 自由提问${askReady(process.env)?'已开放':'未开放'} · 决策陪伴${adviceReady(process.env)?'已开放':'未开放'}`);
  });
}
