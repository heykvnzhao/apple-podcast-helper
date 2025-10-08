import { Parser } from "xml2js";

import { buildEpisodeMarkdown } from "./episode-markdown-builder.js";
import transcriptFieldFormatters from "./transcript-field-formatters.js";
const { formatTimestamp } = transcriptFieldFormatters;

function extractTextFromSpans(spans) {
  let text = "";
  spans.forEach((span) => {
    if (span.span) {
      text += extractTextFromSpans(span.span);
    } else if (span._) {
      text += `${span._} `;
    }
  });
  return text;
}

async function parseTranscript(ttmlContent, includeTimestamps) {
  const parser = new Parser();
  const result = await parser.parseStringPromise(ttmlContent);

  let transcript = [];
  const paragraphs = result.tt.body[0].div[0].p;

  paragraphs.forEach((paragraph) => {
    if (!paragraph.span) {
      return;
    }
    const paragraphText = extractTextFromSpans(paragraph.span).trim();
    if (!paragraphText) {
      return;
    }
    if (includeTimestamps && paragraph.$ && paragraph.$.begin) {
      const timestamp = formatTimestamp(parseFloat(paragraph.$.begin));
      transcript.push(`[${timestamp}] ${paragraphText}`);
      return;
    }
    transcript.push(paragraphText);
  });

  return transcript.join("\n\n");
}

async function extractTranscript(ttmlContent, options = {}) {
  const {
    includeTimestamps = false,
    metadata = null,
    fallbackContext = null,
  } = options;
  const transcriptText = await parseTranscript(ttmlContent, includeTimestamps);
  return buildEpisodeMarkdown(transcriptText, metadata, fallbackContext);
}

export { extractTranscript };

export default {
  extractTranscript,
};
