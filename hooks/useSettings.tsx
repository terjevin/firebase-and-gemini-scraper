
import React, { createContext, useContext, useState, useEffect, ReactNode, useRef, useCallback } from 'react';
import { GenerateContentResponse } from "@google/genai";
import { TavilyRequestConfig, GeminiRequestConfig } from '../types';
import { processMarkdownWithGemini } from '../services/geminiService';
import { extractWithTavily } from '../services/tavilyService';

// --- Type Definitions ---
export interface AppSettings {
    urls: string[];
    tavilyApiKey: string;
    geminiApiKey: string;
    geminiAllow: boolean;
    tavilyAllow: boolean;
    maxAllowedGeminiApi: number;
    maxAllowedTavilyApi: number;
    maxGeminiError: number;
    maxTavilyError: number;
    extractDepth: string;
    outputFilename: string;
    outputSeparator: string;
    debugMode: boolean;
    tavily: {
        batchSize: number;
        maxParallel: number;
        initialDelay: number;
        afterDelay: number;
        timeoutRetryCount: number;
        timeoutRetryDelay: number;
        rateLimitRetryCount: number;
        rateLimitRetryDelay: number;
    };
    gemini: {
        model: string;
        systemInstruction: string;
        temperature: number;
        thinkingBudget: number;
        maxOutputTokens: number;
        maxParallel: number;
        initialDelay: number;
        afterDelay: number;
        timeout: number;
        retries: number;
    };
}

type AppStatus = 'loading' | 'ready' | 'error';

interface SettingsContextType {
    settings: AppSettings | null;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings | null>>;
    status: AppStatus;
    error: string | null;
    appAllowGemini: boolean;
    appAllowTavily: boolean;
    callGeminiAPI: (markdown: string, config: GeminiRequestConfig) => Promise<GenerateContentResponse>;
    callTavilyAPI: (config: TavilyRequestConfig) => Promise<any>;
    resetUsageCounters: () => void;
}

// --- Constants ---
// Updated to v2 to clear old cached settings and force load new system instruction
const SETTINGS_STORAGE_KEY = 'content-processor-ai-settings-v2';

// --- Context ---
const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

// --- Provider Component ---
export const SettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [loadStatus, setLoadStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
    const [error, setError] = useState<string | null>(null);
    
    // Kill switch states
    const [appAllowGemini, setAppAllowGemini] = useState(false);
    const [appAllowTavily, setAppAllowTavily] = useState(false);

    // API counters
    const totalGeminiCalls = useRef(0);
    const totalTavilyCalls = useRef(0);
    const totalGeminiErrors = useRef(0);
    const totalTavilyErrors = useRef(0);


    // Effect 1: Load initial settings from file and merge with localStorage (runs once)
    useEffect(() => {
        const loadInitialSettings = async () => {
            try {
                const response = await fetch('/settings.json');
                if (!response.ok) throw new Error(`Could not load settings.json (HTTP ${response.status})`);
                
                const defaultSettings = await response.json();
                let finalSettings = defaultSettings;

                const savedSettingsRaw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
                if (savedSettingsRaw) {
                    try {
                        const savedSettings = JSON.parse(savedSettingsRaw);
                        // Explicit, robust merge.
                        finalSettings = {
                            ...defaultSettings,
                            ...savedSettings,
                            tavily: {
                                ...defaultSettings.tavily,
                                ...(savedSettings.tavily || {}),
                            },
                            gemini: {
                                ...defaultSettings.gemini,
                                ...(savedSettings.gemini || {}),
                            }
                        };
                    } catch (e) {
                        console.warn("Could not parse saved settings, using defaults.", e)
                    }
                }
                
                setSettings(finalSettings);
                setLoadStatus('loaded');
                
            } catch (err: any) {
                setError(err.message);
                setLoadStatus('error');
            }
        };
        loadInitialSettings();
    }, []);

    // Effect 2: Validate settings and save to localStorage whenever they change (REACTIVE)
    useEffect(() => {
        if (!settings || loadStatus !== 'loaded') return;

        // 1. Persist every change to localStorage
        window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));

        // 2. Re-validate the entire configuration
        let validationErrors: string[] = [];
        let geminiIsValid = true;
        let tavilyIsValid = true;

        const { 
            maxAllowedGeminiApi, maxAllowedTavilyApi, 
            maxGeminiError, maxTavilyError 
        } = settings;

        if ([maxAllowedGeminiApi, maxAllowedTavilyApi, maxGeminiError, maxTavilyError].some(v => v === undefined)) {
            validationErrors.push("One or more API security limit values are missing.");
            geminiIsValid = tavilyIsValid = false;
        }
        
        // Max API Calls: 1 - 500
        if (!((maxAllowedGeminiApi >= 1 && maxAllowedGeminiApi <= 500) && (maxAllowedTavilyApi >= 1 && maxAllowedTavilyApi <= 500))) {
            validationErrors.push("Max API calls must be between 1 and 500.");
            geminiIsValid = tavilyIsValid = false;
        }
        
        // Max Errors: 1 - 150
        if (!((maxGeminiError >= 1 && maxGeminiError <= 150) && (maxTavilyError >= 1 && maxTavilyError <= 150))) {
             validationErrors.push("Max Errors must be between 1 and 150.");
             geminiIsValid = tavilyIsValid = false;
        }

        const effectiveGeminiKey = settings.geminiApiKey || process.env.API_KEY;
        if (settings.geminiAllow && !effectiveGeminiKey) {
            validationErrors.push("Gemini API Key is missing.");
            geminiIsValid = false;
        }
        
        if (settings.tavilyAllow && !settings.tavilyApiKey) {
            validationErrors.push("Tavily API Key is missing.");
            tavilyIsValid = false;
        }

        setError(validationErrors.length > 0 ? validationErrors.join(' ') : null);
        
        // Update allow states based on settings AND validation
        setAppAllowGemini(settings.geminiAllow && geminiIsValid);
        setAppAllowTavily(settings.tavilyAllow && tavilyIsValid);
        
    }, [settings, loadStatus]);

    const triggerKillSwitch = useCallback((reason: string) => {
        console.error(`KILL SWITCH ACTIVATED: ${reason}`);
        setAppAllowGemini(false);
        setAppAllowTavily(false);
        setError(`KILL SWITCH: Max API calls/errors reached. App locked.`);
        
        // Persist the locked state
        setSettings(prev => {
            if (!prev) return null;
            const newSettings = { ...prev, geminiAllow: false, tavilyAllow: false };
            window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
            return newSettings;
        });

    }, []);

    const resetUsageCounters = useCallback(() => {
        totalGeminiCalls.current = 0;
        totalTavilyCalls.current = 0;
        totalGeminiErrors.current = 0;
        totalTavilyErrors.current = 0;
        
        // Explicitly enable immediately to update UI indicators
        setAppAllowGemini(true); 
        setAppAllowTavily(true);
        setError(null);
        
        setSettings(prev => {
             if (!prev) return null;
             // Reset the persistent flags so they don't lock again on reload
             // Also ensure error state is cleared
             const newSettings = { ...prev, geminiAllow: true, tavilyAllow: true };
             window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newSettings));
             return newSettings;
        });

    }, []);

    const callTavilyAPI = useCallback(async (config: TavilyRequestConfig) => {
        if (!appAllowTavily) throw new Error("Tavily API calls are disabled by kill switch.");
        if (!settings) throw new Error("Settings not loaded.");

        if (totalTavilyCalls.current >= settings.maxAllowedTavilyApi) {
            triggerKillSwitch("Tavily call limit reached.");
            throw new Error("KILL SWITCH: Tavily call limit reached.");
        }
        if (totalTavilyErrors.current >= settings.maxTavilyError) {
            triggerKillSwitch("Tavily error limit reached.");
            throw new Error("KILL SWITCH: Tavily error limit reached.");
        }
        
        totalTavilyCalls.current += 1;
        try {
            return await extractWithTavily(config);
        } catch (e) {
            totalTavilyErrors.current += 1;
            throw e;
        }
    }, [appAllowTavily, settings, triggerKillSwitch]);

    const callGeminiAPI = useCallback(async (markdown: string, config: GeminiRequestConfig) => {
        if (!appAllowGemini) throw new Error("Gemini API calls are disabled by kill switch.");
        if (!settings) throw new Error("Settings not loaded.");

        const effectiveGeminiKey = settings.geminiApiKey || process.env.API_KEY;
        if (!effectiveGeminiKey) throw new Error("Gemini API key is missing.");
        
        if (totalGeminiCalls.current >= settings.maxAllowedGeminiApi) {
            triggerKillSwitch("Gemini call limit reached.");
            throw new Error("KILL SWITCH: Gemini call limit reached.");
        }
        if (totalGeminiErrors.current >= settings.maxGeminiError) {
            triggerKillSwitch("Gemini error limit reached.");
            throw new Error("KILL SWITCH: Gemini error limit reached.");
        }

        totalGeminiCalls.current += 1;
        try {
            return await processMarkdownWithGemini(markdown, config, effectiveGeminiKey);
        } catch (e) {
            totalGeminiErrors.current += 1;
            throw e;
        }
    }, [appAllowGemini, settings, triggerKillSwitch]);

    const status: AppStatus = loadStatus === 'error' ? 'error' : (loadStatus === 'loading' ? 'loading' : 'ready');

    return (
        <SettingsContext.Provider value={{ 
            settings, setSettings, status, error, 
            appAllowGemini, appAllowTavily,
            callGeminiAPI, callTavilyAPI,
            resetUsageCounters 
        }}>
            {children}
        </SettingsContext.Provider>
    );
};

// --- Custom Hook ---
export const useSettings = (): SettingsContextType => {
    const context = useContext(SettingsContext);
    if (context === undefined) {
        throw new Error('useSettings must be used within a SettingsProvider');
    }
    return context;
};
