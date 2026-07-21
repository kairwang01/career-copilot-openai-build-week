import React from 'react';

type IconMeta = {
  label: string;
  src?: string;
  mark?: string;
};

const ICONS: Record<string, IconMeta> = {
  chatgpt: {
    label: 'ChatGPT / OpenAI',
    src: '/llm-icons/chatgpt.svg',
  },
  gemini: {
    label: 'Gemini',
    src: '/llm-icons/gemini.svg',
  },
  deepseek: {
    label: 'DeepSeek',
    src: '/llm-icons/deepseek.svg',
  },
  claude: {
    label: 'Claude',
    src: '/llm-icons/claude.svg',
  },
  kimi: {
    label: 'Kimi',
    src: '/llm-icons/kimi.ico',
  },
  hunyuan: {
    label: 'Hunyuan / Tencent Hunyuan',
    src: '/llm-icons/hunyuan.svg',
  },
  custom: {
    label: 'Custom LLM',
    mark: 'AI',
  },
};

export const getLlmProviderIconMeta = (text: string): IconMeta => {
  const value = text.toLowerCase();
  if (/(chatgpt|openai|gpt[-_\s]?\d|gpt[-_\s]?4|gpt[-_\s]?5)/.test(value)) return ICONS.chatgpt;
  if (/(gemini|google)/.test(value)) return ICONS.gemini;
  if (/deepseek/.test(value)) return ICONS.deepseek;
  if (/(claude|anthropic)/.test(value)) return ICONS.claude;
  if (/(kimi|moonshot)/.test(value)) return ICONS.kimi;
  if (/(hunyuan|混元)/.test(value)) return ICONS.hunyuan;
  return ICONS.custom;
};

export const LlmProviderIcon: React.FC<{ text: string; className?: string }> = ({
  text,
  className = '',
}) => {
  const icon = getLlmProviderIconMeta(text);
  return (
    <span
      title={icon.label}
      aria-label={icon.label}
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded border border-gray-200 bg-white p-0.5 text-[9px] font-bold leading-none text-gray-600 ${className}`}
    >
      {icon.src ? (
        <img src={icon.src} alt="" className="h-full w-full object-contain" loading="lazy" />
      ) : (
        icon.mark
      )}
    </span>
  );
};
