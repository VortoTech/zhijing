// 条件选择的即时反馈：只用用户明确选的条件和当前对比图，不调用模型、不计算胜率，
// 也不把「相关」说成「答案」。结合用户情况的梳理交给下方的决策陪伴（/api/advice）。
export function buildGuidance(block,selections={}){
  if(block?.status!=='complete'||!Array.isArray(block.forks))return null;
  const picked=[];
  for(const [forkIndex,branchIndex] of Object.entries(selections)){
    const fork=block.forks[Number(forkIndex)];
    const branch=fork?.branches?.[Number(branchIndex)];
    if(fork&&branch)picked.push({forkIndex:Number(forkIndex),branchIndex:Number(branchIndex),question:fork.label,when:branch.when,lean:branch.lean,evidence:branch.evidence||[]});
  }
  const remaining=block.forks.map((fork,index)=>({index,label:fork.label})).filter(item=>selections[item.index]==null);
  if(!picked.length)return {
    state:'empty',title:'先挑几个更像你的情况',
    message:'点一下更接近你的那一边，拿不准就跳过。选好后，可以让知镜结合这些情况和原话帮你梳理。',
    picked,remaining,groups:[]
  };
  const groups=[];
  for(const option of block.options||[]){
    const matches=picked.filter(item=>item.lean===option);
    if(matches.length)groups.push({option,matches,evidence:matches.flatMap(item=>item.evidence)});
  }
  const mixed=groups.length>1;
  return {
    state:mixed?'mixed':'focused',
    title:mixed?'你的情况同时牵动两边':`你选的情况都落在「${groups[0].option}」这一边`,
    message:mixed
      ?'你选的情况分别出现在两边的原话里。先想想对你来说哪个条件更重要。'
      :`说明「${groups[0].option}」一侧的原话和你更相关，这不代表它就是答案，读者的反驳和另一边的理由同样要看。`,
    picked,remaining,groups
  };
}
