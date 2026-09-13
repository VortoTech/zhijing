import test from 'node:test';
import assert from 'node:assert/strict';
import {createOAuth,parseUser,parseCookies} from '../src/oauth.mjs';
import {createServer} from '../src/server.mjs';

const env={ZHIHU_OAUTH_APP_ID:'app-1',ZHIHU_OAUTH_APP_KEY:'key-secret-xyz',ZHIHU_OAUTH_REDIRECT_URI:'https://zhijing.example/auth/callback'};
const USER_TEXT='{"uid":969570047710216200123,"hash_id":"h1","fullname":"测试用户","headline":"一句话","avatar_path":"https://picx.zhimg.com/a.jpg"}';

// 模拟知乎：只认 access_token 与 /user 两个地址，记录每次调用。
function fakeZhihu({tokenBody={access_token:'tok-abc',token_type:'Bearer',expires_in:3600},userText=USER_TEXT}={}){
  const calls=[];
  return {calls,request:async(url,options={})=>{
    calls.push({url,options});
    if(url==='https://openapi.zhihu.com/access_token')return new Response(JSON.stringify(tokenBody),{status:200});
    if(url==='https://openapi.zhihu.com/user')return new Response(userText,{status:200});
    throw new Error('unexpected '+url);
  }};
}
const cookieValue=(setCookie,name)=>[].concat(setCookie).map(c=>c.split(';')[0]).find(c=>c.startsWith(name+'='))?.slice(name.length+1);

test('解析用户：uid 无损保存为字符串，头像只接受知乎图片域名，错误响应不建立会话',()=>{
  const user=parseUser(USER_TEXT);
  assert.equal(user.uid,'969570047710216200123');
  assert.equal(user.name,'测试用户');
  assert.equal(user.avatar,'https://picx.zhimg.com/a.jpg');
  assert.equal(parseUser('{"uid":1,"avatar_path":"https://evil.example/a.jpg"}').avatar,'');
  assert.equal(parseUser('{"code":404,"data":"User don\'t exist"}'),null);
  assert.equal(parseUser('不是 JSON'),null);
  assert.deepEqual(parseCookies('a=1; zj_sid=x%3Dy; bad=%E0'),{a:'1',zj_sid:'x=y'});
});

test('授权地址带 state，Cookie 为 HttpOnly/Secure/SameSite=Lax，App Key 不出现在地址里',()=>{
  const oauth=createOAuth(env,fakeZhihu());
  const {location,cookie}=oauth.begin();
  const url=new URL(location);
  assert.equal(url.origin+url.pathname,'https://openapi.zhihu.com/authorize');
  assert.equal(url.searchParams.get('app_id'),'app-1');
  assert.equal(url.searchParams.get('redirect_uri'),env.ZHIHU_OAUTH_REDIRECT_URI);
  assert.equal(url.searchParams.get('response_type'),'code');
  assert.ok(url.searchParams.get('state').length>=20);
  assert.ok(!location.includes('key-secret-xyz'));
  assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Lax/);
});

test('回调：正确 state 登录成功；重复、缺失、其他浏览器、过期都拒绝',async()=>{
  let clock=1_000_000;
  const zhihu=fakeZhihu();
  const oauth=createOAuth(env,{request:zhihu.request,now:()=>clock});
  const start=()=>{const {location,cookie}=oauth.begin();return {state:new URL(location).searchParams.get('state'),nonce:cookieValue(cookie,'zj_login')};};
  const query=(state,code='c-1')=>new URLSearchParams({authorization_code:code,...(state?{state}:{})});

  const ok=start();
  const {user,cookies}=await oauth.complete(query(ok.state),{zj_login:ok.nonce});
  assert.equal(user.name,'测试用户');
  const body=new URLSearchParams(zhihu.calls[0].options.body);
  assert.deepEqual(Object.fromEntries(body),{app_id:'app-1',app_key:'key-secret-xyz',grant_type:'authorization_code',redirect_uri:env.ZHIHU_OAUTH_REDIRECT_URI,code:'c-1'});
  assert.equal(zhihu.calls[1].options.headers.authorization,'Bearer tok-abc');
  assert.equal(oauth.current({zj_sid:cookieValue(cookies,'zj_sid')}).name,'测试用户');

  await assert.rejects(oauth.complete(query(ok.state),{zj_login:ok.nonce}),e=>e.reason==='state');
  await assert.rejects(oauth.complete(query(null),{zj_login:ok.nonce}),e=>e.reason==='state');
  const other=start();
  await assert.rejects(oauth.complete(query(other.state),{zj_login:'another-browser'}),e=>e.reason==='state');
  const late=start();
  clock+=11*60*1000;
  await assert.rejects(oauth.complete(query(late.state),{zj_login:late.nonce}),e=>e.reason==='state');
  assert.equal(zhihu.calls.length,2);
});

test('会话里保留 token 最多 1 小时、只在服务端；过期后身份仍在、token 为空；被拒后可清空',async()=>{
  let clock=0;
  const oauth=createOAuth(env,{request:fakeZhihu().request,now:()=>clock});
  const {location,cookie}=oauth.begin();
  const state=new URL(location).searchParams.get('state');
  const {cookies}=await oauth.complete(new URLSearchParams({state,authorization_code:'c'}),{zj_login:cookieValue(cookie,'zj_login')});
  const sid=cookieValue(cookies,'zj_sid');
  assert.equal(oauth.accessToken({zj_sid:sid}),'tok-abc');
  oauth.dropToken({zj_sid:sid});
  assert.equal(oauth.accessToken({zj_sid:sid}),null);
  const again=oauth.begin();
  const {cookies:second}=await oauth.complete(new URLSearchParams({state:new URL(again.location).searchParams.get('state'),authorization_code:'c'}),{zj_login:cookieValue(again.cookie,'zj_login')});
  const sid2=cookieValue(second,'zj_sid');
  clock+=3601*1000;
  assert.equal(oauth.accessToken({zj_sid:sid2}),null);
  assert.equal(oauth.current({zj_sid:sid2}).name,'测试用户');
});

test('换 token 失败不建立会话；读用户资料失败仍能登录（显示「知乎用户」），收藏功能不受影响',async()=>{
  const bad=createOAuth(env,fakeZhihu({tokenBody:{code:40001,message:'invalid'}}));
  const b=bad.begin();
  await assert.rejects(bad.complete(new URLSearchParams({state:new URL(b.location).searchParams.get('state'),authorization_code:'c'}),{zj_login:cookieValue(b.cookie,'zj_login')}));
  assert.equal(bad.stats().sessions,0);

  const noProfile=createOAuth(env,fakeZhihu({userText:'{"code":404,"data":"User don\'t exist"}'}));
  const n=noProfile.begin();
  const {user,cookies}=await noProfile.complete(new URLSearchParams({state:new URL(n.location).searchParams.get('state'),authorization_code:'c'}),{zj_login:cookieValue(n.cookie,'zj_login')});
  assert.equal(user.name,'知乎用户');
  assert.equal(user.profileMissing,true);
  assert.equal(noProfile.accessToken({zj_sid:cookieValue(cookies,'zj_sid')}),'tok-abc');
});

test('知乎回调不带 state 时，用本浏览器发起登录时留下的 Cookie 找回请求；Cookie 不对或重复使用仍拒绝',async()=>{
  const oauth=createOAuth(env,fakeZhihu());
  const nonce=cookieValue(oauth.begin().cookie,'zj_login');
  const noState=new URLSearchParams({authorization_code:'c'});
  await assert.rejects(oauth.complete(noState,{zj_login:'another-browser'}),e=>e.reason==='state');
  await assert.rejects(oauth.complete(noState,{}),e=>e.reason==='state');
  const ok=await oauth.complete(noState,{zj_login:nonce});
  assert.equal(ok.stateReturned,false);
  await assert.rejects(oauth.complete(noState,{zj_login:nonce}),e=>e.reason==='state');
});

test('/user 只带 OAuth token 失败时，改用 Access Secret + X-OAuth-Token 再试；也认 name/avatar_url 字段',async()=>{
  const calls=[];
  const request=async(url,options={})=>{
    calls.push(options.headers||{});
    if(url.endsWith('/access_token'))return new Response(JSON.stringify({access_token:'tok-abc',expires_in:3600}));
    return options.headers['x-oauth-token']
      ?new Response('{"data":{"name":"演示答主","avatar_url":"https://pic1.zhimg.com/x.jpg"}}')
      :new Response('{"code":401}',{status:401});
  };
  const oauth=createOAuth({...env,ZHIHU_ACCESS_SECRET:'secret-x'},{request});
  const a=oauth.begin();
  const {user}=await oauth.complete(new URLSearchParams({state:new URL(a.location).searchParams.get('state'),authorization_code:'c'}),{zj_login:cookieValue(a.cookie,'zj_login')});
  assert.equal(user.name,'演示答主');
  assert.equal(user.avatar,'https://pic1.zhimg.com/x.jpg');
  assert.equal(calls[2]['x-oauth-token'],'tok-abc');
  assert.equal(calls[2].authorization,'Bearer secret-x');
});

async function serve(server,fn){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await fn(`http://127.0.0.1:${server.address().port}`);}
  finally{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
}

test('服务端全流程：登录 → 读取身份 → 退出；响应和日志里没有 App Key 与 token',async()=>{
  const logs=[];
  const oauth=createOAuth(env,fakeZhihu());
  await serve(createServer(env,{oauth,log:line=>logs.push(line)}),async base=>{
    assert.deepEqual(await (await fetch(base+'/api/me')).json(),{available:true,user:null});
    const login=await fetch(base+'/auth/login',{redirect:'manual'});
    assert.equal(login.status,302);
    const state=new URL(login.headers.get('location')).searchParams.get('state');
    const nonce=cookieValue(login.headers.getSetCookie(),'zj_login');

    const callback=await fetch(`${base}/auth/callback?authorization_code=c-1&state=${state}`,{redirect:'manual',headers:{cookie:`zj_login=${nonce}`}});
    assert.equal(callback.status,302);
    assert.equal(callback.headers.get('location'),'/?login=ok');
    const sid=cookieValue(callback.headers.getSetCookie(),'zj_sid');
    const me=await (await fetch(base+'/api/me',{headers:{cookie:`zj_sid=${sid}`}})).json();
    assert.deepEqual(me,{available:true,user:{name:'测试用户',headline:'一句话',avatar:'https://picx.zhimg.com/a.jpg'}});

    const replay=await fetch(`${base}/auth/callback?authorization_code=c-1&state=${state}`,{redirect:'manual',headers:{cookie:`zj_login=${nonce}`}});
    assert.equal(replay.headers.get('location'),'/?login=failed');

    const logout=await fetch(base+'/auth/logout',{method:'POST',headers:{cookie:`zj_sid=${sid}`}});
    assert.match(logout.headers.getSetCookie()[0],/zj_sid=;.*Max-Age=0/);
    assert.equal((await (await fetch(base+'/api/me',{headers:{cookie:`zj_sid=${sid}`}})).json()).user,null);

    const everything=JSON.stringify(me)+logs.join('')+login.headers.get('location');
    assert.ok(!everything.includes('key-secret-xyz'));
    assert.ok(!everything.includes('tok-abc'));
    assert.ok(!logs.join('').includes('969570047710216200123'));
  });
});

test('未配置凭据：登录关闭，页面拿到 available=false',async()=>{
  await serve(createServer({}),async base=>{
    assert.equal((await fetch(base+'/auth/login',{redirect:'manual'})).status,503);
    assert.deepEqual(await (await fetch(base+'/api/me')).json(),{available:false,user:null});
  });
});
