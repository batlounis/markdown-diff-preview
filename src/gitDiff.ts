import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

export interface DiffHunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    changes: DiffChange[];
}

export interface DiffChange {
    type: 'added' | 'removed' | 'context';
    lineNumber: number;  // Line number in the new file
    oldLineNumber?: number;  // Line number in the old file (for removed/context)
    content: string;
}

export interface FileDiff {
    filePath: string;
    isNew: boolean;
    isDeleted: boolean;
    hunks: DiffHunk[];
    addedLines: Set<number>;
    removedLines: Map<number, string>;  // Maps new line position to removed content
}

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

function parseDiff(filePath: string, diffOutput: string): FileDiff {
    const hunks: DiffHunk[] = [];
    const addedLines = new Set<number>();
    const removedLines = new Map<number, string>();

    const lines = diffOutput.split('\n');
    let currentHunk: DiffHunk | null = null;
    let newLineNumber = 0;
    let oldLineNumber = 0;
    let pendingRemovals: string[] = [];
    let removalInsertPoint = 0;

    for (const line of lines) {
        // Parse hunk header: @@ -oldStart,oldLines +newStart,newLines @@
        const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        
        if (hunkMatch) {
            // Save pending removals from previous hunk
            if (pendingRemovals.length > 0 && removalInsertPoint > 0) {
                removedLines.set(removalInsertPoint, pendingRemovals.join('\n'));
                pendingRemovals = [];
            }

            currentHunk = {
                oldStart: parseInt(hunkMatch[1], 10),
                oldLines: parseInt(hunkMatch[2] || '1', 10),
                newStart: parseInt(hunkMatch[3], 10),
                newLines: parseInt(hunkMatch[4] || '1', 10),
                changes: []
            };
            hunks.push(currentHunk);
            newLineNumber = currentHunk.newStart;
            oldLineNumber = currentHunk.oldStart;
            removalInsertPoint = newLineNumber;
            continue;
        }

        if (!currentHunk) continue;

        if (line.startsWith('+') && !line.startsWith('+++')) {
            // Added line
            const content = line.substring(1);
            currentHunk.changes.push({
                type: 'added',
                lineNumber: newLineNumber,
                content
            });
            addedLines.add(newLineNumber);
            
            // If we had pending removals, attach them before this addition
            if (pendingRemovals.length > 0) {
                removedLines.set(removalInsertPoint, pendingRemovals.join('\n'));
                pendingRemovals = [];
            }
            removalInsertPoint = newLineNumber + 1;
            newLineNumber++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
            // Removed line
            const content = line.substring(1);
            currentHunk.changes.push({
                type: 'removed',
                lineNumber: newLineNumber,
                oldLineNumber: oldLineNumber,
                content
            });
            pendingRemovals.push(content);
            oldLineNumber++;
        } else if (line.startsWith(' ') || line === '') {
            // Context line
            // First, flush any pending removals
            if (pendingRemovals.length > 0) {
                removedLines.set(removalInsertPoint, pendingRemovals.join('\n'));
                pendingRemovals = [];
            }
            
            const content = line.startsWith(' ') ? line.substring(1) : line;
            currentHunk.changes.push({
                type: 'context',
                lineNumber: newLineNumber,
                oldLineNumber: oldLineNumber,
                content
            });
            newLineNumber++;
            oldLineNumber++;
            removalInsertPoint = newLineNumber;
        }
    }

    // Flush any remaining pending removals
    if (pendingRemovals.length > 0 && removalInsertPoint > 0) {
        removedLines.set(removalInsertPoint, pendingRemovals.join('\n'));
    }

    return {
        filePath,
        isNew: false,
        isDeleted: false,
        hunks,
        addedLines,
        removedLines
    };
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
