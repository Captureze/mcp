import { describe, it, expect } from 'vitest';
import { CapturezeApiError, handleApiError, formatErrorForMcpTool, handleControllerError } from '../utils/error.util.js';

describe('error.util', () => {
  describe('CapturezeApiError', () => {
    it('creates an error with statusCode and message', () => {
      const err = new CapturezeApiError(404, 'Not found');
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('Not found');
      expect(err.name).toBe('CapturezeApiError');
    });
  });

  describe('handleApiError', () => {
    it('re-throws as CapturezeApiError for plain Error', () => {
      expect(() => handleApiError(new Error('Oops'), 'test')).toThrow(CapturezeApiError);
    });

    it('re-throws as CapturezeApiError for unknown value', () => {
      expect(() => handleApiError('string error', 'test')).toThrow(CapturezeApiError);
    });
  });

  describe('formatErrorForMcpTool', () => {
    it('formats a CapturezeApiError into MCP tool content', () => {
      const err = new CapturezeApiError(401, 'Unauthorized');
      const result = formatErrorForMcpTool(err);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('401');
      expect(result.content[0].text).toContain('Unauthorized');
    });

    it('formats a plain Error', () => {
      const result = formatErrorForMcpTool(new Error('Something went wrong'));
      expect(result.content[0].text).toContain('Something went wrong');
    });

    it('handles unknown error values', () => {
      const result = formatErrorForMcpTool(null);
      expect(result.content[0].text).toContain('unknown error');
    });
  });

  describe('handleControllerError', () => {
    it('wraps a CapturezeApiError with context', () => {
      const original = new CapturezeApiError(500, 'Server error');
      const wrapped = handleControllerError(original, {
        entityType: 'Capture',
        operation: 'create',
        source: 'test',
      });
      expect(wrapped).toBeInstanceOf(CapturezeApiError);
      expect(wrapped.message).toContain('Server error');
    });

    it('wraps a plain Error with context', () => {
      const original = new Error('Generic failure');
      const wrapped = handleControllerError(original, {
        entityType: 'Monitor',
        operation: 'delete',
        source: 'test',
      });
      expect(wrapped.message).toContain('Generic failure');
    });
  });
});
