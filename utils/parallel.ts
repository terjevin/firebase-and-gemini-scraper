import React from 'react';

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Processes an array of items in parallel with a concurrency limit.
 * This implementation is based on the more robust version from UrlProcessor.
 * @param items The array of items to process.
 * @param processor An async function that processes a single item.
 * @param maxConcurrent The maximum number of items to process concurrently.
 * @param stopProcessingRef A React ref object that can be toggled to stop starting new tasks.
 */
export const processInParallel = <T,>(
    items: T[],
    processor: (item: T) => Promise<void>,
    maxConcurrent: number,
    stopProcessingRef: React.MutableRefObject<boolean>
): Promise<void> => {
    return new Promise((resolve) => {
        const queue = [...items];
        let running = 0;
        let completed = 0;
        const total = items.length;

        const runNext = () => {
            if (completed === total) {
                resolve();
                return;
            }

            while (running < maxConcurrent && queue.length > 0) {
                // Check stop signal before starting a new item
                if (stopProcessingRef.current) {
                    if (running === 0) {
                        completed = total; // Mark all as "completed" to exit the loop
                        resolve();
                    }
                    return;
                }

                running++;
                const item = queue.shift()!;
                
                processor(item).finally(() => {
                    running--;
                    completed++;
                    runNext();
                });
            }
        };

        if (total === 0) {
            resolve();
            return;
        }

        runNext();
    });
};
