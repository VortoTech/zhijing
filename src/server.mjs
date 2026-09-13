import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {loadTopics,findTopic,topicSummary,liveTopicEnabled} from './topics.mjs';
import {configuration} from './pipeline/fetch.mjs';
import {fetchTopic} from './pipeline/fetch.mjs';
import {classify} from './pipeline/classify.mjs';
import {buildReadingMap,ORDERS} from './engine.mjs';
import {normalizeQuestion,planQuestion,askTopic,widenFocus} from './ask.mjs';
import {extractComparison} from './pipeline/compare.mjs';
import {createOAuth,parseCookies} from './oauth.mjs';
import {fetchCollections,runCheckup,verifyUserApis} from './userdata.mjs';

const root=new URL('../',import.meta.url);
const topics=await loadTopics();

const FILES={
  '/':['public/index.html','text/html; charset=utf-8'],
  '/app.js':['public/app.js','text/javascript; charset=utf-8'],
  '/engine.js':['src/engine.mjs','text/javascript; charset=utf-8'],
  '/session.js':['public/session.js','text/javascript; charset=utf-8'],
  '/style.css':['public/style.css','text/css; charset=utf-8']
};

const CSP="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://*.zhimg.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const DEFAULT_LIVE_DAILY_LIMIT=200;
const PARTIAL_TTL_MS=3*60*1000;
const QUOTA_MESSAGE='今天的实时检索次数已用完，北京时间 0 点恢复。可以先看看示例。';

// 每次真正触发检索与模型的实时请求计一次，按北京时间自然日清零；缓存命中不计。
function dailyBudget(raw){
  const parsed=Number.parseInt(raw,10);
  const limit=parsed>0?parsed:DEFAULT_LIVE_DAILY_LIMIT;
  let day='',used=0;
  return {take(){
    const today=new Date(Date.now()+8*3600*1000).toISOString().slice(0,10);
    if(today!==day){day=today;used=0;}
    if(used>=limit)return false;
    used++;return true;
  }};
}

function send(res,status,value){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(value));
}

async function readBody(req){
  let text='';
  for await(const chunk of req){
    text+=chunk;
    if(Buffer.byteLength(text)>8192)throw new Error('请求过大');
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

function incompleteCount(dataset){
  return dataset.records.filter(r=>['failed','partial'].includes(r.analysis?.status)).length;
}

export function createServer(env=process.env,dependencies={fetchTopic,classify}){
  const plan=dependencies.planQuestion||planQuestion;
  const extract=dependencies.extractComparison||extractComparison;
  const oauth=dependencies.oauth||createOAuth(env);
  const readCollections=dependencies.fetchCollections||fetchCollections;
  const checkup=dependencies.runCheckup||runCheckup;
  const verify=dependencies.verifyUserApis||verifyUserApis;
  const checkups=new Map(); // 用户标识 → {expires, pending}：同一用户 15 分钟内复用体检结果
  const log=line=>(dependencies.log||console.info)(line);
  let inFlight=0;
  const datasets=new Map();
  const liveBudget=dailyBudget(env.ZHIJING_LIVE_DAILY_LIMIT);

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
      return {topic,records,comparison,meta:{...fetched.meta,mode:'live',question,sessionKey:`ask:${question}`,planned:planned.planned,provenance:{
        text:'知乎本次检索原文；最多取每条内容的 3 条精选评论。',
        objections:'模型归类并校验引用来源。引用存在不代表异议关系或内容已被验证。'
      }}};
    });
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
        const user=oauth.available?oauth.current(parseCookies(req.headers.cookie)):null;
        return send(res,200,{available:oauth.available,user:user?{name:user.name,headline:user.headline,avatar:user.avatar}:null});
      }
      // ── 登录用户的收藏：读取（从收藏里挑问题）与体检（评论区有没有人当场不同意） ──
      if((req.method==='GET'&&['/api/my/collections','/api/my/verify'].includes(url.pathname))||(req.method==='POST'&&url.pathname==='/api/my/checkup')){
        if(req.method==='POST'&&req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return send(res,403,{error:'请求来源不匹配'});
        const cookies=parseCookies(req.headers.cookie);
        const user=oauth.available?oauth.current(cookies):null;
        if(!user)return send(res,401,{error:'请先用知乎登录。'});
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
          if(results.some(r=>r.code===20001))oauth.dropToken(cookies);
          return send(res,200,{results});
        }

        if(!askReady(env))return send(res,503,{error:'收藏体检暂未开放。'});
        // 读不到资料的用户没有 uid：按会话区分，避免体检结果串到别人身上。
        const key=user.uid||user.hashId||('sid:'+cookies.zj_sid);
        const hit=checkups.get(key);
        if(hit&&Date.now()<hit.expires){
          try{return send(res,200,await hit.pending);}catch{}
        }
        if(inFlight>=4)return send(res,429,{error:'当前请求较多，请稍后再试。'});
        if(!liveBudget.take())return send(res,429,{error:QUOTA_MESSAGE});
        inFlight++;
        const started=Date.now();
        const entry={expires:Date.now()+15*60*1000};
        entry.pending=(async()=>checkup(await readCollections(env,token),env))();
        checkups.set(key,entry);
        try{
          const result=await entry.pending;
          log(JSON.stringify({event:'checkup',durationMs:Date.now()-started,checked:result.checked,matched:result.matched,pushback:result.pushback}));
          return send(res,200,result);
        }catch(error){
          if(checkups.get(key)===entry)checkups.delete(key);
          log(JSON.stringify({event:'checkup_failed',reason:error.reason||'upstream'}));
          return error.reason==='auth'?authFailed():send(res,503,{error:'收藏体检暂时不可用，请稍后再试。'});
        }finally{inFlight--;}
      }
      if(req.method==='POST'&&url.pathname==='/auth/logout'){
        if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return send(res,403,{error:'请求来源不匹配'});
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Set-Cookie':oauth.end(parseCookies(req.headers.cookie))});
        return res.end('{"ok":true}');
      }
      if(req.method==='GET'&&url.pathname==='/api/config'){
        const config=configuration(env);
        return send(res,200,{
          liveReady:config.liveReady&&topics.some(t=>liveTopicEnabled(t,env)),
          askReady:askReady(env),
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
  createServer().listen(port,host,()=>{
    const config=configuration();
    console.log(`知镜已启动 http://${host}:${port} · 话题 ${topics.length} 个 · 精选样本可用 · 实时模式${config.liveReady?'已配置':'未配置'} · 自由提问${askReady(process.env)?'已开放':'未开放'}`);
  });
}
