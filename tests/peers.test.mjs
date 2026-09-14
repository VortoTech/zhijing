import test from 'node:test';
import assert from 'node:assert/strict';
import {peerQueries,findPeers,isSelfAccount,leanSupported} from '../src/peers.mjs';
import {createServer} from '../src/server.mjs';

const env={AI_BASE_URL:'https://example.invalid',AI_API_KEY:'k',AI_MODEL:'m',ZHIJING_ENABLE_PILOT:'1'};
const options=['高薪小公司','低薪大厂'];
const situations=[{id:'f0',label:'经济状况',value:'要自己付房租'},{id:'c0',label:'你能否承受经济压力？',value:'经济压力大需稳定收入'}];
const dataset={records:[
  {id:'d1',title:'第一份工作怎么选 - 知乎',author:'甲',voteUp:5,url:'https://www.zhihu.com/question/1/answer/1',text:'看情况。',comments:['我当时也是自己付房租，选了大厂，攒了点钱再跳','缺钱有缺钱的选择']}
]};
const hits=[
  {ContentID:'n1',Url:'https://www.zhihu.com/question/2/answer/2',Title:'在杭州租房的应届生怎么选工作 - 知乎',AuthorName:'乙',VoteUpCount:30,
    ContentText:'我毕业那年在杭州，每月房租两千五。最后去了小公司，工资多四千。一年后公司裁员，我又跳去了大厂。',CommentInfoList:[{Content:'我也在杭州，房租压力真的大'}]},
  {ContentID:'d1',Url:'https://www.zhihu.com/question/1/answer/1',Title:'第一份工作怎么选',AuthorName:'甲',ContentText:'看情况。'},
  {ContentID:'n3',Url:'https://www.zhihu.com/question/3/answer/3',Title:'三',AuthorName:'丙',ContentText:'第三条回答没有自述，只是泛泛建议。我建议先看平台。'},
  {ContentID:'n4',Url:'https://www.zhihu.com/question/4/answer/4',Title:'四',AuthorName:'丁',ContentText:'我去了大厂。'},
  {ContentID:'n5',Url:'https://www.zhihu.com/question/5/answer/5',Title:'五',AuthorName:'戊',ContentText:'我在小公司干了三年。我后来跳槽了。'}
];

test('检索词：情况 + 两个选项 + 经历，每条情况一条，最多 3 条，不超过 40 字',()=>{
  const qs=peerQueries('第一份工作选高薪小公司还是低薪大厂',[...situations,{value:'在杭州'},{value:'第四条'}],options);
  assert.equal(qs.length,3);
  assert.equal(qs[0],'要自己付房租 高薪小公司 低薪大厂 经历');
  assert.ok(qs.every(q=>q.length<=40));
  assert.equal(peerQueries('考研还是工作',[{value:'在杭州'}])[0],'在杭州 考研还是工作 经历');
});

test('自述：讲自己经历的才算，只有「我觉得 / 我建议」的表态不算',()=>{
  assert.equal(isSelfAccount('我毕业那年在杭州，每月房租两千五'),true);
  assert.equal(isSelfAccount('本人社招，去了小公司'),true);
  assert.equal(isSelfAccount('缺钱有缺钱的选择'),false);
  assert.equal(isSelfAccount('我觉得还是看个人'),false);
  assert.equal(isSelfAccount('我建议先去大厂，我觉得稳'),false);
  assert.equal(isSelfAccount('我觉得我当时选错了'),true);
});

test('倾向：原话里提到这一边、没提另一边才保留',()=>{
  assert.equal(leanSupported('低薪大厂',['我会优先选大厂稳定岗位。'],options),true);
  assert.equal(leanSupported('高薪小公司',['杭州那家小企业，我并不是很想去。'],options),false,'没提到这一边');
  assert.equal(leanSupported('低薪大厂',['交个房租就把存的钱用了一大部分。'],options),false);
  assert.equal(leanSupported('低薪大厂',['小公司和大厂我都待过。'],options),false,'两边都提到，看不出倾向');
  assert.equal(leanSupported('随便',['大厂'],options),false);
});

test('找同路人：只收同一说话人的原话；已在对照里的回答不重复；选项之外的倾向不收',async()=>{
  const queries=[];
  let seen;
  const chat=async({user})=>{
    seen=user;
    return {peers:[
      {situation:'f0',similar:'同样在杭州要付房租',who:'n0s0',said:['n0s1','n0s2','n0c0'],lean:'高薪小公司'},
      {situation:'f0',similar:'重复的说话人',who:'n0s1',said:[]},
      {situation:'c0',similar:'同样经济压力大',who:'d0c0',said:['d0c0'],lean:'大厂吧'},
      {situation:'c0',similar:'不是自述',who:'d0c1'},
      {situation:'f9',similar:'情况编号不存在',who:'n0c0'},
      {situation:'f0',similar:'编号不存在',who:'x1'}
    ]};
  };
  const out=await findPeers({question:'第一份工作选高薪小公司还是低薪大厂',options,situations},dataset,env,{chat,spacingMs:0,search:async q=>{queries.push(q);return hits;}});
  assert.equal(queries.length,2);
  assert.equal(out.searched,3,'每次检索只留有自述的两条（自述多的优先）；第二次补进剩下那条');
  assert.deepEqual(seen.sources.slice(0,2).map(s=>s.author),['乙','戊'],'自述多的排前');
  assert.ok(!seen.sources.some(s=>s.author==='丙'),'没有自述的回答不进候选');
  assert.ok(seen.sources.some(s=>s.lines.some(l=>l.startsWith('d0c0|'))),'原来那批评论里的自述也是候选');
  assert.ok(!seen.sources.some(s=>s.lines.some(l=>l.startsWith('d0c1|'))),'不是自述的评论不进候选');
  assert.ok(!seen.sources.some(s=>s.lines.some(l=>l.includes('看情况'))),'已在对照里的回答不再作为搜索结果');
  assert.deepEqual(out.peers.map(p=>p.similar),['同样在杭州要付房租','同样经济压力大']);
  const [first,second]=out.peers;
  assert.equal(first.who,'我毕业那年在杭州，每月房租两千五。');
  assert.deepEqual(first.said,['最后去了小公司，工资多四千。','一年后公司裁员，我又跳去了大厂。'],'评论不是同一说话人，不收');
  assert.equal(first.lean,null,'原话里小公司、大厂都提到了，倾向不保留');
  assert.deepEqual(first.source,{recordId:'n1',commentIndex:null,fromDataset:false,title:'在杭州租房的应届生怎么选工作',author:'乙',voteUp:30,url:'https://www.zhihu.com/question/2/answer/2'});
  assert.equal(first.situation.value,'要自己付房租');
  assert.deepEqual([second.kind,second.source.fromDataset,second.source.commentIndex,second.lean,second.said],['comment',true,0,null,[]]);
  assert.ok(out.dropped>=3);
});

test('检索次数用完：停止后续检索，仍在原来那批评论里找；没有知乎凭据时只看原评论；模型两次失败报错',async()=>{
  let calls=0;
  const quota=await findPeers({question:'q',options,situations},dataset,env,{spacingMs:0,
    search:async()=>{calls++;throw Object.assign(new Error('quota'),{quota:true});},
    chat:async({user})=>{assert.equal(user.sources.length,1);return {peers:[]};}});
  assert.deepEqual([calls,quota.quota,quota.searched,quota.peers.length],[1,true,0,0]);
  const offline=await findPeers({question:'q',options,situations},dataset,env,{chat:async()=>({peers:[{situation:'c0',similar:'同样压力大',who:'d0c0'}]})});
  assert.deepEqual([offline.queries.length,offline.peers.length],[0,1]);
  await assert.rejects(findPeers({question:'q',options,situations},dataset,env,{chat:async()=>{throw new Error('down');}}),e=>e.reason==='model');
});

test('搜到了自述、模型却一个没挑：提醒它再看一遍；只有原来的评论时不重试',async()=>{
  const notes=[];
  const chat=async({user})=>{notes.push(user.note||null);return notes.length===1?{peers:[]}:{peers:[{situation:'f0',similar:'同样在杭州',who:'n0s0'}]};};
  const out=await findPeers({question:'q',options,situations},dataset,env,{chat,spacingMs:0,search:async()=>hits});
  assert.equal(notes.length,2);
  assert.match(notes[1],/上一次你返回了空/);
  assert.equal(out.peers.length,1);
  let calls=0;
  await findPeers({question:'q',options,situations},dataset,env,{chat:async()=>{calls++;return {peers:[]};}});
  assert.equal(calls,1);
});

async function serve(server,fn){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await fn(`http://127.0.0.1:${server.address().port}`);}
  finally{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
}
const post=(base,body)=>fetch(base+'/api/peers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});

test('同路人接口：没有情况 400；情况 = 用户说的 + 选的条件（最多 3 条）；找到人的结果 15 分钟内复用，没找到的不缓存',async()=>{
  const inputs=[];
  const found={situation:{id:'f0',label:'经济状况',value:'要自己付房租'},similar:'同样',lean:null,kind:'comment',who:'我也是',said:[],source:{fromDataset:true}};
  const deps={findPeers:async input=>{inputs.push(input);return {queries:['q'],peers:inputs.length>=3?[found]:[],searched:0,failed:0,quota:false,dropped:2};}};
  await serve(createServer(env,deps),async base=>{
    assert.equal((await post(base,{ref:{kind:'sample',topicId:'first-job'}})).status,400);
    const body={ref:{kind:'sample',topicId:'first-job'},facts:[{key:'finance',value:'要自己付房租'}],selections:[{fork:0,branch:1}]};
    const first=await (await post(base,body)).json();
    assert.equal(first.dropped,undefined);
    assert.deepEqual(inputs[0].options,['高薪小公司','低薪大厂']);
    assert.deepEqual(inputs[0].situations.map(s=>[s.id,s.value]),[['f0','要自己付房租'],['c0','经济压力大需稳定收入']]);
    assert.equal(inputs[0].situations[0].label,'经济状况');
    const again=await (await post(base,body)).json();
    assert.equal(again.cached,undefined,'没找到人的结果不缓存');
    assert.equal(inputs.length,2);
    await post(base,body);
    assert.equal((await (await post(base,body)).json()).cached,true,'找到人的结果复用');
    assert.equal(inputs.length,3);
    assert.equal((await post(base,{ref:{kind:'ask',question:'读博还是直接工作'},facts:[{key:'finance',value:'x'}]})).status,410);
  });
});
