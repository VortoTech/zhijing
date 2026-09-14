import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../src/server.mjs';
import {createMemoryStore} from '../src/store.mjs';

const env={AI_BASE_URL:'https://example.invalid',AI_API_KEY:'k',AI_MODEL:'m',ZHIJING_ENABLE_PILOT:'1'};
const reply={understanding:'u',points:[],counterpoints:[],assumptions:[],gaps:[],advice:null,nextQuestion:null,factProposals:[],selected:[],search:null,dropped:0};

async function serve(server,fn){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await fn(`http://127.0.0.1:${server.address().port}`);}
  finally{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
}
function stubOAuth(users){
  return {
    available:true,callbackPath:'/auth/callback',clearLoginCookie:()=>'zj_login=; Max-Age=0',begin(){},complete(){},stats:()=>({sessions:0}),
    async current(c){return users[c.zj_sid]||null;},
    accessToken(c){return users[c.zj_sid]?.token||null;},
    dropToken(){},
    async end(){return 'zj_sid=; Max-Age=0';}
  };
}
const json=(base,path,body,{method='POST',sid}={})=>fetch(base+path,{method,headers:{'content-type':'application/json',...(sid?{cookie:'zj_sid='+sid}:{})},body:body===undefined?undefined:JSON.stringify(body)});

test('决策陪伴：示例问题直接可问；输入校验；未开放、过期、跨站、非 JSON 分别拒绝',async()=>{
  const seen=[];
  const logs=[];
  const deps={advise:async(input,dataset)=>{seen.push({input,dataset});return {...reply,selected:[]};},log:line=>logs.push(line)};
  await serve(createServer(env,deps),async base=>{
    const ok=await json(base,'/api/advice',{ref:{kind:'sample',topicId:'first-job'},selections:[{fork:0,branch:1},{fork:'x',branch:3}],
      facts:[{key:'finance',value:'要自己付房租'},{key:'salary',value:'1万'},{key:'city',value:''}],history:[{role:'assistant',text:'上一轮'}],message:'我家里没法支持我'});
    assert.equal(ok.status,200);
    const body=await ok.json();
    assert.equal(body.personalized,false);
    assert.equal(body.factsUsed,1);
    assert.equal(body.dropped,undefined);
    const {input,dataset}=seen[0];
    assert.deepEqual(input.selections,[{fork:0,branch:1}]);
    assert.deepEqual(input.facts,[{key:'finance',value:'要自己付房租'}]);
    assert.equal(input.message,'我家里没法支持我');
    assert.equal(dataset.comparison.status,'complete');
    assert.ok(!logs.join('').includes('我家里没法支持我'),'日志不记录用户的话');
    assert.ok(!logs.join('').includes('要自己付房租'),'日志不记录用户情况');

    assert.equal((await json(base,'/api/advice',{ref:{kind:'ask',question:'读博还是直接工作'}})).status,410,'没检索过的问题提示重新检索');
    assert.equal((await json(base,'/api/advice',{ref:{kind:'sample',topicId:'first-job'},message:'长'.repeat(301)})).status,400);
    assert.equal((await json(base,'/api/advice',{})).status,400);
    assert.equal((await fetch(base+'/api/advice',{method:'POST',headers:{'content-type':'application/json',origin:'https://evil.example'},body:'{}'})).status,403);
    assert.equal((await fetch(base+'/api/advice',{method:'POST',body:'{}'})).status,415);
  });
  await serve(createServer({},deps),async base=>{
    assert.equal((await json(base,'/api/advice',{ref:{kind:'sample',topicId:'first-job'}})).status,503);
  });
});

test('我的情况：未登录 401、读不到资料 409；默认不入库，打开「记住」后才保存，推测的待确认不进建议',async()=>{
  const store=createMemoryStore();
  const id=await store.upsertUser({uid:'u1',name:'甲'});
  const users={s1:{uid:'u1',name:'甲',userId:id,token:'tok'},s2:{name:'知乎用户',userId:null}};
  const seen=[];
  const deps={store,oauth:stubOAuth(users),
    advise:async input=>{seen.push(input);return {...reply,advice:{text:'先问清融资',facts:[],refs:[],basis:'speculation'},selected:[{fork:0,branch:1,label:'经济',when:'压力大',lean:'低薪大厂'}]};},
    fetchCollections:async()=>[{title:'应届生第一份工作怎么选'}],
    inferProfile:async()=>[{key:'stage',label:'当前阶段',value:'可能是应届生',evidenceRef:'收藏：《应届生第一份工作怎么选》'}]};
  await serve(createServer({...env,ZHIHU_ACCESS_SECRET:'s'},deps),async base=>{
    assert.equal((await fetch(base+'/api/profile')).status,401);
    assert.equal((await json(base,'/api/profile',undefined,{method:'GET',sid:'s2'})).status,409);
    let profile=await (await json(base,'/api/profile',undefined,{method:'GET',sid:'s1'})).json();
    assert.deepEqual(profile,{personalize:false,consentAt:null,facts:[],decisions:[]});
    assert.equal((await json(base,'/api/profile/facts',{action:'add',key:'finance',value:'要自己付房租'},{sid:'s1'})).status,409,'没打开记住时不入库');

    // 推测：未打开记住时只返回，不保存
    let inferred=await (await json(base,'/api/profile/infer',{},{sid:'s1'})).json();
    assert.equal(inferred.proposals[0].value,'可能是应届生');
    assert.deepEqual(inferred.facts,[]);

    profile=await (await json(base,'/api/profile/personalize',{on:true},{sid:'s1'})).json();
    assert.equal(profile.personalize,true);
    await json(base,'/api/profile/facts',{action:'add',key:'finance',value:'要自己付房租'},{sid:'s1'});
    assert.equal((await json(base,'/api/profile/facts',{action:'add',key:'salary',value:'x'},{sid:'s1'})).status,400);
    inferred=await (await json(base,'/api/profile/infer',{},{sid:'s1'})).json();
    assert.deepEqual(inferred.facts.map(f=>[f.key,f.status,f.source]),[['finance','confirmed','declared'],['stage','pending','inferred']]);

    // 建议以数据库里确认过的情况为准，忽略页面传来的；待确认的推测不进建议
    const advice=await (await json(base,'/api/advice',{ref:{kind:'sample',topicId:'first-job'},facts:[{key:'city',value:'页面传来的'}]},{sid:'s1'})).json();
    assert.equal(advice.personalized,true);
    assert.deepEqual(seen.at(-1).facts,[{key:'finance',value:'要自己付房租'}]);
    const pending=inferred.facts.find(f=>f.status==='pending');
    profile=await (await json(base,'/api/profile/facts',{action:'confirm',id:pending.id},{sid:'s1'})).json();
    await json(base,'/api/advice',{ref:{kind:'sample',topicId:'first-job'}},{sid:'s1'});
    assert.deepEqual(seen.at(-1).facts.map(f=>f.key),['finance','stage'],'确认后才进建议');
    profile=await (await json(base,'/api/profile',undefined,{method:'GET',sid:'s1'})).json();
    assert.equal(profile.decisions[0].note,'先问清融资');
    assert.deepEqual(profile.decisions[0].selections,[{label:'经济',when:'压力大',lean:'低薪大厂'}]);

    const finance=profile.facts.find(f=>f.key==='finance');
    profile=await (await json(base,'/api/profile/facts',{action:'delete',id:finance.id},{sid:'s1'})).json();
    assert.deepEqual(profile.facts.map(f=>f.key),['stage']);
    assert.equal((await fetch(base+'/api/profile/personalize',{method:'POST',headers:{'content-type':'application/json',cookie:'zj_sid=s1',origin:'https://evil.example'},body:'{"on":false}'})).status,403);

    // 关闭记住：情况和决策记录一起删除
    profile=await (await json(base,'/api/profile/personalize',{on:false},{sid:'s1'})).json();
    assert.deepEqual([profile.facts,profile.decisions],[[],[]]);
    assert.deepEqual(await store.listFacts(id),[]);

    // 删除全部数据：清掉用户记录与登录
    const gone=await json(base,'/api/profile',undefined,{method:'DELETE',sid:'s1'});
    assert.equal(gone.status,200);
    assert.match(gone.headers.get('set-cookie'),/zj_sid=;/);
    assert.equal(await store.getUser(id),null);
  });
});

test('从收藏推测：授权过期提示重新登录',async()=>{
  const store=createMemoryStore();
  const id=await store.upsertUser({uid:'u1',name:'甲'});
  await serve(createServer({...env,ZHIHU_ACCESS_SECRET:'s'},{store,oauth:stubOAuth({s1:{uid:'u1',userId:id,token:null}})}),async base=>{
    const res=await json(base,'/api/profile/infer',{},{sid:'s1'});
    assert.equal(res.status,401);
    assert.equal((await res.json()).relogin,true);
  });
});

test('实时检索的结果存进数据库：内存缓存没有了，决策陪伴仍能取回原话',async()=>{
  const store=createMemoryStore();
  await store.saveResult('ask:读博还是直接工作',{records:[],comparison:{status:'complete',options:['读博','工作'],sides:[],forks:[]}});
  let got;
  await serve(createServer(env,{store,advise:async(input,dataset)=>{got={input,dataset};return reply;}}),async base=>{
    assert.equal((await json(base,'/api/advice',{ref:{kind:'ask',question:'读博还是直接工作'}})).status,200);
    assert.equal(got.input.question,'读博还是直接工作');
    assert.deepEqual(got.dataset.comparison.options,['读博','工作']);
  });
});
