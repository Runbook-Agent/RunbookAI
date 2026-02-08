/**
 * Code Block Component
 *
 * Renders syntax-highlighted code blocks for the terminal.
 * Uses cli-highlight for language-specific syntax highlighting.
 */

import React from 'react';
import { Text, Box } from 'ink';
import highlight from 'cli-highlight';

interface CodeBlockProps {
  code: string;
  language?: string;
}

/**
 * Map common language aliases to cli-highlight language names
 */
function normalizeLanguage(lang: string): string {
  const aliases: Record<string, string> = {
    js: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    jsx: 'javascript',
    py: 'python',
    rb: 'ruby',
    sh: 'bash',
    shell: 'bash',
    yml: 'yaml',
    dockerfile: 'docker',
    tf: 'hcl',
    terraform: 'hcl',
  };
  return aliases[lang.toLowerCase()] || lang.toLowerCase();
}

/**
 * Render a syntax-highlighted code block
 */
export function CodeBlock({ code, language }: CodeBlockProps): React.ReactElement {
  let highlightedCode: string;

  try {
    if (language) {
      highlightedCode = highlight(code, {
        language: normalizeLanguage(language),
        ignoreIllegals: true,
      });
    } else {
      // Auto-detect language
      highlightedCode = highlight(code, { ignoreIllegals: true });
    }
  } catch {
    // Fall back to plain text if highlighting fails
    highlightedCode = code;
  }

  const lines = highlightedCode.split('\n');
  const lineNumberWidth = String(lines.length).length;

  return (
    <Box flexDirection="column" marginY={1}>
      {/* Header with language tag */}
      <Box>
        <Text color="gray">{'┌'}</Text>
        {language && (
          <>
            <Text color="gray">{'─'}</Text>
            <Text color="cyan" dimColor>{` ${language} `}</Text>
          </>
        )}
        <Text color="gray">{'─'.repeat(Math.max(0, 48 - (language?.length || 0)))}</Text>
      </Box>

      {/* Code lines with line numbers */}
      {lines.map((line, index) => (
        <Box key={index}>
          <Text color="gray">{'│'}</Text>
          <Text color="gray" dimColor>
            {' '}{String(index + 1).padStart(lineNumberWidth, ' ')} {'│'}
          </Text>
          <Text> {line}</Text>
        </Box>
      ))}

      {/* Footer */}
      <Box>
        <Text color="gray">{'└'}</Text>
        <Text color="gray">{'─'.repeat(50)}</Text>
      </Box>
    </Box>
  );
}

/**
 * Render inline code (single backticks)
 */
export function InlineCode({ children }: { children: string }): React.ReactElement {
  return (
    <Text color="yellow" bold>
      {children}
    </Text>
  );
}
