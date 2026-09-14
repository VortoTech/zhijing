import test from 'node:test';
import assert from 'node:assert/strict';
import {chatJSON,resetModelFallback} from '../src/pipeline/classify.mjs';

const env={AI_BASE_URL:'https://example.invalid/v1',AI_API_KEY:'k',AI_MODEL:'primary',AI_FALLBACK_MODEL:'backup',AI_EXTRA_BODY:'{"thinking":{"type":"disabled"}}'};
const ok=content=>({choices:[{finish_reason:'stop',message:{content}}]});
const args={system:'s',user:{q:1},maxTokens:10};
const quiet=fn=>async()=>{const info=console.info;console.info=()=>{};try{await fn();}finally{console.info=info;}};

test('主模型超时：改用备用模型重试一次，不带主模型的私有参数；之后 5 分钟直接走备用，过了窗口再试主模型',quiet(async()=>{
  resetModelFallback();
  const seen=[];let clock=1000;
  const request=async(url,{body})=>{
    const payload=JSON.parse(body);seen.push(payload);
    if(payload.model==='primary')throw Object.assign(new Error('timeout'),{name:'TimeoutError'});
    return ok('{"a":1}');
  };
  assert.deepEqual(await chatJSON(args,env,request,undefined,{now:()=>clock}),{a:1});
  assert.deepEqual(seen.map(p=>p.model),['primary','backup']);
  assert.ok(seen[0].thinking,'主模型带私有参数');
  assert.equal(seen[1].thinking,undefined,'备用不带');
  clock+=60_000;
  await chatJSON(args,env,request,undefined,{now:()=>clock});
  assert.equal(seen.length,3,'窗口内不再先等主模型');
  assert.equal(seen[2].model,'backup');
  clock+=5*60_000;
  await chatJSON(args,env,request,undefined,{now:()=>clock});
  assert.deepEqual(seen.slice(3).map(p=>p.model),['primary','backup'],'窗口过后先试主模型');
}));

test('上游 5xx、429 和网络错误都切备用',quiet(async()=>{
  for(const failure of [Object.assign(new Error('上游请求失败'),{status:503}),Object.assign(new Error('上游请求失败'),{status:429}),new TypeError('fetch failed')]){
    resetModelFallback();
    const models=[];
    const request=async(url,{body})=>{const model=JSON.parse(body).model;models.push(model);if(model==='primary')throw failure;return ok('{}');};
    await chatJSON(args,env,request);
    assert.deepEqual(models,['primary','backup'],String(failure.status||failure.name));
  }
}));

test('内容不合规、用户取消、4xx、没配备用：都不切备用',quiet(async()=>{
  resetModelFallback();
  const models=[];
  await assert.rejects(chatJSON(args,env,async(url,{body})=>{models.push(JSON.parse(body).model);return ok('不是 JSON');}),/合法 JSON/);
  assert.deepEqual(models,['primary']);
  const controller=new AbortController();controller.abort();
  await assert.rejects(chatJSON(args,env,async()=>{throw Object.assign(new Error('aborted'),{name:'AbortError'});},controller.signal),/aborted/);
  await assert.rejects(chatJSON(args,env,async()=>{throw Object.assign(new Error('上游请求失败'),{status:401});}),/上游请求失败/);
  const {AI_FALLBACK_MODEL,...noFallback}=env;
  await assert.rejects(chatJSON(args,noFallback,async()=>{throw Object.assign(new Error('上游请求失败'),{status:502});}),/上游请求失败/);
  resetModelFallback();
}));
