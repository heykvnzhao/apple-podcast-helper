import { logSummaryError, runSummaryRequest } from "./summary-client.js";

async function runGeminiRequest({ transcriptContent, entry, summaryCacheMode }) {
  return runSummaryRequest({ transcriptContent, entry, summaryCacheMode });
}

function logGeminiError(error) {
  logSummaryError(error);
}

export { logGeminiError, runGeminiRequest };
