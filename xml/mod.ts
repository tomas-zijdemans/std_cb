// Copyright 2018-2026 the Deno authors. MIT license.
// This module is browser compatible.

/**
 * XML parsing and serialization for Deno.
 *
 * This module implements a non-validating XML 1.0 parser based on the
 * {@link https://www.w3.org/TR/xml/ | W3C XML 1.0 (Fifth Edition)} specification.
 *
 * ## Position Tracking
 *
 * Both parsers support optional position tracking (line, column, offset) for
 * debugging and error reporting:
 *
 * - **DOM parser ({@linkcode parse})**: Position tracking is **enabled by default**
 *   to provide detailed error messages. Disable with `{ trackPosition: false }`
 *   for a performance boost when parsing trusted XML.
 *
 * - **Streaming parser ({@linkcode XmlParseStream})**: Position tracking is
 *   **disabled by default** for optimal streaming performance. Enable with
 *   `{ trackPosition: true }` when you need position info in events.
 *
 * ```ts ignore
 * import { parse, XmlParseStream } from "@std/xml";
 * import { assertEquals } from "@std/assert";
 *
 * // DOM-style parser
 * const doc = parse("<root><item>Hello</item></root>");
 * assertEquals(doc.root.name.local, "root");
 *
 * // Streaming parser
 * const xml = "<root><item>Hello</item></root>";
 * const stream = ReadableStream.from([xml])
 *   .pipeThrough(new XmlParseStream());
 *
 * for await (const event of stream) {
 *   if (event.type === "start_element") {
 *     assertEquals(event.name.local, "root");
 *     break;
 *   }
 * }
 * ```
 *
 * @module
 */

export * from "./types.ts";
export * from "./parse_stream.ts";
export * from "./parse.ts";
export * from "./stringify.ts";
