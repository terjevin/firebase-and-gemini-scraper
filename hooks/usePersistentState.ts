
import { useState, useEffect, Dispatch, SetStateAction } from 'react';

function usePersistentState<T>(key: string, defaultValue: T): [T, Dispatch<SetStateAction<T>>] {
    const [state, setState] = useState<T>(() => {
        try {
            const storedValue = window.localStorage.getItem(key);
            // If no value is in storage, use the default.
            if (storedValue === null) {
                return defaultValue;
            }

            const parsed = JSON.parse(storedValue);
            
            // If the parsed value is null or undefined (e.g., from storing NaN),
            // fall back to the default value to avoid invalid states for required fields.
            return parsed ?? defaultValue;

        } catch (error) {
            // If parsing fails for any reason, log it and fall back to the default.
            console.error(`Error reading or parsing localStorage key "${key}":`, error);
            return defaultValue;
        }
    });

    useEffect(() => {
        try {
            // Avoid storing `undefined`. If state becomes undefined, store null instead,
            // which is valid JSON.
            const valueToStore = state === undefined ? null : state;
            window.localStorage.setItem(key, JSON.stringify(valueToStore));
        } catch (error) {
            console.error(`Error setting localStorage key "${key}":`, error);
        }
    }, [key, state]);

    return [state, setState];
}

export { usePersistentState };
