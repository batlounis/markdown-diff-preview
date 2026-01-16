import * as vscode from 'vscode';
import { MarkdownDiffPreviewPanel } from './markdownPreview';

export function activate(context: vscode.ExtensionContext) {
    console.log('Markdown Diff Preview is now active!');

    // Register the open preview command
    const openPreviewCommand = vscode.commands.registerCommand(
        'markdownDiffPreview.open',
        () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'markdown') {
                MarkdownDiffPreviewPanel.createOrShow(context.extensionUri, editor.document);
            } else {
                vscode.window.showWarningMessage('Please open a Markdown file first');
            }
        }
    );

    // Register refresh command
    const refreshCommand = vscode.commands.registerCommand(
        'markdownDiffPreview.refresh',
        () => {
            MarkdownDiffPreviewPanel.refresh();
        }
    );

    // Auto-update preview when document changes
    const onDocumentChange = vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.languageId === 'markdown') {
            MarkdownDiffPreviewPanel.updateIfVisible(e.document);
        }
    });

    // Update when switching to a different markdown file
    const onActiveEditorChange = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && editor.document.languageId === 'markdown') {
            MarkdownDiffPreviewPanel.updateIfVisible(editor.document);
        }
    });

    // Watch for git changes
    const gitWatcher = vscode.workspace.createFileSystemWatcher('**/.git/**');
    gitWatcher.onDidChange(() => {
        MarkdownDiffPreviewPanel.refresh();
    });

    context.subscriptions.push(
        openPreviewCommand,
        refreshCommand,
        onDocumentChange,
        onActiveEditorChange,
        gitWatcher
    );
}

export function deactivate() {
    MarkdownDiffPreviewPanel.dispose();
}
