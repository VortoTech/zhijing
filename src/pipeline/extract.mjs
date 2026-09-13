const MAX_TEXT=12000;
const MAX_COMMENTS=3;
const MAX_TITLE=200;

export function safeSourceUrl(url){
  try{
    const u=new URL(url);
    return u.protocol==='https:'&&(u.hostname==='zhihu.com'||u.hostname.endsWith('.zhihu.com'));
  }catch{return false;}
}

function str(value,limit){
  return typeof value==='string'?value.trim().slice(0,limit):'';
}

export function extractItem(item){
  if(!item||typeof item!=='object')return null;
  if(!safeSourceUrl(item.Url))return null;
  const id=String(item.ContentID??'').trim();
  if(!id)return null;
  const text=str(item.ContentText,MAX_TEXT);
  if(!text)return null;

  const comments=(Array.isArray(item.CommentInfoList)?item.CommentInfoList:[])
    .slice(0,MAX_COMMENTS)
    .map(c=>str(c?.Content,400))
    .filter(Boolean);

  const badge=str(item.AuthorBadgeText,40);
  const authority=Number.isInteger(item.AuthorityLevel)?item.AuthorityLevel:null;

  return {
    id,
    title:str(item.Title,MAX_TITLE)||'未命名内容',
    author:str(item.AuthorName,60)||null,
    badge:badge||null,
    authority,
    contentType:str(item.ContentType,20)||null,
    voteUp:Number.isFinite(item.VoteUpCount)?Number(item.VoteUpCount):null,
    commentCount:Number.isFinite(item.CommentCount)?Number(item.CommentCount):null,
    url:String(item.Url),
    text,
    comments
  };
}

export function dedupe(items,{limit=60}={}){
  const seen=new Set();
  const out=[];
  for(const item of items){
    const record=extractItem(item);
    if(!record||seen.has(record.id))continue;
    seen.add(record.id);
    out.push(record);
    if(out.length>=limit)break;
  }
  return out;
}

export function toModelPayload(records){
  return records.map(r=>({
    id:r.id,
    title:r.title,
    text:r.text,
    comments:r.comments.map((text,index)=>({index,text}))
  }));
}
