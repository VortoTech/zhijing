import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildCatalog,verifyAdvice,adviseTurn,inferProfile,verifyRoundtable,verifyDebate,roundtableTurn,debateTurn} from '../src/agent.mjs';

const comparison=JSON.parse(await readFile(new URL('../data/compare-first-job.json',import.meta.url),'utf8'));
const snapshot=JSON.parse(await readFile(new URL('../data/snapshot-first-job.json',import.meta.url),'utf8'));
const dataset={records:snapshot.records,comparison};
const env={AI_BASE_URL:'https://example.invalid',AI_API_KEY:'k',AI_MODEL:'m'};
const catalog=buildCatalog(dataset);
const idOf=text=>[...catalog.items.values()].find(i=>i.type==='evidence'&&i.evidence.text.startsWith(text)).id;
const firstPushback=[...catalog.items.values()].find(i=>i.type==='pushback').id;

test('证据目录：对照板的原话按编号收录、重复引用合并；带上答主交代的前提和评论区反驳',()=>{
  const evidence=[...catalog.items.values()].filter(i=>i.type==='evidence');
  const texts=evidence.map(i=>i.evidence.recordId+i.evidence.text);
  assert.equal(new Set(texts).size,texts.length,'同一段原话只有一个编号');
  const shared=catalog.items.get(idOf('小公司那个，可以写主导了'));
  assert.ok(shared.contexts.length>=2,'理由和条件都引用的原话，合并上下文');
  const salary=catalog.items.get(idOf('假设有两个同样级别的公司'));
  assert.match(salary.evidence.premise.text,/两个不同级别的公司/);
  assert.ok(catalog.lines.some(l=>l.startsWith(salary.id+'|')&&l.includes('答主交代的前提')));
  assert.ok([...catalog.items.values()].some(i=>i.type==='pushback'),'有评论区反驳');
  for(const item of evidence){
    const record=snapshot.records.find(r=>r.id===item.evidence.recordId);
    assert.ok((item.evidence.kind==='comment'?record.comments[item.evidence.commentIndex]:record.text).includes(item.evidence.text));
  }
  assert.equal(buildCatalog({records:[],comparison:{status:'failed'}}),null);
});

test('校验：编号必须存在，没有原话支持的判断标成推测；胜率与「你应该选」被拦下',()=>{
  const out=verifyAdvice({
    understanding:'你在高薪小公司和低薪大厂之间犹豫，最担心的是现金流。',
    points:[
      {text:'家里能兜底时，小公司的波动更能承受',evidence:[idOf('如果没有经济压力'),'e999']},
      {text:'大厂的培训对新人更友好',evidence:[]},
      {text:'选小公司的胜率大约 70%',evidence:[idOf('小公司给的是')]}
    ],
    counterpoints:[firstPushback,idOf('如果没有经济压力')],
    assumptions:['你说的高薪是税后到手'],gaps:['小公司是否已经融资'],
    advice:{text:'如果家里能撑一年，可以先问清对方的融资情况再决定。',facts:['finance','city'],evidence:[idOf('如果没有经济压力')]},
    next_question:{text:'家里能支持你多久？',options:['半年以内','一到两年','说不准','这是一个明显超过十四个字上限的选项文本']},
    search:'小公司 融资 应届生'
  },catalog,{facts:[{key:'finance',value:'家里能兜底'}]});
  assert.deepEqual(out.points.map(p=>p.basis),['evidence','speculation']);
  assert.equal(out.points[0].refs.length,1);
  assert.ok(out.dropped>=2,'无效编号、类型不对的编号都计数');
  assert.deepEqual(out.counterpoints,[firstPushback],'反驳只收 p 编号');
  assert.deepEqual(out.advice.facts,['finance'],'建议只能依据用户确认过的情况');
  assert.equal(out.advice.basis,'grounded');
  assert.deepEqual(out.nextQuestion.options,['半年以内','一到两年','说不准']);
  assert.equal(out.search,'小公司 融资 应届生');
  assert.equal(verifyAdvice({advice:{text:'综合来看你应该选大厂'}},catalog).advice,null);
  const chosen=verifyAdvice({advice:{text:'如果经济压力大，可以先选大厂确保现金流。'}},catalog);
  assert.deepEqual([chosen.advice,chosen.adviceRejected],[null,true],'「先选大厂」也算替用户选');
  assert.equal(verifyAdvice({advice:{text:'如果房租压力大，可以先问清小公司的融资进度再定。'}},catalog).adviceRejected,false);
});

test('校验：「更符合目标」「建议先去」这类替用户下判断的变体也拦，说理由的句子不拦',()=>{
  const out=verifyAdvice({points:[
    {text:'大厂的培训体系更适合没经验的新人',evidence:[idOf('如果没有经济压力')]},
    {text:'你怕波动，低薪大厂可能更符合目标',evidence:[idOf('如果没有经济压力')]}
  ]},catalog);
  assert.deepEqual(out.points.map(p=>p.text),['大厂的培训体系更适合没经验的新人']);
  assert.equal(verifyAdvice({advice:{text:'结合你的情况，小公司更符合你的规划。'}},catalog).adviceRejected,true);
  assert.equal(verifyAdvice({advice:{text:'建议先去大厂待两年再说。'}},catalog).adviceRejected,true);
});

test('校验：混进正文的编号（e1、p2、n0s3）删掉，只留在 evidence 里；p2p、e2e 这类词不受影响',()=>{
  const out=verifyAdvice({
    understanding:'你关注了e1关于学历门槛的观点（p1），想知道适不适合。',
    points:[{text:'家里能兜底时波动更能承受（e3、e4）',evidence:[idOf('如果没有经济压力')]}],
    advice:{text:'如果怕波动，可以先按 n0s3 的做法问清融资进度。',facts:[],evidence:[]}
  },catalog);
  assert.equal(out.understanding,'你关注了关于学历门槛的观点，想知道适不适合。');
  assert.equal(out.points[0].text,'家里能兜底时波动更能承受');
  assert.equal(out.points[0].refs.length,1,'evidence 里的编号照常解析');
  assert.doesNotMatch(out.advice.text,/n0s3/);
  assert.equal(verifyAdvice({understanding:'p2p 网贷和 e2e 测试不受影响'},catalog).understanding,'p2p 网贷和 e2e 测试不受影响');
});

test('建议替用户选了一边：让模型重写一次；重写仍违规就不给建议',async()=>{
  const bad={understanding:'u',points:[],advice:{text:'可以先去低薪大厂，稳一点。'}};
  const good={understanding:'u2',points:[],advice:{text:'如果怕小公司撑不过一年，可以先问清它的融资和现金流。'}};
  const seen=[];
  const out=await adviseTurn({question:'q',message:''},dataset,env,{chat:async({user})=>{seen.push(user);return seen.length===1?bad:good;}});
  assert.equal(seen.length,2);
  assert.match(seen[1].correction,/替用户选/);
  assert.equal(out.advice.text,good.advice.text);
  const stubborn=await adviseTurn({question:'q',message:''},dataset,env,{chat:async()=>bad});
  assert.equal(stubborn.advice,null);
});

test('用户事实：只收用户原话里的一段，敏感信息与已知情况不收',()=>{
  const message='我家里条件还可以，但我最近有点抑郁，想留在杭州';
  const out=verifyAdvice({fact_proposals:[
    {key:'finance',value:'家里条件还可以',quote:'家里条件还可以'},
    {key:'city',value:'想留在杭州',quote:'想留在杭州'},
    {key:'stage',value:'应届毕业',quote:'我今年刚毕业'},
    {key:'other',value:'最近有点抑郁',quote:'最近有点抑郁'},
    {key:'salary',value:'月薪一万',quote:'家里条件'}
  ]},catalog,{message,facts:[{key:'city',value:'想留在杭州'}]});
  assert.deepEqual(out.factProposals.map(f=>[f.key,f.value]),[['finance','家里条件还可以']]);
  assert.equal(out.factProposals[0].label,'经济状况');
});

test('一轮对话：模型只看到编号和用户确认过的情况；返回按编号取回的原话；失败重试一次',async()=>{
  const calls=[];
  const salary=idOf('假设有两个同样级别的公司');
  const chat=async({system,user})=>{
    calls.push({system,user});
    if(calls.length===1)throw new Error('网络抖动');
    return {understanding:'想清楚高薪背后的前提。',points:[{text:'这句高薪论点只比较同级别公司',evidence:[salary]}],counterpoints:[firstPushback],
      assumptions:[],gaps:[],advice:{text:'如果两家公司级别差很多，可以先别只看薪资。',facts:[],evidence:[salary]},next_question:{text:'两家公司差多少？',options:['差不多','差很多']},fact_proposals:[],search:''};
  };
  const out=await adviseTurn({question:'第一份工作选高薪小公司还是低薪大厂',selections:[{fork:0,branch:1},{fork:9,branch:0}],
    facts:[{key:'finance',value:'要自己付房租'}],history:[{role:'user',text:'我在纠结'}],message:'薪资差 5k'},dataset,env,{chat});
  assert.equal(calls.length,2);
  const payload=calls[1].user;
  assert.ok(payload.materials.length>10);
  assert.deepEqual(payload.user_facts,['finance（经济状况）：要自己付房租']);
  assert.equal(payload.user_selected.length,1,'不存在的条件编号被忽略');
  assert.match(payload.user_selected[0],/经济压力大需稳定收入/);
  assert.equal(out.points[0].refs[0].text,catalog.items.get(salary).evidence.text);
  assert.match(out.points[0].refs[0].premise.text,/不同级别/);
  assert.equal(out.counterpoints[0].ref,'pushback');
  assert.ok(out.counterpoints[0].commentText);
  assert.equal(out.search,null);
  assert.deepEqual(out.selected.map(s=>s.when),['经济压力大需稳定收入']);

  await assert.rejects(adviseTurn({question:'q',message:''},dataset,env,{chat:async()=>{throw new Error('down');}}),e=>e.reason==='model');
  await assert.rejects(adviseTurn({question:'q'},{records:[],comparison:{status:'failed'}},env,{chat}),e=>e.reason==='not_comparable');
});

test('补充检索：材料答不了时去知乎再搜一次，搜到的原话同样按编号挑；搜索失败不影响本轮回答',async()=>{
  const first={understanding:'u',points:[],gaps:['小公司一般多久发不出工资'],search:'小公司 拖欠工资'};
  const raw=[{ContentID:'77',Url:'https://www.zhihu.com/question/1/answer/77',Title:'小公司拖欠工资常见吗 - 知乎',AuthorName:'答主丙',VoteUpCount:88,
    ContentText:'我待过的三家小公司里，有一家拖欠了两个月工资。入职前一定要问清楚融资进度。',CommentInfoList:[{Content:'我也遇到过'}]}];
  let second;
  const chat=async({user})=>{
    if(user.materials)return first;
    second=user;
    return {summary:'有答主提到小公司拖欠工资的经历，建议入职前问清融资。',evidence:['r0s1','r9s9']};
  };
  const queries=[];
  const out=await adviseTurn({question:'q',message:''},dataset,env,{chat,search:async q=>{queries.push(q);return raw;}});
  assert.deepEqual(queries,['小公司 拖欠工资']);
  assert.equal(second.gap,'小公司一般多久发不出工资');
  assert.deepEqual(out.search.found.map(f=>f.text),['入职前一定要问清楚融资进度。']);
  assert.deepEqual(out.search.found[0].source,{title:'小公司拖欠工资常见吗',author:'答主丙',voteUp:88,url:'https://www.zhihu.com/question/1/answer/77'});
  assert.ok(out.search.summary);

  const failed=await adviseTurn({question:'q',message:''},dataset,env,{chat,search:async()=>{throw Object.assign(new Error('quota'),{quota:true});}});
  assert.deepEqual([failed.search.failed,failed.search.quota,failed.search.found.length],[true,true,0]);
  const none=await adviseTurn({question:'q',message:''},dataset,env,{chat:async({user})=>user.materials?first:{summary:'瞎编的概括',evidence:[]},search:async()=>raw});
  assert.equal(none.search.summary,'','没挑出原话就不给概括');
});

test('从收藏推测：只收有收藏标题支撑的、非敏感的推测，并记下依据',async()=>{
  const items=[{title:'应届生第一份工作怎么选'},{title:'28 岁转行做产品来得及吗'},{title:'抑郁症怎么自救'}];
  const out=await inferProfile(items,env,{chat:async({user})=>{
    assert.deepEqual(user.collections,['0|应届生第一份工作怎么选','1|28 岁转行做产品来得及吗','2|抑郁症怎么自救']);
    return {proposals:[
      {key:'stage',value:'可能是应届生',evidence:[0]},
      {key:'other',value:'可能有抑郁困扰',evidence:[2]},
      {key:'priority',value:'可能在考虑转行',evidence:[1,1,7]},
      {key:'income',value:'月薪一万',evidence:[0]},
      {key:'city',value:'可能想回老家',evidence:[]}
    ]};
  }});
  assert.deepEqual(out.map(p=>[p.key,p.value]),[['stage','可能是应届生'],['priority','可能在考虑转行']]);
  assert.equal(out[1].evidenceRef,'收藏：《28 岁转行做产品来得及吗》');
  assert.deepEqual(await inferProfile([],env,{chat:async()=>assert.fail('没有收藏不调模型')}),[]);
});

test('圆桌：只收认识的角色和存在的编号，正文删编号、拦「你应该选」，回应对象换成角色名',()=>{
  const roles=[{key:'r1',id:'rational',name:'理性分析'},{key:'r2',id:'custom',name:'我妈',stance:'希望我稳定'}];
  const out=verifyRoundtable({turns:[
    {role:'r1',text:'小公司的成长快（e1）但波动大',evidence:[idOf('小公司那个，可以写主导了'),'e999']},
    {role:'r2',text:'稳定最重要，别折腾',evidence:[],replyTo:'r1'},
    {role:'r9',text:'不存在的角色'},
    {role:'r1',text:'综合来看你应该选大厂'}
  ],divergence:'分歧在于看重成长还是稳定'},catalog,roles);
  assert.deepEqual(out.turns.map(t=>t.role.name),['理性分析','我妈']);
  assert.equal(out.turns[0].text,'小公司的成长快但波动大');
  assert.equal(out.turns[0].refs.length,1,'不存在的编号丢掉');
  assert.equal(out.turns[1].replyTo,'理性分析');
  assert.equal(out.divergence,'分歧在于看重成长还是稳定');
  const told=verifyRoundtable({turns:[
    {role:'r2',text:'孩子，稳定最重要。考研能进好单位，以后铁饭碗，别像隔壁小王那样瞎折腾。'},
    {role:'r2',text:'隔壁小王就是这样被裁的。'}
  ]},catalog,roles);
  assert.deepEqual(told.turns.map(t=>t.text),['孩子，稳定最重要。考研能进好单位，以后铁饭碗。'],'编出来的具体人和事删掉，其余照留；只剩故事的整条不要');
});

test('圆桌：按角色编号发给模型，自定义角色标明是用户设定；结果带回原话',async()=>{
  let seen=null;
  const out=await roundtableTurn({question:'q',roles:[{id:'realist'},{id:'custom',name:'我妈',stance:'希望我稳定'}],history:[],message:''},dataset,env,{chat:async({user})=>{
    seen=user;
    return {turns:[{role:'r1',text:'先算清楚房租',evidence:[idOf('小公司那个，可以写主导了')]},{role:'r2',text:'稳定点好',replyTo:'r1'}],divergence:'看重钱还是稳'};
  }});
  assert.match(seen.roles[0],/^r1｜现实主义｜/);
  assert.match(seen.roles[1],/^r2｜我妈｜希望我稳定（用户自定义的角色）$/);
  assert.equal(out.turns[0].refs[0].ref,'evidence');
  assert.equal(out.turns[1].replyTo,'现实主义');
});

test('辩论场：没有反驳就不算一轮；知镜站用户对面，带原话和追问',async()=>{
  assert.equal(verifyDebate({concede:'有道理'},catalog),null);
  assert.equal(verifyDebate({concede:'你说得对，应届身份确实有用',rebuttal:'但它会过期'},catalog).concede,'应届身份确实有用','页面已有「你说得对的地方」，不重复');
  let seen=null;
  const out=await debateTurn({question:'q',side:0,message:'小公司成长快',history:[]},dataset,env,{chat:async({user})=>{
    seen=user;
    return {concede:'成长快确实成立',rebuttal:'但评论区有人指出小公司可能撑不过一年（p1）',evidence:[firstPushback],question:'如果公司倒了你怎么办？'};
  }});
  assert.equal(seen.user_side,comparison.options[0]);
  assert.equal(seen.agent_side,comparison.options[1]);
  assert.equal(out.rebuttal,'但评论区有人指出小公司可能撑不过一年');
  assert.equal(out.refs[0].ref,'pushback');
  assert.deepEqual(out.side,{user:comparison.options[0],agent:comparison.options[1]});
});

test('哪边的理由更贴近你：只能点名两个选项之一；没理由不显示；「你应该选」照样拦；原话按编号取回',async()=>{
  const [A]=comparison.options;
  const ok=verifyAdvice({fit:{option:A,reason:'你家里能兜底，对上了这一边「波动能承受」的理由（e2）',caveat:'另一边的培训体系对新人更友好',evidence:[idOf('如果没有经济压力'),'e999']}},catalog);
  assert.equal(ok.fit.option,A);
  assert.equal(ok.fit.reason,'你家里能兜底，对上了这一边「波动能承受」的理由');
  assert.equal(ok.fit.refs.length,1,'不存在的编号丢掉');
  assert.equal(verifyAdvice({fit:{option:'none',reason:'你说的情况还太少，两边都说得通'}},catalog).fit.option,null,'none 不点名');
  assert.equal(verifyAdvice({fit:{option:'第三条路',reason:'理由'}},catalog).fit.option,null,'只能是两个选项之一');
  assert.equal(verifyAdvice({fit:{option:A,reason:'所以你应该选这一边'}},catalog).fit,null);
  assert.equal(verifyAdvice({fit:{option:A}},catalog).fit,null,'没写理由不显示');
  const out=await adviseTurn({question:'q',message:''},dataset,env,{chat:async()=>({understanding:'u',points:[],fit:{option:A,reason:'你要自己付房租，对上了这一边的理由',caveat:'',evidence:[idOf('如果没有经济压力')]}})});
  assert.equal(out.fit.refs[0].ref,'evidence');
  assert.ok(out.fit.refs[0].text);
});

test('哪边更贴近你：提醒里模型自带的「但」去掉，页面已有「但也留意另一边」',()=>{
  const [A]=comparison.options;
  const out=verifyAdvice({fit:{option:A,reason:'你家里能兜底，对上了这一边的理由',caveat:'但材料也说，已有好 offer 时直接工作更划算'}},catalog);
  assert.equal(out.fit.caveat,'材料也说，已有好 offer 时直接工作更划算');
});

test('观点桌面结合用户的情况：圆桌和辩论都把看两边确认过的条件和情况带给模型',async()=>{
  const input={question:'q',selections:[{fork:0,branch:1},{fork:9,branch:0}],facts:[{key:'finance',value:'要自己付房租'}],history:[],message:''};
  let seenRt=null,seenDb=null;
  await roundtableTurn({...input,roles:[{id:'realist'},{id:'sharp'}]},dataset,env,{chat:async({user})=>{seenRt=user;return {turns:[{role:'r1',text:'先算房租'}],divergence:''};}});
  await debateTurn({...input,side:0},dataset,env,{chat:async({user})=>{seenDb=user;return {rebuttal:'你要自己付房租，波动扛得住吗'};}});
  for(const seen of [seenRt,seenDb]){
    assert.equal(seen.user_situation.length,2,'不存在的条件编号忽略');
    assert.match(seen.user_situation[0],/经济压力大需稳定收入/);
    assert.equal(seen.user_situation[1],'经济状况：要自己付房租');
  }
});

test('圆桌：角色不能对用户下指令，「你应优先考虑……」这类分句删掉，其余照留',()=>{
  const roles=[{key:'r1',id:'rational',name:'理性分析'}];
  const out=verifyRoundtable({turns:[
    {role:'r1',text:'根据你的情况，这一边的理由更贴近。你应优先考虑考研。'},
    {role:'r1',text:'你还是选大厂吧。'}
  ]},catalog,roles);
  assert.deepEqual(out.turns.map(t=>t.text),['根据你的情况，这一边的理由更贴近。']);
});
