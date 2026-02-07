/**
 * Lambda Tools
 */

import {
  LambdaClient,
  ListFunctionsCommand,
  GetFunctionCommand,
} from '@aws-sdk/client-lambda';

let client: LambdaClient | null = null;

function getClient(region?: string): LambdaClient {
  if (!client || region) {
    client = new LambdaClient({ region: region || process.env.AWS_REGION || 'us-east-1' });
  }
  return client;
}

export interface LambdaFunction {
  functionName: string;
  functionArn: string;
  runtime: string;
  handler: string;
  codeSize: number;
  memorySize: number;
  timeout: number;
  lastModified: string;
  state: string | undefined;
}

export async function listFunctions(region?: string): Promise<LambdaFunction[]> {
  const lambda = getClient(region);
  const functions: LambdaFunction[] = [];
  let marker: string | undefined;

  do {
    const command = new ListFunctionsCommand({ Marker: marker });
    const response = await lambda.send(command);

    for (const fn of response.Functions || []) {
      functions.push({
        functionName: fn.FunctionName || '',
        functionArn: fn.FunctionArn || '',
        runtime: fn.Runtime || '',
        handler: fn.Handler || '',
        codeSize: fn.CodeSize || 0,
        memorySize: fn.MemorySize || 128,
        timeout: fn.Timeout || 3,
        lastModified: fn.LastModified || '',
        state: fn.State,
      });
    }

    marker = response.NextMarker;
  } while (marker);

  return functions;
}

export async function getFunction(functionName: string, region?: string): Promise<LambdaFunction | null> {
  const lambda = getClient(region);

  try {
    const command = new GetFunctionCommand({ FunctionName: functionName });
    const response = await lambda.send(command);
    const config = response.Configuration;

    if (!config) return null;

    return {
      functionName: config.FunctionName || '',
      functionArn: config.FunctionArn || '',
      runtime: config.Runtime || '',
      handler: config.Handler || '',
      codeSize: config.CodeSize || 0,
      memorySize: config.MemorySize || 128,
      timeout: config.Timeout || 3,
      lastModified: config.LastModified || '',
      state: config.State,
    };
  } catch {
    return null;
  }
}
