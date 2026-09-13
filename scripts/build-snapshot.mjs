// 从真实探针数据构建离线精选样本。
//
// 原则：样本里出现的每一条异议，都必须是探针数据里真实存在的评论原文，
// 并且必须通过 verifyClassification 的原文子串校验。构建脚本自己也会被
// 这道闸门拦——如果人工标注里有一个字对不上原文，脚本直接失败。
//
// 用法：node scripts/build-snapshot.mjs

import {readFile, writeFile} from 'node:fs/promises';
import {dedupe} from '../src/pipeline/extract.mjs';
import {verifyClassification} from '../src/pipeline/verify.mjs';
import {buildReadingMap} from '../src/engine.mjs';
import {loadTopics, findTopic} from '../src/topics.mjs';

const root = new URL('../', import.meta.url);

// ── 人工核对后的异议标注 ────────────────────────────────────────────────
// 键是探针数据里的 ContentID，值是逐条读过评论原文之后确认的标注。
// 刻意只标「针对答案本身提出实质反驳」的评论：附和、感慨、人身攻击、
// 以及太短而无法核对的一律不标（宁可漏判，不可错判）。
const LABELS = {
  // 91 赞 · 新知答主。评论区两条都是硬异议。
  '2839573207696871495': [
    {
      commentIndex: 2,
      type: 'off_topic',
      targetClaim: '公司给你的薪资，就是他们心目中你的价值'
    },
    {
      commentIndex: 1,
      type: 'adds_condition',
      targetClaim: '你肯定应该选认可你更高价值的那一个雇主'
    }
  ],
  // 86 赞长文。评论区直接引用作者前后两段自相矛盾的表述。
  '-353791559537483256': [
    {
      commentIndex: 1,
      type: 'self_contradiction',
      targetClaim: '我自己就是被“先就业再择业”这句话坑过的人'
    }
  ],
  // 36 赞。评论区质疑「要么稳定要么高薪」这个二选一前提本身。
  '7254431549836542815': [
    {
      commentIndex: 0,
      type: 'challenges_framing',
      targetClaim: '不要过于片面追求稳定，或者高薪，而是要综合衡量'
    }
  ],
  // 36 赞。评论区补上「缺钱不缺钱」这个适用前提。
  '-1203039761252154073': [
    {
      commentIndex: 2,
      type: 'adds_condition',
      targetClaim: '应届毕业生第一份工作尽可能选大公司'
    }
  ],
  // 26 赞。五条标注里最弱的一条：补的是就业市场这个外部前提。
  '-1534979569903909258': [
    {
      commentIndex: 1,
      type: 'adds_condition',
      targetClaim: '一般情况下，推荐是优先选择平台'
    }
  ]
};

// 主张提取：机械取首句。因为是从原文里切出来的，天然满足子串校验；
// 质量不如模型抽取，但离线样本不该为了好看而编造主张。
// 没有句读的长句退化成前 120 字，同样仍是原文子串——不因为格式不规整就丢掉整条记录。
function firstClaim(text) {
  const match = text.match(/^[\s\S]{8,120}?[。！？!?]/);
  const candidate = (match ? match[0] : text.slice(0, 120)).trim();
  return candidate.length >= 8 ? candidate : null;
}

const raw = JSON.parse(await readFile(new URL('data/raw/r-job.json', root), 'utf8'));

// 接口不保证按赞数返回。先按赞数降序再截断，样本才代表「用户第一眼看到的那一屏」。
// 否则高赞高讨论的条目会被 60 条上限切掉——这正是第一版样本丢掉那条 86 赞长文的原因。
const ordered = [...raw].sort((a, b) => (b.VoteUpCount ?? 0) - (a.VoteUpCount ?? 0));
const sources = dedupe(ordered, {limit: 60});
const topics = await loadTopics();
const topic = findTopic(topics, 'first-job');

const payload = {
  records: sources.map(source => ({
    id: source.id,
    claim: firstClaim(source.text),
    objections: (LABELS[source.id] || []).map(item => ({
      ...item,
      isSubstantive: true
    }))
  }))
};

// 闸门：任何一条标注只要对不上原文，这里就会抛错。
const records = verifyClassification(payload, sources, {topicId: topic.id});
for (const record of records) {
  if (record.analysis.status !== 'complete' || record.objections.length !== (LABELS[record.id] || []).length) {
    throw new Error(`样本标注未完整通过引用校验：${record.id}`);
  }
}
if (Object.keys(LABELS).some(id => !records.some(record => record.id === id))) {
  throw new Error('部分人工标注没有对应来源，停止写入样本');
}

const meta = {
  topicId: topic.id,
  builtAt: new Date().toISOString(),
  source: 'data/raw/r-job.json',
  sourceNote: '知乎开放平台 zhihu_search 真实返回，2026-09-07 探针，65 条原始结果。',
  provenance: {
    text: '原文，未经改写。',
    claim: '机械提取首句，保证是原文子串。质量弱于模型抽取，但不会凭空生成。',
    objections: '人工逐条核对真实评论后标注，且全部通过 verifyClassification 原文子串校验。'
  },
  curation: {
    labelled: Object.keys(LABELS).length,
    policy: '只标针对答案本身提出实质反驳的评论。附和、感慨、人身攻击、以及短到无法核对的一律不标。'
  },
  caveats: [
    {
      id: 'off-topic-dilution',
      impact: '使标记密度被低估',
      note: '探针当时用的查询集比话题包声明的 8 路更宽，样本里混进了与话题无关的条目（例如「想选一个二线城市生活」「大学生最佳就业城市排行榜」）。这些条目本身不会有针对本话题的异议，白白拉低了分母。所以 8.3% / 14.7% 是下界，不是真实值——查询集收紧后密度会上升。'
    },
    {
      id: 'mechanical-claim',
      impact: '影响观感，不影响标记',
      note: '主张是机械取首句。长文里首句常常是铺垫而非核心主张（例如那条 9283 赞的文章，首句落在「住房的噪音很严重」）。它仍是原文子串，不影响任何异议的可核对性，但真实产品里这一层必须换成模型抽取。'
    }
  ],
  boundaryCases: [
    {
      id: '6299799986573829357',
      comment: '有的前后矛盾了',
      why: '真实的自相矛盾异议，但只有 7 个字，低于 8 字实质门槛，被校验器拦下。'
    },
    {
      id: '-3303467542035671619',
      comment: '你这样的人，居然有小两万的粉丝，只能说知乎药丸',
      why: '167 赞的高票回答，三条评论全是情绪与人身攻击，没有可核对的信息。落进「未见实质异议」。'
    },
    {
      id: '8939282175577742094',
      comment: '低估了。进去发现方向不对，还能转岗或积累平台背书，小公司掉头成本高很多。',
      why: '看起来像异议，实际是顺着答案往下补强，不是反驳。不标。'
    }
  ]
};

const snapshot = {topicId: topic.id, meta, records};
const target = new URL(`data/snapshot-${topic.id}.json`, root);
await writeFile(target, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');

// ── 构建完立刻自检一遍，把诊断打出来 ────────────────────────────────────
const map = buildReadingMap(records, {topic});
const d = map.diagnostics;

console.log(`已写入 data/snapshot-${topic.id}.json`);
console.log(`记录 ${d.total} 条 · 有评论 ${d.commentBearing} 条（覆盖 ${(d.commentCoverage * 100).toFixed(1)}%）`);
console.log(`三态分布：有异议 ${d.stateCounts.disputed} · 有前提 ${d.stateCounts.conditional} · 未见实质异议 ${d.stateCounts.no_signal}`);
console.log(`实质异议 ${d.substantiveObjections} 条`);
console.log(`整张列表：${d.surfaces.whole.flagged}/${d.surfaces.whole.total} = ${(d.surfaces.whole.ratio * 100).toFixed(1)}% → ${d.surfaces.whole.viable ? '成立' : '不成立'}`);
console.log(`有评论层：${d.surfaces.withComments.flagged}/${d.surfaces.withComments.total} = ${(d.surfaces.withComments.ratio * 100).toFixed(1)}% → ${d.surfaces.withComments.viable ? '成立' : '不成立'}`);
console.log(`判定：${d.verdict}`);
console.log('');
console.log(d.reason);
