import React from 'react';
import UrlProcessor from './components/UrlProcessor';
import { UrlProcessorIcon, LoadingIcon } from './components/Icons';
import { SettingsProvider, useSettings } from './hooks/useSettings';

const AppContent: React.FC = () => {
  const { status, error } = useSettings();

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-slate-100">
        <LoadingIcon />
        <p className="mt-2">Loading settings...</p>
      </div>
    );
  }

  if (status === 'error') {
     return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-slate-100 p-4">
        <div className="bg-red-900/50 border border-red-700 text-red-300 p-6 rounded-lg text-center max-w-lg">
           <h2 className="text-2xl font-bold mb-2">Configuration Error</h2>
           <p className="font-mono bg-slate-950 p-2 rounded">{error}</p>
           <p className="mt-4">The application is locked. Please fix the `settings.json` file and reload the page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="bg-slate-900 shadow-lg sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <UrlProcessorIcon />
            <span>Content <span className="text-sky-400">Processor</span> AI</span>
          </h1>
        </div>
      </header>
      <main className="flex-grow container mx-auto p-4 sm:p-6">
        <UrlProcessor />
      </main>
    </div>
  );
}


const App: React.FC = () => {
  return (
    <SettingsProvider>
      <AppContent />
    </SettingsProvider>
  )
}

export default App;