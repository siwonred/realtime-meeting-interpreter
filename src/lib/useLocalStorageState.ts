"use client";

import { useEffect, useState } from "react";

export function useLocalStorageState<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(initialValue);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) setValue(JSON.parse(raw) as T);
    } catch {
      // ignore
    } finally {
      setIsHydrated(true);
    }
  }, [key]);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore
    }
  }, [isHydrated, key, value]);

  return { value, setValue, isHydrated };
}


