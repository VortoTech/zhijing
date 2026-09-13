import {createHash} from 'node:crypto';

export const OBJECTION_TYPES={
  off_topic:'答非所问',
  self_contradiction:'自相矛盾',
  adds_condition:'补充适用条件',
  counter_example:'提出反例',
  questions_data:'质疑数据',
  challenges_framing:'质疑问题前提'
};

// 只有这一类不要求指向原文中的某句主张——它反驳的是问题本身，不是答案里的某句话。
export const FRAMING_TYPES=new Set(['challenges_framing','adds_condition']);

export const MIN_SUBSTANTIVE_CHARS=8;

const EMPTY_PRAISE=[
  /^说得好[！!。\s]*$/,
  /^学到了[！!。\s]*$/,
  /^谢谢(分享)?[！!。\s]*$/,
  /^感谢(分享|作者)?[！!。\s]*$/,
  /^(同意|赞同|支持|顶|赞|收藏了|马克)[！!。\s]*$/,
  /^(太|很|真)(对|好|真实|有用)了?$/,
  /^(确实|的确|就是|没错|对的)[！!。\s]*$/,
  /^(前排|沙发|板凳)$/,
  /^写得(真)?好[！!。\s]*$/,
  /^好文[！!。\s]*$/,
  /^有道理$/
];

export function looksLikeEmptyPraise(text){
  const t=String(text||'').trim();
  if(!t)return true;
  if(t.length<MIN_SUBSTANTIVE_CHARS)return true;
  return EMPTY_PRAISE.some(re=>re.test(t));
}

export function isSubstantive(text,modelSays=true){
  if(modelSays!==true)return false;
  if(looksLikeEmptyPraise(text))return false;
  return true;
}

export function hashSource(record){
  return createHash('sha256')
    .update([record.id,record.text,...record.comments].join('\u0000'))
    .digest('hex')
    .slice(0,16);
}

function isSubstringOf(haystack,needle){
  if(typeof needle!=='string'||!needle.trim())return false;
  if(typeof haystack!=='string'||!haystack)return false;
  return haystack.includes(needle);
}

export function verifyClassification(output,sources,{topicId=''}={}){
  if(!output||!Array.isArray(output.records))throw new Error('模型输出结构不正确');
  const byId=new Map(sources.map(s=>[s.id,s]));
  const seen=new Set();
  const records=new Map();

  for(const raw of output.records.slice(0,60)){
    if(!raw||typeof raw.id!=='string'||seen.has(raw.id))continue;
    const source=byId.get(raw.id);
    if(!source)continue;
    seen.add(raw.id);

    const claim=isSubstringOf(source.text,raw.claim)?raw.claim.trim():null;

    const objections=[];
    let rejected=Array.isArray(raw.objections)?Math.max(0,raw.objections.length-6):1;
    if(raw.claim&&!claim)rejected++;
    for(const item of Array.isArray(raw.objections)?raw.objections.slice(0,6):[]){
      if(!item||!Number.isInteger(item.commentIndex)){rejected++;continue;}
      const commentText=source.comments[item.commentIndex];
      if(typeof commentText!=='string'||!commentText.trim()){rejected++;continue;}
      if(!Object.hasOwn(OBJECTION_TYPES,item.type)){rejected++;continue;}
      const targetClaim=isSubstringOf(source.text,item.targetClaim)?item.targetClaim.trim():null;
      if((item.targetClaim&&!targetClaim)||(!FRAMING_TYPES.has(item.type)&&!targetClaim)){rejected++;continue;}
      if(typeof item.isSubstantive!=='boolean'){rejected++;continue;}
      if(!isSubstantive(commentText,item.isSubstantive===true))continue;
      if(objections.some(o=>o.commentIndex===item.commentIndex&&o.type===item.type))continue;
      objections.push({
        commentIndex:item.commentIndex,
        commentText,
        type:item.type,
        typeLabel:OBJECTION_TYPES[item.type],
        targetClaim,
        pointsToClaim:!!targetClaim
      });
    }

    records.set(source.id,{
      id:source.id,
      title:source.title,
      author:source.author,
      badge:source.badge,
      authority:source.authority,
      voteUp:source.voteUp,
      commentCount:source.commentCount,
      url:source.url,
      claim,
      text:source.text,
      comments:source.comments,
      objections,
      analysis:{status:rejected?'partial':'complete',reason:rejected?'invalid_annotations':null,rejected},
      sourceHash:hashSource(source),
      topicId
    });
  }

  return sources.map(source=>records.get(source.id)||unanalysedRecord(source,'model_omitted',topicId));
}

// 标题与话题不相关的回答没有送去分析，不能显示成「未见实质异议」。
export function outOfFocusRecord(source,topicId=''){
  return {...source,claim:null,objections:[],sourceHash:hashSource(source),topicId,
    analysis:{status:'out_of_focus',reason:'title_not_in_focus',rejected:0}};
}

// 原始记录永不因模型遗漏或失败而消失；未分析不等同于未见异议。
export function unanalysedRecord(source,reason,topicId=''){
  return {...source,claim:null,objections:[],sourceHash:hashSource(source),topicId,
    analysis:{status:source.comments.length?'failed':'no_comments',reason:source.comments.length?reason:null,rejected:0}};
}
