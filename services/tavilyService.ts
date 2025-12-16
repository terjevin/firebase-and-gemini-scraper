import { TavilySuccessfulResult, TavilyRequestConfig } from '../types';

const PROXY_URL = 'https://corsproxy.io/?';
const TAVILY_API_URL = 'https://api.tavily.com/extract';

interface TavilyFailedResult {
    url: string;
    error: string | object;
}

interface TavilyResponse {
    results: TavilySuccessfulResult[];
    failed_results: TavilyFailedResult[];
    response_time: number;
    request_id: string;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const extractWithTavily = async (config: TavilyRequestConfig): Promise<TavilyResponse> => {
    let lastError: Error = new Error("Tavily request failed after all retries.");
    let timeoutRetriesLeft = config.timeoutRetryCount;
    let rateLimitRetriesLeft = config.rateLimitRetryCount;

    while (true) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.timeoutSeconds * 1000);

        try {
            const response = await fetch(PROXY_URL + TAVILY_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    api_key: config.apiKey,
                    urls: config.urls,
                    extract_depth: config.extractDepth,
                    format: 'markdown',
                }),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (response.ok) {
                return await response.json();
            }

            const status = response.status;
            const errorText = await response.text().catch(() => `HTTP error! status: ${status}`);
            lastError = new Error(errorText);

            // Handle fatal errors immediately
            if ([400, 401, 403, 432, 433, 500].includes(status)) {
                throw lastError;
            }

            // Handle rate limiting (429)
            if (status === 429) {
                if (rateLimitRetriesLeft > 0) {
                    rateLimitRetriesLeft--;
                    console.warn(`Rate limit exceeded. Retrying in ${config.rateLimitRetryDelaySeconds}s... (${rateLimitRetriesLeft} retries left)`);
                    await sleep(config.rateLimitRetryDelaySeconds * 1000);
                    continue; // Retry the request
                } else {
                    throw new Error("Rate limit retries exhausted.");
                }
            }
            
            // For other non-fatal errors, use the general timeout retry logic
            throw new Error(`Unhandled HTTP error: ${status}`);


        } catch (error: any) {
            clearTimeout(timeoutId);
            lastError = error;
             if (error.name === 'AbortError') {
                lastError = new Error(`Request timed out after ${config.timeoutSeconds} seconds.`);
            }

            if (timeoutRetriesLeft > 0) {
                timeoutRetriesLeft--;
                console.warn(`Request failed (${lastError.message}). Retrying in ${config.timeoutRetryDelaySeconds}s... (${timeoutRetriesLeft} retries left)`);
                await sleep(config.timeoutRetryDelaySeconds * 1000);
            } else {
                 // If no retries left, break the loop and throw the last known error
                 break;
            }
        }
    }

    // If the loop is exited, it means all retries have been exhausted
    throw lastError;
};
