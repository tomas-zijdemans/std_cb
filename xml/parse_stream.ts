// Copyright 2018-2026 the Deno authors. MIT license.
// This module is browser compatible.

/**
 * Streaming XML parser that transforms XML text into a stream of XML events.
 *
 * @module
 */

import type {
  ParseStreamOptions,
  XmlAttributeIterator,
  XmlCDataEvent,
  XmlCommentEvent,
  XmlDeclarationEvent,
  XmlEndElementEvent,
  XmlEvent,
  XmlEventCallbacks,
  XmlName,
  XmlProcessingInstructionEvent,
  XmlStartElementEvent,
  XmlTextEvent,
} from "./types.ts";
import { XmlTokenizer } from "./_tokenizer.ts";
import { XmlEventParser } from "./_parser.ts";

export type { ParseStreamOptions, XmlEventCallbacks } from "./types.ts";

/**
 * Parses a qualified name string into an XmlName object.
 */
function parseName(raw: string, colonIndex: number): XmlName {
  if (colonIndex === -1) {
    return { raw, local: raw };
  }
  return {
    raw,
    local: raw.slice(colonIndex + 1),
    prefix: raw.slice(0, colonIndex),
  };
}

/**
 * Event batcher that collects callback events into XmlEvent objects.
 *
 * This class implements XmlEventCallbacks and creates XmlEvent objects
 * from the callback parameters, then batches them for streaming output.
 *
 * Note: This allocates XmlEvent objects to maintain compatibility with
 * the XmlParseStream API. For zero-allocation streaming, use the callback
 * APIs directly.
 */
class EventBatcher implements XmlEventCallbacks {
  #events: XmlEvent[] = [];

  /**
   * Flush collected events and return them.
   * The internal buffer is cleared after this call.
   */
  flush(): XmlEvent[] {
    const events = this.#events;
    this.#events = [];
    return events;
  }

  onDeclaration(
    version: string,
    encoding: string | undefined,
    standalone: "yes" | "no" | undefined,
    line: number,
    column: number,
    offset: number,
  ): void {
    this.#events.push({
      type: "declaration",
      version,
      line,
      column,
      offset,
      ...(encoding !== undefined ? { encoding } : {}),
      ...(standalone !== undefined ? { standalone } : {}),
    } as XmlDeclarationEvent);
  }

  onStartElement(
    name: string,
    colonIndex: number,
    attributes: XmlAttributeIterator,
    selfClosing: boolean,
    line: number,
    column: number,
    offset: number,
  ): void {
    // Build attributes array (allocates objects)
    const attrs: Array<{ name: XmlName; value: string }> = [];
    for (let i = 0; i < attributes.count; i++) {
      const attrName = attributes.getName(i);
      const attrColonIndex = attributes.getColonIndex(i);
      attrs.push({
        name: parseName(attrName, attrColonIndex),
        value: attributes.getValue(i),
      });
    }

    this.#events.push(
      {
        type: "start_element",
        name: parseName(name, colonIndex),
        attributes: attrs,
        selfClosing,
        line,
        column,
        offset,
      } satisfies XmlStartElementEvent,
    );
  }

  onEndElement(
    name: string,
    colonIndex: number,
    line: number,
    column: number,
    offset: number,
  ): void {
    this.#events.push(
      {
        type: "end_element",
        name: parseName(name, colonIndex),
        line,
        column,
        offset,
      } satisfies XmlEndElementEvent,
    );
  }

  onText(
    text: string,
    line: number,
    column: number,
    offset: number,
  ): void {
    this.#events.push(
      {
        type: "text",
        text,
        line,
        column,
        offset,
      } satisfies XmlTextEvent,
    );
  }

  onCData(
    text: string,
    line: number,
    column: number,
    offset: number,
  ): void {
    this.#events.push(
      {
        type: "cdata",
        text,
        line,
        column,
        offset,
      } satisfies XmlCDataEvent,
    );
  }

  onComment(
    text: string,
    line: number,
    column: number,
    offset: number,
  ): void {
    this.#events.push(
      {
        type: "comment",
        text,
        line,
        column,
        offset,
      } satisfies XmlCommentEvent,
    );
  }

  onProcessingInstruction(
    target: string,
    content: string,
    line: number,
    column: number,
    offset: number,
  ): void {
    this.#events.push(
      {
        type: "processing_instruction",
        target,
        content,
        line,
        column,
        offset,
      } satisfies XmlProcessingInstructionEvent,
    );
  }
}

/**
 * Parse XML from a stream with maximum throughput using direct callbacks.
 *
 * This function provides the highest performance streaming XML parsing by
 * invoking callbacks directly without creating intermediate event objects.
 * Use this when you need maximum throughput and are comfortable with the
 * callback-based API.
 *
 * For a more familiar streaming API that yields event objects, use
 * {@linkcode XmlParseStream} instead.
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
 * ```ts
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

  // Handle both ReadableStream and AsyncIterable
  const iterable: AsyncIterable<string> = Symbol.asyncIterator in source
    ? source as AsyncIterable<string>
    : (source as ReadableStream<string>);

  for await (const chunk of iterable) {
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
  // Convert bytes to text
  const textStream: AsyncIterable<string> = Symbol.asyncIterator in source
    ? decodeAsyncIterable(source as AsyncIterable<Uint8Array>)
    : (source as ReadableStream<Uint8Array>).pipeThrough(
      new TextDecoderStream(),
    );

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

/**
 * A streaming XML parser that transforms XML text into a stream of event batches.
 *
 * This class implements the `TransformStream` interface, allowing it to be used
 * with the Streams API for processing XML data in a streaming fashion.
 *
 * Events are yielded in batches (arrays) aligned with input chunks for optimal
 * performance. This avoids the significant async overhead of yielding individual
 * events, which can be 100x slower for large files.
 *
 * @example Basic usage
 * ```ts
 * import { XmlParseStream } from "@std/xml/parse-stream";
 *
 * const xml = `<?xml version="1.0"?>
 * <root>
 *   <item id="1">First</item>
 *   <item id="2">Second</item>
 * </root>`;
 *
 * const stream = ReadableStream.from([xml])
 *   .pipeThrough(new XmlParseStream());
 *
 * for await (const batch of stream) {
 *   for (const event of batch) {
 *     if (event.type === "start_element") {
 *       console.log(`Opening: ${event.name.local}`);
 *     }
 *   }
 * }
 * ```
 *
 * @example Parsing from a fetch response
 * ```ts ignore
 * import { XmlParseStream } from "@std/xml/parse-stream";
 *
 * const response = await fetch("https://example.com/feed.xml");
 * const stream = response.body!
 *   .pipeThrough(new TextDecoderStream())
 *   .pipeThrough(new XmlParseStream());
 *
 * for await (const batch of stream) {
 *   for (const event of batch) {
 *     if (event.type === "start_element") {
 *       console.log(`Opening: ${event.name.local}`);
 *     }
 *   }
 * }
 * ```
 *
 * @example With options
 * ```ts
 * import { XmlParseStream } from "@std/xml/parse-stream";
 *
 * const xml = `<root>
 *   <!-- comment -->
 *   <item>text</item>
 * </root>`;
 *
 * const stream = ReadableStream.from([xml])
 *   .pipeThrough(new XmlParseStream({
 *     ignoreWhitespace: true,
 *     ignoreComments: true,
 *   }));
 *
 * for await (const batch of stream) {
 *   for (const event of batch) {
 *     console.log(event.type); // Only "start_element", "text", "end_element"
 *   }
 * }
 * ```
 *
 * @example With position tracking
 * ```ts
 * import { XmlParseStream } from "@std/xml/parse-stream";
 * import { assertEquals } from "@std/assert";
 *
 * // Position tracking is disabled by default for streaming performance.
 * // Enable it when you need line/column info for debugging or error reporting.
 * const xml = `<root><item/></root>`;
 *
 * const stream = ReadableStream.from([xml])
 *   .pipeThrough(new XmlParseStream({ trackPosition: true }));
 *
 * for await (const batch of stream) {
 *   for (const event of batch) {
 *     if (event.type === "start_element" && event.name.local === "item") {
 *       assertEquals(event.line, 1);
 *       assertEquals(event.column, 7);
 *     }
 *   }
 * }
 * ```
 */
export class XmlParseStream extends TransformStream<string, XmlEvent[]> {
  /**
   * Constructs a new XmlParseStream.
   *
   * @param options Options for parsing behavior.
   *
   * @example Default options
   * ```ts
   * import { XmlParseStream } from "@std/xml/parse-stream";
   *
   * const stream = new XmlParseStream();
   * ```
   *
   * @example With custom options
   * ```ts
   * import { XmlParseStream } from "@std/xml/parse-stream";
   *
   * const stream = new XmlParseStream({
   *   ignoreWhitespace: true,
   *   ignoreComments: true,
   * });
   * ```
   */
  constructor(options: ParseStreamOptions = {}) {
    const trackPosition = options.trackPosition ?? false;
    const tokenizer = new XmlTokenizer({ trackPosition });
    const batcher = new EventBatcher();
    const parser = new XmlEventParser(batcher, options);

    super({
      transform(
        chunk: string,
        controller: TransformStreamDefaultController<XmlEvent[]>,
      ) {
        tokenizer.process(chunk, parser);
        const events = batcher.flush();
        if (events.length > 0) {
          controller.enqueue(events);
        }
      },
      flush(controller: TransformStreamDefaultController<XmlEvent[]>) {
        tokenizer.finalize(parser);
        parser.finalize();
        const events = batcher.flush();
        if (events.length > 0) {
          controller.enqueue(events);
        }
      },
    });
  }
}
