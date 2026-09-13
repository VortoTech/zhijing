import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyClassification,
  looksLikeEmptyPraise,
  isSubstantive,
  hashSource,
  OBJECTION_TYPES,
  FRAMING_TYPES
} from '../src/pipeline/verify.mjs';

const TEXT = '第一份工作应该优先看平台，平台能给你更多的成长机会。别只看当下到手多少钱。';
const COMMENT_REAL = '你这话不对，我认识的人在小公司学到的东西比大厂多得多，别一概而论。';

function source(overrides = {}) {
  return {
    id: 'r1',
    title: '标题',
    author: '作者',
    badge: null,
    authority: null,
    voteUp: 10,
    commentCount: 1,
    url: 'https://www.zhihu.com/question/1/answer/2',
    text: TEXT,
    comments: [COMMENT_REAL],
    ...overrides
  };
}

const out = (objections, claim = '第一份工作应该优先看平台') => ({
  records: [{id: 'r1', claim, objections}]
});

test('原文子串校验：claim 对不上原文时清空摘句，但保留来源', () => {
  const [record]=verifyClassification(out([], '这句话原文里没有'), [source()]);
  assert.equal(record.claim,null);
  assert.equal(record.text,TEXT);
});

test('原文子串校验：claim 对不上原文但有异议时保留记录，claim 置空', () => {
  const [record] = verifyClassification(
    out([{commentIndex: 0, type: 'counter_example', targetClaim: '平台能给你更多的成长机会', isSubstantive: true}], '这句话原文里没有'),
    [source()]
  );
  assert.equal(record.claim, null);
  assert.equal(record.objections.length, 1);
});

test('原文子串校验：claim 是原文子串时保留', () => {
  const [record] = verifyClassification(out([]), [source()]);
  assert.equal(record.claim, '第一份工作应该优先看平台');
});

test('凭空生成的异议被拒——评论下标必须真实存在', () => {
  const [record] = verifyClassification(
    out([{commentIndex: 9, type: 'off_topic', targetClaim: '平台能给你更多的成长机会', isSubstantive: true}]),
    [source()]
  );
  assert.equal(record.objections.length, 0);
});

test('targetClaim 对不上原文时整条异议被丢弃', () => {
  const record = verifyClassification(
    out([{commentIndex: 0, type: 'off_topic', targetClaim: '原文里根本没有这句', isSubstantive: true}]),
    [source()]
  ).at(0);
  // claim 通过、异议被丢，记录仍然保留（因为 claim 合法）
  assert.equal(record.claim, '第一份工作应该优先看平台');
  assert.deepEqual(record.objections, []);
});

test('非 framing 类异议缺 targetClaim 时被丢弃', () => {
  const record = verifyClassification(
    out([{commentIndex: 0, type: 'off_topic', targetClaim: '', isSubstantive: true}]),
    [source()]
  ).at(0);
  assert.equal(record.objections.length, 0);
});

test('adds_condition 允许没有 targetClaim', () => {
  const record = verifyClassification(
    out([{commentIndex: 0, type: 'adds_condition', targetClaim: '', isSubstantive: true}]),
    [source()]
  ).at(0);
  assert.equal(record.objections.length, 1);
  assert.equal(record.objections[0].typeLabel, '补充适用条件');
  assert.equal(record.objections[0].pointsToClaim, false);
});

test('challenges_framing 允许没有 targetClaim', () => {
  const record = verifyClassification(
    out([{commentIndex: 0, type: 'challenges_framing', targetClaim: '', isSubstantive: true}]),
    [source()]
  ).at(0);
  assert.equal(record.objections[0].typeLabel, '质疑问题前提');
});

test('模型说不是实质异议就丢弃', () => {
  const record = verifyClassification(
    out([{commentIndex: 0, type: 'off_topic', targetClaim: '平台能给你更多的成长机会', isSubstantive: false}]),
    [source()]
  ).at(0);
  assert.equal(record.objections.length, 0);
});

test('模型说是实质异议、但内容只是附和，仍然被拦下', () => {
  const record = verifyClassification(
    out([{commentIndex: 0, type: 'off_topic', targetClaim: '平台能给你更多的成长机会', isSubstantive: true}]),
    [source({comments: ['说得好']})]
  ).at(0);
  assert.equal(record.objections.length, 0);
});

test('未知 type 被丢弃', () => {
  const record = verifyClassification(
    out([{commentIndex: 0, type: 'made_up', targetClaim: '平台能给你更多的成长机会', isSubstantive: true}]),
    [source()]
  ).at(0);
  assert.equal(record.objections.length, 0);
});

test('异议的评论原文逐字保留，不做改写', () => {
  const record = verifyClassification(
    out([{commentIndex: 0, type: 'counter_example', targetClaim: '平台能给你更多的成长机会', isSubstantive: true}]),
    [source()]
  ).at(0);
  assert.equal(record.objections[0].commentText, COMMENT_REAL);
});

test('空话与太短的评论被判为非实质', () => {
  for (const text of ['说得好', '学到了', '谢谢分享', '有道理', '顶', '有的前后矛盾了']) {
    assert.equal(looksLikeEmptyPraise(text), true, text);
    assert.equal(isSubstantive(text, true), false, text);
  }
  assert.equal(looksLikeEmptyPraise(COMMENT_REAL), false);
  assert.equal(isSubstantive(COMMENT_REAL, true), true);
});

test('模型标记为 false 时，即使内容有实质也判 false', () => {
  assert.equal(isSubstantive(COMMENT_REAL, false), false);
});

test('记录 id 不在来源里时被丢弃', () => {
  const records=verifyClassification({records: [{id: 'ghost', claim: '第一份工作应该优先看平台', objections: []}]}, [source()]);
  assert.equal(records.length,1);
  assert.equal(records[0].id,'r1');
  assert.equal(records[0].analysis.reason,'model_omitted');
});

test('重复 id 只保留第一次', () => {
  const records = verifyClassification({
    records: [
      {id: 'r1', claim: '第一份工作应该优先看平台', objections: []},
      {id: 'r1', claim: '平台能给你更多的成长机会', objections: []}
    ]
  }, [source()]);
  assert.equal(records.length, 1);
});

test('sourceHash 随原文与评论变化', () => {
  const a = hashSource(source());
  assert.equal(a, hashSource(source()));
  assert.notEqual(a, hashSource(source({comments: ['换了一条完全不同的评论内容在这里']})));
  assert.notEqual(a, hashSource(source({text: TEXT + '多一句'})));
});

test('framing 类集合与类型表一致', () => {
  assert.ok(FRAMING_TYPES.has('adds_condition'));
  assert.ok(FRAMING_TYPES.has('challenges_framing'));
  assert.ok(!FRAMING_TYPES.has('off_topic'));
  assert.equal(Object.keys(OBJECTION_TYPES).length, 6);
});
