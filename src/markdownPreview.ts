import * as vscode from 'vscode';
import { getGitDiff, getGitBranch, getGitStatus, FileDiff } from './gitDiff';
import { renderMarkdownWithDiff } from './core/markdownRenderer';
import { parseCommentsData } from './core/commentParser';

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
                    case 'updateComment':
                        await this._updateComment(message.commentId, message.type, message.content);
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

    private async _updateComment(commentId: number, type: 'plan' | 'response', content: string) {
        if (!this._document) return;

        try {
            const markdownContent = this._document.getText();
            const { parseCommentsData } = await import('./core/commentParser');
            const commentsData = parseCommentsData(markdownContent);
            
            if (!commentsData || !commentsData[commentId.toString()]) {
                vscode.window.showWarningMessage(`Comment ${commentId} not found`);
                return;
            }

            // Find the COMMENTS-DATA block and update it
            const commentsBlockRegex = /<!--\s*COMMENTS-DATA\s*([\s\S]*?)\s*-->/;
            const match = markdownContent.match(commentsBlockRegex);
            
            if (!match || match.index === undefined) {
                vscode.window.showWarningMessage('COMMENTS-DATA block not found. Please add a COMMENTS-DATA block to your markdown file.');
                return;
            }

            const comment = commentsData[commentId.toString()];
            
            // Update the comment data
            if (type === 'plan') {
                if (!comment.plan) {
                    // Create plan if it doesn't exist
                    comment.plan = {
                        content: content,
                        status: 'pending',
                        editable: true
                    };
                } else {
                    comment.plan.content = content;
                }
            } else if (type === 'response') {
                if (!comment.response) {
                    // Create response if it doesn't exist
                    comment.response = {
                        content: content,
                        status: 'draft',
                        editable: true
                    };
                } else {
                    comment.response.content = content;
                }
            } else {
                vscode.window.showWarningMessage(`Invalid comment type: ${type}`);
                return;
            }

            // Reconstruct the markdown with updated comments
            const updatedCommentsJson = JSON.stringify(commentsData, null, 2);
            const updatedCommentsBlock = `<!--\nCOMMENTS-DATA\n${updatedCommentsJson}\n-->`;
            
            const beforeBlock = markdownContent.substring(0, match.index);
            const afterBlock = markdownContent.substring(match.index + match[0].length);
            const updatedContent = beforeBlock + updatedCommentsBlock + afterBlock;

            // Apply the edit
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(
                this._document.positionAt(0),
                this._document.positionAt(this._document.getText().length)
            );
            edit.replace(this._document.uri, fullRange, updatedContent);
            await vscode.workspace.applyEdit(edit);
            
            // Refresh the preview to show updated content
            this._update();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to update comment: ${errorMessage}`);
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
        const commentsData = parseCommentsData(markdownContent);
        const renderedContent = await renderMarkdownWithDiff(markdownContent, diff, showLineNumbers, commentsData);

        const addedCount = diff?.addedLines.size || 0;
        const removedCount = diff?.removedLines.size || 0;

        // Get URI for the external stylesheet
        const stylesUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'styles.css')
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource}; script-src 'unsafe-inline';">
    <title>Markdown Diff Preview</title>
    <link rel="stylesheet" href="${stylesUri}">
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

        // Comment system functions
        function toggleCommentThread(commentId) {
            const thread = document.getElementById('comment-thread-' + commentId);
            if (!thread) {
                console.warn('Comment thread not found:', commentId);
                return;
            }
            
            const isVisible = thread.style.display !== 'none' && thread.style.display !== '';
            if (!isVisible) {
                // Close any other open threads when opening a new one
                document.querySelectorAll('.comment-thread').forEach(other => {
                    if (other !== thread) {
                        other.style.display = 'none';
                    }
                });
            }
            thread.style.display = isVisible ? 'none' : 'flex';
            
            // Scroll thread into view if opening
            if (!isVisible) {
                setTimeout(() => {
                    thread.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }, 10);
            }
        }

        // Handle comment plan/response editing
        let editingComment = null;
        let editingCommentOriginal = '';

        document.addEventListener('focusin', (e) => {
            if (e.target.classList.contains('comment-editable')) {
                editingComment = e.target;
                editingCommentOriginal = e.target.textContent || '';
            }
        });

        document.addEventListener('focusout', (e) => {
            if (editingComment && !editingComment.contains(e.relatedTarget)) {
                const newContent = editingComment.textContent || '';
                if (newContent !== editingCommentOriginal) {
                    const commentId = editingComment.dataset.commentId;
                    const type = editingComment.dataset.type; // 'plan' or 'response'
                    
                    vscode.postMessage({
                        command: 'updateComment',
                        commentId: parseInt(commentId),
                        type: type,
                        content: newContent
                    });
                }
                editingComment = null;
                editingCommentOriginal = '';
            }
        });

        // Make comment threads container scrollable and position correctly
        window.addEventListener('load', () => {
            const container = document.querySelector('.comment-threads-container');
            if (container) {
                // Ensure container is positioned correctly
                container.style.position = 'fixed';
                container.style.bottom = '0';
                container.style.right = '0';
            }
        });

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

        // Expose toggleCommentThread globally for onclick handlers
        window.toggleCommentThread = toggleCommentThread;
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
