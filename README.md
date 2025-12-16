# Content Processor AI

## 1. Overview

**Content Processor AI** is an advanced, client-side tool designed for the robust batch processing of web and document content. It leverages a suite of powerful APIs (Google Gemini, Tavily, and Mistral Document AI) to fetch, perform OCR, clean, analyze, and transform unstructured data into high-quality, structured markdown.

Its primary purpose is to serve as a powerful pre-processing engine for generating clean, reliable data suitable for ingestion into Retrieval-Augmented Generation (RAG) applications, knowledge bases, or advanced content workflows. The entire application runs in the browser, with all configurations persistently saved in local storage.

## 2. Core Features

- **Dual Processing Pipelines:** Separate, highly configurable tabs for processing content from **Web URLs** and **Documents (Files/URLs)**.
- **Two-Stage AI Refining:** Both pipelines employ a two-stage process: first, content is extracted/OCR'd, and then it is optionally sent to Google Gemini for intelligent cleaning, structuring, and reformatting.
- **State-of-the-Art OCR:** Utilizes **Mistral Document AI** for exceptionally accurate text extraction from complex PDFs and images, preserving layout and tables.
- **Client-Side PDF Splitting:** Automatically chunks large PDF documents (over 30 pages) in the browser *before* making any API calls, enabling the processing of documents of virtually any size.
- **Advanced Concurrency Control:** Manages parallel API calls for each service to maximize throughput while respecting rate limits.
- **Global Pipeline Lock:** A sophisticated mechanism prevents the URL and Document processors from running their Gemini pipelines simultaneously, ensuring predictable performance.
- **Robust Safety & Kill Switches:** Actively monitors API usage and errors. If user-defined limits are exceeded, the app is automatically locked to prevent runaway costs.
- **Deep Configuration:** Fine-tune every aspect of the processing pipelines, from API keys and model parameters to concurrency, retries, and system instructions.
- **Real-time Monitoring & Debugging:** A detailed status panel tracks the progress of every job. An optional **Debug Mode** provides deep insight into the raw API requests and responses for each step.

---

## 3. Application Tabs

The application is organized into four distinct tabs, each serving a specific purpose.

### 3.1. URL Processor

This tab is designed for extracting and refining content from a list of web URLs.

#### The Pipeline

1.  **Stage 1: Tavily Content Extraction**
    -   **Input:** A batch of URLs.
    -   **Action:** Calls the **Tavily API (`/extract`)** to fetch the core content of each URL, intelligently stripping away boilerplate and converting it to clean markdown.
    -   **Output:** Raw markdown content for each URL.

2.  **Stage 2: Gemini Content Refining**
    -   **Input:** The raw markdown from Tavily.
    -   **Action:** The markdown is sent to the **Google Gemini API** along with a dedicated **System Instruction**. This step transforms the content according to user specifications (e.g., summarizing, reformatting into JSON, translating).
    -   **Output:** The final, AI-processed markdown.

#### How to Use
1.  Navigate to the **URL Processor** tab.
2.  Paste a list of URLs (one per line).
3.  Expand the configuration panels to set your API keys, concurrency settings, and Gemini model parameters.
4.  Write a clear **Gemini System Instruction** that defines the desired transformation.
5.  Click **"Process URLs"**.
6.  Monitor the real-time status of each job.
7.  Download the combined, processed markdown file.

### 3.2. Document Processor

This tab processes local files (PDFs, images) or documents hosted at remote URLs using a powerful OCR and optional AI cleaning pipeline.

#### The Pipeline

1.  **Stage 1: Preparation & OCR (Mistral AI)**
    -   **Input:** Local files (drag-and-drop) or a list of URLs pointing to documents.
    -   **In-Browser Preparation:** The tool reads the file/URL content into memory.
    -   **Automatic PDF Splitting:** If a document is a PDF with more than 30 pages, it is automatically split into multiple smaller PDF "chunks" of 30 pages each using `pdf-lib`. This critical step happens entirely on the client side.
    -   **Action:** Each chunk is sent to the **Mistral Document AI API**. This service performs high-accuracy OCR and returns the content as structured markdown.
    -   **Output:** Raw markdown content for each chunk.

2.  **Stage 2: Gemini Content Cleaning (Optional)**
    -   **Input:** The raw markdown from each chunk.
    -   **Action:** If enabled, each markdown chunk is sent to the **Google Gemini API** with a separate, dedicated **System Instruction** designed for cleaning and reformatting OCR output.
    -   **Output:** Cleaned, high-quality markdown for each chunk.

3.  **Final Aggregation**
    - The processed markdown from all chunks of a single original document is stitched back together in the correct order to create the final output.

#### How to Use
1.  Navigate to the **Document Processor** tab.
2.  Drag and drop files or paste document URLs.
3.  Expand the configuration panels to set your Mistral API credentials and Gemini cleaning options.
4.  Optionally, customize the Gemini system instruction for document cleaning.
5.  Click **"Process Documents"**.
6.  Monitor the status of each job and its chunks.
7.  Download the resulting markdown for each job individually or as a combined file.

### 3.3. Image Analyzer & Chat Bot

These tabs provide utility functions for interacting with the Gemini API.
-   **Image Analyzer:** Upload an image and provide a prompt to get a detailed analysis from Gemini's multi-modal capabilities.
-   **Chat Bot:** Engage in a direct, streaming conversation with a Gemini model.

---

## 4. Core Mechanisms Explained

### 4.1. Concurrency Engine
The application uses a robust `processInParallel` utility to manage API calls. It creates a queue of jobs and processes them concurrently up to a user-defined limit (`maxParallel` for each service). This maximizes speed while respecting API rate limits and avoiding browser request overload.

### 4.2. Global Gemini Pipeline Lock
To prevent resource contention and unpredictable behavior, a global lock (`geminiPipelineOwner`) is implemented in the central `useSettings` hook. When either the URL or Document processor begins its Gemini pipeline (Stage 2), it "claims" ownership. The other processor is disabled until the first one completes and releases the lock. This ensures that only one intensive LLM pipeline runs at a time.

### 4.3. Security: The Kill Switch
The application includes a critical safety feature to prevent accidental high costs from runaway API calls.
-   **Counters:** The central `useSettings` hook maintains persistent counters for the total number of calls and errors for each API (Tavily, Gemini, Mistral).
-   **Limits:** In `settings.json`, you define `maxAllowed...Api` and `max...Error` limits.
-   **Trigger:** Before any API call is dispatched, the hook checks the current count against the limit. If a limit is exceeded, the `triggerKillSwitch` function is called.
-   **Action:** The kill switch immediately sets the `appAllow...` state for all services to `false`, blocking all future API calls. It also writes this locked state (`geminiAllow: false`, etc.) to `localStorage`, ensuring the app remains safely disabled even after a page reload.

---

## 5. Configuration Deep Dive (`settings.json`)

All operational parameters are controlled via `settings.json` and are editable in the UI.

### 5.1. API Keys & Endpoints
-   `tavilyApiKey`: **(Required)** Your API key for the Tavily service.
-   `geminiApiKey`: (Optional) Your Google Gemini API key. If left blank, it will try to use an environment key.
-   `mistralApiKey`: **(Required)** Your API key for the Azure-hosted Mistral Document AI service.
-   `mistralEndpoint`: **(Required)** The full endpoint URL for your Mistral service.

### 5.2. Global Safety & Kill Switch
-   `geminiAllow`, `tavilyAllow`, `mistralAllow`: Master toggles for each service. The kill switch will forcibly set these to `false`.
-   `maxAllowedGeminiApi`, `maxAllowedTavilyApi`, `maxAllowedMistralApi`: The maximum number of total calls for each service before the kill switch is triggered.
-   `maxGeminiError`, `maxTavilyError`, `maxMistralError`: The maximum number of errors for each service before the kill switch is triggered.

### 5.3. General & Output
-   `debugMode`: (boolean) If `true`, you can click jobs to open a modal with detailed API request/response data.
-   `outputFilename`: (URL Processor) The default filename for the downloaded markdown file.
-   `outputSeparator`: (URL Processor) The string used to separate the content from each URL in the final output file (e.g., `\\n\\n---\\n\\n`).

### 5.4. Tavily Config (`tavily`)
-   `batchSize`: Number of URLs to send to Tavily in a single API request.
-   `maxParallel`: Number of concurrent Tavily API calls.
-   `timeoutRetryCount`, `rateLimitRetryCount`: Number of times to retry a request on a timeout or rate limit error.

### 5.5. Mistral OCR Config (`mistral`)
-   `maxParallel`: Number of concurrent OCR API calls to Mistral.
-   `apiRetries`: Number of times to retry a failed request.

### 5.6. Gemini Config (`gemini`)
-   **URL Processor Specific:**
    -   `systemInstruction`: The detailed prompt telling Gemini how to process the markdown from web pages.
-   **Document Processor Specific:**
    -   `geminiDocSystemInstruction`: The system prompt for cleaning and structuring OCR'd markdown.
    -   `geminiDocAllowCleaning`: (boolean) Master toggle to enable/disable the entire Stage 2 Gemini pipeline for documents.
    -   `geminiDocIgnoreChunkError`: (boolean) If `true`, the pipeline will continue even if a single chunk fails; if `false`, the entire job will fail.
-   **Common Parameters:**
    -   `model`: The Gemini model to use (e.g., `gemini-2.5-flash-lite`).
    -   `temperature`: Controls creativity (0.0 to 1.0).
    -   `thinkingBudget`: A Gemini 2.5 feature for controlling internal reasoning tokens (-1 for auto).
    -   `maxOutputTokens`: Sets a limit on the length of the response.
    -   `maxParallel`: Number of concurrent Gemini API calls.
    -   `timeout`: A client-side timeout in seconds for each API call.
    -   `retries`: Number of times to retry a failed or timed-out request.

---

## 6. Technical Stack

-   **Framework:** React 19 with TypeScript
-   **Styling:** Tailwind CSS
-   **AI/API SDKs:**
    -   `@google/genai`: For all Google Gemini interactions.
    -   Custom `fetch` clients for Tavily and Mistral APIs.
-   **Core Libraries:**
    -   `pdf-lib`: For powerful, in-browser PDF manipulation and splitting.
-   **Infrastructure:**
    -   Pure client-side application (no backend).
    -   Uses `corsproxy.io` to bypass CORS limitations for API calls.
