const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function requireRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(label + " must be an object");
  return value;
}

export function validatePlatformMatrix(release, matrix) {
  const targets = requireRecord(release?.targets, "release.targets");
  const nativeSupported = requireRecord(matrix?.nativeSupported, "platform matrix nativeSupported");
  const targetKeys = Object.keys(targets).sort();
  const matrixKeys = Object.keys(nativeSupported).sort();
  for (const key of targetKeys) {
    if (typeof targets[key] !== "string" || targets[key].length === 0) throw new TypeError("release.targets." + key + " must be a non-empty pinned target");
    if (!hasOwn(nativeSupported, key)) throw new Error("platform matrix is missing supported release target " + key);
    if (nativeSupported[key] !== true) throw new Error("platform matrix nativeSupported." + key + " must be true for a supported release target");
  }
  for (const key of matrixKeys) {
    if (!hasOwn(targets, key)) throw new Error("platform matrix contains unknown release target " + key);
    if (typeof nativeSupported[key] !== "boolean") throw new TypeError("platform matrix nativeSupported." + key + " must be boolean");
  }
  return targetKeys;
}

export function determinePlatformSupport(release, matrix, platformKey) {
  validatePlatformMatrix(release, matrix);
  if (typeof platformKey !== "string" || platformKey.length === 0) throw new TypeError("platform key must be a non-empty string");
  const nativeSupported = hasOwn(release.targets, platformKey);
  return { platform: platformKey, nativeSupported, releaseTarget: nativeSupported ? release.targets[platformKey] : null };
}

export function classifyPlatformGates(release, matrix, platformKey) {
  const support = determinePlatformSupport(release, matrix, platformKey);
  const nativeGates = matrix?.nativeGates;
  if (!Array.isArray(nativeGates) || nativeGates.length === 0 || nativeGates.some((gate) => typeof gate !== "string" || gate.length === 0)) {
    throw new TypeError("platform matrix nativeGates must be a non-empty string array");
  }
  return {
    ...support,
    exclusions: support.nativeSupported ? [] : nativeGates.map((gate) => ({
      gate,
      platform: platformKey,
      reason: "No pinned native Bun target; portable gates remain mandatory.",
    })),
  };
}
