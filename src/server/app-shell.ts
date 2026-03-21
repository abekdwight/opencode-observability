import { readFileSync } from "node:fs";
import { resolveAppIndexPath } from "../lib/app-dist-path.js";

const APP_INDEX = resolveAppIndexPath(import.meta.url);

export function renderAppShell(): string {
  return readFileSync(APP_INDEX, "utf8");
}
