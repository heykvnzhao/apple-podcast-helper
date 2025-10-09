import React from "react";
import { loadInk } from "../cli/ink-loader.js";
import {
  formatMarkdown,
  getLastRawSummaries,
  getLastRawSummary,
} from "./gemini-formatting.js";

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

function splitLines(str) {
  if (!str) return [];
  return String(str).replace(/\r\n/g, "\n").split("\n");
}

function Viewer(props) {
  const { stdoutColumns, stdoutRows } = props;
  const { exit } = inkUseApp();
  const { stdout } = inkUseStdout();
  const [start, setStart] = React.useState(0);
  const [termCols, setTermCols] = React.useState(stdoutColumns || 80);
  const [termRows, setTermRows] = React.useState(stdoutRows || null);

  // Load summaries (may be an array of strings or objects)
  const initialSummaries = getLastRawSummaries();
  const [summaries] = React.useState(
    Array.isArray(initialSummaries)
      ? initialSummaries
      : initialSummaries
      ? [initialSummaries]
      : []
  );
  const [currentSummaryIndex, setCurrentSummaryIndex] = React.useState(0);

  function summaryToText(s) {
    if (!s) return "";
    if (typeof s === "string") return s;
    if (typeof s === "object" && typeof s.text === "string") return s.text;
    return String(s);
  }

  function summaryEntry(s) {
    if (!s) return null;
    if (typeof s === "object" && s.entry) return s.entry;
    return null;
  }

  const currentRaw =
    summaries && summaries.length > 0
      ? summaryToText(summaries[currentSummaryIndex])
      : getLastRawSummary() || "";
  const formatted = formatMarkdown(currentRaw);
  const lines = splitLines(formatted);

  React.useEffect(() => {
    if (!stdout) return undefined;
    const handleResize = () => {
      setTermCols(typeof stdout.columns === "number" ? stdout.columns : 80);
      setTermRows(typeof stdout.rows === "number" ? stdout.rows : null);
    };
    handleResize();
    stdout.on("resize", handleResize);
    return () => {
      if (stdout.off) stdout.off("resize", handleResize);
      else stdout.removeListener("resize", handleResize);
    };
  }, [stdout]);

  const viewportHeight = Math.max((termRows || 24) - 4, 3);

  const maxStart = Math.max(0, Math.max(0, lines.length - viewportHeight));

  const clampStart = React.useCallback(
    (s) => {
      if (!Number.isFinite(s)) return 0;
      if (s < 0) return 0;
      if (s > maxStart) return maxStart;
      return s;
    },
    [maxStart]
  );

  const moveViewport = React.useCallback(
    (delta) => {
      setStart((prev) => clampStart(prev + delta));
    },
    [clampStart]
  );

  const pageMove = React.useCallback(
    (deltaPages) => {
      setStart((prev) => clampStart(prev + deltaPages * viewportHeight));
    },
    [clampStart, viewportHeight]
  );

  inkUseInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    if (key.escape) {
      exit();
      return;
    }
    if (key.upArrow) {
      moveViewport(-1);
      return;
    }
    if (key.downArrow) {
      moveViewport(1);
      return;
    }
    if (key.leftArrow || key.pageUp) {
      pageMove(-1);
      return;
    }
    if (key.rightArrow || key.pageDown) {
      pageMove(1);
      return;
    }
    if (input && input.toLowerCase && input.toLowerCase() === "q") {
      exit();
      return;
    }
    // allow cycling between multiple summaries with '.' '>' ',' '<'
    if (input === "." || input === ">") {
      if (summaries && summaries.length > 1) {
        setCurrentSummaryIndex((i) => (i + 1) % summaries.length);
        setStart(0);
      }
      return;
    }
    if (input === "," || input === "<") {
      if (summaries && summaries.length > 1) {
        setCurrentSummaryIndex(
          (i) => (i - 1 + summaries.length) % summaries.length
        );
        setStart(0);
      }
      return;
    }
  });

  // ensure start is clamped when lines or viewportHeight change
  React.useEffect(() => {
    setStart((s) => clampStart(s || 0));
  }, [lines.length, viewportHeight, clampStart]);

  const end = Math.min(lines.length, start + viewportHeight);
  const visible = lines.slice(start, end);

  return React.createElement(
    InkBox,
    { flexDirection: "column" },
    React.createElement(
      InkText,
      { color: "cyan", bold: true },
      `Summary ${
        summaries && summaries.length > 0
          ? `${currentSummaryIndex + 1}/${summaries.length} — `
          : ""
      }lines ${start + 1}-${end} of ${lines.length}`
    ),
    React.createElement(
      InkBox,
      { marginTop: 1, flexDirection: "column" },
      visible.map((l, i) => {
        const content =
          typeof l === "string" && l.trim().length === 0 ? " " : l;
        return React.createElement(
          InkText,
          {
            key: `line-${start + i}`,
          },
          content
        );
      })
    ),
    // metadata and episode description are included in the markdown itself
    React.createElement(
      InkText,
      { dimColor: true, marginTop: 1 },
      `${
        summaries && summaries.length > 1 ? "./, cycle summaries • " : ""
      }↑/↓ line • ←/→ page • q quit`
    )
  );
}

async function runInteractiveGeminiViewer() {
  await ensureInkLoaded();
  return new Promise((resolve) => {
    let settled = false;
    const app = inkRender(
      React.createElement(Viewer, {
        stdoutColumns:
          typeof process.stdout.columns === "number" &&
          process.stdout.columns > 0
            ? process.stdout.columns
            : 80,
        stdoutRows:
          typeof process.stdout.rows === "number" && process.stdout.rows > 0
            ? process.stdout.rows
            : null,
      }),
      { stdout: process.stdout, stdin: process.stdin, exitOnCtrlC: false }
    );
    app.waitUntilExit().then(() => {
      if (!settled) {
        settled = true;
        resolve();
      }
    });
  });
}

export { runInteractiveGeminiViewer };
