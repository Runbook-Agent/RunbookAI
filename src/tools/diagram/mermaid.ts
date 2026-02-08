/**
 * Mermaid to ASCII Converter
 *
 * Converts mermaid diagram syntax to ASCII art for terminal display.
 * Supports:
 * - Flowcharts (graph TD/LR/BT/RL)
 * - Sequence diagrams
 * - State diagrams
 */

export interface MermaidNode {
  id: string;
  label: string;
  shape: 'rect' | 'rounded' | 'diamond' | 'circle' | 'stadium';
}

export interface MermaidEdge {
  from: string;
  to: string;
  label?: string;
  style: 'solid' | 'dotted' | 'thick';
  arrow: 'normal' | 'none' | 'x';
}

export interface FlowchartData {
  direction: 'TD' | 'LR' | 'BT' | 'RL';
  nodes: Map<string, MermaidNode>;
  edges: MermaidEdge[];
}

export interface SequenceMessage {
  from: string;
  to: string;
  message: string;
  type: 'solid' | 'dotted' | 'async';
}

export interface SequenceDiagramData {
  participants: string[];
  messages: SequenceMessage[];
}

export interface StateDiagramData {
  states: string[];
  transitions: Array<{ from: string; to: string; label?: string }>;
}

/**
 * Detect diagram type from mermaid code
 */
export function detectDiagramType(
  code: string
): 'flowchart' | 'sequence' | 'state' | 'unknown' {
  const firstLine = code.trim().split('\n')[0].toLowerCase();

  if (firstLine.startsWith('graph') || firstLine.startsWith('flowchart')) {
    return 'flowchart';
  }
  if (firstLine.startsWith('sequencediagram')) {
    return 'sequence';
  }
  if (firstLine.startsWith('statediagram')) {
    return 'state';
  }

  return 'unknown';
}

/**
 * Parse flowchart mermaid syntax
 */
export function parseFlowchart(code: string): FlowchartData {
  const lines = code.trim().split('\n');
  const nodes = new Map<string, MermaidNode>();
  const edges: MermaidEdge[] = [];

  // Parse direction from first line
  const firstLine = lines[0].toLowerCase();
  let direction: 'TD' | 'LR' | 'BT' | 'RL' = 'TD';
  if (firstLine.includes(' lr')) direction = 'LR';
  else if (firstLine.includes(' bt')) direction = 'BT';
  else if (firstLine.includes(' rl')) direction = 'RL';

  // Parse nodes and edges
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('%%')) continue;

    // Parse edge: A --> B or A -->|label| B
    const edgeMatch = line.match(
      /^(\w+)\s*(-{1,2}[>ox]?|={2,}[>ox]?|\.{2,}[>ox]?)\s*(?:\|([^|]+)\|)?\s*(\w+)$/
    );
    if (edgeMatch) {
      const [, from, connector, label, to] = edgeMatch;

      // Determine edge style
      let style: 'solid' | 'dotted' | 'thick' = 'solid';
      if (connector.includes('.')) style = 'dotted';
      else if (connector.includes('=')) style = 'thick';

      // Determine arrow type
      let arrow: 'normal' | 'none' | 'x' = 'normal';
      if (connector.includes('x')) arrow = 'x';
      else if (!connector.includes('>')) arrow = 'none';

      edges.push({ from, to, label, style, arrow });

      // Create default nodes if they don't exist
      if (!nodes.has(from)) {
        nodes.set(from, { id: from, label: from, shape: 'rect' });
      }
      if (!nodes.has(to)) {
        nodes.set(to, { id: to, label: to, shape: 'rect' });
      }
      continue;
    }

    // Parse node definition: A[Label] or A{Decision} or A((Circle)) or A([Stadium])
    const nodeMatch = line.match(/^(\w+)(\[([^\]]+)\]|\{([^}]+)\}|\(\(([^)]+)\)\)|\(\[([^\]]+)\]\))?$/);
    if (nodeMatch) {
      const [, id, , rectLabel, diamondLabel, circleLabel, stadiumLabel] = nodeMatch;
      let shape: MermaidNode['shape'] = 'rect';
      let label = id;

      if (rectLabel) {
        label = rectLabel;
        shape = 'rect';
      } else if (diamondLabel) {
        label = diamondLabel;
        shape = 'diamond';
      } else if (circleLabel) {
        label = circleLabel;
        shape = 'circle';
      } else if (stadiumLabel) {
        label = stadiumLabel;
        shape = 'stadium';
      }

      nodes.set(id, { id, label, shape });
    }
  }

  return { direction, nodes, edges };
}

/**
 * Parse sequence diagram mermaid syntax
 */
export function parseSequenceDiagram(code: string): SequenceDiagramData {
  const lines = code.trim().split('\n');
  const participants: string[] = [];
  const messages: SequenceMessage[] = [];
  const participantSet = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('%%')) continue;

    // Parse participant declaration
    const participantMatch = line.match(/^participant\s+(\w+)(?:\s+as\s+(.+))?$/i);
    if (participantMatch) {
      const [, id] = participantMatch;
      if (!participantSet.has(id)) {
        participants.push(id);
        participantSet.add(id);
      }
      continue;
    }

    // Parse message: A->>B: message or A-->>B: message
    const messageMatch = line.match(
      /^(\w+)\s*(-{1,2}>>?|\.{2,}>>?)\s*(\w+)\s*:\s*(.+)$/
    );
    if (messageMatch) {
      const [, from, connector, to, message] = messageMatch;

      // Add participants if not already added
      if (!participantSet.has(from)) {
        participants.push(from);
        participantSet.add(from);
      }
      if (!participantSet.has(to)) {
        participants.push(to);
        participantSet.add(to);
      }

      // Determine message type
      let type: 'solid' | 'dotted' | 'async' = 'solid';
      if (connector.includes('..')) type = 'dotted';
      else if (connector.includes('--')) type = 'async';

      messages.push({ from, to, message, type });
    }
  }

  return { participants, messages };
}

/**
 * Parse state diagram mermaid syntax
 */
export function parseStateDiagram(code: string): StateDiagramData {
  const lines = code.trim().split('\n');
  const states: string[] = [];
  const stateSet = new Set<string>();
  const transitions: Array<{ from: string; to: string; label?: string }> = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('%%')) continue;

    // Parse transition: State1 --> State2 or State1 --> State2 : label
    const transitionMatch = line.match(/^(\[?\*?\]?|\w+)\s*-->\s*(\[?\*?\]?|\w+)(?:\s*:\s*(.+))?$/);
    if (transitionMatch) {
      const [, from, to, label] = transitionMatch;

      // Handle special states
      const fromState = from === '[*]' ? '[*]' : from;
      const toState = to === '[*]' ? '[*]' : to;

      if (!stateSet.has(fromState) && fromState !== '[*]') {
        states.push(fromState);
        stateSet.add(fromState);
      }
      if (!stateSet.has(toState) && toState !== '[*]') {
        states.push(toState);
        stateSet.add(toState);
      }

      transitions.push({ from: fromState, to: toState, label });
    }
  }

  return { states, transitions };
}

/**
 * Render flowchart as ASCII
 */
export function renderFlowchartASCII(data: FlowchartData): string {
  const lines: string[] = [];
  const nodeList = Array.from(data.nodes.values());
  const maxLabelLen = Math.max(...nodeList.map((n) => n.label.length), 10);
  const boxWidth = maxLabelLen + 4;

  // Build adjacency list
  const adjacency = new Map<string, string[]>();
  for (const node of nodeList) {
    adjacency.set(node.id, []);
  }
  for (const edge of data.edges) {
    adjacency.get(edge.from)?.push(edge.to);
  }

  // Simple layout: find root nodes (no incoming edges)
  const hasIncoming = new Set<string>();
  for (const edge of data.edges) {
    hasIncoming.add(edge.to);
  }
  const rootNodes = nodeList.filter((n) => !hasIncoming.has(n.id));

  // BFS to assign levels
  const levels = new Map<string, number>();
  const queue: string[] = [];
  for (const root of rootNodes) {
    levels.set(root.id, 0);
    queue.push(root.id);
  }
  // Handle case where all nodes have incoming edges (cycle)
  if (queue.length === 0 && nodeList.length > 0) {
    levels.set(nodeList[0].id, 0);
    queue.push(nodeList[0].id);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLevel = levels.get(current) || 0;
    for (const next of adjacency.get(current) || []) {
      if (!levels.has(next)) {
        levels.set(next, currentLevel + 1);
        queue.push(next);
      }
    }
  }

  // Group nodes by level
  const levelGroups = new Map<number, MermaidNode[]>();
  for (const node of nodeList) {
    const level = levels.get(node.id) ?? 0;
    if (!levelGroups.has(level)) {
      levelGroups.set(level, []);
    }
    levelGroups.get(level)!.push(node);
  }

  // Render each level
  const sortedLevels = Array.from(levelGroups.keys()).sort((a, b) => a - b);
  const nodePositions = new Map<string, { x: number; y: number }>();

  let y = 0;
  for (const level of sortedLevels) {
    const nodesAtLevel = levelGroups.get(level)!;
    let x = 0;

    for (const node of nodesAtLevel) {
      nodePositions.set(node.id, { x, y });
      x += boxWidth + 4;
    }

    // Render nodes at this level
    const nodeBoxes = nodesAtLevel.map((node) => renderNodeBox(node, boxWidth));

    // Combine node boxes horizontally
    const maxHeight = Math.max(...nodeBoxes.map((b) => b.length));
    for (let row = 0; row < maxHeight; row++) {
      let rowStr = '';
      for (const box of nodeBoxes) {
        rowStr += (box[row] || ' '.repeat(boxWidth)) + '    ';
      }
      lines.push(rowStr);
    }

    // Add connector lines between levels
    if (level < sortedLevels[sortedLevels.length - 1]) {
      const nextLevel = sortedLevels[sortedLevels.indexOf(level) + 1];
      const nextNodes = levelGroups.get(nextLevel) || [];

      // Draw arrows
      const arrowLine = ' '.repeat(Math.floor(boxWidth / 2)) + '│' + ' '.repeat(boxWidth + 3);
      lines.push(arrowLine.repeat(nodesAtLevel.length).trimEnd());
      const downArrow = ' '.repeat(Math.floor(boxWidth / 2)) + '▼' + ' '.repeat(boxWidth + 3);
      lines.push(downArrow.repeat(Math.min(nodesAtLevel.length, nextNodes.length)).trimEnd());
    }

    y++;
  }

  // Add legend for edges with labels
  const labeledEdges = data.edges.filter((e) => e.label);
  if (labeledEdges.length > 0) {
    lines.push('');
    lines.push('Connections:');
    for (const edge of labeledEdges) {
      lines.push(`  ${edge.from} → ${edge.to}: ${edge.label}`);
    }
  }

  return lines.join('\n');
}

/**
 * Render a single node as ASCII box
 */
function renderNodeBox(node: MermaidNode, width: number): string[] {
  const label = node.label.padStart((width - 2 + node.label.length) / 2).padEnd(width - 2);

  switch (node.shape) {
    case 'diamond':
      return [
        ' '.repeat(Math.floor(width / 2)) + '◆',
        '◀' + ' ' + label + ' ' + '▶',
        ' '.repeat(Math.floor(width / 2)) + '◆',
      ];
    case 'circle':
      return [
        '┌' + '─'.repeat(width - 2) + '┐',
        '│' + label + '│',
        '└' + '─'.repeat(width - 2) + '┘',
      ];
    case 'stadium':
      return [
        '╭' + '─'.repeat(width - 2) + '╮',
        '│' + label + '│',
        '╰' + '─'.repeat(width - 2) + '╯',
      ];
    case 'rounded':
      return [
        '╭' + '─'.repeat(width - 2) + '╮',
        '│' + label + '│',
        '╰' + '─'.repeat(width - 2) + '╯',
      ];
    default: // rect
      return [
        '┌' + '─'.repeat(width - 2) + '┐',
        '│' + label + '│',
        '└' + '─'.repeat(width - 2) + '┘',
      ];
  }
}

/**
 * Render sequence diagram as ASCII
 */
export function renderSequenceDiagramASCII(data: SequenceDiagramData): string {
  const lines: string[] = [];
  const colWidth = 16;
  const participantPositions = new Map<string, number>();

  // Position participants
  data.participants.forEach((p, i) => {
    participantPositions.set(p, i * (colWidth + 4));
  });

  // Render participant headers
  let headerLine = '';
  let boxTopLine = '';
  let boxBottomLine = '';

  for (const participant of data.participants) {
    const pos = participantPositions.get(participant)!;
    const padding = ' '.repeat(pos - headerLine.length);
    const label = participant.slice(0, colWidth - 2).padStart((colWidth - 2 + participant.length) / 2).padEnd(colWidth - 2);

    boxTopLine += padding + '┌' + '─'.repeat(colWidth - 2) + '┐';
    headerLine += padding + '│' + label + '│';
    boxBottomLine += padding + '└' + '─'.repeat(colWidth - 2) + '┘';
  }

  lines.push(boxTopLine);
  lines.push(headerLine);
  lines.push(boxBottomLine);

  // Render vertical lines
  const lifelineOffset = Math.floor(colWidth / 2) - 1;
  const totalWidth = (data.participants.length - 1) * (colWidth + 4) + colWidth;

  // Render messages
  for (const message of data.messages) {
    const fromPos = participantPositions.get(message.from)! + lifelineOffset;
    const toPos = participantPositions.get(message.to)! + lifelineOffset;

    // Draw lifelines
    let lifelineLine = '';
    for (const participant of data.participants) {
      const pos = participantPositions.get(participant)! + lifelineOffset;
      lifelineLine = lifelineLine.padEnd(pos, ' ') + '│';
    }
    lines.push(lifelineLine.padEnd(totalWidth));

    // Draw message arrow
    const left = Math.min(fromPos, toPos);
    const right = Math.max(fromPos, toPos);
    const arrowLen = right - left;
    const goingRight = fromPos < toPos;

    let arrowLine = ' '.repeat(left);
    if (message.type === 'dotted') {
      arrowLine += goingRight
        ? '·'.repeat(arrowLen - 1) + '>'
        : '<' + '·'.repeat(arrowLen - 1);
    } else {
      arrowLine += goingRight
        ? '─'.repeat(arrowLen - 1) + '>'
        : '<' + '─'.repeat(arrowLen - 1);
    }

    lines.push(arrowLine.padEnd(totalWidth));

    // Draw message label
    const labelPos = left + Math.floor(arrowLen / 2) - Math.floor(message.message.length / 2);
    let labelLine = ' '.repeat(Math.max(0, labelPos)) + message.message;
    lines.push(labelLine.padEnd(totalWidth));
  }

  // Final lifelines
  let finalLine = '';
  for (const participant of data.participants) {
    const pos = participantPositions.get(participant)! + lifelineOffset;
    finalLine = finalLine.padEnd(pos, ' ') + '│';
  }
  lines.push(finalLine.padEnd(totalWidth));

  return lines.join('\n');
}

/**
 * Render state diagram as ASCII
 */
export function renderStateDiagramASCII(data: StateDiagramData): string {
  const lines: string[] = [];
  const maxStateLen = Math.max(...data.states.map((s) => s.length), 8);
  const boxWidth = maxStateLen + 4;

  // Render states horizontally
  const stateBoxes = data.states.map((state) => {
    const label = state.padStart((boxWidth - 2 + state.length) / 2).padEnd(boxWidth - 2);
    return [
      '╭' + '─'.repeat(boxWidth - 2) + '╮',
      '│' + label + '│',
      '╰' + '─'.repeat(boxWidth - 2) + '╯',
    ];
  });

  // Combine state boxes horizontally
  for (let row = 0; row < 3; row++) {
    let rowStr = '';
    for (const box of stateBoxes) {
      rowStr += box[row] + '  ';
    }
    lines.push(rowStr);
  }

  // Add transitions as legend
  if (data.transitions.length > 0) {
    lines.push('');
    lines.push('Transitions:');
    for (const t of data.transitions) {
      const label = t.label ? ` (${t.label})` : '';
      lines.push(`  ${t.from} → ${t.to}${label}`);
    }
  }

  return lines.join('\n');
}

/**
 * Convert mermaid code to ASCII art
 */
export function mermaidToASCII(code: string): string {
  const type = detectDiagramType(code);

  switch (type) {
    case 'flowchart': {
      const data = parseFlowchart(code);
      return renderFlowchartASCII(data);
    }
    case 'sequence': {
      const data = parseSequenceDiagram(code);
      return renderSequenceDiagramASCII(data);
    }
    case 'state': {
      const data = parseStateDiagram(code);
      return renderStateDiagramASCII(data);
    }
    default:
      return `[Unsupported diagram type]\n\n${code}`;
  }
}

/**
 * Check if content is mermaid code
 */
export function isMermaidCode(code: string): boolean {
  const firstLine = code.trim().split('\n')[0].toLowerCase();
  return (
    firstLine.startsWith('graph') ||
    firstLine.startsWith('flowchart') ||
    firstLine.startsWith('sequencediagram') ||
    firstLine.startsWith('statediagram')
  );
}
