import {createHash} from 'node:crypto';
import {dedupe} from './extract.mjs';

const ZHIHU_SEARCH='https://developer.zhihu.com/api/v1/content/zhihu_search';
const CACHE_TTL_MS=15*60*1000;
const MAX_RESPONSE_BYTES=2_000_000;
const COUNT_PER_QUERY=10;
const QUERY_SPACING_MS=700;

const cache=new Map();

export function configuration(env=process.env){
  return {
    zhihuReady:!!env.ZHIHU_ACCESS_SECRET,
    modelReady:!!(env.AI_BASE_URL&&env.AI_API_KEY&&env.AI_MODEL),
    get liveReady(){return this.zhihuReady&&this.modelReady;}
  };
}

export async function getJSON(url,options={}){
  const response=await fetch(url,{
    ...options,
    redirect:'error',
    signal:AbortSignal.any([AbortSignal.timeout(25_000),...(options.signal?[options.signal]:[])])
  });
  if(!response.ok){
    await response.body?.cancel();
    throw Object.assign(new Error('上游请求失败'),{status:response.status});
  }
  const reader=response.body.getReader();
  const chunks=[];let bytes=0;
  try{
    while(true){
      const {done,value}=await reader.read();if(done)break;
      bytes+=value.byteLength;
      if(bytes>MAX_RESPONSE_BYTES){await reader.cancel();throw new Error('上游响应过大');}
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function searchOne(query,env){
  const url=new URL(ZHIHU_SEARCH);
  url.search=new URLSearchParams({Query:query,Count:String(COUNT_PER_QUERY)});
  const body=await getJSON(url,{
    headers:{
      Authorization:`Bearer ${env.ZHIHU_ACCESS_SECRET}`,
      'X-Request-Timestamp':String(Math.floor(Date.now()/1000))
    }
  });
  if(body.Code===30001)throw Object.assign(new Error('知乎检索限流'),{rateLimited:true});
  if(body.Code!==0||!Array.isArray(body.Data?.Items)){
    throw new Error(body.Message?`知乎检索失败：${body.Message}`:'知乎检索失败或额度不可用');
  }
  return body.Data.Items;
}

function cacheKey(topic,env){
  return createHash('sha256')
    .update([topic.id,topic.queries.join('|'),env.ZHIHU_ACCESS_SECRET].join('|'))
    .digest('hex');
}

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// 知乎检索按频率限流：8 路并发只成功 2 路（Code 30001），逐路间隔发送则全部成功。
async function searchPaced(queries,env,search,spacingMs){
  const settled=[];
  for(const [i,q] of queries.entries()){
    if(i)await sleep(spacingMs);
    try{settled.push({status:'fulfilled',value:await search(q,env)});}
    catch(error){
      if(!error.rateLimited){settled.push({status:'rejected',reason:error});continue;}
      await sleep(spacingMs*2);
      try{settled.push({status:'fulfilled',value:await search(q,env)});}
      catch(retryError){settled.push({status:'rejected',reason:retryError});}
    }
  }
  return settled;
}

export async function fetchTopic(topic,env=process.env,{queries=null,search=searchOne,spacingMs=search===searchOne?QUERY_SPACING_MS:0}={}){
  const config=configuration(env);
  if(!config.zhihuReady)throw new Error('实时检索尚未配置：缺少 ZHIHU_ACCESS_SECRET。请使用精选样本，或在服务端补齐凭据。');

  const key=cacheKey({...topic,queries:queries||topic.queries},env);
  const hit=cache.get(key);
  if(hit&&hit.value&&Date.now()-hit.at<CACHE_TTL_MS){
    return {...hit.value,meta:{...hit.value.meta,cached:true}};
  }
  if(hit?.pending)return hit.pending;

  const useQueries=queries||topic.queries;
  const pending=(async()=>{
    const batches=await searchPaced(useQueries,env,search,spacingMs);
    const failedQueries=batches.filter(b=>b.status==='rejected').length;
    const flat=batches.filter(b=>b.status==='fulfilled').flatMap(b=>b.value);
    const records=dedupe(flat,{limit:60});
    if(!records.length)throw new Error('本次没有检索到可用内容');
    const value={
      records,
      meta:{
        mode:'live',
        topicId:topic.id,
        capturedAt:new Date().toISOString(),
        queryCount:useQueries.length,
        successfulQueries:useQueries.length-failedQueries,
        failedQueries,
        upstreamCount:flat.length,
        selectedCount:records.length,
        commentBearing:records.filter(r=>r.comments.length).length,
        cached:false,
        description:`${useQueries.length} 次检索去重后的样本（共 ${flat.length} 条原始结果），不是全站全量。`
      }
    };
    if(!failedQueries)cache.set(key,{at:Date.now(),value});
    else cache.delete(key);
    return value;
  })();

  cache.set(key,{pending});
  try{return await pending;}
  catch(error){cache.delete(key);throw error;}
}

export function clearCache(){
  cache.clear();
}
