# /add-comments-to-requirements

## Command: Add Comments to Requirements Markdown

Get comments from Confluence and add them in the relevant requirement md. Execute the following steps:

### Execution Steps

1. **Read the requirements markdown file** - Identify the target file and read its contents

2. **Extract comments from source** (if applicable):
   - If from Confluence: Extract comment text and identify which requirement/section it relates to
   - If from user input: Use the provided comment text
   - Note the specific text or section in the requirements that needs commenting

3. **Determine comment placement**:
   - For specific words/phrases: Use inline comment format
   - For entire sections: Use block comment format
   - Calculate accurate line numbers (1-indexed)

4. **Add comment markers to the markdown**:
   - **Inline**: Place `<!--comment:N-->` immediately after the text: `text<!--comment:1--> more text`
   - **Block**: Place `<!--comment:N-->` on its own line before the element: `<!--comment:2-->\n## Heading`
   - Number comments sequentially starting from 1

5. **Create/Update COMMENTS-DATA block**:
   - Locate or create the COMMENTS-DATA block at the end of the file
   - If block exists, merge new comments into existing JSON
   - If block doesn't exist, create it with proper structure

6. **Build comment data structure** for each comment:

```json
{
  "N": {
    "id": N,
    "target": {
      "type": "inline" | "block",
      "line": <line_number>,
      "text": "<exact_text>" (inline only),
      "position": <char_position> (inline only),
      "element": "<element_type>" (block only)
    },
    "thread": [
      {
        "id": "N-1",
        "author": "user" | "ai",
        "content": "<trimmed_comment_text>",
        "timestamp": "<ISO_8601_timestamp>"
      }
    ],
    "plan": { ... } | null,
    "response": {
      "content": "<trimmed_response_text>",
      "status": "draft",
      "editable": true
    }
  }
}
```

7. **Generate AI response** (REQUIRED) **and optionally a plan**:
   - For each comment, generate a **response** that addresses the feedback. A **plan** is optional—include one when the comment implies document changes or follow-up work; omit it when a direct reply is sufficient.
   - **When to include a plan:** Comment suggests changes, asks "should we add X?", or implies actionable follow-up. Set `plan` to an object with `content`, `status: "pending"`, `editable: true`.
   - **When to omit the plan:** Comment is a question answered by the response alone, or feedback that doesn't require document changes. Set `plan` to `null` (or omit the key).
   - **Plan Requirements** (when plan is included):
     - Must be concrete and specific - avoid vague language like "Consider adding", "Maybe include", "Think about"
     - Must specify exact location (line numbers, section names) where changes will be made
     - Must list specific actions: "Add X section after line Y", "Clarify Z in the ABC section", "Update the DEF field to specify GHI"
     - Must include what content will be added/changed, not just that something should be considered
     - Example GOOD: "Add a new 'API Rate Limits' section after the Authentication section (after line 45) that specifies: 1000 requests per hour per API key, rate limit headers in responses, and error handling for exceeded limits."
     - Example BAD: "Consider adding information about rate limits or API throttling."
   - **Response Requirements:**
     - Must directly answer the commenter's question or address their concern
     - If commenter asks "Is X worth doing?" or "Should we include Y?", answer directly: "Yes, we should..." or "No, we won't..." with reasoning
     - If commenter asks "What about Z?", explain how Z will be handled
     - If commenter points out a discrepancy, acknowledge it and explain the resolution
     - Must show understanding of the commenter's specific concern, not just generic acknowledgment
     - Response should be written as if replying directly to the commenter in a conversation
     - Example GOOD: "Yes, we should document rate limits. I'll add an 'API Rate Limits' section after Authentication that specifies 1000 requests per hour per API key. I'll also include information about rate limit headers in responses and how to handle rate limit errors, which addresses your concern about developers hitting unexpected limits."
     - Example BAD: "Consider adding information about API rate limits to help developers understand throttling behavior."
   - Add `response` object to each comment; add `plan` object only when actionable follow-up is needed
   - Set response status to `"draft"` and plan status (when present) to `"pending"`
   - Mark both as `"editable": true` when present

### Format Rules

- **Comment markers**: `<!--comment:N-->` where N is sequential number
- **Line numbers**: 1-indexed, count after inserting markers
- **Content**: Always trim whitespace (no leading/trailing spaces/newlines)
- **Timestamps**: Current time in ISO 8601 format: `"2026-01-26T14:30:00Z"`
- **Thread IDs**: Format `"N-M"` where N is comment ID, M is sequential item number
- **COMMENTS-DATA**: Always at end of file, wrapped in HTML comment: `<!--\nCOMMENTS-DATA\n{...}\n-->`

### Example Execution

**User request**: "Get comments from Confluence about the authentication section and add them to requirements.md"

**Steps**:
1. Read `requirements.md`
2. Extract Confluence comments about authentication
3. Find authentication section in requirements.md (e.g., line 15: "Users must authenticate using OAuth 2.0")
4. Add inline marker: `Users must authenticate<!--comment:1--> using OAuth 2.0.`
5. Create COMMENTS-DATA block:
```markdown
<!--
COMMENTS-DATA
{
  "1": {
    "id": 1,
    "target": {
      "type": "inline",
      "line": 15,
      "text": "authenticate",
      "position": 18
    },
    "thread": [
      {
        "id": "1-1",
        "author": "user",
        "content": "Should we also support SAML authentication?",
        "timestamp": "2026-01-26T14:30:00Z"
      }
    ],
    "plan": {
      "content": "Add clarification about whether SAML should also be supported, or if OAuth 2.0 is the only required method.",
      "status": "pending",
      "editable": true
    },
    "response": {
      "content": "Users must authenticate using OAuth 2.0. SAML authentication may be supported as an optional alternative.",
      "status": "draft",
      "editable": true
    }
  }
}
-->
```

### Validation Checklist

Before completing:
- [ ] All comment markers have corresponding entries in COMMENTS-DATA
- [ ] Comment IDs are sequential and unique
- [ ] Line numbers are accurate (account for inserted markers)
- [ ] All content strings are trimmed
- [ ] Timestamps are in ISO 8601 format
- [ ] COMMENTS-DATA block is at the end of the file
- [ ] JSON is valid and properly formatted
- [ ] Block comments target the element line, not the marker line
- [ ] **Every comment has a `response` object** (not null) showing revised text
- [ ] **`plan` is optional** - include when comment implies document changes; use `null` or omit when response-only is sufficient
- [ ] When plan is present: plan status is `"pending"`, marked `"editable": true`
- [ ] Response status is set to `"draft"`, marked `"editable": true`
- [ ] **Plan is concrete** - No vague language like "Consider", "Maybe", "Think about"; includes specific location and actions
- [ ] **Response directly answers commenter** - Addresses their specific question/concern, not generic acknowledgment

### Common Patterns

**Pattern 1: Single inline comment**
```markdown
Text with comment<!--comment:1--> here.
```

**Pattern 2: Block comment on heading**
```markdown
<!--comment:2-->
## Section Title
```

**Pattern 3: Multiple comments on same line**
```markdown
Text<!--comment:1--> with<!--comment:2--> multiple comments.
```

**Pattern 4: Merging with existing COMMENTS-DATA**
- Read existing COMMENTS-DATA block
- Parse JSON
- Add new comments to the object
- Re-serialize and replace the block

### Plan and Response Examples

**When to use response only (no plan):** Simple questions, clarifications, or feedback that don't imply document changes. Example: "Is this section up to date?" → answer in the response; `plan` can be `null`.

**When to include a plan:** Comment suggests adding/changing content, asks "should we add X?", or implies actionable follow-up. Include a concrete `plan` object.

**Example Comment:** "Should we also support SAML authentication? The current requirements only mention OAuth 2.0."

**BAD Plan (too vague):**
```json
"plan": {
  "content": "Consider adding clarification about whether SAML should also be supported, or if OAuth 2.0 is the only required method.",
  "status": "pending",
  "editable": true
}
```

**GOOD Plan (concrete and specific):**
```json
"plan": {
  "content": "Update the authentication section (line 15) to clarify that OAuth 2.0 is the primary authentication method, and add a sentence specifying that SAML authentication may be supported as an optional alternative for enterprise customers. Update the 'Supported Authentication Methods' subsection to list both OAuth 2.0 (required) and SAML (optional).",
  "status": "pending",
  "editable": true
}
```

**BAD Response (doesn't answer the question):**
```json
"response": {
  "content": "Users must authenticate using OAuth 2.0. Consider adding support for SAML authentication as an alternative method.",
  "status": "draft",
  "editable": true
}
```

**GOOD Response (directly answers commenter's question):**
```json
"response": {
  "content": "Yes, we should support SAML as an optional alternative. I'll update the authentication section to specify that OAuth 2.0 is the primary method (required), and SAML will be supported as an optional alternative for enterprise customers who require it. The requirements will clarify that both methods are available, with OAuth 2.0 as the default.",
  "status": "draft",
  "editable": true
}
```

### Important Notes

- **Never reuse comment IDs** - Always use the next available sequential number
- **Calculate line numbers after insertion** - If inserting markers, recalculate target line numbers
- **Block comment line numbers** - The target line is the element line, not the marker line
- **Trim all strings** - Remove leading/trailing whitespace from all content fields
- **Preserve existing comments** - When updating, merge new comments with existing ones
- **Always generate a response** - Every comment MUST have a `response` object (never null). **Plan is optional** - include when the comment implies document changes or follow-up work; set to `null` or omit when a direct reply is enough.
- **When included, plan must be concrete and specific** - Avoid vague suggestions. Specify exact location (line numbers, section names), list specific actions, and describe what content will be added/changed. Use imperative language: "Add X", "Clarify Y", "Update Z" - not "Consider adding X"
- **Response must directly answer the commenter** - Read the comment carefully and address their specific question or concern. If they ask "Is X worth doing?", answer "Yes" or "No" with reasoning. If they point out a discrepancy, acknowledge and explain the resolution. Write as if replying directly to them in conversation
