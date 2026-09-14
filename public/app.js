import {buildReadingMap,pushbackFor} from '/engine.js';
import {createReadingSession} from '/session.js';
import {buildGuidance} from '/advisor.js';
import {createI18n} from '/i18n.js';

const i18n=createI18n();
const ui=value=>i18n.text(value);
const UI_ATTRIBUTES=new Set(['title','aria-label','placeholder']);

// 示例问题都能秒开：第一个是人工标注的样本，其余是保存下来的实时结果（data/examples/）。
const EXAMPLES=[
  {question:'第一份工作选高薪小公司还是低薪大厂',sample:'first-job'},
  {question:'考研还是直接工作',saved:true},
  {question:'毕业去大城市还是回老家',saved:true},
  {question:'研究生毕业去国企还是私企',saved:true}
];
const isSaved=question=>EXAMPLES.some(e=>e.saved&&e.question===question);
// 默认只列出前几个分叉条件，其余按需展开。
const MAX_FORKS=3;

const TONE_PERSONAS=[
  {id:'rational',label:'理性分析',asset:'/assets/tone-hosts/rational.png'},
  {id:'sharp',label:'犀利反问',asset:'/assets/tone-hosts/sharp.png'},
  {id:'empathy',label:'温柔共情',asset:'/assets/tone-hosts/empathy.png'},
  {id:'humor',label:'幽默解构',asset:'/assets/tone-hosts/humor.png'},
  {id:'realist',label:'现实主义',asset:'/assets/tone-hosts/realist.png'},
  {id:'longterm',label:'长期主义',asset:'/assets/tone-hosts/longterm.png'},
  {id:'challenge',label:'反方挑战',asset:'/assets/tone-hosts/challenge.png'},
  {id:'socratic',label:'苏格拉底追问',asset:'/assets/tone-hosts/socratic.png'}
];
const toneById=id=>TONE_PERSONAS.find(t=>t.id===id)||TONE_PERSONAS[6];

const session=createReadingSession();
// activeReason 为 undefined 表示还没决定：宽屏默认展开第一条被评论区反驳的理由。
const state={config:null,view:null,appView:'home',filter:'flagged',showAllForks:false,selectedForks:{},activeReason:undefined,openSources:new Set(),advisor:freshAdvisor(),chatOpen:false,tone:'challenge',tableQuote:'a',tableReply:'',tableDraft:'',tableQuestion:'',tableThinking:false,tableListening:false,tableVoiceError:''};
// 登录账号与「知镜记住的情况」；没登录或没打开记住时，情况只存在这一页（localFacts）。
const account={available:false,user:null,profile:null,note:''};
const localFacts=[];
let localSeq=0,boardById=new Map();
const NO_PB={of:()=>[]};
function freshAdvisor(){return {turns:[],pending:false,draft:'',refocus:false};}
let openCards=null,ticker=null,speechRecognition=null;
let accountRevision=0;
const $=id=>document.getElementById(id);
function el(tag,props={},children=[]){
  const node=document.createElement(tag);
  for(const [key,value] of Object.entries(props)){
    if(key==='text')node.textContent=ui(value);
    else if(key==='class')node.className=value;
    else if(value!==false&&value!=null)node.setAttribute(key,String(UI_ATTRIBUTES.has(key)?ui(value):value));
  }
  for(const child of children.flat())if(child!=null)node.append(typeof child==='string'?document.createTextNode(ui(child)):child);
  return node;
}
const clear=node=>node.replaceChildren();
const button=(text,action,props={})=>{const b=el('button',{type:'button',text,...props});b.addEventListener('click',action);return b;};
const cleanTitle=title=>title.replace(/\s*-\s*知乎$/,'');

const APP_VIEWS=new Set(['home','table','zhihu','mine']);
function viewFromLocation(){
  const named=location.hash.replace(/^#/,'');
  return APP_VIEWS.has(named)?named:(new URLSearchParams(location.search).has('q')?'zhihu':'home');
}
function setAppView(next,{sync=true}={}){
  const name=APP_VIEWS.has(next)?next:'home';
  state.appView=name;
  $('home-view').hidden=name!=='home';
  $('table-view').hidden=name!=='table';
  $('zhihu-view').hidden=name!=='zhihu';
  $('mine-view').hidden=name!=='mine';
  // Keep one search form and one draft while moving between home and results.
  (name==='zhihu'?$('result-search-slot'):$('home-search-slot')).append($('search-panel'));
  for(const button of document.querySelectorAll('[data-view-target]')){
    const selected=button.dataset.viewTarget===(name==='zhihu'?'home':name);
    if(selected)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  }
  document.body.dataset.view=name;
  if(sync){
    const url=new URL(location.href);
    url.hash=name==='home'?(url.searchParams.has('q')?'home':''):name;
    history.pushState({appView:name},'',url);
  }
  renderAdvisor();
  scrollTo({top:0,behavior:'smooth'});
}

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
  for(const id of ['result-head','compare','table-result-head','table-stage','advisor','sources-summary','sources-note','list','list-bar','diag-slot','source-note'])clear($(id));
  for(const id of ['sources','data-details']){$(id).hidden=true;$(id).open=false;}
  $('advisor').hidden=true;$('chat-launcher').hidden=true;document.body.classList.remove('chat-open');
}
function setBusy(busy){
  $('ask-btn').disabled=busy;
  $('results').setAttribute('aria-busy',String(busy));
  for(const b of $('examples').querySelectorAll('button'))b.disabled=busy||(!b.dataset.sample&&!b.dataset.saved&&!state.config?.askReady);
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
  if(live)ticker=setInterval(()=>{elapsed.textContent=ui('已等待 '+Math.round((Date.now()-started)/1000)+' 秒');},1000);
}
function cancel(){
  session.cancel();stopTicker();setBusy(false);clearResults();
  $('status').textContent=ui('已取消。已经发出的分析可能还会在服务端跑完。');
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
function updateSearchNote(){
  $('ask-note').textContent=state.config?.askReady?'':ui('当前为示例模式，可阅读已保存的讨论；实时搜索尚未开放。');
}
function markExamples(){
  for(const b of $('examples').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.question===state.view?.question));
}

async function load(view,refresh=false){
  state.view=view;state.filter='flagged';state.showAllForks=false;state.selectedForks={};state.activeReason=undefined;
  state.openSources=new Set();state.advisor=freshAdvisor();state.tableQuote='a';state.tableReply='';state.tableDraft='';state.tableQuestion='';state.tableThinking=false;state.tableVoiceError='';
  $('q').value=view.question;updateSearchNote();
  closePost();
  syncUrl(view);markExamples();
  const live=view.kind==='ask';
  if(live&&!state.config?.askReady&&!isSaved(view.question)){
    session.cancel();stopTicker();setBusy(false);clearResults();clear($('error-slot'));clear($('status'));
    $('ask-note').textContent=ui('当前为示例模式，无法检索这个新问题。请选择下面的已保存示例。');
    return;
  }
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

// ── 镜像对照板：左栏固定是选项 A，右栏固定是选项 B；默认只给结论，原话点开再看 ──
// 署名：原话归还给答主，也方便读者判断是谁说的。
function attribution(e,record){
  if(!record)return e.kind==='comment'?'读者评论':'回答';
  const who=record.author||'匿名用户';
  return e.kind==='comment'?`读者评论 · 在 ${who} 的回答下`:`${who} · ${record.voteUp??'—'} 赞`;
}
function onlyConditions(list){return list.every(o=>o.type==='adds_condition');}
function evidenceOf(block){
  return [...block.sides.flatMap(s=>s.reasons.flatMap(r=>r.evidence)),...block.forks.flatMap(f=>f.branches.flatMap(b=>b.evidence))];
}
// 每条读者反驳全页只出现一次：优先挂在它针对的那一句下面；
// 针对整条回答的，挂在这条回答第一次被引用的地方，不再跟着同一回答的每句原话重复。
function assignPushback(block,byId){
  const assigned=new Map(),used=new Set();
  for(const pass of ['direct','rest']){
    for(const e of evidenceOf(block)){
      for(const o of pushbackFor(byId.get(e.recordId),e)){
        const key=e.recordId+':'+o.commentIndex;
        if(used.has(key)||(pass==='direct'&&!o.direct))continue;
        used.add(key);
        assigned.set(e,[...(assigned.get(e)||[]),o]);
      }
    }
  }
  return {of:e=>assigned.get(e)||[],total:used.size};
}

function firstTableQuote(block,sideIndex){
  const side=block?.sides?.find(item=>item.option===block.options?.[sideIndex]);
  return side?.reasons?.flatMap(reason=>reason.evidence||[])[0]||null;
}
function tableQuoteCard(option,e,byId,side){
  const record=e?byId.get(e.recordId):null;
  const selected=state.tableQuote===side;
  const node=el('article',{class:'table-quote '+side+(selected?' selected':''),tabindex:'0',role:'button','aria-pressed':String(selected),'data-table-quote':side,title:'选择并核对原话','aria-disabled':String(state.advisor.pending)},[
    el('p',{class:'table-quote-side',text:'知乎 · '+option}),
    el('h4',{text:'“'+(e?.text||`关于「${option}」的原话暂时缺席`)+'”'}),
    el('p',{class:'table-quote-meta',text:record?`${attribution(e,record)} · ${ui('核对原话')}`:'等待更多原话'})
  ]);
  const select=()=>{
    if(state.advisor.pending)return;
    state.tableQuote=side;state.tableReply='';state.tableQuestion='';render();
    const trigger=document.querySelector(`[data-table-quote="${side}"]`);
    if(record&&e)openPost(e,record,trigger);else trigger?.focus();
  };
  node.addEventListener('click',select);
  node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select();}});
  return node;
}
function askFromTable(activeQuote,message=state.tableDraft){
  const question=message.trim();
  if(!question){$('table-question')?.focus();return;}
  if(state.advisor.pending)return;
  state.tableQuestion=question;state.tableDraft=question;state.tableReply='';state.tableVoiceError='';
  if(!state.config?.adviceReady){
    state.tableThinking=false;
    state.tableReply='当前未开启 AI 陪伴，无法生成本次回答。问题已保留；点击桌面原话可核对全文，或在知乎现场选择条件后阅读两边材料。';
    render();return;
  }
  state.tableThinking=true;
  askAdvisor(question,{inlineTable:true,quote:activeQuote});
}
function startTableVoice(){
  const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SpeechRecognition){state.tableVoiceError='当前浏览器暂不支持语音输入，可以直接打字。';render();return;}
  if(state.tableListening&&speechRecognition){speechRecognition.stop();return;}
  const recognition=new SpeechRecognition();
  speechRecognition=recognition;recognition.lang=i18n.language==='en'?'en-US':'zh-CN';recognition.interimResults=true;recognition.continuous=false;
  state.tableListening=true;state.tableVoiceError='';render();
  recognition.onresult=event=>{
    state.tableDraft=Array.from(event.results).map(result=>result[0].transcript).join('');
    render();requestAnimationFrame(()=>$('table-question')?.focus());
  };
  recognition.onerror=()=>{state.tableVoiceError='没有听清，可以再试一次或直接打字。';};
  recognition.onend=()=>{if(speechRecognition===recognition)speechRecognition=null;state.tableListening=false;render();requestAnimationFrame(()=>$('table-question')?.focus());};
  try{recognition.start();}catch{state.tableListening=false;state.tableVoiceError='语音输入没有启动，请稍后再试。';render();}
}
function tableComposer(activeQuote){
  const input=el('input',{id:'table-question',type:'text',maxlength:'300',autocomplete:'off',enterkeyhint:'send',placeholder:'继续追问，比如：如果我更怕三年后后悔呢？'});
  input.value=state.tableDraft;
  input.addEventListener('input',()=>{state.tableDraft=input.value;});
  const form=el('form',{class:'table-composer'},[
    el('label',{for:'table-question',class:'sr-only',text:'继续追问'}),
    input,
    (()=>{const voice=button('',startTableVoice,{class:'table-voice','aria-label':state.tableListening?'停止':'语音','aria-pressed':String(state.tableListening),disabled:state.advisor.pending});voice.append(el('img',{src:'/assets/icons/microphone.svg',alt:'',width:20,height:20}));return voice;})(),
    el('button',{type:'submit',class:'table-send',disabled:state.advisor.pending,text:state.tableThinking?'思考中':'发送'})
  ]);
  form.addEventListener('submit',event=>{event.preventDefault();askFromTable(activeQuote,input.value);});
  return el('div',{class:'table-ask'},[
    form,
    el('p',{class:'table-ask-hint',text:state.tableVoiceError||(state.tableListening?'正在听你说…':'可打字，也可用语音输入 · Enter 发送')})
  ]);
}
function opinionStage(block,records){
  if(block?.status!=='complete'||!block.options?.length)return null;
  const byId=new Map(records.map(r=>[r.id,r]));
  const quotes=[firstTableQuote(block,0),firstTableQuote(block,1)];
  const active=quotes[state.tableQuote==='b'?1:0]||quotes.find(Boolean);
  const objection=pushbackFor(byId.get(active?.recordId),active)[0]||null;
  const seats=TONE_PERSONAS.map((tone,index)=>{
    const selected=tone.id===state.tone;
    const seat=el('button',{type:'button',class:'tone-seat seat-'+index+(selected?' selected':'')+(state.tableThinking?' thinking':''),'aria-pressed':String(selected),'data-tone':tone.id,disabled:state.advisor.pending,title:'用'+tone.label+'的方式说'},[
      state.tableThinking?el('span',{class:'seat-thought','aria-hidden':'true'},[el('i'),el('i'),el('i')]):null,
      el('span',{class:'seat-visual','aria-hidden':'true'},[
        el('img',{class:'seat-chair',src:'/assets/table/chair.png',alt:'',width:'180',height:'180'}),
        el('img',{class:'seat-mascot',src:tone.asset,alt:'',width:'168',height:'168'})
      ]),
      el('span',{class:'tone-name',text:tone.label})
    ]);
    seat.addEventListener('click',()=>{state.tone=tone.id;state.tableReply='';state.tableQuestion='';render();requestAnimationFrame(()=>document.querySelector(`[data-tone="${tone.id}"]`)?.focus());});
    return seat;
  });
  const speech=state.tableThinking?'知镜正在结合当前原话和你的问题思考…':state.tableReply||(state.config?.adviceReady?'已选择当前语气。输入问题后，知镜会结合当前话题的原话回答。':'当前为示例阅读，AI 陪伴尚未开启。点击桌面原话可核对来源。');
  return el('section',{class:'opinion-stage','aria-labelledby':'table-title'},[
    el('div',{class:'stage-heading'},[
      el('div',{},[
        el('h3',{id:'table-title',text:'同一句话，换个角度听。'}),
        el('p',{text:'同一个问题，多种视角。选择一个看法，让它换个角度说。'})
      ]),
      el('p',{class:'stage-trust',text:state.config?.adviceReady?'AI 演绎，不替你做决定':'已保存的知乎原话 · 可核对来源'})
    ]),
    el('div',{class:'opinion-table'},[
      el('img',{class:'chair-ring',src:'/assets/table/chair-ring.png',alt:'',width:'1496',height:'1051','aria-hidden':'true'}),
      el('img',{class:'tabletop-layer',src:'/assets/table/tabletop-light.png',alt:'',width:'1634',height:'847','aria-hidden':'true'}),
      el('div',{class:'table-center'},[
        tableQuoteCard(block.options[0],quotes[0],byId,'a'),
        tableQuoteCard(block.options[1],quotes[1],byId,'b'),
        objection?el('aside',{class:'table-objection'},[
          el('span',{text:ui(objection.typeLabel||'读者异议')+' · '+ui(objection.direct?'针对这句话':'针对这条回答')}),
          el('p',{text:'“'+objection.commentText+'”'})
        ]):null
      ]),
      ...seats
    ]),
    el('aside',{class:'table-conversation'},[
    el('div',{class:'table-response'+(state.tableThinking?' thinking':''),'aria-live':'polite'},[
      el('img',{src:toneById(state.tone).asset,alt:'',width:'52',height:'52'}),
      el('div',{},[
        el('p',{class:'response-label',text:toneById(state.tone).label+' · 知镜'}),
        state.tableQuestion?el('p',{class:'response-question',text:'你问：'+state.tableQuestion}):null,
        el('p',{text:speech})
      ])
    ]),
    el('div',{class:'table-followups'},[el('h4',{text:'也可以问'}),...QUICK_ASKS.map(question=>button(question,()=>{state.tableDraft=question;render();requestAnimationFrame(()=>$('table-question')?.focus());},{class:'followup-question',disabled:state.advisor.pending}))]),
    tableComposer(active),
    el('p',{class:'conversation-trust',text:'不替你做决定，只提供多角度的分析。'})
    ]),
    button('补充适用条件',()=>{setAppView('zhihu');const board=document.querySelector('.full-board');if(board)board.open=true;$('forks-title')?.scrollIntoView({behavior:'smooth',block:'start'});},{class:'table-conditions'})
  ]);
}
function pushbackChip(evidence,pb){
  const all=evidence.flatMap(e=>pb.of(e));
  if(!all.length)return null;
  const cond=onlyConditions(all);
  return el('span',{class:'pb-chip'+(cond?' cond':''),text:cond?'有人补了前提':'有人不同意'});
}
// 突出点：被引用的高赞原话下面，直接挂评论区里读者当场的反驳或补充，永远展示读者原话。
function pushbackBlock(list){
  if(!list.length)return null;
  const cond=onlyConditions(list);
  return el('div',{class:'pushback'+(cond?' cond':'')},[
    el('p',{class:'pushback-head',text:(cond?'评论区有读者补了前提':'评论区有读者当场不同意')+(list.length>1?`（${list.length} 条）`:'')}),
    ...list.map(o=>el('figure',{class:'pb-item'},[
      el('blockquote',{text:o.commentText}),
      el('figcaption',{text:o.typeLabel+' · '+(o.direct?'针对这句话':'针对这条回答')+' · 读者评论原话'})
    ]))
  ]);
}
// ── 原帖面板：点任意一句原话，看它在原回答里的位置和这条回答的精选评论，再去知乎看全文 ──
// 去知乎的链接附带文本片段（#:~:text=），浏览器支持且知乎页面展开时会直接定位到这句；不支持也照常打开。
function textFragment(quote){
  const enc=s=>encodeURIComponent(s).replace(/-/g,'%2D').replace(/,/g,'%2C');
  const q=quote.trim().replace(/[。！？；，、\s]+$/,'');
  return '#:~:text='+(q.length<=48?enc(q):enc(q.slice(0,18))+','+enc(q.slice(-18)));
}
function zhihuAnchor(record,e,label,cls='src'){
  try{
    const u=new URL(record.url);
    if(u.protocol!=='https:'||!(u.hostname==='zhihu.com'||u.hostname.endsWith('.zhihu.com')))return null;
    u.hash='';
    return el('a',{href:u.href+(e?.kind==='answer'?textFragment(e.text):''),target:'_blank',rel:'noopener noreferrer',class:cls,text:label});
  }catch{return null;}
}
let postReturnFocus=null;
const postInert=new Map();
function openPost(e,record,trigger){
  const drawer=$('post-drawer');
  const quote=e.kind==='answer'?e.text:null;
  let marked=false;
  const paragraphs=record.text.split(/\n+/).map(s=>s.trim()).filter(Boolean).map(p=>{
    const at=quote&&!marked?p.indexOf(quote):-1;
    if(at<0)return el('p',{text:p});
    marked=true;
    return el('p',{},[p.slice(0,at),el('mark',{id:'post-hit',text:quote}),p.slice(at+quote.length)]);
  });
  const objectionByComment=new Map((record.objections||[]).map(o=>[o.commentIndex,o]));
  const comments=(record.comments||[]).map((text,i)=>{
    const o=objectionByComment.get(i);
    const hit=e.kind==='comment'&&e.commentIndex===i;
    return el('li',{class:'post-comment'+(o?(o.type==='adds_condition'?' cond':' pushed'):'')+(hit?' hit':''),id:hit?'post-hit':false},[
      o?el('span',{class:'pb-chip'+(o.type==='adds_condition'?' cond':''),text:o.typeLabel}):null,
      el('p',{text:text})
    ]);
  });
  const copied=el('span',{class:'note',role:'status'});
  const isArticle=/zhuanlan\.zhihu\.com|\/p\/\d+/.test(record.url||'');
  drawer.replaceChildren(
    el('div',{class:'drawer-backdrop','data-close':'1'}),
    el('section',{class:'drawer-panel',role:'dialog','aria-modal':'true','aria-labelledby':'post-title'},[
      el('header',{class:'drawer-head'},[
        el('p',{class:'drawer-kicker',text:isArticle?'知乎文章':'知乎回答'}),
        el('h2',{id:'post-title',class:'drawer-title',text:cleanTitle(record.title)}),
        el('p',{class:'meta',text:(record.author||'匿名用户')+' · '+(record.voteUp??'—')+' 赞 · 原站评论 '+(record.commentCount??'未知')}),
        button('关闭',closePost,{class:'drawer-close','aria-label':'关闭原帖'})
      ]),
      el('div',{class:'drawer-body'},[
        el('p',{class:'note',text:'以下是知乎接口返回的正文（可能是摘要）。'+(quote?'高亮的是被引用的那一句，程序按编号从原文取出，一字未改。':'被引用的是下面高亮的那条评论。')}),
        el('div',{class:'post-text'},paragraphs),
        el('h3',{class:'post-sub',text:'这条回答的精选评论'}),
        comments.length?el('ul',{class:'post-comments'},comments):el('p',{class:'note',text:'这次没有取到这条回答的评论。'})
      ]),
      el('footer',{class:'drawer-foot'},[
        zhihuAnchor(record,e,'去知乎看全文 · 给答主点赞','btn'),
        button('复制这句',async()=>{
          try{await navigator.clipboard.writeText(e.text);copied.textContent=ui('已复制，可以在知乎页面里搜索定位。');}
          catch{copied.textContent=ui('没能复制，请手动选中上面的原话。');}
        },{class:'btn ghost'}),
        copied
      ])
    ])
  );
  for(const node of document.body.children){
    if(node===drawer||['SCRIPT','STYLE'].includes(node.tagName))continue;
    if(!postInert.has(node))postInert.set(node,node.inert);node.inert=true;
  }
  drawer.hidden=false;
  document.body.classList.add('drawer-open');
  postReturnFocus=trigger||null;
  drawer.querySelector('.drawer-close').focus();
  requestAnimationFrame(()=>document.getElementById('post-hit')?.scrollIntoView({block:'center'}));
}
function closePost(){
  const drawer=$('post-drawer');
  if(drawer.hidden)return;
  drawer.hidden=true;clear(drawer);
  document.body.classList.remove('drawer-open');
  for(const [node,inert] of postInert)node.inert=inert;postInert.clear();
  if(postReturnFocus?.isConnected)postReturnFocus.focus();postReturnFocus=null;
}
$('post-drawer').addEventListener('click',event=>{if(event.target.dataset?.close)closePost();});
document.addEventListener('keydown',event=>{
  const drawer=$('post-drawer');
  if(!drawer.hidden&&event.key==='Tab'){
    const focusable=[...drawer.querySelectorAll('button:not(:disabled),a[href],[tabindex="0"]')];
    const first=focusable[0],last=focusable.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
  if(event.key!=='Escape')return;
  if(!$('post-drawer').hidden)closePost();
  else if(state.chatOpen&&!wideChat()&&!$('advisor').hidden)closeChat();
});

function evidenceFigure(e,byId,pb,{ask=true}={}){
  const record=byId.get(e.recordId);
  const open=event=>record&&openPost(e,record,event.currentTarget);
  const quote=el('blockquote',{text:e.text,class:record?'clickable':false,tabindex:record?'0':false,role:record?'button':false,title:record?'看原帖':false});
  if(record){
    quote.addEventListener('click',open);
    quote.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open(event);}});
  }
  return el('figure',{class:'evidence'},[
    quote,
    el('figcaption',{},[
      el('span',{text:attribution(e,record)}),
      record?button('看原帖',open,{class:'link-btn'}):null,
      record?zhihuAnchor(record,e,'知乎 ↗'):null,
      ask&&state.config?.adviceReady?button('这句适合我吗？',()=>askAboutQuote(e),{class:'link-btn ask-link'}):null
    ]),
    // 答主在同一回答里交代的适用范围：原话逐字正确，不代表放在这里的用法没有前提。
    e.premise?.text?el('p',{class:'premise'},[el('span',{class:'premise-tag',text:'答主自己交代的前提'}),el('span',{text:e.premise.text})]):null,
    pushbackBlock(pb.of(e))
  ]);
}
function comparisonSections(block,records,sample){
  const byId=new Map(records.map(r=>[r.id,r]));
  boardById=byId;
  const hasSides=block?.sides?.some(s=>s.reasons.length);
  if(block?.status!=='complete'||(!hasSides&&!block.forks.length)){
    const message=block?.status==='failed'?'这次没能整理出对比（模型请求失败）。'
      :block?.status==='not_comparable'?'这个问题不太像二选一，没法并排对比。换成「A 还是 B」的问法试试。'
      :sample&&!block?'这个示例还没有整理好的对比图。':'这次没从原话里整理出明确的对比，可以直接看下面的原始回答。';
    return [el('div',{class:'board-empty'},[
      message,block?.status==='failed'?button('重新整理',()=>load(state.view,true),{class:'link-btn'}):null
    ])];
  }
  const [A,B]=block.options;
  const sideOf=option=>option===B?'b':'a';
  const pb=assignPushback(block,byId);
  const tag=option=>el('p',{class:'cell-tag '+sideOf(option),text:'选'+option});

  // 表头：两个选项，滚动时固定在顶部，下面每一格都按左右对应。
  const parts=[el('div',{class:'board-head'},[A,B].map(option=>el('div',{class:'board-col '+sideOf(option)},[
    el('span',{class:'col-kicker',text:'选'}),el('span',{class:'col-name',text:option})
  ])))];

  if(hasSides){
    const reasonsOf=option=>block.sides.find(s=>s.option===option)?.reasons||[];
    const reasonKey=(option,index)=>option+'\u0000'+index;
    // 宽屏默认展开第一条带评论区反驳的理由（通栏展示，不撑高单侧），让突出点不用点就能看到；手机上全部收起。
    if(state.activeReason===undefined){
      state.activeReason=null;
      if(matchMedia('(min-width: 641px)').matches){
        for(const option of [A,B]){
          const index=reasonsOf(option).findIndex(r=>pushbackChip(r.evidence,pb));
          if(index>=0){state.activeReason=reasonKey(option,index);break;}
        }
      }
    }
    const selected=state.activeReason?(()=>{
      const [option,index]=state.activeReason.split('\u0000');
      const reason=reasonsOf(option)[Number(index)];
      return reason?{option,reason}:null;
    })():null;
    parts.push(el('section',{class:'board-section','aria-labelledby':'sides-title'},[
      el('h3',{id:'sides-title',class:'board-label',text:'他们怎么说'}),
      el('div',{class:'board-row'},[A,B].map(option=>el('div',{class:'board-cell '+sideOf(option)},[
        tag(option),
        reasonsOf(option).length
          ?el('ul',{class:'reasons'},reasonsOf(option).map((r,index)=>el('li',{},[
            button(r.label,()=>{state.activeReason=state.activeReason===reasonKey(option,index)?null:reasonKey(option,index);render();},{
              class:'reason-button','aria-expanded':String(state.activeReason===reasonKey(option,index))
            }),pushbackChip(r.evidence,pb)
          ])))
          :el('p',{class:'note',text:'这一边没找到理由。'})
      ]))),
      selected?el('section',{class:'reason-focus','aria-live':'polite'},[
        el('div',{class:'reason-focus-head'},[
          el('div',{},[el('p',{class:'cell-tag '+sideOf(selected.option),text:'选'+selected.option}),el('h4',{text:selected.reason.label})]),
          button('收起',()=>{state.activeReason=null;render();},{class:'link-btn'})
        ]),
        ...selected.reason.evidence.map(e=>evidenceFigure(e,byId,pb))
      ]):null
    ]));
  }

  if(block.forks.length){
    const shown=state.showAllForks?block.forks:block.forks.slice(0,MAX_FORKS);
    const rest=block.forks.length-shown.length;
    const guidance=buildGuidance(block,state.selectedForks,i18n.language);
    const selectBranch=(forkIndex,branchIndex)=>{
      const next={...state.selectedForks};
      if(next[forkIndex]===branchIndex)delete next[forkIndex];else next[forkIndex]=branchIndex;
      state.selectedForks=next;
      if(next[forkIndex]!=null)state.openSources.add(forkIndex);
      render();
      document.querySelector(`[data-choice="${forkIndex}-${branchIndex}"]`)?.focus();
    };
    const canAsk=!!state.config?.adviceReady;
    parts.push(el('section',{class:'board-section','aria-labelledby':'forks-title'},[
      el('h3',{id:'forks-title',class:'board-label',text:'哪些情况更接近你'}),
      el('div',{class:'guide '+guidance.state,role:'status'},[
        el('h4',{text:guidance.title}),el('p',{text:[guidance.message,...guidance.tasks.map(task=>task.text)].join(' ')}),
        guidance.groups.length?el('div',{class:'guide-groups'},guidance.groups.map(group=>el('span',{class:'guide-pick '+sideOf(group.option)},[
          el('strong',{text:group.option+'：'}),group.matches.map(m=>situationText({label:m.question},m)).join('、')
        ]))):null,
        guidance.picked.length&&canAsk?button('结合这些情况问知镜',()=>{
          openChat({focus:false});
          askAdvisor(QUICK_ASKS[0]);
        },{class:'btn small guide-cta',disabled:state.advisor.pending}):null
      ]),
      el('ol',{class:'forks'},shown.map((f,i)=>{
        const picked=state.selectedForks[i];
        const choice=(b,j)=>{
          const node=el('button',{type:'button',class:'fork-choice '+sideOf(b.lean),'aria-pressed':String(picked===j),'data-choice':i+'-'+j},[
            el('span',{text:b.when}),pushbackChip(b.evidence,pb)
          ]);
          node.addEventListener('click',()=>selectBranch(i,j));
          return node;
        };
        // 两边的原话始终并排；选了哪边，就在哪边标出来，另一边照常展示。
        const sources=el('details',{class:'fork-source',open:state.openSources.has(i)},[
          el('summary',{text:picked==null?'看两边的原话':'看两边的原话（你选的那边已标出）'}),
          el('div',{class:'board-row fork-evidence'},f.branches.map((b,j)=>el('div',{class:'board-cell '+sideOf(b.lean)+(picked===j?' picked':'')},[
            el('p',{class:'cell-tag '+sideOf(b.lean),text:(picked===j?'你选的 · ':'')+b.when}),
            ...b.evidence.map(e=>evidenceFigure(e,byId,pb))
          ])))
        ]);
        sources.addEventListener('toggle',()=>{if(sources.open)state.openSources.add(i);else state.openSources.delete(i);});
        return el('li',{class:'fork'},[
          el('p',{class:'fork-q',id:'fork-q-'+i,text:f.label}),
          el('div',{class:'fork-cells',role:'group','aria-labelledby':'fork-q-'+i},f.branches.map(choice)),
          sources
        ]);
      })),
      rest>0?button('再看 '+rest+' 个条件',()=>{state.showAllForks=true;render();},{class:'more-forks'}):null
    ]));
  }
  const full=el('details',{class:'full-board',open:true},[
    el('summary',{text:'展开完整对照与个人条件'}),
    el('div',{class:'board'},parts)
  ]);
  return [full];
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
        try{await navigator.clipboard.writeText(o.commentText);copied.textContent=ui('已复制评论原话。');}
        catch{copied.textContent=ui('未能复制，请选中上方原话手动复制。');}
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
  const saved=!!data.meta.saved;
  const savedDay=saved?new Date(data.meta.savedAt).toLocaleDateString(i18n.language==='en'?'en-US':'zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric'}):'';
  const focused=data.records.filter(r=>r.focused),flagged=focused.filter(r=>r.objections.length);
  if(openCards===null)openCards=new Set();
  const incomplete=data.records.filter(r=>['failed','partial'].includes(r.analysis?.status));
  if(state.filter==='incomplete'&&!incomplete.length)state.filter='flagged';
  if(state.filter==='flagged'&&!flagged.length)state.filter='focused';
  const visible=state.filter==='flagged'?flagged:state.filter==='focused'?focused:state.filter==='incomplete'?incomplete:data.records;

  const comparison=dataset.comparison;
  const pushed=comparison?.status==='complete'?assignPushback(comparison,new Map(data.records.map(r=>[r.id,r]))).total:0;
  // 结果头只留问题和一行说明，AI 与数据口径收进页面底部。
  const head=[
    el('h2',{class:'result-title',text:data.meta.question||data.topic.title}),
    el('p',{class:'result-meta'},[
      el('span',{text:(sample?'示例数据 · ':saved?`示例 · ${savedDay} 实时检索保存 · `:'')+`读了 ${focused.length} 条相关回答`
        +(pushed?` · 评论区 ${pushed} 条读者反驳或补充`:'')+' · 原话一字未改'}),
      button('怎么来的？',()=>{$('data-details').open=true;$('data-details').scrollIntoView({behavior:'smooth',block:'start'});},{class:'link-btn'}),
      (sample||saved)&&state.config?.askReady?button('用实时检索重新找',()=>load({kind:'ask',question:saved?data.meta.question:data.topic.title},saved),{class:'link-btn'}):null
    ])
  ];
  if(incomplete.length||data.meta.failedQueries){
    head.push(el('p',{class:'note warn'},['这次结果不完整：'+incomplete.length+' 条分析没完成，'+(data.meta.failedQueries||0)+' 路检索失败。',button('重新分析',()=>load(state.view,true),{class:'link-btn'})]));
  }
  $('result-head').replaceChildren(...head);
  $('compare').replaceChildren(...comparisonSections(comparison,data.records,sample));
  $('table-result-head').replaceChildren(
    el('span',{class:'table-topic-kicker',text:'正在讨论'}),
    el('strong',{text:data.meta.question||data.topic.title}),
    button('换一个话题',()=>setAppView('home'),{class:'switch-view compact'})
  );
  const table=opinionStage(comparison,data.records);
  $('table-stage').replaceChildren(table||el('div',{class:'board-empty',text:'这个话题暂时还没有可以摆上桌的双边观点。'}));

  $('sources-summary').textContent=ui(`原始回答与评论区 · ${focused.length} 条`+(flagged.length?`（${flagged.length} 条被读者反驳）`:''));
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
    el('p',{text:'对比图由模型从赞数靠前的 24 条相关回答和它们的精选评论里整理：程序先把回答切句编号，模型只挑编号，页面按编号取原文，所以引号里的话一字未改。归纳本身可能不全或不准。答主在同一回答里交代了适用前提的，前提句也按编号取出，标在原话下面。'}),
    el('p',{text:'「结合你的情况」由模型只用这张对比图里的原话和你确认过的情况作答：判断后面的原话按编号取回，没有原话支持的标成「推测」；从你的话里听出的情况，要你点「记下」才会用。它不给胜率，也不替你选。'}),
    el('p',{text:'原话下面挂的读者反驳，来自同一条回答的精选评论，由'+(sample?'人工标注':'模型归类并复核投票')+'挑出，并展示评论原话供你判断。每条反驳全页只出现一次：标「针对这句话」的，是评论回应的原句与这句有重合；其余是针对整条回答，挂在这条回答第一次被引用的地方。有人反驳不代表反驳成立。'}),
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
  renderAdvisor();
}

// ── 知镜记住的情况：只对读到知乎资料的登录用户开放；打开「记住」才写进数据库 ──
const FACT_LABELS={stage:'当前阶段',finance:'经济状况',city:'城市与家庭',timeline:'时间窗口',risk:'风险承受',priority:'最看重',dealbreaker:'不能接受',other:'其他情况'};
const personalized=()=>!!account.profile?.personalize;
const allFacts=()=>personalized()?account.profile.facts:localFacts;
const confirmedFacts=()=>allFacts().filter(f=>f.status==='confirmed');
let factNote='',inferState={running:false,note:'',relogin:false},deleteArmed=false;

async function profileCall(path,body,method='POST'){
  const revision=accountRevision;
  const res=await fetch(path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
  const data=await res.json().catch(()=>({}));
  if(revision!==accountRevision)throw Object.assign(new Error('登录状态已变化，请重试。'),{stale:true});
  if(!res.ok)throw Object.assign(new Error(data.error||'没能保存，请稍后再试。'),{relogin:!!data.relogin});
  return data;
}
async function loadProfile(){
  const revision=accountRevision;
  account.profile=null;
  if(account.user?.canRemember){
    try{account.profile=await profileCall('/api/profile',undefined,'GET');}catch{if(revision!==accountRevision)return;account.profile=null;}
  }
  renderAdvisor();renderMine();
}
async function factAction(run){
  factNote='';
  try{await run();}catch(error){if(error.stale)return;factNote=error.message||'没能保存，请稍后再试。';}
  renderAdvisor();renderMine();
}
const isLocal=fact=>String(fact.id).startsWith('l');
function addFact(key,value,{source='declared',evidenceRef=''}={}){
  return factAction(async()=>{
    if(personalized())account.profile=await profileCall('/api/profile/facts',{action:'add',key,value,evidenceRef});
    else if(!localFacts.some(f=>f.key===key&&f.value===value))localFacts.push({id:'l'+(++localSeq),key,value,source,status:'confirmed',evidenceRef});
  });
}
function confirmFact(fact){
  return factAction(async()=>{
    if(personalized()&&!isLocal(fact))account.profile=await profileCall('/api/profile/facts',{action:'confirm',id:fact.id});
    else fact.status='confirmed';
  });
}
function removeFact(fact){
  return factAction(async()=>{
    if(personalized()&&!isLocal(fact))account.profile=await profileCall('/api/profile/facts',{action:'delete',id:fact.id});
    else{const at=localFacts.indexOf(fact);if(at>=0)localFacts.splice(at,1);}
  });
}
function setPersonalize(on){
  return factAction(async()=>{
    account.profile=await profileCall('/api/profile/personalize',{on});
    // 打开时，把这一页上已经确认过的情况一起记下。
    if(on){
      for(const f of localFacts.filter(f=>f.status==='confirmed'))account.profile=await profileCall('/api/profile/facts',{action:'add',key:f.key,value:f.value,evidenceRef:f.evidenceRef});
      localFacts.length=0;
    }
  });
}
function inferFromCollections(){
  inferState={running:true,note:'',relogin:false};renderMine();
  profileCall('/api/profile/infer',{}).then(data=>{
    if(personalized())account.profile={personalize:data.personalize,consentAt:data.consentAt,facts:data.facts,decisions:data.decisions};
    else for(const p of data.proposals)if(!localFacts.some(f=>f.key===p.key&&f.value===p.value))localFacts.push({id:'l'+(++localSeq),key:p.key,value:p.value,source:'inferred',status:'pending',evidenceRef:p.evidenceRef});
    inferState={running:false,relogin:false,note:data.proposals.length?`从你最近的收藏里推测了 ${data.proposals.length} 条，你确认之后才会用上。`:'从你最近的收藏里没看出和做选择有关的情况。'};
  }).catch(error=>{if(!error.stale)inferState={running:false,note:error.message,relogin:!!error.relogin};})
    .finally(()=>{renderMine();renderAdvisor();});
}
function deleteEverything(){
  if(!deleteArmed){deleteArmed=true;renderMine();setTimeout(()=>{deleteArmed=false;renderMine();},6000);return;}
  deleteArmed=false;
  profileCall('/api/profile',undefined,'DELETE')
    .then(()=>renderAccount({available:true,user:null},'已删除你在知镜的全部数据，并退出登录。'))
    .catch(error=>{factNote=error.message;renderMine();});
}
function factChip(f){
  return el('span',{class:'sit-chip'},[
    el('span',{class:'sit-k',text:FACT_LABELS[f.key]||'情况'}),el('span',{text:f.value}),
    f.source==='inferred'?el('span',{class:'sit-src',text:'来自收藏'}):null,
    button('×',()=>removeFact(f),{class:'sit-x','aria-label':'删除「'+f.value+'」',title:'删除'})
  ]);
}
function pendingRow(f){
  return el('div',{class:'sit-pending'},[
    el('p',{},[el('span',{class:'sit-k',text:'知镜猜'}),`${f.value}（${FACT_LABELS[f.key]||'情况'}），对吗？`]),
    f.evidenceRef?el('p',{class:'note',text:'依据：'+f.evidenceRef}):null,
    el('div',{class:'row'},[button('对，记下',()=>confirmFact(f),{class:'btn small'}),button('不对',()=>removeFact(f),{class:'btn ghost small'})])
  ]);
}
function memoryBlock(){
  if(!account.user)return null;
  const parts=[el('h3',{class:'mine-sub',text:'知镜记住的情况'})];
  if(!account.user.canRemember){
    parts.push(el('p',{class:'note',text:'没读到你的知乎资料，暂时不能记住你的情况。'}));
    return el('section',{class:'mine-memory'},parts);
  }
  const p=account.profile;
  const inferBtn=button(inferState.running?'正在读你的收藏…':'用我的收藏推测我在考虑什么',inferFromCollections,{class:'btn ghost small',disabled:inferState.running});
  const deleteBtn=button(deleteArmed?'确定删除？再点一次':'删除我在知镜的全部数据',deleteEverything,{class:'link-btn danger'});
  if(!p)parts.push(el('p',{class:'note',text:'正在读取…'}));
  else if(!p.personalize){
    parts.push(
      el('p',{class:'note',text:'还没打开。打开后，你告诉知镜的情况和想过的问题会存进知镜的数据库，下次登录还在；随时可以删，关掉就全部删除。知乎授权 token 不保存。'}),
      el('div',{class:'row'},[button('记住我的情况',()=>setPersonalize(true),{class:'btn small'}),inferBtn,deleteBtn])
    );
  }else{
    const confirmed=p.facts.filter(f=>f.status==='confirmed');
    parts.push(
      confirmed.length?el('div',{class:'sit-chips'},confirmed.map(factChip)):el('p',{class:'note',text:'还没有记下的情况。和知镜聊的时候，它会问你要不要记下。'}),
      ...p.facts.filter(f=>f.status==='pending').map(pendingRow),
      p.decisions.length?el('div',{class:'mine-decisions'},[
        el('p',{class:'note',text:'最近想过的问题：'}),
        el('div',{class:'chips'},p.decisions.map(d=>button(d.question.length>24?d.question.slice(0,24)+'…':d.question,()=>{
          try{openQuestion(viewFor(normalizeQuestion(d.question)));}catch(error){$('ask-note').textContent=error.message;}
        },{class:'chip-btn',title:d.note?'上次知镜的建议：'+d.note:d.question})))
      ]):null,
      el('div',{class:'row'},[inferBtn,button('关掉并删除这些情况',()=>setPersonalize(false),{class:'link-btn'}),deleteBtn]),
      el('p',{class:'note',text:'存了什么：知乎昵称和头像、你确认过的情况（180 天后自动过期）、想过的问题和选过的条件。推测的情况 7 天内不确认就删除。'})
    );
  }
  if(inferState.note)parts.push(el('p',{class:'note'+(inferState.relogin?' warn':'')},[inferState.note,' ',inferState.relogin?reloginLink():null]));
  if(factNote)parts.push(el('p',{class:'note warn',text:factNote}));
  return el('section',{class:'mine-memory'},parts);
}

// ── 问知镜（聊天）：结合用户确认过的情况，用对照板里的原话帮他理清要核对什么；不替用户做决定 ──
// 宽屏固定在右侧、窄屏从右侧滑出、手机全屏；收起后留右下角按钮。
// 每次回复只说一句复述、最关键的两条判断和一个追问；反驳、缺口、补搜、下一步由用户点快捷回复展开（本地展开，不再调模型）。
const QUICK_ASKS=['结合我的情况帮我梳理','反对的声音主要在说什么','我还需要先弄清楚什么'];
// 条件的回答只是「是（如AI、金融）」「否」这类时，脱离问题看不懂：前面补上问题（与 src/peers.mjs situationValue 同一规则）。
const situationText=(fork,branch)=>/^(是|否|有|没有|会|不会|能|不能|要|不要|对|不对)/.test(branch.when)||branch.when.length<=3
  ?`${fork.label.replace(/[？?]\s*$/,'')}：${branch.when}`:branch.when;
const PEER_ASK='帮我找和我情况像的人';
const MAIN_POINTS=2;
const turnSummary=reply=>[reply.understanding,reply.advice?.text,reply.nextQuestion?.text].filter(Boolean).join(' ').slice(0,400);
const viewRef=view=>view.kind==='sample'?{kind:'sample',topicId:view.topicId}:{kind:'ask',question:view.question};
const selectionsOf=()=>Object.entries(state.selectedForks).map(([fork,branch])=>({fork:Number(fork),branch}));
const factsOf=()=>confirmedFacts().map(({key,value})=>({key,value}));
const hasSituation=()=>confirmedFacts().length+Object.keys(state.selectedForks).length>0;
const wideChat=()=>matchMedia('(min-width: 1200px)').matches;

function openChat({focus=true}={}){
  state.chatOpen=true;renderAdvisor();
  if(focus)requestAnimationFrame(()=>$('advisor-input')?.focus({preventScroll:true}));
}
function closeChat(){state.chatOpen=false;renderAdvisor();$('chat-launcher').focus();}
function restartChat(){if(!state.advisor.pending){state.advisor=freshAdvisor();render();}}
$('chat-launcher').addEventListener('click',()=>openChat());

async function chatRequest(path,body,turn,onOk){
  const advisor=state.advisor;
  advisor.turns.push(turn);advisor.pending=true;advisor.draft='';
  render();
  try{
    const res=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
    const data=await res.json().catch(()=>({}));
    if(state.advisor!==advisor)return;
    if(res.ok)onOk(data);
    else{turn.error=data.error||'知镜这次没能回复，请稍后再试。';turn.expired=!!data.expired;}
  }catch{
    if(state.advisor!==advisor)return;
    turn.error='连接中断或等太久了，请重试。';
  }
  advisor.pending=false;
  render();
}
async function askAdvisor(message,{inlineTable=false,quote=null}={}){
  const view=state.view,advisor=state.advisor;
  if(!view||advisor.pending||!state.config?.adviceReady||!message)return;
  const tone=toneById(state.tone);
  const history=advisor.turns.filter(t=>t.kind==='advice').slice(-3)
    .flatMap(t=>[{role:'user',text:t.message},t.reply?{role:'assistant',text:turnSummary(t.reply)}:null]).filter(Boolean);
  const displayMessage=ui(message);
  const turn={kind:'advice',message:displayMessage,reply:null,error:''};
  await chatRequest('/api/advice',{ref:viewRef(view),selections:selectionsOf(),facts:factsOf(),history,message,tone:tone.id,language:i18n.language,focus:quote},turn,data=>{turn.reply=data;});
  if(state.advisor!==advisor||state.view!==view)return;
  if(inlineTable){
    state.tableThinking=false;
    state.tableReply=turn.reply?turnSummary(turn.reply):(turn.error||'知镜这次没能回复，请稍后再试。');
    if(turn.reply&&state.tableDraft===message)state.tableDraft='';
    if(turn.error)state.tableVoiceError=turn.error;
    render();requestAnimationFrame(()=>$('table-question')?.focus());
  }
}
function findPeersFor(){
  const view=state.view,advisor=state.advisor;
  if(!view||advisor.pending||!state.config?.adviceReady||!hasSituation())return;
  const turn={kind:'peers',message:ui(PEER_ASK),result:null,error:''};
  return chatRequest('/api/peers',{ref:viewRef(view),selections:selectionsOf(),facts:factsOf()},turn,data=>{turn.result=data;});
}
function retryLast(){
  const last=state.advisor.turns.pop();
  if(!last)return;
  if(last.kind==='peers')findPeersFor();else askAdvisor(last.message);
}
function askAboutQuote(e){
  openChat({focus:false});
  const text=e.text.length>90?e.text.slice(0,90)+'…':e.text;
  askAdvisor(i18n.language==='en'?`Does this quote apply to me: “${text}”?`:`「${text}」这句话适用于我吗？`);
}
// 冷启动：用对照板上的条件回答「你的情况」，本地记下，不调模型。
function pickFromChat(forkIndex,branchIndex){
  const block=session.get()?.comparison;
  const fork=block?.forks?.[forkIndex],branch=fork?.branches?.[branchIndex];
  if(!branch||state.advisor.pending)return;
  const said=situationText(fork,branch);
  state.selectedForks={...state.selectedForks,[forkIndex]:branchIndex};
  const count=Object.keys(state.selectedForks).length;
  const more=count<3&&block.forks.some((_,i)=>state.selectedForks[i]==null);
  state.advisor.turns.push({kind:'local',message:said,action:true,text:i18n.language==='en'
    ?(more?`Saved “${said}”. You can add more situations that resemble yours, then I can compare them with the source quotes.`:`You have saved ${count} details. Shall I review them against the source quotes?`)
    :(more?`记下了「${said}」。还有更像你的可以接着点；说完了，就让我对照原话帮你看。`:`已经记下 ${count} 条情况了。我来对照原话帮你看看？`)});

  render();
}
// 回复里收起的部分：用户点了才展开
const SECTIONS=[
  {id:'points',label:'还有哪些判断',count:r=>Math.max(0,r.points.length-MAIN_POINTS)},
  {id:'counter',label:'评论区怎么反驳的',count:r=>r.counterpoints.length},
  {id:'gaps',label:'还缺什么信息',count:r=>r.assumptions.length+r.gaps.length},
  {id:'search',label:'你又去知乎搜到了什么',count:r=>r.search?1:0},
  {id:'advice',label:'我下一步做什么',count:r=>r.advice?1:0}
];
const lastAdvice=()=>[...state.advisor.turns].reverse().find(t=>t.kind==='advice'&&t.reply)?.reply||null;
const revealed=(reply,id)=>state.advisor.turns.some(t=>t.kind==='reveal'&&t.reply===reply&&t.section===id);
function reveal(section,reply){
  if(state.advisor.pending)return;
  state.advisor.turns.push({kind:'reveal',section:section.id,message:section.label,reply});
  render();
}

function pushbackQuote(ref){
  const cond=ref.type==='adds_condition';
  return el('div',{class:'pushback'+(cond?' cond':'')},[el('figure',{class:'pb-item'},[
    el('blockquote',{text:ref.commentText}),
    el('figcaption',{text:`${ref.typeLabel||'读者异议'} · 读者评论原话 · 在 ${ref.author||'匿名用户'} 的回答下`})
  ])]);
}
const refView=ref=>ref.ref==='pushback'?pushbackQuote(ref):evidenceFigure(ref,boardById,NO_PB,{ask:false});
function foundQuote(f){
  const who=f.source.author||'匿名用户';
  return el('figure',{class:'evidence'},[
    el('blockquote',{text:f.text}),
    el('figcaption',{},[el('span',{text:(f.kind==='comment'?`读者评论 · 在 ${who} 的回答下`:`${who} · ${f.source.voteUp??'—'} 赞`)+` · 《${f.source.title}》`}),sourceLink({url:f.source.url},'知乎 ↗')])
  ]);
}
const quotes=(label,nodes)=>el('details',{class:'quotes'},[el('summary',{text:label}),...nodes]);
const pointItem=p=>el('li',{},[
  el('span',{text:p.text}),
  p.basis==='speculation'?el('span',{class:'basis',text:'推测 · 没有原话支持'}):null,
  p.refs.length?quotes(`原话 ${p.refs.length}`,p.refs.map(refView)):null
]);

// 气泡
const toneAvatar=(cls='')=>el('img',{class:'tone-avatar '+cls,src:toneById(state.tone).asset,alt:'',width:'36',height:'36'});
const botMsg=(children,cls='')=>el('div',{class:'msg bot '+cls},[
  toneAvatar(),
  el('div',{class:'msg-bubble'},[el('span',{class:'sr-only',text:'知镜：'}),...children])
]);
const userMsg=text=>el('div',{class:'msg user'},[el('div',{class:'msg-bubble'},[el('span',{class:'sr-only',text:'你：'}),text])]);
const typingMsg=text=>botMsg([el('span',{class:'typing','aria-hidden':'true'},[el('i'),el('i'),el('i')]),el('span',{class:'typing-text',text})],'pending');
function errorMsg(turn,latest){
  return botMsg([el('p',{class:'bot-error',text:turn.error}),
    turn.expired?button('重新检索',()=>load(state.view,true),{class:'link-btn'}):latest?button('重试',retryLast,{class:'link-btn'}):null]);
}
function greetingMsg(block){
  const [A,B]=block.options;
  return botMsg([
    el('p',{text:`我是知镜。你在「${A}」和「${B}」之间纠结，我不替你选，只帮你把左边的原话和你自己的情况对上。`}),
    el('p',{text:'先说说你的情况吧：可以直接打字，也可以点下面更像你的选项。'})
  ]);
}
function adviceMsg(reply,latest){
  const parts=[];
  if(reply.understanding)parts.push(el('p',{text:reply.understanding}));
  const main=reply.points.slice(0,MAIN_POINTS);
  if(main.length)parts.push(el('ul',{class:'bot-points'},main.map(pointItem)));
  else if(reply.advice)parts.push(el('p',{class:'advice-text',text:reply.advice.text}));
  if(reply.nextQuestion)parts.push(el('p',{class:'bot-question',text:reply.nextQuestion.text}));
  const fresh=reply.factProposals.filter(f=>!f.done&&!confirmedFacts().some(c=>c.key===f.key&&c.value===f.value));
  if(latest&&fresh.length)parts.push(el('div',{class:'bot-block'},[
    el('p',{class:'bot-k',text:'我从你的话里听到这些，要记下吗？'}),
    el('div',{class:'proposal-row'},fresh.map(f=>el('span',{class:'proposal'},[
      el('span',{class:'sit-k',text:f.label}),el('span',{text:f.value}),
      button('记下',()=>{f.done=true;addFact(f.key,f.value,{evidenceRef:'对话：「'+f.quote+'」'});},{class:'mini-btn'}),
      button('×',()=>{f.done=true;renderAdvisor();},{class:'sit-x','aria-label':'不用记「'+f.value+'」',title:'不用记'})
    ])))
  ]));
  if(reply.personalized)parts.push(el('p',{class:'bot-basis',text:'这次参考了你记住的 '+reply.factsUsed+' 条情况。'}));
  return botMsg(parts,'wide');
}
function sectionMsg(id,reply){
  if(id==='points')return botMsg([el('p',{text:'还有这些：'}),el('ul',{class:'bot-points'},reply.points.slice(MAIN_POINTS).map(pointItem))],'wide');
  if(id==='counter')return botMsg([el('p',{text:'评论区里有人当场这样说：'}),...reply.counterpoints.map(pushbackQuote)],'wide');
  if(id==='gaps')return botMsg([el('p',{text:'这些我还不确定，可能要你自己去弄清：'}),
    el('ul',{class:'bot-list'},[...reply.assumptions.map(a=>el('li',{text:'前提：'+a})),...reply.gaps.map(g=>el('li',{text:'原话里没有：'+g}))])]);
  if(id==='search'){
    const sr=reply.search;
    return botMsg([el('p',{text:`我去知乎搜了「${sr.query}」。`}),
      ...(sr.failed?[el('p',{class:'bot-basis',text:sr.quota?'今天的检索次数用完了，这次没搜成。':'这次没搜成，稍后可以再问一次。'})]
        :sr.found.length?[sr.summary?el('p',{},[el('span',{class:'basis ai',text:'AI 概括'}),sr.summary]):null,...sr.found.map(foundQuote)]
        :[el('p',{class:'bot-basis',text:'没搜到能直接回答的原话。'})])],'wide');
  }
  const a=reply.advice;
  const basis=[...a.facts.map(f=>'你的「'+f.label+'」'),a.refs.length?`${a.refs.length} 段原话`:null].filter(Boolean);
  return botMsg([el('div',{class:'bot-advice'},[
    el('p',{class:'bot-k',text:'可以先做的一步（随时可以推翻）'}),
    el('p',{class:'advice-text',text:a.text}),
    el('p',{class:'bot-basis'},[basis.length?'依据：'+basis.join(' + '):'这一步没有直接依据，是我的推测。',a.refs.length?quotes('看原话',a.refs.map(refView)):null])
  ])],'wide');
}
function peerCard(peer){
  const src=peer.source;
  const record=src.fromDataset?boardById.get(src.recordId):null;
  const who=src.author||'匿名用户';
  const caption=peer.kind==='comment'?`读者评论 · 在 ${who} 的回答下 · 《${src.title}》`:`${who} · ${src.voteUp??'—'} 赞 · 《${src.title}》`;
  const open=event=>openPost({recordId:record.id,kind:peer.kind,commentIndex:src.commentIndex,text:peer.who},record,event.currentTarget);
  return el('article',{class:'peer'},[
    el('div',{class:'peer-top'},[
      el('span',{class:'peer-match',text:peer.similar}),
      el('span',{class:'note',text:'对应你的「'+peer.situation.value+'」'})
    ]),
    el('figure',{class:'evidence peer-quote'},[
      el('p',{class:'peer-k',text:'自述处境'}),el('blockquote',{text:peer.who}),
      ...(peer.said.length?[el('p',{class:'peer-k',text:'经历与选择'}),...peer.said.map(text=>el('blockquote',{text}))]:[]),
      el('figcaption',{},[el('span',{text:caption}),record?button('看原帖',open,{class:'link-btn'}):null,sourceLink({url:src.url},'知乎 ↗')])
    ])
  ]);
}
function peersMsg(r){
  const note=r.quota?'检索额度已用完，本次仅展示已取得的材料。':r.failed?'部分检索未完成，本次材料可能不完整，可以重试。':'';
  if(!r.peers.length)return botMsg([
    el('p',{text:'这次没找到处境和你明显相似的人。'}),
    el('p',{class:'bot-basis',text:'把情况说得具体一点（城市、行业、家里能支持多久），我再找一次。'+ui(note)})
  ]);
  return botMsg([
    el('p',{text:r.queries.length?`按你的 ${r.queries.length} 条情况，我在知乎找到 ${r.peers.length} 个处境和你相似的人：`:`我在已有回答和评论里找到 ${r.peers.length} 个处境和你相似的人：`}),
    ...r.peers.map(peerCard),
    el('p',{class:'bot-basis',text:ui('只收说话人讲自己经历的原话，一字未改；「哪里相似」是我的判断。他们后来怎么选的，看「经历与选择」。')+ui(note)})
  ],'wide');
}

// 知镜会参考的情况：只展示和删除；情况在对话里说
function memoryNote(){
  if(!account.user)return el('p',{class:'ctx-note'},['只用在这一页，刷新就没了。',account.available?el('span',{},[el('a',{href:'/auth/login',class:'link-btn',text:'用知乎登录'}),'后可以让知镜记住。']):null]);
  if(!account.user.canRemember)return el('p',{class:'ctx-note',text:'只用在这一页。没读到你的知乎资料，暂时不能记住。'});
  if(account.profile&&!account.profile.personalize)return el('p',{class:'ctx-note'},['只用在这一页。',button('让知镜记住',()=>setPersonalize(true),{class:'link-btn'}),'（随时可删）']);
  if(account.profile)return el('p',{class:'ctx-note',text:'已记住，下次登录还在；可以在「我的知乎」里删除。'});
  return null;
}
function contextBar(block){
  const [,B]=block.options;
  const picks=Object.entries(state.selectedForks).map(([f,b])=>({f:Number(f),fork:block.forks[Number(f)],branch:block.forks[Number(f)]?.branches?.[b]})).filter(p=>p.branch);
  const chips=[
    ...picks.map(p=>el('span',{class:'sit-chip pick '+(p.branch.lean===B?'b':'a'),title:p.fork.label},[
      el('span',{text:situationText(p.fork,p.branch)}),
      button('×',()=>{const next={...state.selectedForks};delete next[p.f];state.selectedForks=next;render();},{class:'sit-x','aria-label':'去掉「'+p.branch.when+'」',title:'去掉'})
    ])),
    ...confirmedFacts().map(factChip)
  ];
  const pending=allFacts().filter(f=>f.status==='pending');
  if(!chips.length&&!pending.length&&!factNote)return null;
  return el('div',{class:'chat-context'},[
    chips.length?el('div',{class:'ctx-chips'},[el('span',{class:'ctx-k',text:'知镜会参考'}),...chips]):null,
    ...pending.map(pendingRow),
    chips.length?memoryNote():null,
    factNote?el('p',{class:'ctx-note warn',text:factNote}):null
  ]);
}
function quickReplies(block){
  const advisor=state.advisor,busy=advisor.pending,last=advisor.turns.at(-1),src=lastAdvice();
  const ready=hasSituation();
  const rows=[];
  if(last?.kind==='advice'&&last.reply?.nextQuestion?.options?.length){
    rows.push(['回答',last.reply.nextQuestion.options.map(option=>button(option,()=>askAdvisor(option),{class:'chip-btn',disabled:busy}))]);
  }
  // 还没梳理过：说了情况就把「帮我梳理」放在最前面，做成主按钮
  if(!src&&ready){
    const count=Object.keys(state.selectedForks).length+confirmedFacts().length;
    rows.push(['',[button(`帮我梳理（已记下 ${count} 条）`,()=>askAdvisor(QUICK_ASKS[0]),{class:'chip-btn primary',disabled:busy})]]);
  }
  if(!src&&Object.keys(state.selectedForks).length<3){
    const open=block.forks.map((fork,i)=>({fork,i})).filter(({i})=>state.selectedForks[i]==null).slice(0,2);
    if(open.length)rows.push([ready?'还可以补充':'你的情况更像',open.flatMap(({fork,i})=>fork.branches.map((b,j)=>button(situationText(fork,b),()=>pickFromChat(i,j),{
      class:'chip-btn situation-chip '+(b.lean===block.options[1]?'b':'a'),disabled:busy,title:fork.label
    })))]);
  }
  const more=src
    ?SECTIONS.filter(sec=>sec.count(src)&&!revealed(src,sec.id)).map(sec=>button(sec.label+(sec.count(src)>1?' '+sec.count(src):''),()=>reveal(sec,src),{class:'chip-btn more-chip',disabled:busy}))
    :(ready?QUICK_ASKS.slice(1):QUICK_ASKS).map(q=>button(q,()=>askAdvisor(q),{class:'chip-btn',disabled:busy}));
  more.push(button('找和我情况像的人',findPeersFor,{class:'chip-btn peer-chip',disabled:busy||!ready,title:ready?'按你的情况去知乎找处境相似的人':'先说一条你的情况'}));
  rows.push([src?'也可以问':'也可以',more]);
  return el('div',{class:'quick-replies',role:'group','aria-label':'快捷回复'},rows.map(([label,chips])=>el('div',{class:'qr-row'},[label?el('span',{class:'qr-k',text:label}):null,...chips])));
}
function composer(){
  const advisor=state.advisor;
  const input=el('textarea',{id:'advisor-input',rows:'1',maxlength:'300',placeholder:'说说你的情况或顾虑…',enterkeyhint:'send'});
  input.value=advisor.draft;
  const fit=()=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight,140)+'px';};
  input.addEventListener('input',()=>{advisor.draft=input.value;fit();});
  const form=el('form',{class:'chat-composer'},[
    el('label',{for:'advisor-input',class:'sr-only',text:'跟知镜说说你的情况或顾虑'}),
    input,
    el('button',{type:'submit',class:'btn send-btn',disabled:advisor.pending,text:advisor.pending?'稍等…':'发送'})
  ]);
  const submit=()=>{
    const text=input.value.trim();
    if(!text){input.focus();return;}
    advisor.refocus=true;
    askAdvisor(text);
  };
  form.addEventListener('submit',event=>{event.preventDefault();submit();});
  // Enter 发送，Shift+Enter 换行；输入法选字时的 Enter 不发送。
  input.addEventListener('keydown',event=>{
    if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();submit();}
  });
  requestAnimationFrame(fit);
  return el('div',{class:'chat-foot'},[form,el('p',{class:'chat-hint',text:'Enter 发送 · Shift+Enter 换行'})]);
}
function renderAdvisor(){
  const box=$('advisor'),launcher=$('chat-launcher');
  const block=session.get()?.comparison;
  if(state.appView!=='zhihu'||block?.status!=='complete'||!block.options?.length||!state.config?.adviceReady){
    box.hidden=true;launcher.hidden=true;clear(box);document.body.classList.remove('chat-open');return;
  }
  if(state.chatOpen===undefined)state.chatOpen=wideChat();
  const open=!!state.chatOpen;
  launcher.hidden=open;box.hidden=!open;
  document.body.classList.toggle('chat-open',open);
  launcher.replaceChildren(...[toneAvatar('launcher-avatar'),el('span',{text:'问知镜 · '+toneById(state.tone).label}),
    state.advisor.turns.length?el('span',{class:'launcher-dot',title:'有进行中的对话'}):null].filter(Boolean));
  if(!open){clear(box);return;}
  const advisor=state.advisor;
  const head=el('header',{class:'chat-head'},[
    toneAvatar('big'),
    el('div',{class:'chat-titles'},[el('h3',{id:'advisor-title',class:'chat-title',text:'问知镜 · '+toneById(state.tone).label}),el('p',{class:'chat-sub',text:'不给胜率，不替你选'})]),
    advisor.turns.length?button('重新开始',restartChat,{class:'link-btn chat-restart',disabled:advisor.pending}):null,
    button('收起',closeChat,{class:'chat-close','aria-label':'收起问知镜',title:'收起'})
  ]);
  const messages=[greetingMsg(block)];
  advisor.turns.forEach((turn,i)=>{
    const latest=i===advisor.turns.length-1;
    messages.push(userMsg(turn.message));
    // 记下情况后，知镜的这条消息里直接放「帮我梳理」，不让用户去下面找按钮。
    if(turn.kind==='local')messages.push(botMsg([el('p',{text:turn.text}),
      turn.action&&latest?button('好了，帮我梳理',()=>askAdvisor(QUICK_ASKS[0]),{class:'btn small bubble-action',disabled:advisor.pending}):null]));
    else if(turn.kind==='reveal')messages.push(sectionMsg(turn.section,turn.reply));
    else if(turn.error)messages.push(errorMsg(turn,latest));
    else if(turn.kind==='peers')messages.push(turn.result?peersMsg(turn.result):typingMsg('正在按你的情况去知乎找处境相似的人…'));
    else messages.push(turn.reply?adviceMsg(turn.reply,latest):typingMsg('正在对照原话想…'));
  });
  const log=el('div',{class:'chat-log','aria-label':'和知镜的对话'},messages);
  const status=el('p',{class:'sr-only',role:'status',text:advisor.pending?'知镜正在回复':advisor.turns.length?'知镜已回复':''});
  box.replaceChildren(...[head,contextBar(block),log,quickReplies(block),composer(),status].filter(Boolean));
  requestAnimationFrame(()=>{log.scrollTop=log.scrollHeight;});
  if(advisor.refocus){
    if(!advisor.pending)advisor.refocus=false;
    requestAnimationFrame(()=>$('advisor-input')?.focus({preventScroll:true}));
  }
}

const EXAMPLE_DESCRIPTIONS={
  '考研还是直接工作':'继续深造，还是尽早进入职场？',
  '毕业去大城市还是回老家':'在大城市发展，还是回家乡生活？',
  '研究生毕业去国企还是私企':'更稳定的选择，还是更大的发展空间？',
  '第一份工作选高薪小公司还是低薪大厂':'高薪和成长，哪个更重要？'
};
function openQuestion(view){setAppView('zhihu');return load(view);}
function renderExamples(){
  $('examples').replaceChildren(...[...EXAMPLES.slice(1),EXAMPLES[0]].map(e=>{
    const node=button('',()=>openQuestion(viewFor(e.question)),{
      class:'chip-btn topic-recommendation','data-question':e.question,'data-sample':e.sample||false,'data-saved':e.saved||false,'aria-pressed':String(e.question===state.view?.question)
    });
    node.append(el('span',{class:'topic-copy'},[el('strong',{text:e.question}),el('span',{text:EXAMPLE_DESCRIPTIONS[e.question]})]),el('img',{src:'/assets/icons/caret-right.svg',alt:'',width:18,height:18}));
    return node;
  }));
}
$('ask-form').addEventListener('submit',event=>{
  event.preventDefault();
  let question;
  try{question=normalizeQuestion($('q').value);}
  catch(error){$('ask-note').textContent=ui(error.message);$('q').focus();return;}
  const view=viewFor(question);
  openQuestion(view);
});
for(const button of document.querySelectorAll('[data-view-target]'))button.addEventListener('click',()=>setAppView(button.dataset.viewTarget));
$('q').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('ask-form').requestSubmit();}});
$('brand-home')?.addEventListener('click',()=>setAppView('home'));
$('enter-table')?.addEventListener('click',()=>setAppView('table'));
$('enter-zhihu')?.addEventListener('click',()=>setAppView('zhihu'));
$('go-table').addEventListener('click',()=>setAppView('table'));
$('go-zhihu').addEventListener('click',()=>setAppView('zhihu'));
for(const back of document.querySelectorAll('.back-home'))back.addEventListener('click',()=>setAppView('home'));
window.addEventListener('popstate',()=>setAppView(viewFromLocation(),{sync:false}));

function renderLanguage({dynamic=true}={}){
  i18n.applyStatic();
  renderExamples();
  if(!dynamic)return;
  updateSearchNote();
  if(session.get())render();
  if(!$('mine').hidden)renderMine();
  renderAccount({available:account.available,user:account.user},account.note,{refresh:false});
}
$('language-toggle').addEventListener('click',()=>{i18n.toggle();renderLanguage();});
renderLanguage({dynamic:false});

// ── 知乎登录：没配置凭据时不显示；OAuth token 只在服务端，浏览器只拿到昵称和头像 ──
function renderAccount(me,note='',{refresh=true}={}){
  const box=$('account');
  if(refresh){accountRevision++;state.advisor=freshAdvisor();state.tableThinking=false;state.tableReply='';state.tableQuestion='';}
  account.available=!!me?.available;
  account.user=me?.user||null;
  account.note=note;
  if(refresh)account.profile=null;
  if(!account.user){localFacts.length=0;Object.assign(mine,{items:null,error:'',relogin:false,checks:freshChecks()});inferState={running:false,note:'',relogin:false};}
  renderMineWelcome();
  if(!me?.available){
    $('mine').hidden=true;clear($('mine'));
    box.replaceChildren(el('button',{type:'button',class:'login-btn unavailable',text:'知乎登录',disabled:true,title:'当前演示环境暂未配置知乎授权'}));
    renderAdvisor();return;
  }
  const parts=[];
  if(me.user){
    if(me.user.avatar)parts.push(el('img',{class:'avatar',src:me.user.avatar,alt:'',width:24,height:24,referrerpolicy:'no-referrer'}));
    parts.push(el('span',{class:'account-name',text:me.user.name,title:me.user.headline||false}));
    parts.push(button('退出',async()=>{
      try{
        const res=await fetch('/auth/logout',{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(10000)});
        if(!res.ok)throw new Error();
        renderAccount({available:true,user:null},'已退出。');render();
      }catch{renderAccount({available:true,user:account.user},'退出失败，请重试。',{refresh:false});}
    },{class:'link-btn'}));
  }else{
    parts.push(el('a',{class:'login-btn',href:'/auth/login',text:'知乎登录'}));
  }
  if(note)parts.unshift(el('span',{class:'account-note',text:note}));
  box.replaceChildren(...parts);
  if(me.user&&refresh){loadMine();loadProfile();}
  else if(!me.user){$('mine').hidden=true;clear($('mine'));renderAdvisor();}
  else renderAdvisor();
}

function renderMineWelcome(){
  const welcome=$('mine-welcome');
  welcome.hidden=!!account.user;
  welcome.replaceChildren(el('div',{class:'account-welcome'},[
    el('img',{src:'/assets/tone-hosts/rational.png',alt:'',width:104,height:104}),
    el('h2',{text:'让积累，成为新的视角'}),
    el('p',{class:'note',text:account.available?'登录知乎，查看你的收藏、创作与记住的情况。':'当前演示环境暂未配置知乎授权'}),
    account.available?el('a',{class:'btn',href:'/auth/login',text:'用知乎登录'}):el('button',{class:'btn',disabled:true,text:'知乎登录'})
  ]),el('div',{class:'mine-grid welcome-features'},[
    ['收藏体检','检查收藏中的观点与评论区异议。'],['答主视角','回看自己的创作与读者反馈。'],['知镜记住的情况','管理你确认过的个人情况与选择。']
  ].map(([title,copy])=>el('section',{class:'mine-block'},[el('h3',{text:title}),el('p',{class:'note',text:copy})]))));
}

// ── 登录后：我的知乎收藏（挑一个问题对比 + 收藏体检） ──
// 两种体检：近期收藏（收藏体检）和本人发过的内容（答主视角），结果分开保存。
const freshChecks=()=>({collections:{result:null,running:false,error:''},contents:{result:null,running:false,error:''}});
const mine={items:null,error:'',relogin:false,checks:freshChecks()};
async function loadMine(){
  const revision=accountRevision;
  Object.assign(mine,{items:null,error:'',relogin:false,checks:freshChecks()});
  $('mine').hidden=false;
  $('mine').replaceChildren(el('p',{class:'note',text:'正在读取你最近的知乎收藏…'}));
  try{
    const res=await fetch('/api/my/collections',{signal:AbortSignal.timeout(20000)});
    const data=await res.json().catch(()=>({}));
    if(revision!==accountRevision)return;
    if(res.ok)mine.items=data.items||[];
    else{mine.error=data.error||'暂时读不到你的收藏。';mine.relogin=!!data.relogin;}
  }catch{if(revision!==accountRevision)return;mine.error='暂时读不到你的收藏。';}
  renderMine();
}
const reloginLink=()=>el('a',{href:'/auth/login',class:'link-btn',text:'重新登录'});
function checkupChip(item){
  if(item.status==='pushback'){
    const cond=onlyConditions(item.objections);
    return el('span',{class:'pb-chip'+(cond?' cond':''),text:cond?'有人补了前提':'有人不同意'});
  }
  const label={search_failed:'检索未完成，可重试',incomplete:'分析未完成',quiet:'评论区没发现异议',no_comments:'没有取到评论',unmatched:'没找到这条的评论区',uncommented:'还没有人评论'}[item.status];
  return el('span',{class:'chip t-no_signal',text:label});
}
function checkupView(result,source){
  const what=source==='contents'?'你最近发过的':'最近收藏的';
  return el('div',{class:'checkup'},[
    el('p',{class:'result-summary',text:`检查了${what} ${result.checked} 条内容：找到 ${result.matched} 条的评论区，其中 ${result.pushback} 条有读者当场不同意或补了前提。`}),
    el('p',{class:'note',text:'做法：用每条回答里的一句话去知乎搜索，对上了才拿得到精选评论（每条最多 3 条），对不上的如实标出。反驳由模型挑出，展示读者原话供你判断；有人反驳不代表反驳成立。'}),
    el('ul',{class:'checkup-list'},result.items.map(item=>el('li',{class:'checkup-item'},[
      el('div',{class:'checkup-top'},[
        checkupChip(item),
        el('a',{href:item.url,target:'_blank',rel:'noopener noreferrer',class:'checkup-title',text:item.title}),
        el('span',{class:'meta',text:(item.author?item.author+' · ':'')+item.likeCount+' 赞'})
      ]),
      item.objections.length?pushbackBlock(item.objections.map(o=>({...o,direct:false}))):null
    ])))
  ]);
}
function checkBlock(source,title,intro,label,enabled){
  const check=mine.checks[source];
  return el('section',{class:'mine-block'},[
    el('h3',{class:'mine-sub',text:title}),
    check.result?el('div',{},[checkupView(check.result,source),check.result.incomplete?button(check.running?'正在重试…':'重试未完成的体检',()=>runMineCheckup(source,true),{class:'btn small',disabled:check.running}):null]):el('div',{class:'mine-check'},[
      el('p',{class:'note',text:intro}),
      enabled?button(check.running?'正在体检…（30–60 秒）':label,()=>runMineCheckup(source),{class:'btn small',disabled:check.running}):null
    ]),
    check.error?el('p',{class:'note warn'},[check.error,' ',mine.relogin?reloginLink():null]):null
  ]);
}
function renderMine(){
  const box=$('mine');
  if(box.hidden)return;
  const head=el('h2',{id:'mine-title',class:'mine-title',text:'我的知乎'});
  if(mine.error){box.replaceChildren(head,el('p',{class:'note'},[mine.error,' ',mine.relogin?reloginLink():null]));return;}
  const items=mine.items||[];
  const pick=el('section',{class:'mine-block'},[
    el('h3',{class:'mine-sub',text:'从收藏里挑一个问题'}),
    items.length
      ?el('div',{class:'chips'},items.slice(0,6).map(item=>button(item.title.length>28?item.title.slice(0,28)+'…':item.title,()=>{
        try{openQuestion(viewFor(normalizeQuestion(item.title.slice(0,80))));}catch(error){$('ask-note').textContent=error.message;}
      },{class:'chip-btn',title:item.title})))
      :el('p',{class:'note',text:'最近的收藏里没有回答或文章。'})
  ]);
  box.replaceChildren(head,el('div',{class:'mine-grid'},[
    pick,
    checkBlock('collections','收藏体检',`看看你最近收藏的 ${Math.min(items.length,20)} 条内容，评论区有没有人当场不同意。`,'体检我的收藏',items.length>0),
    checkBlock('contents','答主视角','看看你自己发过的回答、文章和想法，评论区有没有人当场不同意。','体检我发过的内容',true)
  ]),memoryBlock());
}
async function runMineCheckup(source,refresh=false){
  const revision=accountRevision;
  const check=mine.checks[source];
  if(check.running)return;
  check.running=true;check.error='';renderMine();
  try{
    const res=await fetch('/api/my/checkup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source,refresh}),signal:AbortSignal.timeout(150000)});
    const data=await res.json().catch(()=>({}));
    if(revision!==accountRevision||mine.checks[source]!==check)return;
    if(res.ok)check.result=data;
    else{check.error=data.error||'体检没有完成，请稍后再试。';mine.relogin=!!data.relogin;}
  }catch{if(revision!==accountRevision||mine.checks[source]!==check)return;check.error='体检没有完成，请稍后再试。';}
  check.running=false;renderMine();
}
async function loadAccount(){
  const params=new URLSearchParams(location.search);
  const result=params.get('login');
  if(result){
    params.delete('login');
    try{history.replaceState(null,'',location.pathname+(params.toString()?'?'+params:'')+location.hash);}catch{}
  }
  try{
    const res=await fetch('/api/me',{signal:AbortSignal.timeout(8000)});
    if(!res.ok)return;
    renderAccount(await res.json(),result==='ok'?'已用知乎账号登录':result==='failed'?'知乎登录没有完成。知乎要求账号已绑定手机号并完成实名认证，检查后可以再试一次':'');
  }catch{}
}

async function boot(){
  loadAccount();
  try{
    const res=await fetch('/api/config',{signal:AbortSignal.timeout(10000)});
    if(!res.ok)throw new Error('配置读取失败');
    state.config=await res.json();
  }catch{
    setAppView('zhihu',{sync:false});
    $('status').replaceChildren(el('p',{text:'暂时连不上服务，请稍后再试。'}),button('重新连接',boot,{class:'btn'}));
    return;
  }
  updateSearchNote();
  let initial=sampleView();
  const q=new URLSearchParams(location.search).get('q');
  if(q){
    try{const view=viewFor(normalizeQuestion(q));if(view.kind==='sample'||state.config.askReady||isSaved(view.question))initial=view;}catch{}
  }
  setAppView(viewFromLocation(),{sync:false});
  await load(initial);
  if(state.appView==='home'&&!q)$('q').value='';
}
boot();
