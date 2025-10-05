const { convertHtmlToMarkdown } = require("./convert-html-to-markdown")
const { formatSlugAsTitle } = require("./format-transcript-fields")

function getEpisodeDescriptionMarkdown(metadata) {
	if (!metadata) {
		return ""
	}
	if (metadata.episodeDescriptionHtml) {
		const markdown = convertHtmlToMarkdown(metadata.episodeDescriptionHtml)
		if (markdown) {
			return markdown
		}
	}
	if (metadata.episodeDescriptionText) {
		const plain = metadata.episodeDescriptionText.trim()
		if (plain) {
			return plain
		}
	}
	return ""
}

function buildEpisodeMarkdown(transcriptText, metadata, fallbackContext = {}) {
	const safeMetadata = metadata || {}
	const effectiveFallbackContext = fallbackContext || {}
	const fallbackShowSlug =
		effectiveFallbackContext.showSlug || safeMetadata.showSlug || ""
	const fallbackShowName =
		safeMetadata.showTitle && safeMetadata.showTitle !== "unknown show"
			? safeMetadata.showTitle
			: effectiveFallbackContext.showName || formatSlugAsTitle(fallbackShowSlug) || "Unknown show"
	const fallbackDateSegment =
		safeMetadata.pubDate && safeMetadata.pubDate !== "unknown-date"
			? safeMetadata.pubDate
			: effectiveFallbackContext.dateSegment || "unknown-date"
	const description = getEpisodeDescriptionMarkdown(safeMetadata)
	const descriptionSection = [
		"## Episode description",
		`Show name: ${fallbackShowName}`,
		`Episode date: ${fallbackDateSegment}`,
		"Episode description:",
		description || "Not available.",
	].join("\n")
	const transcriptSectionHeader = "## Episode transcript"
	const transcriptSectionBody = transcriptText && transcriptText.trim() ? transcriptText.trim() : "Not available."

	const output = [descriptionSection, transcriptSectionHeader, transcriptSectionBody]
		.filter((section) => section && section.trim() !== "")
		.join("\n\n")

	return `${output.trimEnd()}\n`
}

module.exports = {
	getEpisodeDescriptionMarkdown,
	buildEpisodeMarkdown,
}
