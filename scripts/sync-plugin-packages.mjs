import { cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeSource = path.join(repoRoot, "shared", "runtime");
const pluginIds = ["omnimemory-memory"];

for (const pluginId of pluginIds) {
  const runtimeTarget = path.join(repoRoot, "plugins", pluginId, "runtime");
  await rm(runtimeTarget, { recursive: true, force: true });
  try {
    await cp(runtimeSource, runtimeTarget, { recursive: true });
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }
    await cp(runtimeSource, runtimeTarget, { recursive: true, force: true, errorOnExist: false });
  }
  console.log(`synced shared runtime -> plugins/${pluginId}/runtime`);
}
