// Copyright 2018-2026 the Deno authors. MIT license.
// This module is browser compatible.

/**
 * Streaming XML parser with callback-based API for maximum throughput.
 *
 * @module
 */

import type { ParseStreamOptions, XmlEventCallbacks } from "./types.ts";
import { XmlTokenizer } from "./_tokenizer.ts";
import { XmlEventParser } from "./_parser.ts";

export type { ParseStreamOptions, XmlEventCallbacks } from "./types.ts";

/**
 * Parse XML from a stream with maximum throughput using direct callbacks.
 *
 * This function provides the highest performance streaming XML parsing by
 * invoking callbacks directly without creating intermediate event objects.
 * Use this when you need maximum throughput and are comfortable with the
 * callback-based API.
 *
 * @example Basic usage with fetch
 * ```ts ignore
 * import { parseXmlStream } from "@std/xml/parse-stream";
 *
 * const response = await fetch("https://example.com/feed.xml");
 * const textStream = response.body!.pipeThrough(new TextDecoderStream());
 *
 * let itemCount = 0;
 * await parseXmlStream(textStream, {
 *   onStartElement(name) {
 *     if (name === "item") itemCount++;
 *   },
 * });
 * console.log(`Found ${itemCount} items`);
 * ```
 *
 * @example Collecting data from elements
 * ```ts
 * import { parseXmlStream } from "@std/xml/parse-stream";
 * import { assertEquals } from "@std/assert";
 *
 * const xml = `<root><item id="1">First</item><item id="2">Second</item></root>`;
 * const stream = ReadableStream.from([xml]);
 *
 * const items: string[] = [];
 * let currentText = "";
 * let inItem = false;
 *
 * await parseXmlStream(stream, {
 *   onStartElement(name) {
 *     if (name === "item") {
 *       inItem = true;
 *       currentText = "";
 *     }
 *   },
 *   onText(text) {
 *     if (inItem) currentText += text;
 *   },
 *   onEndElement(name) {
 *     if (name === "item") {
 *       items.push(currentText);
 *       inItem = false;
 *     }
 *   },
 * });
 *
 * assertEquals(items, ["First", "Second"]);
 * ```
 *
 * @example With position tracking
 * ```ts ignore
 * import { parseXmlStream } from "@std/xml/parse-stream";
 *
 * const xml = `<root><error/></root>`;
 * const stream = ReadableStream.from([xml]);
 *
 * await parseXmlStream(stream, {
 *   onStartElement(name, _colonIndex, _attrs, _selfClosing, line, column) {
 *     if (name === "error") {
 *       console.log(`Error element at line ${line}, column ${column}`);
 *     }
 *   },
 * }, { trackPosition: true });
 * ```
 *
 * @param source The XML text stream to parse. Can be a ReadableStream or any
 *               AsyncIterable that yields string chunks.
 * @param callbacks Callback functions invoked for each XML event. All callbacks
 *                  are optional - only provide the ones you need.
 * @param options Parsing options.
 * @returns A promise that resolves when parsing is complete.
 */
export async function parseXmlStream(
  source: ReadableStream<string> | AsyncIterable<string>,
  callbacks: XmlEventCallbacks,
  options: ParseStreamOptions = {},
): Promise<void> {
  const trackPosition = options.trackPosition ?? false;
  const tokenizer = new XmlTokenizer({ trackPosition });
  const parser = new XmlEventParser(callbacks, options);

  // Both ReadableStream and AsyncIterable implement Symbol.asyncIterator
  for await (const chunk of source) {
    tokenizer.process(chunk, parser);
  }
  tokenizer.finalize(parser);
  parser.finalize();
}

/**
 * Parse XML from a byte stream with maximum throughput using direct callbacks.
 *
 * This is a convenience wrapper around {@linkcode parseXmlStream} that handles
 * text decoding. For pre-decoded text streams, use `parseXmlStream` directly.
 *
 * @example Parsing bytes from fetch
 * ```ts ignore
 * import { parseXmlStreamFromBytes } from "@std/xml/parse-stream";
 *
 * const response = await fetch("https://example.com/feed.xml");
 *
 * await parseXmlStreamFromBytes(response.body!, {
 *   onStartElement(name) {
 *     console.log(`Element: ${name}`);
 *   },
 * });
 * ```
 *
 * @param source The XML byte stream to parse.
 * @param callbacks Callback functions invoked for each XML event.
 * @param options Parsing options.
 * @returns A promise that resolves when parsing is complete.
 */
export function parseXmlStreamFromBytes(
  source: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
  callbacks: XmlEventCallbacks,
  options: ParseStreamOptions = {},
): Promise<void> {
  // Both ReadableStream and AsyncIterable implement Symbol.asyncIterator,
  // so we can always use decodeAsyncIterable for streaming text decoding
  const textStream = decodeAsyncIterable(source as AsyncIterable<Uint8Array>);
  return parseXmlStream(textStream, callbacks, options);
}

/**
 * Helper to decode an AsyncIterable of bytes to strings.
 */
async function* decodeAsyncIterable(
  source: AsyncIterable<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  for await (const chunk of source) {
    yield decoder.decode(chunk, { stream: true });
  }
  // Flush any remaining bytes
  const final = decoder.decode();
  if (final) yield final;
}
