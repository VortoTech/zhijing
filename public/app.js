import {buildReadingMap} from '/engine.js';
import {createReadingSession} from '/session.js';

// 示例问题：第一个有提前整理好的样本，点开立即出结果；其余走实时检索。
const EXAMPLES=[
  {question:'第一份工作选高薪还是成长',sample:'first-job'},
  {question:'考研还是直接工作'},
  {question:'毕业去大城市还是回老家'},
  {question:'要不要转行做程序员'}
];
// 默认只列出前几个分叉条件，其余按需展开。
const MAX_FORKS=3;

const session=createReadingSession();
const state={config:null,view:null,filter:'flagged',showAllForks:false};
let openCards=null,ticker=null;
const $=id=>document.getElementById(id);
function el(tag,props={},children=[]){
  const node=document.createElement(tag);
  for(const [key,value] of Object.entries(props)){
    if(key==='text')node.textContent=value;
    else if(key==='class')node.className=value;
    else if(value!==false&&value!=null)node.setAttribute(key,String(value));
  }
  for(const child of children.flat())if(child!=null)node.append(typeof child==='string'?document.createTextNode(child):child);
  return node;
}
const clear=node=>node.replaceChildren();
const button=(text,action,props={})=>{const b=el('button',{type:'button',text,...props});b.addEventListener('click',action);return b;};
const cleanTitle=title=>title.replace(/\s*-\s*知乎$/,'');

function normalizeQuestion(value){
  const question=value.trim().replace(/\s+/g,' ');
  if(question.length<4)throw new Error('多写几个字，比如「考研还是直接工作」。');
  if(question.length>80)throw new Error('问题请控制在 80 字以内。');
  return question;
}
function sampleView(){return {kind:'sample',topicId:EXAMPLES[0].sample,question:EXAMPLES[0].question};}
function viewFor(question){
  const example=EXAMPLES.find(e=>e.question===question&&e.sample);
  return example?{kind:'sample',topicId:example.sample,question}:{kind:'ask',question};
}

function clearResults(){
  for(const id of ['result-head','compare','sources-summary','sources-note','list','list-bar','diag-slot','source-note'])clear($(id));
  for(const id of ['sources','data-details']){$(id).hidden=true;$(id).open=false;}
}
function setBusy(busy){
  $('ask-btn').disabled=busy;
  $('results').setAttribute('aria-busy',String(busy));
  for(const b of $('examples').querySelectorAll('button'))b.disabled=busy||(!b.dataset.sample&&!state.config?.askReady);
}
function stopTicker(){clearInterval(ticker);ticker=null;}
function showProgress(live){
  stopTicker();
  const started=Date.now();
  const elapsed=el('span',{class:'elapsed'});
  $('status').replaceChildren(el('div',{class:'progress'},[
    el('span',{class:'spinner','aria-hidden':'true'}),
    el('span',{text:live?'正在读知乎上相关的回答和评论，通常要 20–40 秒。':'正在打开示例…'}),
    elapsed,
    button('取消',cancel,{class:'btn ghost small'})
  ]));
  if(live)ticker=setInterval(()=>{elapsed.textContent='已等待 '+Math.round((Date.now()-started)/1000)+' 秒';},1000);
}
function cancel(){
  session.cancel();stopTicker();setBusy(false);clearResults();
  $('status').textContent='已取消。已经发出的分析可能还会在服务端跑完。';
}
function showError(message,{informational=false}={}){
  const actions=[];
  if(!informational)actions.push(button('重试',()=>load(state.view,true),{class:'btn'}));
  actions.push(button('看示例：'+EXAMPLES[0].question,()=>load(sampleView()),{class:'btn ghost'}));
  $('error-slot').replaceChildren(el('div',{class:'error'},[el('p',{text:message}),el('div',{class:'row'},actions)]));
}
function syncUrl(view){
  try{
    const url=new URL(location.href);
    if(view.kind==='ask')url.searchParams.set('q',view.question);else url.searchParams.delete('q');
    history.replaceState(null,'',url);
  }catch{}
}
function markExamples(){
  for(const b of $('examples').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.question===state.view?.question));
}

async function load(view,refresh=false){
  state.view=view;state.filter='flagged';state.showAllForks=false;
  $('q').value=view.question;$('ask-note').textContent='';
  syncUrl(view);markExamples();
  const live=view.kind==='ask';
  const ticket=session.begin(live?'ask:'+view.question:view.topicId+':snapshot');
  openCards=null;
  clearResults();clear($('error-slot'));
  setBusy(true);showProgress(live);
  try{
    const res=await fetch(live?'/api/ask':'/api/reading-map',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify(live?{question:view.question,refresh}:{topicId:view.topicId,mode:'snapshot'}),
      signal:AbortSignal.any([ticket.signal,AbortSignal.timeout(130000)])
    });
    const data=await res.json().catch(()=>({error:'服务暂时不可用，请稍后再试。'}));
    if(!session.active(ticket))return;
    if(!res.ok)throw Object.assign(new Error(data.error||'这次没有取到结果，请重试。'),{informational:!!data.informational});
    if(!session.accept(ticket,data))throw new Error('结果和当前问题对不上，请重试。');
    stopTicker();setBusy(false);$('status').replaceChildren();
    render();
  }catch(error){
    if(!session.active(ticket))return;
    session.cancel();stopTicker();setBusy(false);clearResults();$('status').replaceChildren();
    showError(error.name==='TimeoutError'?'等太久了，请重试。':error.message==='Failed to fetch'?'连接中断，请检查网络后重试。':error.message,{informational:error.informational});
  }
}

function sourceLink(record,label='打开知乎原文 ↗'){
  try{
    const u=new URL(record.url);
    if(u.protocol!=='https:'||!(u.hostname==='zhihu.com'||u.hostname.endsWith('.zhihu.com')))return null;
    return el('a',{href:u.href,target:'_blank',rel:'noopener noreferrer',class:'src',text:label});
  }catch{return null;}
}

// ── 对比图：默认只给结论，原话点开再看 ──
function evidenceFigure(e,byId){
  const record=byId.get(e.recordId);
  return el('figure',{class:'evidence'},[
    el('blockquote',{text:e.text}),
    el('figcaption',{title:record?cleanTitle(record.title):false},[
      (e.kind==='comment'?'评论':'回答')+(record?' · '+(record.voteUp??'—')+' 赞 ':''),
      record?sourceLink(record,'原文 ↗'):null
    ])
  ]);
}
function comparisonSections(block,records,sample){
  const byId=new Map(records.map(r=>[r.id,r]));
  const hasSides=block?.sides?.some(s=>s.reasons.length);
  if(block?.status!=='complete'||(!hasSides&&!block.forks.length)){
    const message=block?.status==='failed'?'这次没能整理出对比（模型请求失败）。'
      :block?.status==='not_comparable'?'这个问题不太像二选一，没法并排对比。换成「A 还是 B」的问法试试。'
      :sample&&!block?'这个示例还没有整理好的对比图。':'这次没从原话里整理出明确的对比，可以直接看下面的原始回答。';
    return [el('section',{class:'compare-block'},[el('p',{class:'cond-empty'},[
      message,block?.status==='failed'?button('重新整理',()=>load(state.view,true),{class:'link-btn'}):null
    ])])];
  }
  const [,B]=block.options;
  const side=option=>option===B?' b':'';
  const sections=[];
  if(hasSides)sections.push(el('section',{class:'compare-block','aria-labelledby':'sides-title'},[
    el('h3',{id:'sides-title',class:'section-title',text:'两边的理由'}),
    el('div',{class:'sides'},block.sides.map(s=>el('div',{class:'side'+side(s.option)},[
      el('h4',{class:'side-title'},['选',el('span',{class:'opt'+side(s.option),text:s.option})]),
      s.reasons.length
        ?el('ul',{class:'reasons'},s.reasons.map(r=>el('li',{},[el('details',{class:'reason'},[
          el('summary',{text:r.label}),
          ...r.evidence.map(e=>evidenceFigure(e,byId))
        ])])))
        :el('p',{class:'note',text:'没找到这一边的理由。'})
    ])))
  ]));
  if(block.forks.length){
    const shown=state.showAllForks?block.forks:block.forks.slice(0,MAX_FORKS);
    const rest=block.forks.length-shown.length;
    sections.push(el('section',{class:'compare-block','aria-labelledby':'forks-title'},[
      el('h3',{id:'forks-title',class:'section-title',text:'决定你选哪边'}),
      el('p',{class:'note',text:'看看你属于哪种情况。'}),
      // 宽屏默认展开第一个条件示范「可以核对原话」；手机上全部收起，免得首屏被原话占满。
      el('ol',{class:'forks'},shown.map((f,i)=>el('li',{},[el('details',{class:'fork',open:i===0&&matchMedia('(min-width: 641px)').matches},[
        el('summary',{},[
          el('span',{class:'fork-label',text:f.label}),
          el('span',{class:'pills'},f.branches.map(b=>el('span',{class:'pill'+side(b.lean)},[
            b.when,el('span',{class:'arrow',text:'→'}),el('strong',{text:b.lean})
          ])))
        ]),
        el('div',{class:'branches'},f.branches.map(b=>el('div',{class:'branch'+side(b.lean)},b.evidence.map(e=>evidenceFigure(e,byId)))))
      ])]))),
      rest>0?button('再看 '+rest+' 个条件',()=>{state.showAllForks=true;render();},{class:'btn ghost small more-forks'}):null
    ]));
  }
  return sections;
}

function context(record,target){
  const at=target?record.text.indexOf(target):-1;
  if(at<0)return el('p',{class:'quote',text:record.text.slice(0,320)+(record.text.length>320?'…':'')});
  const start=Math.max(0,at-90),end=Math.min(record.text.length,at+target.length+90);
  return el('p',{class:'quote'},[(start?'…':'')+record.text.slice(start,at),el('mark',{text:target}),record.text.slice(at+target.length,end)+(end<record.text.length?'…':'')]);
}
function objectionBlock(o,record){
  const copied=el('span',{class:'note',role:'status'});
  return el('section',{class:'obj'+(o.type==='adds_condition'?' boundary':'')},[
    el('h3',{class:'obj-type',text:o.typeLabel}),
    o.targetClaim?el('div',{},[
      el('p',{class:'note',text:'回应的原句'}),
      el('p',{class:'quote'},[el('mark',{text:o.targetClaim})]),
      el('details',{},[el('summary',{class:'context-toggle',text:'查看这句话的上下文'}),context(record,o.targetClaim)])
    ]):el('p',{class:'note',text:'这条评论针对的是回答的前提，不是其中某一句。'}),
    el('p',{class:'note',text:'读者原话 · 逐字引用'}),
    el('blockquote',{class:'quote',text:o.commentText}),
    el('div',{class:'row'},[
      sourceLink(record),
      button('复制评论以便查找',async()=>{
        try{await navigator.clipboard.writeText(o.commentText);copied.textContent='已复制评论原话。';}
        catch{copied.textContent='未能复制，请选中上方原话手动复制。';}
      },{class:'btn ghost'}),copied
    ]),
    el('p',{class:'note',text:'链接打开回答或文章，不会自动定位评论。可用上方原话在原站查找；精选评论不代表完整评论区。'})
  ]);
}
function card(record,open=false){
  const hasComments=record.sampledComments>0;
  const flagged=record.objections.length>0;
  const incomplete=['failed','partial'].includes(record.analysis?.status);
  const outOfFocus=record.analysis?.status==='out_of_focus';
  const label=flagged||outOfFocus?record.trust.label:incomplete?'分析未完成':hasComments?'本次评论未见实质异议':'评论数据不足';
  const header=el('summary',{},[
    el('div',{class:'card-top'},[
      el('span',{class:'chip t-'+record.trust.id,text:label}),
      el('span',{class:'meta',text:(record.voteUp??'—')+' 赞 · 原站评论 '+(record.commentCount??'未知')+' · 本次取到 '+record.sampledComments+' 条'})
    ]),
    el('h2',{class:'card-title',text:cleanTitle(record.title)}),
    el('p',{class:'claim',text:record.excerpt.label+'：'+record.excerpt.text}),
    el('span',{class:'expand-hint',text:flagged?'看读者怎么说（'+record.objections.length+' 条）':'展开原文片段'})
  ]);
  const body=el('div',{class:'card-body'},record.objections.map(o=>objectionBlock(o,record)));
  if(incomplete)body.prepend(el('p',{class:'disclaimer',text:'本条分析未完成：模型遗漏、请求失败或部分标注未通过引用校验。已展示的引用仍可核对，未展示的部分不能理解为没有异议。'}));
  if(!flagged)body.append(context(record,null),el('p',{class:'disclaimer',text:outOfFocus?'标题和这个问题不太相关，本次没有送去分析；有没有异议未知。':incomplete?'原文保留供阅读，异议分析尚不完整。':hasComments?'只检查了本次取得的 '+record.sampledComments+' 条精选评论，没发现实质异议不等于回答被验证。':'本次没有取得评论，无法分析读者是否提出异议。'}),sourceLink(record)||'');
  const node=el('details',{class:'card','data-trust':record.trust.id,open},[header,body]);
  node.addEventListener('toggle',()=>{
    if(!node.isConnected||!openCards)return;
    if(node.open)openCards.add(record.id);else openCards.delete(record.id);
  });
  return node;
}

function render(){
  const dataset=session.get();
  if(!dataset)return;
  const data=buildReadingMap(dataset.records,{topic:dataset.topic,meta:dataset.meta,order:'attention'});
  const sample=data.meta.mode==='snapshot';
  const focused=data.records.filter(r=>r.focused),flagged=focused.filter(r=>r.objections.length);
  if(openCards===null)openCards=new Set();
  const incomplete=data.records.filter(r=>['failed','partial'].includes(r.analysis?.status));
  if(state.filter==='incomplete'&&!incomplete.length)state.filter='flagged';
  if(state.filter==='flagged'&&!flagged.length)state.filter='focused';
  const visible=state.filter==='flagged'?flagged:state.filter==='focused'?focused:state.filter==='incomplete'?incomplete:data.records;

  // 结果头只留问题和一行说明，AI 与数据口径收进页面底部。
  const head=[
    el('h2',{class:'result-title',text:data.meta.question||data.topic.title}),
    el('p',{class:'result-meta'},[
      (sample?'示例数据 · ':'')+`读了 ${focused.length} 条相关回答 · AI 归纳，原话一字未改`,
      button('怎么来的？',()=>{$('data-details').open=true;$('data-details').scrollIntoView({behavior:'smooth',block:'start'});},{class:'link-btn'}),
      sample&&state.config?.askReady?button('用实时检索重新找',()=>load({kind:'ask',question:data.topic.title}),{class:'link-btn'}):null
    ])
  ];
  if(incomplete.length||data.meta.failedQueries){
    head.push(el('p',{class:'note warn'},['这次结果不完整：'+incomplete.length+' 条分析没完成，'+(data.meta.failedQueries||0)+' 路检索失败。',button('重新分析',()=>load(state.view,true),{class:'link-btn'})]));
  }
  $('result-head').replaceChildren(...head);
  $('compare').replaceChildren(...comparisonSections(dataset.comparison,data.records,sample));

  $('sources-summary').textContent=`原始回答与评论区 · ${focused.length} 条`+(flagged.length?`（${flagged.length} 条被读者反驳）`:'');
  $('sources-note').replaceChildren(
    el('p',{class:'note',text:'上面的原话都来自这些回答。'+(flagged.length?`被读者在评论区反驳或补充前提的排在前面（${sample?'人工标注':'模型挑出'}）。`:'')}),
    flagged.length?el('p',{class:'legend-line'},[
      el('span',{class:'chip t-disputed',text:'有读者提出异议'}),el('span',{text:'有人反驳或指出回答的问题'}),
      el('span',{class:'chip t-conditional',text:'有前提条件'}),el('span',{text:'有人补充「这只适用于……」'})
    ]):null
  );
  const filters=[];
  if(flagged.length)filters.push(['flagged','被读者反驳的 '+flagged.length]);
  filters.push(['focused','全部相关回答 '+focused.length],['all','全部检索结果 '+data.records.length]);
  if(incomplete.length)filters.push(['incomplete','待完成分析 '+incomplete.length]);
  $('list-bar').replaceChildren(el('div',{class:'seg',role:'group','aria-label':'显示范围'},filters.map(([id,label])=>button(label,()=>{
    state.filter=id;render();$('list-bar').querySelector('[aria-pressed="true"]')?.focus();
  },{'aria-pressed':String(state.filter===id)}))));
  $('list').replaceChildren(...visible.map(r=>card(r,openCards.has(r.id))));
  if(!visible.length)$('list').append(el('div',{class:'empty'},[el('p',{text:'这里暂时没有内容。'})]));
  $('sources').hidden=false;

  const meta=data.meta;
  $('source-note').replaceChildren(
    el('p',{text:'标题和分支说明由 AI 归纳，只帮你把两边摆清楚，不替你做决定。有人提出异议，不代表异议成立；没发现异议，也不代表回答适用于你。'}),
    el('p',{text:'对比图由模型从赞数靠前的 24 条相关回答和它们的精选评论里整理：程序先把回答切句编号，模型只挑编号，页面按编号取原文，所以引号里的话一字未改。归纳本身可能不全或不准。'}),
    el('p',{text:sample?'评论区的反驳由人工标注，并校验引文来源。':'评论区的反驳由模型归类，并逐字校验引文来源。引文存在不代表归类一定正确。'}),
    el('p',{text:(meta.sourceNote||meta.description||'本次检索取得的有限样本。')+' '+(sample?'样本生成时间':'检索时间')+'：'+(meta.builtAt||meta.capturedAt||'未记录')+'。'}),
    el('p',{text:'「相关回答」按标题关键词筛选，可能漏选；另有 '+(data.records.length-focused.length)+' 条在「全部检索结果」里。统计不代表知乎全量，每条最多取得 3 条精选评论。'})
  );
  if(meta.requestId)$('source-note').append(el('p',{text:'本次请求编号：'+meta.requestId}));
  const d=data.diagnostics;
  $('diag-slot').replaceChildren(
    el('p',{text:'全部结果：'+d.total+' 条；取得评论：'+d.commentBearing+' 条；被反驳或补充前提：'+d.flagged+' 条；分析完成：'+d.analysisComplete+' 条；未完成：'+d.analysisIncomplete+' 条；无评论：'+d.noComments+' 条。'})
  );
  $('data-details').hidden=false;
}

$('examples').replaceChildren(...EXAMPLES.map(e=>button(e.question,()=>load(viewFor(e.question)),{
  class:'chip-btn','data-question':e.question,'data-sample':e.sample||false,'aria-pressed':'false'
})));
$('ask-form').addEventListener('submit',event=>{
  event.preventDefault();
  let question;
  try{question=normalizeQuestion($('q').value);}
  catch(error){$('ask-note').textContent=error.message;$('q').focus();return;}
  const view=viewFor(question);
  if(view.kind==='ask'&&!state.config?.askReady){$('ask-note').textContent='实时检索暂未开放，可以先看看示例。';return;}
  load(view);
});

async function boot(){
  try{
    const res=await fetch('/api/config',{signal:AbortSignal.timeout(10000)});
    if(!res.ok)throw new Error('配置读取失败');
    state.config=await res.json();
  }catch{
    $('status').replaceChildren(el('p',{text:'暂时连不上服务，请稍后再试。'}),button('重新连接',boot,{class:'btn'}));
    return;
  }
  if(!state.config.askReady)$('ask-note').textContent='实时检索暂未开放，可以先看看示例。';
  let initial=sampleView();
  const q=new URLSearchParams(location.search).get('q');
  if(q){
    try{const view=viewFor(normalizeQuestion(q));if(view.kind==='sample'||state.config.askReady)initial=view;}catch{}
  }
  load(initial);
}
boot();
