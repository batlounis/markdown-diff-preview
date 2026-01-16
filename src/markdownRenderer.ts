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
        
        return result;
    };

    const wrapWithDiff = (content: string, lineNumber: number, isBlock: boolean = false): string => {
        const isAdded = addedLines.has(lineNumber);
        const removedContent = removedLines.get(lineNumber);
        
        let wrapped = '';
        
        // Show removed content before this line if any
        if (removedContent) {
            const removedHtml = escapeHtml(removedContent);
            wrapped += `<div class="diff-removed-block"><span class="diff-removed-label">removed</span>${removedHtml}</div>`;
        }
        
        if (isAdded) {
            const lineNumHtml = showLineNumbers ? `<span class="line-number">${lineNumber}</span>` : '';
            if (isBlock) {
                wrapped += `<div class="diff-line added clickable" data-line="${lineNumber}">${lineNumHtml}${content}</div>`;
            } else {
                wrapped += `<span class="diff-line added clickable" data-line="${lineNumber}">${lineNumHtml}${content}</span>`;
            }
        } else {
            wrapped += content;
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
                    html += `<li>${item}</li>`;
                }
            });
            html += `</${tag}>`;
            listItems = [];
            inList = false;
        }
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
                        codeHtml += escapedLine + '\n';
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
            // Check for removed content here
            const removedContent = removedLines.get(lineNumber);
            if (removedContent) {
                html += `<div class="diff-removed-block"><span class="diff-removed-label">removed</span>${escapeHtml(removedContent)}</div>`;
            }
            continue;
        }

        // Headers
        const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headerMatch) {
            flushList();
            const level = headerMatch[1].length;
            const content = parseInline(headerMatch[2]);
            const headerHtml = `<h${level}>${content}</h${level}>`;
            html += wrapWithDiff(headerHtml, lineNumber, true);
            continue;
        }

        // Horizontal rule
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
            flushList();
            html += '<hr>';
            continue;
        }

        // Blockquote
        if (line.startsWith('>')) {
            flushList();
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
        const content = parseInline(line);
        const pHtml = `<p>${content}</p>`;
        html += wrapWithDiff(pHtml, lineNumber, true);
    }

    // Flush any remaining list
    flushList();

    // Check for any removed content at the very end
    const lastLineRemoved = removedLines.get(lines.length + 1);
    if (lastLineRemoved) {
        html += `<div class="diff-removed-block"><span class="diff-removed-label">removed</span>${escapeHtml(lastLineRemoved)}</div>`;
    }

    return html || '<div class="empty-state"><div class="icon">📄</div><p>Empty document</p></div>';
}
