import crypto from "crypto";

const IDENTIFIER_HASH_LENGTH = 10;

function buildIdentifierHash(identifier) {
  if (!identifier || typeof identifier !== "string") {
    return null;
  }
  return crypto
    .createHash("sha256")
    .update(identifier)
    .digest("hex")
    .slice(0, IDENTIFIER_HASH_LENGTH);
}

function splitIdentifierHashSuffix(value) {
  if (!value || typeof value !== "string") {
    return { baseName: value, identifierHash: null };
  }
  const pattern = new RegExp(
    `^(.*)--([a-f0-9]{${IDENTIFIER_HASH_LENGTH}})$`,
    "i"
  );
  const match = value.match(pattern);
  if (!match) {
    return { baseName: value, identifierHash: null };
  }
  return { baseName: match[1], identifierHash: match[2].toLowerCase() };
}

export { IDENTIFIER_HASH_LENGTH, buildIdentifierHash, splitIdentifierHashSuffix };
