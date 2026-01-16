import { FileDiff } from './gitDiff';

// Simple markdown parser - we'll do this without external dependencies for the webview
export async function renderMarkdownWithDiff(
    markdown: string,
    diff: FileDiff | null,
    showLineNumbers: boolean
): Promise<string> {
    const lines = markdown.split('\n');
    const addedLines = diff?.addedLines || new Set<number>();
    const removedLines = diff?.removedLines || new Map<number, string>();

    let html = '';
    let inCodeBlock = false;
    let codeBlockContent = '';
    let codeBlockLang = '';
    let codeBlockStartLine = 0;
    let inList = false;
    let listType: 'ul' | 'ol' = 'ul';
    let listItems: string[] = [];
    let listStartLine = 0;
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

    const parseInline = (text: string): string => {
        let result = escapeHtml(text);
        
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
        // Match text that's not inside a tag
        result = wrapPlainTextSegments(result);
        
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
        
        // List items
        if (/^[-*+]\s+/.test(trimmed)) {
            return `<li class="removed-content">${parseInline(trimmed.replace(/^[-*+]\s+/, ''))}</li>`;
        }
        if (/^\d+\.\s+/.test(trimmed)) {
            return `<li class="removed-content">${parseInline(trimmed.replace(/^\d+\.\s+/, ''))}</li>`;
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

    const wrapWithDiff = (content: string, lineNumber: number, isBlock: boolean = false): string => {
        const isAdded = addedLines.has(lineNumber);
        const removedContent = removedLines.get(lineNumber);
        
        let wrapped = '';
        
        // Show removed content before this line if any
        if (removedContent) {
            const removedLinesArr = removedContent.split('\n');
            const renderedRemoved = removedLinesArr.map(renderRemovedLine).join('');
            wrapped += `<div class="diff-removed-block"><span class="diff-removed-label">removed</span>${renderedRemoved}</div>`;
        }
        
        // Always add data-line for click-to-navigate, add diff styling if added
        if (isAdded) {
            const lineNumHtml = showLineNumbers ? `<span class="line-number">${lineNumber}</span>` : '';
            if (isBlock) {
                wrapped += `<div class="diff-line added clickable" data-line="${lineNumber}">${lineNumHtml}${content}</div>`;
            } else {
                wrapped += `<span class="diff-line added clickable" data-line="${lineNumber}">${lineNumHtml}${content}</span>`;
            }
        } else {
            // Add data-line to non-diff content too for click-to-navigate
            if (isBlock) {
                // Inject data-line into the first tag of content
                wrapped += content.replace(/^<(\w+)/, `<$1 data-line="${lineNumber}"`);
            } else {
                wrapped += content;
            }
        }
        
        return wrapped;
    };

    const flushList = () => {
        if (inList && listItems.length > 0) {
            const tag = listType;
            html += `<${tag}>`;
            listItems.forEach((item, idx) => {
                const lineNum = listStartLine + idx;
                const isAdded = addedLines.has(lineNum);
                if (isAdded) {
                    html += `<li class="diff-line added" data-line="${lineNum}">${item}</li>`;
                } else {
                    // Always add data-line for click-to-navigate
                    html += `<li data-line="${lineNum}">${item}</li>`;
                }
            });
            html += `</${tag}>`;
            listItems = [];
            inList = false;
        }
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

                const cells = line
                    .split('|')
                    .map(cell => cell.trim())
                    .filter((cell, idx, arr) => idx !== 0 || cell !== '') // Remove empty first cell
                    .filter((cell, idx, arr) => idx !== arr.length - 1 || cell !== ''); // Remove empty last cell

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

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNumber = i + 1;

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
                html += `<div class="diff-removed-block"><span class="diff-removed-label">removed</span>${escapeHtml(removedContent)}</div>`;
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
            const content = parseInline(headerMatch[2]);
            const headerHtml = `<h${level}>${content}</h${level}>`;
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
            const content = parseInline(line.slice(1).trim());
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
                listType = 'ul';
                listStartLine = lineNumber;
            }
            listItems.push(parseInline(ulMatch[2]));
            continue;
        }

        // Ordered list
        const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
        if (olMatch) {
            if (!inList) {
                flushList();
                inList = true;
                listType = 'ol';
                listStartLine = lineNumber;
            }
            listItems.push(parseInline(olMatch[2]));
            continue;
        }

        // Paragraph
        flushList();
        flushTable();
        const content = parseInline(line);
        const pHtml = `<p>${content}</p>`;
        html += wrapWithDiff(pHtml, lineNumber, true);
    }

    // Flush any remaining list or table
    flushList();
    flushTable();

    // Check for any removed content at the very end
    const lastLineRemoved = removedLines.get(lines.length + 1);
    if (lastLineRemoved) {
        html += `<div class="diff-removed-block"><span class="diff-removed-label">removed</span>${escapeHtml(lastLineRemoved)}</div>`;
    }

    return html || '<div class="empty-state"><div class="icon">📄</div><p>Empty document</p></div>';
}
