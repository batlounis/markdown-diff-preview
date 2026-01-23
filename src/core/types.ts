/**
 * Shared type definitions for diff parsing and markdown rendering.
 * No VS Code dependencies - can be used in any Node.js context.
 */

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
