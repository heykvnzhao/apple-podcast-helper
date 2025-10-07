function reportOptionMessages(options) {
	if (!options || typeof options !== "object") {
		return true
	}
	if (Array.isArray(options.warnings)) {
		options.warnings.forEach((warning) => {
			console.warn(`[WARN] ${warning}`)
		})
	}
	if (Array.isArray(options.errors) && options.errors.length > 0) {
		options.errors.forEach((error) => {
			console.error(`[ERROR] ${error}`)
		})
		return false
	}
	return true
}

module.exports = {
	reportOptionMessages,
}

