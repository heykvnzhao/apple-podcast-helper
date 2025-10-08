const LISTING_STATUS_METADATA = {
  played: { icon: "✅", label: "PLAYED" },
  inProgress: { icon: "🎧", label: "IN PROGRESS" },
  unplayed: { icon: "🆕", label: "NOT PLAYED" },
};

function normalizePlayState(playState) {
  if (!playState || typeof playState !== "string") {
    return null;
  }
  const normalized = playState.toLowerCase();
  if (normalized === "played") {
    return "played";
  }
  if (
    normalized === "inprogress" ||
    normalized === "in-progress" ||
    normalized === "in_progress"
  ) {
    return "inProgress";
  }
  if (
    normalized === "unplayed" ||
    normalized === "notplayed" ||
    normalized === "not-played"
  ) {
    return "unplayed";
  }
  return playState;
}

function getStatusInfo(playState) {
  const normalized = normalizePlayState(playState);
  return (
    LISTING_STATUS_METADATA[normalized] || { icon: "❔", label: "UNKNOWN" }
  );
}

export { getStatusInfo, LISTING_STATUS_METADATA, normalizePlayState };
