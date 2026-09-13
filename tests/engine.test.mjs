import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveTrustState,
  deriveBoundary,
  situationFit,
  buildReadingMap,
  TRUST_STATES,
  ORDERS,
  FLAG_RATIO_THRESHOLD
} from '../src/engine.mjs';

const TOPIC = {
  id: 't',
  title: '演示话题',
  kind: 'opinion',
  conditions: [{id: 'cash', label: '现金流'}],
  situationFields: [
    {id: 'stage', label: '你的阶段', options: ['应届生', '社招 1-3 年']}
  ]
};

function objection(overrides = {}) {
  return {
    commentIndex: 0,
    commentText: '我这是社招，不是应届生，情况不一样。',
    type: 'adds_condition',
    typeLabel: '补充适用条件',
    targetClaim: null,
    pointsToClaim: false,
    ...overrides
  };
}

function record(overrides = {}) {
  return {
    id: 'r',
    title: '标题',
    author: '作者',
    badge: null,
    authority: null,
    voteUp: 10,
    commentCount: 1,
    url: 'https://www.zhihu.com/question/1/answer/2',
    claim: '应该优先看平台',
    text: '应该优先看平台。',
    comments: ['我这是社招，不是应届生，情况不一样。'],
    objections: [],
    sourceHash: 'abc',
    ...overrides
  };
}

test('三态判定：只有补充前提时是「有前提条件」', () => {
  assert.equal(deriveTrustState([objection()]).id, 'conditional');
});

test('三态判定：任意一条非前提类异议就是「有读者提出异议」', () => {
  assert.equal(deriveTrustState([objection({type: 'off_topic'})]).id, 'disputed');
  assert.equal(deriveTrustState([objection({type: 'challenges_framing'}), objection()]).id, 'disputed');
});

test('三态判定：没有异议时是「未见实质异议」', () => {
  assert.equal(deriveTrustState([]).id, 'no_signal');
});

test('「未见实质异议」的说明明确否认「已验证」语义', () => {
  const note = TRUST_STATES.no_signal.note;
  assert.match(note, /不等于/);
  assert.match(note, /验证过/);
});

test('边界卡片只收 adds_condition', () => {
  const boundary = deriveBoundary([
    objection({type: 'off_topic', commentText: '你答非所问'}),
    objection({type: 'adds_condition', commentText: '我是社招'})
  ]);
  assert.equal(boundary.length, 1);
  assert.equal(boundary[0].text, '我是社招');
});

test('默认排序与知乎一致：按赞数降序', () => {
  const map = buildReadingMap([
    record({id: 'a', voteUp: 5}),
    record({id: 'b', voteUp: 50}),
    record({id: 'c', voteUp: 20})
  ], {topic: TOPIC});
  assert.deepEqual(map.records.map(r => r.id), ['b', 'c', 'a']);
});

test('「先看有争议的」把带标记的排前面，组内回落到赞数序', () => {
  const map = buildReadingMap([
    record({id: 'quiet', voteUp: 900}),
    record({id: 'loud', voteUp: 3, objections: [objection({type: 'off_topic'})]}),
    record({id: 'mild', voteUp: 7, objections: [objection()]})
  ], {topic: TOPIC, order: 'attention'});
  assert.deepEqual(map.records.map(r => r.id), ['mild', 'loud', 'quiet']);
});

test('排序方式不合法时抛错', () => {
  assert.throws(() => buildReadingMap([record()], {topic: TOPIC, order: 'best'}), /排序方式不合法/);
});

test('否定句只展示完整原话，不产生适用性匹配结论', () => {
  const fit=situationFit(record({objections:[objection()]}),{stage:'应届生'},TOPIC);
  assert.equal(fit.level,'reference');
  assert.equal(fit.evidence[0].text,'我这是社招，不是应届生，情况不一样。');
  assert.match(fit.note,/不判断适用性/);
  assert.ok(!JSON.stringify(fit).includes('与你的处境一致'));
});

test('作者认证和非条件评论不能被推广成建议适用性', () => {
  assert.equal(situationFit(record({badge:'应届生',comments:['对应届生来说，先看平台。']}),{stage:'应届生'},TOPIC),null);
  assert.equal(situationFit(record({objections:[objection({type:'off_topic'})]}),{stage:'应届生'},TOPIC),null);
});

test('没有选处境时不产出匹配结果', () => {
  assert.equal(situationFit(record(), null, TOPIC), null);
  assert.equal(situationFit(record(), {}, TOPIC), null);
});

test('相关条件排序优先显示原话，不把反对或否定条件压到后面', () => {
  const map = buildReadingMap([
    record({id:'silent',voteUp:900}),
    record({id:'condition',objections:[objection()]})
  ], {topic: TOPIC, order: 'situation', situation: {stage: '应届生'}});
  assert.deepEqual(map.records.map(r=>r.id),['condition','silent']);
  assert.equal(map.situationCoverage[0].count,1);
});

test('诊断：整张列表达标时判定 viable', () => {
  const records = [
    ...Array.from({length: 4}, (_, i) => record({id: `d${i}`, objections: [objection({type: 'off_topic'})]})),
    ...Array.from({length: 6}, (_, i) => record({id: `n${i}`}))
  ];
  const d = buildReadingMap(records, {topic: TOPIC}).diagnostics;
  assert.equal(d.verdict, 'viable');
  assert.equal(d.viable, true);
  assert.equal(d.flagged, 4);
});

test('诊断：整张列表不达标但有评论那层达标时判定 scoped', () => {
  // 40 条：4 条带标记且有评论，6 条有评论无标记，30 条无评论
  // 整张 4/40 = 10%（不达标）；有评论那层 4/10 = 40%（达标）
  const records = [
    ...Array.from({length: 4}, (_, i) => record({id: `d${i}`, objections: [objection({type: 'off_topic'})]})),
    ...Array.from({length: 6}, (_, i) => record({id: `c${i}`})),
    ...Array.from({length: 30}, (_, i) => record({id: `z${i}`, comments: []}))
  ];
  const d = buildReadingMap(records, {topic: TOPIC}).diagnostics;
  assert.equal(d.surfaces.whole.viable, false);
  assert.equal(d.surfaces.withComments.viable, true);
  assert.equal(d.verdict, 'scoped');
  assert.match(d.reason, /收窄/);
});

test('诊断：刚好压在门槛线附近时判定 marginal，并声明门槛是人为约定', () => {
  // 34 条有评论，其中 5 条带标记 → 14.7%，低于 15% 但落在 5 个百分点内
  const records = [
    ...Array.from({length: 5}, (_, i) => record({id: `d${i}`, objections: [objection({type: 'off_topic'})]})),
    ...Array.from({length: 29}, (_, i) => record({id: `c${i}`})),
    ...Array.from({length: 26}, (_, i) => record({id: `z${i}`, comments: []}))
  ];
  const d = buildReadingMap(records, {topic: TOPIC}).diagnostics;
  assert.equal(d.verdict, 'marginal');
  assert.match(d.reason, /人为约定/);
  assert.match(d.reason, /不是定律/);
});

test('诊断：两个面都远低于门槛时判定 too_sparse', () => {
  const records = [
    ...Array.from({length: 2}, (_, i) => record({id: `d${i}`, objections: [objection({type: 'off_topic'})]})),
    ...Array.from({length: 60}, (_, i) => record({id: `c${i}`}))
  ];
  const d = buildReadingMap(records, {topic: TOPIC}).diagnostics;
  assert.equal(d.verdict, 'too_sparse');
  assert.match(d.reason, /撑不起三态标记/);
});

test('诊断：异议不足 3 条时即使比例很高也不算达标', () => {
  const records = [
    record({id: 'a', objections: [objection({type: 'off_topic'})]}),
    record({id: 'b'})
  ];
  const d = buildReadingMap(records, {topic: TOPIC}).diagnostics;
  assert.equal(d.surfaces.whole.ratio, 0.5);
  assert.equal(d.surfaces.whole.viable, false);
});

test('诊断：depth 扫描给出能撑住的最大深度', () => {
  const records = [
    ...Array.from({length: 4}, (_, i) => record({id: `d${i}`, voteUp: 100 - i, objections: [objection({type: 'off_topic'})]})),
    ...Array.from({length: 40}, (_, i) => record({id: `n${i}`, voteUp: 50 - i}))
  ];
  const d = buildReadingMap(records, {topic: TOPIC}).diagnostics;
  assert.ok(d.deepestWorkable, '应该有能撑住的深度');
  assert.ok(d.deepestWorkable.n >= 10);
  assert.ok(d.scan.length >= 2);
  assert.match(d.reason, /不能推定产品/);
});

test('诊断：门槛常量对外暴露，便于前端画参考线', () => {
  const d = buildReadingMap([record()], {topic: TOPIC}).diagnostics;
  assert.equal(d.threshold, FLAG_RATIO_THRESHOLD);
});

test('摘要：有人提出异议时点出条数，并说明排序未干预', () => {
  const map = buildReadingMap([
    record({id: 'a', objections: [objection({type: 'off_topic'})]}),
    record({id: 'b'})
  ], {topic: TOPIC});
  assert.match(map.summary, /1 条被读者当场提出异议/);
  assert.match(map.summary, /按本次赞数排序/);
});

test('摘要：没有异议时明说没取到，而不是说「全部可信」', () => {
  const map = buildReadingMap([record(), record({id: 'b'})], {topic: TOPIC});
  assert.match(map.summary, /没有取到实质异议/);
});

test('回传话题元信息与排序说明', () => {
  const map = buildReadingMap([record()], {topic: TOPIC, order: 'attention'});
  assert.equal(map.topic.id, 't');
  assert.equal(map.order.id, 'attention');
  assert.equal(map.order.note, ORDERS.attention.note);
});

test('三态常量覆盖三种状态且 tone 各不相同', () => {
  const states = Object.values(TRUST_STATES);
  assert.equal(states.length, 3);
  assert.equal(new Set(states.map(s => s.tone)).size, 3);
});
