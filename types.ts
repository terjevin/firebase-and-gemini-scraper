
export interface GeminiRequestConfig {
    model: string;
    temperature: number;
    systemInstruction: string;
    thinkingBudget?: number;
    maxOutputTokens?: number;
    localTimeoutSeconds: number;
    apiRetries: number;
}

// A strict, one-way state machine for jobs.
export const JOB_STATUS = {
  READY_FOR_EXTRACTION: 1,
  EXTRACTING: 2,
  READY_FOR_LLM: 3,
  PROCESSING_LLM: 4,
  COMPLETED: 5,
  ERROR: -1,
} as const;

// Corresponds to the successful result structure from Tavily
export interface TavilySuccessfulResult {
    url: string;
    raw_content: string;
    images?: string[];
    favicon?: string;
    title?: string;
}

export interface TavilyRequestConfig {
    apiKey: string;
    urls: string[];
    extractDepth: string;
    // New fields for robust fetching
    timeoutSeconds: number;
    timeoutRetryCount: number;
    timeoutRetryDelaySeconds: number;
    rateLimitRetryCount: number;
    rateLimitRetryDelaySeconds: number;
}

export interface Job {
  id: string;
  url: string;
  status: number; // Use numerical status from JOB_STATUS
  retryCount: number;
  rawMarkdown?: string;
  processedMarkdown?: string;
  error?: string;
  metrics?: {
    finishReason?: string | null;
    usage?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
        totalTokenCount?: number;
    }
  };
  // Optional fields for debug mode
  tavilyResult?: TavilySuccessfulResult;
  tavilyResponseTime?: number;
  geminiResponse?: any;
  geminiRequestConfig?: GeminiRequestConfig;
  geminiResponseTime?: number;
  rawMarkdownStats?: {
    lines: number;
    size: number; // in bytes
  };
  processedMarkdownStats?: {
    lines: number;
    size: number; // in bytes
  };
}
