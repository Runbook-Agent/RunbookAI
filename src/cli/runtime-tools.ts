import type { Tool } from '../agent/types';
import type { Config } from '../utils/config';

const AWS_TOOLS = new Set([
  'aws_query',
  'aws_mutate',
  'aws_cli',
  'cloudwatch_alarms',
  'cloudwatch_logs',
]);

/**
 * Filter runtime tools based on configured provider enablement.
 */
export function getRuntimeTools(config: Config, tools: Tool[]): Tool[] {
  return tools.filter((tool) => {
    if (!config.providers.kubernetes.enabled && tool.name === 'kubernetes_query') {
      return false;
    }
    if (!config.providers.aws.enabled && AWS_TOOLS.has(tool.name)) {
      return false;
    }
    if (!config.incident.pagerduty.enabled && tool.name.startsWith('pagerduty_')) {
      return false;
    }
    if (!config.incident.opsgenie.enabled && tool.name.startsWith('opsgenie_')) {
      return false;
    }
    if (!config.incident.slack.enabled && tool.name.startsWith('slack_')) {
      return false;
    }
    return true;
  });
}
