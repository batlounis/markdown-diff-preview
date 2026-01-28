/**
 * Parser for extracting comments from markdown files.
 * Handles both inline comment markers and the COMMENTS-DATA block.
 */

import { CommentsData, Comment } from './types';

/**
 * Extract comment markers from a line of markdown
 * Returns array of comment IDs found in the line
 */
export function extractCommentMarkers(line: string): number[] {
    const markers: number[] = [];
    
    // Match inline comments: <!--comment:1-->
    const inlineRegex = /<!--comment:(\d+)-->/g;
    let match;
    while ((match = inlineRegex.exec(line)) !== null) {
        markers.push(parseInt(match[1], 10));
    }
    
    // Match block comments: <!--comment:1--> at start of line
    const blockRegex = /^<!--comment:(\d+)-->/;
    const blockMatch = line.match(blockRegex);
    if (blockMatch) {
        markers.push(parseInt(blockMatch[1], 10));
    }
    
    return markers;
}

/**
 * Parse the COMMENTS-DATA block from markdown content
 * Returns the parsed comments data or null if not found
 */
export function parseCommentsData(markdown: string): CommentsData | null {
    // Look for COMMENTS-DATA block in HTML comments
    // Match both single-line and multi-line formats
    const commentsBlockRegex = /<!--\s*COMMENTS-DATA\s*([\s\S]*?)\s*-->/;
    const match = markdown.match(commentsBlockRegex);
    
    if (!match || !match[1]) {
        return null;
    }
    
    try {
        // Parse JSON from the comment block
        // Remove any leading/trailing whitespace and newlines
        const jsonStr = match[1].trim();
        if (!jsonStr) {
            return null;
        }
        
        const data = JSON.parse(jsonStr) as CommentsData;
        
        // Validate that it's an object
        if (typeof data !== 'object' || data === null || Array.isArray(data)) {
            console.warn('COMMENTS-DATA is not a valid object');
            return null;
        }
        
        return data;
    } catch (error) {
        console.error('Failed to parse COMMENTS-DATA:', error);
        return null;
    }
}

/**
 * Remove comment markers from markdown content (for clean rendering)
 * This preserves the content but removes the HTML comment markers
 */
export function removeCommentMarkers(markdown: string): string {
    // Remove inline comment markers
    let cleaned = markdown.replace(/<!--comment:\d+-->/g, '');
    
    // Remove block comment markers at start of line
    cleaned = cleaned.replace(/^<!--comment:\d+-->\s*/gm, '');
    
    return cleaned;
}

/**
 * Extract all comment markers from markdown and map them to line numbers
 * Returns a map of line number -> array of comment IDs
 */
export function extractCommentMarkersByLine(markdown: string): Map<number, number[]> {
    const lines = markdown.split('\n');
    const commentMap = new Map<number, number[]>();
    
    lines.forEach((line, index) => {
        const markers = extractCommentMarkers(line);
        if (markers.length > 0) {
            commentMap.set(index + 1, markers); // Line numbers are 1-indexed
        }
    });
    
    return commentMap;
}

/**
 * Get all comments for a specific line
 */
export function getCommentsForLine(
    lineNumber: number,
    commentsData: CommentsData | null,
    commentMarkers: Map<number, number[]>
): Comment[] {
    if (!commentsData) {
        return [];
    }
    
    const commentIds = commentMarkers.get(lineNumber) || [];
    return commentIds
        .map(id => commentsData[id.toString()])
        .filter((comment): comment is Comment => comment !== undefined);
}

/**
 * Check if a comment has a plan
 */
export function hasPlan(comment: Comment): boolean {
    return comment.plan !== null && comment.plan !== undefined;
}

/**
 * Check if a comment has a response
 */
export function hasResponse(comment: Comment): boolean {
    return comment.response !== null && comment.response !== undefined;
}

/**
 * Get comment status for styling
 */
export function getCommentStatus(comment: Comment): 'pending-plan' | 'has-plan' | 'has-response' | 'active' {
    if (hasResponse(comment)) {
        return 'has-response';
    }
    if (hasPlan(comment)) {
        return 'has-plan';
    }
    if (comment.thread.length > 0) {
        return 'active';
    }
    return 'pending-plan';
}