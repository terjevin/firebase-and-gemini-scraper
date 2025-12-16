
import { GoogleGenAI, GenerateContentResponse, Chat } from "@google/genai";

interface ProcessMarkdownConfig {
  model: string;
  temperature: number;
  systemInstruction: string;
  thinkingBudget?: number;
  maxOutputTokens?: number;
  // New async/retry fields
  localTimeoutSeconds: number;
  apiRetries: number;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));


export const processMarkdownWithGemini = async (
  markdown: string,
  config: ProcessMarkdownConfig,
  apiKey: string,
): Promise<GenerateContentResponse> => {
  if (!apiKey) {
    throw new Error("Gemini API key was not provided.");
  }
  const ai = new GoogleGenAI({ apiKey });
  let lastError: Error = new Error("Gemini request failed after all retries.");
  
  // The loop will run once, plus the number of retries.
  for (let attempt = 0; attempt <= config.apiRetries; attempt++) {
    try {
        const genAIConfig: any = {
          systemInstruction: config.systemInstruction,
          temperature: config.temperature,
        };

        if(config.maxOutputTokens && config.maxOutputTokens > 0) {
          genAIConfig.maxOutputTokens = config.maxOutputTokens;
        }
        
        // We must ALLTID sende thinkingConfig hvis det er et tall,
        // fordi gemini-2.5-flash-lite krever det for å aktivere thinking.
        if (typeof config.thinkingBudget === 'number' && !isNaN(config.thinkingBudget)) {
          // Dette vil korrekt sende -1 for auto, 0 for av, og > 0 for spesifikk verdi.
          genAIConfig.thinkingConfig = { thinkingBudget: config.thinkingBudget };
        }

        const apiCall = ai.models.generateContent({
            model: config.model,
            contents: markdown,
            config: genAIConfig,
        });

        // Implement a client-side timeout
        const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Local timeout of ${config.localTimeoutSeconds}s exceeded.`)), config.localTimeoutSeconds * 1000)
        );

        // Race the API call against the timeout
        const response = await Promise.race([apiCall, timeoutPromise]);
        
        return response; // Success, exit the loop

    } catch (error: any) {
        lastError = error;
        // Check if it's a rate limit error or timeout, which are retryable
        const isRetryable = error.message.includes('429') || error.message.includes('timeout');
        
        if (isRetryable && attempt < config.apiRetries) {
            console.warn(`Gemini attempt ${attempt + 1} failed with retryable error: ${error.message}. Retrying...`);
            await sleep(2000 * (attempt + 1)); // Exponential backoff
        } else {
             // Non-retryable error or retries exhausted
            throw error;
        }
    }
  }

  // This should not be reached if logic is correct, but as a fallback:
  throw lastError;
};

export const analyzeImage = async (
  imageBase64: string,
  mimeType: string,
  prompt: string,
  apiKey: string,
): Promise<GenerateContentResponse> => {
  if (!apiKey) {
    throw new Error("Gemini API key was not provided.");
  }
  const ai = new GoogleGenAI({ apiKey });

  const imagePart = {
    inlineData: {
      data: imageBase64,
      mimeType: mimeType,
    },
  };
  const textPart = { text: prompt };

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: { parts: [imagePart, textPart] },
  });
  return response;
};

export const createChat = (apiKey: string): Chat => {
  if (!apiKey) {
    throw new Error("Gemini API key was not provided.");
  }
  const ai = new GoogleGenAI({ apiKey });

  return ai.chats.create({
    model: 'gemini-2.5-flash',
  });
};
