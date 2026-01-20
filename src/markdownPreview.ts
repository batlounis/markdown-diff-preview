import * as vscode from 'vscode';
import { getGitDiff, getGitBranch, getGitStatus, FileDiff } from './gitDiff';
import { renderMarkdownWithDiff } from './markdownRenderer';

export class MarkdownDiffPreviewPanel {
    public static currentPanel: MarkdownDiffPreviewPanel | undefined;
    private static readonly viewType = 'markdownDiffPreview';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _document: vscode.TextDocument | undefined;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri, document: vscode.TextDocument) {
        const column = vscode.ViewColumn.Beside;

        if (MarkdownDiffPreviewPanel.currentPanel) {
            MarkdownDiffPreviewPanel.currentPanel._panel.reveal(column);
            MarkdownDiffPreviewPanel.currentPanel._document = document;
            MarkdownDiffPreviewPanel.currentPanel._update();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            MarkdownDiffPreviewPanel.viewType,
            'MD Diff Preview',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        MarkdownDiffPreviewPanel.currentPanel = new MarkdownDiffPreviewPanel(panel, extensionUri, document);
    }

    public static updateIfVisible(document: vscode.TextDocument) {
        if (MarkdownDiffPreviewPanel.currentPanel) {
            MarkdownDiffPreviewPanel.currentPanel._document = document;
            MarkdownDiffPreviewPanel.currentPanel._update();
        }
    }

    public static refresh() {
        if (MarkdownDiffPreviewPanel.currentPanel) {
            MarkdownDiffPreviewPanel.currentPanel._update();
        }
    }

    public static dispose() {
        if (MarkdownDiffPreviewPanel.currentPanel) {
            MarkdownDiffPreviewPanel.currentPanel._panel.dispose();
        }
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, document: vscode.TextDocument) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._document = document;

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.onDidChangeViewState(
            () => {
                if (this._panel.visible) {
                    this._update();
                }
            },
            null,
            this._disposables
        );

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'scrollToLine':
                        this._scrollEditorToLine(message.line);
                        break;
                    case 'refresh':
                        this._update();
                        break;
                    case 'updateElement':
                        await this._updateSourceElement(message.line, message.elementPath);
                        break;
                    case 'undo':
                        await this._executeUndoRedo('undo');
                        break;
                    case 'redo':
                        await this._executeUndoRedo('redo');
                        break;
                    case 'selectLines':
                        await this._selectLinesInEditor(message.startLine, message.endLine);
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    private async _updateSourceElement(line: number, elementInfo: { 
        elementType: string; 
        originalText: string; 
        newText: string;
        path: Array<{ tag: string; index: number }>;
    }) {
        if (!this._document) return;

        const lineIndex = line - 1;
        if (lineIndex < 0 || lineIndex >= this._document.lineCount) return;

        const originalLine = this._document.lineAt(lineIndex);
        const lineText = originalLine.text;
        const { elementType, originalText, newText } = elementInfo;

        let updatedLineText = lineText;

        // Map HTML element types back to markdown syntax
        switch (elementType) {
            case 'strong':
                // Replace **originalText** or __originalText__ with **newText**
                updatedLineText = lineText
                    .replace(`**${originalText}**`, `**${newText}**`)
                    .replace(`__${originalText}__`, `**${newText}**`);
                break;
                
            case 'em':
                // Replace *originalText* or _originalText_ with *newText*
                updatedLineText = lineText
                    .replace(`*${originalText}*`, `*${newText}*`)
                    .replace(`_${originalText}_`, `*${newText}*`);
                break;
                
            case 'del':
                // Replace ~~originalText~~ with ~~newText~~
                updatedLineText = lineText.replace(`~~${originalText}~~`, `~~${newText}~~`);
                break;
                
            case 'code':
                // Replace `originalText` with `newText`
                updatedLineText = lineText.replace(`\`${originalText}\``, `\`${newText}\``);
                break;
                
            case 'a':
                // Replace link text [originalText](url) with [newText](url)
                const linkRegex = new RegExp(`\\[${this._escapeRegex(originalText)}\\]\\(([^)]+)\\)`);
                updatedLineText = lineText.replace(linkRegex, `[${newText}]($1)`);
                break;
                
            case 'td':
            case 'th':
                // Table cell - find and replace the cell content
                // This is trickier - need to find the right cell in the pipe-separated line
                updatedLineText = lineText.replace(originalText, newText);
                break;

            case 'span':
                // Plain text span - just replace the text directly
                // Make sure we don't accidentally replace text inside formatting
                updatedLineText = this._replaceUnformattedText(lineText, originalText, newText);
                break;
                
            default:
                // For plain elements (p, h1-h6, li), replace the content but preserve prefixes
                const headerMatch = lineText.match(/^(#{1,6}\s+)/);
                const listMatch = lineText.match(/^(\s*[-*+]\s+)/);
                const olMatch = lineText.match(/^(\s*\d+\.\s+)/);
                const quoteMatch = lineText.match(/^(>\s*)/);
                
                if (headerMatch) {
                    updatedLineText = headerMatch[1] + newText;
                } else if (listMatch) {
                    updatedLineText = listMatch[1] + newText;
                } else if (olMatch) {
                    updatedLineText = olMatch[1] + newText;
                } else if (quoteMatch) {
                    updatedLineText = quoteMatch[1] + newText;
                } else {
                    updatedLineText = newText;
                }
                break;
        }

        // Only apply if there's a change
        if (updatedLineText !== lineText) {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(
                this._document.uri,
                originalLine.range,
                updatedLineText
            );
            await vscode.workspace.applyEdit(edit);
        }
    }

    private _escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private async _executeUndoRedo(action: 'undo' | 'redo') {
        if (!this._document) return;

        // Find the editor for this document
        let targetEditor = vscode.window.visibleTextEditors.find(
            editor => editor.document.uri.toString() === this._document!.uri.toString()
        );

        // If not visible, open it
        if (!targetEditor) {
            const doc = await vscode.workspace.openTextDocument(this._document.uri);
            targetEditor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One, false);
        }

        // Focus the editor temporarily to execute undo/redo
        if (targetEditor) {
            await vscode.window.showTextDocument(targetEditor.document, targetEditor.viewColumn, false);
            await vscode.commands.executeCommand(action);
            // Bring focus back to webview
            this._panel.reveal(undefined, true);
        }
    }

    private _replaceUnformattedText(lineText: string, originalText: string, newText: string): string {
        // Replace text that's NOT inside markdown formatting
        // We need to be careful not to replace text that's inside **...**, *...*, etc.
        
        const escapedOriginal = this._escapeRegex(originalText);
        
        // Try to find the text that's not wrapped in formatting markers
        // This regex looks for the text not preceded/followed by formatting chars
        const patterns = [
            // Not inside bold
            `(?<!\\*\\*)${escapedOriginal}(?!\\*\\*)`,
            // Not inside italic (single asterisk)
            `(?<!\\*)${escapedOriginal}(?!\\*)`,
            // Not inside code
            `(?<!\`)${escapedOriginal}(?!\`)`,
            // Not inside strikethrough
            `(?<!~~)${escapedOriginal}(?!~~)`
        ];
        
        // Simple approach: just replace if found and not inside formatting
        // Check if the original text exists outside of formatting
        let result = lineText;
        
        // Find all formatted regions and their positions
        const formattedRegions: Array<{start: number; end: number}> = [];
        
        // Match **...**, *...*, `...`, ~~...~~, [...](...) 
        const formatPatterns = [
            /\*\*[^*]+\*\*/g,
            /\*[^*]+\*/g,
            /`[^`]+`/g,
            /~~[^~]+~~/g,
            /\[[^\]]+\]\([^)]+\)/g
        ];
        
        for (const pattern of formatPatterns) {
            let match;
            while ((match = pattern.exec(lineText)) !== null) {
                formattedRegions.push({ start: match.index, end: match.index + match[0].length });
            }
        }
        
        // Find the original text in the line
        let searchStart = 0;
        let foundIndex = -1;
        
        while ((foundIndex = lineText.indexOf(originalText, searchStart)) !== -1) {
            // Check if this occurrence is inside a formatted region
            const isInFormatted = formattedRegions.some(region => 
                foundIndex >= region.start && foundIndex < region.end
            );
            
            if (!isInFormatted) {
                // Found it outside formatting - replace it
                result = lineText.slice(0, foundIndex) + newText + lineText.slice(foundIndex + originalText.length);
                break;
            }
            
            searchStart = foundIndex + 1;
        }
        
        return result;
    }

    private async _scrollEditorToLine(line: number) {
        if (!this._document) return;

        // Find the editor showing this document (may not be active since webview has focus)
        let targetEditor = vscode.window.visibleTextEditors.find(
            editor => editor.document.uri.toString() === this._document!.uri.toString()
        );

        // If not visible, open the document
        if (!targetEditor) {
            const doc = await vscode.workspace.openTextDocument(this._document.uri);
            targetEditor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
        }

        if (targetEditor) {
            const lineIndex = line - 1;
            const lineText = targetEditor.document.lineAt(lineIndex);
            const lineStart = new vscode.Position(lineIndex, 0);
            const lineEnd = new vscode.Position(lineIndex, lineText.text.length);
            
            // Select the entire line
            targetEditor.selection = new vscode.Selection(lineStart, lineEnd);
            targetEditor.revealRange(
                new vscode.Range(lineStart, lineEnd), 
                vscode.TextEditorRevealType.InCenter
            );
        }
    }

    private async _selectLinesInEditor(startLine: number, endLine: number) {
        if (!this._document) return;

        // Find the editor showing this document
        let targetEditor = vscode.window.visibleTextEditors.find(
            editor => editor.document.uri.toString() === this._document!.uri.toString()
        );

        // If not visible, open the document
        if (!targetEditor) {
            const doc = await vscode.workspace.openTextDocument(this._document.uri);
            targetEditor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
        }

        if (targetEditor) {
            const startLineIndex = Math.max(0, startLine - 1);
            const endLineIndex = Math.min(targetEditor.document.lineCount - 1, endLine - 1);
            
            const startPos = new vscode.Position(startLineIndex, 0);
            const endLineText = targetEditor.document.lineAt(endLineIndex);
            const endPos = new vscode.Position(endLineIndex, endLineText.text.length);
            
            // Select from start of first line to end of last line
            targetEditor.selection = new vscode.Selection(startPos, endPos);
            targetEditor.revealRange(
                new vscode.Range(startPos, endPos), 
                vscode.TextEditorRevealType.InCenterIfOutsideViewport
            );
        }
    }

    private async _update() {
        if (!this._document) return;

        const diff = await getGitDiff(this._document);
        const branch = await getGitBranch(this._document);
        const status = await getGitStatus(this._document);

        this._panel.title = `📝 ${this._document.fileName.split('/').pop()}`;
        this._panel.webview.html = await this._getHtmlForWebview(
            this._document,
            diff,
            branch,
            status
        );
    }

    private async _getHtmlForWebview(
        document: vscode.TextDocument,
        diff: FileDiff | null,
        branch: string | null,
        status: string | null
    ): Promise<string> {
        const config = vscode.workspace.getConfiguration('markdownDiffPreview');
        const showLineNumbers = config.get<boolean>('showLineNumbers', true);
        const highlightStyle = config.get<string>('highlightStyle', 'both');
        const diffBase = config.get<string>('diffBase', 'HEAD');

        const markdownContent = document.getText();
        const renderedContent = await renderMarkdownWithDiff(markdownContent, diff, showLineNumbers);

        const addedCount = diff?.addedLines.size || 0;
        const removedCount = diff?.removedLines.size || 0;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
    <title>Markdown Diff Preview</title>
    <style>
        /* Dark theme (default) */
        :root {
            --bg-primary: #0d1117;
            --bg-secondary: #161b22;
            --bg-tertiary: #21262d;
            --text-primary: #e6edf3;
            --text-secondary: #8b949e;
            --text-muted: #6e7681;
            --border-color: #30363d;
            --accent-blue: #58a6ff;
            --accent-purple: #a371f7;
            --diff-add-bg: rgba(46, 160, 67, 0.15);
            --diff-add-border: #238636;
            --diff-add-text: #7ee787;
            --diff-add-gutter: #238636;
            --diff-remove-bg: rgba(248, 81, 73, 0.15);
            --diff-remove-border: #da3633;
            --diff-remove-text: #ffa198;
            --diff-remove-gutter: #da3633;
            --code-bg: #1c2128;
            --link-color: #58a6ff;
            --heading-color: #e6edf3;
            --shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        }

        /* Light theme - activates when VS Code is in light mode */
        body.vscode-light {
            --bg-primary: #ffffff;
            --bg-secondary: #f6f8fa;
            --bg-tertiary: #eaeef2;
            --text-primary: #1f2328;
            --text-secondary: #656d76;
            --text-muted: #8c959f;
            --border-color: #d0d7de;
            --accent-blue: #0969da;
            --accent-purple: #8250df;
            --diff-add-bg: rgba(46, 160, 67, 0.12);
            --diff-add-border: #1a7f37;
            --diff-add-text: #1a7f37;
            --diff-add-gutter: #1a7f37;
            --diff-remove-bg: rgba(255, 129, 130, 0.15);
            --diff-remove-border: #cf222e;
            --diff-remove-text: #cf222e;
            --diff-remove-gutter: #cf222e;
            --code-bg: #f6f8fa;
            --link-color: #0969da;
            --heading-color: #1f2328;
            --shadow: 0 8px 24px rgba(140, 149, 159, 0.2);
        }

        /* High contrast theme */
        body.vscode-high-contrast {
            --bg-primary: #000000;
            --bg-secondary: #0a0a0a;
            --bg-tertiary: #1a1a1a;
            --text-primary: #ffffff;
            --text-secondary: #cccccc;
            --text-muted: #999999;
            --border-color: #6fc3df;
            --accent-blue: #6fc3df;
            --accent-purple: #b180d7;
            --diff-add-bg: rgba(0, 255, 0, 0.2);
            --diff-add-border: #00ff00;
            --diff-add-text: #00ff00;
            --diff-add-gutter: #00ff00;
            --diff-remove-bg: rgba(255, 0, 0, 0.2);
            --diff-remove-border: #ff0000;
            --diff-remove-text: #ff6666;
            --diff-remove-gutter: #ff0000;
            --code-bg: #1a1a1a;
            --link-color: #6fc3df;
            --heading-color: #ffffff;
            --shadow: 0 0 0 1px #6fc3df;
        }

        * {
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
            font-size: 16px;
            line-height: 1.6;
            color: var(--text-primary);
            background: var(--bg-primary);
            margin: 0;
            padding: 0;
            min-height: 100vh;
        }

        /* Header Bar */
        .header {
            position: sticky;
            top: 0;
            z-index: 100;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
            padding: 12px 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            backdrop-filter: blur(12px);
        }

        .header-left {
            display: flex;
            align-items: center;
            gap: 16px;
        }

        .file-name {
            font-weight: 600;
            color: var(--text-primary);
            font-size: 14px;
        }

        .git-info {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .branch-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: var(--bg-tertiary);
            color: var(--accent-purple);
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 500;
        }

        .branch-badge::before {
            content: '⎇';
            font-size: 14px;
        }

        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 500;
        }

        .status-badge.new {
            background: rgba(46, 160, 67, 0.2);
            color: var(--diff-add-text);
        }

        .status-badge.modified {
            background: rgba(210, 153, 34, 0.2);
            color: #e3b341;
        }

        .status-badge.unchanged {
            background: var(--bg-tertiary);
            color: var(--text-secondary);
        }

        .diff-stats {
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 13px;
        }

        .stat {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 4px 8px;
            border-radius: 6px;
        }

        .stat.additions {
            background: var(--diff-add-bg);
            color: var(--diff-add-text);
        }

        .stat.deletions {
            background: var(--diff-remove-bg);
            color: var(--diff-remove-text);
        }

        .diff-base {
            color: var(--text-muted);
            font-size: 12px;
        }

        /* Main Content */
        .content {
            max-width: 900px;
            margin: 0 auto;
            padding: 32px 48px;
            --diff-block-margin-x: -48px;
            --diff-block-padding-x: 48px;
            --diff-block-padding-left: 44px;
            --diff-block-gutter-offset: 16px;
        }

        /* Typography */
        h1, h2, h3, h4, h5, h6 {
            color: var(--heading-color);
            margin-top: 24px;
            margin-bottom: 16px;
            font-weight: 600;
            line-height: 1.25;
        }

        h1 {
            font-size: 2em;
            padding-bottom: 0.3em;
            border-bottom: 1px solid var(--border-color);
        }

        h2 {
            font-size: 1.5em;
            padding-bottom: 0.3em;
            border-bottom: 1px solid var(--border-color);
        }

        h3 { font-size: 1.25em; }
        h4 { font-size: 1em; }
        h5 { font-size: 0.875em; }
        h6 { font-size: 0.85em; color: var(--text-secondary); }

        p {
            margin: 0 0 16px;
        }

        a {
            color: var(--link-color);
            text-decoration: none;
        }

        a:hover {
            text-decoration: underline;
        }

        /* Code */
        code {
            font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', Consolas, monospace;
            font-size: 0.875em;
            background: var(--code-bg);
            padding: 0.2em 0.4em;
            border-radius: 6px;
        }

        pre {
            background: var(--code-bg);
            padding: 16px;
            border-radius: 8px;
            overflow-x: auto;
            border: 1px solid var(--border-color);
        }

        pre code {
            background: none;
            padding: 0;
            font-size: 0.875em;
            line-height: 1.45;
        }

        /* Lists */
        ul, ol {
            margin: 0 0 16px;
            padding-left: 2em;
        }

        li {
            margin: 0.25em 0;
        }

        li + li {
            margin-top: 0.25em;
        }

        /* Blockquotes */
        blockquote {
            margin: 0 0 16px;
            padding: 0 1em;
            color: var(--text-secondary);
            border-left: 4px solid var(--border-color);
        }

        /* Tables */
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 0 0 16px;
        }

        th, td {
            padding: 8px 16px;
            border: 1px solid var(--border-color);
        }

        th {
            background: var(--bg-secondary);
            font-weight: 600;
        }

        tr:nth-child(even) {
            background: var(--bg-secondary);
        }

        /* Table-level diff: entire table is new */
        .diff-table-wrapper {
            position: relative;
            margin: 0 0 16px;
        }

        .diff-table-wrapper.added {
            border-left: 4px solid var(--diff-add-border);
            padding-left: 12px;
            margin-left: -16px;
        }

        .diff-table-wrapper.added::before {
            content: '+';
            position: absolute;
            left: -8px;
            top: 8px;
            color: var(--diff-add-text);
            font-weight: bold;
            font-family: monospace;
            font-size: 12px;
        }

        .diff-table-wrapper.added table {
            background: var(--diff-add-bg);
        }

        /* Row-level diff within mixed tables: subtle indicator */
        tr.diff-row-added {
            background: var(--diff-add-bg) !important;
        }

        tr.diff-row-added td {
            border-left-color: var(--diff-add-border);
        }

        tr.diff-row-added td:first-child {
            border-left: 3px solid var(--diff-add-border);
        }

        /* Small + badge for added rows */
        tr.diff-row-added td:first-child::before {
            content: '+';
            display: inline-block;
            width: 14px;
            height: 14px;
            line-height: 14px;
            text-align: center;
            font-size: 10px;
            font-weight: bold;
            color: var(--diff-add-text);
            background: var(--diff-add-border);
            border-radius: 3px;
            margin-right: 6px;
            font-family: monospace;
        }

        /* Row-level removed indicator within mixed tables */
        tr.diff-row-removed {
            background: var(--diff-remove-bg) !important;
        }

        tr.diff-row-removed td {
            border-left-color: var(--diff-remove-border);
            color: var(--diff-remove-text);
        }

        tr.diff-row-removed td:first-child {
            border-left: 3px solid var(--diff-remove-border);
        }

        tr.diff-row-removed td:first-child::before {
            content: '−';
            display: inline-block;
            width: 14px;
            height: 14px;
            line-height: 14px;
            text-align: center;
            font-size: 10px;
            font-weight: bold;
            color: var(--diff-remove-text);
            background: var(--diff-remove-border);
            border-radius: 3px;
            margin-right: 6px;
            font-family: monospace;
        }

        /* Horizontal Rule */
        hr {
            border: 0;
            border-top: 1px solid var(--border-color);
            margin: 24px 0;
        }

        /* Images */
        img {
            max-width: 100%;
            height: auto;
            border-radius: 8px;
        }

        /* Diff Highlighting */
        .diff-line {
            position: relative;
            display: block;
            margin: 0 var(--diff-block-margin-x);
            padding: 2px var(--diff-block-padding-x);
            border-radius: 0;
            transition: background-color 0.15s ease;
        }

        .diff-line.added {
            background: var(--diff-add-bg);
            border-left: 4px solid var(--diff-add-border);
            padding-left: var(--diff-block-padding-left);
        }

        .diff-line.added::before {
            content: '+';
            position: absolute;
            left: var(--diff-block-gutter-offset);
            color: var(--diff-add-text);
            font-weight: bold;
            font-family: monospace;
        }

        /* Removed lines block */
        .diff-removed-block {
            position: relative;
            display: block;
            margin: 8px var(--diff-block-margin-x);
            padding: 12px var(--diff-block-padding-x) 12px var(--diff-block-padding-left);
            background: var(--diff-remove-bg);
            border-left: 4px solid var(--diff-remove-border);
            border-radius: 0;
            color: var(--diff-remove-text);
            opacity: 0.85;
        }

        .diff-removed-block::before {
            content: '−';
            position: absolute;
            left: var(--diff-block-gutter-offset);
            top: 12px;
            color: var(--diff-remove-text);
            font-weight: bold;
        }

        .diff-removed-label {
            position: absolute;
            right: 16px;
            top: 8px;
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--diff-remove-text);
            opacity: 0.7;
        }

        /* Rendered removed content */
        .diff-removed-block .removed-content {
            color: var(--diff-remove-text);
            margin: 0;
            opacity: 0.9;
        }

        .diff-removed-block h1.removed-content,
        .diff-removed-block h2.removed-content,
        .diff-removed-block h3.removed-content,
        .diff-removed-block h4.removed-content,
        .diff-removed-block h5.removed-content,
        .diff-removed-block h6.removed-content {
            border-bottom: none;
            padding-bottom: 0;
            margin: 4px 0;
            font-size: 1em;
        }

        .diff-removed-block h1.removed-content { font-size: 1.4em; }
        .diff-removed-block h2.removed-content { font-size: 1.2em; }
        .diff-removed-block h3.removed-content { font-size: 1.1em; }

        .diff-removed-block p.removed-content {
            margin: 4px 0;
        }

        .diff-removed-block li.removed-content {
            margin: 4px 0;
            list-style: none;
        }

        .diff-removed-block ul.removed-content-list,
        .diff-removed-block ol.removed-content-list {
            margin: 4px 0;
            padding-left: 0;
            list-style: none;
        }

        .diff-removed-block blockquote.removed-content {
            border-left-color: var(--diff-remove-border);
            margin: 4px 0;
            padding: 4px 12px;
        }

        /* Line numbers */
        .line-number {
            position: absolute;
            left: 0;
            width: 40px;
            text-align: right;
            color: var(--text-muted);
            font-size: 12px;
            font-family: monospace;
            user-select: none;
            opacity: 0;
            transition: opacity 0.15s ease;
        }

        .diff-line:hover .line-number {
            opacity: 1;
        }

        /* Gutter indicators */
        .gutter-indicator {
            position: absolute;
            left: -24px;
            width: 4px;
            height: 100%;
            border-radius: 2px;
        }

        .gutter-indicator.added {
            background: var(--diff-add-gutter);
        }

        .gutter-indicator.removed {
            background: var(--diff-remove-gutter);
        }

        /* New file banner */
        .new-file-banner {
            background: linear-gradient(135deg, rgba(46, 160, 67, 0.1), rgba(46, 160, 67, 0.05));
            border: 1px solid var(--diff-add-border);
            border-radius: 8px;
            padding: 16px 24px;
            margin-bottom: 24px;
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .new-file-banner .icon {
            font-size: 24px;
        }

        .new-file-banner .text {
            color: var(--diff-add-text);
            font-weight: 500;
        }

        /* Hover effects for clickable lines */
        .diff-line.clickable:hover {
            cursor: pointer;
            filter: brightness(1.1);
        }

        /* All elements with data-line are clickable */
        [data-line] {
            cursor: pointer;
            transition: background-color 0.15s ease;
        }

        [data-line]:hover {
            background-color: var(--bg-tertiary);
            border-radius: 4px;
        }

        .diff-line[data-line]:hover {
            background-color: unset;
            filter: brightness(1.15);
        }

        /* Editing state */
        [contenteditable="true"],
        .editing {
            outline: 2px solid var(--accent-blue);
            outline-offset: 2px;
            border-radius: 4px;
            background: var(--bg-secondary) !important;
            padding: 4px 8px;
            min-height: 1.5em;
        }

        [contenteditable="true"]:focus {
            outline-color: var(--accent-purple);
        }

        /* Plain text spans for atomic editing */
        .plain-text {
            cursor: pointer;
        }

        .plain-text:hover {
            background: var(--bg-tertiary);
            border-radius: 2px;
        }

        /* Legend */
        .legend {
            display: flex;
            gap: 16px;
            padding: 8px 0;
            font-size: 12px;
            color: var(--text-secondary);
        }

        .legend-item {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .legend-color {
            width: 12px;
            height: 12px;
            border-radius: 3px;
        }

        .legend-color.added {
            background: var(--diff-add-border);
        }

        .legend-color.removed {
            background: var(--diff-remove-border);
        }

        /* Refresh button */
        .refresh-btn {
            background: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            color: var(--text-secondary);
            padding: 6px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.15s ease;
        }

        .refresh-btn:hover {
            background: var(--border-color);
            color: var(--text-primary);
        }

        /* Scrollbar */
        ::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }

        ::-webkit-scrollbar-track {
            background: var(--bg-primary);
        }

        ::-webkit-scrollbar-thumb {
            background: var(--border-color);
            border-radius: 4px;
        }

        ::-webkit-scrollbar-thumb:hover {
            background: var(--text-muted);
        }

        /* Empty state */
        .empty-state {
            text-align: center;
            padding: 48px;
            color: var(--text-secondary);
        }

        .empty-state .icon {
            font-size: 48px;
            margin-bottom: 16px;
        }

        /* Animation for new diffs */
        @keyframes highlightPulse {
            0% { opacity: 0.5; }
            50% { opacity: 1; }
            100% { opacity: 0.5; }
        }

        .diff-line.new-highlight {
            animation: highlightPulse 2s ease-in-out;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-left">
            <span class="file-name">${document.fileName.split('/').pop()}</span>
            <div class="git-info">
                ${branch ? `<span class="branch-badge">${branch}</span>` : ''}
                ${status ? `<span class="status-badge ${status}">${status}</span>` : ''}
            </div>
        </div>
        <div class="diff-stats">
            ${addedCount > 0 ? `<span class="stat additions">+${addedCount} added</span>` : ''}
            ${removedCount > 0 ? `<span class="stat deletions">−${removedCount} removed</span>` : ''}
            <span class="diff-base">vs ${diffBase}</span>
            <button class="refresh-btn" onclick="refresh()">↻ Refresh</button>
        </div>
    </div>

    <div class="content">
        ${diff?.isNew ? `
            <div class="new-file-banner">
                <span class="icon">✨</span>
                <span class="text">This is a new file — all content shown as additions</span>
            </div>
        ` : ''}
        
        ${renderedContent}
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function scrollToLine(line) {
            vscode.postMessage({
                command: 'scrollToLine',
                line: line
            });
        }

        function refresh() {
            vscode.postMessage({
                command: 'refresh'
            });
        }

        function updateElement(line, elementPath, newText) {
            vscode.postMessage({
                command: 'updateElement',
                line: line,
                elementPath: elementPath,
                text: newText
            });
        }

        function undo() {
            vscode.postMessage({ command: 'undo' });
        }

        function redo() {
            vscode.postMessage({ command: 'redo' });
        }

        // Global keyboard shortcuts for undo/redo
        document.addEventListener('keydown', (e) => {
            // Don't intercept if we're actively editing (let contenteditable handle it)
            if (isEditing) return;
            
            if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    redo();
                } else {
                    undo();
                }
            }
            if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
                e.preventDefault();
                redo();
            }
        });

        // Track if we're currently editing
        let isEditing = false;
        let editingElement = null;
        let originalText = '';

        // Find the smallest editable element from a click target
        function findEditableElement(target) {
            // These are the atomic editable elements
            const editableTags = ['STRONG', 'EM', 'DEL', 'CODE', 'A', 'TD', 'TH'];
            
            // Check if we clicked on a plain-text span (atomic text segment)
            if (target.classList?.contains('plain-text')) {
                return target;
            }
            
            // Check if we clicked directly on an editable element
            if (editableTags.includes(target.tagName)) {
                return target;
            }
            
            // Check parents up to the data-line element
            let current = target;
            while (current && !current.dataset?.line) {
                if (current.classList?.contains('plain-text')) {
                    return current;
                }
                if (editableTags.includes(current.tagName)) {
                    return current;
                }
                current = current.parentElement;
            }
            
            // If no special element found, return the data-line element itself
            // but only for simple elements (not tables, code blocks)
            // and only if it has no child elements (pure text)
            if (current?.dataset?.line) {
                const tag = current.tagName;
                if (tag === 'TR' || tag === 'PRE' || tag === 'TABLE') return null;
                if (current.closest('.diff-removed-block')) return null;
                
                // Only make the whole element editable if it has no formatted children
                const hasFormattedChildren = current.querySelector('strong, em, del, code, a, .plain-text');
                if (!hasFormattedChildren) {
                    return current;
                }
                
                // Don't fall back to whole element if it has mixed content
                return null;
            }
            
            return null;
        }

        // Get the path to an element within its data-line ancestor (for syncing)
        function getElementPath(element) {
            const path = [];
            let current = element;
            
            while (current && !current.dataset?.line) {
                const parent = current.parentElement;
                if (parent) {
                    const index = Array.from(parent.children).indexOf(current);
                    path.unshift({ tag: current.tagName.toLowerCase(), index: index });
                }
                current = parent;
            }
            
            return path;
        }

        // Get the data-line value from an element or its ancestors
        function getLineNumber(element) {
            let current = element;
            while (current) {
                if (current.dataset?.line) {
                    return parseInt(current.dataset.line);
                }
                current = current.parentElement;
            }
            return null;
        }

        // Single click handler for navigation
        document.querySelector('.content').addEventListener('click', (e) => {
            if (isEditing) return;
            
            const lineEl = e.target.closest('[data-line]');
            if (lineEl) {
                const line = parseInt(lineEl.dataset.line);
                if (line) scrollToLine(line);
            }
        });

        // Double click handler for editing
        document.querySelector('.content').addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const editTarget = findEditableElement(e.target);
            if (!editTarget) return;
            
            isEditing = true;
            editingElement = editTarget;
            originalText = editTarget.textContent || '';
            
            editTarget.contentEditable = 'true';
            editTarget.classList.add('editing');
            editTarget.focus();
            
            // Place cursor at click position or select all
            const sel = window.getSelection();
            if (sel.rangeCount > 0) {
                // Keep cursor where user clicked
            } else {
                const range = document.createRange();
                range.selectNodeContents(editTarget);
                sel.removeAllRanges();
                sel.addRange(range);
            }
        });

        // Handle blur (finish editing)
        document.addEventListener('focusout', (e) => {
            if (!isEditing || !editingElement) return;
            if (editingElement.contains(e.relatedTarget)) return;
            
            finishEditing(false);
        });

        // Handle keyboard in editing mode
        document.addEventListener('keydown', (e) => {
            if (!isEditing || !editingElement) return;
            
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                finishEditing(false);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                finishEditing(true); // cancel
            }
        });

        function finishEditing(cancel) {
            if (!editingElement) return;
            
            const el = editingElement;
            el.contentEditable = 'false';
            el.classList.remove('editing');
            
            if (cancel) {
                el.textContent = originalText;
            } else {
                const newText = el.textContent || '';
                if (newText !== originalText) {
                    const line = getLineNumber(el);
                    const path = getElementPath(el);
                    const elementType = el.tagName.toLowerCase();
                    
                    if (line) {
                        updateElement(line, { path, elementType, originalText, newText });
                    }
                }
            }
            
            isEditing = false;
            editingElement = null;
            originalText = '';
        }

        // Add cursor pointer to clickable elements
        document.querySelectorAll('[data-line]').forEach(el => {
            el.style.cursor = 'pointer';
        });

        // Selection sync: when user selects text in preview, select corresponding lines in editor
        let selectionTimeout = null;
        
        function getLineFromNode(node) {
            // Handle text nodes by getting their parent element
            const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
            if (!el) return null;
            const lineEl = el.closest('[data-line]');
            return lineEl ? parseInt(lineEl.dataset.line) : null;
        }
        
        document.addEventListener('selectionchange', () => {
            // Don't sync selection while editing
            if (isEditing) return;
            
            // Debounce to avoid too many messages during selection drag
            if (selectionTimeout) clearTimeout(selectionTimeout);
            selectionTimeout = setTimeout(() => {
                const sel = window.getSelection();
                if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
                
                const range = sel.getRangeAt(0);
                
                // Check if selection is within our content area
                const contentEl = document.querySelector('.content');
                if (!contentEl || !contentEl.contains(range.commonAncestorContainer)) return;
                
                // Find the data-line elements at the start and end of selection
                const startLine = getLineFromNode(range.startContainer);
                const endLine = getLineFromNode(range.endContainer);
                
                if (startLine && endLine) {
                    vscode.postMessage({
                        command: 'selectLines',
                        startLine: Math.min(startLine, endLine),
                        endLine: Math.max(startLine, endLine)
                    });
                }
            }, 150); // 150ms debounce
        });
    </script>
</body>
</html>`;
    }

    private dispose() {
        MarkdownDiffPreviewPanel.currentPanel = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}
