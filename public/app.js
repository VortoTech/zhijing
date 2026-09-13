import {buildReadingMap} from '/engine.js';
import {createReadingSession} from '/session.js';

const session=createReadingSession();
const state={config:null,topicId:null,mode:'snapshot',order:'attention',situation:{},filter:'flagged'};
let openCards=null;
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

function clearResults(){
  for(const id of ['list','list-bar','diag-slot','source-note','coverage-note'])clear($(id));
  $('data-details').hidden=true;
  $('data-details').open=false;
}
function errorMessage(message){
  clear($('error-slot'));
  $('error-slot').append(el('div',{class:'error'},[
    el('p',{text:message}),
    button('重试',()=>run(),{class:'btn'}),
    button('返回可用样本',()=>{
      const topic=state.config?.topics.find(t=>t.availability.snapshot);
      if(!topic)return;
      state.mode='snapshot';state.topicId=topic.id;state.situation={};state.filter='flagged';
      buildControls();run();
    },{class:'btn ghost'})
  ]));
}
async function run(){
  const ticket=session.begin(state.topicId+':'+state.mode);
  openCards=null;
  clearResults();clear($('error-slot'));
  $('results').setAttribute('aria-busy','true');
  $('status').replaceChildren(el('span',{text:state.mode==='live'?'正在检索并分批分析评论，最多约两分钟…':'正在读取样本…'}),
    button('取消等待',()=>{session.cancel();clearResults();$('results').setAttribute('aria-busy','false');$('status').textContent='已取消等待。';errorMessage('已停止等待，已发出的服务端分析可能继续执行。可以重试或返回离线样本。');},{class:'btn ghost'}));
  try{
    const res=await fetch('/api/reading-map',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({topicId:state.topicId,mode:state.mode}),
      signal:AbortSignal.any([ticket.signal,AbortSignal.timeout(130000)])
    });
    const data=await res.json();
    if(!session.active(ticket))return;
    if(!res.ok)throw new Error(data.error||'本次读取未完成，请重试。');
    if(!session.accept(ticket,data))throw new Error('结果与当前话题不一致，请重试。');
    $('results').setAttribute('aria-busy','false');
    render();
  }catch(error){
    if(!session.active(ticket))return;
    session.cancel();clearResults();
    $('results').setAttribute('aria-busy','false');
    $('status').textContent='未能取得本次结果。';
    errorMessage(error.name==='TimeoutError'?'等待超时，请重试或返回离线样本。':error.message==='Failed to fetch'?'连接中断，请检查网络后重试。':error.message);
  }
}

function sourceLink(record,label='打开知乎原文 ↗'){
  try{
    const u=new URL(record.url);
    if(u.protocol!=='https:'||!(u.hostname==='zhihu.com'||u.hostname.endsWith('.zhihu.com')))return null;
    return el('a',{href:u.href,target:'_blank',rel:'noopener noreferrer',class:'src',text:label});
  }catch{return null;}
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
    ]):el('p',{class:'note',text:'这条评论讨论前提，未定位到答案中的具体句子。'}),
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
      record.fit?el('span',{class:'chip fit-reference',text:'有相关条件原话'}):null,
      !record.focused?el('span',{class:'meta',text:'扩展阅读'}):null,
      el('span',{class:'meta',text:(record.voteUp??'—')+' 赞 · 原站评论 '+(record.commentCount??'未知')+' · 本次取到 '+record.sampledComments+' 条'})
    ]),
    el('h2',{class:'card-title',text:record.title.replace(/\s*-\s*知乎$/,'')}),
    el('p',{class:'claim',text:record.excerpt.label+'：'+record.excerpt.text}),
    el('span',{class:'expand-hint',text:flagged?'展开／收起 '+record.objections.length+' 条异议与前提':'展开／收起原文片段'})
  ]);
  const body=el('div',{class:'card-body'},record.objections.map(o=>objectionBlock(o,record)));
  if(incomplete)body.prepend(el('p',{class:'disclaimer',text:'本条分析未完成：模型遗漏、请求失败或部分标注未通过引用校验。已展示的引用仍可核对，未展示的部分不能理解为没有异议。可在列表上方重新分析。'}));
  if(!flagged)body.append(context(record,null),el('p',{class:'disclaimer',text:outOfFocus?'标题与本话题不相关，本次没有送去分析；有没有异议未知。':incomplete?'原文保留供阅读，异议分析尚不完整。':hasComments?'只检查了本次取得的 '+record.sampledComments+' 条精选评论，未发现实质异议不等于回答被验证。':'本次没有取得评论，无法分析读者是否提出异议。原站评论总数不代表本次分析覆盖。'}),sourceLink(record)||'');
  if(record.fit)body.append(el('section',{class:'fit-box'},[
    el('h3',{text:'与你所选条件有关的原话'}),
    ...record.fit.evidence.map(e=>el('div',{},[el('p',{text:e.note}),el('blockquote',{class:'quote',text:e.text})])),
    el('p',{class:'note',text:record.fit.note})
  ]));
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
  const data=buildReadingMap(dataset.records,{topic:dataset.topic,meta:dataset.meta,order:state.order,situation:state.situation});
  const focused=data.records.filter(r=>r.focused),flagged=focused.filter(r=>r.objections.length);
  if(openCards===null)openCards=new Set(flagged.slice(0,1).map(r=>r.id));
  const incomplete=data.records.filter(r=>['failed','partial'].includes(r.analysis?.status));
  if(state.filter==='incomplete'&&!incomplete.length)state.filter='flagged';
  const visible=state.filter==='flagged'?flagged:state.filter==='focused'?focused:state.filter==='incomplete'?incomplete:data.records;
  $('status').textContent=(state.mode==='snapshot'?'离线样本':'本次检索')+' · '+focused.length+' 条标题相关回答中，'+flagged.length+' 条有异议或前提。'+(state.order==='situation'?'已优先展示涉及所选条件的原话。':'');
  const filters=[['flagged','异议与前提 '+flagged.length],['focused','相关回答 '+focused.length],['all','全部样本 '+data.records.length]];
  if(incomplete.length)filters.push(['incomplete','待完成分析 '+incomplete.length]);
  if(incomplete.length||data.meta.failedQueries){
    $('status').append(el('p',{text:'本次结果不完整：'+incomplete.length+' 条分析未完成，'+(data.meta.failedQueries||0)+' 路检索失败。未完成不等于未见异议。'}),button('重新分析',()=>run(),{class:'btn ghost'}));
  }
  $('list-bar').replaceChildren(el('div',{class:'seg',role:'group','aria-label':'显示范围'},filters.map(([id,label])=>button(label,()=>{
    state.filter=id;render();$('list-bar').querySelector('[aria-pressed="true"]')?.focus();
  },{'aria-pressed':String(state.filter===id)}))));
  $('list').replaceChildren(...visible.map(r=>card(r,openCards.has(r.id))));
  if(!visible.length)$('list').append(el('div',{class:'empty'},[el('p',{text:incomplete.length?'本次尚未发现相关异议，且部分分析未完成。请查看待完成记录或重试。':'本次没有找到相关的异议或前提，不代表回答已经被验证。'}),button('查看相关回答',()=>{state.filter='focused';render();},{class:'btn'})]));
  $('coverage-note').textContent=data.situationCoverage.filter(c=>c.selected).map(c=>c.label+'「'+c.selected+'」：'+(c.count?c.count+' 条回答有相关条件原话':'暂无相关条件原话，未影响排序')).join('；')||'可先阅读，再按需要选择个人条件。';
  const meta=data.meta;
  $('source-note').replaceChildren(
    el('p',{text:meta.sourceNote||meta.description||'本次检索取得的有限样本。'}),
    el('p',{text:(meta.mode==='snapshot'?'离线样本生成时间':'检索时间')+'：'+(meta.builtAt||meta.capturedAt||'未记录')}),
    el('p',{text:meta.mode==='snapshot'?'异议由人工标注，并校验引文来源。摘要展示被回应的原句，其他条目按话题词选择原文片段，不当作主张总结。':'异议由模型归类，并校验引文来源。引文存在不代表语义分类正确。'}),
    el('p',{text:'“相关回答”按标题中的话题词筛选，可能漏选；另有 '+(data.records.length-focused.length)+' 条保留在全部样本中。统计基于全部 '+data.records.length+' 条，不代表知乎全量。'}),
    el('p',{text:'每条最多取得 3 条精选评论。没有评论数据、没有发现异议、以及异议不成立，是不同的情况。'})
  );
  const d=data.diagnostics;
  if(meta.pilot)$('source-note').append(el('p',{text:'当前为内部实时试用，模型效果尚未完成独立验收。'}));
  if(meta.requestId)$('source-note').append(el('p',{text:'本次请求编号：'+meta.requestId}));
  $('diag-slot').replaceChildren(el('p',{text:'全部样本：'+d.total+' 条；取得评论：'+d.commentBearing+' 条；带标记：'+d.flagged+' 条；异议与前提：'+d.substantiveObjections+' 条。'}));
  $('diag-slot').append(el('p',{text:'分析完成：'+d.analysisComplete+' 条；分析未完成：'+d.analysisIncomplete+' 条；无评论：'+d.noComments+' 条。'}));
  for(const [label,s] of [['全部样本',d.surfaces.whole],['有评论的样本',d.surfaces.withComments]]){
    $('diag-slot').append(el('label',{class:'coverage-bar'},[label+'中带标记 '+s.flagged+'/'+s.total+'（'+(s.ratio*100).toFixed(1)+'%）',el('progress',{max:1,value:s.ratio,'aria-label':label+'中带标记比例'})]));
  }
  $('diag-slot').append(el('p',{class:'note',text:'15% 为内部探索门槛，不是可信度指标。单次样本的比例和扫描结果不能推定产品的最大覆盖范围。'}));
  $('data-details').hidden=false;
}

function buildControls(){
  $('topic').replaceChildren(...state.config.topics.map(t=>el('option',{
    value:t.id,disabled:!t.availability[state.mode],
    text:t.title+(t.availability[state.mode]?'':'（'+(state.mode==='live'?t.availability.liveNote:t.availability.note)+'）')
  })));
  $('topic').value=state.topicId;
  for(const b of $('mode').querySelectorAll('button')){
    b.disabled=b.dataset.mode==='live'&&!state.config.liveReady;
    b.setAttribute('aria-pressed',String(b.dataset.mode===state.mode));
  }
  $('live-note').textContent=state.config.liveReady?(state.config.pilotEnabled?'实时内部试用 · 效果待验收':'实时检索可用'):'实时暂不可用，可先阅读离线样本';
  $('order').replaceChildren(...state.config.orders.map(o=>button(o.label,()=>{
    state.order=o.id;
    for(const b of $('order').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.order===o.id));
    render();
  },{'data-order':o.id,'aria-pressed':String(state.order===o.id),title:o.note})));
  const topic=state.config.topics.find(t=>t.id===state.topicId);
  $('situation-fields').replaceChildren(...topic.situationFields.map(field=>{
    const select=el('select',{id:'situation-'+field.id,'aria-label':field.label});
    select.append(el('option',{value:'',text:'不限'}),...field.options.map(v=>el('option',{value:v,text:v})));
    select.value=state.situation[field.id]||'';
    select.addEventListener('change',()=>{if(select.value)state.situation[field.id]=select.value;else delete state.situation[field.id];render();});
    return el('label',{class:'situation-field'},[field.label,select]);
  }));
}
$('topic').addEventListener('change',()=>{state.topicId=$('topic').value;state.situation={};state.filter='flagged';buildControls();run();});
$('mode').addEventListener('click',event=>{
  const b=event.target.closest('button[data-mode]');
  if(!b||b.disabled||b.dataset.mode===state.mode)return;
  state.mode=b.dataset.mode;
  if(!state.config.topics.find(t=>t.id===state.topicId)?.availability[state.mode])state.topicId=state.config.topics.find(t=>t.availability[state.mode]).id;
  state.situation={};state.filter='flagged';buildControls();run();
});
$('clear-situation').addEventListener('click',()=>{state.situation={};buildControls();render();});
async function boot(){
  try{
    const res=await fetch('/api/config',{signal:AbortSignal.timeout(10000)});
    if(!res.ok)throw new Error('配置读取失败');
    state.config=await res.json();
    const topic=state.config.topics.find(t=>t.availability.snapshot);
    if(!topic)throw new Error('暂无可用离线样本');
    state.topicId=topic.id;buildControls();await run();
  }catch{
    $('status').replaceChildren(el('p',{text:'暂时无法读取阅读设置，请确认服务已启动。'}),button('重新连接',boot,{class:'btn'}));
  }
}
boot();
