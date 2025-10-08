import { createProgressIndicator } from "../cli/progress-indicator.js";
import { logGeminiError, runGeminiRequest } from "./gemini-client.js";
import {
  installResizeHandler,
  renderAndTrack,
  setLastRawSummary,
} from "./gemini-formatting.js";

async function maybeSummarizeTranscript({ transcriptContent, entry }) {
  try {
    const summary = await runGeminiRequest({ transcriptContent, entry });
    return summary && summary.trim() ? summary.trim() : null;
  } catch (error) {
    logGeminiError(error);
    return null;
  }
}

async function maybePrintGeminiSummary({ transcriptContent, entry }) {
  const progress = createProgressIndicator({
    label: "Summarizing transcript",
  });
  progress.start();
  let spinnerActive = true;
  let summary = null;

  try {
    summary = await runGeminiRequest({ transcriptContent, entry });
  } catch (error) {
    if (spinnerActive) {
      progress.fail("Gemini summary failed");
      spinnerActive = false;
    }
    logGeminiError(error);
    return null;
  }

  if (!summary) {
    if (spinnerActive) {
      progress.stop();
      spinnerActive = false;
    }
    return null;
  }

  if (spinnerActive) {
    progress.done("Gemini summary ready");
    spinnerActive = false;
  }

  console.log("");
  setLastRawSummary(summary);
  renderAndTrack();
  installResizeHandler();

  return summary.trim();
}

export { maybePrintGeminiSummary, maybeSummarizeTranscript };
