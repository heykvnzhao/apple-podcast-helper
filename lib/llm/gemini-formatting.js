import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import wrapAnsi from "wrap-ansi";

const DEFAULT_TERMINAL_WIDTH = 80;
const MAX_OUTPUT_WIDTH = 80;
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

  const LEFT_PAD = 2;
  const RIGHT_PAD = 2;

  if (
    process.stdout &&
    process.stdout.isTTY &&
    typeof process.stdout.columns === "number"
  ) {
    let termWidth = process.stdout.columns || DEFAULT_TERMINAL_WIDTH;

    termWidth = Math.min(termWidth, MAX_OUTPUT_WIDTH);

    const innerWidth = Math.max(20, termWidth - LEFT_PAD - RIGHT_PAD);

    const paragraphs = parsed
      .replace(/\r\n/g, "\n")
      .split(/\n{2,}/g)
      .map((p) => p.trim());
    const wrappedParagraphs = paragraphs.map((p) => {
      const wrapped = wrapAnsi(p, innerWidth, { hard: false });
      // Prefix each line with left padding
      return wrapped
        .split("\n")
        .map((line) => " ".repeat(LEFT_PAD) + line)
        .join("\n");
    });

    const wrapped = wrappedParagraphs.join("\n\n");
    return wrapped.endsWith("\n") ? wrapped : `${wrapped}\n`;
  }

  // Non-tty: wrap to MAX_OUTPUT_WIDTH for readability and prefix with left pad.
  const nonTtyWidth =
    Math.min(DEFAULT_TERMINAL_WIDTH, MAX_OUTPUT_WIDTH) - LEFT_PAD - RIGHT_PAD;
  const nonTtyParagraphs = parsed
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/g)
    .map((p) => p.trim());
  const nonTtyWrapped = nonTtyParagraphs
    .map((p) =>
      wrapAnsi(p, Math.max(20, nonTtyWidth), { hard: false })
        .split("\n")
        .map((line) => " ".repeat(LEFT_PAD) + line)
        .join("\n")
    )
    .join("\n\n");
  return nonTtyWrapped.endsWith("\n") ? nonTtyWrapped : `${nonTtyWrapped}\n`;
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
