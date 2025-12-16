import React, { useState } from 'react';
import { Job, JOB_STATUS } from '../types';
import { JsonViewer } from './JsonViewer';
import { ChevronDownIcon, ChevronUpIcon } from './Icons';

interface DebugModalProps {
    job: Job | null;
    onClose: () => void;
}

const formatBytes = (bytes: number, decimals = 2) => {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

const JOB_STATUS_MAP: { [key: number]: string } = {
    [JOB_STATUS.READY_FOR_EXTRACTION]: 'Ready for Extraction',
    [JOB_STATUS.EXTRACTING]: 'Extracting',
    [JOB_STATUS.READY_FOR_LLM]: 'Ready for LLM',
    [JOB_STATUS.PROCESSING_LLM]: 'Processing LLM',
    [JOB_STATUS.COMPLETED]: 'Completed',
    [JOB_STATUS.ERROR]: 'Error',
};
const getStatusDescription = (status: number) => JOB_STATUS_MAP[status] || 'Unknown';

const getStatusColor = (status: number) => {
    switch (status) {
        case JOB_STATUS.COMPLETED: return 'text-green-400';
        case JOB_STATUS.PROCESSING_LLM:
        case JOB_STATUS.EXTRACTING: return 'text-purple-400';
        case JOB_STATUS.READY_FOR_LLM:
        case JOB_STATUS.READY_FOR_EXTRACTION: return 'text-sky-400';
        case JOB_STATUS.ERROR: return 'text-red-400';
        default: return 'text-slate-500';
    }
};


const CollapsibleSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <div className="border border-slate-700 rounded-lg">
            <button onClick={() => setIsOpen(!isOpen)} className="w-full flex justify-between items-center p-3 bg-slate-800/50 hover:bg-slate-800 transition">
                <h4 className="font-semibold text-slate-200">{title}</h4>
                {isOpen ? <ChevronUpIcon /> : <ChevronDownIcon />}
            </button>
            {isOpen && <div className="p-3">{children}</div>}
        </div>
    );
};

const MarkdownStats: React.FC<{ stats: {lines: number; size: number} | undefined, title: string }> = ({ stats, title }) => {
    if (!stats) return null;
    return (
         <div className="bg-slate-800/50 p-3 rounded">
            <h5 className="text-sm font-semibold text-slate-300 mb-2">{title}</h5>
            <div className="flex gap-4">
                <div>
                    <span className="text-slate-400 text-xs">Lines: </span>
                    <span className="font-mono text-sm text-amber-400">{stats.lines}</span>
                </div>
                <div>
                    <span className="text-slate-400 text-xs">Size: </span>
                    <span className="font-mono text-sm text-amber-400">{formatBytes(stats.size)}</span>
                </div>
            </div>
        </div>
    );
};

const JobMetrics: React.FC<{ job: Job }> = ({ job }) => {
    const usage = job.metrics?.usage;
    return (
        <div className="bg-slate-800/50 p-4 rounded-lg mb-4">
            <h4 className="font-semibold text-slate-200 mb-3 text-base">Metrics</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm mb-4">
                {job.tavilyResponseTime && (
                    <div>
                        <span className="text-slate-400">Tavily Time: </span>
                        <span className="font-mono text-cyan-400">{job.tavilyResponseTime.toFixed(2)}s</span>
                    </div>
                )}
                 {job.geminiResponseTime && (
                    <div>
                        <span className="text-slate-400">Gemini Time: </span>
                        <span className="font-mono text-cyan-400">{job.geminiResponseTime.toFixed(2)}s</span>
                    </div>
                )}
                {usage?.promptTokenCount !== undefined && (
                     <div>
                        <span className="text-slate-400">Input Tokens: </span>
                        <span className="font-mono text-green-400">{usage.promptTokenCount}</span>
                    </div>
                )}
                 {usage?.candidatesTokenCount !== undefined && (
                     <div>
                        <span className="text-slate-400">Output Tokens: </span>
                        <span className="font-mono text-green-400">{usage.candidatesTokenCount}</span>
                    </div>
                )}
                 {usage?.thoughtsTokenCount !== undefined && usage.thoughtsTokenCount > 0 && (
                     <div>
                        <span className="text-slate-400">Thinking Tokens: </span>
                        <span className="font-mono text-teal-400">{usage.thoughtsTokenCount}</span>
                    </div>
                )}
                 {usage?.totalTokenCount !== undefined && (
                     <div>
                        <span className="text-slate-400">Total Tokens: </span>
                        <span className="font-mono text-green-400 font-bold">{usage.totalTokenCount}</span>
                    </div>
                )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <MarkdownStats stats={job.rawMarkdownStats} title="Raw Markdown Stats" />
                <MarkdownStats stats={job.processedMarkdownStats} title="Processed Markdown Stats" />
            </div>
        </div>
    )
}

export const DebugModal: React.FC<DebugModalProps> = ({ job, onClose }) => {
    if (!job) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex justify-center items-center z-50 p-4" onClick={onClose}>
            <div 
                className="bg-slate-900 text-slate-200 rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
                onClick={e => e.stopPropagation()} // Prevent closing when clicking inside
            >
                <header className="p-4 border-b border-slate-700 flex justify-between items-center">
                    <h3 className="text-xl font-bold text-sky-400">Debug Info</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-white">&times;</button>
                </header>
                
                <main className="p-6 overflow-y-auto space-y-4">
                    <div className="bg-slate-950 p-4 rounded-lg">
                        <p><strong className="text-slate-400">URL:</strong> <span className="font-mono break-all">{job.url}</span></p>
                        <p><strong className="text-slate-400">Status:</strong> <span className={`font-semibold ${getStatusColor(job.status)}`}>{job.status} ({getStatusDescription(job.status)})</span></p>
                    </div>

                    <JobMetrics job={job} />

                    {job.error && (
                         <CollapsibleSection title="Error Details">
                            <pre className="bg-red-900/50 border border-red-700 text-red-300 p-3 rounded-md text-xs whitespace-pre-wrap font-mono">{job.error}</pre>
                        </CollapsibleSection>
                    )}
                    
                    {job.tavilyResult && (
                        <CollapsibleSection title="Tavily API Response">
                           <JsonViewer data={job.tavilyResult} />
                        </CollapsibleSection>
                    )}

                    {job.geminiRequestConfig && (
                        <CollapsibleSection title="Gemini Request Parameters">
                            <JsonViewer data={job.geminiRequestConfig} />
                        </CollapsibleSection>
                    )}

                    {job.geminiResponse && (
                        <CollapsibleSection title="Gemini Raw Response">
                            <JsonViewer data={job.geminiResponse} />
                        </CollapsibleSection>
                    )}

                </main>
            </div>
        </div>
    );
};