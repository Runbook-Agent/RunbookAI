/**
 * Table Component
 *
 * Renders markdown tables with box-drawing characters for the terminal.
 * Uses cli-table3 for proper column alignment and borders.
 */

import React from 'react';
import { Text, Box } from 'ink';
import Table from 'cli-table3';

interface TableProps {
  headers: string[];
  rows: string[][];
  alignments?: Array<'left' | 'center' | 'right' | null>;
}

/**
 * Parse a markdown table string into headers and rows
 */
export function parseMarkdownTable(tableString: string): {
  headers: string[];
  rows: string[][];
  alignments: Array<'left' | 'center' | 'right' | null>;
} | null {
  const lines = tableString.trim().split('\n');
  if (lines.length < 2) return null;

  // Parse header row
  const headerLine = lines[0];
  const headers = parseTableRow(headerLine);
  if (headers.length === 0) return null;

  // Parse alignment row (second line with dashes)
  const alignLine = lines[1];
  if (!alignLine.includes('-')) return null;
  const alignments = parseAlignments(alignLine);

  // Parse data rows
  const rows: string[][] = [];
  for (let i = 2; i < lines.length; i++) {
    const row = parseTableRow(lines[i]);
    if (row.length > 0) {
      rows.push(row);
    }
  }

  return { headers, rows, alignments };
}

/**
 * Parse a single table row
 */
function parseTableRow(line: string): string[] {
  // Remove leading/trailing pipes and split by |
  const trimmed = line.replace(/^\||\|$/g, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

/**
 * Parse alignment specifications from separator line
 */
function parseAlignments(line: string): Array<'left' | 'center' | 'right' | null> {
  const cells = parseTableRow(line);
  return cells.map((cell) => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return null;
  });
}

/**
 * Render a table with box-drawing characters
 */
export function MarkdownTable({
  headers,
  rows,
  alignments = [],
}: TableProps): React.ReactElement {
  // Create table with box-drawing characters
  const table = new Table({
    head: headers,
    style: {
      head: ['cyan'],
      border: ['gray'],
    },
    chars: {
      top: '─',
      'top-mid': '┬',
      'top-left': '┌',
      'top-right': '┐',
      bottom: '─',
      'bottom-mid': '┴',
      'bottom-left': '└',
      'bottom-right': '┘',
      left: '│',
      'left-mid': '├',
      mid: '─',
      'mid-mid': '┼',
      right: '│',
      'right-mid': '┤',
      middle: '│',
    },
    colAligns: alignments.map((a) => a || 'left'),
  });

  // Add rows
  for (const row of rows) {
    table.push(row);
  }

  // Render the table string
  const tableString = table.toString();

  return (
    <Box flexDirection="column" marginY={1}>
      <Text>{tableString}</Text>
    </Box>
  );
}

/**
 * Check if a line looks like the start of a markdown table
 */
export function isTableStart(line: string): boolean {
  return line.includes('|') && line.trim().startsWith('|');
}

/**
 * Check if a line is a table separator (e.g., |---|---|)
 */
export function isTableSeparator(line: string): boolean {
  return line.includes('|') && line.includes('-') && /^[\s|:-]+$/.test(line.replace(/-/g, ''));
}
