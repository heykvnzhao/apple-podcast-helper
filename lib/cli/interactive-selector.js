import React from "react";

import { DEFAULT_SELECT_PAGE_SIZE } from "../app-constants.js";
import catalog from "../catalog/index.js";
import { parsePositiveInteger } from "../utils/numbers.js";
import { loadInk } from "./ink-loader.js";
import outputFormat from "./output-format.js";

const { paginateEntries } = catalog;
const { truncateForDisplay, formatListeningStatusSummary } = outputFormat;

const INDENT = "  ";

let inkRender = null;
let InkBox = null;
let InkText = null;
let inkUseInput = null;
let inkUseApp = null;
let inkUseStdout = null;

async function ensureInkLoaded() {
  if (
    inkRender &&
    InkBox &&
    InkText &&
    inkUseInput &&
    inkUseApp &&
    inkUseStdout
  ) {
    return;
  }
  const inkModule = await loadInk();
  inkRender = inkModule.render;
  InkBox = inkModule.Box;
  InkText = inkModule.Text;
  inkUseInput = inkModule.useInput;
  inkUseApp = inkModule.useApp;
  inkUseStdout = inkModule.useStdout;
}

function buildSelectorEntryLines({
  entry,
  displayIndex,
  isActive,
  isSelected,
  indexWidth,
  maxWidth,
}) {
  const pointer = isActive ? ">" : " ";
  const safeIndexWidth = Math.max(indexWidth || 0, 2);
  const label = String(displayIndex || "").padStart(safeIndexWidth, " ");
  const showTitle = entry && entry.showTitle ? entry.showTitle : "Unknown show";
  const episodeTitle =
    entry && entry.episodeTitle ? entry.episodeTitle : "Unknown episode";
  const title = `${showTitle} - ${episodeTitle}`;
  const titleWidth = Math.max((maxWidth || 0) - (safeIndexWidth + 6), 16);
  const selectionMarker = isSelected ? "◉" : "◯";
  const titleSegments = [
    { text: `${pointer} ` },
    { text: `${selectionMarker} `, color: isSelected ? "green" : undefined },
    { text: `${label}. ` },
    { text: truncateForDisplay(title, titleWidth) },
  ];
  const metaParts = [];
  const entryMetadata = entry && entry.metadata ? entry.metadata : null;
  if (entryMetadata && entryMetadata.pubDateTime) {
    const dt = new Date(entryMetadata.pubDateTime);
    if (!Number.isNaN(dt.getTime())) {
      const hh = String(dt.getUTCHours()).padStart(2, "0");
      const mm = String(dt.getUTCMinutes()).padStart(2, "0");
      const datePart =
        entry && entry.pubDate && entry.pubDate !== "unknown-date"
          ? entry.pubDate
          : dt.toISOString().slice(0, 10);
      metaParts.push(`Published ${datePart} ${hh}:${mm} UTC`);
    } else if (entry && entry.pubDate && entry.pubDate !== "unknown-date") {
      metaParts.push(`Published ${entry.pubDate}`);
    }
  } else if (entry && entry.pubDate && entry.pubDate !== "unknown-date") {
    metaParts.push(`Published ${entry.pubDate}`);
  }
  const statusSummary = formatListeningStatusSummary(entry);
  if (statusSummary) {
    metaParts.push(statusSummary);
  }
  if (metaParts.length === 0) {
    return [
      {
        segments: titleSegments,
      },
    ];
  }
  const metaPrefixSpaces = " ".repeat(safeIndexWidth + 6);
  const metaWidth = Math.max((maxWidth || 0) - (safeIndexWidth + 6), 16);
  const metaText = `${metaPrefixSpaces}${truncateForDisplay(
    metaParts.join(" • "),
    metaWidth
  )}`;
  return [
    {
      segments: titleSegments,
    },
    {
      segments: [{ text: metaText }],
      dim: true,
    },
  ];
}

function statusColorForMessage(message) {
  if (!message) {
    return null;
  }
  if (message.startsWith("[ERROR]")) {
    return "red";
  }
  if (message.startsWith("[WARN]")) {
    return "yellow";
  }
  if (message.startsWith("[INFO]")) {
    return "blue";
  }
  return null;
}

function InteractiveSelectorView(props) {
  const {
    entries,
    basePageSize,
    status,
    filters,
    onResolve,
    stdoutColumns,
    stdoutRows,
  } = props;
  const { exit } = inkUseApp();
  const safeEntries = Array.isArray(entries) ? entries : [];
  const [cursor, setCursor] = React.useState(0);
  const [selectedSet, setSelectedSet] = React.useState(new Set());
  const [commandBuffer, setCommandBuffer] = React.useState("");
  const [statusMessage, setStatusMessage] = React.useState(null);
  const [terminalRows, setTerminalRows] = React.useState(stdoutRows || null);
  const [terminalColumns, setTerminalColumns] = React.useState(
    stdoutColumns || 80
  );
  const pageSizeLimit = Math.max(
    parsePositiveInteger(basePageSize) || DEFAULT_SELECT_PAGE_SIZE,
    1
  );
  const { stdout } = inkUseStdout();

  const computeResolvedPageSize = React.useCallback(() => {
    if (!terminalRows) {
      return pageSizeLimit;
    }
    const reservedLines = 7;
    const linesPerEntry = 3;
    const available = terminalRows - reservedLines;
    if (!Number.isFinite(available) || available <= 0) {
      return 1;
    }
    const capacity = Math.floor(available / linesPerEntry);
    if (!Number.isFinite(capacity) || capacity < 1) {
      return 1;
    }
    return Math.max(1, Math.min(pageSizeLimit, capacity));
  }, [pageSizeLimit, terminalRows]);

  const resolvedPageSize = computeResolvedPageSize();

  React.useEffect(() => {
    if (!stdout) {
      return undefined;
    }
    const handleResize = () => {
      setTerminalRows(typeof stdout.rows === "number" ? stdout.rows : null);
      setTerminalColumns(
        typeof stdout.columns === "number" && stdout.columns > 0
          ? stdout.columns
          : 80
      );
    };
    handleResize();
    stdout.on("resize", handleResize);
    return () => {
      if (typeof stdout.off === "function") {
        stdout.off("resize", handleResize);
      } else {
        stdout.removeListener("resize", handleResize);
      }
    };
  }, [stdout]);

  React.useEffect(() => {
    if (safeEntries.length === 0 && cursor !== 0) {
      setCursor(0);
    } else if (safeEntries.length > 0 && cursor >= safeEntries.length) {
      setCursor(safeEntries.length - 1);
    }
  }, [cursor, safeEntries.length]);

  const totalCount = safeEntries.length;
  const totalPages = Math.max(
    Math.ceil(totalCount / Math.max(resolvedPageSize, 1)),
    1
  );
  const currentPage =
    totalCount === 0
      ? 1
      : Math.floor(cursor / Math.max(resolvedPageSize, 1)) + 1;
  const pagination = paginateEntries(
    safeEntries,
    currentPage,
    resolvedPageSize
  );
  const {
    items,
    page,
    total,
    limit,
    totalPages: paginationTotalPages,
  } = pagination;
  const pageCount = paginationTotalPages > 0 ? paginationTotalPages : 1;
  const startIndex = page > 0 ? (page - 1) * limit : 0;
  const usableWidth = Math.max((terminalColumns || 80) - INDENT.length, 40);
  const indexWidth = Math.max(
    String(Math.max(total, safeEntries.length, resolvedPageSize) || 0).length,
    2
  );

  const handleResolve = React.useCallback(
    (result) => {
      if (typeof onResolve === "function") {
        onResolve(result);
      }
      exit();
    },
    [exit, onResolve]
  );

  const toggleSelect = React.useCallback(
    (index) => {
      setSelectedSet((prev) => {
        const next = new Set(prev);
        if (next.has(index)) {
          next.delete(index);
        } else {
          next.add(index);
        }
        return next;
      });
    },
    [setSelectedSet]
  );

  const getSelectedIndices = React.useCallback(() => {
    return Array.from(selectedSet).sort((a, b) => a - b);
  }, [selectedSet]);

  const moveCursorToSelected = React.useCallback(
    (direction) => {
      const selected = getSelectedIndices();
      if (!selected || selected.length === 0) {
        setStatusMessage("[INFO] No items selected.");
        return;
      }
      if (selected.length === 1) {
        setCursor(selected[0]);
        return;
      }
      let idx = selected.findIndex((v) => v === cursor);
      if (idx === -1) {
        idx = direction > 0 ? 0 : selected.length - 1;
      } else {
        idx = (idx + direction + selected.length) % selected.length;
      }
      setCursor(selected[idx]);
    },
    [getSelectedIndices, cursor]
  );

  const handleSelectIndex = React.useCallback(
    (index) => {
      if (index < 0 || index >= safeEntries.length) {
        setStatusMessage(
          `[WARN] Selection ${index + 1} is out of range (1-${
            safeEntries.length || 0
          }).`
        );
        return;
      }
      const target = safeEntries[index];
      if (!target || !target.absolutePath || !target.hasMarkdown) {
        const identifier =
          (target && target.normalizedRelativePath) ||
          (target && target.relativePath) ||
          (target && target.identifier) ||
          String(index + 1);
        setStatusMessage(`[ERROR] Markdown file not found for ${identifier}.`);
        return;
      }
      handleResolve(target);
    },
    [handleResolve, safeEntries]
  );

  const handleMoveCursor = React.useCallback(
    (delta) => {
      if (safeEntries.length === 0) {
        setStatusMessage("[INFO] No items available.");
        return;
      }
      setCursor((prev) => {
        const next = prev + delta;
        if (next < 0) {
          setStatusMessage("[INFO] Already at the first item.");
          return 0;
        }
        if (next >= safeEntries.length) {
          setStatusMessage("[INFO] Already at the last item.");
          return safeEntries.length - 1;
        }
        return next;
      });
    },
    [safeEntries.length]
  );

  const handleMovePage = React.useCallback(
    (delta) => {
      if (safeEntries.length === 0) {
        setStatusMessage("[INFO] No items available.");
        setCursor(0);
        return;
      }
      setCursor((prev) => {
        const safePageSize = Math.max(resolvedPageSize, 1);
        const current = Math.floor(prev / safePageSize) + 1;
        const maxPages = Math.max(
          Math.ceil(safeEntries.length / safePageSize),
          1
        );
        let nextPage = current + delta;
        if (nextPage < 1) {
          nextPage = 1;
        }
        if (nextPage > maxPages) {
          nextPage = maxPages;
        }
        if (nextPage === current) {
          setStatusMessage(
            delta > 0
              ? "[INFO] Already at the last page."
              : "[INFO] Already at the first page."
          );
          return prev;
        }
        const start = (nextPage - 1) * safePageSize;
        return Math.min(safeEntries.length - 1, start);
      });
    },
    [resolvedPageSize, safeEntries.length]
  );

  inkUseInput((input, key) => {
    setStatusMessage(null);
    if (key.ctrl && input === "c") {
      handleResolve(null);
      return;
    }
    if (key.escape) {
      handleResolve(null);
      return;
    }
    if (key.upArrow) {
      setCommandBuffer("");
      handleMoveCursor(-1);
      return;
    }
    if (key.downArrow) {
      setCommandBuffer("");
      handleMoveCursor(1);
      return;
    }
    if (key.leftArrow || key.pageUp) {
      setCommandBuffer("");
      handleMovePage(-1);
      return;
    }
    if (key.rightArrow || key.pageDown) {
      setCommandBuffer("");
      handleMovePage(1);
      return;
    }
    if (key.return) {
      if (commandBuffer) {
        const numeric = Number.parseInt(commandBuffer, 10);
        setCommandBuffer("");
        if (Number.isNaN(numeric)) {
          setStatusMessage("[WARN] Invalid numeric selection.");
          return;
        }
        handleSelectIndex(numeric - 1);
        return;
      }
      // If nothing selected, behave as before and use current cursor
      if (selectedSet.size === 0) {
        handleSelectIndex(cursor);
        return;
      }
      // If some selected, resolve with only those selected entries
      const selectedIndices = getSelectedIndices();
      const selectedEntries = selectedIndices
        .map((i) => safeEntries[i])
        .filter(Boolean);
      if (selectedEntries.length === 0) {
        setStatusMessage("[WARN] No valid selected transcripts found.");
        return;
      }
      handleResolve(selectedEntries);
      return;
    }
    if (key.backspace || input === "\u007f" || input === "\u0008") {
      setCommandBuffer((prev) => prev.slice(0, -1));
      return;
    }
    if (!input) {
      return;
    }
    // space toggles selection of the currently highlighted item
    if (input === " ") {
      setCommandBuffer("");
      toggleSelect(cursor);
      return;
    }
    // '.' ',' '>' '<' navigate among selected items (support several key variants)
    if (input === "." || input === ">" || input === "," || input === "<") {
      setCommandBuffer("");
      // normalize to direction
      const forward = input === "." || input === ">";
      const backward = input === "," || input === "<";
      if (forward) {
        if (selectedSet.size >= 1) {
          moveCursorToSelected(1);
          setStatusMessage(null);
        }
      } else if (backward) {
        if (selectedSet.size >= 1) {
          moveCursorToSelected(-1);
          setStatusMessage(null);
        }
      }
      return;
    }
    const lower = input.toLowerCase();
    if (lower === "q") {
      handleResolve(null);
      return;
    }
    if (lower === "n") {
      setCommandBuffer("");
      handleMovePage(1);
      return;
    }
    if (lower === "p") {
      setCommandBuffer("");
      handleMovePage(-1);
      return;
    }
    if (/^[0-9]$/.test(input)) {
      setCommandBuffer((prev) => `${prev}${input}`);
    }
  });

  const statusParts = [];
  if (status && status !== "all") {
    statusParts.push(`status=${status}`);
  }
  if (
    filters &&
    Array.isArray(filters.showFilters) &&
    filters.showFilters.length > 0
  ) {
    statusParts.push(`show~${filters.showFilters.join(" OR ")}`);
  }
  if (
    filters &&
    Array.isArray(filters.stationFilters) &&
    filters.stationFilters.length > 0
  ) {
    statusParts.push(`station~${filters.stationFilters.join(" OR ")}`);
  }

  const lines = [];
  lines.push({
    text: `${INDENT}Select a transcript to copy`,
    color: "cyan",
    bold: true,
  });
  if (selectedSet.size > 0) {
    lines.push({
      text: `${INDENT}Selected: ${selectedSet.size}`,
      dim: true,
    });
  } else {
    // Render Selected 0 to avoid layout shifts when toggling
    lines.push({
      text: `${INDENT}Selected: 0`,
      dim: true,
    });
  }
  if (statusParts.length > 0) {
    lines.push({
      text: `${INDENT}${statusParts.join(" | ")}`,
      color: null,
    });
  }
  lines.push({
    text: `${INDENT}Page ${page}/${pageCount} — ${total} transcript(s)`,
  });
  lines.push({ text: " " });
  if (items.length === 0) {
    lines.push({
      text: `${INDENT}[No transcripts available]`,
      dim: true,
    });
  } else {
    items.forEach((entry, itemIndex) => {
      const absoluteIndex = startIndex + itemIndex;
      const displayIndex = absoluteIndex + 1;
      const isActive = absoluteIndex === cursor;
      const isSelected = selectedSet.has(absoluteIndex);
      const entryLines = buildSelectorEntryLines({
        entry,
        displayIndex,
        isActive,
        isSelected,
        indexWidth,
        maxWidth: usableWidth,
      });
      entryLines.forEach((line, lineIndex) => {
        const segments = Array.isArray(line.segments)
          ? line.segments
          : [{ text: String(line) }];
        // Prefix indentation as its own segment so it inherits no special color unless provided
        const prefixed = [{ text: INDENT }, ...segments];
        lines.push({
          segments: prefixed,
          color: isActive ? "cyan" : null,
          dim: line.dim || false,
          bold: line.bold || false,
          key: `entry-${absoluteIndex}-${lineIndex}`,
        });
      });
      if (itemIndex < items.length - 1) {
        lines.push({
          text: `${INDENT} `,
          dim: true,
          key: `spacer-${absoluteIndex}`,
        });
      }
    });
  }
  lines.push({ text: " " });
  // Build help text dynamically depending on selection state
  const helpParts = [
    "↑/↓ move",
    "←/→ page",
    "digits jump",
    "enter confirm",
    "q exit",
  ];
  helpParts.unshift("space select/deselect");
  if (selectedSet.size > 1) {
    helpParts.push(". next selected", ", prev selected");
  }
  lines.push({
    text: `${INDENT}${helpParts.join(" • ")}`,
    dim: true,
  });
  if (commandBuffer) {
    lines.push({
      text: `${INDENT}Input: ${commandBuffer}`,
    });
  }
  if (statusMessage) {
    lines.push({
      text: `${INDENT}${statusMessage}`,
      color: statusColorForMessage(statusMessage),
    });
  }

  return React.createElement(
    InkBox,
    { flexDirection: "column" },
    lines.map((line, index) => {
      const key = line.key || `line-${index}`;
      if (Array.isArray(line.segments)) {
        return React.createElement(
          InkText,
          {
            key,
            color: line.color || undefined,
            dimColor: line.dim || false,
            bold: line.bold || false,
          },
          line.segments.map((seg, segIndex) =>
            React.createElement(
              InkText,
              {
                key: `${key}-seg-${segIndex}`,
                color: seg.color || undefined,
                dimColor: seg.dim || false,
                bold: seg.bold || false,
              },
              seg.text
            )
          )
        );
      }
      return React.createElement(
        InkText,
        {
          key,
          color: line.color || undefined,
          dimColor: line.dim || false,
          bold: line.bold || false,
        },
        line.text
      );
    })
  );
}

async function runInteractiveSelector({
  entries,
  pageSize,
  status,
  filters = null,
}) {
  return new Promise((resolve) => {
    let settled = false;
    const basePageSize = Math.max(
      parsePositiveInteger(pageSize) || DEFAULT_SELECT_PAGE_SIZE,
      1
    );
    const startApp = async () => {
      await ensureInkLoaded();
      const inkApp = inkRender(
        React.createElement(InteractiveSelectorView, {
          entries,
          basePageSize,
          status,
          filters,
          stdoutColumns:
            typeof process.stdout.columns === "number" &&
            process.stdout.columns > 0
              ? process.stdout.columns
              : 80,
          stdoutRows:
            typeof process.stdout.rows === "number" && process.stdout.rows > 0
              ? process.stdout.rows
              : null,
          onResolve: (result) => {
            if (!settled) {
              settled = true;
              resolve(result);
            }
          },
        }),
        {
          stdout: process.stdout,
          stdin: process.stdin,
          exitOnCtrlC: false,
        }
      );
      inkApp.waitUntilExit().then(() => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      });
    };
    startApp().catch((error) => {
      if (!settled) {
        settled = true;
        console.warn(
          `[WARN] Unable to start interactive selector: ${error.message}`
        );
        resolve(null);
      }
    });
  });
}

export { buildSelectorEntryLines, runInteractiveSelector };
