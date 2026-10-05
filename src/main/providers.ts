import type { ProviderInfo } from "@shared/types";

/**
 * 设置页展示的 provider 元信息。
 * id 与 pi 模型目录的 provider 标识一致；vision 表示该 provider
 * 主流模型普遍支持图像输入（赛题视觉核验需要）。
 */
export const PROVIDERS: ProviderInfo[] = [
  { id: "zai", label: "智谱 GLM（Z.ai）", vision: true },
  { id: "anthropic", label: "Anthropic Claude", vision: true },
  { id: "openai", label: "OpenAI GPT", vision: true },
  { id: "google", label: "Google Gemini", vision: true },
  { id: "deepseek", label: "DeepSeek", vision: false },
  { id: "moonshotai", label: "Moonshot Kimi", vision: true },
  { id: "qwen-token-plan", label: "通义千问 Qwen", vision: true },
  { id: "xai", label: "xAI Grok", vision: true },
  { id: "openrouter", label: "OpenRouter（聚合）", vision: true },
];
