export const TRUST_STATES={
  disputed:{
    id:'disputed',
    label:'有读者提出异议',
    tone:'alert',
    note:'评论区有人针对这条回答提出了实质反驳。原文在下方，成立与否请自行判断。'
  },
  conditional:{
    id:'conditional',
    label:'有前提条件',
    tone:'caution',
    note:'有人补充了这条建议成立所需的适用条件——先看它适不适用于你。'
  },
  no_signal:{
    id:'no_signal',
    label:'未见实质异议',
    tone:'neutral',
    note:'这不等于这条回答被验证过。只表示本次样本取到的精选评论里没有出现实质异议。'
  }
};

export const ORDERS={
  'as-is':{id:'as-is',label:'按赞数排序',note:'按本次取得的赞数降序排列，不代表知乎搜索的原始顺序。'},
  attention:{id:'attention',label:'先看有争议的',note:'把有异议、有前提的排在前面。这是注意力排序，不是可信度排序。'},
  situation:{id:'situation',label:'先看相关条件',note:'优先展示提到所选条件的评论，不据此判断整条建议是否适合你。'}
};

// 判定「三态标记撑不撑得住」的门槛：带标记的记录占样本的比例。
// 这是个约定，不是从数据里推出来的定律。真实样本里它在 8%-15% 之间反复横跳，
// 所以诊断输出给的是区间判断（viable / scoped / marginal / too_sparse），不是是或否。
export const FLAG_RATIO_THRESHOLD=0.15;

const INCOMPLETE_STATE={id:'incomplete',label:'分析未完成',tone:'caution',note:'模型遗漏、分析失败或部分标注未通过校验；不能据此判断有无异议。'};
const OUT_OF_FOCUS_STATE={id:'out_of_focus',label:'未分析（与话题不相关）',tone:'neutral',note:'标题与本话题不相关，本次没有送去分析；不代表没有异议。'};

// 记录可能还没有经过异议归类（例如直接来自提取层），缺 objections 时按「未见实质异议」处理，
// 不能崩。空数组和缺字段在这里必须等价。
export function deriveTrustState(objections = []) {
  if (objections.some(o => o.type !== 'adds_condition')) return TRUST_STATES.disputed;
  if (objections.length) return TRUST_STATES.conditional;
  return TRUST_STATES.no_signal;
}

export function deriveBoundary(objections = []) {
  return objections
    .filter(o => o.type === 'adds_condition')
    .map(o => ({text: o.commentText, commentIndex: o.commentIndex}));
}

// 只检索已归类为条件补充的原话，不从作者认证或任意评论推断适用性。
// 输出的是阅读线索；否定、不同主体及多条件混合时均不下适用性结论。
export function situationFit(record,situation,topic){
  if(!situation||typeof situation!=='object')return null;
  const evidence=[];
  for(const field of topic.situationFields||[]){
    const value=situation[field.id];
    if(!field.options.includes(value))continue;
    const terms=field.terms?.[value]||[value];
    for(const objection of record.objections||[]){
      if(objection.type!=='adds_condition')continue;
      const original=record.comments[objection.commentIndex];
      if(original!==objection.commentText)continue;
      if(!terms.some(term=>original.includes(term)))continue;
      evidence.push({field:field.id,fieldLabel:field.label,myValue:value,
        commentIndex:objection.commentIndex,text:original,
        note:`评论 ${objection.commentIndex+1} 涉及「${field.label}」。请核对原话中的主体、否定和限制；提及不代表适合你。`});
    }
  }
  return evidence.length?{level:'reference',evidence,note:'相关条件原话，仅供对照，不判断适用性。'}:null;
}

// 对比图里被引用的一句回答原话，同一条回答的评论区里读者的反驳或补充。
// 评论回应的原句与这句有 8 字以上重合，标为「针对这句话」并排在前面；其余是针对整条回答。
export function pushbackFor(record,evidence){
  if(!record||evidence?.kind!=='answer')return [];
  return (record.objections||[])
    .map(o=>({...o,direct:sharesRun(o.targetClaim,evidence.text,8)}))
    .sort((a,b)=>Number(b.direct)-Number(a.direct));
}

function sharesRun(a,b,min){
  if(!a||!b)return false;
  if(a.includes(b)||b.includes(a))return true;
  for(let i=0;i+min<=a.length;i++)if(b.includes(a.slice(i,i+min)))return true;
  return false;
}

export function focusRecord(record,topic){
  return !topic.focusTerms?.length||topic.focusTerms.some(term=>record.title.includes(term));
}

function readingExcerpt(record,topic,meta){
  const target=record.objections.find(o=>o.targetClaim)?.targetClaim;
  if(target&&record.text.includes(target))return {text:target,label:'被回应的原句'};
  if(meta.mode==='live'&&record.claim&&record.text.includes(record.claim))return {text:record.claim,label:'原文摘句'};
  const sentences=record.text.match(/[^。！？\n]+[。！？]?/g)||[];
  const sentence=sentences.find(s=>s.length>=8&&s.length<=180&&(topic.excerptTerms||[]).some(t=>s.includes(t)));
  return {text:sentence?.trim()||record.text.slice(0,120)+(record.text.length>120?'…':''),label:'原文片段（非主张总结）'};
}

export function buildReadingMap(records,{topic,situation=null,order='as-is',conditions=[],meta={}}={}){
  if(!ORDERS[order])throw new Error('排序方式不合法');

  // 归一化：缺字段与空数组等价。
  // 上游可能是提取层（还没有 objections / claim，例如上界扫描或实时分类前的诊断），
  // 也可能是样本层。引擎必须两者都吃得下——否则就没法在花钱跑模型之前先判断值不值得。
  const normalized=records.map(record=>({
    ...record,
    objections:Array.isArray(record.objections)?record.objections:[],
    comments:Array.isArray(record.comments)?record.comments:[]
  }));

  const annotated=normalized.map(record=>{
    const analysis=record.analysis||{status:record.comments.length?'complete':'no_comments',reason:null};
    const incomplete=['failed','partial'].includes(analysis.status);
    const trust=analysis.status==='out_of_focus'?OUT_OF_FOCUS_STATE
      :incomplete&&!record.objections.length?INCOMPLETE_STATE:deriveTrustState(record.objections);
    const boundary=deriveBoundary(record.objections);
    const fit=situationFit(record,situation,topic);
    return {
      id:record.id,
      title:record.title,
      author:record.author,
      badge:record.badge,
      authority:record.authority,
      voteUp:record.voteUp,
      commentCount:record.commentCount,
      url:record.url,
      claim:record.claim,
      excerpt:readingExcerpt(record,topic,meta),
      focused:focusRecord(record,topic),
      sampledComments:record.comments.length,
      text:record.text,
      comments:record.comments,
      trust,
      analysis,
      objections:record.objections,
      boundary,
      fit,
      sourceHash:record.sourceHash
    };
  });

  const withAttention=annotated.map(r=>({
    ...r,
    attention:r.objections.length?0:1
  }));

  // 排序必须是全序：组内一律回落到赞数降序。
  // 否则 attention 组内的先后完全取决于上游返回顺序，同一份数据两次请求可能给出不同排列。
  const sorted=[...withAttention].sort((a,b)=>{
    if(order==='attention'&&a.attention!==b.attention)return a.attention-b.attention;
    if(order==='situation'){
      const level=Number(!a.fit)-Number(!b.fit);
      if(level!==0)return level;
    }
    return (b.voteUp??0)-(a.voteUp??0);
  });

  const stateCounts={disputed:0,conditional:0,no_signal:0,incomplete:0,out_of_focus:0};
  for(const r of annotated)stateCounts[r.trust.id]++;

  // 标题与话题不相关、未送分析的回答不进入标记密度的分母。
  const analysed=annotated.filter(r=>r.analysis.status!=='out_of_focus');
  const substantiveObjections=annotated.reduce((n,r)=>n+r.objections.length,0);
  const commentBearing=annotated.filter(r=>r.comments.length).length;
  const flagged=stateCounts.disputed+stateCounts.conditional;
  const flaggedRatio=analysed.length?flagged/analysed.length:0;

  // 同一个门槛，在几个不同的「面」上分别算一次。
  // 这是真实探针数据逼出来的结论：三态标记在整张结果列表上不成立，要收窄才有意义。
  const measure=subset=>{
    const total=subset.length;
    const flaggedCount=subset.filter(r=>r.objections.length).length;
    const objections=subset.reduce((n,r)=>n+r.objections.length,0);
    const ratio=total?flaggedCount/total:0;
    return {
      total,
      flagged:flaggedCount,
      objections,
      ratio:Number(ratio.toFixed(3)),
      viable:objections>=3&&ratio>=FLAG_RATIO_THRESHOLD
    };
  };

  const wholeSurface=measure(analysed);
  const commentSurface=measure(analysed.filter(r=>r.comments.length));

  // 按赞数从高到低扫一遍，看这个信号能撑到多深。
  // 「至少 10 条」是为了不让前几条的偶然性伪装成规律。
  const byVote=[...analysed].sort((a,b)=>(b.voteUp??0)-(a.voteUp??0));
  const scan=[];
  for(let n=Math.min(10,byVote.length);n<=byVote.length;n+=5){
    scan.push({n,...measure(byVote.slice(0,n))});
  }
  // 能撑住的最深一层。再往下走，标记密度就掉到噪音区了。
  const deepest=scan.filter(s=>s.viable).pop()||null;

  const pct=value=>`${(value*100).toFixed(1)}%`;
  const gate=`门槛 ${pct(FLAG_RATIO_THRESHOLD)} 是人为约定，不是定律`;

  let verdict;
  let reason;
  if(wholeSurface.viable){
    verdict='viable';
    reason=`整张列表 ${wholeSurface.flagged}/${wholeSurface.total}（${pct(wholeSurface.ratio)}）撑得住三态标记。`;
  }else if(commentSurface.viable){
    verdict='scoped';
    reason=`整张列表撑不住：${wholeSurface.flagged}/${wholeSurface.total}（${pct(wholeSurface.ratio)}）。但收窄到「有评论的 ${commentSurface.total} 条」就成立（${commentSurface.flagged} 条，${pct(commentSurface.ratio)}）。结论：三态标记不能平铺在搜索结果列表上，必须收窄到有评论密度的那一层。`;
  }else if(commentSurface.ratio>=FLAG_RATIO_THRESHOLD-0.05){
    verdict='marginal';
    reason=`边缘。整张列表 ${wholeSurface.flagged}/${wholeSurface.total}（${pct(wholeSurface.ratio)}）明显不够；收窄到有评论的 ${commentSurface.total} 条是 ${commentSurface.flagged} 条（${pct(commentSurface.ratio)}），刚好压在门槛线上。这不是「撑得住」，也不是「撑不住」，而是这个信号本来就稀。${gate}——换个更严的门槛结论就反了。`;
  }else{
    verdict='too_sparse';
    reason=`两个面上信号都过稀：整张列表 ${wholeSurface.flagged}/${wholeSurface.total}（${pct(wholeSurface.ratio)}），有评论的那层 ${commentSurface.flagged}/${commentSurface.total}（${pct(commentSurface.ratio)}）。这个话题撑不起三态标记——建议换话题或换形态。`;
  }
  if(deepest){
    reason+=` 本次每 5 条扫描中，最深达标位置为前 ${deepest.n} 条（${deepest.flagged}/${deepest.total}，${pct(deepest.ratio)}）。这只描述当前样本，不能推定产品的最大覆盖深度。`;
  }

  const diagnostics={
    total:annotated.length,
    commentBearing,
    commentCoverage:annotated.length?Number((commentBearing/annotated.length).toFixed(3)):0,
    stateCounts,
    flagged,
    flaggedRatio:Number(flaggedRatio.toFixed(3)),
    substantiveObjections,
    threshold:FLAG_RATIO_THRESHOLD,
    surfaces:{whole:wholeSurface,withComments:commentSurface},
    scan,
    deepestWorkable:deepest?{n:deepest.n,ratio:deepest.ratio,flagged:deepest.flagged}:null,
    viable:wholeSurface.viable,
    scopedViable:commentSurface.viable,
    verdict,
    reason
  };

  const boundaryRecords=annotated.filter(r=>r.boundary.length);
  diagnostics.analysisIncomplete=annotated.filter(r=>['failed','partial'].includes(r.analysis.status)).length;
  diagnostics.analysisComplete=annotated.filter(r=>r.analysis.status==='complete').length;
  diagnostics.noComments=annotated.filter(r=>r.analysis.status==='no_comments').length;
  diagnostics.outOfFocus=annotated.length-analysed.length;
  if(diagnostics.outOfFocus)diagnostics.reason+=` 另有 ${diagnostics.outOfFocus} 条标题与话题不相关的回答未送分析，不计入标记密度。`;
  if(diagnostics.analysisIncomplete||meta.failedQueries){
    diagnostics.verdict='incomplete';
    diagnostics.viable=false;diagnostics.scopedViable=false;
    diagnostics.surfaces.whole.viable=false;diagnostics.surfaces.withComments.viable=false;
    diagnostics.deepestWorkable=null;
    diagnostics.scan=diagnostics.scan.map(row=>({...row,viable:false}));
    diagnostics.reason=`本次结果不完整：${diagnostics.analysisIncomplete} 条回答分析未完成，${meta.failedQueries||0} 路检索失败。已发现的异议仅供阅读，暂不判定话题标记密度是否达标。`;
  }

  return {
    topic:{...topic},
    meta,
    situationCoverage:(topic.situationFields||[]).map(field=>({id:field.id,label:field.label,
      selected:situation?.[field.id]||null,
      count:annotated.filter(r=>r.fit?.evidence.some(e=>e.field===field.id)).length})),
    order:ORDERS[order],
    conditions,
    situation:situation||null,
    records:sorted,
    boundary:boundaryRecords,
    diagnostics,
    trustStates:TRUST_STATES,
    summary:buildSummary(stateCounts,annotated.length,order)+(diagnostics.analysisIncomplete?` 另有 ${diagnostics.analysisIncomplete} 条分析未完成，不能视为没有异议。`:'')
  };
}

function buildSummary(stateCounts,total,order){
  const parts=[];
  if(stateCounts.disputed)parts.push(`${stateCounts.disputed} 条被读者当场提出异议`);
  if(stateCounts.conditional)parts.push(`${stateCounts.conditional} 条有人补了适用前提`);
  const head=parts.length?`本次 ${total} 条结果中，${parts.join('，')}。`:`本次 ${total} 条结果中，没有取到实质异议。`;
  const tail=order==='as-is'
    ?'按本次赞数排序，异议只是标注。'
    :ORDERS[order].note;
  return `${head}${tail}`;
}
