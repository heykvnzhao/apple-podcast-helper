import {
  DEFAULT_LIST_LIMIT,
  DEFAULT_SELECT_PAGE_SIZE,
} from "../app-constants.js";
import { parsePositiveInteger } from "../utils/numbers.js";

const CLI_COMMANDS = new Set(["sync", "list", "copy", "select", "help"]);
const COMMAND_ALIASES = {
  interactive: "select",
};

function parseCliArguments(argv) {
  const rawArgs = Array.isArray(argv) ? argv.slice() : [];
  const args = [];
  let flaggedCommand = null;
  let syncFlagEncountered = false;
  let skipAutoSync = false;

  rawArgs.forEach((arg) => {
    if (arg === "--no-sync" || arg === "--skip-sync") {
      skipAutoSync = true;
      return;
    }
    if (arg === "--sync") {
      flaggedCommand = "sync";
      syncFlagEncountered = true;
      return;
    }
    if (arg === "--select") {
      flaggedCommand = flaggedCommand || "select";
      return;
    }
    if (arg === "--help" || arg === "-h") {
      flaggedCommand = "help";
      return;
    }
    args.push(arg);
  });

  if (flaggedCommand) {
    const options = parseCommandOptions(flaggedCommand, args);
    if (syncFlagEncountered && options && typeof options === "object") {
      options.launchSelectorAfterSync = true;
    }
    return {
      command: flaggedCommand,
      options,
      skipAutoSync,
    };
  }

  if (args.length === 0) {
    return { command: "select", options: parseSelectOptions([]), skipAutoSync };
  }
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    return { command: "help", options: parseHelpOptions([]), skipAutoSync };
  }

  const first = args[0];
  if (first && !first.startsWith("-")) {
    const normalized = COMMAND_ALIASES[first] || first;
    if (CLI_COMMANDS.has(normalized)) {
      if (normalized === "help") {
        return {
          command: "help",
          options: parseHelpOptions(args.slice(1)),
          skipAutoSync,
        };
      }
      return {
        command: normalized,
        options: parseCommandOptions(normalized, args.slice(1)),
        skipAutoSync,
      };
    }
  }

  return { command: "select", options: parseSelectOptions(args), skipAutoSync };
}

function parseCommandOptions(command, args) {
  switch (command) {
    case "sync":
      return parseSyncOptions(args);
    case "list":
      return parseListOptions(args);
    case "copy":
      return parseCopyOptions(args);
    case "select":
      return parseSelectOptions(args);
    default:
      return { help: true, errors: [`Unknown command: ${command}`] };
  }
}

function parseHelpOptions(args) {
  const options = { topic: null };
  if (Array.isArray(args)) {
    for (let index = 0; index < args.length; index += 1) {
      const value = args[index];
      if (!value) {
        continue;
      }
      options.topic = value;
      break;
    }
  }
  options.topic = options.topic || "global";
  return options;
}

function parseSyncOptions(args) {
  const options = {
    includeTimestamps: true,
    mode: "batch",
    inputPath: null,
    outputPath: null,
    help: false,
    showFilters: [],
    stationFilters: [],
    errors: [],
    warnings: [],
  };
  const positional = [];
  const list = Array.isArray(args) ? args : [];
  for (let index = 0; index < list.length; index += 1) {
    const rawArg = list[index];
    if (rawArg === "--timestamps") {
      options.includeTimestamps = true;
      continue;
    }
    if (rawArg === "--no-timestamps") {
      options.includeTimestamps = false;
      continue;
    }
    if (rawArg === "--help" || rawArg === "-h") {
      options.help = true;
      continue;
    }
    const [flag, inlineValue] = splitFlagValue(rawArg);
    if (flag === "--show") {
      const value = inlineValue !== null ? inlineValue : list[index + 1];
      if (inlineValue === null && value !== undefined) {
        index += 1;
      }
      if (value === undefined) {
        options.errors.push("--show requires a value");
        continue;
      }
      addFilterValues(options.showFilters, value);
      continue;
    }
    if (flag === "--station") {
      const value = inlineValue !== null ? inlineValue : list[index + 1];
      if (inlineValue === null && value !== undefined) {
        index += 1;
      }
      if (value === undefined) {
        options.errors.push("--station requires a value");
        continue;
      }
      addFilterValues(options.stationFilters, value);
      continue;
    }
    positional.push(rawArg);
  }
  if (positional.length === 0) {
    options.mode = "batch";
    return options;
  }
  if (positional.length === 1) {
    options.errors.push(
      "sync command requires both input.ttml and output.md when using positional arguments"
    );
    return options;
  }
  if (positional.length >= 2) {
    options.mode = "single";
    options.inputPath = positional[0];
    options.outputPath = positional[1];
  }
  return options;
}

function parseListOptions(args) {
  const options = {
    status: "all",
    limit: DEFAULT_LIST_LIMIT,
    page: 1,
    format: "table",
    help: false,
    showFilters: [],
    stationFilters: [],
    errors: [],
    warnings: [],
  };
  const list = Array.isArray(args) ? args : [];
  for (let index = 0; index < list.length; index += 1) {
    const rawArg = list[index];
    if (rawArg === "--help" || rawArg === "-h") {
      options.help = true;
      continue;
    }
    const [flag, inlineValue] = splitFlagValue(rawArg);
    if (flag === "--status") {
      const value = inlineValue !== null ? inlineValue : list[index + 1];
      if (inlineValue === null && value !== undefined) {
        index += 1;
      }
      if (value === undefined) {
        options.errors.push(
          "--status requires a value (played, unplayed, in-progress, all)"
        );
        continue;
      }
      const normalized = normalizeStatusFilter(value);
      if (!normalized) {
        options.errors.push(`Unknown status filter: ${value}`);
        continue;
      }
      options.status = normalized;
      continue;
    }
    if (flag === "--limit" || flag === "--page-size") {
      const value = inlineValue !== null ? inlineValue : list[index + 1];
      if (inlineValue === null && value !== undefined) {
        index += 1;
      }
      if (value === undefined) {
        options.errors.push(`${flag} requires a positive integer`);
        continue;
      }
      const parsed = parsePositiveInteger(value);
      if (parsed === null) {
        options.errors.push(
          `${flag} requires a positive integer (received "${value}")`
        );
        continue;
      }
      options.limit = parsed;
      continue;
    }
    if (flag === "--page") {
      const value = inlineValue !== null ? inlineValue : list[index + 1];
      if (inlineValue === null && value !== undefined) {
        index += 1;
      }
      if (value === undefined) {
        options.errors.push("--page requires a positive integer");
        continue;
      }
      const parsed = parsePositiveInteger(value);
      if (parsed === null) {
        options.errors.push(
          `--page requires a positive integer (received "${value}")`
        );
        continue;
      }
      options.page = parsed;
      continue;
    }
    if (flag === "--json") {
      options.format = "json";
      continue;
    }
    if (flag === "--table") {
      options.format = "table";
      continue;
    }
    if (flag === "--show") {
      const value = inlineValue !== null ? inlineValue : list[index + 1];
      if (inlineValue === null && value !== undefined) {
        index += 1;
      }
      if (value === undefined) {
        options.errors.push("--show requires a value");
        continue;
      }
      addFilterValues(options.showFilters, value);
      continue;
    }
    if (flag === "--station") {
      const value = inlineValue !== null ? inlineValue : list[index + 1];
      if (inlineValue === null && value !== undefined) {
        index += 1;
      }
      if (value === undefined) {
        options.errors.push("--station requires a value");
        continue;
      }
      addFilterValues(options.stationFilters, value);
      continue;
    }
    options.warnings.push(`Unrecognized argument: ${rawArg}`);
  }
  return options;
}

function parseCopyOptions(args) {
  const options = {
    key: null,
    print: false,
    help: false,
    errors: [],
    warnings: [],
  };
  const list = Array.isArray(args) ? args : [];
  list.forEach((arg) => {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      return;
    }
    if (arg === "--print") {
      options.print = true;
      return;
    }
    if (!options.key) {
      options.key = arg;
      return;
    }
    options.errors.push(`Unexpected argument: ${arg}`);
  });
  if (!options.key && !options.help) {
    options.errors.push("copy command requires an identifier or relative path");
  }
  return options;
}

function parseSelectOptions(args) {
  const options = {
    status: "unplayed",
    pageSize: DEFAULT_SELECT_PAGE_SIZE,
    help: false,
    showFilters: [],
    showInteractive: false,
    stationFilters: [],
    errors: [],
    warnings: [],
  };
  const list = Array.isArray(args) ? args : [];
  for (let index = 0; index < list.length; index += 1) {
    const rawArg = list[index];
    if (rawArg === "--help" || rawArg === "-h") {
      options.help = true;
      continue;
    }
    const [flag, inlineValue] = splitFlagValue(rawArg);
    if (flag === "--status") {
      const value = inlineValue !== null ? inlineValue : list[index + 1];
      if (inlineValue === null && value !== undefined) {
        index += 1;
      }
      if (value === undefined) {
        options.errors.push(
          "--status requires a value (played, unplayed, in-progress, all)"
        );
        continue;
      }
      const normalized = normalizeStatusFilter(value);
      if (!normalized) {
        options.errors.push(`Unknown status filter: ${value}`);
        continue;
      }
      options.status = normalized;
      continue;
    }
    if (flag === "--page-size" || flag === "--limit") {
      const value = inlineValue !== null ? inlineValue : list[index + 1];
      if (inlineValue === null && value !== undefined) {
        index += 1;
      }
      if (value === undefined) {
        options.errors.push(`${flag} requires a positive integer`);
        continue;
      }
      const parsed = parsePositiveInteger(value);
      if (parsed === null) {
        options.errors.push(
          `${flag} requires a positive integer (received "${value}")`
        );
        continue;
      }
      options.pageSize = parsed;
      continue;
    }
    if (flag === "--show") {
      const maybeNext = list[index + 1];
      const value =
        inlineValue !== null
          ? inlineValue
          : typeof maybeNext === "string" && !maybeNext.startsWith("-")
          ? maybeNext
          : undefined;
      if (inlineValue === null && value !== undefined && maybeNext === value) {
        index += 1;
      }
      if (value === undefined) {
        options.showInteractive = true;
        continue;
      }
      addFilterValues(options.showFilters, value);
      continue;
    }
    if (flag === "--station") {
      const value = inlineValue !== null ? inlineValue : list[index + 1];
      if (inlineValue === null && value !== undefined) {
        index += 1;
      }
      if (value === undefined) {
        options.errors.push("--station requires a value");
        continue;
      }
      addFilterValues(options.stationFilters, value);
      continue;
    }
    const numericValue = parsePositiveInteger(rawArg);
    if (numericValue !== null && !inlineValue && !rawArg.startsWith("-")) {
      options.pageSize = numericValue;
      continue;
    }
    options.warnings.push(`Unrecognized argument: ${rawArg}`);
  }
  return options;
}

function normalizeStatusFilter(value) {
  if (!value) {
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (
    normalized === "all" ||
    normalized === "any" ||
    normalized === "*" ||
    normalized === "everything"
  ) {
    return "all";
  }
  if (
    normalized === "played" ||
    normalized === "done" ||
    normalized === "complete"
  ) {
    return "played";
  }
  if (
    normalized === "unplayed" ||
    normalized === "not-played" ||
    normalized === "new" ||
    normalized === "fresh"
  ) {
    return "unplayed";
  }
  if (
    normalized === "inprogress" ||
    normalized === "in-progress" ||
    normalized === "in_progress" ||
    normalized === "partial" ||
    normalized === "progress"
  ) {
    return "inProgress";
  }
  return null;
}

function splitFlagValue(argument) {
  if (!argument || typeof argument !== "string") {
    return [argument, null];
  }
  if (!argument.startsWith("--")) {
    return [argument, null];
  }
  const equalsIndex = argument.indexOf("=");
  if (equalsIndex === -1) {
    return [argument, null];
  }
  return [argument.slice(0, equalsIndex), argument.slice(equalsIndex + 1)];
}

function parseFilterValues(rawValue) {
  if (rawValue === undefined || rawValue === null) {
    return [];
  }
  return String(rawValue)
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function addFilterValues(target, rawValue) {
  if (!Array.isArray(target)) {
    return target;
  }
  parseFilterValues(rawValue).forEach((value) => {
    if (!target.includes(value)) {
      target.push(value);
    }
  });
  return target;
}

export { parseCliArguments, parseSelectOptions };

export default {
  parseCliArguments,
  parseSelectOptions,
};
