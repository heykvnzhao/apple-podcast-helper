let cachedInk = null
let loadPromise = null

async function loadInk() {
	if (cachedInk) {
		return cachedInk
	}
	if (!loadPromise) {
		loadPromise = import("ink").then((inkModule) => {
			cachedInk = inkModule
			return cachedInk
		})
	}
	return loadPromise
}

module.exports = {
	loadInk,
}
