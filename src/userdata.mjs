import {getJSON,searchOne} from './pipeline/fetch.mjs';
import {extractItem} from './pipeline/extract.mjs';
import {classify} from './pipeline/classify.mjs';

// 知乎登录用户的收藏：开放平台 Access Secret + 用户 OAuth token（X-OAuth-Token）读取，只读、只在服务端。
const COLLECTIONS_URL='https://developer.zhihu.com/api/v1/user/collections';
export const CHECKUP_LIMIT=20;
const SEARCH_SPACING_MS=700;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fail=(reason,message)=>Object.assign(new Error(message),{reason});

function safeZhihuUrl(value){
  try{
    const url=new URL(value);
    return url.protocol==='https:'&&(url.hostname==='zhihu.com'||url.hostname.endsWith('.zhihu.com'))?url.href:null;
  }catch{return null;}
}

export const contentId=url=>String(url).match(/answer\/(\d+)/)?.[1]||String(url).match(/\/p\/(\d+)/)?.[1]||null;

export function normalizeCollection(item){
  const url=safeZhihuUrl(item?.Url);
  if(!url||!['answer','article'].includes(item.ContentType))return null;
  const title=typeof item.Title==='string'?item.Title.replace(/\s*-\s*知乎$/,'').trim().slice(0,120):'';
  if(!title)return null;
  return {
    type:item.ContentType,url,title,
    summary:typeof item.Summary==='string'?item.Summary.replace(/<[^>]+>/g,'').slice(0,600):'',
    likeCount:Number(item.LikeCount)||0,
    commentCount:Number(item.CommentCount)||0,
    favTime:Number(item.FavTime)||0,
    author:typeof item.Author?.Name==='string'?item.Author.Name.slice(0,40):null
  };
}

export async function fetchCollections(env,token,{request=getJSON}={}){
  const url=new URL(COLLECTIONS_URL);
  url.search=new URLSearchParams({Limit:'50'}).toString();
  let body;
  try{
    body=await request(url,{headers:{
      Authorization:`Bearer ${env.ZHIHU_ACCESS_SECRET}`,
      'X-OAuth-Token':token,
      'X-Request-Timestamp':String(Math.floor(Date.now()/1000)),
      'Content-Type':'application/json'
    }});
  }catch(error){
    throw fail([401,403].includes(error.status)?'auth':'upstream','读取收藏失败');
  }
  if(body?.Code===20001)throw fail('auth','知乎授权已失效');
  if(body?.Code!==0||!Array.isArray(body.Data?.Items))throw fail('upstream','读取收藏失败');
  return body.Data.Items.map(normalizeCollection).filter(Boolean);
}

// 收藏里的回答用它自己的一句话去搜：实测（60 条回答）命中约 65%，用问题标题只有约 10%。
export function sentenceOf(summary){
  return (String(summary).match(/[^。！？\n]{12,}/)||[''])[0].trim().slice(0,38);
}

// 收藏体检：对上的回答拿到精选评论，走同一套异议归类与逐字校验；对不上的如实标出。
export async function runCheckup(items,env,{search=searchOne,classifier=classify,spacingMs=search===searchOne?SEARCH_SPACING_MS:0}={}){
  const targets=items.slice(0,CHECKUP_LIMIT);
  const found=new Map();
  for(const [i,item] of targets.entries()){
    const id=contentId(item.url);
    if(!id)continue;
    if(i)await sleep(spacingMs);
    const query=sentenceOf(item.summary)||item.title.slice(0,38);
    let raw=[];
    try{raw=await search(query,env);}
    catch(error){
      if(error.rateLimited){
        await sleep(spacingMs*2);
        try{raw=await search(query,env);}catch{}
      }
    }
    const hit=raw.find(r=>String(r.ContentID)===id||contentId(r.Url)===id);
    const record=hit?extractItem(hit):null;
    if(record)found.set(i,record);
  }

  const withComments=[...found.values()].filter(r=>r.comments.length);
  const topic={id:'my-collections',title:'用户收藏的多个回答（各自回答自己标题里的问题）',kind:'opinion',focusTerms:[],excerptTerms:[],queries:[],conditions:[],situationFields:[]};
  const classified=withComments.length?await classifier(withComments,topic,env):[];
  const byId=new Map(classified.map(r=>[r.id,r]));

  const results=targets.map((item,i)=>{
    const record=found.get(i);
    const analysed=record?byId.get(record.id):null;
    const status=!record?'unmatched'
      :!record.comments.length?'no_comments'
      :['failed','partial'].includes(analysed?.analysis?.status)&&!analysed?.objections?.length?'incomplete'
      :analysed?.objections?.length?'pushback':'quiet';
    return {
      title:item.title,url:item.url,author:item.author,likeCount:item.likeCount,commentCount:item.commentCount,status,
      objections:(analysed?.objections||[]).map(o=>({type:o.type,typeLabel:o.typeLabel,commentText:o.commentText,targetClaim:o.targetClaim||''}))
    };
  });
  const order={pushback:0,incomplete:1,quiet:2,no_comments:3,unmatched:4};
  results.sort((a,b)=>order[a.status]-order[b.status]);
  return {
    checked:targets.length,total:items.length,matched:found.size,withComments:withComments.length,
    pushback:results.filter(r=>r.status==='pushback').length,items:results
  };
}
