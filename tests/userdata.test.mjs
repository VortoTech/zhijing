import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchCollections,fetchContents,normalizeCollection,normalizeContent,contentId,sentenceOf,runCheckup,verifyUserApis} from '../src/userdata.mjs';
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
  const silent=normalizeCollection(raw('https://www.zhihu.com/question/4/answer/44',{CommentCount:0,Summary:'一条还没有人评论的回答内容。'}));
  const out=await runCheckup([...items,silent],env,{search,classifier});
  assert.equal(queries.length,3,'评论数为 0 的内容不去搜索');
  assert.deepEqual([out.checked,out.matched,out.withComments,out.pushback],[4,2,2,1]);
  assert.deepEqual(out.items.map(i=>i.status),['pushback','quiet','unmatched','uncommented']);
  assert.equal(out.items[0].objections[0].commentText,'我是 985 本科，情况不一样');
});

test('本人内容：读回答、文章和想法（想法没标题时用正文开头），过滤视频与站外链接；想法链接能取出编号',async()=>{
  let seen;
  const items=await fetchContents(env,'user-tok',{request:async url=>{
    seen=String(url);
    return {Code:0,Data:{Items:[
      {ContentType:'pin',Url:'https://www.zhihu.com/pin/2029',Title:'',Summary:'高赞不等于适合你。你被高赞回答坑过吗？'},
      {ContentType:'answer',Url:'https://www.zhihu.com/question/1/answer/11',Title:'考研还是工作',Summary:'看专业。'},
      {ContentType:'zvideo',Url:'https://www.zhihu.com/zvideo/9',Title:'视频'},
      {ContentType:'article',Url:'https://evil.example/p/1',Title:'站外'}
    ]}};
  }});
  assert.match(seen,/\/api\/v1\/user\/contents\?ContentType=all/);
  assert.deepEqual(items.map(i=>[i.type,i.title]),[['pin','高赞不等于适合你。你被高赞回答坑过吗？'],['answer','考研还是工作']]);
  assert.equal(contentId('https://www.zhihu.com/pin/2029'),'2029');
  assert.equal(normalizeContent({ContentType:'pin',Url:'https://www.zhihu.com/pin/1',Title:'',Summary:''}),null);
  assert.equal(normalizeCollection({ContentType:'pin',Url:'https://www.zhihu.com/pin/1',Title:'想法'}),null);
});

test('体检接口：body 里 source=contents 时读本人内容，和收藏体检分开缓存',async()=>{
  const calls={collections:0,contents:0};
  const deps={
    oauth:stubOAuth(),
    fetchCollections:async()=>{calls.collections++;return [];},
    fetchContents:async()=>{calls.contents++;return [];},
    runCheckup:async items=>({checked:items.length,total:0,matched:0,withComments:0,pushback:0,items:[]})
  };
  await serve(createServer(env,deps),async base=>{
    const post=body=>fetch(base+'/api/my/checkup',{method:'POST',headers:{cookie:'zj_sid=s1','content-type':'application/json'},body:JSON.stringify(body)});
    const mine=await (await post({source:'contents'})).json();
    assert.equal(mine.source,'contents');
    assert.equal((await (await post({})).json()).source,'collections');
    await post({source:'contents'});
    assert.deepEqual(calls,{collections:1,contents:1});
  });
});

test('授权验收：五项接口各读一条；收藏夹内容用第一个收藏夹的 UrlToken；成功、空数据、失败如实记录',async()=>{
  const seen=[];
  const request=async url=>{
    const u=new URL(url);seen.push(u.pathname.split('/').pop()+'?'+u.searchParams.toString());
    const name=u.pathname.split('/').pop();
    if(name==='contents')return {Code:0,Data:{Items:[{ContentType:'pin',Title:'高赞 ≠ 适合你'}],Paging:{Totals:3}}};
    if(name==='followees')return {Code:0,Data:{Items:[]}};
    if(name==='favlists')return {Code:0,Data:{Items:[{UrlToken:794069227,Title:'我的收藏',IsPublic:false}]}};
    if(name==='favlist_contents')return {Code:0,Data:{Items:[{ContentType:'article',Title:'如何自制一个超迷你的语音助手'}]}};
    return {Code:20001,Message:'auth failed'};
  };
  const results=await verifyUserApis(env,'user-tok',{request});
  assert.deepEqual(results.map(r=>[r.id,r.status]),[['contents','success'],['followees','empty'],['favlists','success'],['favlist_contents','success'],['collections','error']]);
  assert.ok(seen.some(s=>s.startsWith('favlist_contents?FavlistUrlToken=794069227')));
  assert.equal(results[0].sample.title,'高赞 ≠ 适合你');
  assert.equal(results[4].code,20001);

  const none=await verifyUserApis(env,'t',{request:async url=>new URL(url).pathname.endsWith('favlists')?{Code:0,Data:{Items:[]}}:{Code:0,Data:{Items:[]}}});
  assert.equal(none.find(r=>r.id==='favlist_contents').status,'empty');
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
