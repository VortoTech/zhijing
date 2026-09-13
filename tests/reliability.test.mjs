import test from 'node:test';
import assert from 'node:assert/strict';
import {classify,classificationBatches} from '../src/pipeline/classify.mjs';
import {verifyClassification,looksLikeEmptyPraise} from '../src/pipeline/verify.mjs';
import {fetchTopic,clearCache,getJSON} from '../src/pipeline/fetch.mjs';
import {buildReadingMap} from '../src/engine.mjs';
import {liveTopicEnabled} from '../src/topics.mjs';

const env={AI_BASE_URL:'https://example.invalid/v1',AI_API_KEY:'secret-not-logged',AI_MODEL:'test',ZHIHU_ACCESS_SECRET:'test'};
const topic={id:'test-topic',title:'第一份工作',kind:'opinion',queries:['一','二','三','四'],situationFields:[]};
const source=(id='r1',comments=['说得好，但你引用的数据是去年的，今年已经完全不同了。'])=>({id,title:'第一份工作',text:'第一份工作应该优先看平台。不同公司并不相同。',comments,url:'https://www.zhihu.com/question/1/answer/2',voteUp:1});
const response=records=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({records:records.map(r=>({id:r.id,claim:'',objections:[]}))})}}]});
const inputs=options=>JSON.parse(JSON.parse(options.body).messages[1].content).records;
// 以下测试检验单轮的分批、重试与并发机制；投票见 precision.test.mjs。
const single={passes:1,reviewVotes:1};

test('先赞同再反驳不会被前缀规则过滤；纯赞同仍过滤',()=>{
  for(const comment of ['说得好，但数据过时了，今年的情况并不是这样。','谢谢分享，不过你忽略了现金流不足的情况。','同意部分观点，但我在小公司的经历完全相反。'])assert.equal(looksLikeEmptyPraise(comment),false);
  assert.equal(looksLikeEmptyPraise('说得好！！！'),true);
});

test('模型漏回保留原文；无效异议标为部分完成，而不是未见异议',()=>{
  const records=verifyClassification({records:[{id:'r1',claim:'',objections:[{commentIndex:9,type:'off_topic',targetClaim:'第一份工作',isSubstantive:true}]}]},[source(),source('r2')]);
  assert.equal(records.length,2);
  assert.equal(records[0].analysis.status,'partial');
  assert.equal(records[1].analysis.reason,'model_omitted');
  const map=buildReadingMap(records,{topic});
  assert.equal(map.diagnostics.total,2);
  assert.equal(map.diagnostics.flagged,0);
  assert.equal(map.diagnostics.analysisIncomplete,2);
  assert.equal(map.diagnostics.stateCounts.no_signal,0);
  assert.equal(map.diagnostics.verdict,'incomplete');
});

test('分批控制条数和字符；两个并发；无评论记录不调用模型',async()=>{
  const records=Array.from({length:13},(_,i)=>source(String(i)));
  assert.deepEqual(classificationBatches(records).map(b=>b.length),[6,6,1]);
  assert.equal(classificationBatches(records.slice(0,3).map(r=>({...r,text:'文'.repeat(8000)}))).length,3);
  let active=0,max=0,calls=0;
  const classified=await classify([...records,source('empty',[])],topic,env,{...single,request:async(_url,options)=>{
    calls++;active++;max=Math.max(max,active);
    await new Promise(resolve=>setTimeout(resolve,5));active--;
    return response(inputs(options));
  }});
  assert.equal(calls,3);assert.equal(max,2);assert.equal(classified.length,14);
  assert.equal(classified.at(-1).analysis.status,'no_comments');
});

test('截断输出重试一次；只重试模型遗漏记录',async()=>{
  let calls=0;
  const records=await classify([source(),source('r2')],topic,env,{...single,request:async(_url,options)=>{
    calls++;const batch=inputs(options);
    if(calls===1)return response(batch.slice(0,1));
    assert.deepEqual(batch.map(r=>r.id),['r2']);return response(batch);
  }});
  assert.equal(calls,2);assert.ok(records.every(r=>r.analysis.status==='complete'));
  calls=0;
  const failed=await classify([source()],topic,env,{...single,request:async()=>{calls++;return {choices:[{finish_reason:'length',message:{content:'{"records":[]}'}}]};}});
  assert.equal(calls,2);assert.equal(failed[0].analysis.status,'failed');
});

test('批次部分失败不丢记录；鉴权错误不重复调用；超时停止新增调用',async()=>{
  const records=Array.from({length:7},(_,i)=>source(String(i)));
  let calls=0;
  const classified=await classify(records,topic,env,{...single,request:async(_url,options)=>{
    calls++;const batch=inputs(options);
    if(batch[0].id==='0')throw Object.assign(new Error('secret upstream error'),{status:401});
    return response(batch);
  }});
  assert.equal(calls,2);assert.equal(classified.length,7);
  assert.equal(classified.filter(r=>r.analysis.status==='failed').length,6);
  assert.ok(!JSON.stringify(classified).includes('secret upstream error'));
  const controller=new AbortController();controller.abort();
  const timed=await classify(records,topic,env,{signal:controller.signal,request:()=>assert.fail('must not call')});
  assert.ok(timed.every(r=>r.analysis.reason==='analysis_timeout'));
});

test('部分检索失败保留成功结果，报告缺口，不写成功缓存',async()=>{
  clearCache();let calls=0;
  const raw={ContentID:'r1',Title:'标题',ContentText:'第一份工作应该优先看平台',Url:'https://www.zhihu.com/question/1/answer/2'};
  const search=async q=>{calls++;if(q==='二')throw new Error('fail');return [raw];};
  const first=await fetchTopic(topic,env,{search});
  assert.equal(first.meta.failedQueries,1);assert.equal(first.meta.successfulQueries,3);
  await fetchTopic(topic,env,{search});assert.equal(calls,8);clearCache();
});

test('检索逐路发送，限流时重试一次',async()=>{
  clearCache();let active=0,peak=0;const tries={};
  const raw={ContentID:'r1',Title:'标题',ContentText:'第一份工作应该优先看平台',Url:'https://www.zhihu.com/question/1/answer/2'};
  const search=async q=>{
    active++;peak=Math.max(peak,active);tries[q]=(tries[q]||0)+1;
    await new Promise(r=>setTimeout(r,1));active--;
    if(q==='二'&&tries[q]===1)throw Object.assign(new Error('限流'),{rateLimited:true});
    if(q==='三')throw Object.assign(new Error('限流'),{rateLimited:true});
    return [raw];
  };
  const result=await fetchTopic(topic,env,{search});
  assert.equal(peak,1);assert.equal(tries['二'],2);assert.equal(tries['三'],2);
  assert.equal(result.meta.failedQueries,1);clearCache();
});

test('话题门槛默认关闭；试用开关仅开放 pilot，不能开放 blocked',()=>{
  assert.equal(liveTopicEnabled({...topic,liveStatus:'pilot'},{}),false);
  assert.equal(liveTopicEnabled({...topic,liveStatus:'pilot'},{ZHIJING_ENABLE_PILOT:'1'}),true);
  assert.equal(liveTopicEnabled({...topic,liveStatus:'blocked'},{ZHIJING_ENABLE_PILOT:'1'}),false);
  assert.equal(liveTopicEnabled(topic,{ZHIJING_ENABLE_PILOT:'1'}),false);
});

test('传输层接受外部取消信号',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(getJSON('http://127.0.0.1:1',{signal:controller.signal}),{name:'AbortError'});
});
