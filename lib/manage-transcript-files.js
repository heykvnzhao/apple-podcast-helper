const fs = require("fs")
const path = require("path")

const { buildEpisodeMarkdown } = require("./build-episode-markdown")
const { resolveMetadataForFile } = require("./load-podcast-metadata")

function transcriptIdentifierFromRelativePath(relativePath) {
	const normalized = relativePath.split(path.sep).join("/")
	const index = normalized.indexOf(".ttml")
	return index === -1 ? normalized : normalized.slice(0, index + ".ttml".length)
}

function findTTMLFiles(dir, baseDir = dir) {
	const files = fs.readdirSync(dir)
	let ttmlFiles = []

	files.forEach((file) => {
		const fullPath = path.join(dir, file)
		const stat = fs.statSync(fullPath)

		if (stat.isDirectory()) {
			ttmlFiles = ttmlFiles.concat(findTTMLFiles(fullPath, baseDir))
		} else if (path.extname(fullPath) === ".ttml") {
			const relative = path.relative(baseDir, fullPath)
			ttmlFiles.push({
				path: fullPath,
				identifier: transcriptIdentifierFromRelativePath(relative),
			})
		}
	})

	return ttmlFiles
}

function convertExistingTxtTranscripts(directoryPath) {
	if (!fs.existsSync(directoryPath)) {
		return
	}

	const entries = fs.readdirSync(directoryPath, { withFileTypes: true })

	entries.forEach((entry) => {
		if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".txt") {
			const sourcePath = path.join(directoryPath, entry.name)
			const destinationPath = path.join(
				directoryPath,
				`${path.basename(entry.name, ".txt")}.md`,
			)
			const content = fs.readFileSync(sourcePath, "utf8")
			fs.writeFileSync(destinationPath, content)
			fs.unlinkSync(sourcePath)
		}
	})
}

function moveMarkdownTranscriptsIntoShowDirectories(directoryPath) {
	if (!fs.existsSync(directoryPath)) {
		return
	}

	const entries = fs.readdirSync(directoryPath, { withFileTypes: true })

	entries.forEach((entry) => {
		if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") {
			return
		}

		const showSlug = entry.name.split("_")[0] || "unknown-show"
		const showDir = path.join(directoryPath, showSlug)
		if (!fs.existsSync(showDir)) {
			fs.mkdirSync(showDir, { recursive: true })
		}

		const currentPath = path.join(directoryPath, entry.name)
		const targetPath = path.join(showDir, entry.name)
		if (currentPath !== targetPath) {
			fs.renameSync(currentPath, targetPath)
		}
	})
}

function ensureShowOutputDirectory(baseDirectory, showSlug) {
	const directoryPath = path.join(baseDirectory, showSlug)
	if (!fs.existsSync(directoryPath)) {
		fs.mkdirSync(directoryPath, { recursive: true })
	}
	return directoryPath
}

function resolveFallbackContext(baseName, directorySlug) {
	const parts = (baseName || "").split("_")
	const baseShowSlug = parts.length > 0 ? parts[0] : ""
	const dateSegment = parts.length > 1 ? parts[1] : ""
	const showSlug =
		directorySlug && directorySlug !== "transcripts"
			? directorySlug
			: baseShowSlug
	return {
		showSlug,
		dateSegment,
	}
}

function updateExistingMarkdownFiles(directoryPath, metadataIndex) {
	if (!fs.existsSync(directoryPath)) {
		return
	}

	const entries = fs.readdirSync(directoryPath, { withFileTypes: true })
	entries.forEach((entry) => {
		const fullPath = path.join(directoryPath, entry.name)
		if (entry.isDirectory()) {
			updateExistingMarkdownFiles(fullPath, metadataIndex)
			return
		}
		if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") {
			return
		}

		const currentContent = fs.readFileSync(fullPath, "utf8")
		const baseName = path.basename(entry.name, ".md")
		const metadata = resolveMetadataForFile(metadataIndex, baseName)
		const parentDirSlug = path.basename(directoryPath)
		const fallbackContext = resolveFallbackContext(baseName, parentDirSlug)
		let transcriptBody = currentContent.trim()
		const transcriptHeadingIndex = currentContent.indexOf("## Episode transcript")
		if (transcriptHeadingIndex !== -1) {
			const afterHeading = currentContent.slice(
				transcriptHeadingIndex + "## Episode transcript".length,
			)
			transcriptBody = afterHeading.replace(/^\s+/, "").trim()
		}
		const updatedContent = buildEpisodeMarkdown(transcriptBody, metadata, fallbackContext)
		fs.writeFileSync(fullPath, updatedContent)
	})
}

module.exports = {
	transcriptIdentifierFromRelativePath,
	findTTMLFiles,
	convertExistingTxtTranscripts,
	moveMarkdownTranscriptsIntoShowDirectories,
	ensureShowOutputDirectory,
	resolveFallbackContext,
	updateExistingMarkdownFiles,
}
