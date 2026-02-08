/**
 * ASCII Chart Generation
 *
 * Generates ASCII line and bar charts for metrics visualization.
 * Uses asciichart for line charts and custom rendering for bar charts.
 */

import asciichart from 'asciichart';

export interface ChartOptions {
  width?: number;
  height?: number;
  title?: string;
  colors?: string[];
}

export interface TimeSeriesPoint {
  timestamp: Date | number;
  value: number;
  label?: string;
}

export interface BarChartData {
  label: string;
  value: number;
}

/**
 * Generate an ASCII line chart from time series data
 */
export function generateLineChart(
  data: number[] | TimeSeriesPoint[],
  options: ChartOptions = {}
): string {
  const {
    width = 60,
    height = 12,
    title,
  } = options;

  // Extract values from time series if needed
  const values = Array.isArray(data) && typeof data[0] === 'number'
    ? (data as number[])
    : (data as TimeSeriesPoint[]).map((p) => p.value);

  if (values.length === 0) {
    return '[No data points to display]';
  }

  // Generate chart using asciichart
  const chart = asciichart.plot(values, {
    height,
    width: Math.min(width, values.length),
    format: (x: number) => x.toFixed(2).padStart(8),
  });

  const lines: string[] = [];

  // Add title if provided
  if (title) {
    lines.push('');
    lines.push(`  ${title}`);
    lines.push('  ' + '─'.repeat(width));
  }

  lines.push(chart);

  // Add x-axis labels if time series data
  if (data.length > 0 && typeof data[0] !== 'number') {
    const timeData = data as TimeSeriesPoint[];
    const firstTime = formatTimestamp(timeData[0].timestamp);
    const lastTime = formatTimestamp(timeData[timeData.length - 1].timestamp);
    lines.push('  ' + firstTime.padEnd(width - lastTime.length) + lastTime);
  }

  return lines.join('\n');
}

/**
 * Generate an ASCII bar chart
 */
export function generateBarChart(
  data: BarChartData[],
  options: ChartOptions = {}
): string {
  const {
    width = 50,
    title,
  } = options;

  if (data.length === 0) {
    return '[No data points to display]';
  }

  const lines: string[] = [];

  // Add title if provided
  if (title) {
    lines.push('');
    lines.push(`  ${title}`);
    lines.push('  ' + '─'.repeat(width));
  }

  // Find max value for scaling
  const maxValue = Math.max(...data.map((d) => d.value));
  const maxLabelLen = Math.max(...data.map((d) => d.label.length), 8);
  const barMaxWidth = width - maxLabelLen - 15;

  // Render each bar
  for (const item of data) {
    const barWidth = Math.round((item.value / maxValue) * barMaxWidth);
    const bar = '█'.repeat(barWidth);
    const valueStr = formatNumber(item.value);
    const label = item.label.padEnd(maxLabelLen);

    lines.push(`  ${label} │${bar} ${valueStr}`);
  }

  // Add baseline
  lines.push('  ' + ' '.repeat(maxLabelLen) + ' └' + '─'.repeat(barMaxWidth + 10));

  return lines.join('\n');
}

/**
 * Generate a horizontal bar chart with percentage
 */
export function generatePercentageBar(
  data: BarChartData[],
  options: ChartOptions = {}
): string {
  const { width = 50, title } = options;

  if (data.length === 0) {
    return '[No data points to display]';
  }

  const lines: string[] = [];

  if (title) {
    lines.push('');
    lines.push(`  ${title}`);
    lines.push('  ' + '─'.repeat(width));
  }

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const maxLabelLen = Math.max(...data.map((d) => d.label.length), 8);
  const barMaxWidth = width - maxLabelLen - 12;

  for (const item of data) {
    const percentage = (item.value / total) * 100;
    const barWidth = Math.round((percentage / 100) * barMaxWidth);
    const bar = '█'.repeat(barWidth) + '░'.repeat(barMaxWidth - barWidth);
    const label = item.label.padEnd(maxLabelLen);

    lines.push(`  ${label} │${bar}│ ${percentage.toFixed(1)}%`);
  }

  return lines.join('\n');
}

/**
 * Generate a sparkline (mini inline chart)
 */
export function generateSparkline(data: number[], options: { showValues?: boolean; showRange?: boolean } = {}): string {
  if (!data || data.length === 0) return '[no data]';

  // Filter and convert to valid numbers
  const validData = data
    .map(v => typeof v === 'string' ? parseFloat(v) : Number(v))
    .filter(v => !isNaN(v) && isFinite(v));

  if (validData.length === 0) return '[no valid data points]';

  const min = Math.min(...validData);
  const max = Math.max(...validData);
  const range = max - min;

  // If all values are the same, show a flat line indicator with the value
  if (range === 0) {
    const flatChar = '─';
    const flatLine = flatChar.repeat(Math.min(validData.length, 20));
    return `${flatLine} (flat at ${min})`;
  }

  const chars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

  const sparkline = validData
    .map((value) => {
      const normalized = (value - min) / range;
      const index = Math.min(Math.floor(normalized * chars.length), chars.length - 1);
      return chars[index];
    })
    .join('');

  // Build result with optional range info
  let result = sparkline;
  if (options.showRange !== false) {
    result += ` (${min} → ${max})`;
  }

  return result;
}

/**
 * Generate a multi-series line chart
 */
export function generateMultiLineChart(
  series: { name: string; data: number[] }[],
  options: ChartOptions = {}
): string {
  const { height = 12, title } = options;

  if (series.length === 0 || series.every((s) => s.data.length === 0)) {
    return '[No data points to display]';
  }

  const lines: string[] = [];

  if (title) {
    lines.push('');
    lines.push(`  ${title}`);
    lines.push('  ' + '─'.repeat(60));
  }

  // Use asciichart's multi-series support
  const datasets = series.map((s) => s.data);
  const chart = asciichart.plot(datasets, {
    height,
    format: (x: number) => x.toFixed(2).padStart(8),
  });

  lines.push(chart);

  // Add legend
  lines.push('');
  const legend = series.map((s, i) => {
    const markers = ['─', '╌', '┄', '┈'];
    return `  ${markers[i % markers.length]} ${s.name}`;
  });
  lines.push(legend.join('  '));

  return lines.join('\n');
}

/**
 * Generate a histogram
 */
export function generateHistogram(
  data: number[],
  buckets: number = 10,
  options: ChartOptions = {}
): string {
  const { width = 50, title } = options;

  if (data.length === 0) {
    return '[No data points to display]';
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const bucketSize = range / buckets;

  // Count values in each bucket
  const counts = new Array(buckets).fill(0);
  for (const value of data) {
    const bucket = Math.min(Math.floor((value - min) / bucketSize), buckets - 1);
    counts[bucket]++;
  }

  // Convert to bar chart data
  const barData: BarChartData[] = counts.map((count, i) => ({
    label: `${(min + i * bucketSize).toFixed(1)}-${(min + (i + 1) * bucketSize).toFixed(1)}`,
    value: count,
  }));

  return generateBarChart(barData, { width, title: title || 'Distribution' });
}

/**
 * Format timestamp for display
 */
function formatTimestamp(ts: Date | number): string {
  const date = typeof ts === 'number' ? new Date(ts) : ts;
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format number for display
 */
function formatNumber(value: number): string {
  if (value >= 1000000) {
    return (value / 1000000).toFixed(1) + 'M';
  }
  if (value >= 1000) {
    return (value / 1000).toFixed(1) + 'K';
  }
  return value.toFixed(1);
}

/**
 * Generate a gauge chart (percentage indicator)
 */
export function generateGauge(
  value: number,
  max: number = 100,
  options: { title?: string; thresholds?: { warn: number; critical: number } } = {}
): string {
  const { title, thresholds = { warn: 70, critical: 90 } } = options;

  const percentage = (value / max) * 100;
  const width = 40;
  const filledWidth = Math.round((percentage / 100) * width);

  const lines: string[] = [];

  if (title) {
    lines.push(`  ${title}`);
  }

  // Determine color indicator based on thresholds
  let indicator = '●';
  if (percentage >= thresholds.critical) {
    indicator = '🔴';
  } else if (percentage >= thresholds.warn) {
    indicator = '🟡';
  } else {
    indicator = '🟢';
  }

  const bar = '█'.repeat(filledWidth) + '░'.repeat(width - filledWidth);
  lines.push(`  ${indicator} [${bar}] ${percentage.toFixed(1)}%`);
  lines.push(`     ${formatNumber(value)} / ${formatNumber(max)}`);

  return lines.join('\n');
}
