import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemoryStore,createPgStore,hashSid,MAX_FACTS} from '../src/store.mjs';

// 同一套行为分别跑内存实现与 PostgreSQL 实现。PostgreSQL 用 ZHIJING_TEST_DATABASE_URL 指向一个专用测试库（会清空知镜的表）。
async function contract(store){
  const a=await store.upsertUser({uid:'969570047710216200123',hashId:'h1',name:'甲',headline:'签名',avatar:''});
  assert.ok(a);
  assert.equal(await store.upsertUser({uid:'969570047710216200123',name:'甲改名'}),a,'同一个知乎账号只有一条用户记录');
  assert.equal(await store.upsertUser({uid:'',hashId:'',name:'知乎用户',profileMissing:true}),null,'读不到资料的用户不建记录');
  const b=await store.upsertUser({hashId:'only-hash',name:'乙'});
  assert.notEqual(a,b);

  // 会话：只存会话号的哈希；过期即失效
  await store.createSession('sid-1',{userId:a,user:{uid:'969570047710216200123',name:'甲'},expiresAt:Date.now()+60_000});
  assert.equal((await store.getSession('sid-1')).user.name,'甲');
  assert.equal((await store.getSession('sid-1')).userId,a);
  assert.equal(await store.getSession('sid-2'),null);
  await store.createSession('sid-old',{userId:a,user:{name:'甲'},expiresAt:Date.now()-1});
  assert.equal(await store.getSession('sid-old'),null);
  assert.equal(hashSid('x'),hashSid('x'));
  assert.notEqual(hashSid('x'),'x');

  // 我的情况：默认不记住；自己说的直接确认，推测的待确认
  assert.equal((await store.getUser(a)).personalize,false);
  assert.equal((await store.setPersonalize(a,true)).personalize,true);
  assert.ok((await store.getUser(a)).consentAt);
  const declared=await store.addFact(a,{key:'finance',value:'家里能兜底',source:'declared',status:'confirmed'});
  const inferred=await store.addFact(a,{key:'stage',value:'可能是应届生',source:'inferred',status:'pending',evidenceRef:'收藏：《应届生怎么选》'});
  assert.equal((await store.addFact(a,{key:'finance',value:'家里能兜底',source:'declared',status:'confirmed'})).id,declared.id,'重复的情况不重复记');
  let facts=await store.listFacts(a);
  assert.deepEqual(facts.map(f=>[f.key,f.status,f.source]),[['finance','confirmed','declared'],['stage','pending','inferred']]);
  assert.equal(facts[1].evidenceRef,'收藏：《应届生怎么选》');
  assert.equal(await store.confirmFact(b,inferred.id),null,'不能确认别人的情况');
  assert.equal(await store.deleteFact(b,declared.id),false,'不能删别人的情况');
  assert.equal((await store.confirmFact(a,inferred.id)).status,'confirmed');
  assert.equal(await store.deleteFact(a,declared.id),true);
  assert.deepEqual((await store.listFacts(a)).map(f=>f.key),['stage']);

  // 决策记录：同一问题覆盖
  await store.saveDecision(a,{question:'考研还是工作',selections:[{label:'经济',when:'压力大',lean:'工作'}],note:'先算现金流'});
  await store.saveDecision(a,{question:'考研还是工作',selections:[],note:'第二次'});
  await store.saveDecision(a,{question:'去大城市还是回老家',selections:[],note:''});
  const decisions=await store.listDecisions(a);
  assert.equal(decisions.length,2);
  assert.equal(decisions.find(d=>d.question==='考研还是工作').note,'第二次');

  // 条目上限
  for(let i=0;i<MAX_FACTS-1;i++)await store.addFact(b,{key:'other',value:'情况'+i,source:'declared',status:'confirmed'});
  await store.addFact(b,{key:'other',value:'最后一条',source:'declared',status:'confirmed'});
  await assert.rejects(store.addFact(b,{key:'other',value:'超出',source:'declared',status:'confirmed'}),e=>e.reason==='limit');

  // 关闭「记住我的情况」：情况和决策记录一并删除
  await store.setPersonalize(a,false);
  assert.deepEqual(await store.listFacts(a),[]);
  assert.deepEqual(await store.listDecisions(a),[]);

  // 删除我的全部数据：用户、会话、情况一起删
  await store.deleteUser(a);
  assert.equal(await store.getUser(a),null);
  assert.equal(await store.getSession('sid-1'),null);

  // 检索结果
  await store.saveResult('ask:考研还是工作',{records:[{id:'1',text:'原文'}],comparison:{status:'complete'}});
  assert.equal((await store.loadResult('ask:考研还是工作')).records[0].text,'原文');
  assert.equal(await store.loadResult('ask:没有'),null);
  await store.sweep();
}

test('内存存储：用户、会话、我的情况、决策记录、检索结果',()=>contract(createMemoryStore()));

const url=process.env.ZHIJING_TEST_DATABASE_URL;
test('PostgreSQL 存储：同一套行为',{skip:url?false:'未设置 ZHIJING_TEST_DATABASE_URL'},async()=>{
  const {default:pg}=await import('pg');
  const admin=new pg.Client({connectionString:url});
  await admin.connect();
  await admin.query('drop table if exists results,decisions,profile_facts,sessions,users cascade');
  const store=createPgStore(url);
  try{
    await store.init();
    await store.init();
    await contract(store);
    const {rows}=await admin.query('select sid_hash from sessions');
    assert.ok(rows.every(r=>!r.sid_hash.startsWith('sid-')),'库里没有明文会话号');
  }finally{
    await store.close();
    await admin.end();
  }
});
