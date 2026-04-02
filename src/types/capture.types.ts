/**
 * A screenshot capture resource returned by the Captureze API.
 */
export interface Capture {
  id: string;
  url: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  imageUrl?: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  fullPage?: boolean;
  format?: string;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Parameters for requesting a new capture.
 */
export interface CaptureOptions {
  url: string;
  width?: number;
  height?: number;
  fullPage?: boolean;
  format?: 'png' | 'jpeg' | 'webp' | 'pdf';
  blockAds?: boolean;
  blockCookieBanners?: boolean;
  delay?: number;
}

/**
 * Paginated list of captures.
 */
export interface CaptureListResult {
  data: Capture[];
  total: number;
  page: number;
  limit: number;
}
