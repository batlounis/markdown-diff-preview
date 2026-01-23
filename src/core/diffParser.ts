/**
 * Pure diff parsing logic - no VS Code dependencies.
 * Can be used both in the extension and standalone scripts.
 */

import { FileDiff, DiffHunk } from './types';

export function parseDiff(filePath: string, diffOutput: string): FileDiff {
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

/**
 * Extract the "new" file content from a unified diff.
 * Returns the content as it appears after the changes (added + context lines).
 */
export function extractNewFileContent(diffOutput: string): string {
    const lines = diffOutput.split('\n');
    const contentLines: string[] = [];
    let inHunk = false;

    for (const line of lines) {
        if (line.match(/^@@ /)) {
            inHunk = true;
            continue;
        }

        if (!inHunk) continue;

        if (line.startsWith('+') && !line.startsWith('+++')) {
            contentLines.push(line.substring(1));
        } else if (line.startsWith(' ')) {
            contentLines.push(line.substring(1));
        }
        // Skip removed lines (they're not in the new file)
    }

    return contentLines.join('\n');
}
