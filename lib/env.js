import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

let envLoaded = false;

function loadEnv() {
  if (envLoaded) {
    return;
  }
  envLoaded = true;
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const envPath = path.resolve(__dirname, "../.env");
  if (!fs.existsSync(envPath)) {
    return;
  }
  let raw = null;
  try {
    raw = fs.readFileSync(envPath, "utf8");
  } catch (error) {
    console.warn(`[WARN] Unable to read .env file: ${error.message}`);
    return;
  }
  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .forEach((line) => {
      const equalsIndex = line.indexOf("=");
      if (equalsIndex === -1) {
        return;
      }
      const key = line.slice(0, equalsIndex).trim();
      if (!key) {
        return;
      }
      if (
        Object.prototype.hasOwnProperty.call(process.env, key) &&
        process.env[key]
      ) {
        return;
      }
      const value = line.slice(equalsIndex + 1).trim();
      const normalized = stripQuotes(value);
      if (normalized !== undefined) {
        process.env[key] = normalized;
      }
    });
}

function stripQuotes(value) {
  if (!value) {
    return "";
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function getGeminiApiKey() {
  loadEnv();
  const key = process.env.GEMINI_API_KEY;
  return key && key.trim() ? key.trim() : null;
}

function getDeepSeekApiKey() {
  loadEnv();
  const key = process.env.DEEPSEEK_API_KEY;
  return key && key.trim() ? key.trim() : null;
}

function getDeepSeekBaseUrl() {
  loadEnv();
  const value = process.env.DEEPSEEK_BASE_URL;
  return value && value.trim() ? value.trim() : "https://api.deepseek.com";
}

function getDeepSeekModel() {
  loadEnv();
  const value = process.env.DEEPSEEK_MODEL;
  return value && value.trim() ? value.trim() : "deepseek-v4-flash";
}

function getLlmProvider() {
  loadEnv();
  const value = process.env.LLM_PROVIDER;
  const normalized = value && value.trim() ? value.trim().toLowerCase() : "";
  if (normalized === "deepseek") {
    return "deepseek";
  }
  return "gemini";
}

export {
  getDeepSeekApiKey,
  getDeepSeekBaseUrl,
  getDeepSeekModel,
  getGeminiApiKey,
  getLlmProvider,
  loadEnv,
};
