import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Job, JOB_STATUS, GeminiRequestConfig, TavilyRequestConfig } from '../types';
import { useSettings } from '../hooks/useSettings';
import { PlayIcon, StopIcon, DownloadIcon, ChevronDownIcon, ChevronUpIcon } from './Icons';
import { DebugModal } from './DebugModal';
import { processInParallel } from '../utils/parallel';

// --- Helper Functions ---
const chunkArray = <T,>(array: T[], size: number): T[][] => {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
};

const truncateUrl = (url: string, maxLength: number = 35) => {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength - 3) + '...';
};

const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};


// --- UI Components ---

const ConfigInput: React.FC<{label: string; id: string; type: string; value: any; onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void; step?: string; min?: string | number; max?: string | number; placeholder?: string; name?: string; disabled?: boolean;}> = ({ label, id, disabled, ...props }) => (
    <div>
        <label htmlFor={id} className="block text-sm font-medium text-slate-300 mb-1">{label}</label>
        <input id={id} {...props} disabled={disabled} className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition disabled:bg-slate-800/50 disabled:cursor-not-allowed"/>
    </div>
);

const ConfigToggle: React.FC<{label: string; id: string; checked: boolean; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; disabled?: boolean;}> = ({ label, id, checked, onChange, disabled }) => (
     <div>
        <label htmlFor={id} className="block text-sm font-medium text-slate-300 mb-1 invisible">{label}</label> 
        <div className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 transition h-[42px] flex items-center justify-between">
            <span className="text-sm font-medium text-slate-300">{label}</span>
            <label htmlFor={id} className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" id={id} className="sr-only peer" checked={checked} onChange={onChange} disabled={disabled} />
                <div className="w-11 h-6 bg-slate-600 rounded-full peer peer-focus:ring-2 peer-focus:ring-sky-500 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-600"></div>
            </label>
        </div>
    </div>
);

const StatCounter: React.FC<{label: string; value: string | number; valueColor?: string}> = ({label, value, valueColor = 'text-white'}) => (
    <div className="text-xs">
        <span className="text-slate-400">{label}:</span> <span className={`font-bold font-mono ${valueColor}`}>{value}</span>
    </div>
);


const UrlProcessor: React.FC = () => {
    const { settings, setSettings, status, error: settingsError, appAllowGemini, appAllowTavily, callTavilyAPI, callGeminiAPI, resetUsageCounters } = useSettings();
    
    const [isRunning, setIsRunning] = useState(false);
    const [finalMarkdown, setFinalMarkdown] = useState('');
    const [jobs, setJobs] = useState<Job[]>([]);
    const [selectedJob, setSelectedJob] = useState<Job | null>(null);

    const [extractionPipelineActive, setExtractionPipelineActive] = useState(false);
    const [geminiPipelineActive, setGeminiPipelineActive] = useState(false);

    // --- Real-time Counters ---
    const [apiCounts, setApiCounts] = useState({ tavily: 0, gemini: 0 });
    const [tokenCounts, setTokenCounts] = useState({ input: 0, output: 0, thinking: 0, total: 0 });
    const [outputStats, setOutputStats] = useState({ lines: 0, size: 0 }); // Resets per run
    
    const stopProcessingRef = useRef(false);

    const [showConfig, setShowConfig] = useState(false);
    const [showSystemInstruction, setShowSystemInstruction] = useState(false);
    const [isOutputExpanded, setIsOutputExpanded] = useState(false);

    // --- Minimization States ---
    const [isUrlsExpanded, setIsUrlsExpanded] = useState(true);
    const [isStatusGridExpanded, setIsStatusGridExpanded] = useState(false);
    const [isJobListExpanded, setIsJobListExpanded] = useState(false);
    
    const isProcessingDisabled = !settings || isRunning || !appAllowTavily || !appAllowGemini || !!settingsError;

    const handleNestedChange = (section: 'tavily' | 'gemini', key: string, value: any) => {
        if (!settings) return;
        setSettings({ ...settings, [section]: { ...settings[section], [key]: value } });
    };
    
    const handleIntegerChange = (updateFn: (val: number) => void, minVal: number = 0) => (e: React.ChangeEvent<HTMLInputElement>) => {
        const valueStr = e.target.value;
        if (e.target.name === 'thinkingBudget' && valueStr === '-1') { updateFn(-1); return; }
        const value = parseInt(valueStr, 10);
        updateFn(isNaN(value) ? minVal : Math.max(minVal, value));
    };

    const handleFloatChange = (updateFn: (val: number) => void, min: number, max: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
        const valueStr = e.target.value.replace(',', '.');
        let value = parseFloat(valueStr);
        if (isNaN(value)) { value = min; }
        updateFn(Math.max(min, Math.min(max, value)));
    };

    // --- Extraction Pipeline Effect ---
    useEffect(() => {
        if (!extractionPipelineActive || !settings) return;

        const processTavilyChunk = async (chunk: string[]) => {
            if (stopProcessingRef.current) return;
            setJobs(prev => prev.map(j => chunk.includes(j.url) ? { ...j, status: JOB_STATUS.EXTRACTING } : j));
            try {
                const tavilyConfig: TavilyRequestConfig = {
                    apiKey: settings.tavilyApiKey, urls: chunk, extractDepth: settings.extractDepth,
                    timeoutSeconds: 60, timeoutRetryCount: settings.tavily.timeoutRetryCount,
                    timeoutRetryDelaySeconds: settings.tavily.timeoutRetryDelay, rateLimitRetryCount: settings.tavily.rateLimitRetryCount,
                    rateLimitRetryDelaySeconds: settings.tavily.rateLimitRetryDelay,
                };
                setApiCounts(prev => ({ ...prev, tavily: prev.tavily + 1 }));
                const tavilyResult = await callTavilyAPI(tavilyConfig);

                if (stopProcessingRef.current) return;
                
                setJobs(prev => prev.map(job => {
                    if (!chunk.includes(job.url)) return job;
                    const success = tavilyResult.results.find(r => r.url === job.url);
                    if (success) return { ...job, status: JOB_STATUS.READY_FOR_LLM, rawMarkdown: success.raw_content,
                        ...(settings.debugMode && { tavilyResult: success, tavilyResponseTime: tavilyResult.response_time })
                    };
                    const failed = tavilyResult.failed_results.find(f => f.url === job.url);
                    return { ...job, status: JOB_STATUS.ERROR, error: failed ? JSON.stringify(failed.error) : "Extraction failed" };
                }));
            } catch (err: any) {
                if (stopProcessingRef.current) return;
                setJobs(prev => prev.map(j => chunk.includes(j.url) ? { ...j, status: JOB_STATUS.ERROR, error: err.message } : j));
            }
        };

        const runExtraction = async () => {
            const extractionWorkRemaining = jobs.some(j =>
                j.status === JOB_STATUS.READY_FOR_EXTRACTION ||
                j.status === JOB_STATUS.EXTRACTING
            );

            if (!extractionWorkRemaining) {
                setExtractionPipelineActive(false);
                return;
            }

            const jobsToStart = jobs.filter(j => j.status === JOB_STATUS.READY_FOR_EXTRACTION);
            if (jobsToStart.length > 0) {
                const urlChunks = chunkArray(jobsToStart.map(j => j.url), settings.tavily.batchSize);
                await processInParallel(urlChunks, processTavilyChunk, settings.tavily.maxParallel, stopProcessingRef);
            }
        };
        runExtraction();

    }, [extractionPipelineActive, jobs, settings, callTavilyAPI]);


    // --- Gemini Pipeline Effect ---
    useEffect(() => {
        if (!geminiPipelineActive || !settings) return;

        // Check if we already have jobs in the 'PROCESSING_LLM' stage.
        const isAlreadyProcessing = jobs.some(j => j.status === JOB_STATUS.PROCESSING_LLM);
        if (isAlreadyProcessing) {
            return; // Do nothing, wait for the ongoing process to finish.
        }

        const processGeminiJob = async (job: Job) => {
            if (stopProcessingRef.current) return;
            let currentJob: Job = { ...job, status: JOB_STATUS.PROCESSING_LLM };
            setJobs(prev => prev.map(j => j.id === currentJob.id ? currentJob : j));
            
            try {
                const geminiConfigForApi: GeminiRequestConfig = {
                    model: settings.gemini.model, temperature: settings.gemini.temperature, localTimeoutSeconds: settings.gemini.timeout,
                    apiRetries: settings.gemini.retries, systemInstruction: settings.gemini.systemInstruction || " ",
                    thinkingBudget: settings.gemini.thinkingBudget, maxOutputTokens: settings.gemini.maxOutputTokens,
                };

                setApiCounts(prev => ({ ...prev, gemini: prev.gemini + 1 }));
                const startTime = performance.now();
                const response = await callGeminiAPI(job.rawMarkdown!, geminiConfigForApi);
                const endTime = performance.now();
                const geminiResponseTime = (endTime - startTime) / 1000;

                const rawMarkdownStats = {
                    lines: job.rawMarkdown?.split('\n').length || 0,
                    size: new Blob([job.rawMarkdown || '']).size,
                };
                
                const finishReason = response.candidates?.[0]?.finishReason;
                const successfulFinishReasons = ['STOP', 'FINISH_REASON_UNSPECIFIED', undefined, null];
                let jobUpdate: Partial<Job> = {};
                let processedMarkdownStats;

                if (successfulFinishReasons.includes(finishReason)) {
                    const processedMarkdown = response.text;
                    processedMarkdownStats = {
                        lines: processedMarkdown?.split('\n').length || 0,
                        size: new Blob([processedMarkdown || '']).size,
                    };
                    jobUpdate = { status: JOB_STATUS.COMPLETED, processedMarkdown };

                    // Update cumulative counters
                    setTokenCounts(prev => ({
                        input: prev.input + (response.usageMetadata?.promptTokenCount || 0),
                        output: prev.output + (response.usageMetadata?.candidatesTokenCount || 0),
                        thinking: prev.thinking + (response.usageMetadata?.thoughtsTokenCount || 0),
                        total: prev.total + (response.usageMetadata?.totalTokenCount || 0),
                    }));
                    setOutputStats(prev => ({
                        lines: prev.lines + (processedMarkdownStats?.lines || 0),
                        size: prev.size + (processedMarkdownStats?.size || 0),
                    }));

                } else {
                     jobUpdate = { status: JOB_STATUS.ERROR, error: `Stop Reason: ${finishReason}` };
                }
                
                currentJob = { ...currentJob, ...jobUpdate, geminiResponseTime, rawMarkdownStats, processedMarkdownStats,
                    metrics: { finishReason, usage: response.usageMetadata },
                    ...(settings.debugMode && { geminiResponse: response, geminiRequestConfig: geminiConfigForApi })
                };

            } catch (geminiError: any) {
                currentJob = { ...currentJob, status: JOB_STATUS.ERROR, error: geminiError.message };
            }

            if (stopProcessingRef.current) return;
            setJobs(prev => prev.map(j => j.id === currentJob.id ? currentJob : j));
        };
        
        const runGeminiProcessing = async () => {
            const geminiWorkRemaining = jobs.some(j =>
                j.status === JOB_STATUS.READY_FOR_LLM ||
                j.status === JOB_STATUS.PROCESSING_LLM
            );

            if (!geminiWorkRemaining) {
                setGeminiPipelineActive(false);
                return;
            }

            const jobsToStart = jobs.filter(job => job.status === JOB_STATUS.READY_FOR_LLM);
            if (jobsToStart.length > 0) {
                await processInParallel(jobsToStart, processGeminiJob, settings.gemini.maxParallel, stopProcessingRef);
            }
        };
        runGeminiProcessing();
        
    }, [geminiPipelineActive, jobs, settings, callGeminiAPI]);

     // --- Pipeline Orchestration ---
    useEffect(() => {
        const hasJobsReadyForGemini = jobs.some(j => j.status === JOB_STATUS.READY_FOR_LLM);
        if (hasJobsReadyForGemini && !geminiPipelineActive) {
            setGeminiPipelineActive(true);
        }

        const isProcessingFinished = jobs.length > 0 && jobs.every(j => j.status === JOB_STATUS.COMPLETED || j.status === JOB_STATUS.ERROR);
        if (isRunning && isProcessingFinished && !extractionPipelineActive && !geminiPipelineActive) {
            const completedJobs = jobs.filter(j => j.status === JOB_STATUS.COMPLETED && j.processedMarkdown);
            const separator = settings?.outputSeparator.replace(/\\n/g, '\n') || '\n\n---\n\n';
            const finalOutput = completedJobs.map(j => j.processedMarkdown).join(separator);
            setFinalMarkdown(finalOutput);
            setIsRunning(false);
        }
    }, [jobs, geminiPipelineActive, extractionPipelineActive, isRunning, settings]);


    const handleStop = useCallback(() => {
        stopProcessingRef.current = true;
        setIsRunning(false);
        setExtractionPipelineActive(false);
        setGeminiPipelineActive(false);

        setJobs(prevJobs => {
            const updatedJobs = prevJobs.map(job => {
                // Mark any job that isn't finished as aborted
                if (job.status !== JOB_STATUS.COMPLETED) {
                    return { ...job, status: JOB_STATUS.ERROR, error: 'Run aborted by user.' };
                }
                return job;
            });

            // Generate partial markdown from jobs that did complete before the stop
            const completedJobs = updatedJobs.filter(j => j.status === JOB_STATUS.COMPLETED && j.processedMarkdown);
            if (completedJobs.length > 0) {
                 const separator = settings?.outputSeparator.replace(/\\n/g, '\n') || '\n\n---\n\n';
                 const finalOutput = completedJobs.map(j => j.processedMarkdown).join(separator);
                 setFinalMarkdown(finalOutput);
            }
            
            return updatedJobs;
        });
    }, [settings]);

    const handleProcess = () => {
        if (!settings) return;
        setIsRunning(true);
        stopProcessingRef.current = false;
        setFinalMarkdown('');
        setOutputStats({ lines: 0, size: 0 }); // Reset for new run
        
        // Expand status lists when starting
        setIsStatusGridExpanded(true);
        setIsJobListExpanded(true);
        
        const urlList = settings.urls.map(u => u.trim()).filter(Boolean);
        const initialJobs: Job[] = urlList.map((url, index) => ({
            id: self.crypto.randomUUID(), url, status: JOB_STATUS.READY_FOR_EXTRACTION, retryCount: 0,
        }));
        setJobs(initialJobs);
        setExtractionPipelineActive(true);
        setGeminiPipelineActive(false);
    };
    
    if (!settings) return null;

    const handleDownload = () => {
        const blob = new Blob([finalMarkdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = settings.outputFilename || 'processed_content.md';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };
    
    const handleResetCounters = () => {
        // Reset global settings via hook
        resetUsageCounters();
        // Also reset local display counters to ensure UI reflects a fresh state
        setApiCounts({ tavily: 0, gemini: 0 });
        setTokenCounts({ input: 0, output: 0, thinking: 0, total: 0 });
    };

    const getStatusInfo = (job: Job): { color: string, text: string } => {
        switch (job.status) {
            case JOB_STATUS.COMPLETED: return { color: 'text-green-400', text: 'Completed' };
            case JOB_STATUS.PROCESSING_LLM: return { color: 'text-purple-400', text: 'Processing LLM...' };
            case JOB_STATUS.EXTRACTING: return { color: 'text-blue-400', text: 'Extracting...' };
            case JOB_STATUS.READY_FOR_LLM: return { color: 'text-lime-400', text: 'Ready for LLM' };
            case JOB_STATUS.ERROR: return { color: 'text-red-400', text: `Error: ${job.error?.slice(0, 30)}...` };
            case JOB_STATUS.READY_FOR_EXTRACTION: return { color: 'text-slate-400', text: 'Queued' };
            default: return { color: 'text-slate-500', text: 'Unknown' };
        }
    };
    
    const PipelineStatusIndicator: React.FC<{label: string; isAllowed: boolean; isActive: boolean}> = ({label, isAllowed, isActive}) => {
      const statusText = !isAllowed ? "ERROR" : (isActive ? "Running" : "Idle");
      const color = !isAllowed ? "text-red-500" : (isActive ? "text-green-400" : "text-amber-400");
      return (
        <div className="text-xs"><span className="text-slate-400">{label}:</span> <span className={`font-bold font-mono ${color}`}>{statusText}</span></div>
      )
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
            <DebugModal job={selectedJob} onClose={() => setSelectedJob(null)} />
            
            {/* LEFT COLUMN */}
            <div className="flex flex-col gap-4 bg-slate-900 p-6 rounded-lg shadow-xl">
                
                {/* URLs Input Section */}
                <div className={`flex flex-col ${isUrlsExpanded ? 'flex-grow' : ''}`}>
                    <button onClick={() => setIsUrlsExpanded(!isUrlsExpanded)} className="flex justify-between items-center w-full text-left font-semibold text-slate-200 mb-2">
                        <span>URLs (one per line)</span>
                        {isUrlsExpanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
                    </button>
                    {isUrlsExpanded && (
                        <textarea id="urls" value={settings.urls.join('\n')}
                            onChange={(e) => setSettings({ ...settings, urls: e.target.value.split('\n')})}
                            className="w-full flex-grow bg-slate-950 border border-slate-700 rounded-md p-3 text-slate-300 font-mono text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition resize-y min-h-[150px]"
                            placeholder="https://example.com/..." rows={10} disabled={isRunning} />
                    )}
                </div>

                {settingsError && <div className="bg-red-900/50 border border-red-700 text-red-300 p-3 rounded-md text-sm">{settingsError}</div>}
                
                {/* Config Section */}
                <div className="bg-slate-800/50 rounded-lg p-4">
                    <button onClick={() => setShowConfig(!showConfig)} className="flex justify-between items-center w-full text-left font-semibold text-slate-200">
                        <span>API, Concurrency & Model Configuration</span>
                        {showConfig ? <ChevronUpIcon /> : <ChevronDownIcon />}
                    </button>
                    {showConfig && (
                        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 animate-fade-in">
                            <ConfigInput label="Tavily API Key" id="tavilyKey" type="password" value={settings.tavilyApiKey} onChange={e => setSettings({...settings, tavilyApiKey: e.target.value})} placeholder="tvly-..." disabled={isRunning} />
                            <ConfigInput label="Gemini API Key (optional)" id="geminiKey" type="password" value={settings.geminiApiKey} onChange={e => setSettings({...settings, geminiApiKey: e.target.value})} placeholder="Overrides environment key" disabled={isRunning} />
                            <ConfigToggle label="Debug Mode" id="debugMode" checked={settings.debugMode} onChange={e => setSettings({...settings, debugMode: e.target.checked})} disabled={isRunning} />
                            <ConfigInput label="Tavily Extraction Depth" id="extractDepth" type="text" value={settings.extractDepth} onChange={e => setSettings({...settings, extractDepth: e.target.value})} disabled={isRunning} />
                            <ConfigInput label="Output Filename" id="outputFilename" type="text" value={settings.outputFilename} onChange={e => setSettings({...settings, outputFilename: e.target.value})} disabled={isRunning} />
                            <ConfigInput label="Output Separator" id="outputSeparator" type="text" value={settings.outputSeparator} onChange={e => setSettings({...settings, outputSeparator: e.target.value})} placeholder="e.g. \n---\n" disabled={isRunning}/>
                            <div className="sm:col-span-2 mt-2 pt-3 border-t border-slate-700">
                                <p className="text-sm font-semibold text-slate-400 mb-2">API Safety & Kill Switch Limits</p>
                                 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <ConfigInput label="Max Tavily Calls" id="maxTavilyCalls" type="number" value={settings.maxAllowedTavilyApi} onChange={handleIntegerChange(val => setSettings(s => s ? {...s, maxAllowedTavilyApi: val } : s), 1)} min="1" max="500" disabled={isRunning} />
                                    <ConfigInput label="Max Tavily Errors" id="maxTavilyErrors" type="number" value={settings.maxTavilyError} onChange={handleIntegerChange(val => setSettings(s => s ? {...s, maxTavilyError: val } : s), 1)} min="1" max="150" disabled={isRunning} />
                                    <ConfigInput label="Max Gemini Calls" id="maxGeminiCalls" type="number" value={settings.maxAllowedGeminiApi} onChange={handleIntegerChange(val => setSettings(s => s ? {...s, maxAllowedGeminiApi: val } : s), 1)} min="1" max="500" disabled={isRunning} />
                                    <ConfigInput label="Max Gemini Errors" id="maxGeminiErrors" type="number" value={settings.maxGeminiError} onChange={handleIntegerChange(val => setSettings(s => s ? {...s, maxGeminiError: val } : s), 1)} min="1" max="150" disabled={isRunning} />
                                </div>
                            </div>
                            <div className="sm:col-span-2 mt-2 pt-3 border-t border-slate-700">
                                <p className="text-sm font-semibold text-slate-400 mb-2">Tavily Concurrency & Retry Config</p>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <ConfigInput label="Batch Size" id="batchSize" type="number" value={settings.tavily.batchSize} onChange={handleIntegerChange(val => handleNestedChange('tavily', 'batchSize', val), 1)} min="1" max="20" disabled={isRunning} />
                                    <ConfigInput label="Max Parallel Runs" id="tavilyMaxParallel" type="number" value={settings.tavily.maxParallel} onChange={handleIntegerChange(val => handleNestedChange('tavily', 'maxParallel', val), 1)} min="1" disabled={isRunning} />
                                    <ConfigInput label="Initial Delay (ms)" id="tavilyInitialDelay" type="number" value={settings.tavily.initialDelay} onChange={handleIntegerChange(val => handleNestedChange('tavily', 'initialDelay', val), 0)} min="0" disabled={isRunning} />
                                    <ConfigInput label="Delay After Run (ms)" id="tavilyAfterDelay" type="number" value={settings.tavily.afterDelay} onChange={handleIntegerChange(val => handleNestedChange('tavily', 'afterDelay', val), 0)} min="0" disabled={isRunning} />
                                    <ConfigInput label="Timeout Retries" id="timeoutRetries" type="number" value={settings.tavily.timeoutRetryCount} onChange={handleIntegerChange(val => handleNestedChange('tavily', 'timeoutRetryCount', val), 0)} min="0" disabled={isRunning} />
                                    <ConfigInput label="Rate Limit Retries" id="rateLimitRetries" type="number" value={settings.tavily.rateLimitRetryCount} onChange={handleIntegerChange(val => handleNestedChange('tavily', 'rateLimitRetryCount', val), 0)} min="0" disabled={isRunning} />
                                </div>
                            </div>
                            <div className="sm:col-span-2 mt-2 pt-3 border-t border-slate-700">
                                <p className="text-sm font-semibold text-slate-400 mb-2">✨ Gemini Config</p>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <ConfigInput label="Max Parallel Runs" id="geminiMaxParallel" type="number" value={settings.gemini.maxParallel} onChange={handleIntegerChange(val => handleNestedChange('gemini', 'maxParallel', val), 1)} min="1" disabled={isRunning} />
                                    <ConfigInput label="Local Timeout (s)" id="geminiTimeout" type="number" value={settings.gemini.timeout} onChange={handleIntegerChange(val => handleNestedChange('gemini', 'timeout', val), 1)} min="1" disabled={isRunning} />
                                    <ConfigInput label="Timeout/API Retries" id="geminiRetries" type="number" value={settings.gemini.retries} onChange={handleIntegerChange(val => handleNestedChange('gemini', 'retries', val), 0)} min="0" disabled={isRunning} />
                                    <ConfigInput label="Initial Delay (ms)" id="geminiInitialDelay" type="number" value={settings.gemini.initialDelay} onChange={handleIntegerChange(val => handleNestedChange('gemini', 'initialDelay', val), 0)} min="0" disabled={isRunning} />
                                    <ConfigInput label="Delay After Run (ms)" id="geminiAfterDelay" type="number" value={settings.gemini.afterDelay} onChange={handleIntegerChange(val => handleNestedChange('gemini', 'afterDelay', val), 0)} min="0" disabled={isRunning} />
                                    <ConfigInput label="Model" id="model" type="text" value={settings.gemini.model} onChange={e => handleNestedChange('gemini', 'model', e.target.value)} disabled={isRunning} />
                                    <ConfigInput label="Temperature" id="temperature" type="number" value={settings.gemini.temperature} onChange={handleFloatChange(val => handleNestedChange('gemini', 'temperature', val), 0.0, 1.0)} step="0.1" min="0" max="1" disabled={isRunning} />
                                    <ConfigInput label="Thinking Budget (-1 = auto)" id="thinking" type="number" name="thinkingBudget" value={settings.gemini.thinkingBudget} onChange={handleIntegerChange(val => handleNestedChange('gemini', 'thinkingBudget', val), -1)} disabled={isRunning} />
                                    <ConfigInput label="Max Output Tokens" id="maxOutputTokens" type="number" value={settings.gemini.maxOutputTokens} onChange={handleIntegerChange(val => handleNestedChange('gemini', 'maxOutputTokens', val), 1)} min="1" disabled={isRunning} />
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* System Instruction Section */}
                <div className="bg-slate-800/50 rounded-lg p-4">
                    <button onClick={() => setShowSystemInstruction(!showSystemInstruction)} className="flex justify-between items-center w-full text-left font-semibold text-slate-200">
                        <span>Gemini System Instruction</span>
                        {showSystemInstruction ? <ChevronUpIcon /> : <ChevronDownIcon />}
                    </button>
                    {showSystemInstruction && (<div className="mt-4 animate-fade-in">
                        <textarea value={settings.gemini.systemInstruction} onChange={e => handleNestedChange('gemini', 'systemInstruction', e.target.value)}
                            className="w-full bg-slate-800 border border-slate-700 rounded-md p-3 text-slate-300 font-mono text-xs focus:ring-2 focus:ring-sky-500 focus:border-sky-500 transition"
                            rows={10} placeholder="Enter system instruction for Gemini..." disabled={isRunning} />
                    </div>)}
                </div>

                {/* Action Buttons */}
                {!isRunning ? (<button onClick={handleProcess} disabled={isProcessingDisabled} className="w-full bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-all duration-200 transform active:scale-95 shadow-lg">
                    <PlayIcon /> Process URLs
                </button>) : (<button onClick={handleStop} className="w-full bg-red-700 hover:bg-red-600 text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-all duration-200 transform active:scale-95 shadow-lg">
                    <StopIcon /> Stop Processing
                </button>)}
            </div>

            {/* RIGHT COLUMN */}
            <div className="flex flex-col gap-4 bg-slate-900 p-6 rounded-lg shadow-xl">
                
                {/* Processing Status (Metrics Grid) */}
                <div className="pb-2 border-b border-slate-800">
                  <div className="flex justify-between items-center mb-2">
                      <button onClick={() => setIsStatusGridExpanded(!isStatusGridExpanded)} className="flex items-center justify-between text-lg font-semibold text-slate-200 gap-2">
                        Processing Status
                        {isStatusGridExpanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
                      </button>
                      <button onClick={handleResetCounters} className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white px-2 py-1 rounded transition-colors">
                        Reset Global Counters
                      </button>
                  </div>
                </div>
                
                {isStatusGridExpanded && (
                    <div className="resize overflow-auto border border-slate-800 rounded p-2" style={{minHeight: '80px'}}>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-2">
                            <PipelineStatusIndicator label="Extraction" isAllowed={appAllowTavily} isActive={extractionPipelineActive} />
                            <PipelineStatusIndicator label="LLM" isAllowed={appAllowGemini} isActive={geminiPipelineActive} />
                            <StatCounter label="n.tav" value={apiCounts.tavily} valueColor="text-cyan-400" />
                            <StatCounter label="n.llm" value={apiCounts.gemini} valueColor="text-cyan-400" />
                            <StatCounter label="n.inntok" value={tokenCounts.input} valueColor="text-green-400" />
                            <StatCounter label="n.outtok" value={tokenCounts.output} valueColor="text-green-400" />
                            <StatCounter label="n.thtok" value={tokenCounts.thinking} valueColor="text-teal-400" />
                            <StatCounter label="n.tottok" value={tokenCounts.total} valueColor="text-lime-300" />
                            <StatCounter label="n.lines" value={outputStats.lines} valueColor="text-amber-400" />
                            <StatCounter label="t.size" value={formatBytes(outputStats.size)} valueColor="text-amber-400" />
                        </div>
                    </div>
                )}

                {/* Job List Box (Resizable) */}
                <div className="border-t border-slate-800 pt-2">
                    <button onClick={() => setIsJobListExpanded(!isJobListExpanded)} className="flex justify-between items-center w-full text-left font-semibold text-slate-200 mb-2">
                        <span>Processing List</span>
                        {isJobListExpanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
                    </button>
                    
                    {isJobListExpanded && (
                        <div className="bg-slate-950 border border-slate-700 rounded-md p-3 h-48 overflow-auto resize-y" style={{ minHeight: '100px' }}>
                            {jobs.length === 0 && <p className="text-slate-500">Waiting to start...</p>}
                            <ul className="space-y-1">
                                {jobs.map(job => {
                                    const { color, text } = getStatusInfo(job);
                                    return (
                                        <li key={job.id}>
                                            <div onClick={() => settings.debugMode && setSelectedJob(job)} className={`text-sm flex justify-between ${color} ${settings.debugMode ? 'cursor-pointer hover:bg-slate-800/50 rounded px-1' : ''}`}>
                                                <span className="truncate pr-4" title={job.url}>{truncateUrl(job.url, 45)}</span>
                                                <span className="font-mono flex-shrink-0">{text}</span>
                                            </div>
                                        </li>
                                    )
                                })}
                            </ul>
                        </div>
                    )}
                </div>

                {/* Final Output Section */}
                <div className="flex-grow flex flex-col mt-2">
                    <div className="flex justify-between items-center mb-2">
                        <button onClick={() => setIsOutputExpanded(!isOutputExpanded)} className="flex-grow flex items-center justify-between text-left text-lg font-semibold text-slate-200">
                            Final Markdown
                            <div className="flex items-center">
                                <button onClick={handleDownload} disabled={!finalMarkdown || isRunning} className="bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-bold py-2 px-4 rounded-lg flex items-center gap-2 text-sm transition shadow-md ml-4 active:scale-95">
                                    <DownloadIcon /> Download
                                </button>
                                <div className="ml-2">{isOutputExpanded ? <ChevronUpIcon /> : <ChevronDownIcon />}</div>
                            </div>
                        </button>
                    </div>
                    {isOutputExpanded && (
                        <textarea value={finalMarkdown} readOnly className="w-full flex-grow bg-slate-950 border border-slate-700 rounded-md p-3 text-slate-300 font-mono text-sm h-96"
                            placeholder="Processed output will appear here..." />
                    )}
                </div>
            </div>
        </div>
    );
};

export default UrlProcessor;