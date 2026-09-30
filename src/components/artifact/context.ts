import { createContext } from 'react';
import type { CodeFence } from '../../lib/artifacts';

/** What a code block needs to know about the answer it belongs to. */
export interface MessageCodeContext {
  /** All code blocks of the answer: an HTML page is previewed with its CSS/JS siblings. */
  fences: CodeFence[];
  /** Sends a "fix these errors" request to the assistant. */
  onFix?: (prompt: string) => void;
}

export const MessageCode = createContext<MessageCodeContext>({ fences: [] });
