import { createProgressIndicator } from "../cli/progress-indicator.js";
import { logGeminiError, runGeminiRequest } from "./gemini-client.js";
import {
  installResizeHandler,
  renderAndTrack,
  setLastRawSummary,
} from "./gemini-formatting.js";
import { runInteractiveGeminiViewer } from "./gemini-summary-viewer.js";
import { buildDisplaySummary } from "./summary-presentation.js";
import { getSummaryProviderDisplayName } from "./summary-provider-config.js";

async function maybeSummarizeTranscript({
	transcriptContent,
	entry,
	summaryCacheMode,
}) {
  try {
    const summary = await runGeminiRequest({
			transcriptContent,
			entry,
			summaryCacheMode,
		});
    return summary && summary.trim() ? summary.trim() : null;
  } catch (error) {
    logGeminiError(error);
    return null;
  }
}

async function maybePrintGeminiSummary({
	transcriptContent,
	entry,
	summaryCacheMode,
}) {
  const providerDisplayName = getSummaryProviderDisplayName();
  const progress = createProgressIndicator({
    label: "Summarizing transcript",
  });
  progress.start();
  let spinnerActive = true;
  let summary = null;

  try {
    summary = await runGeminiRequest({
			transcriptContent,
			entry,
			summaryCacheMode,
		});
  } catch (error) {
    if (spinnerActive) {
      progress.fail(`${providerDisplayName} summary failed`);
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
    progress.done(`${providerDisplayName} summary ready`);
    spinnerActive = false;
  }

  console.log("");

  const full = buildDisplaySummary({
    entry,
    providerDisplayName,
    summary,
  });
  setLastRawSummary(full);
  if (
    process.stdin &&
    process.stdin.isTTY &&
    process.stdout &&
    process.stdout.isTTY
  ) {
    try {
      await runInteractiveGeminiViewer();
    } catch (e) {
      renderAndTrack();
      installResizeHandler();
    }
  } else {
    renderAndTrack();
    installResizeHandler();
  }

  return summary.trim();
}

export { maybePrintGeminiSummary, maybeSummarizeTranscript };
