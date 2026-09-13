import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {loadTopics,findTopic,topicSummary,liveTopicEnabled} from './topics.mjs';
import {configuration} from './pipeline/fetch.mjs';
import {fetchTopic} from './pipeline/fetch.mjs';
import {classify} from './pipeline/classify.mjs';
import {buildReadingMap,ORDERS} from './engine.mjs';

const root=new URL('../',import.meta.url);
const topics=await loadTopics();

const FILES={
  '/':['public/index.html','text/html; charset=utf-8'],
  '/app.js':['public/app.js','text/javascript; charset=utf-8'],
  '/engine.js':['src/engine.mjs','text/javascript; charset=utf-8'],
  '/session.js':['public/session.js','text/javascript; charset=utf-8'],
  '/style.css':['public/style.css','text/css; charset=utf-8']
};

const CSP="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

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
  return {topicId:input.topicId,order,mode,situation,conditions};
}

export function createServer(env=process.env,dependencies={fetchTopic,classify}){
  let inFlight=0;
  const datasets=new Map();
  async function getDataset(topic,mode){
    const key=`${topic.id}:${mode}`;
    const hit=datasets.get(key);
    if(hit&&Date.now()<hit.expires)return hit.pending;
    const entry={expires:Date.now()+15*60*1000};
    entry.pending=(async()=>{
      if(mode==='snapshot'){
        const snapshot=await loadSnapshot(topic.id);
        return {...snapshot,meta:{...snapshot.meta,mode}};
      }
      if(!configuration(env).liveReady)throw new Error('实时模式未配置');
      const fetched=await dependencies.fetchTopic(topic,env);
      const records=await dependencies.classify(fetched.records,topic,env);
      return {records,meta:{...fetched.meta,mode,provenance:{
        text:'知乎本次检索原文；最多取每条内容的 3 条精选评论。',
        objections:'模型归类并校验引用来源。引用存在不代表异议关系或内容已被验证。'
      }}};
    })();
    datasets.set(key,entry);
    try{
      const dataset=await entry.pending;
      if((dataset.meta.failedQueries||dataset.records.some(r=>['failed','partial'].includes(r.analysis?.status)))&&datasets.get(key)===entry)datasets.delete(key);
      return dataset;
    }
    catch(error){if(datasets.get(key)===entry)datasets.delete(key);throw error;}
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
      if(req.method==='GET'&&url.pathname==='/api/config'){
        const config=configuration(env);
        return send(res,200,{
          liveReady:config.liveReady&&topics.some(t=>liveTopicEnabled(t,env)),
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
          version:'0.1.0'
        });
      }
      if(req.method==='POST'&&url.pathname==='/api/reading-map'){
        if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host){
          return send(res,403,{error:'请求来源不匹配'});
        }
        if(!req.headers['content-type']?.startsWith('application/json')){
          return send(res,415,{error:'请发送 JSON 请求'});
        }
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
          const dataset=await getDataset(topic,input.mode);
          const incomplete=dataset.records.filter(r=>['failed','partial'].includes(r.analysis?.status)).length;
          (dependencies.log||console.info)(JSON.stringify({event:'reading_map',requestId,topicId:topic.id,mode:input.mode,durationMs:Date.now()-started,records:dataset.records.length,incomplete,failedQueries:dataset.meta.failedQueries||0}));
          return send(res,200,buildReadingMap(dataset.records,{
            topic,
            situation:input.situation,
            order:input.order,
            conditions:input.conditions,
            meta:{...dataset.meta,requestId,pilot:input.mode==='live'&&topic.liveStatus==='pilot'}
          }));
        }catch(error){
          (dependencies.log||console.info)(JSON.stringify({event:'reading_map_failed',requestId,topicId:topic.id,mode:input.mode,durationMs:Date.now()-started}));
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
    console.log(`知镜已启动 http://${host}:${port} · 话题 ${topics.length} 个 · 精选样本可用 · 实时模式${config.liveReady?'已配置':'未配置'}`);
  });
}
