function parsePositiveInteger(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export { parsePositiveInteger };
