/**
 * Script to generate a demo HTML file from a git diff file.
 * This uses the actual rendering code from the extension (via core modules).
 * 
 * Usage: npx ts-node scripts/generate-demo.ts [diff-file] [output-file]
 * Default: npx ts-node scripts/generate-demo.ts demo/test.txt demo/preview.html
 */

import * as fs from 'fs';
import * as path from 'path';

// Import from core modules - same code used by the extension
import { parseDiff, extractNewFileContent } from '../src/core/diffParser';
import { renderMarkdownWithDiff } from '../src/core/markdownRenderer';

function generateHtml(content: string, fileName: string, addedCount: number, removedCount: number): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Markdown Diff Preview - ${fileName}</title>
    <link rel="stylesheet" href="../media/styles.css">
</head>
<body>
    <button class="theme-toggle" onclick="toggleTheme()">Toggle Theme</button>

    <div class="header">
        <div class="header-left">
            <span class="file-name">${fileName}</span>
            <div class="git-info">
                <span class="branch-badge">main</span>
                <span class="status-badge modified">modified</span>
            </div>
        </div>
        <div class="diff-stats">
            ${addedCount > 0 ? `<span class="stat additions">+${addedCount} added</span>` : ''}
            ${removedCount > 0 ? `<span class="stat deletions">−${removedCount} removed</span>` : ''}
            <span class="diff-base">vs HEAD</span>
            <button class="refresh-btn" onclick="location.reload()">↻ Refresh</button>
        </div>
    </div>

    <div class="content">
        ${content}
    </div>

    <script>
        function toggleTheme() {
            document.body.classList.toggle('theme-light');
        }

        document.querySelectorAll('[data-line]').forEach(el => {
            el.addEventListener('click', () => {
                console.log('Navigate to line:', el.dataset.line);
            });
        });
    </script>
</body>
</html>`;
}

async function main() {
    const args = process.argv.slice(2);
    const diffFile = args[0] || 'demo/test.txt';
    const outputFile = args[1] || 'demo/preview.html';

    const projectRoot = path.resolve(__dirname, '..');
    const diffPath = path.resolve(projectRoot, diffFile);
    const outputPath = path.resolve(projectRoot, outputFile);

    console.log(`Reading diff from: ${diffPath}`);
    
    if (!fs.existsSync(diffPath)) {
        console.error(`Error: Diff file not found: ${diffPath}`);
        process.exit(1);
    }

    const diffContent = fs.readFileSync(diffPath, 'utf-8');
    
    // Extract file name from diff
    const fileNameMatch = diffContent.match(/^diff --git a\/(.+?) b\//m);
    const fileName = fileNameMatch ? path.basename(fileNameMatch[1]) : 'document.md';

    console.log(`Parsing diff for: ${fileName}`);

    // Parse the diff using the same code as the extension
    const diff = parseDiff(fileName, diffContent);
    
    // Extract the new file content
    const markdownContent = extractNewFileContent(diffContent);

    console.log(`Added lines: ${diff.addedLines.size}`);
    console.log(`Removed line positions: ${diff.removedLines.size}`);

    // Render the markdown with diff highlighting using the same code as the extension
    const renderedContent = await renderMarkdownWithDiff(markdownContent, diff, true);

    // Count removals (sum up all removed lines)
    let removedCount = 0;
    diff.removedLines.forEach(content => {
        removedCount += content.split('\n').filter(l => l.trim()).length;
    });

    // Generate full HTML
    const html = generateHtml(renderedContent, fileName, diff.addedLines.size, removedCount);

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write output
    fs.writeFileSync(outputPath, html, 'utf-8');
    console.log(`Generated: ${outputPath}`);
}

main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
