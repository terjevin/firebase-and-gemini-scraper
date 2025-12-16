
import React from 'react';

interface JsonViewerProps {
    data: any;
}

const getHighlightClass = (key: string): string => {
    if (['usageMetadata'].includes(key)) {
        return 'text-green-400 font-bold'; // Tokens
    }
    if (['thoughtsTokenCount'].includes(key)) {
        return 'text-teal-400 font-bold'; // Thinking Tokens
    }
    if (['finishReason'].includes(key)) {
        return 'text-violet-400 font-bold'; // Finish Reason
    }
    if (['systemInstruction'].includes(key)) {
        return 'text-orange-400'; // System Instruction
    }
    if (['model', 'temperature', 'thinkingBudget', 'maxOutputTokens'].includes(key)) {
        return 'text-blue-400'; // Other config params
    }
    return 'text-cyan-400'; // Default key color
};

const renderValue = (value: any): React.ReactElement => {
    if (typeof value === 'string') {
        return <span className="text-amber-300">"{value}"</span>;
    }
    if (typeof value === 'number') {
        return <span className="text-fuchsia-400">{value}</span>;
    }
    if (typeof value === 'boolean') {
        return <span className="text-sky-400">{String(value)}</span>;
    }
    if (value === null || value === undefined) {
        return <span className="text-slate-500">null</span>;
    }
    return <JsonNode data={value} />;
};

const JsonNode: React.FC<{ data: any }> = ({ data }) => {
    if (typeof data !== 'object' || data === null) {
        return renderValue(data);
    }
    
    const isArray = Array.isArray(data);
    const entries = Object.entries(data);

    return (
        <div className="pl-4">
            {entries.map(([key, value], index) => (
                <div key={index}>
                    <span className={getHighlightClass(key)}>{isArray ? '' : `"${key}": `}</span>
                    {renderValue(value)}
                    {index < entries.length - 1 && <span>,</span>}
                </div>
            ))}
        </div>
    );
};

export const JsonViewer: React.FC<JsonViewerProps> = ({ data }) => {
    return (
        <pre className="bg-slate-950 text-slate-300 p-4 rounded-lg text-xs font-mono whitespace-pre-wrap">
            <code>
                {Array.isArray(data) ? '[' : '{'}
                <JsonNode data={data} />
                {Array.isArray(data) ? ']' : '}'}
            </code>
        </pre>
    );
};