/**
 * Pure markdown rendering with diff highlighting - no VS Code dependencies.
 * Can be used both in the extension and standalone scripts.
 */

import { FileDiff, CommentsData, Comment } from './types';
import { 
    parseCommentsData, 
    extractCommentMarkersByLine, 
    getCommentsForLine,
    getCommentStatus 
} from './commentParser';

export async function renderMarkdownWithDiff(
    markdown: string,
    diff: FileDiff | null,
    showLineNumbers: boolean,
    commentsData?: CommentsData | null
): Promise<string> {
    const lines = markdown.split('\n');
    const addedLines = diff?.addedLines || new Set<number>();
    const removedLines = diff?.removedLines || new Map<number, string>();

    // Parse comments if not provided
    const comments = commentsData || parseCommentsData(markdown);
    const commentMarkers = extractCommentMarkersByLine(markdown);

    let html = '';
    const commentThreadsHtml: string[] = []; // Collect comment threads to append at end
    let inCodeBlock = false;
    let codeBlockContent = '';
    let codeBlockLang = '';
    let codeBlockStartLine = 0;
    let inList = false;
    let listItems: { content: string; indent: number; lineNumber: number; type: 'ul' | 'ol' }[] = [];
    let inTable = false;
    let tableRows: { line: string; lineNumber: number }[] = [];
    let tableStartLine = 0;

    const escapeHtml = (text: string): string => {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };

    /**
     * Render comment badge for a comment
     */
    const renderCommentBadge = (comment: Comment): string => {
        const status = getCommentStatus(comment);
        const statusClass = `comment-status-${status}`;
        return `<span class="comment-badge ${statusClass}" data-comment-id="${comment.id}" onclick="toggleCommentThread(${comment.id}); event.stopPropagation();">[${comment.id}]</span>`;
    };

    /**
     * Render comment thread panel
     */
    const renderCommentThread = (comment: Comment): string => {
        const threadItems = comment.thread.map(item => {
            const authorClass = item.author === 'ai' ? 'comment-author-ai' : 'comment-author-user';
            const timestamp = new Date(item.timestamp).toLocaleString();
            const content = escapeHtml(item.content.trim());
            // Only show author label for AI comments; don't show "You" for user comments
            const authorLabel = item.author === 'ai' ? 'AI' : '';
            return `
                <div class="comment-thread-item ${authorClass}">
                    <div class="comment-thread-header">
                        ${authorLabel ? `<span class="comment-author">${authorLabel}</span>` : ''}
                        <span class="comment-timestamp">${timestamp}</span>
                    </div>
                    <div class="comment-thread-content">${content}</div>
                </div>
            `;
        }).join('');

        let planHtml = '';
        if (comment.plan) {
            const planContent = escapeHtml(comment.plan.content.trim());
            planHtml = `
                <div class="comment-plan">
                    <h4 class="comment-section-title">Plan</h4>
                    <div class="comment-editable" contenteditable="true" data-comment-id="${comment.id}" data-type="plan">${planContent}</div>
                    <div class="comment-status-badge status-${comment.plan.status}">${comment.plan.status}</div>
                </div>
            `;
        }

        let responseHtml = '';
        if (comment.response) {
            const responseContent = escapeHtml(comment.response.content.trim());
            responseHtml = `
                <div class="comment-response">
                    <h4 class="comment-section-title">Response</h4>
                    <div class="comment-editable" contenteditable="true" data-comment-id="${comment.id}" data-type="response">${responseContent}</div>
                    <div class="comment-status-badge status-${comment.response.status}">${comment.response.status}</div>
                </div>
            `;
        }

        return `
            <div class="comment-thread" id="comment-thread-${comment.id}" style="display: none;">
                <div class="comment-thread-header-bar">
                    <span class="comment-thread-title">Comment ${comment.id}</span>
                    <button class="comment-close-btn" onclick="toggleCommentThread(${comment.id}); event.stopPropagation();" aria-label="Close">×</button>
                </div>
                <div class="comment-thread-items">
                    ${threadItems || '<div class="comment-thread-item">No comments yet</div>'}
                </div>
                ${planHtml}
                ${responseHtml}
            </div>
        `;
    };

    /**
     * Wrap content with comment highlights and badges
     */
    // Track which comments have been processed to avoid duplicates
    const processedComments = new Set<number>();

    const wrapWithComments = (content: string, lineNumber: number, isBlock: boolean = false): string => {
        if (!comments) {
            return content;
        }

        const lineComments = getCommentsForLine(lineNumber, comments, commentMarkers);
        
        if (lineComments.length === 0) {
            return content;
        }

        // For block comments, add badges before the element
        // Inline comments are handled in processInlineComments
        const blockComments = lineComments.filter(c => c.target.type === 'block' && !processedComments.has(c.id));
        
        if (blockComments.length === 0) {
            // Only inline comments - already handled in parseInline
            return content;
        }

        // Mark as processed BEFORE generating badges to prevent duplicates
        blockComments.forEach(c => processedComments.add(c.id));

        // Generate badges HTML for block comments
        const badges = blockComments.map(comment => {
            if (!commentThreadsHtml.some(html => html.includes(`comment-thread-${comment.id}`))) {
                commentThreadsHtml.push(renderCommentThread(comment));
            }
            return renderCommentBadge(comment);
        }).join('');

        // Determine comment status for highlighting
        const hasPlan = lineComments.some(c => c.plan !== null);
        const hasResponse = lineComments.some(c => c.response !== null);
        const statusClass = hasResponse ? 'comment-has-response' : hasPlan ? 'comment-has-plan' : 'comment-active';

        // For block elements, inject badge at the start
        return `<span class="comment-highlight-block ${statusClass}">${badges}</span>${content}`;
    };

    /**
     * Process inline comments in HTML - insert badges right after the commented text
     */
    const processInlineComments = (html: string, originalLine: string, lineNumber: number): string => {
        if (!comments) {
            return html;
        }

        const lineComments = getCommentsForLine(lineNumber, comments, commentMarkers);
        const inlineComments = lineComments.filter(c => c.target.type === 'inline');
        
        if (inlineComments.length === 0) {
            return html;
        }

        // Find comment markers in original line and their positions
        const markers: Array<{ id: number; position: number; comment: Comment }> = [];
        const markerRegex = /<!--comment:(\d+)-->/g;
        let match;
        
        while ((match = markerRegex.exec(originalLine)) !== null) {
            const commentId = parseInt(match[1], 10);
            const comment = comments[commentId.toString()];
            if (comment && comment.target.type === 'inline' && !processedComments.has(comment.id)) {
                markers.push({
                    id: commentId,
                    position: match.index,
                    comment
                });
            }
        }

        if (markers.length === 0) {
            return html;
        }

        // Mark as processed and store threads
        markers.forEach(({ comment }) => {
            processedComments.add(comment.id);
            if (!commentThreadsHtml.some(h => h.includes(`comment-thread-${comment.id}`))) {
                commentThreadsHtml.push(renderCommentThread(comment));
            }
        });

        // Find the target text in the HTML and insert badge after it
        // We need to find the escaped version of the target text
        let result = html;
        markers.forEach(({ comment }) => {
            if (comment.target.text) {
                const escapedText = escapeHtml(comment.target.text);
                // Try to find the text in the HTML (might be wrapped in spans)
                const textIndex = result.indexOf(escapedText);
                if (textIndex !== -1) {
                    const badge = renderCommentBadge(comment);
                    // Insert badge after the text
                    const insertPos = textIndex + escapedText.length;
                    result = result.slice(0, insertPos) + ' ' + badge + result.slice(insertPos);
                } else {
                    // If text not found, append badge at end
                    const badge = renderCommentBadge(comment);
                    result = result + ' ' + badge;
                }
            }
        });

        // Determine comment status for highlighting
        const hasPlan = inlineComments.some(c => c.plan !== null);
        const hasResponse = inlineComments.some(c => c.response !== null);
        const statusClass = hasResponse ? 'comment-has-response' : hasPlan ? 'comment-has-plan' : 'comment-active';

        // Wrap in highlight if we have comments
        if (markers.length > 0 && !result.includes('comment-highlight')) {
            result = `<span class="comment-highlight ${statusClass}">${result}</span>`;
        }

        return result;
    };

    const parseInline = (text: string, originalLine?: string, lineNumber?: number): string => {
        // Remove comment markers BEFORE escaping (they're HTML comments, not content)
        let cleanedText = text.replace(/<!--comment:\d+-->/g, '');
        let result = escapeHtml(cleanedText);
        
        // Bold
        result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        result = result.replace(/__(.+?)__/g, '<strong>$1</strong>');
        
        // Italic
        result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
        result = result.replace(/_(.+?)_/g, '<em>$1</em>');
        
        // Strikethrough
        result = result.replace(/~~(.+?)~~/g, '<del>$1</del>');
        
        // Inline code
        result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
        
        // Links
        result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
        
        // Images
        result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');
        
        // Wrap plain text segments (between tags) in spans for atomic editing
        result = wrapPlainTextSegments(result);
        
        // Process inline comments if line number and original line provided
        if (lineNumber !== undefined && originalLine !== undefined) {
            result = processInlineComments(result, originalLine, lineNumber);
        }
        
        return result;
    };

    const wrapPlainTextSegments = (html: string): string => {
        // If there are no tags, it's all plain text - wrap the whole thing
        if (!/<[^>]+>/.test(html)) {
            return html.trim() ? `<span class="plain-text">${html}</span>` : html;
        }
        
        // Split by tags, wrap non-empty text segments
        const parts: string[] = [];
        let lastIndex = 0;
        const tagRegex = /<[^>]+>/g;
        let match;
        
        while ((match = tagRegex.exec(html)) !== null) {
            // Text before this tag
            const textBefore = html.slice(lastIndex, match.index);
            if (textBefore.trim()) {
                parts.push(`<span class="plain-text">${textBefore}</span>`);
            } else if (textBefore) {
                parts.push(textBefore); // preserve whitespace without wrapping
            }
            
            // The tag itself
            parts.push(match[0]);
            lastIndex = match.index + match[0].length;
        }
        
        // Text after the last tag
        const textAfter = html.slice(lastIndex);
        if (textAfter.trim()) {
            parts.push(`<span class="plain-text">${textAfter}</span>`);
        } else if (textAfter) {
            parts.push(textAfter);
        }
        
        return parts.join('');
    };

    const renderRemovedLine = (line: string): string => {
        // Render a single line of removed content as markdown
        const trimmed = line.trim();
        
        // Headers
        const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (headerMatch) {
            const level = headerMatch[1].length;
            return `<h${level} class="removed-content">${parseInline(headerMatch[2])}</h${level}>`;
        }
        
        // Blockquote
        if (trimmed.startsWith('>')) {
            return `<blockquote class="removed-content"><p>${parseInline(trimmed.slice(1).trim())}</p></blockquote>`;
        }
        
        // Regular paragraph/text
        if (trimmed) {
            return `<p class="removed-content">${parseInline(trimmed)}</p>`;
        }
        
        return '';
    };

    const renderRemovedBlock = (removedContent: string): string => {
        const removedLinesArr = removedContent.split('\n');
        let renderedRemoved = '';
        let inRemovedList = false;
        let removedListType: 'ul' | 'ol' = 'ul';

        const flushRemovedList = () => {
            if (inRemovedList) {
                renderedRemoved += `</${removedListType}>`;
                inRemovedList = false;
            }
        };

        removedLinesArr.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed) {
                flushRemovedList();
                return;
            }

            const ulMatch = trimmed.match(/^[-*+]\s+(.+)$/);
            const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);

            if (ulMatch || olMatch) {
                const type = ulMatch ? 'ul' : 'ol';
                const itemText = parseInline((ulMatch || olMatch)![1]);
                if (!inRemovedList || removedListType !== type) {
                    flushRemovedList();
                    removedListType = type;
                    renderedRemoved += `<${type} class="removed-content-list">`;
                    inRemovedList = true;
                }
                renderedRemoved += `<li class="removed-content">${itemText}</li>`;
                return;
            }

            flushRemovedList();
            renderedRemoved += renderRemovedLine(line);
        });

        flushRemovedList();

        return `<div class="diff-removed-block"><span class="diff-removed-label">removed</span>${renderedRemoved}</div>`;
    };

    // Render removed list items inline within a list (not as a full-width block)
    const renderRemovedListItems = (removedContent: string, parentTag: 'ul' | 'ol'): string => {
        const removedLinesArr = removedContent.split('\n');
        let result = '';

        removedLinesArr.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed) return;

            const ulMatch = trimmed.match(/^[-*+]\s+(.+)$/);
            const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);

            if (ulMatch || olMatch) {
                const itemText = parseInline((ulMatch || olMatch)![1]);
                result += `<li class="diff-line removed">${itemText}</li>`;
            } else {
                // Non-list content in removed section - render as a removed list item
                result += `<li class="diff-line removed">${parseInline(trimmed)}</li>`;
            }
        });

        return result;
    };

    const wrapWithDiff = (content: string, lineNumber: number, isBlock: boolean = false): string => {
        const isAdded = addedLines.has(lineNumber);
        const removedContent = removedLines.get(lineNumber);
        
        let wrapped = '';
        
        // Show removed content before this line if any
        if (removedContent) {
            wrapped += renderRemovedBlock(removedContent);
        }
        
        // Apply comment wrapping first
        let contentWithComments = wrapWithComments(content, lineNumber, isBlock);
        
        // Always add data-line for click-to-navigate, add diff styling if added
        if (isAdded) {
            const lineNumHtml = showLineNumbers ? `<span class="line-number">${lineNumber}</span>` : '';
            if (isBlock) {
                wrapped += `<div class="diff-line added clickable" data-line="${lineNumber}">${lineNumHtml}${contentWithComments}</div>`;
            } else {
                wrapped += `<span class="diff-line added clickable" data-line="${lineNumber}">${lineNumHtml}${contentWithComments}</span>`;
            }
        } else {
            // Add data-line to non-diff content too for click-to-navigate
            if (isBlock) {
                // Inject data-line into the first tag of content
                wrapped += contentWithComments.replace(/^<(\w+)/, `<$1 data-line="${lineNumber}"`);
            } else {
                wrapped += contentWithComments;
            }
        }
        
        return wrapped;
    };

    const flushList = () => {
        if (inList && listItems.length > 0) {
            // Build nested list structure based on indentation
            const buildNestedList = (
                items: typeof listItems,
                startIdx: number,
                currentIndent: number
            ): { html: string; endIdx: number } => {
                if (startIdx >= items.length) {
                    return { html: '', endIdx: startIdx };
                }

                const firstItem = items[startIdx];
                const tag = firstItem.type;
                let listHtml = `<${tag}>`;
                let i = startIdx;

                while (i < items.length) {
                    const item = items[i];
                    
                    // If we encounter an item with less indentation than our level, we're done
                    if (item.indent < currentIndent) {
                        break;
                    }

                    // If indentation matches our current level, add the item
                    if (item.indent === currentIndent) {
                        const lineNum = item.lineNumber;
                        const removedContent = removedLines.get(lineNum);
                        
                        // Render removed list items inline (not as a separate block)
                        if (removedContent) {
                            listHtml += renderRemovedListItems(removedContent, tag);
                        }

                        const isAdded = addedLines.has(lineNum);
                        const liClass = isAdded ? ' class="diff-line added"' : '';
                        listHtml += `<li${liClass} data-line="${lineNum}">${item.content}`;
                        
                        // Look ahead to see if next items are nested under this one
                        if (i + 1 < items.length && items[i + 1].indent > currentIndent) {
                            const nested = buildNestedList(items, i + 1, items[i + 1].indent);
                            listHtml += nested.html;
                            i = nested.endIdx;
                        } else {
                            i++;
                        }
                        
                        listHtml += '</li>';
                    } else {
                        // Deeper indentation than expected at this level - shouldn't happen
                        // but handle gracefully by treating as nested
                        const nested = buildNestedList(items, i, item.indent);
                        listHtml += nested.html;
                        i = nested.endIdx;
                    }
                }

                listHtml += `</${tag}>`;
                return { html: listHtml, endIdx: i };
            };

            // Start with the indent of the first item
            const result = buildNestedList(listItems, 0, listItems[0].indent);
            html += result.html;
            listItems = [];
            inList = false;
        }
    };

    const parseTableCells = (line: string): string[] => {
        return line
            .split('|')
            .map(cell => cell.trim())
            .filter((cell, idx, arr) => idx !== 0 || cell !== '')
            .filter((cell, idx, arr) => idx !== arr.length - 1 || cell !== '');
    };

    const renderRemovedTableRows = (removedContent: string, columnCount: number): string => {
        const removedLinesArr = removedContent.split('\n');
        let removedHtml = '';
        removedLinesArr.forEach(removedLine => {
            const trimmed = removedLine.trim();
            if (!trimmed) return;
            if (/^\|?\s*[-:]+[-|\s:]*\|?\s*$/.test(trimmed)) return;
            if (isTableRow(removedLine)) {
                const cells = parseTableCells(removedLine);
                removedHtml += `<tr class="diff-row-removed">`;
                cells.forEach(cell => {
                    removedHtml += `<td>${parseInline(cell)}</td>`;
                });
                removedHtml += '</tr>';
            } else {
                const colspan = Math.max(columnCount, 1);
                removedHtml += `<tr class="diff-row-removed"><td colspan="${colspan}">${parseInline(removedLine)}</td></tr>`;
            }
        });
        return removedHtml;
    };

    const flushTable = () => {
        if (inTable && tableRows.length > 0) {
            // Check if entire table is new (all content rows are added)
            const contentRows = tableRows.filter(({ line }) => 
                !/^\|?\s*[-:]+[-|\s:]*\|?\s*$/.test(line)
            );
            const allRowsAdded = contentRows.length > 0 && 
                contentRows.every(({ lineNumber }) => addedLines.has(lineNumber));
            const someRowsAdded = contentRows.some(({ lineNumber }) => addedLines.has(lineNumber));

            let tableHtml = '<table>';
            let isHeader = true;
            let skipNext = false;
            const columnCount = Math.max(
                1,
                ...contentRows.map(({ line }) => parseTableCells(line).length)
            );

            for (let i = 0; i < tableRows.length; i++) {
                if (skipNext) {
                    skipNext = false;
                    continue;
                }

                const { line, lineNumber } = tableRows[i];
                
                // Check if this is a separator row (|---|---|)
                if (/^\|?\s*[-:]+[-|\s:]*\|?\s*$/.test(line)) {
                    continue;
                }

                const removedContent = removedLines.get(lineNumber);
                if (removedContent) {
                    tableHtml += renderRemovedTableRows(removedContent, columnCount);
                }

                const cells = parseTableCells(line);

                const isAdded = addedLines.has(lineNumber);
                
                // Always add data-line for click-to-navigate
                // Use subtle row highlighting only for mixed tables (not all-new tables)
                let rowClass = '';
                if (isAdded && !allRowsAdded) {
                    rowClass = ' class="diff-row-added" data-line="' + lineNumber + '"';
                } else {
                    rowClass = ' data-line="' + lineNumber + '"';
                }
                
                const cellTag = isHeader ? 'th' : 'td';

                tableHtml += `<tr${rowClass}>`;
                cells.forEach(cell => {
                    tableHtml += `<${cellTag}>${parseInline(cell)}</${cellTag}>`;
                });
                tableHtml += '</tr>';

                // Check if next row is separator (means current was header)
                if (isHeader && i + 1 < tableRows.length) {
                    const nextLine = tableRows[i + 1].line;
                    if (/^\|?\s*[-:]+[-|\s:]*\|?\s*$/.test(nextLine)) {
                        isHeader = false;
                        skipNext = true;
                    } else {
                        isHeader = false;
                    }
                } else {
                    isHeader = false;
                }
            }

            tableHtml += '</table>';

            // Wrap entire table if all rows are added
            if (allRowsAdded) {
                html += `<div class="diff-table-wrapper added" data-line="${tableStartLine}">${tableHtml}</div>`;
            } else {
                html += tableHtml;
            }

            tableRows = [];
            inTable = false;
        }
    };

    const isTableRow = (line: string): boolean => {
        const trimmed = line.trim();
        
        // Not a table if it's a list item (even if it contains |)
        if (/^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
            return false;
        }
        
        // Not a table if it's a blockquote
        if (trimmed.startsWith('>')) {
            return false;
        }
        
        // A table row should either:
        // 1. Start and end with | (proper table format)
        // 2. Or have at least 2 pipes indicating multiple cells
        // Also check it's not just a pipe in link text like [text | more](url)
        
        // If line starts with |, it's likely a table
        if (trimmed.startsWith('|')) {
            return true;
        }
        
        // Count pipes that are NOT inside [...] brackets (links/images)
        let pipeCount = 0;
        let inBrackets = 0;
        for (const char of trimmed) {
            if (char === '[') inBrackets++;
            else if (char === ']') inBrackets = Math.max(0, inBrackets - 1);
            else if (char === '|' && inBrackets === 0) pipeCount++;
        }
        
        // Need at least 2 unbracketed pipes to be a table (separating cells)
        return pipeCount >= 2;
    };

    // Track if we're inside COMMENTS-DATA block
    let inCommentsDataBlock = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNumber = i + 1;

        // Skip COMMENTS-DATA block (it's metadata, not content to render)
        // Check if this line starts a COMMENTS-DATA block
        if (line.includes('COMMENTS-DATA') || (line.trim().startsWith('<!--') && (line.includes('COMMENTS') || inCommentsDataBlock))) {
            inCommentsDataBlock = true;
        }
        if (inCommentsDataBlock) {
            // Skip until we find the closing --> 
            if (line.includes('-->')) {
                inCommentsDataBlock = false;
            }
            continue;
        }
        
        // Also skip lines that are just <!-- (opening of a comment block that might be COMMENTS-DATA)
        // This handles the case where <!-- is on its own line before COMMENTS-DATA
        if (line.trim() === '<!--' && i + 1 < lines.length && lines[i + 1].includes('COMMENTS-DATA')) {
            inCommentsDataBlock = true;
            continue;
        }
        
        // Also skip lines that are just HTML comment markers (block comments)
        if (/^<!--comment:\d+-->$/.test(line.trim())) {
            // This is a block comment marker on its own line - skip it
            // The comment will be handled by wrapWithComments for the next line
            continue;
        }

        // Check for removed content that should appear at the end of the file
        if (i === lines.length - 1) {
            // Will handle after processing the last line
        }

        // Code blocks
        if (line.startsWith('```')) {
            if (!inCodeBlock) {
                flushList();
                flushTable();
                inCodeBlock = true;
                codeBlockLang = line.slice(3).trim();
                codeBlockContent = '';
                codeBlockStartLine = lineNumber;
            } else {
                // End code block
                const codeLines = codeBlockContent.split('\n');
                let codeHtml = '<pre><code>';
                codeLines.forEach((codeLine, idx) => {
                    const codeLineNum = codeBlockStartLine + 1 + idx;
                    const isAdded = addedLines.has(codeLineNum);
                    const escapedLine = escapeHtml(codeLine);
                    if (isAdded) {
                        codeHtml += `<span class="diff-line added" data-line="${codeLineNum}">${escapedLine}</span>\n`;
                    } else {
                        // Always add data-line for click-to-navigate
                        codeHtml += `<span data-line="${codeLineNum}">${escapedLine}</span>\n`;
                    }
                });
                codeHtml += '</code></pre>';
                
                // Check if the entire block was added
                const blockAdded = addedLines.has(codeBlockStartLine);
                if (blockAdded) {
                    html += wrapWithDiff(codeHtml, codeBlockStartLine, true);
                } else {
                    html += codeHtml;
                }
                
                inCodeBlock = false;
            }
            continue;
        }

        if (inCodeBlock) {
            codeBlockContent += (codeBlockContent ? '\n' : '') + line;
            continue;
        }

        // Empty line
        if (line.trim() === '') {
            flushList();
            flushTable();
            // Check for removed content here
            const removedContent = removedLines.get(lineNumber);
            if (removedContent) {
                html += renderRemovedBlock(removedContent);
            }
            continue;
        }

        // Table rows
        if (isTableRow(line)) {
            if (!inTable) {
                flushList();
                inTable = true;
                tableStartLine = lineNumber;
            }
            tableRows.push({ line, lineNumber });
            continue;
        } else if (inTable) {
            flushTable();
        }

        // Headers
        const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headerMatch) {
            flushList();
            flushTable();
            const level = headerMatch[1].length;
            // Check if previous line was a block comment marker
            const prevLine = i > 0 ? lines[i - 1] : '';
            const blockCommentMatch = prevLine.trim().match(/^<!--comment:(\d+)-->$/);
            let headerContent = headerMatch[2].trim();
            const content = parseInline(headerContent, line, lineNumber);
            let headerHtml = `<h${level}>${content}</h${level}>`;
            // Apply block comment if previous line was a comment marker
            // The comment marker is on the previous line, but the comment targets the current line (the heading)
            if (blockCommentMatch) {
                const commentId = parseInt(blockCommentMatch[1], 10);
                const comment = comments?.[commentId.toString()];
                if (comment && comment.target.type === 'block' && !processedComments.has(comment.id)) {
                    // Mark as processed immediately to prevent duplicates
                    processedComments.add(comment.id);
                    // Store thread for later rendering
                    if (!commentThreadsHtml.some(html => html.includes(`comment-thread-${comment.id}`))) {
                        commentThreadsHtml.push(renderCommentThread(comment));
                    }
                    // Generate badge
                    const badge = renderCommentBadge(comment);
                    const hasPlan = comment.plan !== null;
                    const hasResponse = comment.response !== null;
                    const statusClass = hasResponse ? 'comment-has-response' : hasPlan ? 'comment-has-plan' : 'comment-active';
                    // Inject badge before the heading
                    headerHtml = `<span class="comment-highlight-block ${statusClass}">${badge}</span>${headerHtml}`;
                }
            }
            html += wrapWithDiff(headerHtml, lineNumber, true);
            continue;
        }

        // Horizontal rule
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
            flushList();
            flushTable();
            html += '<hr>';
            continue;
        }

        // Blockquote
        if (line.startsWith('>')) {
            flushList();
            flushTable();
            let quoteContent = line.slice(1).trim().replace(/^<!--comment:\d+-->\s*/, '');
            const content = parseInline(quoteContent, line, lineNumber);
            const quoteHtml = `<blockquote><p>${content}</p></blockquote>`;
            html += wrapWithDiff(quoteHtml, lineNumber, true);
            continue;
        }

        // Unordered list
        const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
        if (ulMatch) {
            if (!inList) {
                flushList();
                inList = true;
            }
            const indent = ulMatch[1].length;
            listItems.push({
                content: parseInline(ulMatch[2], line, lineNumber),
                indent,
                lineNumber,
                type: 'ul'
            });
            continue;
        }

        // Ordered list
        const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
        if (olMatch) {
            if (!inList) {
                flushList();
                inList = true;
            }
            const indent = olMatch[1].length;
            listItems.push({
                content: parseInline(olMatch[2], line, lineNumber),
                indent,
                lineNumber,
                type: 'ol'
            });
            continue;
        }

        // Paragraph
        flushList();
        flushTable();
        // Remove block comment markers from paragraph line
        let paragraphLine = line.replace(/^<!--comment:\d+-->\s*/, '').trim();
        const content = parseInline(paragraphLine, line, lineNumber);
        const pHtml = `<p>${content}</p>`;
        html += wrapWithDiff(pHtml, lineNumber, true);
    }

    // Flush any remaining list or table
    flushList();
    flushTable();

    // Check for any removed content at the very end
    const lastLineRemoved = removedLines.get(lines.length + 1);
    if (lastLineRemoved) {
        html += renderRemovedBlock(lastLineRemoved);
    }

    // Append all comment threads at the end
    if (commentThreadsHtml.length > 0) {
        html += '<div class="comment-threads-container">' + commentThreadsHtml.join('') + '</div>';
    }

    return html || '<div class="empty-state"><div class="icon">📄</div><p>Empty document</p></div>';
}
