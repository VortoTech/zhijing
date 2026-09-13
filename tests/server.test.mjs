import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../src/server.mjs';

let server;
let base;

test.before(async () => {
  server = createServer({});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
});

function post(path, body, headers = {}) {
  return fetch(base + path, {
    method: 'POST',
    headers: {'content-type': 'application/json', ...headers},
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

function map(body) {
  return post('/api/reading-map', body).then(async res => ({status: res.status, data: await res.json()}));
}

test('健康检查', async () => {
  const res = await fetch(base + '/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {status: 'ok'});
});

test('配置接口在无凭据时如实报告 liveReady=false', async () => {
  const res = await fetch(base + '/api/config');
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.liveReady, false);
  assert.equal(data.zhihuReady, false);
  assert.equal(data.modelReady, false);
  assert.ok(data.topics.length >= 3);
  assert.equal(data.orders.length, 3);
  assert.ok(data.topics.some(t => t.id === 'first-job'));
});

test('精选样本返回完整阅读地图', async () => {
  const {status, data} = await map({topicId: 'first-job', order: 'as-is', mode: 'snapshot'});
  assert.equal(status, 200);
  assert.equal(data.records.length, 60);
  assert.ok(data.diagnostics);
  assert.equal(data.diagnostics.stateCounts.disputed, 3);
  assert.equal(data.diagnostics.stateCounts.conditional, 2);
  assert.equal(data.diagnostics.substantiveObjections, 6);
  assert.ok(data.summary.length > 0);
  assert.ok(data.trustStates.no_signal);
});

test('精选样本里每条异议都指向真实原文，且带逐字评论', async () => {
  const {data} = await map({topicId: 'first-job'});
  const flagged = data.records.filter(r => r.trust.id !== 'no_signal');
  assert.equal(flagged.length, 5);
  for (const record of flagged) {
    assert.ok(record.objections.length > 0);
    for (const objection of record.objections) {
      // 评论原文必须逐字出现在该记录的评论列表里
      assert.ok(record.comments.includes(objection.commentText), objection.commentText);
      if (objection.targetClaim) {
        assert.ok(record.text.includes(objection.targetClaim), objection.targetClaim);
      }
    }
  }
});

test('默认排序按赞数降序', async () => {
  const {data} = await map({topicId: 'first-job'});
  const votes = data.records.map(r => r.voteUp);
  assert.deepEqual(votes, [...votes].sort((a, b) => b - a));
});

test('「先看有争议的」把带标记的记录提到最前', async () => {
  const {data} = await map({topicId: 'first-job', order: 'attention'});
  const head = data.records.slice(0, 5);
  assert.ok(head.every(r => r.trust.id !== 'no_signal'));
});

test('相关条件排序回传原话，不宣称适用性匹配', async () => {
  const {data} = await map({topicId: 'first-job', order: 'situation', situation: {stage: '应届生'}});
  assert.equal(data.situation.stage, '应届生');
  const fitted = data.records.filter(r => r.fit);
  assert.ok(fitted.length >= 1, '应该至少有一条命中处境');
  assert.ok(fitted.every(r => r.fit.level === 'reference'));
  assert.ok(fitted.every(r => r.fit.note.includes('不判断适用性')));

  // 排序不变量：匹配 → 未提及 → 不匹配，组内回落到赞数降序
  const rank = {reference: 0, unknown: 1};
  const ranks = data.records.map(r => rank[r.fit?.level || 'unknown']);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), '处境排序必须单调不减');
});

test('信息型话题被明确拒绝，而不是硬跑出空结果', async () => {
  const {status, data} = await map({topicId: 'luohu-tax'});
  assert.equal(status, 422);
  assert.match(data.error, /只适用于观点/);
});

test('未知话题返回 404', async () => {
  const {status} = await map({topicId: 'nope'});
  assert.equal(status, 404);
});

test('非法排序返回 400', async () => {
  const {status, data} = await map({topicId: 'first-job', order: 'best'});
  assert.equal(status, 400);
  assert.match(data.error, /排序方式不合法/);
});

test('非法模式返回 400', async () => {
  const {status} = await map({topicId: 'first-job', mode: 'turbo'});
  assert.equal(status, 400);
});

test('处境字段过多或过长被拒', async () => {
  const tooMany = Object.fromEntries(Array.from({length: 9}, (_, i) => [`f${i}`, 'v']));
  assert.equal((await map({topicId: 'first-job', situation: tooMany})).status, 400);
  assert.equal((await map({topicId: 'first-job', situation: {stage: 'x'.repeat(50)}})).status, 400);
});

test('非 JSON 请求体返回 415', async () => {
  const res = await post('/api/reading-map', 'topicId=first-job', {'content-type': 'text/plain'});
  assert.equal(res.status, 415);
});

test('畸形 JSON 返回 400', async () => {
  const res = await post('/api/reading-map', '{not json');
  assert.equal(res.status, 400);
});

test('超大请求体返回 400', async () => {
  const res = await post('/api/reading-map', JSON.stringify({topicId: 'first-job', pad: 'x'.repeat(9000)}));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /过大/);
});

test('跨站来源被拒', async () => {
  const res = await post('/api/reading-map', {topicId: 'first-job'}, {origin: 'https://evil.example'});
  assert.equal(res.status, 403);
});

test('同源来源放行', async () => {
  const res = await post('/api/reading-map', {topicId: 'first-job'}, {origin: base});
  assert.equal(res.status, 200);
});

test('未知路径返回 404', async () => {
  const res = await fetch(base + '/nope');
  assert.equal(res.status, 404);
});

test('静态页与资源可访问，且带安全响应头', async () => {
  for (const [path, type] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/style.css', 'text/css']]) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-type'), new RegExp(type));
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  }
});

test('页面不依赖任何外部资源', async () => {
  const html = await (await fetch(base + '/')).text();
  assert.ok(!/https?:\/\/(?!127\.0\.0\.1|localhost)/.test(html), '页面里不应出现外部链接');
  assert.ok(!/<script(?![^>]*src=)/.test(html), '不应有内联脚本（CSP 会拦）');
  assert.ok(!/\son\w+=/.test(html), '不应有内联事件处理器');
});
