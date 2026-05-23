import type { ChatMessage, OutlineItem } from '../types';

export interface BuildChapterContentMessagesInput {
  chapter: OutlineItem;
  parentChapters?: OutlineItem[];
  siblingChapters?: OutlineItem[];
  projectOverview?: string;
}

function formatChapterPath(chapter: OutlineItem, parents: OutlineItem[]) {
  return [...parents.map((item) => `${item.id} ${item.title}`), `${chapter.id} ${chapter.title}`].join(' > ');
}

function formatSiblingTitles(siblings?: OutlineItem[]) {
  if (!siblings?.length) {
    return '无';
  }

  return siblings.map((item) => `${item.id} ${item.title}`).join('；');
}

export function buildChapterContentMessages({
  chapter,
  parentChapters,
  siblingChapters,
  projectOverview,
}: BuildChapterContentMessagesInput): ChatMessage[] {
  const chapterPath = formatChapterPath(chapter, parentChapters || []);
  const chapterDescription = chapter.description?.trim() || '无';
  const overview = projectOverview?.trim() || '无';

  return [
    {
      role: 'system',
      content: `你是资深标书技术方案撰写专家，请根据输入信息生成“单个小节”的高质量正文。

通用要求：
1. 只输出 Markdown 正文，不输出解释、前言或结尾提示。
2. 语言专业、正式，句式清晰，避免空话。
3. 必须紧贴当前小节主题，不要串写到其他章节。
4. 如果信息不足，优先给出可执行的通用做法并明确假设，不要编造具体事实。
5. 可按需要使用二级/三级标题、列表、表格。`,
    },
    {
      role: 'user',
      content: `项目概述（可含知识库补充）：\n${overview}`,
    },
    {
      role: 'user',
      content: `当前生成小节：\n- 章节路径：${chapterPath}\n- 章节描述：${chapterDescription}\n- 同级章节（避免重复）：${formatSiblingTitles(siblingChapters)}`,
    },
    {
      role: 'user',
      content: '请输出该小节完整正文，长度建议 400~1200 字，必要时可包含表格。',
    },
  ];
}
