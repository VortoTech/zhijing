import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildReadingMap,situationFit} from '../src/engine.mjs';
import {createReadingSession} from '../public/session.js';
import {createServer} from '../src/server.mjs';

const snapshot=JSON.parse(await readFile(new URL('../data/snapshot-first-job.json',import.meta.url)));
const topic=JSON.parse(await readFile(new URL('../topics/first-job.json',import.meta.url)));

test('真实样本：不是应届生不再产生绿色匹配，保留评论主体和否定',()=>{
  const r=snapshot.records.find(r=>r.id==='2839573207696871495');
  const fit=situationFit(r,{stage:'应届生'},topic);
  assert.equal(fit.level,'reference');
  assert.match(fit.evidence[0].text,/我这是社招，不是应届生/);
  assert.match(fit.evidence[0].note,/提及不代表适合/);
  assert.ok(situationFit(r,{stage:'社招 1-3 年'},topic));
});

test('多条件逐项报告：经济压力能找到缺钱原话，城市明确零覆盖',()=>{
  const map=buildReadingMap(snapshot.records,{topic,situation:{stage:'应届生',city:'一线',burden:'要补贴家用'}});
  assert.equal(map.situationCoverage.find(c=>c.id==='city').count,0);
  assert.ok(map.situationCoverage.find(c=>c.id==='burden').count>0);
  assert.ok(map.situationCoverage.find(c=>c.id==='stage').count>0);
  const r=map.records.find(r=>r.fit?.evidence.some(e=>e.field==='burden'));
  assert.match(r.fit.evidence.find(e=>e.field==='burden').text,/缺钱/);
});

test('相关性与摘句：异议保留；住房和城市不占据相关列表',()=>{
  const map=buildReadingMap(snapshot.records,{topic,meta:{mode:'snapshot'}});
  assert.equal(map.records.length,60);
  assert.equal(map.records.filter(r=>r.focused&&r.objections.length).length,5);
  assert.ok(map.records.filter(r=>/血泪史|想选一个二线城市/.test(r.title)).every(r=>!r.focused));
  for(const r of map.records.filter(r=>r.objections.length)){
    assert.equal(r.excerpt.label,'被回应的原句');
    assert.ok(r.text.includes(r.excerpt.text));
  }
  const top=map.records[0];
  assert.equal(top.commentCount,1332);
  assert.equal(top.sampledComments,0);
  assert.notEqual(top.excerpt.label,'本条主张');
});

test('切换/失败/取消后，旧筛选拿不到旧数据，迟到响应不能恢复结果',()=>{
  const s=createReadingSession();
  const a=s.begin('first-job:snapshot');
  const old={topic:{id:'first-job'},meta:{mode:'snapshot'},records:[{id:'old'}]};
  assert.equal(s.accept(a,old),true);
  const b=s.begin('kaoyan-vs-work:snapshot');
  assert.equal(a.signal.aborted,true);
  assert.equal(s.get(),null);
  assert.equal(s.accept(a,old),false);
  assert.equal(s.accept(b,old),false);
  s.cancel();
  assert.equal(s.get(),null);
  assert.equal(s.accept(b,{topic:{id:'kaoyan-vs-work'},meta:{mode:'snapshot'}}),false);
  const c=s.begin('first-job:snapshot');
  assert.equal(s.accept(c,old),true);
});

async function serve(server,fn){
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try{await fn('http://127.0.0.1:'+server.address().port);}
  finally{await new Promise(resolve=>server.close(resolve));}
}
const post=(base,input)=>fetch(base+'/api/reading-map',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});

test('不可用入口有模式信息，缺样本错误不泄露路径，来源元数据可读',async()=>{
  await serve(createServer({}),async base=>{
    const config=await (await fetch(base+'/api/config')).json();
    assert.equal(config.topics.find(t=>t.id==='first-job').availability.snapshot,true);
    assert.equal(config.topics.find(t=>t.id==='kaoyan-vs-work').availability.snapshot,false);
    assert.equal(config.topics.find(t=>t.id==='luohu-tax').availability.live,false);
    const failed=await post(base,{topicId:'kaoyan-vs-work'});
    assert.equal(failed.status,503);
    const error=(await failed.json()).error;
    assert.ok(!/ENOENT|\/Users\/|snapshot-/.test(error));
    const data=await (await post(base,{topicId:'first-job'})).json();
    assert.equal(data.meta.mode,'snapshot');
    assert.match(data.meta.provenance.objections,/人工/);
    assert.ok(data.meta.builtAt);
  });
});

test('实时并发与排序切换复用同一分析，失败不写入成功缓存',async()=>{
  let calls=0;
  const env={ZHIJING_ENABLE_PILOT:'1',ZHIHU_ACCESS_SECRET:'test-only',AI_BASE_URL:'https://example.invalid',AI_API_KEY:'test-only',AI_MODEL:'test'};
  const deps={fetchTopic:async()=>({records:snapshot.records,meta:{mode:'live'}}),classify:async records=>{
    calls++;
    if(calls===1)throw new Error('test upstream failure');
    await new Promise(resolve=>setTimeout(resolve,20));
    return records;
  }};
  await serve(createServer(env,deps),async base=>{
    assert.equal((await post(base,{topicId:'first-job',mode:'live'})).status,503);
    const responses=await Promise.all(['as-is','attention','situation'].map(order=>post(base,{topicId:'first-job',mode:'live',order})));
    assert.ok(responses.every(r=>r.status===200));
    await Promise.all(responses.map(r=>r.json()));
    assert.equal(calls,2);
    assert.equal((await post(base,{topicId:'first-job',mode:'live',situation:{stage:'应届生'}})).status,200);
    assert.equal(calls,2);
  });
});

test('已配凭据也不能绕过话题门槛；内部试用只开放 first-job',async()=>{
  const env={ZHIHU_ACCESS_SECRET:'test-only',AI_BASE_URL:'https://example.invalid',AI_API_KEY:'test-only',AI_MODEL:'test'};
  await serve(createServer(env),async base=>{
    const config=await (await fetch(base+'/api/config')).json();
    assert.equal(config.liveReady,false);
    assert.equal((await post(base,{topicId:'first-job',mode:'live'})).status,422);
  });
  await serve(createServer({...env,ZHIJING_ENABLE_PILOT:'1'}),async base=>{
    const config=await (await fetch(base+'/api/config')).json();
    assert.equal(config.liveReady,true);
    assert.equal(config.topics.find(t=>t.id==='kaoyan-vs-work').availability.live,false);
    assert.equal((await post(base,{topicId:'kaoyan-vs-work',mode:'live'})).status,422);
  });
});

test('实时次数每日上限：超出返回 429 且不调上游，缓存命中不计次',async()=>{
  let calls=0;
  const env={ZHIJING_ENABLE_PILOT:'1',ZHIJING_LIVE_DAILY_LIMIT:'1',ZHIHU_ACCESS_SECRET:'test-only',AI_BASE_URL:'https://example.invalid',AI_API_KEY:'test-only',AI_MODEL:'test'};
  const deps={fetchTopic:async()=>({records:snapshot.records,meta:{mode:'live'}}),classify:async records=>{
    calls++;
    return records.map((r,i)=>i===1?{...r,objections:[],analysis:{status:'failed',reason:'batch_failed'}}:r);
  }};
  await serve(createServer(env,deps),async base=>{
    assert.equal((await post(base,{topicId:'first-job',mode:'live'})).status,200);
    assert.equal((await post(base,{topicId:'first-job',mode:'live'})).status,200);
    const over=await post(base,{topicId:'first-job',mode:'live',refresh:true});
    assert.equal(over.status,429);
    assert.match((await over.json()).error,/次数已用完/);
    assert.equal(calls,1);
    assert.equal((await post(base,{topicId:'first-job',mode:'snapshot'})).status,200);
  });
});

test('部分分析短时缓存；重新分析越过缓存；请求编号与脱敏日志可关联',async()=>{
  let calls=0;const logs=[];
  const env={ZHIJING_ENABLE_PILOT:'1',ZHIHU_ACCESS_SECRET:'hidden-credential',AI_BASE_URL:'https://example.invalid',AI_API_KEY:'hidden-credential',AI_MODEL:'test'};
  const deps={log:line=>logs.push(line),fetchTopic:async()=>({records:snapshot.records,meta:{mode:'live'}}),classify:async records=>{
    calls++;
    return records.map((r,i)=>calls===1&&i===1?{...r,objections:[],analysis:{status:'failed',reason:'batch_failed'}}:r);
  }};
  await serve(createServer(env,deps),async base=>{
    const first=await post(base,{topicId:'first-job',mode:'live'});
    const data=await first.json();
    assert.equal(data.records.length,60);
    assert.equal(data.diagnostics.analysisIncomplete,1);
    assert.equal(data.meta.requestId,first.headers.get('x-request-id'));
    assert.equal((await (await post(base,{topicId:'first-job',mode:'live'})).json()).diagnostics.analysisIncomplete,1);
    assert.equal(calls,1);
    assert.equal((await (await post(base,{topicId:'first-job',mode:'live',refresh:true})).json()).diagnostics.analysisIncomplete,0);
    await post(base,{topicId:'first-job',mode:'live',refresh:true});
    assert.equal(calls,2);
    assert.ok(logs.some(line=>JSON.parse(line).requestId===data.meta.requestId));
    assert.ok(!logs.join('').includes('hidden-credential'));
    assert.ok(!logs.join('').includes(snapshot.records[0].text));
  });
});
