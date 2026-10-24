import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";

const linuxCandidates = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];
const darwinCandidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];
const windowsCandidates = [
  join(process.env.ProgramFiles ?? "", "Google", "Chrome", "Application", "chrome.exe"),
  join(process.env["ProgramFiles(x86)"] ?? "", "Google", "Chrome", "Application", "chrome.exe"),
];

/** Resolve only declared, deterministic system locations. Never inspect PATH or environment overrides. */
export function systemChromiumExecutable(): string {
  const candidates = process.platform === "linux" ? linuxCandidates : process.platform === "darwin" ? darwinCandidates : windowsCandidates;
  const found = candidates.find(candidate => candidate && existsSync(candidate));
  if (!found) throw new Error(`A Chromium-family browser is required for Skill Creator browser coverage on ${process.platform}; checked: ${candidates.join(", ")}`);
  return realpathSync(found);
}
