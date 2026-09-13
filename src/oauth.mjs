import {randomBytes} from 'node:crypto';

// 知乎登录（黑客松 OAuth）。协议见知乎 skill 包 references/hackathon-oauth.md 与 oauth.md：
// 授权 → 回调带 authorization_code 与 state → 后端用 app_id/app_key 换 access_token → GET /user 读基础信息。
// 安全：state 一次性、绑定浏览器、10 分钟过期；App Key 只在服务端；access_token 只存服务端内存、最多 1 小时，
// 用来读该用户授权的收藏，从不发给浏览器；
// 浏览器只持有随机会话号（HttpOnly Cookie）。
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
export function parseUser(text){
  let body;
  try{body=JSON.parse(String(text).replace(/("uid"\s*:\s*)(-?\d+)/,'$1"$2"'));}catch{return null;}
  const user=body?.data&&typeof body.data==='object'?body.data:body;
  const uid=user?.uid!=null?String(user.uid):'';
  const hashId=typeof user?.hash_id==='string'?user.hash_id:'';
  if(!uid&&!hashId)return null;
  return {
    uid,hashId,
    name:typeof user.fullname==='string'&&user.fullname.trim()?user.fullname.trim().slice(0,40):'知乎用户',
    headline:typeof user.headline==='string'?user.headline.slice(0,80):'',
    avatar:safeAvatar(user.avatar_path)
  };
}

const randomToken=()=>randomBytes(24).toString('base64url');
const fail=(reason,message)=>Object.assign(new Error(message),{reason});

export function createOAuth(env=process.env,{request=fetch,now=Date.now}={}){
  const config=oauthConfig(env);
  const pending=new Map();   // state → {nonce, expires}
  const sessions=new Map();  // 会话号 → {user, expires}

  function sweep(){
    const t=now();
    for(const [key,value] of pending)if(value.expires<t)pending.delete(key);
    for(const [key,value] of sessions)if(value.expires<t)sessions.delete(key);
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
      const entry=state?pending.get(state):null;
      if(entry)pending.delete(state);
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

      const userResponse=await request(USER_URL,{
        headers:{authorization:`Bearer ${accessToken}`},
        redirect:'error',signal:AbortSignal.timeout(10000)
      });
      const user=userResponse.ok?parseUser(await userResponse.text()):null;
      if(!user)throw fail('user','读取知乎用户信息失败');

      const expiresIn=Number(tokenBody?.expires_in??tokenBody?.data?.expires_in)*1000;
      const tokenTtl=Math.min(expiresIn>0?expiresIn:TOKEN_TTL_MAX_MS,TOKEN_TTL_MAX_MS);
      sweep();
      const sid=randomToken();
      sessions.set(sid,{user,token:accessToken,tokenExpires:now()+tokenTtl,expires:now()+SESSION_TTL_MS});
      return {user,cookies:[cookie('zj_sid',sid,SESSION_TTL_MS/1000),cookie('zj_login','',0)]};
    },

    current(cookies){
      const session=cookies.zj_sid?sessions.get(cookies.zj_sid):null;
      if(!session)return null;
      if(session.expires<now()){sessions.delete(cookies.zj_sid);return null;}
      return session.user;
    },

    // 只在服务端使用；过期或被知乎拒绝后清空，不自动续期，也不回退到 Access Secret 本人身份。
    accessToken(cookies){
      const session=cookies.zj_sid?sessions.get(cookies.zj_sid):null;
      if(!session||session.expires<now()||!session.token||session.tokenExpires<now())return null;
      return session.token;
    },

    dropToken(cookies){
      const session=cookies.zj_sid?sessions.get(cookies.zj_sid):null;
      if(session)session.token=null;
    },

    end(cookies){
      if(cookies.zj_sid)sessions.delete(cookies.zj_sid);
      return cookie('zj_sid','',0);
    },

    stats(){return {sessions:sessions.size};}
  };
}
