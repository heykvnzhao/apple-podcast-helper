import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import wrapAnsi from "wrap-ansi";

const DEFAULT_TERMINAL_WIDTH = 100;
let markedConfigured = false;
let lastPrintedLines = 0;
let lastRawSummary = null;
let resizeHandlerInstalled = false;

function ensureMarkedConfigured() {
  if (markedConfigured) {
    return;
  }
  const configuredWidth = 10000;
  marked.use(
    markedTerminal({
      reflowText: false,
      showSectionPrefix: false,
      tab: 2,
      width: configuredWidth,
    })
  );
  markedConfigured = true;
}

function normalizeGeminiMarkdown(markdown) {
  if (!markdown || typeof markdown !== "string") {
    return "";
  }
  let md = markdown.replace(/\r\n/g, "\n");
  md = md.replace(/\n{3,}/g, "\n\n");
  md = md.replace(/([^\n])\n(#{1,6}\s)/g, "$1\n\n$2");
  md = md.replace(/(#{1,6}[^\n]*\n)(?!\n)/g, "$1\n");
  return md;
}

function formatMarkdown(markdown) {
  ensureMarkedConfigured();
  const normalized = normalizeGeminiMarkdown(markdown);
  const parsed = marked.parse(normalized || "");
  if (
    process.stdout &&
    process.stdout.isTTY &&
    typeof process.stdout.columns === "number"
  ) {
    const width = Math.max(
      20,
      process.stdout.columns || DEFAULT_TERMINAL_WIDTH
    );
    const wrapped = wrapAnsi(parsed, width, { hard: false });
    return wrapped.endsWith("\n") ? wrapped : `${wrapped}\n`;
  }

  return parsed.endsWith("\n") ? parsed : `${parsed}\n`;
}

function getLastRawSummary() {
  return lastRawSummary;
}

function setLastRawSummary(val) {
  lastRawSummary = val;
}

function clearLastPrintedLines() {
  lastPrintedLines = 0;
}

function renderAndTrack() {
  const formatted = formatMarkdown(lastRawSummary);
  if (process.stdout && process.stdout.isTTY && lastPrintedLines > 0) {
    for (let i = 0; i < lastPrintedLines; i++) {
      process.stdout.write("\u001b[1A");
      process.stdout.write("\u001b[2K");
    }
  }

  process.stdout.write("\n");
  process.stdout.write(formatted);
  process.stdout.write("\n");

  lastPrintedLines = formatted.split("\n").length + 2;
}

function installResizeHandler() {
  if (process.stdout && process.stdout.isTTY && !resizeHandlerInstalled) {
    resizeHandlerInstalled = true;
    process.stdout.on("resize", () => {
      try {
        renderAndTrack();
      } catch (e) {
        // ignore
      }
    });
    process.on("exit", () => {
      try {
        process.stdout.removeAllListeners &&
          process.stdout.removeAllListeners("resize");
      } catch (e) {}
    });
  }
}

export {
  clearLastPrintedLines,
  formatMarkdown,
  getLastRawSummary,
  installResizeHandler,
  normalizeGeminiMarkdown,
  renderAndTrack,
  setLastRawSummary,
};
