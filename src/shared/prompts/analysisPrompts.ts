import type { AnalysisType, ChatMessage } from '../types';

export interface BuildAnalysisMessagesInput {
  fileContent: string;
  analysisType: AnalysisType;
}

export function buildAnalysisMessages({ fileContent, analysisType }: BuildAnalysisMessagesInput): ChatMessage[] {
  const systemPrompt = `你是一名专业的招标文件分析助手。请严格基于用户提供的招标文件原文完成分析任务。

通用要求：
1. 保持信息全面、准确，尽量使用原文内容，不要自行编造。
2. 只输出最终分析结果，不要输出过程、提示语或客套话。
3. 如果原文不足以支持某项结论，明确写“原文未提及”。`;

  const taskPrompt = analysisType === 'overview'
    ? `任务：提取并总结项目概述信息。

请重点关注：
1. 项目名称和基本信息
2. 项目背景和目的
3. 项目规模和预算
4. 项目时间安排
5. 项目实施内容
6. 主要技术特点
7. 其他关键要求

要求：只关注与项目实施有关的内容，不提取商务信息。直接返回整理后的项目概述。`
    : `任务：提取技术评分要求。

重点识别“技术评分”“评标方法”“评分标准”“技术参数”“技术要求”“技术方案”“技术部分”等相关章节，不要提取商务、价格、资质等无关条目。

每一项尽量按以下格式输出：
【评分项名称】：原文描述
【权重/分值】：具体分值或占比
【评分标准】：详细规则
【数据来源】：章节、条款或表格位置

若信息缺失，标注“未提及”。直接返回提取结果。`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `以下是完整招标文件全文，请先完整阅读，并仅基于原文完成后续任务：\n\n${fileContent}` },
    { role: 'user', content: taskPrompt },
  ];
}
