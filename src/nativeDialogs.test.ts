import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// In the desktop app tauri-plugin-dialog replaces window.confirm/alert/prompt with async functions that need a frontend dialog permission this app never grants. `if (!confirm(...))` then sees a Promise, never asks and always proceeds (macOS acceptance M2-06/M4-11, 2026-11-06). jsdom keeps the synchronous browser versions, so UI tests cannot catch it; this guard keeps them out of the source.
const srcDir = join(__dirname);
const browserDialogCall = /(?:\bwindow\s*\.\s*|(?<![\w$.]))(?:confirm|alert|prompt)\s*\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("browser dialog guard", () => {
  it("finds the source files it guards", () => {
    const files = sourceFiles(srcDir).map((file) => relative(srcDir, file));
    expect(files).toContain("App.tsx");
    expect(files).toContain(join("components", "SavedSearchDialog.tsx"));
  });

  it("matches the call shapes that broke and ignores app handlers", () => {
    for (const call of ["window.confirm(`x`)", "if (!confirm(message))", "window.alert('x')", "prompt(\"name\")"]) expect(browserDialogCall.test(call)).toBe(true);
    for (const safe of ["onConfirm()", "confirmRemoval()", "void confirmRemoveLibrary()", "setConfirmingDelete(true)", "dialog.confirm"]) expect(browserDialogCall.test(safe)).toBe(false);
  });

  it("never calls window.confirm, alert or prompt from app source", () => {
    const offenders = sourceFiles(srcDir).flatMap((file) => readFileSync(file, "utf8").split(/\r?\n/)
      .map((line, index) => ({ line: line.trim(), at: `${relative(srcDir, file)}:${index + 1}` }))
      .filter(({ line }) => !line.startsWith("//") && !line.startsWith("*") && browserDialogCall.test(line))
      .map(({ at, line }) => `${at} ${line.slice(0, 120)}`));
    expect(offenders).toEqual([]);
  });
});
