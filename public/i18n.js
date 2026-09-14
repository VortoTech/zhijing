const STATIC_COPY={
  zh:{
    brandName:'知镜',navHome:'首页',navMine:'我的知乎',navigationLabel:'主导航',exampleBadge:'示例',personalKicker:'从你的积累，看到更多角度',personalIntro:'收藏、创作与个人情况，都在这里。',
    pageTitle:'知镜 · 把知乎的分歧摆上桌',
    pageDescription:'输入你正在纠结的选择，知镜把知乎上两边的真人原话并排摆出来，评论区里有人当场不同意的，也一起摆出来。每句都能核对，都署名答主。',
    heroAlt:'看山在左侧拿着望远镜观察不同观点',
    homeEyebrow:'知乎观点体验空间',homeTitle:'你正在纠结什么？',homeTagline:'把问题交给知镜，看看知乎上的人怎么说。',homeStart:'开始体验',homeProof:'真人原话 · 来源可核对 · 不替你做决定',
    tableViewLabel:'观点桌面',backHome:'←　换个问题',navTopic:'当前话题',summaryLabel:'我的结论',goZhihu:'查看知乎真实话题',
    zhihuViewLabel:'知乎真实话题与评论',goTable:'进入观点桌面',zhihuKicker:'知乎现场 · 真人原话',zhihuTitle:'看看知乎里，大家真的怎么说。',zhihuLede:'搜索一个话题，保留答主原话、赞数和评论区里的当场反驳。',
    searchLabel:'搜索知乎观点话题',searchPlaceholder:'比如：第一份工作，选高薪小公司还是低薪大厂？',searchButton:'查看真实讨论',hotNow:'热门话题推荐',examplesLabel:'示例问题',resultsLabel:'结果',dataSummary:'这些内容是怎么来的'
  },
  en:{
    brandName:'Zhijing',navHome:'Home',navMine:'My Zhihu',navigationLabel:'Main navigation',exampleBadge:'Examples',personalKicker:'A fresh perspective on what you save',personalIntro:'Your favorites, writing, and personal context — all in one place.',
    pageTitle:'Zhijing · Put Zhihu disagreements on the table',
    pageDescription:'Enter a choice you are weighing. Zhijing places real arguments from both sides next to each other, including direct pushback from the comments. Every quote is attributed and verifiable.',
    heroAlt:'Kanshan looks through binoculars at different points of view',
    homeEyebrow:'A SPACE FOR REAL OPINIONS',homeTitle:'What’s on your mind?',homeTagline:'Bring your question to Zhijing. See what people on Zhihu say.',homeStart:'START',homeProof:'Real voices · Checkable sources · Your decision',
    tableViewLabel:'Opinion Table',backHome:'←  New question',navTopic:'Current topic',summaryLabel:'My takeaway',goZhihu:'View real Zhihu topics',
    zhihuViewLabel:'Real Zhihu topics and comments',goTable:'Enter the Opinion Table',zhihuKicker:'LIVE ON ZHIHU · REAL VOICES',zhihuTitle:'See what people on Zhihu actually say.',zhihuLede:'Search a topic and keep the authors\' exact words, upvotes, and direct challenges from the comments.',
    searchLabel:'Search a topic on Zhihu',searchPlaceholder:'For example: postgraduate study or start working',searchButton:'View real discussion',hotNow:'Explore saved examples:',examplesLabel:'Example topics',resultsLabel:'Results',dataSummary:'How this content was assembled'
  }
};

const EN_EXACT=new Map(Object.entries({
"继续深造，还是尽早进入职场？":"Keep studying, or enter the workplace?","在大城市发展，还是回家乡生活？":"Build a life in a major city, or return home?","更稳定的选择，还是更大的发展空间？":"More stability, or more room to grow?","高薪和成长，哪个更重要？":"Higher pay or growth \u2014 what matters more?","同一个问题，多种视角。选择一个看法，让它换个角度说。":"One question, many perspectives. Choose a voice to explore it.","不替你做决定，只提供多角度的分析。":"Different perspectives. The decision remains yours.","让积累，成为新的视角":"A new perspective on what you save","登录知乎，查看你的收藏、创作与记住的情况。":"Sign in to explore your favorites, writing, and saved context.","检查收藏中的观点与评论区异议。":"Check saved opinions and reader objections.","回看自己的创作与读者反馈。":"Review your writing and reader feedback.","管理你确认过的个人情况与选择。":"Manage your confirmed context and choices.",
  '已保存的知乎原话 · 可核对来源':'Saved Zhihu quotes · Checkable sources',
  '当前话题':'Current topic','这个话题的三步':'Three steps for this topic','两边原话':'Both sides','换个角度听':'Other angles','我的结论':'My takeaway',
  '继续上次的话题':'Continue your topic','带走这次梳理':'Take this review with you','还没有可以带走的结论':'No takeaway yet',
  '先在「两边原话」里跟知镜说说你的情况，让它对照一次原话。这里会整理出：你的情况、两边最相关的原话、还缺的信息，和可以先做的一步。':'Tell Zhijing about your situation under “Both sides” first and let it check the quotes once. This page will then collect your situation, the most relevant quotes, what is still unclear, and one next step.',
  '去跟知镜说说我的情况':'Tell Zhijing about my situation','我的情况':'My situation','这次没有说具体情况。':'No specific situation was shared this time.','真正要定的事':'What you are really deciding','对照原话得出的判断':'Judgments checked against quotes','评论区的反驳':'Pushback from the comments','还没弄清的':'Still unclear','处境相似的人怎么说':'What people in similar situations say',
  '复制这份梳理':'Copy this review','回到两边原话继续聊':'Back to both sides','换个问题':'New question','已记在「我的知乎」，下次登录还能看到。':'Saved to My Zhihu for your next sign-in.','后，知镜可以记住你的情况，下次接着聊。':' so Zhijing can remember your situation next time.',
  '原话来自知乎回答与评论，一字未改；判断由 AI 整理，不替你做决定。':'Quotes come from Zhihu answers and comments, unchanged. Judgments are organized by AI and never decide for you.','已复制，可以发给朋友或存进备忘录。':'Copied. Share it or save it to your notes.','没能复制，请手动选中上面的内容。':'Could not copy. Please select the content above manually.',
  '检索额度已用完，本次仅展示已取得的材料。':'The search budget is exhausted; only retrieved material is shown.',
  '部分检索未完成，本次材料可能不完整，可以重试。':'Some searches failed. These results may be incomplete; you can retry.',
"当前为示例模式，可阅读已保存的讨论；实时搜索尚未开放。":"Example mode: saved discussions are available; live search is not enabled.",
"当前为示例模式，无法检索这个新问题。请选择下面的已保存示例。":"Example mode cannot search this new question. Choose a saved example below.",
"当前未开启 AI 陪伴，无法生成本次回答。问题已保留；点击桌面原话可核对全文，或在知乎现场选择条件后阅读两边材料。":"AI advice is not enabled, so no answer was generated. Your question is saved in the input. Click a table quote to check its source, or select conditions to read both sides.",
"当前为示例阅读，AI 陪伴尚未开启。点击桌面原话可核对来源。":"Example reading mode; AI advice is not enabled. Click a table quote to check its source.",
"知镜正在结合当前原话和你的问题思考…":"Zhijing is reviewing your question against the current source quotes…",
"已选择当前语气。输入问题后，知镜会结合当前话题的原话回答。":"Tone selected. Enter a question to get a response grounded in this topic’s source quotes.",
"选择并核对原话":"Select and check source quote",
"核对原话":"Check quote",
"针对这句话":"About this quote",
"针对这条回答":"About this answer",
"检索未完成，可重试":"Search incomplete; retry available",
"正在重试…":"Retrying…",
"重试未完成的体检":"Retry incomplete check",
"退出失败，请重试。":"Sign-out failed. Please try again.",
"登录状态已变化，请重试。":"Your sign-in state changed. Please try again.",
  '多写几个字，比如「考研还是直接工作」。':'Please add a few more words, for example “postgraduate study or start working”.',
  '问题请控制在 80 字以内。':'Keep the question within 80 characters.',
  '正在读知乎上相关的回答和评论，通常要 20–40 秒。':'Reading relevant Zhihu answers and comments. This usually takes 20–40 seconds.',
  '正在打开示例…':'Opening the example…','取消':'Cancel','已取消。已经发出的分析可能还会在服务端跑完。':'Cancelled. Analysis already sent may still finish on the server.',
  '重试':'Retry','服务暂时不可用，请稍后再试。':'The service is temporarily unavailable. Please try again later.','这次没有取到结果，请重试。':'No results were returned. Please try again.','结果和当前问题对不上，请重试。':'The result does not match the current question. Please try again.','等太久了，请重试。':'This is taking too long. Please try again.','连接中断，请检查网络后重试。':'The connection was interrupted. Check your network and try again.',
  '打开知乎原文 ↗':'Open on Zhihu ↗','读者评论':'Reader comment','回答':'Answer','匿名用户':'Anonymous','等待更多原话':'Waiting for more source quotes',
  '当前浏览器暂不支持语音输入，可以直接打字。':'Voice input is not supported in this browser. You can type instead.','没有听清，可以再试一次或直接打字。':'I could not hear that clearly. Try again or type instead.','语音输入没有启动，请稍后再试。':'Voice input did not start. Please try again later.',
  '继续追问，比如：如果我更怕三年后后悔呢？':'Ask a follow-up, for example: what if I fear regretting this in three years?','继续追问':'Ask a follow-up','停止':'Stop','语音':'Voice','思考中':'Thinking','发送':'Send','正在听你说…':'Listening…','可打字，也可用语音输入 · Enter 发送':'Type or use voice · Press Enter to send',
  '8 个看山正在从不同角度想…':'Eight Kanshan characters are considering different angles…','观点桌面 · 问知镜':'OPINION TABLE · ASK ZHIJING','同一句话，换个角度听。':'Hear the same words from another angle.','选一个看山，让它换个语气说。':'Choose a Kanshan persona and hear it in a different voice.','AI 演绎，不替你做决定':'AI interpretation, never a decision made for you','评论 · 有人反驳':'COMMENT · DIRECT CHALLENGE','有人补了前提':'A reader added a condition','有人不同意':'A reader disagreed','评论区有读者补了前提':'A reader added a condition in the comments','评论区有读者当场不同意':'A reader challenged this in the comments','针对这句话':'Targets this quote','针对这条回答':'Targets the whole answer','读者评论原话':'Reader comment · exact words',
  '知乎文章':'Zhihu article','知乎回答':'Zhihu answer','未知':'Unknown','关闭':'Close','关闭原帖':'Close source post','以下是知乎接口返回的正文（可能是摘要）。':'The text below was returned by the Zhihu API and may be an excerpt.','高亮的是被引用的那一句，程序按编号从原文取出，一字未改。':'The cited sentence is highlighted. It was retrieved by index without changing a word.','被引用的是下面高亮的那条评论。':'The cited comment is highlighted below.','这条回答的精选评论':'Selected comments on this answer','这次没有取到这条回答的评论。':'No comments were returned for this answer.','去知乎看全文 · 给答主点赞':'Read the full post on Zhihu · Upvote the author','复制这句':'Copy this quote','已复制，可以在知乎页面里搜索定位。':'Copied. You can search for it on the Zhihu page.','没能复制，请手动选中上面的原话。':'Could not copy it. Select the quote above manually.',
  '看原帖':'View source','知乎 ↗':'Zhihu ↗','这句适合我吗？':'Does this apply to me?','答主自己交代的前提':'Condition stated by the author','这次没能整理出对比（模型请求失败）。':'The comparison could not be assembled because the model request failed.','这个问题不太像二选一，没法并排对比。换成「A 还是 B」的问法试试。':'This does not look like a two-option question. Try phrasing it as “A or B”.','这个示例还没有整理好的对比图。':'This example does not have a prepared comparison yet.','这次没从原话里整理出明确的对比，可以直接看下面的原始回答。':'No clear comparison could be assembled from the source quotes. You can still read the original answers below.','重新整理':'Build again','选':'Choose','他们怎么说':'What people say','这一边没找到理由。':'No supporting reason was found on this side.','收起':'Collapse','哪些情况更接近你':'Which situations are closer to yours','先挑几个更像你的情况':'Start with a few situations that resemble yours','点一下更接近你的那一边，拿不准就跳过。选好后，可以让知镜结合这些情况和原话帮你梳理。':'Choose the side closer to your situation, or skip it if unsure. Then Zhijing can help you review it against the source quotes.','你的情况同时牵动两边':'Your situation pulls in both directions','你选的情况分别出现在两边的原话里。先想想对你来说哪个条件更重要。':'The situations you chose appear in quotes from both sides. Consider which condition matters more to you.','结合这些情况问知镜':'Ask Zhijing using these situations','看两边的原话':'View quotes from both sides','看两边的原话（你选的那边已标出）':'View quotes from both sides (your choice is marked)','你选的 · ':'Your choice · ','展开完整对照与个人条件':'Open the full comparison and personal conditions',
  '这里暂时没有内容。':'Nothing is available here yet.','评论区的反驳由人工标注，并校验引文来源。':'Comment objections were manually labeled and their citations checked.','评论区的反驳由模型归类，并逐字校验引文来源。引文存在不代表归类一定正确。':'Comment objections were classified by the model and their citations checked word for word. A valid citation does not guarantee the classification is correct.','本次检索取得的有限样本。':'A limited sample from this search.',
  '回应的原句':'The sentence being addressed','查看这句话的上下文':'View this sentence in context','这条评论针对的是回答的前提，不是其中某一句。':'This comment challenges the answer\'s premise rather than a single sentence.','读者原话 · 逐字引用':'Reader\'s exact words','复制评论以便查找':'Copy comment for searching','已复制评论原话。':'Comment copied.','未能复制，请选中上方原话手动复制。':'Could not copy it. Select the comment above manually.','链接打开回答或文章，不会自动定位评论。可用上方原话在原站查找；精选评论不代表完整评论区。':'The link opens the answer or article but cannot jump directly to the comment. Search the source site using the quote above. Selected comments are not the full discussion.',
  '分析未完成':'Analysis incomplete','本次评论未见实质异议':'No substantive challenge in sampled comments','评论数据不足':'Insufficient comment data','展开原文片段':'Open source excerpt','本条分析未完成：模型遗漏、请求失败或部分标注未通过引用校验。已展示的引用仍可核对，未展示的部分不能理解为没有异议。':'This analysis is incomplete due to model omissions, request failures, or citation checks. Displayed quotes remain verifiable; missing material does not mean there was no disagreement.','标题和这个问题不太相关，本次没有送去分析；有没有异议未知。':'The title is not closely related to this question, so it was not analyzed. Whether it has objections is unknown.','原文保留供阅读，异议分析尚不完整。':'The source remains available to read, but disagreement analysis is incomplete.','本次没有取得评论，无法分析读者是否提出异议。':'No comments were returned, so reader objections cannot be assessed.',
  '怎么来的？':'How was this made?','用实时检索重新找':'Search live again','重新分析':'Analyze again','正在讨论':'NOW DISCUSSING','换一个话题':'Choose another topic','这个话题暂时还没有可以摆上桌的双边观点。':'This topic does not yet have two-sided views ready for the table.','有读者提出异议':'Reader objection','有人反驳或指出回答的问题':'Someone challenged the answer or pointed out a problem','有前提条件':'Conditional','有人补充「这只适用于……」':'Someone added “this only applies when…”','显示范围':'Display range','这里暂时没有内容。':'Nothing to show here yet.',
  '标题和分支说明由 AI 归纳，只帮你把两边摆清楚，不替你做决定。有人提出异议，不代表异议成立；没发现异议，也不代表回答适用于你。':'Titles and branch descriptions are AI summaries that organize both sides without deciding for you. An objection is not automatically valid, and no detected objection does not mean an answer applies to you.','对比图由模型从赞数靠前的 24 条相关回答和它们的精选评论里整理：程序先把回答切句编号，模型只挑编号，页面按编号取原文，所以引号里的话一字未改。归纳本身可能不全或不准。答主在同一回答里交代了适用前提的，前提句也按编号取出，标在原话下面。':'The comparison is assembled from up to 24 highly upvoted relevant answers and selected comments. Answers are split into indexed sentences; the model selects only indexes, and the interface retrieves the exact wording. The summary may still be incomplete or inaccurate. Conditions stated by an author are retrieved the same way and shown under the quote.','「结合你的情况」由模型只用这张对比图里的原话和你确认过的情况作答：判断后面的原话按编号取回，没有原话支持的标成「推测」；从你的话里听出的情况，要你点「记下」才会用。它不给胜率，也不替你选。':'“Use my situation” answers only from quotes in this comparison and facts you confirmed. Supporting quotes are retrieved by index; unsupported judgments are marked as inference. A fact inferred from your message is only used after you save it. Zhijing does not provide odds or decide for you.','评论区的反驳由人工标注，并校验引文来源。':'Comment objections were manually labeled and their citations checked.','评论区的反驳由模型归类，并逐字校验引文来源。引文存在不代表归类一定正确。':'Comment objections were classified by a model and checked word for word against their sources. A valid citation does not guarantee that the classification is correct.','本次检索取得的有限样本。':'A limited sample returned by this search.','未记录':'Not recorded',
  '当前阶段':'Current stage','经济状况':'Financial situation','城市与家庭':'City and family','时间窗口':'Time window','风险承受':'Risk tolerance','最看重':'Top priority','不能接受':'Deal-breaker','其他情况':'Other context','情况':'Context','没能保存，请稍后再试。':'Could not save. Please try again later.','已删除你在知镜的全部数据，并退出登录。':'All of your Zhijing data was deleted and you were signed out.','来自收藏':'From favorites','删除':'Delete','知镜猜':'Zhijing infers','对，记下':'Yes, save it','不对':'No','知镜记住的情况':'What Zhijing remembers','没读到你的知乎资料，暂时不能记住你的情况。':'Your Zhihu profile could not be read, so Zhijing cannot remember your context yet.','正在读你的收藏…':'Reading your favorites…','用我的收藏推测我在考虑什么':'Infer what I am considering from my favorites','确定删除？再点一次':'Delete everything? Click again','删除我在知镜的全部数据':'Delete all my Zhijing data','正在读取…':'Loading…','记住我的情况':'Remember my context','还没有记下的情况。和知镜聊的时候，它会问你要不要记下。':'No saved context yet. During a conversation, Zhijing will ask before saving anything.','最近想过的问题：':'Recent questions:','关掉并删除这些情况':'Turn off and delete this context',
  '结合我的情况帮我梳理':'Help me review this using my situation','反对的声音主要在说什么':'What are the strongest objections?','我还需要先弄清楚什么':'What do I still need to clarify?','帮我找和我情况像的人':'Find people in a similar situation','知镜这次没能回复，请稍后再试。':'Zhijing could not reply this time. Please try again later.','连接中断或等太久了，请重试。':'The connection was interrupted or took too long. Please try again.','还有哪些判断':'More considerations','评论区怎么反驳的':'How the comments challenge this','还缺什么信息':'What information is missing','你又去知乎搜到了什么':'What else did you find on Zhihu?','我下一步做什么':'What can I do next?','读者异议':'Reader objection','推测 · 没有原话支持':'Inference · no direct quote','知镜：':'Zhijing:','你：':'You:','重新检索':'Search again','我从你的话里听到这些，要记下吗？':'I heard these details in what you said. Save them?','记下':'Save','不用记':'Do not save','还有这些：':'A few more considerations:','评论区里有人当场这样说：':'Someone in the comments challenged it this way:','这些我还不确定，可能要你自己去弄清：':'These points are still uncertain and may need your own verification:','AI 概括':'AI summary','没搜到能直接回答的原话。':'No source quote directly answered this.','可以先做的一步（随时可以推翻）':'One reversible next step','这一步没有直接依据，是我的推测。':'This step has no direct source support and is an inference.','看原话':'View quotes','对应你的「':'Matches your “','自述处境':'Situation in their own words','经历与选择':'Experience and choice','这次没找到处境和你明显相似的人。':'No one with a clearly similar situation was found this time.','只用在这一页，刷新就没了。':'Used only on this page and cleared on refresh.','用知乎登录':'Sign in with Zhihu','只用在这一页。没读到你的知乎资料，暂时不能记住。':'Used only on this page. Your Zhihu profile could not be read, so it cannot be remembered yet.','只用在这一页。':'Used only on this page.','让知镜记住':'Let Zhijing remember','（随时可删）':' (delete anytime)','已记住，下次登录还在；可以在「我的知乎」里删除。':'Saved for future sign-ins. You can delete it under “My Zhihu”.','去掉':'Remove','知镜会参考':'Zhijing will consider','回答':'Answer','还可以补充':'You can also add','你的情况更像':'Your situation is closer to','找和我情况像的人':'Find similar people','也可以问':'You can also ask','也可以':'You can also','快捷回复':'Quick replies','说说你的情况或顾虑…':'Describe your situation or concern…','跟知镜说说你的情况或顾虑':'Tell Zhijing about your situation or concern','稍等…':'Please wait…','Enter 发送 · Shift+Enter 换行':'Enter to send · Shift+Enter for a new line','问知镜 · ':'Ask Zhijing · ','有进行中的对话':'Conversation in progress','不给胜率，不替你选':'No odds and no decision made for you','重新开始':'Start over','收起问知镜':'Collapse Ask Zhijing','好了，帮我梳理':'Ready — help me review it','正在按你的情况去知乎找处境相似的人…':'Searching Zhihu for people in a similar situation…','正在对照原话想…':'Checking against the source quotes…','和知镜的对话':'Conversation with Zhijing','知镜正在回复':'Zhijing is replying','知镜已回复':'Zhijing replied','实时检索暂未开放，可以先看看示例。':'Live search is not available yet. Try an example first.',
  '理性分析':'Rational analysis','犀利反问':'Sharp challenge','温柔共情':'Gentle empathy','幽默解构':'Humorous reframing','现实主义':'Practical realism','长期主义':'Long-term view','反方挑战':'Opposing challenge','苏格拉底追问':'Socratic questions',
  '把情绪先放一边：这句话只在你能承担波动时成立。':'Set emotion aside for a moment: this only holds if you can tolerate the volatility.','如果平台只给名头、不给成长，它凭什么就是更好的选择？':'If the platform offers only prestige but no growth, why should it be the better choice?','你担心选错很正常，先确认哪一种后悔是你更能承受的。':'It is normal to fear choosing wrong. First decide which kind of regret you can better live with.','高薪像过山车，低薪大厂像地铁：一个刺激，一个也可能坐过站。':'High pay can be a roller coaster; a lower-paid big company can be a subway ride — one is thrilling, and the other may still carry you past your stop.','先算三件事：现金流、岗位核心度，以及六个月后的可替代性。':'Calculate three things first: cash flow, how central the role is, and your replaceability in six months.','别只看第一年，把三年后的能力复利也一起放进来。':'Do not look only at year one. Include the compounding value of your abilities three years from now.','如果大厂只是更大的螺丝钉，所谓平台真的值得用成长速度去换吗？':'If a big company only makes you a bigger cog, is the platform really worth trading away growth speed?','你说想要稳定——真正害怕的是收入波动，还是选择不被认可？':'You say you want stability — do you fear income volatility, or having your choice go unrecognized?',
  '知乎登录':'Zhihu sign in','当前演示环境暂未配置知乎授权':'Zhihu authorization is not configured in this demo','退出':'Sign out','已退出。':'Signed out.','正在读取你最近的知乎收藏…':'Reading your recent Zhihu favorites…','暂时读不到你的收藏。':'Your favorites are temporarily unavailable.','重新登录':'Sign in again','评论区没发现异议':'No objection found in comments','没有取到评论':'No comments returned','没找到这条的评论区':'Comment thread not found','还没有人评论':'No comments yet','我的知乎':'My Zhihu','从收藏里挑一个问题':'Choose a question from favorites','最近的收藏里没有回答或文章。':'No answers or articles were found in recent favorites.','收藏体检':'Favorites check','答主视角':'Author view','体检我的收藏':'Check my favorites','体检我发过的内容':'Check my posts','体检没有完成，请稍后再试。':'The check did not finish. Please try again later.','你最近发过的':'your recent posts','最近收藏的':'recent favorites','看看你自己发过的回答、文章和想法，评论区有没有人当场不同意。':'Review your own answers, articles, and posts to see whether readers directly disagreed in the comments.','已用知乎账号登录':'Signed in with Zhihu','知乎登录没有完成。知乎要求账号已绑定手机号并完成实名认证，检查后可以再试一次':'Zhihu sign-in did not complete. Make sure the account has a linked phone number and completed real-name verification, then try again.','配置读取失败':'Could not load configuration','暂时连不上服务，请稍后再试。':'Cannot connect to the service right now. Please try again later.','重新连接':'Reconnect',
  '后可以让知镜记住。':' to let Zhijing remember it.','还没打开。打开后，你告诉知镜的情况和想过的问题会存进知镜的数据库，下次登录还在；随时可以删，关掉就全部删除。知乎授权 token 不保存。':'This is off. When enabled, the context and questions you share are saved for your next sign-in. You can delete them anytime; turning it off deletes all of them. Zhihu authorization tokens are not stored.','存了什么：知乎昵称和头像、你确认过的情况（180 天后自动过期）、想过的问题和选过的条件。推测的情况 7 天内不确认就删除。':'Stored data: your Zhihu name and avatar, confirmed context (expires after 180 days), recent questions, and selected conditions. Inferred context is deleted unless confirmed within 7 days.','先说说你的情况吧：可以直接打字，也可以点下面更像你的选项。':'Tell me about your situation first. You can type freely or choose one of the options below.','今天的检索次数用完了，这次没搜成。':'Today’s search quota has been reached, so this search could not run.','这次没搜成，稍后可以再问一次。':'The search did not complete. You can try again later.','把情况说得具体一点（城市、行业、家里能支持多久），我再找一次。':'Add a little more detail — such as city, industry, or how long your family can support you — and I can search again.','今天的检索次数用完了，这次只翻了原来的评论。':' Today’s search quota has been reached, so only existing comments were reviewed.','只收说话人讲自己经历的原话，一字未改；「哪里相似」是我的判断。他们后来怎么选的，看「经历与选择」。':'Only exact quotes in which people describe their own experiences are included. The similarity judgment is Zhijing’s inference; see “Experience and choice” for what they chose later.','先说一条你的情况':'Share one detail about your situation first','做法：用每条回答里的一句话去知乎搜索，对上了才拿得到精选评论（每条最多 3 条），对不上的如实标出。反驳由模型挑出，展示读者原话供你判断；有人反驳不代表反驳成立。':'Method: one sentence from each answer is searched on Zhihu. Selected comments are retrieved only when the answer can be matched, up to three per item; unmatched items are marked honestly. The model selects objections and shows the reader’s exact words for your judgment. An objection is not automatically valid.',
  '有读者提出异议':'Reader objection','未见实质异议':'No substantive objection found','未分析（与话题不相关）':'Not analyzed (unrelated to topic)','被回应的原句':'Sentence being addressed','原文摘句':'Source excerpt','原文片段（非主张总结）':'Source excerpt (not a claim summary)',
  '答非所问':'Does not answer the question','自相矛盾':'Self-contradiction','补充适用条件':'Adds a condition','补充我的条件':'Add my conditions','提出反例':'Counterexample','质疑数据':'Questions the data','质疑问题前提':'Challenges the premise',
  '高薪小公司':'High-paying small company','低薪大厂':'Lower-paying large company','成长快、全链路参与':'Fast growth and end-to-end ownership','薪资体现当下价值':'Salary reflects present value','可能获得爆发式成长':'Potential for rapid growth','平台背书简历值钱':'Platform prestige strengthens a résumé','培训体系完善成长规范':'Structured training and development','大厂背景跳槽通行证':'Large-company experience opens doors',
  '你能否承受经济压力？':'Can you absorb financial pressure?','家里能兜底，能赌波动':'Family support provides a safety net','经济压力大需稳定收入':'Financial pressure requires stable income','你更看重确定性还是可能性？':'Do you value certainty or possibility more?','追求快速成长和机会':'Pursue fast growth and opportunity','追求稳定和规范':'Pursue stability and structure','你能否接受螺丝钉岗位？':'Can you accept a narrow cog-in-the-machine role?','希望主导核心业务':'Want ownership of core work','能接受边缘或螺丝钉岗':'Can accept a peripheral or narrow role','你是否有明确职业方向？':'Do you have a clear career direction?','想探索多方向积累经验':'Want to explore and build broad experience','打算长期深耕一个行业':'Plan to build depth in one industry','你能否接受履历不被认可？':'Can you accept having less résumé recognition?','相信能力比背书重要':'Believe ability matters more than prestige','担心小公司经历不被认可':'Worry small-company experience will not be recognized',
  '考研':'Postgraduate study','直接工作':'Start working','提升学历门槛':'Raise academic qualifications','获得应届生身份':'Retain fresh-graduate status','换专业换赛道':'Change major or career track','积累经验人脉':'Build experience and connections','避免时间成本':'Avoid the time cost','经济独立':'Financial independence','专业强学历依赖':'Field strongly depends on credentials','专业重实践':'Field values practice','目标明确需学历':'Clear goal requires a degree','目标不清':'Goal is unclear','家庭能支持':'Family can provide support','经济压力大':'High financial pressure','offer差':'Weak job offer','有优质offer':'Strong job offer','真心想考研':'Genuinely want postgraduate study','盲目跟风':'Following the crowd',
  '去大城市':'Move to a major city','回老家':'Return home','机会多、收入高':'More opportunities and higher income','能积累可迁移的硬技能':'Build transferable hard skills','生活成本低、舒适度高':'Lower costs and greater comfort','有家人照应、人脉熟':'Family support and familiar connections',
  '国企':'State-owned enterprise','私企':'Private company','稳定有保障':'Stable and secure','福利好压力小':'Good benefits and lower pressure','薪资高晋升快':'Higher pay and faster promotion','能力成长快':'Faster capability growth',
  '转行程序员':'Switch into software','不转行程序员':'Do not switch into software','高薪回报吸引人':'Attractive earning potential','办公环境好，体面':'Comfortable and respectable work environment','行业竞争激烈，门槛高':'Intense competition and a high entry barrier','年龄大转行风险高':'Higher switching risk with age'
}));

const EN_PATTERNS=[
  [/^已等待 (\d+) 秒$/,m=>`Waited ${m[1]} seconds`],
  [/^已说了 (\d+) 条情况$/,m=>`${m[1]} details shared`],
  [/^和知镜聊了 (\d+) 轮$/,m=>`${m[1]} rounds with Zhijing`],
  [/^看完整对话（(\d+) 轮）$/,m=>`View full conversation (${m[1]})`],
  [/^看示例：(.*)$/,m=>`View example: ${m[1]}`],
  [/^知乎 · 观点 ([AB])$/,m=>`Zhihu · View ${m[1]}`],
  [/^关于「(.+)」的原话暂时缺席$/,m=>`No source quote is available yet for “${m[1]}”`],
  [/^(.+) · ([\d—,]+) 赞$/,m=>`${m[1]} · ${m[2]} upvotes`],
  [/^读者评论 · 在 (.+) 的回答下$/,m=>`Reader comment · under ${m[1]}'s answer`],
  [/^用(.+)的方式说$/,m=>`Speak with ${translateEnglish(m[1])}`],
  [/^你问：(.+)$/,m=>`You asked: ${m[1]}`],
  [/^我是知镜。你在「(.+)」和「(.+)」之间纠结，我不替你选，只帮你把左边的原话和你自己的情况对上。$/,m=>`I’m Zhijing. You are weighing “${translateEnglish(m[1])}” against “${translateEnglish(m[2])}”. I will not choose for you; I will help connect the source quotes with your own situation.`],
  [/^(.+) · (针对这句话|针对这条回答) · 读者评论原话$/,m=>`${translateEnglish(m[1])} · ${translateEnglish(m[2])} · reader's exact words`],
  [/^(.+) · 读者评论原话 · 在 (.+) 的回答下$/,m=>`${translateEnglish(m[1])} · reader's exact words · under ${m[2]}'s answer`],
  [/^(被回应的原句|原文摘句|原文片段（非主张总结）)：(.+)$/,m=>`${translateEnglish(m[1])}: ${m[2]}`],
  [/^评论区有读者补了前提（(\d+) 条）$/,m=>`Readers added conditions in the comments (${m[1]})`],
  [/^评论区有读者当场不同意（(\d+) 条）$/,m=>`Readers challenged this in the comments (${m[1]})`],
  [/^选(.+)$/,m=>`Choose ${translateEnglish(m[1])}`],
  [/^你选的情况都落在「(.+)」这一边$/,m=>`Your selected situations all point toward “${m[1]}”`],
  [/^说明「(.+)」一侧的原话和你更相关，这不代表它就是答案，读者的反驳和另一边的理由同样要看。$/,m=>`The quotes supporting “${m[1]}” are more relevant to your situation. That does not make it the answer; objections and the other side still matter.`],
  [/^再看 (\d+) 个条件$/,m=>`View ${m[1]} more conditions`],
  [/^(.+) 赞 · 原站评论 (.+) · 本次取到 (\d+) 条$/,m=>`${m[1]} upvotes · ${m[2]} source comments · ${m[3]} sampled`],
  [/^看读者怎么说（(\d+) 条）$/,m=>`See reader responses (${m[1]})`],
  [/^示例数据 · 读了 (\d+) 条相关回答( · 评论区 (\d+) 条读者反驳或补充)? · 原话一字未改$/,m=>`Example data · Read ${m[1]} relevant answers${m[3]?` · ${m[3]} reader objections or added conditions`:''} · source quotes unchanged`],
  [/^示例 · (.+) 实时检索保存 · 读了 (\d+) 条相关回答( · 评论区 (\d+) 条读者反驳或补充)? · 原话一字未改$/,m=>`Saved live-search example · ${m[1]} · Read ${m[2]} relevant answers${m[4]?` · ${m[4]} reader objections or added conditions`:''} · source quotes unchanged`],
  [/^读了 (\d+) 条相关回答( · 评论区 (\d+) 条读者反驳或补充)? · 原话一字未改$/,m=>`Read ${m[1]} relevant answers${m[3]?` · ${m[3]} reader objections or added conditions`:''} · source quotes unchanged`],
  [/^这次结果不完整：(\d+) 条分析没完成，(\d+) 路检索失败。$/,m=>`This result is incomplete: ${m[1]} analyses unfinished and ${m[2]} searches failed.`],
  [/^原始回答与评论区 · (\d+) 条（(\d+) 条被读者反驳）$/,m=>`Source answers and comments · ${m[1]} (${m[2]} challenged by readers)`],
  [/^原始回答与评论区 · (\d+) 条$/,m=>`Source answers and comments · ${m[1]}`],
  [/^被读者反驳的 (\d+)$/,m=>`Challenged by readers ${m[1]}`],
  [/^全部相关回答 (\d+)$/,m=>`All relevant answers ${m[1]}`],
  [/^全部检索结果 (\d+)$/,m=>`All search results ${m[1]}`],
  [/^待完成分析 (\d+)$/,m=>`Incomplete analysis ${m[1]}`],
  [/^本次请求编号：(.+)$/,m=>`Request ID: ${m[1]}`],
  [/^上面的原话都来自这些回答。(?:被读者在评论区反驳或补充前提的排在前面（(人工标注|模型挑出)）。)?$/,m=>`All quotes above come from these answers.${m[1]?` Answers with reader objections or added conditions appear first (${m[1]==='人工标注'?'manually labeled':'model-selected'}).`:''}`],
  [/^原话下面挂的读者反驳，来自同一条回答的精选评论，由(人工标注|模型归类并复核投票)挑出，并展示评论原话供你判断。每条反驳全页只出现一次：标「针对这句话」的，是评论回应的原句与这句有重合；其余是针对整条回答，挂在这条回答第一次被引用的地方。有人反驳不代表反驳成立。$/,m=>`Reader objections shown under a quote come from selected comments on the same answer and were ${m[1]==='人工标注'?'manually labeled':'classified and cross-checked by the model'}. The exact comment is shown for your judgment. Each objection appears only once: “Targets this quote” means the comment overlaps the quoted sentence; otherwise it targets the full answer and appears at that answer’s first citation. An objection is not automatically valid.`],
  [/^(.+) (样本生成时间|检索时间)：(.+)。$/,m=>`${translateEnglish(m[1])} ${m[2]==='样本生成时间'?'Sample generated':'Searched'}: ${m[3]}.`],
  [/^知乎开放平台 zhihu_search 真实返回，(.+) 探针，(\d+) 条原始结果。$/,m=>`Returned by Zhihu Open Platform zhihu_search · ${m[1]} probe · ${m[2]} raw results.`],
  [/^「相关回答」按标题关键词筛选，可能漏选；另有 (\d+) 条在「全部检索结果」里。统计不代表知乎全量，每条最多取得 (\d+) 条精选评论。$/,m=>`“Relevant answers” are filtered by title keywords and may omit some items; ${m[1]} more appear under “All search results”. These statistics do not represent all of Zhihu, and at most ${m[2]} selected comments are retrieved per answer.`],
  [/^全部结果：(\d+) 条；取得评论：(\d+) 条；被反驳或补充前提：(\d+) 条；分析完成：(\d+) 条；未完成：(\d+) 条；无评论：(\d+) 条。$/,m=>`All results: ${m[1]}; with comments: ${m[2]}; challenged or qualified: ${m[3]}; analysis complete: ${m[4]}; incomplete: ${m[5]}; without comments: ${m[6]}.`],
  [/^删除「(.+)」$/,m=>`Delete “${m[1]}”`],
  [/^去掉「(.+)」$/,m=>`Remove “${m[1]}”`],
  [/^对话：「(.+)」$/,m=>`Conversation: “${m[1]}”`],
  [/^依据：(.+)$/,m=>`Basis: ${m[1]}`],
  [/^帮我梳理（已记下 (\d+) 条）$/,m=>`Help me review this (${m[1]} saved)`],
  [/^原话 (\d+)$/,m=>`Source quotes ${m[1]}`],
  [/^这次参考了你记住的 (\d+) 条情况。$/,m=>`This response used ${m[1]} saved details.`],
  [/^前提：(.+)$/,m=>`Assumption: ${m[1]}`],
  [/^原话里没有：(.+)$/,m=>`Not answered by the source quotes: ${m[1]}`],
  [/^我去知乎搜了「(.+)」。$/,m=>`I searched Zhihu for “${m[1]}”.`],
  [/^按你的 (\d+) 条情况，我在知乎找到 (\d+) 个处境和你相似的人：$/,m=>`Using ${m[1]} details from your situation, I found ${m[2]} people on Zhihu in similar circumstances:`],
  [/^我在已有回答和评论里找到 (\d+) 个处境和你相似的人：$/,m=>`I found ${m[1]} people in similar circumstances in the existing answers and comments:`],
  [/^检查了(.+) (\d+) 条内容：找到 (\d+) 条的评论区，其中 (\d+) 条有读者当场不同意或补了前提。$/,m=>`Checked ${translateEnglish(m[1])} (${m[2]} items): found comments for ${m[3]}, with direct objections or added conditions on ${m[4]}.`],
  [/^看看你最近收藏的 (\d+) 条内容，评论区有没有人当场不同意。$/,m=>`Review ${m[1]} recent favorites to see whether readers directly disagreed in the comments.`],
  [/^问知镜 · (.+)$/,m=>`Ask Zhijing · ${translateEnglish(m[1])}`],
  [/^(.+) · 知镜$/,m=>`${translateEnglish(m[1])} · Zhijing`],
  [/^检查了你最近发过的 (\d+) 条内容：找到 (\d+) 条的评论区，其中 (\d+) 条有读者当场不同意或补了前提。$/,m=>`Checked ${m[1]} recent posts: found comments for ${m[2]}, with reader objections or added conditions on ${m[3]}.`],
  [/^检查了最近收藏的 (\d+) 条内容：找到 (\d+) 条的评论区，其中 (\d+) 条有读者当场不同意或补了前提。$/,m=>`Checked ${m[1]} recent favorites: found comments for ${m[2]}, with reader objections or added conditions on ${m[3]}.`],
  [/^正在体检…（30–60 秒）$/,()=>`Checking… (30–60 seconds)`]
];

export function translateEnglish(value){
  if(typeof value!=='string')return value;
  if(EN_EXACT.has(value))return EN_EXACT.get(value);
  for(const [pattern,replace] of EN_PATTERNS){
    const match=value.match(pattern);
    if(match)return replace(match);
  }
  return value;
}

export function createI18n(storage=globalThis.localStorage){
  let language='zh';
  try{if(storage?.getItem('zhijing-language')==='en')language='en';}catch{}
  const text=value=>language==='en'?translateEnglish(value):value;
  const applyStatic=(root=globalThis.document)=>{
    if(!root)return;
    const copy=STATIC_COPY[language];
    root.documentElement.lang=language==='en'?'en':'zh-CN';
    root.title=copy.pageTitle;
    root.querySelector('meta[name="description"]')?.setAttribute('content',copy.pageDescription);
    for(const node of root.querySelectorAll('[data-i18n]'))node.textContent=copy[node.dataset.i18n]||node.textContent;
    for(const node of root.querySelectorAll('[data-i18n-placeholder]'))node.setAttribute('placeholder',copy[node.dataset.i18nPlaceholder]||node.getAttribute('placeholder'));
    for(const node of root.querySelectorAll('[data-i18n-aria]'))node.setAttribute('aria-label',copy[node.dataset.i18nAria]||node.getAttribute('aria-label'));
    for(const node of root.querySelectorAll('[data-i18n-alt]'))node.setAttribute('alt',copy[node.dataset.i18nAlt]||node.getAttribute('alt'));
    const toggle=root.getElementById('language-toggle');
    if(toggle){
      toggle.textContent=language==='en'?'EN / 中':'中 / EN';
      toggle.setAttribute('aria-label',language==='en'?'Switch to Chinese':'切换为英文');
      toggle.setAttribute('aria-pressed',String(language==='en'));
    }
  };
  return {
    get language(){return language;},
    text,
    applyStatic,
    toggle(){language=language==='zh'?'en':'zh';try{storage?.setItem('zhijing-language',language);}catch{}return language;}
  };
}
