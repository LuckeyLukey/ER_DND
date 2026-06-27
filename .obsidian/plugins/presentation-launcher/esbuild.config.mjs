import esbuild from "esbuild";
import builtins from "builtin-modules";

const isWatch = process.argv.includes("--watch");

const context = await esbuild.context({
  banner: {
    js: "/* Presentation Launcher for Obsidian */"
  },
  entryPoints: ["main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: "inline",
  treeShaking: true,
  outfile: "main.js"
});

if (isWatch) {
  await context.watch();
  console.log("Watching Presentation Launcher...");
} else {
  await context.rebuild();
  await context.dispose();
}
