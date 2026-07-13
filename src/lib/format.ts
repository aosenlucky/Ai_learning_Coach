import type { AbilityKey, SourceType } from '../types';

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  book: '书籍',
  meeting: '会议',
  article: '文章',
  'video-course': '视频课程',
  'technical-doc': '技术文档',
  'client-proposal': '客户方案',
};

export const ABILITY_LABEL: Record<AbilityKey, string> = {
  concept: '概念',
  logic: '逻辑',
  application: '应用',
  critical: '批判',
  expression: '表达',
};

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function toPercent(value: number): string {
  return `${Math.round(value)}%`;
}
