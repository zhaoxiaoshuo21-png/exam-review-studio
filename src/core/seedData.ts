import type {
  AppStateSnapshot,
  FolderNode,
  MasteryLevel,
  QuestionItem,
} from '../types/schema';

const DAY_MS = 24 * 60 * 60 * 1000;
const MASTERED_INTERVAL_DAYS = [7, 15, 30] as const;

/**
 * 计算下一次复习到期时间戳（毫秒）：
 * - 生疏（unfamiliar）：+1 天
 * - 模糊（vague）：+3 天
 * - 已掌握（mastered）：按 7 / 15 / 30 天递增
 */
export function computeNextReviewAt(
  mastery: MasteryLevel,
  prevReviewCount: number,
  now: number = Date.now(),
): number {
  if (mastery === 'unfamiliar') {
    return now + 1 * DAY_MS;
  }
  if (mastery === 'vague') {
    return now + 3 * DAY_MS;
  }
  const safeCount = Number.isFinite(prevReviewCount)
    ? Math.max(0, Math.floor(prevReviewCount))
    : 0;
  const idx = Math.min(safeCount, MASTERED_INTERVAL_DAYS.length - 1);
  return now + MASTERED_INTERVAL_DAYS[idx] * DAY_MS;
}

/**
 * 返回指定目录自身及其所有未删除子孙目录的 id 列表（防环安全遍历）。
 */
export function getDescendantFolderIds(
  folders: FolderNode[],
  folderId: string,
): string[] {
  if (!folderId) return [];

  const folderById = new Map<string, FolderNode>();
  const childrenMap = new Map<string, string[]>();

  for (const folder of folders) {
    folderById.set(folder.id, folder);
    if (!folder.deletedAt && folder.parentId) {
      const siblings = childrenMap.get(folder.parentId) ?? [];
      siblings.push(folder.id);
      childrenMap.set(folder.parentId, siblings);
    }
  }

  const root = folderById.get(folderId);
  if (!root || root.deletedAt) {
    return [];
  }

  const result: string[] = [];
  const visited = new Set<string>();
  const queue: string[] = [folderId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    result.push(currentId);

    const children = childrenMap.get(currentId);
    if (children) {
      for (const childId of children) {
        if (!visited.has(childId)) {
          queue.push(childId);
        }
      }
    }
  }

  return result;
}

function utf8ToBase64(input: string): string {
  if (typeof TextEncoder !== 'undefined' && typeof btoa === 'function') {
    const bytes = new TextEncoder().encode(input);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  if (typeof btoa === 'function') {
    return btoa(unescape(encodeURIComponent(input)));
  }
  throw new Error('Current runtime does not support Base64 encoding');
}

/**
 * 构造 880×440 专业公考真题卷面风 SVG：
 * 纯净白底纸感卡片 + 1×4 等宽题干格（图1-图4问号格）+ 1×4 等宽选项格（A/B/C/D），
 * 展示不同单对称轴图形依次顺时针旋转 45° 的经典规律。
 */
function buildGraphicSymmetrySvgDataUrl(): string {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="880" height="440" viewBox="0 0 880 440">',
    '<rect x="1" y="1" width="878" height="438" rx="12" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="1.5"/>',
    '<text x="440" y="30" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="500" fill="#64748B">观察前三个图形的唯一对称轴方向变化规律，选择最合适的一项填入问号处</text>',
    // 第一排：1×4 等宽题干格（每格宽 185，间距 20）
    '<g stroke="#CBD5E1" stroke-width="1.4" fill="#FAFBFC">',
    '  <rect x="40" y="48" width="185" height="158" rx="10"/>',
    '  <rect x="245" y="48" width="185" height="158" rx="10"/>',
    '  <rect x="450" y="48" width="185" height="158" rx="10"/>',
    '  <rect x="655" y="48" width="185" height="158" rx="10" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="1.5" stroke-dasharray="5 4"/>',
    '</g>',
    '<g font-family="sans-serif" font-size="12.5" font-weight="600" fill="#64748B">',
    '  <text x="54" y="69">图 1</text>',
    '  <text x="259" y="69">图 2</text>',
    '  <text x="464" y="69">图 3</text>',
    '  <text x="669" y="69">图 4</text>',
    '</g>',
    // 图 1：竖直对称轴（0°）：等腰三角形 + 竖直中线
    '<g transform="translate(132.5 134)" stroke="#1E293B" stroke-width="2.4" fill="none" stroke-linejoin="round" stroke-linecap="round">',
    '  <polygon points="0,-36 32,30 -32,30" fill="#EEF2F6"/>',
    '  <line x1="0" y1="-36" x2="0" y2="30"/>',
    '  <line x1="0" y1="-46" x2="0" y2="42" stroke="#E57373" stroke-width="1.5" stroke-dasharray="4 4"/>',
    '</g>',
    // 图 2：顺时针 45° 对称轴（/）：等腰梯形叠加小圆
    '<g transform="translate(337.5 134) rotate(45)" stroke="#1E293B" stroke-width="2.4" fill="none" stroke-linejoin="round" stroke-linecap="round">',
    '  <polygon points="-17,-32 17,-32 32,28 -32,28" fill="#EEF2F6"/>',
    '  <circle cx="0" cy="-6" r="7.5" fill="#FFFFFF"/>',
    '  <line x1="0" y1="-46" x2="0" y2="42" stroke="#E57373" stroke-width="1.5" stroke-dasharray="4 4"/>',
    '</g>',
    // 图 3：顺时针 90° 对称轴（-）：五边形房子
    '<g transform="translate(542.5 134) rotate(90)" stroke="#1E293B" stroke-width="2.4" fill="none" stroke-linejoin="round" stroke-linecap="round">',
    '  <polygon points="0,-36 28,-8 20,30 -20,30 -28,-8" fill="#EEF2F6"/>',
    '  <rect x="-9" y="4" width="18" height="14" fill="#FFFFFF"/>',
    '  <line x1="0" y1="-46" x2="0" y2="42" stroke="#E57373" stroke-width="1.5" stroke-dasharray="4 4"/>',
    '</g>',
    // 图 4：克制优雅的问号
    '<text x="747.5" y="148" text-anchor="middle" font-family="sans-serif" font-size="42" font-weight="600" fill="#475569">?</text>',
    // 分割线
    '<line x1="40" y1="226" x2="840" y2="226" stroke="#F1F5F9" stroke-width="1.5"/>',
    // 第二排：1×4 等宽选项格 A B C D
    '<g stroke="#CBD5E1" stroke-width="1.4" fill="#FFFFFF">',
    '  <rect x="40" y="246" width="185" height="158" rx="10"/>',
    '  <rect x="245" y="246" width="185" height="158" rx="10"/>',
    '  <rect x="450" y="246" width="185" height="158" rx="10"/>',
    '  <rect x="655" y="246" width="185" height="158" rx="10"/>',
    '</g>',
    '<g font-family="sans-serif" font-size="13.5" font-weight="600" fill="#334155">',
    '  <text x="54" y="268">A</text>',
    '  <text x="259" y="268">B</text>',
    '  <text x="464" y="268">C</text>',
    '  <text x="669" y="268">D</text>',
    '</g>',
    // 选项 A：竖直对称轴（|）T 形
    '<g transform="translate(132.5 332)" stroke="#1E293B" stroke-width="2.4" fill="#EEF2F6" stroke-linejoin="round" stroke-linecap="round">',
    '  <path d="M-28,-24 H28 V-9 H8 V26 H-8 V-9 H-28 Z"/>',
    '</g>',
    // 选项 B：45° / 对称轴箭头
    '<g transform="translate(337.5 332) rotate(45)" stroke="#1E293B" stroke-width="2.4" fill="#EEF2F6" stroke-linejoin="round" stroke-linecap="round">',
    '  <polygon points="0,-30 22,-3 9,-3 9,26 -9,26 -9,-3 -22,-3"/>',
    '</g>',
    // 选项 C（正确项）：135° \ 对称轴盾牌
    '<g transform="translate(542.5 332) rotate(135)" stroke="#1E293B" stroke-width="2.4" fill="#EEF2F6" stroke-linejoin="round" stroke-linecap="round">',
    '  <path d="M0,-30 L26,-7 L17,26 L-17,26 L-26,-7 Z"/>',
    '  <circle cx="0" cy="4" r="6.5" fill="#FFFFFF"/>',
    '</g>',
    // 选项 D：平行四边形（中心对称，0 条对称轴）
    '<g transform="translate(747.5 332)" stroke="#1E293B" stroke-width="2.4" fill="#EEF2F6" stroke-linejoin="round" stroke-linecap="round">',
    '  <polygon points="-15,-22 32,-22 15,22 -32,22"/>',
    '</g>',
    '</svg>',
  ].join('');

  return `data:image/svg+xml;base64,${utf8ToBase64(svg)}`;
}

/**
 * 创建首次使用的初始化全量快照：
 * 包含公考嵌套题型目录树与 2 道带完整 AI 复盘结构的示范题（isSeedDemo: true）。
 */
export function createSeedSnapshot(): AppStateSnapshot {
  const now = Date.now();

  const folders: FolderNode[] = [
    {
      id: 'folder-politics',
      name: '政治理论',
      parentId: null,
      chainTip:
        '先抓会议/文件定调与“着力点/根本/关键”限定词，再辨析手段与目标，排除绝对化或主体错位项。',
      order: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'folder-logic',
      name: '判断推理',
      parentId: null,
      chainTip:
        '先判题型再套口诀：图推先属性后数量，类比先一级逻辑后二级辨析，逻辑先翻译再削弱加强。',
      order: 2,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'folder-logic-graphic',
      name: '图形推理',
      parentId: 'folder-logic',
      chainTip:
        '元素组成不同先看属性（对称轴方向/数量/过点线面、曲直、开闭），再看面线点素及一笔画。',
      order: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'folder-logic-analogy',
      name: '类比推理',
      parentId: 'folder-logic',
      chainTip:
        '先造句定一级关系（并列/包容/交叉/对应/条件），再看词性、感情色彩、必然或然做二级筛选。',
      order: 2,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'folder-logic-deduction',
      name: '逻辑判断',
      parentId: 'folder-logic',
      chainTip:
        '翻译推理牢记“前推后/后推前/逆否等价”；论证先锁定论点与论据，优先搭桥或直接否定论点。',
      order: 3,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'folder-verbal',
      name: '言语理解',
      parentId: null,
      chainTip:
        '中心理解看行文脉络与强转折/对策句；逻辑填空先找上下文对应提示，再比照语义轻重与固定搭配。',
      order: 3,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'folder-data',
      name: '资料分析',
      parentId: null,
      chainTip:
        '先审问题定时间、主体与公式（基期/增长率/两期比重），结合选项首位差异选择截位直除或百化分。',
      order: 4,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'folder-quant',
      name: '数量关系',
      parentId: null,
      chainTip:
        '考场先挑工程、容斥、利润、牛吃草与极值题，善用代入排除法、整除特性与赋值法秒杀。',
      order: 5,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'folder-common',
      name: '常识判断',
      parentId: null,
      chainTip:
        '紧扣最新时政热点、高频法律修改点与科技生活原理，利用“绝对词多错、相对词多对”交叉排除。',
      order: 6,
      createdAt: now,
      updatedAt: now,
    },
  ];

  const q1Analysis = [
    '一、【底层核心概念（说人话）】',
    '这道题考的是二十大报告第四部分“加快构建新发展格局，着力推动高质量发展”里的 **模块精准归类**。报告把高质量发展拆成五个并列子板块：**①市场经济体制**、**②现代化产业体系**、**③乡村振兴**、**④区域协调发展**、**⑤高水平对外开放**。命题人最爱的套路，就是把“市场体制”或“对外开放”的话混进“产业体系”里鱼目混珠。',
    '',
    '二、【考场第一反应（应该怎么想）】',
    '看到题干问 **“下列属于建设现代化产业体系的是”**，脑子里立刻只抓两个判定锚点：**实体产业主体**（工业、制造业、服务业、供应链、数字产业）和 **产业基础设施**；凡是讲“制度规则、市场准入、统一大市场、开放标准”的，全部踢出去！',
    '> 建设现代化产业体系：支持专精特新企业发展；实施产业基础再造工程和重大技术装备攻关工程；构建优质高效的服务业新体系。',
    '1. **① 支持专精特新企业发展** → 专精特新面向制造业中小企业，妥妥属于 **产业体系**；',
    '2. **② 构建全国统一大市场，深化要素市场化改革** → 关键词是“市场”和“改革”，属于 **构建高水平社会主义市场经济体制**（排除）；',
    '3. **③ 稳步扩大制度型开放** → 关键词是“开放”，属于 **推进高水平对外开放**（排除）。',
    '',
    '三、【实战解题与选项拆解】',
    '- **A. ①④⑤（正确项）**：==唯一正解==。三项均出自二十大报告“建设现代化产业体系”原文，分别对应 **微观企业主体（①）**、**核心技术与装备底座（④）** 和 **服务业新体系（⑤）**。',
    '  - 记忆锚点：产业体系 = 企业（专精特新）+ 硬件攻关（基础再造/重大装备）+ 业态融合（现代服务业）。',
    '- **B. ②③⑤（高频错选）**：典型“望文生义跨板块混搭”陷阱。',
    '  - 误以为“全国统一大市场”“要素市场化”直接等于产业体系；实则 ==体制制度类表述归“市场经济体制”==，==规则标准开放归“对外开放”==，不能划入产业体系。',
    '- **C. ①②③④ / D. ②③④⑤（全含类干扰）**：只要用排除法毙掉 **②** 或 **③** 中的任意一个，B、C、D 瞬间同步出局。',
  ].join('\n');

  const q2Analysis = [
    '一、【底层核心概念（说人话）】',
    '图形推理只要出现 **图形各不相同、但每个图都长得比较规整**，第一秒不要去数面、数笔画，先在脑海里给每个图形 **画一条对称轴**！对称性是近五年国考、省考图推的绝对第一高频考点。',
    '',
    '二、【考场第一反应（应该怎么想）】',
    '观察第一排前三个图形的共同属性：',
    '1. 图 1（带中线的等腰三角形）：只有 **1 条竖直对称轴**（`0°` 方向 `|`）；',
    '2. 图 2（带小圆的等腰梯形）：只有 **1 条斜向右上对称轴**（顺时针旋转 `45°`，`/` 方向）；',
    '3. 图 3（带矩形窗的五边形）：只有 **1 条水平对称轴**（再顺时针旋转 `45°`，`-` 方向）；',
    '4. 推理图 4（？）：对称轴应继续 **顺时针旋转 `45°`**，即指向 **右下斜向 `135°`（`\\` 方向）**，且必须仍是轴对称图形。',
    '',
    '三、【实战解题与选项拆解】',
    '- **A 项（排除）**：T 字形有 1 条竖直对称轴（`|` 方向），与图 1 方向相同，不符合旋转规律。',
    '- **B 项（排除）**：箭头图形有 1 条斜向右上对称轴（`/` 方向），与图 2 方向重复（若按逆时针才可能误选此项）。',
    '- **C 项（正确项）**：==唯一符合规律==！盾形叠加圆点拥有 1 条清晰的 `\\` 方向对称轴（顺时针 `135°`），完美衔接 `| -> / -> - -> \\` 周期旋转。',
    '- **D 项（高频坑点）**：平行四边形是 **中心对称图形**，==有 0 条对称轴==！考场切忌把平行四边形误认成斜轴对称图形。',
  ].join('\n');

  const questions: QuestionItem[] = [
    {
      id: 'seed-q-1',
      folderId: 'folder-politics',
      questionType: 'mistake',
      title: '党的二十大报告：建设现代化产业体系',
      stemText: [
        '党的二十大报告：“高质量发展是全面建设社会主义现代化国家的首要任务。发展是党执政兴国的第一要务。下列属于建设现代化产业体系的是（　）。”',
        '①支持专精特新企业发展',
        '②构建全国统一大市场，深化要素市场化改革',
        '③稳步扩大规则、规制、管理、标准等制度型开放',
        '④实施产业基础再造工程和重大技术装备攻关工程',
        '⑤构建优质高效的服务业新体系',
        '',
        'A. ①④⑤',
        'B. ②③⑤',
        'C. ①②③④',
        'D. ②③④⑤',
      ].join('\n'),
      images: [],
      myWrongChoice: 'B',
      correctAnswer: 'A',
      analysisMarkdown: q1Analysis,
      personalNote:
        '区分“现代化产业体系”与“高水平市场经济体制 / 对外开放”：专精特新、基础再造、服务业体系选①④⑤，体制与制度型开放直接排除！',
      tags: ['二十大报告', '现代化产业体系', '政治理论', '模块归类'],
      mastery: 'unfamiliar',
      starred: true,
      reviewCount: 0,
      nextReviewAt: now - 2 * 60 * 60 * 1000,
      isSeedDemo: true,
      createdAt: now - 2000,
      updatedAt: now - 2000,
    },
    {
      id: 'seed-q-2',
      folderId: 'folder-logic-graphic',
      questionType: 'gem',
      title: '图形推理母题：1×4 序列对称轴顺时针旋转 45°',
      stemText: [
        '从所给的四个选项中，选择最合适的一个填入问号处，使之呈现一定的规律性：',
        '图 1 至图 3 元素组成各不相同但均规整对称，请优先判断唯一对称轴方向变化规律。',
      ].join('\n'),
      images: [
        {
          id: 'seed-img-graphic-1',
          dataUrl: buildGraphicSymmetrySvgDataUrl(),
          width: 880,
          height: 440,
          caption: '1×4 序列对称轴顺时针旋转 45° 示意图',
        },
      ],
      correctAnswer: 'C',
      analysisMarkdown: q2Analysis,
      personalNote:
        '图形长相不同但规整 -> 秒画对称轴！注意区分中心对称图形（如平行四边形无对称轴）。',
      tags: ['图形推理', '对称轴旋转', '母题', '防坑'],
      mastery: 'vague',
      starred: true,
      reviewCount: 1,
      lastReviewedAt: now - 2 * DAY_MS,
      nextReviewAt: now - 1 * 60 * 60 * 1000,
      isSeedDemo: true,
      createdAt: now - 1000,
      updatedAt: now - 1000,
    },
  ];

  return {
    version: 1,
    exportedAt: now,
    theme: 'dark',
    reviewMode: 'self_test',
    folders,
    questions,
  };
}
