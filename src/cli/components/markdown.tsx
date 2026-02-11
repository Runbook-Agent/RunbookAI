/**
 * Rich Markdown Renderer
 *
 * Comprehensive markdown rendering for the terminal with support for:
 * - Headers (h1-h6)
 * - Bold, italics, strikethrough
 * - Inline code and code blocks with syntax highlighting
 * - Links (displayed as text [url])
 * - Blockquotes with colored borders
 * - Horizontal rules
 * - Tables with box-drawing characters
 * - Ordered and unordered lists
 * - Mermaid diagram detection and rendering
 */

import React from 'react';
import { Text, Box } from 'ink';
import { CodeBlock } from './code-block';
import { MarkdownTable, parseMarkdownTable, isTableStart, isTableSeparator } from './table';

interface MarkdownTextProps {
  content: string;
}

interface ParsedBlock {
  type: 'paragraph' | 'code' | 'table' | 'blockquote' | 'hr' | 'header' | 'list';
  content: string;
  language?: string;
  level?: number;
  items?: Array<{ indent: number; marker: string; text: string }>;
}

/**
 * Main markdown renderer component
 */
export function MarkdownText({ content }: MarkdownTextProps): React.ReactElement {
  const blocks = parseBlocks(content);

  return (
    <Box flexDirection="column">
      {blocks.map((block, index) => (
        <BlockRenderer key={index} block={block} />
      ))}
    </Box>
  );
}

/**
 * Parse content into blocks
 */
function parseBlocks(content: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code blocks (fenced with ```)
    if (line.startsWith('```')) {
      const language = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;

      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }

      blocks.push({
        type: 'code',
        content: codeLines.join('\n'),
        language: language || undefined,
      });
      i++; // Skip closing ```
      continue;
    }

    // Headers
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headerMatch) {
      blocks.push({
        type: 'header',
        content: headerMatch[2],
        level: headerMatch[1].length,
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line)) {
      blocks.push({ type: 'hr', content: '' });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i].startsWith('>') || lines[i].trim() === '')) {
        if (lines[i].startsWith('>')) {
          quoteLines.push(lines[i].replace(/^>\s?/, ''));
        } else if (quoteLines.length > 0) {
          quoteLines.push('');
        }
        i++;
        if (lines[i] && !lines[i].startsWith('>') && lines[i].trim() !== '') {
          break;
        }
      }
      blocks.push({
        type: 'blockquote',
        content: quoteLines.join('\n').trim(),
      });
      continue;
    }

    // Table
    if (isTableStart(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].includes('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      blocks.push({
        type: 'table',
        content: tableLines.join('\n'),
      });
      continue;
    }

    // List items (ordered and unordered)
    const listMatch = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      const items: Array<{ indent: number; marker: string; text: string }> = [];
      while (i < lines.length) {
        const itemMatch = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (itemMatch) {
          items.push({
            indent: itemMatch[1].length,
            marker: itemMatch[2],
            text: itemMatch[3],
          });
          i++;
        } else if (lines[i].trim() === '') {
          i++;
          break;
        } else {
          break;
        }
      }
      blocks.push({
        type: 'list',
        content: '',
        items,
      });
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Regular paragraph
    const paragraphLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('#') &&
      !lines[i].startsWith('```') &&
      !lines[i].startsWith('>') &&
      !/^[-*_]{3,}\s*$/.test(lines[i]) &&
      !isTableStart(lines[i])
    ) {
      paragraphLines.push(lines[i]);
      i++;
    }
    if (paragraphLines.length > 0) {
      blocks.push({
        type: 'paragraph',
        content: paragraphLines.join('\n'),
      });
    }
  }

  return blocks;
}

/**
 * Render a single block
 */
function BlockRenderer({ block }: { block: ParsedBlock }): React.ReactElement | null {
  switch (block.type) {
    case 'header':
      return <HeaderBlock level={block.level || 1} content={block.content} />;

    case 'code':
      return <CodeBlock code={block.content} language={block.language} />;

    case 'table': {
      const parsed = parseMarkdownTable(block.content);
      if (parsed) {
        return (
          <MarkdownTable
            headers={parsed.headers}
            rows={parsed.rows}
            alignments={parsed.alignments}
          />
        );
      }
      return <Text>{block.content}</Text>;
    }

    case 'blockquote':
      return <BlockquoteBlock content={block.content} />;

    case 'hr':
      return <HorizontalRule />;

    case 'list':
      return <ListBlock items={block.items || []} />;

    case 'paragraph':
      return (
        <Box marginY={0}>
          <Text>{renderInlineFormatting(block.content)}</Text>
        </Box>
      );

    default:
      return null;
  }
}

/**
 * Render a header with appropriate styling
 */
function HeaderBlock({ level, content }: { level: number; content: string }): React.ReactElement {
  const colors: Record<number, string> = {
    1: 'cyan',
    2: 'cyan',
    3: 'blue',
    4: 'blue',
    5: 'gray',
    6: 'gray',
  };

  return (
    <Box marginTop={1} marginBottom={0}>
      <Text color={colors[level] || 'cyan'} bold underline={level === 1}>
        {renderInlineFormatting(content)}
      </Text>
    </Box>
  );
}

/**
 * Render a blockquote with colored border
 */
function BlockquoteBlock({ content }: { content: string }): React.ReactElement {
  const lines = content.split('\n');

  return (
    <Box flexDirection="column" marginY={1}>
      {lines.map((line, index) => (
        <Box key={index}>
          <Text color="green">{'│ '}</Text>
          <Text color="gray" italic>
            {renderInlineFormatting(line)}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

/**
 * Render a horizontal rule
 */
function HorizontalRule(): React.ReactElement {
  return (
    <Box marginY={1}>
      <Text color="gray">{'─'.repeat(50)}</Text>
    </Box>
  );
}

/**
 * Render a list (ordered or unordered)
 */
function ListBlock({
  items,
}: {
  items: Array<{ indent: number; marker: string; text: string }>;
}): React.ReactElement {
  return (
    <Box flexDirection="column" marginY={0}>
      {items.map((item, index) => {
        const isOrdered = /^\d+\.$/.test(item.marker);
        const bulletChar = isOrdered ? item.marker : '•';
        const indentSpaces = ' '.repeat(Math.floor(item.indent / 2) * 2);

        return (
          <Box key={index}>
            <Text>
              {indentSpaces}
              <Text color="yellow">{bulletChar}</Text> {renderInlineFormatting(item.text)}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

// Global counter to ensure unique keys across all calls
let inlineKeyCounter = 0;

/**
 * Render inline formatting (bold, italic, strikethrough, code, links)
 */
function renderInlineFormatting(text: string): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Check for inline code first (highest priority)
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`(.*)$/s);
    if (codeMatch) {
      const [, before, code, after] = codeMatch;
      if (before) result.push(...renderInlineFormatting(before));
      result.push(
        <Text key={`inline-${inlineKeyCounter++}`} color="yellow" bold>
          {code}
        </Text>
      );
      remaining = after;
      continue;
    }

    // Check for bold (** or __)
    const boldMatch =
      remaining.match(/^(.*?)\*\*([^*]+)\*\*(.*)$/s) || remaining.match(/^(.*?)__([^_]+)__(.*)$/s);
    if (boldMatch) {
      const [, before, bold, after] = boldMatch;
      if (before) result.push(...renderInlineFormatting(before));
      result.push(
        <Text key={`inline-${inlineKeyCounter++}`} bold>
          {bold}
        </Text>
      );
      remaining = after;
      continue;
    }

    // Check for italics (* or _) - must not be followed by another */_
    const italicMatch =
      remaining.match(/^(.*?)(?<!\*)\*([^*]+)\*(?!\*)(.*)$/s) ||
      remaining.match(/^(.*?)(?<!_)_([^_]+)_(?!_)(.*)$/s);
    if (italicMatch) {
      const [, before, italic, after] = italicMatch;
      if (before) result.push(...renderInlineFormatting(before));
      result.push(
        <Text key={`inline-${inlineKeyCounter++}`} italic>
          {italic}
        </Text>
      );
      remaining = after;
      continue;
    }

    // Check for strikethrough (~~)
    const strikeMatch = remaining.match(/^(.*?)~~([^~]+)~~(.*)$/s);
    if (strikeMatch) {
      const [, before, strike, after] = strikeMatch;
      if (before) result.push(...renderInlineFormatting(before));
      result.push(
        <Text key={`inline-${inlineKeyCounter++}`} strikethrough>
          {strike}
        </Text>
      );
      remaining = after;
      continue;
    }

    // Check for links [text](url)
    const linkMatch = remaining.match(/^(.*?)\[([^\]]+)\]\(([^)]+)\)(.*)$/s);
    if (linkMatch) {
      const [, before, linkText, url, after] = linkMatch;
      if (before) result.push(...renderInlineFormatting(before));
      result.push(
        <Text key={`inline-${inlineKeyCounter++}`}>
          <Text color="blue" underline>
            {linkText}
          </Text>
          <Text color="gray" dimColor>
            {' '}
            [{url}]
          </Text>
        </Text>
      );
      remaining = after;
      continue;
    }

    // No more formatting found, add the rest as plain text
    result.push(<Text key={`inline-${inlineKeyCounter++}`}>{remaining}</Text>);
    break;
  }

  return result;
}

export { renderInlineFormatting };
