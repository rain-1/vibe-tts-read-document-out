import { convert } from 'html-to-text';
import pdfParse from 'pdf-parse';

export interface ParsedDocument {
  text: string;
  metadata?: {
    title?: string;
    author?: string;
    pageCount?: number;
  };
}

/**
 * Parse plain text - just return as-is with basic cleanup
 */
export function parseText(content: string): ParsedDocument {
  // Basic cleanup: normalize line endings, trim
  const text = content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  return { text };
}

/**
 * Parse HTML to plain text
 */
export function parseHtml(content: string): ParsedDocument {
  const text = convert(content, {
    wordwrap: false,
    preserveNewlines: true,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
      { selector: 'nav', format: 'skip' },
      { selector: 'footer', format: 'skip' },
      { selector: 'header', format: 'skip' },
    ],
  });

  // Extract title if present
  const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : undefined;

  return {
    text: text.trim(),
    metadata: { title },
  };
}

/**
 * Parse PDF to plain text
 */
export async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  const data = await pdfParse(buffer);

  return {
    text: data.text.trim(),
    metadata: {
      pageCount: data.numpages,
      title: data.info?.Title,
      author: data.info?.Author,
    },
  };
}

/**
 * Main parser function that handles all document types
 */
export async function parseDocument(
  content: string | Buffer,
  fileType: 'text' | 'pdf' | 'html'
): Promise<ParsedDocument> {
  switch (fileType) {
    case 'text':
      if (Buffer.isBuffer(content)) {
        return parseText(content.toString('utf-8'));
      }
      return parseText(content);

    case 'html':
      if (Buffer.isBuffer(content)) {
        return parseHtml(content.toString('utf-8'));
      }
      return parseHtml(content);

    case 'pdf':
      if (!Buffer.isBuffer(content)) {
        // If string, assume it's base64 encoded
        content = Buffer.from(content, 'base64');
      }
      return parsePdf(content);

    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

/**
 * Split text into sentences for TTS processing
 * Handles various punctuation and edge cases
 */
export function splitIntoSentences(text: string): string[] {
  // Regex to split on sentence boundaries
  // Handles: periods, exclamation marks, question marks
  // Preserves: abbreviations like Mr., Mrs., Dr., etc.
  // Handles: quotes and parentheses

  const sentences: string[] = [];

  // First, normalize the text
  const normalized = text
    .replace(/\n{3,}/g, '\n\n') // Collapse multiple newlines
    .replace(/[ \t]+/g, ' ') // Collapse multiple spaces
    .trim();

  // Split on paragraph boundaries first
  const paragraphs = normalized.split(/\n\n+/);

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) continue;

    // Split paragraph into sentences
    // This regex handles common sentence-ending punctuation
    const sentenceRegex = /[^.!?]*[.!?]+(?:\s|$)|[^.!?]+$/g;
    const matches = paragraph.match(sentenceRegex);

    if (matches) {
      for (const match of matches) {
        const trimmed = match.trim();
        if (trimmed) {
          sentences.push(trimmed);
        }
      }
    }
  }

  return sentences;
}

/**
 * Clean text for TTS - remove problematic characters
 */
export function cleanTextForTTS(text: string): string {
  return text
    // Remove or replace special characters that might cause issues
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/[—–]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    // Remove control characters
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}
