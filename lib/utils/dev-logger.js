function logDevWarning(message, error) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }
  const detail = error && error.message ? error.message : error;
  const suffix = detail ? `: ${detail}` : "";
  console.warn(`[WARN] ${message}${suffix}`);
}

export { logDevWarning };

