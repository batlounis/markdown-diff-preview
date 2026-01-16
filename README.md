# Markdown Diff Preview

A VS Code / Cursor extension that shows a beautiful Markdown preview with **git diff highlighting** inline.

![Preview Screenshot](https://via.placeholder.com/800x500/0d1117/58a6ff?text=Markdown+Diff+Preview)

## Features

- 📝 **Live Markdown Preview** — Real-time rendering as you type
- 🟢 **Added Lines** — Highlighted with a green background and `+` indicator
- 🔴 **Removed Lines** — Shown in context with red highlighting
- 🔄 **Auto-refresh** — Updates when the document or git state changes
- 🌙 **Dark Theme** — Beautiful GitHub-inspired dark mode design
- 🔗 **Click to Navigate** — Click on diff lines to jump to that line in the editor

## Usage

1. Open any Markdown file
2. Press `Cmd+Shift+V` (Mac) or `Ctrl+Shift+V` (Windows/Linux)
3. Or click the preview icon in the editor title bar
4. Or run command: "Open Markdown Diff Preview"

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `markdownDiffPreview.diffBase` | `HEAD` | Git ref to compare against (e.g., `HEAD`, `main`, `origin/main`) |
| `markdownDiffPreview.showLineNumbers` | `true` | Show line numbers on hover |
| `markdownDiffPreview.highlightStyle` | `both` | How to display diff highlights: `inline`, `gutter`, or `both` |

## Examples

### New Content (Added)
Lines that have been added since the last commit are highlighted in green with a `+` indicator.

### Removed Content
Lines that were removed are shown as collapsed blocks above where they used to be, with a `−` indicator and red highlighting.

### Unchanged Content
Content that hasn't changed is rendered normally without any diff highlighting.

## Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode
npm run watch

# Package extension
npx @vscode/vsce package
```

## How It Works

1. **Git Integration** — Uses `git diff` to detect changes between the current file and a configurable base ref (default: `HEAD`)
2. **Line Mapping** — Maps diff hunks to line numbers in the current file
3. **Markdown Parsing** — Renders markdown with inline diff annotations
4. **Webview Panel** — Displays the preview in a side panel with custom styling

## Tech Stack

- TypeScript
- VS Code Extension API
- Webview for rendering
- Native Git commands (no external dependencies)

## License

MIT
