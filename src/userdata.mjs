import {getJSON,searchOne} from './pipeline/fetch.mjs';
import {extractItem} from './pipeline/extract.mjs';
import {classify} from './pipeline/classify.mjs';

// 知乎登录用户的数据：开放平台 Access Secret + 用户 OAuth token（X-OAuth-Token）读取，只读、只在服务端。
const USER_API='https://developer.zhihu.com/api/v1/user/';
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

export const contentId=url=>String(url).match(/answer\/(\d+)/)?.[1]
  ||String(url).match(/\/p\/(\d+)/)?.[1]
  ||String(url).match(/\/pin\/(\d+)/)?.[1]
  ||null;

// 内容类别与编号一起匹配，避免回答、文章、想法恰好同号时错挂评论。
function contentKey(value){
  const url=safeZhihuUrl(value);
  if(!url)return null;
  const path=new URL(url).pathname;
  return path.match(/\/answer\/\d+/)?.[0]||path.match(/\/(?:p|pin)\/\d+/)?.[0]||path;
}

function normalizeItem(item,types){
  const url=safeZhihuUrl(item?.Url);
  if(!url||!types.includes(item.ContentType))return null;
  const summary=typeof item.Summary==='string'?item.Summary.replace(/<[^>]+>/g,'').slice(0,600):'';
  // 想法没有标题时，用正文开头当标题。
  const title=(typeof item.Title==='string'?item.Title.replace(/\s*-\s*知乎$/,'').trim():'')||summary.trim().slice(0,40);
  if(!title)return null;
  return {
    type:item.ContentType,url,title:title.slice(0,120),summary,
    likeCount:Number(item.LikeCount)||0,
    commentCount:item.CommentCount!=null&&Number.isFinite(Number(item.CommentCount))?Math.max(0,Number(item.CommentCount)):null,
    favTime:Number(item.FavTime)||0,
    author:typeof item.Author?.Name==='string'?item.Author.Name.slice(0,40):null
  };
}
export const normalizeCollection=item=>normalizeItem(item,['answer','article']);
export const normalizeContent=item=>normalizeItem(item,['answer','article','pin']);

async function fetchUserList(path,params,normalize,env,token,request){
  const url=new URL(USER_API+path);
  url.search=new URLSearchParams(params).toString();
  let body;
  try{
    body=await request(url,{headers:{
      Authorization:`Bearer ${env.ZHIHU_ACCESS_SECRET}`,
      'X-OAuth-Token':token,
      'X-Request-Timestamp':String(Math.floor(Date.now()/1000)),
      'Content-Type':'application/json'
    }});
  }catch(error){
    throw fail([401,403].includes(error.status)?'auth':'upstream','读取知乎数据失败');
  }
  if(body?.Code===20001)throw fail('auth','知乎授权已失效');
  if(body?.Code!==0||!Array.isArray(body.Data?.Items))throw fail('upstream','读取知乎数据失败');
  const seen=new Set();
  return body.Data.Items.map(normalize).filter(Boolean).filter(item=>{const key=contentKey(item.url);if(seen.has(key))return false;seen.add(key);return true;});
}

// 近期收藏：用于「从收藏里挑问题」和「收藏体检」。
export function fetchCollections(env,token,{request=getJSON}={}){
  return fetchUserList('collections',{Limit:'50'},normalizeCollection,env,token,request);
}
// 本人发过的内容（回答、文章、想法）：用于「答主视角」体检。
export function fetchContents(env,token,{request=getJSON}={}){
  return fetchUserList('contents',{ContentType:'all',Limit:'30',Offset:'0',SortField:'ts',SortOrder:'desc'},normalizeContent,env,token,request);
}

// 授权验收：按官方 zhihu-hackathon skill 的要求，五项用户接口各读一条（创作、关注、收藏夹、收藏夹内容、近期收藏），
// 成功 / 空数据 / 失败如实记录。只返回标题级信息。收藏夹内容依赖第一个收藏夹的 UrlToken，没有收藏夹算空数据。
const VERIFY_CHECKS=[
  ['contents','我的创作',{ContentType:'all',Limit:'1',Offset:'0'}],
  ['followees','我的关注',{Limit:'1',Offset:'0'}],
  ['favlists','收藏夹',{Limit:'1'}],
  ['favlist_contents','收藏夹内容',null],
  ['collections','近期收藏',{Limit:'1'}]
];
function summarize(id,item){
  if(id==='followees')return {title:String(item.Fullname||'').slice(0,40)};
  if(id==='favlists')return {title:String(item.Title||'').slice(0,40),public:!!item.IsPublic};
  return {title:String(item.Title||'').slice(0,60),type:item.ContentType||''};
}
export async function verifyUserApis(env,token,{request=getJSON}={}){
  const results=[];
  let favlist=null;
  for(const [id,name,params] of VERIFY_CHECKS){
    let query=params;
    if(id==='favlist_contents'){
      if(!favlist){results.push({id,name,status:'empty',message:'账号没有可用于测试的收藏夹'});continue;}
      query={FavlistUrlToken:String(favlist),Limit:'1',Offset:'0'};
    }
    const url=new URL(USER_API+id);
    url.search=new URLSearchParams(query).toString();
    try{
      const body=await request(url,{headers:{
        Authorization:`Bearer ${env.ZHIHU_ACCESS_SECRET}`,'X-OAuth-Token':token,
        'X-Request-Timestamp':String(Math.floor(Date.now()/1000)),'Content-Type':'application/json'
      }});
      if(body?.Code!==0)throw Object.assign(new Error(body?.Message||'接口失败'),{code:body?.Code??null});
      const item=Array.isArray(body.Data?.Items)?body.Data.Items[0]||null:null;
      if(id==='favlists'&&item?.UrlToken)favlist=item.UrlToken;
      results.push({id,name,status:item?'success':'empty',sample:item?summarize(id,item):null,total:body.Data?.Paging?.Totals??null});
    }catch(error){
      results.push({id,name,status:'error',code:error.code??error.status??null,message:String(error.message).slice(0,120)});
    }
  }
  return results;
}

// 体检里的回答用它自己的一句话去搜：实测（60 条回答）命中约 65%，用问题标题只有约 10%。
export function sentenceOf(summary){
  return (String(summary).match(/[^。！？\n]{12,}/)||[''])[0].trim().slice(0,38);
}

// 体检（收藏或本人内容）：对上的内容拿到精选评论，走同一套异议归类与逐字校验；对不上的如实标出。
export async function runCheckup(items,env,{search=searchOne,classifier=classify,spacingMs=search===searchOne?SEARCH_SPACING_MS:0}={}){
  const targets=items.slice(0,CHECKUP_LIMIT);
  const found=new Map(),searchErrors=new Map();
  let searched=0;
  for(const [i,item] of targets.entries()){
    const id=contentId(item.url);
    // 原站评论数为 0 的内容不可能有人当场反驳，不去搜，直接标「还没有人评论」。
    if(!id||item.commentCount===0)continue;
    if(searched++)await sleep(spacingMs);
    const query=sentenceOf(item.summary)||item.title.slice(0,38);
    let raw=[];
    try{raw=await search(query,env);}
    catch(error){
      if(error.rateLimited||error.status===429){
        await sleep(spacingMs*2);
        try{raw=await search(query,env);}catch{searchErrors.set(i,true);}
      }else searchErrors.set(i,true);
    }
    const hit=raw.find(r=>contentKey(r.Url)===contentKey(item.url));
    const record=hit?extractItem(hit):null;
    if(record)found.set(i,record);
  }

  const withComments=[...found.values()].filter(r=>r.comments.length);
  const topic={id:'my-items',title:'用户收藏或发布的多条内容（各自回答自己标题里的问题）',kind:'opinion',focusTerms:[],excerptTerms:[],queries:[],conditions:[],situationFields:[]};
  let classified=[];
  try{classified=withComments.length?await classifier(withComments,topic,env):[];}catch{/* 保留检索到的记录，逐条标为未完成，允许重试。 */}
  const byId=new Map(classified.map(r=>[r.id,r]));

  const results=targets.map((item,i)=>{
    const record=found.get(i);
    const analysed=record?byId.get(record.id):null;
    const status=!record?(searchErrors.has(i)?'search_failed':item.commentCount===0?'uncommented':'unmatched')
      :!record.comments.length?'no_comments'
      :(!analysed||analysed.analysis?.status!=='complete')&&!analysed?.objections?.length?'incomplete'
      :analysed?.objections?.length?'pushback':'quiet';
    return {
      title:item.title,url:item.url,type:item.type,author:item.author,likeCount:item.likeCount,commentCount:item.commentCount,status,
      incomplete:searchErrors.has(i)||!!record?.comments.length&&analysed?.analysis?.status!=='complete',
      objections:(analysed?.objections||[]).map(o=>({type:o.type,typeLabel:o.typeLabel,commentText:o.commentText,targetClaim:o.targetClaim||''}))
    };
  });
  const order={pushback:0,incomplete:1,search_failed:1,quiet:2,no_comments:3,unmatched:4,uncommented:5};
  results.sort((a,b)=>order[a.status]-order[b.status]);
  return {
    checked:targets.length,total:items.length,matched:found.size,withComments:withComments.length,
    incomplete:results.filter(r=>r.incomplete).length,failedSearches:searchErrors.size,
    pushback:results.filter(r=>r.status==='pushback').length,items:results
  };
}
