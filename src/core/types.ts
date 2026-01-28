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

/**
 * Comment system types for markdown comments
 */
export interface CommentThreadItem {
    id: string;
    author: 'user' | 'ai';
    content: string;
    timestamp: string;
}

export interface CommentPlan {
    content: string;
    status: 'pending' | 'approved' | 'rejected';
    editable: boolean;
}

export interface CommentResponse {
    content: string;
    status: 'draft' | 'final';
    editable: boolean;
}

export interface CommentTarget {
    type: 'inline' | 'block';
    line: number;
    text?: string;  // For inline comments: the text being commented on
    position?: number;  // For inline comments: character position in line
    element?: string;  // For block comments: element type (heading, paragraph, etc.)
}

export interface Comment {
    id: number;
    target: CommentTarget;
    thread: CommentThreadItem[];
    plan: CommentPlan | null;
    response: CommentResponse | null;
}

export interface CommentsData {
    [commentId: string]: Comment;
}
