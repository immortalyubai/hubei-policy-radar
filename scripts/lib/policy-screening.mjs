const POLICY_SIGNAL = /政策|办法|细则|指南|意见|措施|规划|条例|实施方案|行动方案|申报通知|征集通知|认定通知|项目通知|资金通知|奖励通知|补贴通知/;
const APPLICATION_SIGNAL = /申报|征集|认定|推荐|申领|兑付|揭榜|遴选|项目入库|报名/;
const EVENT_SIGNAL = /大赛|竞赛|赛事|挑战赛|路演|创新创业赛/;
const OPC_SIGNAL = /(?:^|[^A-Za-z])OPC(?:[^A-Za-z]|$)|一人公司|一人企业|一人创业|超级个体/i;
const SKIP_SIGNAL = /人事任免|采购公告|成交公告|招聘|考录|会议纪要|工作总结|专家公示|评审专家|论证专家|名单公示|验收结果|结果公示|党支部|党建|习近平|重要讲话|走访调研|主持召开|常委会|每日快讯|一周播报|科技人才|创新主体/;
const DATE_PATTERN = /(20\d{2})[年\-\/.](\d{1,2})[月\-\/.](\d{1,2})日?/;

export function normalizeText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\s\u200b-\u200d\ufeff]+/g, " ")
    .trim();
}

export function classifyPolicyItem(title, digest = "") {
  const value = `${normalizeText(title)} ${normalizeText(digest)}`;
  if (EVENT_SIGNAL.test(value)) return "event";
  if (APPLICATION_SIGNAL.test(value)) return "application";
  return "policy";
}

export function topicsFromText(title, digest = "") {
  const value = `${normalizeText(title)} ${normalizeText(digest)}`;
  const topics = [
    ["OPC", OPC_SIGNAL],
    ["人工智能", /人工智能|AI|大模型|机器人/i],
    ["科技企业", /科技型企业|高新技术企业|专精特新/],
    ["成果转化", /成果转化|产业化|中试/],
    ["人才计划", /人才|团队|留学人员/],
    ["惠企资金", /补贴|奖励|资助|资金|创新券|兑付/],
    ["科创赛事", EVENT_SIGNAL],
    ["智能制造", /智能制造|工业互联网|制造业/],
  ];
  return topics.filter(([, pattern]) => pattern.test(value)).map(([topic]) => topic).slice(0, 8);
}

export function deadlineFromText(value) {
  const snippets = normalizeText(value).match(/(?:截止|截至|报名时间|申报时间)[^。；;]{0,80}/g) ?? [];
  const dates = [];
  for (const snippet of snippets) {
    const range = snippet.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日?\s*[至到\-—－~～]\s*(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日?/);
    if (range) {
      dates.push(`${range[4] || range[1]}-${range[5].padStart(2, "0")}-${range[6].padStart(2, "0")}`);
    }
    for (const match of snippet.matchAll(new RegExp(DATE_PATTERN.source, "g"))) {
      dates.push(`${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`);
    }
  }
  return dates.sort().at(-1) ?? null;
}

export function documentNumberFromText(value) {
  const compact = normalizeText(value).replace(/\s+/g, "");
  const match = compact.match(/((?:鄂|武|汉|宜|襄|荆|黄|孝|咸|随|恩|十|仙|潜|天|国|工信部|科技部|财政部|人社部)[\u3400-\u9fff]{0,4}(?:发|规|办|函|令|字|通)[〔\[]20\d{2}[〕\]]\d{1,5}号)/);
  return match?.[1]?.replace("[", "〔").replace("]", "〕") ?? null;
}

export function screenPolicyArticle({ title, digest = "", publishedAt }) {
  const cleanTitle = normalizeText(title);
  const cleanDigest = normalizeText(digest);
  const value = `${cleanTitle} ${cleanDigest}`;
  const signals = [];

  if (SKIP_SIGNAL.test(cleanTitle)) {
    return {
      matched: false,
      score: 0,
      itemType: classifyPolicyItem(cleanTitle, cleanDigest),
      topics: [],
      deadlineAt: null,
      documentNumber: null,
      screeningReason: "命中公告噪声排除规则。",
    };
  }

  const hasPolicy = POLICY_SIGNAL.test(value);
  const hasApplication = APPLICATION_SIGNAL.test(value);
  const hasEvent = EVENT_SIGNAL.test(value);
  const hasOpc = OPC_SIGNAL.test(value);
  if (hasPolicy) signals.push("政策");
  if (hasApplication) signals.push("申报机会");
  if (hasEvent) signals.push("科创赛事");
  if (hasOpc) signals.push("OPC");

  if (signals.length === 0) {
    return {
      matched: false,
      score: 0,
      itemType: classifyPolicyItem(cleanTitle, cleanDigest),
      topics: [],
      deadlineAt: null,
      documentNumber: null,
      screeningReason: "未命中政策、申报、赛事或 OPC 粗筛关键词。",
    };
  }

  let score = 45;
  if (hasPolicy) score += 15;
  if (hasApplication) score += 20;
  if (hasEvent) score += 20;
  if (hasOpc) score += 30;
  if (/人工智能|大模型|机器人|智能制造|高新技术|专精特新|成果转化|创新券|人才/.test(value)) score += 12;
  if (/奖励|补贴|资助|资金|兑付|最高\d+万/.test(value)) score += 8;

  const publishedTime = Date.parse(String(publishedAt ?? ""));
  if (Number.isFinite(publishedTime)) {
    const ageDays = Math.floor((Date.now() - publishedTime) / 86_400_000);
    if (ageDays >= 0 && ageDays <= 7) score += 5;
    else if (ageDays >= 0 && ageDays <= 30) score += 2;
  }

  return {
    matched: true,
    score: Math.max(0, Math.min(score, 100)),
    itemType: classifyPolicyItem(cleanTitle, cleanDigest),
    topics: topicsFromText(cleanTitle, cleanDigest),
    deadlineAt: deadlineFromText(value),
    documentNumber: documentNumberFromText(value),
    screeningReason: `公众号白名单；命中${signals.join("、")}；等待政府官网同源信息核验。`,
  };
}
