const { COCOA_EPOCH_MS } = require("./define-cocoa-epoch")

function formatTimestamp(seconds) {
	const h = Math.floor(seconds / 3600)
	const m = Math.floor((seconds % 3600) / 60)
	const s = Math.floor(seconds % 60)

	return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
}

function slugify(value, fallback = "unknown") {
	if (!value || typeof value !== "string") {
		return fallback
	}
	const cleaned = value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-zA-Z0-9\s-]/g, "")
		.trim()
		.replace(/[\s_-]+/g, "-")
		.replace(/-+/g, "-")
		.toLowerCase()
	return cleaned || fallback
}

function truncateSlug(slug, maxLength) {
	if (slug.length <= maxLength) {
		return slug
	}
	const truncated = slug.slice(0, maxLength).replace(/-+$/g, "")
	return truncated || slug.slice(0, maxLength)
}

function formatCocoaDate(seconds, fallback = "unknown-date") {
	if (typeof seconds !== "number" || Number.isNaN(seconds)) {
		return fallback
	}
	const unixMs = COCOA_EPOCH_MS + seconds * 1000
	if (!Number.isFinite(unixMs)) {
		return fallback
	}
	const date = new Date(unixMs)
	if (Number.isNaN(date.getTime())) {
		return fallback
	}
	const year = date.getUTCFullYear()
	const month = `${date.getUTCMonth() + 1}`.padStart(2, "0")
	const day = `${date.getUTCDate()}`.padStart(2, "0")
	return `${year}-${month}-${day}`
}

function formatSlugAsTitle(slug) {
	if (!slug) {
		return ""
	}
	return slug
		.split("-")
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ")
}

module.exports = {
	formatTimestamp,
	slugify,
	truncateSlug,
	formatCocoaDate,
	formatSlugAsTitle,
}
