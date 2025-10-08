import React from "react";
import { loadInk } from "./ink-loader.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_INTERVAL_MS = 120;

function truncateDetail(value, maxLength = 56) {
  if (!value) {
    return "";
  }
  const text = String(value);
  if (text.length <= maxLength) {
    return text;
  }
  const suffix = "...";
  const sliceLength = Math.max(maxLength - suffix.length, 0);
  return `${text.slice(0, sliceLength)}${suffix}`;
}

let inkRender = null;
let InkBox = null;
let InkText = null;
let inkLoadedPromise = null;

function ensureInkLoaded() {
  if (inkRender && InkBox && InkText) {
    return Promise.resolve();
  }
  if (!inkLoadedPromise) {
    inkLoadedPromise = loadInk()
      .then((inkModule) => {
        inkRender = inkModule.render;
        InkBox = inkModule.Box;
        InkText = inkModule.Text;
      })
      .catch((error) => {
        inkLoadedPromise = null;
        throw error;
      });
  }
  return inkLoadedPromise;
}

function ProgressIndicatorView({ frame, label, processed, total, detail }) {
  if (!InkBox || !InkText) {
    return null;
  }
  const tokens = [`${frame} ${label}`];
  if (typeof total === "number" && total > 0) {
    const bounded = Math.min(Math.max(processed, 0), total);
    const percent = Math.min(Math.round((bounded / total) * 100), 100);
    tokens.push(`${bounded}/${total}`);
    tokens.push(`${percent}%`);
  } else if (processed > 0) {
    tokens.push(String(processed));
  }
  if (detail) {
    tokens.push(`- ${detail}`);
  }
  const line = tokens.join("  ");
  return React.createElement(
    InkBox,
    null,
    React.createElement(InkText, null, line)
  );
}

function createProgressIndicator({
  label,
  total = 0,
  stream = process.stderr,
}) {
  const supportsInteractive = Boolean(stream && stream.isTTY);
  if (!supportsInteractive) {
    let processed = 0;
    let detail = "";
    return {
      start() {
        processed = 0;
        detail = "";
      },
      update(update = {}) {
        if (typeof update.processed === "number") {
          processed = update.processed;
        } else {
          processed += 1;
        }
        if (update.detail) {
          detail = truncateDetail(update.detail);
        }
      },
      done(message) {
        if (message) {
          stream.write
            ? stream.write(`✅ ${message}\n`)
            : console.log(`✅ ${message}`);
        }
      },
      fail(message) {
        if (message) {
          stream.write
            ? stream.write(`❌ ${message}\n`)
            : console.log(`❌ ${message}`);
        }
      },
      stop() {},
    };
  }

  let frameIndex = 0;
  let processed = 0;
  let detail = "";
  let intervalId = null;
  let active = false;
  let app = null;

  function renderFrame() {
    if (!inkRender || !InkBox || !InkText) {
      return;
    }
    const view = React.createElement(ProgressIndicatorView, {
      frame: SPINNER_FRAMES[frameIndex],
      label,
      processed,
      total,
      detail,
    });
    if (!app) {
      app = inkRender(view, { stdout: stream });
    } else {
      app.rerender(view);
    }
  }

  function cleanup(finalMessage, prefix = "") {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (app) {
      app.unmount();
      app = null;
    }
    active = false;
    if (finalMessage) {
      const line = `${prefix}${finalMessage}\n`;
      if (typeof stream.write === "function") {
        stream.write(line);
      } else {
        console.log(line.trim());
      }
    }
  }

  return {
    start() {
      if (active) {
        return;
      }
      active = true;
      frameIndex = 0;
      processed = 0;
      detail = "";
      ensureInkLoaded()
        .then(() => {
          if (!active) {
            return;
          }
          renderFrame();
          intervalId = setInterval(() => {
            frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
            renderFrame();
          }, FRAME_INTERVAL_MS);
        })
        .catch((error) => {
          if (active) {
            stream.write
              ? stream.write(`[WARN] Spinner unavailable: ${error.message}\n`)
              : console.warn(`[WARN] Spinner unavailable: ${error.message}`);
            active = false;
          }
        });
    },
    update(update = {}) {
      if (!active) {
        return;
      }
      if (typeof update.processed === "number") {
        processed = update.processed;
      } else {
        processed += 1;
      }
      if (update.detail) {
        detail = truncateDetail(update.detail);
      }
      if (inkRender) {
        renderFrame();
      } else {
        ensureInkLoaded()
          .then(() => {
            if (active) {
              renderFrame();
            }
          })
          .catch(() => {});
      }
    },
    done(message) {
      cleanup(message, "✅ ");
    },
    fail(message) {
      cleanup(message, "❌ ");
    },
    stop() {
      if (!active) {
        return;
      }
      cleanup(null);
    },
  };
}

export { createProgressIndicator };
