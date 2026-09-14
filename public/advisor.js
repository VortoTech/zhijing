// 条件选择的即时反馈：只用用户明确选的条件和当前对比图，不调用模型、不计算胜率，
// 也不把「相关」说成「答案」。结合用户情况的梳理交给下方的决策陪伴（/api/advice）。
export function buildGuidance(block,selections={},language='zh'){
  if(block?.status!=='complete'||!Array.isArray(block.forks))return null;
  const picked=[];
  for(const [forkIndex,branchIndex] of Object.entries(selections)){
    const fork=block.forks[Number(forkIndex)];
    const branch=fork?.branches?.[Number(branchIndex)];
    if(Number.isInteger(Number(forkIndex))&&[0,1].includes(branchIndex)&&fork&&branch)picked.push({forkIndex:Number(forkIndex),branchIndex:Number(branchIndex),question:fork.label,when:branch.when,lean:branch.lean,evidence:branch.evidence||[]});
  }
  const remaining=block.forks.map((fork,index)=>({index,label:fork.label})).filter(item=>selections[item.index]==null);
  if(!picked.length)return {
    state:'empty',title:language==='en'?'Start with a few situations that resemble yours':'先挑几个更像你的情况',
    message:language==='en'?'Choose the side closer to your situation, or skip it if unsure. Selecting a condition opens the quotes from both sides so you can check their assumptions.':'点一下更接近你的那一边，拿不准就跳过。选中后会展开两边的原话，先核对适用前提。',
    picked,remaining,groups:[],tasks:[]
  };
  const groups=[];
  for(const option of block.options||[]){
    const matches=picked.filter(item=>item.lean===option);
    if(matches.length)groups.push({option,matches,evidence:matches.flatMap(item=>item.evidence)});
  }
  const tasks=picked.map(item=>{
    const other=block.forks[item.forkIndex].branches[1-item.branchIndex];
    const opposite=other?.evidence||[];
    const missing=!item.evidence.length||!opposite.length;
    return {forkIndex:item.forkIndex,evidence:item.evidence,opposite,missing,
      text:language==='en'
        ?`Check “${item.when}”: ${missing?'some source evidence is missing; do not infer an answer.':'read the expanded quotes from both sides and check who the assumption applies to.'}`
        :`先核对「${item.when}」：${missing?'部分原话缺失，暂不能据此判断。':'阅读已展开的两边原话，确认前提说的是谁、是否适用于你。'}`};
  });
  const mixed=groups.length>1;
  return {
    state:mixed?'mixed':'focused',
    title:mixed
      ?(language==='en'?'Your situation pulls in both directions':'你的情况同时牵动两边')
      :(language==='en'?`Your selected situations: check the sources for “${groups[0]?.option||picked[0].when}”`:`优先核对「${groups[0]?.option||picked[0].when}」的相关材料`),
    message:mixed
      ?(language==='en'?'The situations you chose appear in quotes from both sides. Consider which condition matters more to you.':'你选的情况分别出现在两边的原话里。先想想对你来说哪个条件更重要。')
      :(language==='en'?'These conditions are reading clues, not proof that an option fits you. Check the objections and the other side too.':'所选条件提供了相关材料线索，不代表某个选项更适合你；读者异议和另一边的理由也要核对。'),
    picked,remaining,groups,tasks
  };
}
