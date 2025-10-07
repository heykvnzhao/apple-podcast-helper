const fs = require("fs")
const os = require("os")
const path = require("path")

const transcriptsDir = path.resolve(__dirname, "../transcripts")
const ttmlCacheDir = path.join(
	os.homedir(),
	"Library/Group Containers/243LU875E5.groups.com.apple.podcasts/Library/Cache/Assets/TTML",
)

function ensureTranscriptsDirectory() {
	if (!fs.existsSync(transcriptsDir)) {
		fs.mkdirSync(transcriptsDir, { recursive: true })
	}
}

module.exports = {
	transcriptsDir,
	ttmlCacheDir,
	ensureTranscriptsDirectory,
}
