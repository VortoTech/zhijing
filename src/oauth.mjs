import {randomBytes} from 'node:crypto';
import {createMemoryStore} from './store.mjs';

// 知乎登录（黑客松 OAuth）。协议见知乎 skill 包 references/hackathon-oauth.md 与 oauth.md：
// 授权 → 回调带 authorization_code 与 state → 后端用 app_id/app_key 换 access_token → GET /user 读基础信息。
// 安全：state 一次性、绑定浏览器、10 分钟过期；App Key 只在服务端；access_token 只存服务端内存、最多 1 小时，
// 用来读该用户授权的收藏，从不发给浏览器，也不入库；
// 浏览器只持有随机会话号（HttpOnly Cookie），会话本身（昵称、头像、用户编号）存在 store 里，服务重启后仍然登录。
const AUTHORIZE_URL='https://openapi.zhihu.com/authorize';
const TOKEN_URL='https://openapi.zhihu.com/access_token';
const USER_URL='https://openapi.zhihu.com/user';
const STATE_TTL_MS=10*60*1000;
const SESSION_TTL_MS=7*24*3600*1000;
const TOKEN_TTL_MAX_MS=3600*1000;
const MAX_PENDING=5000;

export function oauthConfig(env=process.env){
  const appId=env.ZHIHU_OAUTH_APP_ID,appKey=env.ZHIHU_OAUTH_APP_KEY,redirectUri=env.ZHIHU_OAUTH_REDIRECT_URI;
  if(!appId||!appKey||!redirectUri)return null;
  let url;
  try{url=new URL(redirectUri);}catch{return null;}
  return {appId,appKey,redirectUri,callbackPath:url.pathname,secure:url.protocol==='https:'};
}

export function parseCookies(header=''){
  const out={};
  for(const part of String(header).split(';')){
    const at=part.indexOf('=');
    if(at<0)continue;
    const key=part.slice(0,at).trim();
    if(!key)continue;
    try{out[key]=decodeURIComponent(part.slice(at+1).trim());}catch{}
  }
  return out;
}

function safeAvatar(value){
  try{
    const url=new URL(value);
    return url.protocol==='https:'&&(url.hostname==='zhimg.com'||url.hostname.endsWith('.zhimg.com'))?url.href:'';
  }catch{return '';}
}

// uid 可能超出 JS 安全整数：解析前把数字 uid 改写成字符串，无损保留。
// /user 没有正式响应 schema：文档写 fullname/avatar_path，官方 zhihu-hackathon skill 示例读 name/avatar_url，两种都认。
export function parseUser(text){
  let body;
  try{body=JSON.parse(String(text).replace(/("uid"\s*:\s*)(-?\d+)/,'$1"$2"'));}catch{return null;}
  const source=[body?.data,body?.Data,body?.user].find(v=>v&&typeof v==='object')||body;
  const pick=(...keys)=>keys.map(key=>source?.[key]).find(v=>typeof v==='string'&&v.trim());
  const uid=source?.uid!=null?String(source.uid):'';
  const hashId=pick('hash_id','HashId')||'';
  const name=pick('fullname','name','Fullname','Name');
  if(!uid&&!hashId&&!name)return null;
  return {
    uid,hashId,
    name:name?name.trim().slice(0,40):'知乎用户',
    headline:(pick('headline','Headline')||'').slice(0,80),
    avatar:safeAvatar(pick('avatar_path','avatar_url','AvatarUrl'))
  };
}

const randomToken=()=>randomBytes(24).toString('base64url');
const fail=(reason,message)=>Object.assign(new Error(message),{reason});

export function createOAuth(env=process.env,{request=fetch,now=Date.now,store=createMemoryStore()}={}){
  const config=oauthConfig(env);
  const pending=new Map();   // state → {nonce, expires}
  const tokens=new Map();    // 会话号 → {token, expires}：只在内存

  function sweep(){
    const t=now();
    for(const [key,value] of pending)if(value.expires<t)pending.delete(key);
    for(const [key,value] of tokens)if(value.expires<t)tokens.delete(key);
  }
  // 文档写 /user 只带 OAuth token；官方 zhihu-hackathon skill 的示例带 Access Secret + X-OAuth-Token。两种都试，
  // 都失败也不阻断登录（官方说明：资料读取失败不得伪造字段，也不阻断其他用户接口）。
  async function readProfile(accessToken){
    const attempts=[{authorization:`Bearer ${accessToken}`}];
    if(env.ZHIHU_ACCESS_SECRET)attempts.push({
      authorization:`Bearer ${env.ZHIHU_ACCESS_SECRET}`,'x-oauth-token':accessToken,
      'x-request-timestamp':String(Math.floor(Date.now()/1000))
    });
    for(const headers of attempts){
      try{
        const response=await request(USER_URL,{headers,redirect:'error',signal:AbortSignal.timeout(10000)});
        const user=response.ok?parseUser(await response.text()):null;
        if(user)return user;
      }catch{}
    }
    return null;
  }
  function cookie(name,value,maxAgeSeconds){
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`+(config?.secure?'; Secure':'');
  }

  return {
    available:!!config,
    callbackPath:config?.callbackPath||null,
    clearLoginCookie:()=>cookie('zj_login','',0),

    // 发起授权：生成一次性 state，并用 zj_login Cookie 把它绑定到当前浏览器。
    begin(){
      sweep();
      if(pending.size>=MAX_PENDING)pending.delete(pending.keys().next().value);
      const state=randomToken(),nonce=randomToken();
      pending.set(state,{nonce,expires:now()+STATE_TTL_MS});
      const url=new URL(AUTHORIZE_URL);
      url.search=new URLSearchParams({redirect_uri:config.redirectUri,app_id:config.appId,response_type:'code',state}).toString();
      return {location:url.href,cookie:cookie('zj_login',nonce,STATE_TTL_MS/1000)};
    },

    // 回调：先原子消费 state 再校验，重复回调、其他浏览器、过期一律拒绝；之后才换 token。
    async complete(query,cookies){
      const state=query.get('state');
      let key=state;
      // 官方 skill 记录的已知缺口：回调可能不回传 state。此时用本浏览器发起登录时留下的一次性 zj_login 找回那次请求，
      // 仍然只接受本浏览器 10 分钟内发起、尚未使用过的登录。
      if(!state&&cookies.zj_login){
        for(const [pendingState,value] of pending)if(value.nonce===cookies.zj_login){key=pendingState;break;}
      }
      const entry=key?pending.get(key):null;
      if(entry)pending.delete(key);
      if(!entry||entry.expires<now()||!cookies.zj_login||cookies.zj_login!==entry.nonce)throw fail('state','登录请求无效或已过期');
      const code=query.get('authorization_code')||query.get('code');
      if(!code)throw fail('code','没有拿到授权');

      const tokenResponse=await request(TOKEN_URL,{
        method:'POST',
        headers:{'content-type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({app_id:config.appId,app_key:config.appKey,grant_type:'authorization_code',redirect_uri:config.redirectUri,code}).toString(),
        redirect:'error',signal:AbortSignal.timeout(10000)
      });
      const tokenBody=await tokenResponse.json().catch(()=>null);
      const accessToken=[tokenBody?.access_token,tokenBody?.data?.access_token].find(v=>typeof v==='string'&&v);
      if(!tokenResponse.ok||!accessToken)throw fail('token','换取授权失败');

      const user=await readProfile(accessToken)||{uid:'',hashId:'',name:'知乎用户',headline:'',avatar:'',profileMissing:true};

      const expiresIn=Number(tokenBody?.expires_in??tokenBody?.data?.expires_in)*1000;
      const tokenTtl=Math.min(expiresIn>0?expiresIn:TOKEN_TTL_MAX_MS,TOKEN_TTL_MAX_MS);
      sweep();
      // 读不到资料（没有 uid / hash_id）的用户不建用户记录：能登录、能体检，但不能「记住我的情况」。
      const userId=await store.upsertUser(user);
      const sid=randomToken();
      await store.createSession(sid,{userId,user,expiresAt:now()+SESSION_TTL_MS});
      tokens.set(sid,{token:accessToken,expires:now()+tokenTtl});
      return {user:{...user,userId},stateReturned:!!state,cookies:[cookie('zj_sid',sid,SESSION_TTL_MS/1000),cookie('zj_login','',0)]};
    },

    async current(cookies){
      const session=cookies.zj_sid?await store.getSession(cookies.zj_sid,now()):null;
      return session?{...session.user,userId:session.userId}:null;
    },

    // 只在服务端使用；过期或被知乎拒绝后清空，不自动续期，也不回退到 Access Secret 本人身份。
    accessToken(cookies){
      const entry=cookies.zj_sid?tokens.get(cookies.zj_sid):null;
      if(!entry||entry.expires<now())return null;
      return entry.token;
    },

    dropToken(cookies){
      if(cookies.zj_sid)tokens.delete(cookies.zj_sid);
    },

    async end(cookies){
      if(cookies.zj_sid){tokens.delete(cookies.zj_sid);await store.deleteSession(cookies.zj_sid).catch(()=>{});}
      return cookie('zj_sid','',0);
    },

    stats(){return {sessions:tokens.size};}
  };
}
