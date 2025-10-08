import React from "react";
import { loadInk } from "../cli/ink-loader.js";
import { formatMarkdown, getLastRawSummary } from "./gemini-formatting.js";

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

  const raw = getLastRawSummary() || "";
  const formatted = formatMarkdown(raw);
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
      `Summary — lines ${start + 1}-${end} of ${lines.length}`
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
    React.createElement(
      InkText,
      { dimColor: true, marginTop: 1 },
      `↑/↓ line • ←/→ page • q quit`
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
