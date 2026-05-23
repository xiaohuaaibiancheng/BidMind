/// <reference types="vite/client" />

import type { BidMindBridge } from './shared/types';

declare global {
  interface Window {
    bidmind?: BidMindBridge;
    bidmindClient?: {
      appName: string;
      platform: string;
    };
  }
}

export {};
