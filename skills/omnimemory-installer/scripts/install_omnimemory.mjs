import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const skillRoot = path.resolve(__dirname, "..");

const DEFAULT_PLUGIN_REPO = "https://github.com/Omnimemory/oc-plugin";
const DEFAULT_PLUGIN_REPO_DIR = "oc-plugin";
const DEFAULT_BASE_URL = "https://api.omnimemory.cn/api/v2";
const DEFAULT_DEVICE_NO_ENV = "OMNI_MEMORY_DEVICE_NO";

const MODES = {
  memory: {
    pluginId: "omnimemory-memory",
    slot: "omnimemory-memory",
    config({ apiKeyValue, baseUrl, deviceNo, groupId }) {
      return pruneUndefined({
        apiKey: apiKeyValue,
        baseUrl,
        deviceNo,
        groupId,
        sessionScope: "global",
        autoRecall: true,
        autoCapture: true,
        captureStrategy: "last_turn",
        writeWait: false,
        failSilent: true,
        debugLogContent: false,
      });
    },
    inactivePluginId: "omnimemory-overlay",
  },
};

function pruneUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function parseArgs(argv) {
  const opts = {
    mode: "memory",
    pluginRoot: undefined,
    pluginRepo: process.env.OMNIMEMORY_PLUGIN_REPO || DEFAULT_PLUGIN_REPO,
    openclawRoot: undefined,
    apiKeyEnv: "OMNI_MEMORY_API_KEY",
    apiKey: undefined,
    baseUrl: DEFAULT_BASE_URL,
    deviceNoEnv: DEFAULT_DEVICE_NO_ENV,
    deviceNo: undefined,
    groupId: undefined,
    skipRestart: false,
    dryRun: false,
    uninstall: false,
    link: false,
    forceReinstall: true,
  };
  const args = [...argv];
  const takeValue = (flag) => {
    const value = args.shift();
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    return value;
  };
  while (args.length) {
    const token = args.shift();
    if (token === "--mode") {
      const mode = takeValue(token);
      opts.mode = mode === "replacement" ? "memory" : mode;
    } else if (token === "--plugin-root") {
      opts.pluginRoot = path.resolve(takeValue(token));
    } else if (token === "--plugin-repo") {
      opts.pluginRepo = takeValue(token);
    } else if (token === "--openclaw-root") {
      opts.openclawRoot = path.resolve(takeValue(token));
    } else if (token === "--api-key-env") {
      opts.apiKeyEnv = takeValue(token);
    } else if (token === "--api-key") {
      opts.apiKey = takeValue(token);
    } else if (token === "--base-url") {
      opts.baseUrl = String(takeValue(token)).replace(/\/+$/, "");
    } else if (token === "--device-no-env") {
      opts.deviceNoEnv = takeValue(token);
    } else if (token === "--device-no") {
      opts.deviceNo = takeValue(token);
    } else if (token === "--group-id") {
      opts.groupId = takeValue(token);
    } else if (token === "--skip-restart") {
      opts.skipRestart = true;
    } else if (token === "--dry-run") {
      opts.dryRun = true;
    } else if (token === "--uninstall") {
      opts.uninstall = true;
    } else if (token === "--link") {
      opts.link = true;
    } else if (token === "--no-force-reinstall") {
      opts.forceReinstall = false;
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  if (!Object.hasOwn(MODES, opts.mode)) {
    throw new Error("--mode must be memory");
  }
  return opts;
}

function runRaw(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(output || `${command} ${args.join(" ")} failed`);
  }
  return { ok: result.status === 0, status: result.status ?? 1, output };
}

function commandExists(command) {
  if (process.platform === "win32") {
    return runRaw("where", [command], { allowFailure: true }).ok;
  }
  return runRaw("bash", ["-lc", `command -v ${command}`], { allowFailure: true }).ok;
}

function runGit(args, cwd) {
  return runRaw("git", args, { cwd, allowFailure: true });
}

function findPluginRootFromSkill() {
  let dir = __dirname;
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(path.join(dir, "plugins")) && existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (!parent || parent === dir) {
      break;
    }
    dir = parent;
  }
  return undefined;
}

function resolveDesiredPluginRoot(opts) {
  if (opts.pluginRoot) {
    return opts.pluginRoot;
  }
  const localRoot = findPluginRootFromSkill();
  if (localRoot) {
    return localRoot;
  }
  const home = os.homedir();
  return path.join(home, DEFAULT_PLUGIN_REPO_DIR);
}

async function ensurePluginRepo(opts) {
  const pluginRoot = resolveDesiredPluginRoot(opts);
  if (existsSync(path.join(pluginRoot, "plugins"))) {
    return { pluginRoot, source: "local" };
  }
  mkdirSync(path.dirname(pluginRoot), { recursive: true });
  const cloned = runGit(["clone", "--depth", "1", opts.pluginRepo, pluginRoot], path.dirname(pluginRoot));
  if (!cloned.ok) {
    throw new Error(`could not fetch plugin repo from ${opts.pluginRepo}: ${cloned.output}`);
  }
  return { pluginRoot, source: "github" };
}

function syncPluginPackages(pluginRoot) {
  const packageJson = path.join(pluginRoot, "package.json");
  const syncScript = path.join(pluginRoot, "scripts", "sync-plugin-packages.mjs");
  if (!existsSync(packageJson) || !existsSync(syncScript)) {
    throw new Error(`plugin repo missing package.json or sync script: ${pluginRoot}`);
  }
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  return runRaw(npmBin, ["run", "packages:sync"], { cwd: pluginRoot });
}

function resolveOpenClawCommand(openclawRoot) {
  if (openclawRoot) {
    const distEntry = path.join(openclawRoot, "dist", "index.js");
    if (existsSync(distEntry)) {
      return { bin: "node", prefixArgs: [distEntry], label: `node ${distEntry}` };
    }
    const packageJson = path.join(openclawRoot, "package.json");
    if (existsSync(packageJson) && commandExists("pnpm")) {
      return { bin: "pnpm", prefixArgs: ["--dir", openclawRoot, "--silent", "openclaw"], label: `pnpm --dir ${openclawRoot} --silent openclaw` };
    }
  }
  if (commandExists("openclaw")) {
    return { bin: "openclaw", prefixArgs: [], label: "openclaw" };
  }
  throw new Error("could not resolve OpenClaw CLI; provide --openclaw-root or put openclaw on PATH");
}

function runOpenClaw(command, args, options = {}) {
  return runRaw(command.bin, [...command.prefixArgs, ...args], { allowFailure: options.allowFailure });
}

function parseMaybeJson(text, fallback = null) {
  if (!text || !text.trim()) {
    return fallback;
  }
  try {
    return JSON.parse(text);
  } catch {
    return fallback ?? { raw: text };
  }
}

function configPath() {
  const override = process.env.OPENCLAW_CONFIG_PATH || process.env.CLAWDBOT_CONFIG_PATH;
  if (override) {
    return path.resolve(override);
  }
  const stateDir = process.env.OPENCLAW_STATE_DIR || process.env.CLAWDBOT_STATE_DIR;
  if (stateDir) {
    return path.join(path.resolve(stateDir), "openclaw.json");
  }
  return path.join(os.homedir(), ".openclaw", "openclaw.json");
}

function stateDir() {
  const configured = process.env.OPENCLAW_STATE_DIR || process.env.CLAWDBOT_STATE_DIR;
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(os.homedir(), ".openclaw");
}

function extensionInstallPath(pluginId) {
  return path.join(stateDir(), "extensions", pluginId);
}

function removeStaleExtensionDir(pluginId) {
  const extensionsRoot = path.resolve(stateDir(), "extensions");
  const target = path.resolve(extensionInstallPath(pluginId));
  const relative = path.relative(extensionsRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !target.endsWith(`${path.sep}${pluginId}`)) {
    throw new Error(`refusing to remove unexpected plugin path: ${target}`);
  }
  if (!existsSync(target)) {
    return { ok: true, removed: false, path: target };
  }
  rmSync(target, { recursive: true, force: true });
  return { ok: true, removed: true, path: target };
}

function readConfig() {
  const target = configPath();
  if (!existsSync(target)) {
    return { target, config: {} };
  }
  const raw = readFileSync(target, "utf8");
  return { target, config: raw.trim() ? JSON.parse(raw) : {} };
}

function writeConfig(target, config) {
  mkdirSync(path.dirname(target), { recursive: true });
  if (existsSync(target)) {
    writeFileSync(`${target}.bak`, readFileSync(target, "utf8"), "utf8");
  }
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function existingPluginConfig(config, pluginId) {
  const entry = config?.plugins?.entries?.[pluginId];
  const pluginConfig = entry && typeof entry === "object" ? entry.config : undefined;
  return pluginConfig && typeof pluginConfig === "object" && !Array.isArray(pluginConfig) ? pluginConfig : {};
}

function existingEnabledPluginIds(entries, inactivePluginId) {
  if (!entries || typeof entries !== "object") {
    return [];
  }
  return Object.entries(entries)
    .filter(([id, entry]) => id !== inactivePluginId && entry && typeof entry === "object" && entry.enabled !== false)
    .map(([id]) => id);
}

function canRecoverCopiedExtensionInstallFailure(installResult, pluginId) {
  if (installResult.ok) {
    return false;
  }
  const output = installResult.output || "";
  const copiedExtension = existsSync(path.join(extensionInstallPath(pluginId), "openclaw.plugin.json"));
  return copiedExtension && /Config validation failed|plugins\.slots\.memory: plugin not found/i.test(output);
}

function removeUnsupportedEntryHooks(pluginId) {
  const { target, config } = readConfig();
  const entry = config?.plugins?.entries?.[pluginId];
  if (!entry || typeof entry !== "object" || !Object.hasOwn(entry, "hooks")) {
    return { changed: false, target };
  }
  const { hooks: _unsupportedHooks, ...supportedEntry } = entry;
  const next = {
    ...config,
    plugins: {
      ...config.plugins,
      entries: {
        ...config.plugins.entries,
        [pluginId]: supportedEntry,
      },
    },
  };
  writeConfig(target, next);
  return { changed: true, target };
}

function applyConfig({ modeSpec, opts }) {
  const { target, config } = readConfig();
  const currentPluginConfig = existingPluginConfig(config, modeSpec.pluginId);
  const apiKeyValue = opts.apiKey || currentPluginConfig.apiKey || `\${${opts.apiKeyEnv}}`;
  const deviceNoValue = opts.deviceNo || currentPluginConfig.deviceNo || `\${${opts.deviceNoEnv}}`;
  const next = config && typeof config === "object" && !Array.isArray(config) ? { ...config } : {};
  next.plugins = next.plugins && typeof next.plugins === "object" ? { ...next.plugins } : {};
  next.plugins.enabled = true;
  next.plugins.entries =
    next.plugins.entries && typeof next.plugins.entries === "object" ? { ...next.plugins.entries } : {};
  const currentEntry =
    next.plugins.entries[modeSpec.pluginId] && typeof next.plugins.entries[modeSpec.pluginId] === "object"
      ? next.plugins.entries[modeSpec.pluginId]
      : {};
  const { hooks: _unsupportedHooks, ...supportedEntry } = currentEntry;
  next.plugins.entries[modeSpec.pluginId] = {
    ...supportedEntry,
    enabled: true,
    config: modeSpec.config({
      apiKeyValue,
      baseUrl: opts.baseUrl || currentPluginConfig.baseUrl || DEFAULT_BASE_URL,
      deviceNo: deviceNoValue,
      groupId: opts.groupId || currentPluginConfig.groupId,
    }),
  };
  if (next.plugins.entries[modeSpec.inactivePluginId]) {
    delete next.plugins.entries[modeSpec.inactivePluginId];
  }
  if (next.plugins.installs && typeof next.plugins.installs === "object") {
    next.plugins.installs = { ...next.plugins.installs };
    if (next.plugins.installs[modeSpec.inactivePluginId]) {
      delete next.plugins.installs[modeSpec.inactivePluginId];
    }
  }
  const allow = Array.isArray(next.plugins.allow) ? [...next.plugins.allow] : [];
  const allowBase = allow.length ? allow : existingEnabledPluginIds(next.plugins.entries, modeSpec.inactivePluginId);
  next.plugins.allow = [...new Set([...allowBase.filter((id) => id !== modeSpec.inactivePluginId), modeSpec.pluginId])];
  next.plugins.slots =
    next.plugins.slots && typeof next.plugins.slots === "object" ? { ...next.plugins.slots } : {};
  next.plugins.slots.memory = modeSpec.slot;
  writeConfig(target, next);
  return target;
}

function pluginPackageDir(pluginRoot, modeSpec) {
  const dir = path.join(pluginRoot, "plugins", modeSpec.pluginId);
  if (!existsSync(path.join(dir, "openclaw.plugin.json")) || !existsSync(path.join(dir, "runtime"))) {
    throw new Error(`installable plugin package is incomplete: ${dir}`);
  }
  return dir;
}

function planReport({ opts, pluginRoot, source, modeSpec, packageDir, configTarget }) {
  const apiKeyValue = opts.apiKey ? "<plaintext qbk key>" : `\${${opts.apiKeyEnv}}`;
  const deviceNoValue = opts.deviceNo || `\${${opts.deviceNoEnv}}`;
  return {
    ok: true,
    dryRun: true,
    mode: opts.mode,
    pluginId: modeSpec.pluginId,
    pluginRoot,
    source,
    packageDir,
    configTarget,
    config: modeSpec.config({
      apiKeyValue,
      baseUrl: opts.baseUrl,
      deviceNo: deviceNoValue,
      groupId: opts.groupId,
    }),
    steps: [
      "fetch plugin repo if needed",
      "npm run packages:sync",
      "remove unsupported legacy entry hooks",
      `openclaw plugins install ${packageDir}`,
      `patch ${configTarget}`,
      "openclaw config validate --json",
      ...(opts.skipRestart ? [] : ["openclaw gateway restart"]),
      "openclaw plugins doctor",
    ],
  };
}

async function install(opts) {
  const { pluginRoot, source } = await ensurePluginRepo(opts);
  const modeSpec = MODES[opts.mode];
  const synced = syncPluginPackages(pluginRoot);
  const packageDir = pluginPackageDir(pluginRoot, modeSpec);
  const { target: configTarget } = readConfig();

  if (opts.dryRun) {
    return planReport({ opts, pluginRoot, source, modeSpec, packageDir, configTarget });
  }

  const command = resolveOpenClawCommand(opts.openclawRoot);
  const preInstallConfigRepair = removeUnsupportedEntryHooks(modeSpec.pluginId);
  let installResult = runOpenClaw(
    command,
    ["plugins", "install", ...(opts.link ? ["--link"] : []), packageDir],
    { allowFailure: true },
  );
  const existed = /plugin already exists|already installed|exists|duplicate|已安装/i.test(
    installResult.output || "",
  );
  let uninstallForReinstall = null;
  let staleDirRemoval = null;
  if (!installResult.ok && existed && opts.forceReinstall) {
    uninstallForReinstall = runOpenClaw(command, ["plugins", "uninstall", modeSpec.pluginId, "--force"], {
      allowFailure: true,
    });
    installResult = runOpenClaw(
      command,
      ["plugins", "install", ...(opts.link ? ["--link"] : []), packageDir],
      { allowFailure: true },
    );
    if (!installResult.ok && /plugin already exists|already installed|exists|duplicate|已安装/i.test(installResult.output || "")) {
      staleDirRemoval = removeStaleExtensionDir(modeSpec.pluginId);
      installResult = runOpenClaw(
        command,
        ["plugins", "install", ...(opts.link ? ["--link"] : []), packageDir],
        { allowFailure: true },
      );
    }
  }
  const installRecovered = canRecoverCopiedExtensionInstallFailure(installResult, modeSpec.pluginId);
  const installOk = installResult.ok || installRecovered;
  if (!installOk) {
    throw new Error(installResult.output || "openclaw plugin install failed");
  }
  const inactiveDirRemoval = modeSpec.inactivePluginId
    ? removeStaleExtensionDir(modeSpec.inactivePluginId)
    : null;
  const writtenConfig = applyConfig({ modeSpec, opts });
  const validation = runOpenClaw(command, ["config", "validate", "--json"], { allowFailure: true });
  const restart = opts.skipRestart
    ? null
    : runOpenClaw(command, ["gateway", "restart"], { allowFailure: true });
  const doctor = runOpenClaw(command, ["plugins", "doctor"], { allowFailure: true });

  return {
    ok: validation.ok && (!restart || restart.ok),
    mode: opts.mode,
    pluginId: modeSpec.pluginId,
    pluginRoot,
    source,
    packageDir,
    synced: synced.output,
    uninstallForReinstall: uninstallForReinstall
      ? { ok: uninstallForReinstall.ok, output: uninstallForReinstall.output }
      : null,
    staleDirRemoval,
    inactiveDirRemoval,
    install: { ok: installOk, recovered: installRecovered, output: installResult.output },
    preInstallConfigRepair,
    configPath: writtenConfig,
    validation: parseMaybeJson(validation.output, { raw: validation.output }),
    restart: restart ? { ok: restart.ok, output: restart.output } : null,
    doctor: { ok: doctor.ok, output: doctor.output },
  };
}

async function uninstall(opts) {
  const command = resolveOpenClawCommand(opts.openclawRoot);
  const modeSpec = MODES[opts.mode];
  if (opts.dryRun) {
    return {
      ok: true,
      dryRun: true,
      mode: opts.mode,
      steps: [`openclaw plugins uninstall ${modeSpec.pluginId} --force`, "openclaw config validate --json"],
    };
  }
  const removed = runOpenClaw(command, ["plugins", "uninstall", modeSpec.pluginId, "--force"], {
    allowFailure: true,
  });
  const validation = runOpenClaw(command, ["config", "validate", "--json"], { allowFailure: true });
  return {
    ok: (removed.ok || /not found|不存在/i.test(removed.output)) && validation.ok,
    mode: opts.mode,
    pluginId: modeSpec.pluginId,
    uninstall: { ok: removed.ok, output: removed.output },
    validation: parseMaybeJson(validation.output, { raw: validation.output }),
  };
}

function printUsage() {
  console.error(`Usage:
  node scripts/install_omnimemory.mjs --mode memory --openclaw-root <path> --api-key-env OMNI_MEMORY_API_KEY --device-no-env OMNI_MEMORY_DEVICE_NO
  node scripts/install_omnimemory.mjs --mode memory --plugin-root <oc-plugin-path> --openclaw-root <path> --api-key qbk_xxx --device-no <stable-device-no>

Options:
  --mode memory
  --plugin-root <path>
  --plugin-repo <git-url>
  --openclaw-root <path>
  --api-key-env <ENV_NAME>
  --api-key <qbk_xxx>
  --base-url <url>
  --device-no-env <ENV_NAME>
  --device-no <device_no>
  --group-id <group_id>
  --skip-restart
  --dry-run
  --uninstall
  --link
  --no-force-reinstall`);
}

async function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const report = opts.uninstall ? await uninstall(opts) : await install(opts);
    console.log(JSON.stringify(report, null, 2));
    return report.ok ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    printUsage();
    return 1;
  }
}

process.exitCode = await main();
