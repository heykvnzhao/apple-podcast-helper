import {
  getDeepSeekApiKey,
  getDeepSeekBaseUrl,
  getDeepSeekModel,
  getGeminiApiKey,
  getLlmProvider,
} from "../env.js";

const GEMINI_DEFAULT_MODEL_ID = "gemini-2.5-flash-lite";

function getSummaryProviderConfig() {
  const providerId = getLlmProvider();
  if (providerId === "deepseek") {
    return {
      apiKey: getDeepSeekApiKey(),
      baseUrl: getDeepSeekBaseUrl(),
      displayName: "DeepSeek",
      modelId: getDeepSeekModel(),
      providerId: "deepseek",
    };
  }
  return {
    apiKey: getGeminiApiKey(),
    baseUrl: null,
    displayName: "Gemini",
    modelId: GEMINI_DEFAULT_MODEL_ID,
    providerId: "gemini",
  };
}

function getSummaryProviderDisplayName() {
  return getSummaryProviderConfig().displayName;
}

export {
  GEMINI_DEFAULT_MODEL_ID,
  getSummaryProviderConfig,
  getSummaryProviderDisplayName,
};
