import test from 'node:test';
import assert from 'node:assert/strict';
import {classify,extraBody,FIRST_PASS_RUNS,REVIEW_VOTES} from '../src/pipeline/classify.mjs';
import {buildReadingMap} from '../src/engine.mjs';

const env={AI_BASE_URL:'https://example.invalid/v1',AI_API_KEY:'secret-not-logged',AI_MODEL:'test'};
const topic={id:'t',title:'第一份工作',kind:'opinion',queries:['一'],focusTerms:['第一份'],situationFields:[]};
const text='第一份工作应该优先看平台。不同公司并不相同。';
const rec=(id,title='第一份工作怎么选')=>({id,title,text,comments:['说得好，但你引用的数据是去年的，今年已经完全不同了。'],url:'https://www.zhihu.com/question/1/answer/2',voteUp:1});
const single={passes:1,reviewVotes:1};
const bodyOf=options=>JSON.parse(options.body);
const isReview=options=>bodyOf(options).messages[0].content.startsWith('你是异议复核员');
const reply=value=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});
const objection=(type='questions_data')=>({commentIndex:0,type,targetClaim:'第一份工作应该优先看平台',isSubstantive:true});
const firstPass=(options,objections=[objection()])=>reply({records:JSON.parse(bodyOf(options).messages[1].content).records.map(r=>({id:r.id,claim:'',objections}))});
const reviewItems=options=>JSON.parse(bodyOf(options).messages[1].content).items;
const allKeep=(options,keep=()=>true)=>reply({verdicts:reviewItems(options).map(i=>({key:i.key,keep:keep(i)}))});

test('AI_EXTRA_BODY 并入每次请求体；非法配置在调用模型前报错',async()=>{
  assert.deepEqual(extraBody({}),{});
  assert.throws(()=>extraBody({AI_EXTRA_BODY:'not json'}),/JSON 对象/);
  assert.throws(()=>extraBody({AI_EXTRA_BODY:'[1]'}),/JSON 对象/);
  assert.throws(()=>extraBody({AI_EXTRA_BODY:'{"model":"x"}'}),/不能覆盖/);
  await assert.rejects(classify([rec('a')],topic,{...env,AI_EXTRA_BODY:'oops'},{request:()=>assert.fail('must not call')}),/JSON 对象/);
  const bodies=[];
  await classify([rec('a')],topic,{...env,AI_EXTRA_BODY:'{"thinking":{"type":"disabled"}}'},{...single,request:async(_url,options)=>{
    bodies.push(bodyOf(options));
    return isReview(options)?allKeep(options):firstPass(options);
  }});
  assert.equal(bodies.length,2);
  assert.ok(bodies.every(b=>b.thinking?.type==='disabled'&&b.model==='test'&&b.response_format?.type==='json_object'));
});

test('标题与话题不相关的回答不送模型，标为未分析，不算未见异议也不计入密度',async()=>{
  const sent=[];
  const records=await classify([rec('in'),rec('out','想选一个二线城市生活，哪个比较好')],topic,env,{...single,request:async(_url,options)=>{
    sent.push(...JSON.parse(bodyOf(options).messages[1].content).records.map(r=>r.id));
    return firstPass(options,[]);
  }});
  assert.deepEqual(sent,['in']);
  assert.equal(records[1].analysis.status,'out_of_focus');
  const map=buildReadingMap(records,{topic});
  const out=map.records.find(r=>r.id==='out');
  assert.equal(out.trust.id,'out_of_focus');
  assert.equal(map.diagnostics.stateCounts.no_signal,1);
  assert.equal(map.diagnostics.stateCounts.out_of_focus,1);
  assert.equal(map.diagnostics.outOfFocus,1);
  assert.equal(map.diagnostics.surfaces.whole.total,1);
  assert.notEqual(map.diagnostics.verdict,'incomplete');
});

test('默认投票路径：复核判否的异议被丢弃，判是的保留，记录仍为完成',async()=>{
  assert.equal(FIRST_PASS_RUNS,2);assert.equal(REVIEW_VOTES,3);
  let firstCalls=0,reviewCalls=0;
  const records=await classify([rec('a','第一份工作 A'),rec('b','第一份工作 B')],topic,env,{request:async(_url,options)=>{
    if(isReview(options)){reviewCalls++;return allKeep(options,i=>i.question.includes('A'));}
    firstCalls++;return firstPass(options);
  }});
  assert.equal(firstCalls,2);assert.equal(reviewCalls,3);
  assert.equal(records[0].objections.length,1);
  assert.equal(records[1].objections.length,0);
  assert.ok(records.every(r=>r.analysis.status==='complete'));
});

test('复核失败或漏回时不展示候选异议，并标为分析未完成',async()=>{
  let reviews=0;
  const failed=await classify([rec('a')],topic,env,{...single,request:async(_url,options)=>{
    if(!isReview(options))return firstPass(options);
    reviews++;throw Object.assign(new Error('secret upstream error'),{status:500});
  }});
  assert.equal(reviews,2);
  assert.equal(failed[0].objections.length,0);
  assert.equal(failed[0].analysis.status,'partial');
  assert.equal(failed[0].analysis.reason,'review_failed');
  assert.equal(buildReadingMap(failed,{topic}).records[0].trust.id,'incomplete');
  assert.ok(!JSON.stringify(failed).includes('secret upstream error'));

  const omitted=await classify([rec('a')],topic,env,{...single,request:async(_url,options)=>
    isReview(options)?reply({verdicts:[]}):firstPass(options)});
  assert.equal(omitted[0].objections.length,0);
  assert.equal(omitted[0].analysis.status,'partial');
});

test('第一轮多次取并集：只有一轮找到的候选也会进入复核',async()=>{
  let firstCalls=0;
  const records=await classify([rec('a')],topic,env,{passes:2,reviewVotes:1,request:async(_url,options)=>{
    if(isReview(options))return allKeep(options);
    firstCalls++;return firstPass(options,firstCalls===1?[objection()]:[]);
  }});
  assert.equal(firstCalls,2);
  assert.equal(records[0].objections.length,1);
  assert.equal(records[0].analysis.status,'complete');
});

test('复核多数票：3 票中至少 2 票判是才保留；只有 1 票判是则删除且不算未完成',async()=>{
  const run=async votes=>{let n=0;return classify([rec('a')],topic,env,{passes:1,reviewVotes:3,request:async(_url,options)=>
    isReview(options)?allKeep(options,()=>votes[n++]):firstPass(options)});};
  const kept=await run([true,true,false]);
  assert.equal(kept[0].objections.length,1);
  assert.equal(kept[0].analysis.status,'complete');
  const dropped=await run([true,false,false]);
  assert.equal(dropped[0].objections.length,0);
  assert.equal(dropped[0].analysis.status,'complete');
});

test('同一条评论在不同轮次被归成不同类型时，只保留得票最多的一个',async()=>{
  let firstCalls=0,reviewCalls=0;
  const records=await classify([rec('a')],topic,env,{passes:2,reviewVotes:3,request:async(_url,options)=>{
    if(isReview(options)){reviewCalls++;const call=reviewCalls;return allKeep(options,i=>i.proposedType==='adds_condition'||call<=2);}
    firstCalls++;return firstPass(options,[objection(firstCalls===1?'adds_condition':'counter_example')]);
  }});
  assert.equal(records[0].objections.length,1);
  assert.equal(records[0].objections[0].type,'adds_condition');
});

test('票数不足以决定时不展示该异议，并标为分析未完成',async()=>{
  let reviews=0;
  const records=await classify([rec('a')],topic,env,{passes:1,reviewVotes:3,request:async(_url,options)=>{
    if(!isReview(options))return firstPass(options);
    reviews++;
    if(reviews===1)return allKeep(options);
    throw Object.assign(new Error('upstream'),{status:500});
  }});
  assert.equal(reviews,5);
  assert.equal(records[0].objections.length,0);
  assert.equal(records[0].analysis.status,'partial');
  assert.equal(records[0].analysis.reason,'review_failed');
});

test('投票次数必须是正整数',async()=>{
  await assert.rejects(classify([rec('a')],topic,env,{passes:0,request:()=>assert.fail('must not call')}),/passes/);
  await assert.rejects(classify([rec('a')],topic,env,{reviewVotes:1.5,request:()=>assert.fail('must not call')}),/reviewVotes/);
});
