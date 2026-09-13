import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchCollections,normalizeCollection,sentenceOf,runCheckup} from '../src/userdata.mjs';
import {createServer} from '../src/server.mjs';

const env={ZHIHU_ACCESS_SECRET:'secret-test',AI_BASE_URL:'https://example.invalid',AI_API_KEY:'k',AI_MODEL:'m',ZHIJING_ENABLE_PILOT:'1'};
const raw=(url,extra={})=>({ContentType:'answer',Url:url,Title:'考研还是工作 - 知乎',Summary:'如果家里经济压力大，建议先工作。读研要三年没有收入。',LikeCount:10,CommentCount:5,FavTime:1,Author:{Name:'答主甲'},...extra});

test('读取收藏：带 Access Secret 与 X-OAuth-Token；只保留回答和文章，链接只接受知乎域名；授权失效单独报出',async()=>{
  let seen;
  const items=await fetchCollections(env,'user-tok',{request:async(url,options)=>{
    seen={url:String(url),headers:options.headers};
    return {Code:0,Data:{Items:[
      raw('https://www.zhihu.com/question/1/answer/11'),
      raw('https://evil.example/question/2/answer/22'),
      {ContentType:'pin',Url:'https://www.zhihu.com/pin/3',Title:'一条想法'}
    ]}};
  }});
  assert.match(seen.url,/\/api\/v1\/user\/collections\?Limit=50$/);
  assert.equal(seen.headers.Authorization,'Bearer secret-test');
  assert.equal(seen.headers['X-OAuth-Token'],'user-tok');
  assert.equal(items.length,1);
  assert.deepEqual([items[0].title,items[0].author],['考研还是工作','答主甲']);
  await assert.rejects(fetchCollections(env,'t',{request:async()=>({Code:20001,Message:'auth'})}),e=>e.reason==='auth');
  await assert.rejects(fetchCollections(env,'t',{request:async()=>{throw Object.assign(new Error('x'),{status:500});}}),e=>e.reason==='upstream');
});

test('体检：用回答里的一句话搜索，对上的才分析；有人不同意的排在前面',async()=>{
  assert.equal(sentenceOf('如果家里经济压力大，建议先工作。读研要三年没有收入。'),'如果家里经济压力大，建议先工作');
  const items=[
    normalizeCollection(raw('https://www.zhihu.com/question/2/answer/22',{Summary:'完全不同的一段话，这条搜不到。'})),
    normalizeCollection(raw('https://www.zhihu.com/question/1/answer/11')),
    normalizeCollection(raw('https://www.zhihu.com/question/3/answer/33',{Summary:'第三条回答的正文摘要，有评论但没人反驳。'}))
  ];
  const queries=[];
  const search=async q=>{
    queries.push(q);
    if(q.startsWith('如果家里'))return [{ContentID:'11',Url:'https://www.zhihu.com/question/1/answer/11',Title:'考研还是工作',ContentText:'如果家里经济压力大，建议先工作。',CommentInfoList:[{Content:'我是 985 本科，情况不一样'}]}];
    if(q.startsWith('第三条'))return [{ContentID:'33',Url:'https://www.zhihu.com/question/3/answer/33',Title:'问题三',ContentText:'第三条回答的正文摘要',CommentInfoList:[{Content:'说得好'}]}];
    return [{ContentID:'999',Url:'https://www.zhihu.com/question/2/answer/999',Title:'别的回答',ContentText:'别的内容'}];
  };
  const classifier=async records=>records.map(r=>r.id==='11'
    ?{...r,analysis:{status:'complete'},objections:[{commentIndex:0,type:'adds_condition',typeLabel:'补充适用条件',commentText:r.comments[0],targetClaim:''}]}
    :{...r,analysis:{status:'complete'},objections:[]});
  const out=await runCheckup(items,env,{search,classifier});
  assert.equal(queries.length,3);
  assert.deepEqual([out.checked,out.matched,out.withComments,out.pushback],[3,2,2,1]);
  assert.deepEqual(out.items.map(i=>i.status),['pushback','quiet','unmatched']);
  assert.equal(out.items[0].objections[0].commentText,'我是 985 本科，情况不一样');
});

async function serve(server,fn){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await fn(`http://127.0.0.1:${server.address().port}`);}
  finally{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
}
function stubOAuth(token='user-tok'){
  return {
    available:true,callbackPath:'/auth/callback',clearLoginCookie:()=>'zj_login=; Max-Age=0',
    begin(){},complete(){},stats:()=>({sessions:1}),dropped:0,
    current:c=>c.zj_sid==='s1'?{uid:'u1',hashId:'h1',name:'甲',headline:'',avatar:''}:null,
    accessToken(c){return c.zj_sid==='s1'?token:null;},
    dropToken(){this.dropped++;},
    end:()=>'zj_sid=; Max-Age=0'
  };
}

test('收藏接口：未登录 401；登录后返回收藏且不带摘要；体检计入每日次数、同一用户 15 分钟内复用',async()=>{
  let checks=0;
  const deps={
    oauth:stubOAuth(),
    fetchCollections:async(_env,token)=>{assert.equal(token,'user-tok');return [normalizeCollection(raw('https://www.zhihu.com/question/1/answer/11'))];},
    runCheckup:async items=>{checks++;return {checked:items.length,total:items.length,matched:0,withComments:0,pushback:0,items:[]};}
  };
  await serve(createServer({...env,ZHIJING_LIVE_DAILY_LIMIT:'1'},deps),async base=>{
    assert.equal((await fetch(base+'/api/my/collections')).status,401);
    const list=await (await fetch(base+'/api/my/collections',{headers:{cookie:'zj_sid=s1'}})).json();
    assert.equal(list.items[0].title,'考研还是工作');
    assert.equal(list.items[0].summary,undefined);
    const post=()=>fetch(base+'/api/my/checkup',{method:'POST',headers:{cookie:'zj_sid=s1','content-type':'application/json'},body:'{}'});
    assert.equal((await post()).status,200);
    assert.equal((await post()).status,200);
    assert.equal(checks,1);
    assert.equal((await fetch(base+'/api/my/checkup',{method:'POST',headers:{cookie:'zj_sid=s1',origin:'https://evil.example'}})).status,403);
  });
});

test('授权过期或被知乎拒绝：提示重新登录，并清空服务端 token',async()=>{
  await serve(createServer(env,{oauth:stubOAuth(null)}),async base=>{
    const res=await fetch(base+'/api/my/collections',{headers:{cookie:'zj_sid=s1'}});
    assert.equal(res.status,401);
    assert.equal((await res.json()).relogin,true);
  });
  const oauth=stubOAuth();
  await serve(createServer(env,{oauth,fetchCollections:async()=>{throw Object.assign(new Error('x'),{reason:'auth'});}}),async base=>{
    const res=await fetch(base+'/api/my/collections',{headers:{cookie:'zj_sid=s1'}});
    assert.equal(res.status,401);
    assert.equal(oauth.dropped,1);
  });
});
