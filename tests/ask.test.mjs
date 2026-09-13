import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeQuestion,planQuestion,askTopic,widenFocus} from '../src/ask.mjs';
import {createServer} from '../src/server.mjs';
import {createReadingSession} from '../public/session.js';

const snapshot=JSON.parse(await readFile(new URL('../data/snapshot-first-job.json',import.meta.url)));
const env={ZHIJING_ENABLE_PILOT:'1',ZHIHU_ACCESS_SECRET:'test-only',AI_BASE_URL:'https://example.invalid',AI_API_KEY:'test-only',AI_MODEL:'test'};
const reply=content=>async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]});

async function serve(server,fn){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await fn(`http://127.0.0.1:${server.address().port}`);}
  finally{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
}
const ask=(base,body,headers={})=>fetch(base+'/api/ask',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});

test('问题规整与长度限制',()=>{
  assert.equal(normalizeQuestion('  考研   还是 工作 '),'考研 还是 工作');
  assert.throws(()=>normalizeQuestion('考研'),/太短/);
  assert.throws(()=>normalizeQuestion('长'.repeat(81)),/80/);
  assert.throws(()=>normalizeQuestion(42),/问题/);
});

test('规划：原问题排第一，去重，丢弃非法和过长项',async()=>{
  const plan=await planQuestion('考研还是直接工作',env,{request:reply({
    kind:'opinion',
    queries:['考研 工作 怎么选','考研 工作 怎么选','',42,'x'.repeat(80),'二战 考研 还是 工作'],
    focusTerms:['考研','工作','这是一个特别长的关键词'],
    excerptTerms:['读研','就业']
  })});
  assert.equal(plan.kind,'opinion');
  assert.deepEqual(plan.queries,['考研还是直接工作','考研 工作 怎么选','二战 考研 还是 工作']);
  assert.deepEqual(plan.focusTerms,['考研','工作']);
  assert.equal(plan.planned,true);
});

test('规划：识别查资料类问题；模型失败时退回只用原问题',async()=>{
  const info=await planQuestion('上海落户需要什么条件',env,{request:reply({kind:'informational',queries:[],focusTerms:[],excerptTerms:[]})});
  assert.equal(info.kind,'informational');
  const fallback=await planQuestion('要不要转行',env,{request:async()=>{throw new Error('down');}});
  assert.deepEqual(fallback,{kind:'opinion',queries:['要不要转行'],focusTerms:[],excerptTerms:[],planned:false});
});

test('标题关键词命中太少时放宽为全部分析',()=>{
  const miss=askTopic('第一份工作选高薪还是成长',{queries:['q'],focusTerms:['完全不会出现的词'],excerptTerms:[]});
  assert.match(miss.id,/^ask-[0-9a-f]{12}$/);
  assert.deepEqual(widenFocus(miss,snapshot.records).focusTerms,[]);
  const hit=askTopic('第一份工作选高薪还是成长',{queries:['q'],focusTerms:['第一份'],excerptTerms:[]});
  assert.deepEqual(widenFocus(hit,snapshot.records).focusTerms,['第一份']);
});

test('自由提问：规划→检索→分类，带会话键，缓存复用，计入每日次数',async()=>{
  let plans=0,fetches=0,classes=0;
  const deps={
    planQuestion:async q=>{plans++;return {kind:'opinion',queries:[q,'第一份工作 高薪'],focusTerms:['第一份'],excerptTerms:['薪资'],planned:true};},
    fetchTopic:async topic=>{fetches++;assert.equal(topic.queries[0],'第一份工作选高薪还是成长');return {records:snapshot.records,meta:{mode:'live',failedQueries:0}};},
    classify:async(records,topic)=>{classes++;assert.deepEqual(topic.focusTerms,['第一份']);return records;}
  };
  await serve(createServer({...env,ZHIJING_LIVE_DAILY_LIMIT:'1'},deps),async base=>{
    const first=await ask(base,{question:'  第一份工作选高薪还是成长 '});
    assert.equal(first.status,200);
    const data=await first.json();
    assert.equal(data.meta.sessionKey,'ask:第一份工作选高薪还是成长');
    assert.equal(data.meta.question,'第一份工作选高薪还是成长');
    assert.equal(data.records.length,snapshot.records.length);
    const session=createReadingSession();
    assert.equal(session.accept(session.begin('ask:第一份工作选高薪还是成长'),data),true);
    assert.equal((await ask(base,{question:'第一份工作选高薪还是成长'})).status,200);
    assert.deepEqual([plans,fetches,classes],[1,1,1]);
    const over=await ask(base,{question:'考研还是直接工作'});
    assert.equal(over.status,429);
    assert.match((await over.json()).error,/次数已用完/);
  });
});

test('自由提问：查资料类 422 不检索；过短 400；跨站 403；未开放 503',async()=>{
  const deps={
    planQuestion:async()=>({kind:'informational',queries:['x'],focusTerms:[],excerptTerms:[],planned:true}),
    fetchTopic:async()=>assert.fail('不应检索'),
    classify:async()=>assert.fail('不应分类')
  };
  await serve(createServer(env,deps),async base=>{
    const info=await ask(base,{question:'上海落户需要什么条件'});
    assert.equal(info.status,422);
    const body=await info.json();
    assert.equal(body.informational,true);
    assert.match(body.error,/查资料/);
    assert.equal((await ask(base,{question:'考研'})).status,400);
    assert.equal((await ask(base,{question:'考研还是工作'},{origin:'https://evil.example'})).status,403);
  });
  await serve(createServer({...env,ZHIJING_ENABLE_PILOT:'0'},deps),async base=>{
    assert.equal((await ask(base,{question:'考研还是直接工作'})).status,503);
    const config=await (await fetch(base+'/api/config')).json();
    assert.equal(config.askReady,false);
  });
});

test('自由提问：检索为空时提示换个说法，日志不含问题原文',async()=>{
  const logs=[];
  const deps={
    log:line=>logs.push(line),
    planQuestion:async q=>({kind:'opinion',queries:[q],focusTerms:[],excerptTerms:[],planned:true}),
    fetchTopic:async()=>{throw Object.assign(new Error('本次没有检索到可用内容'),{empty:true});},
    classify:async records=>records
  };
  await serve(createServer(env,deps),async base=>{
    const res=await ask(base,{question:'一个没人问过的奇怪问题'});
    assert.equal(res.status,404);
    assert.match((await res.json()).error,/换个说法/);
  });
  assert.ok(logs.length);
  assert.ok(!logs.join('').includes('奇怪问题'));
});
