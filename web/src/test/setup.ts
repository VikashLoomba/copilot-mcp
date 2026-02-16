import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';

const vscodeApiMock = {
  postMessage: vi.fn(),
  getState: vi.fn(() => undefined),
  setState: vi.fn()
};

Object.defineProperty(globalThis, 'acquireVsCodeApi', {
  value: () => vscodeApiMock,
  configurable: true,
  writable: true
});

afterEach(() => {
  cleanup();
  vscodeApiMock.postMessage.mockClear();
  vscodeApiMock.getState.mockClear();
  vscodeApiMock.setState.mockClear();
});
