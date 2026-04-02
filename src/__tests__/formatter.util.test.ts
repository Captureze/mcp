import { describe, it, expect } from 'vitest';
import { formatCapture, formatCaptureList, formatMonitor, formatMonitorList, formatAccount } from '../utils/formatter.util.js';
import type { Capture, CaptureListResult } from '../types/capture.types.js';
import type { Monitor, MonitorListResult } from '../types/monitor.types.js';
import type { Account } from '../types/account.types.js';

const mockCapture: Capture = {
  id: 'cap_123',
  url: 'https://example.com',
  status: 'completed',
  imageUrl: 'https://cdn.captureze.com/captures/cap_123.png',
  thumbnailUrl: 'https://cdn.captureze.com/captures/cap_123_thumb.png',
  width: 1280,
  height: 800,
  fullPage: false,
  format: 'png',
  createdAt: '2024-01-01T00:00:00Z',
};

const mockMonitor: Monitor = {
  id: 'mon_456',
  name: 'My Site',
  url: 'https://example.com',
  interval: 'daily',
  status: 'active',
  notifyOnChange: true,
  lastCaptureAt: '2024-01-02T00:00:00Z',
  createdAt: '2024-01-01T00:00:00Z',
};

const mockAccount: Account = {
  id: 'acc_789',
  email: 'user@example.com',
  plan: 'pro',
  captures: { used: 10, limit: 500 },
  monitors: { used: 2, limit: 20 },
};

describe('formatter.util', () => {
  describe('formatCapture', () => {
    it('formats a completed capture with all fields', () => {
      const output = formatCapture(mockCapture);
      expect(output).toContain('cap_123');
      expect(output).toContain('https://example.com');
      expect(output).toContain('completed');
      expect(output).toContain('1280×800');
      expect(output).toContain('png');
    });

    it('formats a pending capture without image URL', () => {
      const pending: Capture = { ...mockCapture, status: 'pending', imageUrl: undefined };
      const output = formatCapture(pending);
      expect(output).toContain('pending');
      expect(output).not.toContain('Image URL');
    });
  });

  describe('formatCaptureList', () => {
    it('returns "no captures" message when list is empty', () => {
      const result: CaptureListResult = { data: [], total: 0, page: 1, limit: 20 };
      expect(formatCaptureList(result)).toBe('No captures found.');
    });

    it('formats a non-empty capture list with totals', () => {
      const result: CaptureListResult = { data: [mockCapture], total: 1, page: 1, limit: 20 };
      const output = formatCaptureList(result);
      expect(output).toContain('1');
      expect(output).toContain('cap_123');
      expect(output).toContain('completed');
    });
  });

  describe('formatMonitor', () => {
    it('formats a monitor with all fields', () => {
      const output = formatMonitor(mockMonitor);
      expect(output).toContain('mon_456');
      expect(output).toContain('My Site');
      expect(output).toContain('daily');
      expect(output).toContain('active');
    });
  });

  describe('formatMonitorList', () => {
    it('returns "no monitors" message when list is empty', () => {
      const result: MonitorListResult = { data: [], total: 0, page: 1, limit: 20 };
      expect(formatMonitorList(result)).toBe('No monitors found.');
    });

    it('formats a non-empty monitor list', () => {
      const result: MonitorListResult = { data: [mockMonitor], total: 1, page: 1, limit: 20 };
      const output = formatMonitorList(result);
      expect(output).toContain('mon_456');
      expect(output).toContain('My Site');
    });
  });

  describe('formatAccount', () => {
    it('formats account information', () => {
      const output = formatAccount(mockAccount);
      expect(output).toContain('acc_789');
      expect(output).toContain('user@example.com');
      expect(output).toContain('pro');
      expect(output).toContain('10 / 500');
      expect(output).toContain('2 / 20');
    });
  });
});
