import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { parseDiff } from './core/diffParser';

// Re-export types from core for backwards compatibility
export { FileDiff, DiffHunk, DiffChange } from './core/types';
export { parseDiff } from './core/diffParser';

import type { FileDiff } from './core/types';

const execAsync = promisify(exec);

export async function getGitDiff(document: vscode.TextDocument): Promise<FileDiff | null> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
        return null;
    }

    const config = vscode.workspace.getConfiguration('markdownDiffPreview');
    const diffBase = config.get<string>('diffBase', 'HEAD');
    
    const relativePath = path.relative(workspaceFolder.uri.fsPath, document.uri.fsPath);
    const cwd = workspaceFolder.uri.fsPath;

    try {
        // Check if file is tracked by git
        const isTracked = await isFileTracked(cwd, relativePath);
        
        if (!isTracked) {
            // New file - mark all lines as added
            const lineCount = document.lineCount;
            const addedLines = new Set<number>();
            for (let i = 1; i <= lineCount; i++) {
                addedLines.add(i);
            }
            return {
                filePath: relativePath,
                isNew: true,
                isDeleted: false,
                hunks: [],
                addedLines,
                removedLines: new Map()
            };
        }

        // Get the diff output
        const { stdout } = await execAsync(
            `git diff ${diffBase} -- "${relativePath}"`,
            { cwd, maxBuffer: 10 * 1024 * 1024 }
        );

        if (!stdout.trim()) {
            // Also check for unstaged changes
            const { stdout: unstagedDiff } = await execAsync(
                `git diff -- "${relativePath}"`,
                { cwd, maxBuffer: 10 * 1024 * 1024 }
            );
            
            if (!unstagedDiff.trim()) {
                return {
                    filePath: relativePath,
                    isNew: false,
                    isDeleted: false,
                    hunks: [],
                    addedLines: new Set(),
                    removedLines: new Map()
                };
            }
            
            return parseDiff(relativePath, unstagedDiff);
        }

        return parseDiff(relativePath, stdout);
    } catch (error) {
        console.error('Error getting git diff:', error);
        return null;
    }
}

async function isFileTracked(cwd: string, relativePath: string): Promise<boolean> {
    try {
        await execAsync(`git ls-files --error-unmatch "${relativePath}"`, { cwd });
        return true;
    } catch {
        return false;
    }
}

export async function getGitBranch(document: vscode.TextDocument): Promise<string | null> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
        return null;
    }

    try {
        const { stdout } = await execAsync('git branch --show-current', {
            cwd: workspaceFolder.uri.fsPath
        });
        return stdout.trim();
    } catch {
        return null;
    }
}

export async function getGitStatus(document: vscode.TextDocument): Promise<string | null> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
        return null;
    }

    const relativePath = path.relative(workspaceFolder.uri.fsPath, document.uri.fsPath);

    try {
        const { stdout } = await execAsync(`git status --porcelain "${relativePath}"`, {
            cwd: workspaceFolder.uri.fsPath
        });
        
        if (!stdout.trim()) {
            return 'unchanged';
        }
        
        const status = stdout.trim().substring(0, 2);
        if (status.includes('A') || status === '??') {
            return 'new';
        } else if (status.includes('M')) {
            return 'modified';
        } else if (status.includes('D')) {
            return 'deleted';
        }
        return 'changed';
    } catch {
        return null;
    }
}
