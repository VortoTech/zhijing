import assert from 'node:assert/strict';
import {createServer} from '../src/server.mjs';
import {pushbackFor} from '../src/engine.mjs';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
const {chromium}=await import(process.env.ZHIJING_PLAYWRIGHT_MODULE||'playwright');
const output=process.env.ZHIJING_BROWSER_OUTPUT||'output/browser-regressions';
await mkdir(output,{recursive:true});
const server=createServer({}, {log:()=>{}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.ZHIJING_CHROMIUM_PATH?{executablePath:process.env.ZHIJING_CHROMIUM_PATH}:{})});
const failures=[];
async function page(){const p=await browser.newPage({viewport:{width:1440,height:1000}});p.on('pageerror',e=>failures.push(e.message));return p;}
async function ready(p,hash='zhihu'){await p.goto(base+'/#'+hash);await p.locator('#table-stage .table-quote').first().waitFor({state:'attached'});}
try{
  const p=await page();
  await ready(p);
  assert.match(await p.locator('#ask-note').textContent(),/示例模式/);
  await p.locator('[data-choice="0-0"]').click();
  assert.equal(await p.locator('.fork-source').first().evaluate(n=>n.open),true);
  assert.match(await p.locator('.guide').textContent(),/先核对/);
  await p.locator('#q').fill('毕业后应该先就业还是创业');await p.locator('#ask-btn').click();
  assert.equal(await p.locator('#result-head').textContent(),'');
  assert.equal(await p.locator('#table-stage').textContent(),'');
  assert.equal(await p.locator('#q').inputValue(),'毕业后应该先就业还是创业');
  const topics=['考研还是直接工作','毕业去大城市还是回老家','研究生毕业去国企还是私企'];
  let adviceCalls=0;p.on('request',r=>{if(r.url().endsWith('/api/advice'))adviceCalls++;});
  for(const question of topics){
    await p.locator('#examples').getByRole('button',{name:question,exact:true}).click();
    await p.locator('#table-stage .table-quote').first().waitFor({state:'attached'});
    await p.locator('#go-table').click();
    for(const tone of ['humor','rational']){
      await p.locator(`[data-tone="${tone}"]`).click();
      await p.locator('#table-question').fill('请解释时间成本，并给出原话');await p.locator('.table-send').click();
      assert.match(await p.locator('.table-response').textContent(),/无法生成本次回答/);
      assert.equal(await p.locator('#table-question').inputValue(),'请解释时间成本，并给出原话');
      assert.equal(await p.locator('.tone-seat.thinking').count(),0);
    }
    const data=await (await p.request.post(base+'/api/ask',{data:{question}})).json();
    for(const [index,side] of ['a','b'].entries()){
      await p.locator(`[data-table-quote="${side}"]`).click();
      await p.locator('#post-drawer').waitFor({state:'visible'});
      const e=data.comparison.sides.find(s=>s.option===data.comparison.options[index]).reasons.flatMap(r=>r.evidence)[0];
      const record=data.records.find(r=>r.id===e.recordId);
      assert.ok((await p.locator('#post-drawer .meta').textContent()).includes(record.author));
      await p.keyboard.press('Shift+Tab');
      assert.ok(await p.evaluate(()=>document.getElementById('post-drawer').contains(document.activeElement)));
      await p.keyboard.press('Tab');
      assert.equal(await p.evaluate(()=>document.activeElement.className),'drawer-close');
      await p.keyboard.press('Escape');
      assert.equal(await p.evaluate(()=>document.activeElement.dataset.tableQuote),side);
      assert.equal(await p.locator('main').evaluate(n=>n.inert),false);
      const objection=pushbackFor(record,e)[0];
      if(objection){assert.ok((await p.locator('.table-objection').textContent()).includes(objection.commentText));assert.ok((await p.locator('.table-objection').textContent()).includes(objection.typeLabel));}
      else assert.equal(await p.locator('.table-objection').count(),0);
    }
    await p.locator('#go-zhihu').click();
  }
  assert.equal(adviceCalls,0);
  await p.setViewportSize({width:390,height:844});await p.locator('#go-table').click();
  await p.locator('[data-table-quote="a"]').click();await p.keyboard.press('Escape');
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await p.screenshot({path:join(output,'mobile-after.png'),fullPage:true});
  await p.setViewportSize({width:1440,height:1000});await p.screenshot({path:join(output,'desktop-after.png'),fullPage:true});
  await p.locator('#language-toggle').click();assert.match(await p.locator('.table-response').textContent(),/Example reading mode/);
  console.log('PASS offline: three topics, two tones, source ownership, drawer focus, condition evidence, search state, mobile and English');
  await p.close();

  const online=await page();
  await online.route('**/api/config',async route=>{const response=await route.fetch();await route.fulfill({json:{...await response.json(),adviceReady:true}});});
  let mode='failure',seen,release,arrived;
  await online.route('**/api/advice',async route=>{
    seen=route.request().postDataJSON();
    if(mode==='delayed'){arrived?.();await new Promise(resolve=>release=resolve);}
    await route.fulfill({status:mode==='failure'?503:200,json:mode==='failure'?{error:'测试：上游暂时不可用'}:{understanding:'测试：结合当前原话回答',points:[],counterpoints:[],assumptions:[],gaps:[],advice:null,nextQuestion:null,factProposals:[],selected:[]}});
  });
  await ready(online,'table');
  await online.locator('#table-question').fill('请比较这条原话的前提');await online.locator('.table-send').click();
  await online.getByText('测试：上游暂时不可用',{exact:true}).first().waitFor();
  assert.equal(await online.locator('#table-question').inputValue(),'请比较这条原话的前提');
  assert.equal(seen.message,'请比较这条原话的前提');assert.ok(seen.focus.recordId);assert.ok(seen.focus.text);
  mode='success';await online.locator('.table-send').click();
  await online.locator('.table-response').getByText('测试：结合当前原话回答',{exact:true}).waitFor();
  assert.equal(await online.locator('#table-question').inputValue(),'');
  mode='delayed';const requested=new Promise(resolve=>arrived=resolve);
  await online.locator('#table-question').fill('这次会延迟');await online.locator('.table-send').click();await requested;
  await online.locator('#go-zhihu').click();await online.locator('#examples').getByRole('button',{name:topics[0],exact:true}).click();
  await online.locator('#table-stage .table-quote').first().waitFor({state:'attached'});release();
  await online.waitForResponse('**/api/advice');await online.locator('#go-table').click();
  assert.doesNotMatch(await online.locator('.table-response').textContent(),/测试：结合当前原话回答|这次会延迟/);
  console.log('PASS online mocked: failure preserves question, retry success, structured quote context, late response discarded');
  await online.close();

  const account=await page();let releaseMine,arriveMine;
  const mineRequested=new Promise(resolve=>arriveMine=resolve);
  await account.route('**/api/me',r=>r.fulfill({json:{available:true,user:{name:'测试用户',canRemember:false}}}));
  await account.route('**/api/my/collections',async r=>{arriveMine();await new Promise(resolve=>releaseMine=resolve);await r.fulfill({json:{items:[{title:'私人测试收藏',url:'https://www.zhihu.com/question/1/answer/1'}]}});});
  let failLogout=true;
  await account.route('**/auth/logout',r=>r.fulfill({status:failLogout?503:200,json:{ok:!failLogout}}));
  await ready(account);await mineRequested;
  await account.getByRole('button',{name:'退出',exact:true}).click();await account.getByText('退出失败，请重试。',{exact:true}).waitFor();
  assert.equal(await account.locator('.account-name').textContent(),'测试用户');
  failLogout=false;await account.getByRole('button',{name:'退出',exact:true}).click();await account.getByRole('link',{name:'知乎登录',exact:true}).waitFor();
  releaseMine();await account.waitForResponse('**/api/my/collections');
  assert.equal(await account.locator('#mine').isVisible(),false);assert.doesNotMatch(await account.locator('body').textContent(),/私人测试收藏/);
  console.log('PASS account mocked: failed logout keeps identity; successful logout invalidates pending private results');
  await account.close();

  const check=await page();let checkCalls=[];
  await check.route('**/api/me',r=>r.fulfill({json:{available:true,user:{name:'测试用户',canRemember:false}}}));
  await check.route('**/api/my/collections',r=>r.fulfill({json:{items:[{title:'测试收藏',url:'https://www.zhihu.com/question/1/answer/1'}]}}));
  await check.route('**/api/my/checkup',r=>{const body=r.request().postDataJSON();checkCalls.push(body);return r.fulfill({json:{source:body.source,checked:1,matched:0,pushback:0,items:[],incomplete:body.refresh?0:1}});});
  await ready(check);await check.locator('[data-view-target="mine"]').click();await check.getByRole('button',{name:'体检我的收藏',exact:true}).click();
  await check.getByRole('button',{name:'重试未完成的体检',exact:true}).click();
  await check.getByRole('button',{name:'重试未完成的体检',exact:true}).waitFor({state:'detached'});
  await check.getByRole('button',{name:'体检我发过的内容',exact:true}).click();
  await check.getByRole('button',{name:'重试未完成的体检',exact:true}).waitFor();
  assert.deepEqual(checkCalls.map(b=>[b.source,b.refresh]),[['collections',false],['collections',true],['contents',false]]);
  console.log('PASS checkup mocked: separate collections/author flows and explicit incomplete retry');
  await check.close();
  assert.deepEqual(failures,[]);
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
