// 占位说明文件的唯一权威定义。
// 新建的编号目录此刻是空壳（资源 24 小时内才转存进来），先预置说明文件告诉看官「先转存 / 缺失怎么反馈 / 站点在哪」。
// 2026-11-08 从一份变两份（更新通知 + QQ 群缺失反馈），同日再加第三份（站点导流）；
// 第三份当天改名过，铺下去的那个旧名删不掉 → 以 aliases 永久保留等价（见 PLACEHOLDER_FILES 注释）。
//
// ⚠ 三份都必须以 .md 结尾：placeholder-fill 的 hasResource 与站点 fill-files 都按「非 .md 条目」判定真实资源，
//   少了扩展名会被当成资源文件——目录被误判为「已有资源」而永不补占位，还会被写进 files: 假清单。
//
// 消费方（改这里就够，别再各自抄字符串）：
//   · trending-sync.mjs    —— 夸克建目录后、百度镜像目录后，各上传整组
//   · placeholder-fill.mjs —— 兜底补齐夸克存量目录（缺哪份补哪份，可 --only 限定）
//   · mirror-baidu.mjs     —— 兜底补齐百度存量目录（--fill-placeholders）
//   · baidu-share-links.mjs—— 识别「这目录只有占位、不是资源」
//
// ⚠ 站点仓库 tools/fill-files.mjs 里还有一份同义正则
//   （PLACEHOLDER_FILE_RE：剔除占位与上传桩、只在「盘端只剩占位」时整条跳过）。它在另一个仓库、无法 import 本模块，
//   新增/改名占位文件、或新增后缀规则时必须同步改它，否则占位 md 会被当成真实资源写进 files: 假清单（AGENTS.md §5 红线）。
export const PLACEHOLDER_FILES = [
  {
    name: '资源在24小时内更新-请先转存-更新会自动通知.md',
    // 2026-11-08 晚改条件句：这一份现在也要铺进已有正片的目录，无条件句在那儿就是假话。
    // ⚠ 网盘无法改已上传文件的内容（同名上传只会生成 `(1)` 副本），所以此前已写入的约 28 份
    //   仍是旧文案「资源空白，会在24小时内补齐。」，只能在客户端手动删除后由本流程重铺。
    text: '1、看官请先转存本资源。\n2、目录若暂时空白，资源会在24小时内补齐。',
    forFilledDirs: true,
  },
  {
    name: '资源缺失反馈请加QQ群1045824859.md',
    text: '资源缺失或失效请加QQ群反馈：1045824859',
    forFilledDirs: true,
  },
  {
    // 站点导流：与前两份性质不同——前两份是「资源还没到」的交代，只该出现在空壳目录；
    // 这份与资源是否缺失无关，放进已有正片的目录照样有价值，故标 forFilledDirs: true。
    name: '关于我的网盘索引站.md',
    text: [
      '我的网盘索引站｜https://www.wodewangpan.top',
      '',
      '这里的资源在站上有更完整的整理：按电影、电视剧、动漫、纪录片等分类，配海报、简介与可直接转存的链接，每天更新，支持关键词搜索。',
      '想挑片、查更新，或发现某个目录缺内容，都可以到站上说一声。',
    ].join('\n'),
    forFilledDirs: true,
    /**
     * 等价旧名。2026-11-08 这一份当天改名两次：
     *   ① `我的网盘网址www.wodewangpan.top.md` —— 在改名前已铺进 **643 个夸克目录**，
     *      而夸克 CLI 没有删除命令，删不掉 → 必须永久保留为等价名；
     *   ② `www.wodewangpan.top索引网站每天更新资源.md` —— 实测**一份都没落过盘**
     *      （search 唯一命中是个无关 mp3），已废弃，不进 aliases，也不进识别表。
     * ① 的两个作用缺一不可：missingPlaceholders 认它 = 已满足，不会再往同一目录塞第二份导流说明；
     * PLACEHOLDER_PREFIXES 认它 = 占位不是资源，否则 fill-files 会把那 643 份当真实资源批量写进 files: 假清单。
     * 别把这条 alias 当历史垃圾删掉 —— 那等于给 643 个目录批量造假数据。
     */
    aliases: ['我的网盘网址www.wodewangpan.top.md'],
  },
];

export const PLACEHOLDER_NAMES = PLACEHOLDER_FILES.map((f) => f.name);

/** 所有可接受的名字（正式名 + 等价旧名），供识别与「是否已满足」判定共用 */
export const ALL_PLACEHOLDER_ACCEPTED_NAMES = PLACEHOLDER_FILES.flatMap((f) => [f.name, ...(f.aliases || [])]);

/**
 * 允许出现在「已有真实资源」目录里的那几份。
 * 2026-11-08 晚将军定夺「所有资源目录都放这三份」，三份现在都标了 forFilledDirs。
 * 这层机制的**默认值**仍然是「不进正片目录」（没带该标记的新增占位照样安全），
 * 只是本流程这三份都主动 opt-in 了 —— 别把它当成仍在保护道歉类说明的保险。
 */
export const placeholdersForFilledDirs = (files = PLACEHOLDER_FILES) => files.filter((f) => f.forFilledDirs);

/**
 * 识别用前缀表：命中即视为占位说明（工作流或人工自产），不属于资源内容。
 * 前缀足够独特（不会撞上任何片名），所以按前缀匹配比按全名匹配稳，也不需转义。
 */
export const PLACEHOLDER_PREFIXES = [
  '资源在24小时内更新', // = PLACEHOLDER_FILES[0]
  '资源缺失反馈请加QQ群', // = PLACEHOLDER_FILES[1]
  '关于我的网盘索引站', // = PLACEHOLDER_FILES[2]（站点导流，现用名）
  '我的网盘网址', // = PLACEHOLDER_FILES[2] 的等价旧名，已铺进 643 个目录，永久保留识别
  '资源正在陆续更新上传中', // 历史/人工遗留，本流程不创建，只在判定时剔掉（2026-11-08 见于 04电影/005-山竹刀）
];

/**
 * 后缀识别表：NAS 播放器的**片头/片尾标识文件**（`.op` = opening、`.ed` = ending，2026-11-10 将军定性）。
 * 紧贴正片名生成，三种形态：`.正片名.mkv.fg`、`.正片名.mkv.fg.op`、`.正片名.mkv.fg.ed`，
 * 实测每个约 100~140 KB（例：`.marvels.agent.carter.s01e07.SNAFU.1080p.bluray.x264-rovers.mkv.fg.op`）。
 * 是播放器附属产物，不是资源内容，因此**一律不进站点文件清单**。
 * 必须排除的两个理由：
 *   ① 混进聚合会虚增 `count`，并把扩展名分布统计成根本不存在的 `OP×N`（实测污染 10 条电视剧清单）；
 *   ② 更坏的是把「只铺了片头片尾标记、正片还没转存」误读成「资源已到位」。
 * 这类文件名字以 `.` 开头，按行首前缀永远匹配不上，只能按后缀认。
 * ⚠ 只列这三种、不用通配 `\.fg.*`：将来播放器若另生 `.fg.xxx`（如字幕标记），通配会连有价值的附属信息一起误剔；
 *   新增形态请在此追加一条，并同步站点仓库的正则。
 * ⚠ 站点仓库 scripts/fill-files.mjs 的 PLACEHOLDER_FILE_RE 有同一支（`\.fg(?:\.ed|\.op)?$`），改这里必须同步改那边。
 */
export const PLACEHOLDER_SUFFIXES = ['fg.ed', 'fg.op', 'fg'];

export const PLACEHOLDER_RE = new RegExp(
  // 前缀按行首锚定；后缀表里的点要转义，否则 `fg.ed` 会连 `fgXed` 这种名字一起认掉
  '^(' + PLACEHOLDER_PREFIXES.join('|') + ')|\\.(?:' + PLACEHOLDER_SUFFIXES.map((s) => s.replace(/\./g, '\\.')).join('|') + ')$',
  'i'
);

export const isPlaceholderName = (name) => PLACEHOLDER_RE.test(String(name || ''));

/**
 * 允许 CLI 覆盖旧口径：--placeholder-name / --placeholder-text 只改写**第一份**（更新通知），
 * QQ 反馈份保持内置，避免传了单个名字就把第二份悄悄丢掉。
 */
export function resolvePlaceholders(name, text) {
  return PLACEHOLDER_FILES.map((f, i) => (i === 0 ? { name: name || f.name, text: text || f.text } : { ...f }));
}

/**
 * 给定目录内的文件名清单，返回其中**缺失**的占位文件（幂等补齐的核心判定；顺序保持传入顺序）。
 * files 默认全量；调用方若用 CLI 覆盖了文件名、或只想补其中一份，必须把自己那份清单传进来，
 * 否则「判定缺失」用的名字和「实际上传」用的名字会脱节。
 * 带 aliases 的那份：目录里存在**任一**等价旧名即视为已满足，不再重复上传（夸克删不掉，宁留旧名不加新名）。
 */
export function missingPlaceholders(presentNames, files = PLACEHOLDER_FILES) {
  const set = new Set((presentNames || []).map((n) => String(n)));
  return files.filter((f) => !set.has(f.name) && !(f.aliases || []).some((a) => set.has(a)));
}

/** 给定目录内的文件名清单，是否已具备清单里的**全部**占位文件 */
export function hasAllPlaceholders(presentNames, files = PLACEHOLDER_FILES) {
  return missingPlaceholders(presentNames, files).length === 0;
}
