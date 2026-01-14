// Copyright 2018-2026 the Deno authors. MIT license.
// This module is browser compatible.

/**
 * Builds an in-memory XML document tree from a string.
 *
 * @module
 */

import type { ParseOptions, XmlDocument } from "./types.ts";
import { parseSync } from "./_parse_sync.ts";

export type { ParseOptions } from "./types.ts";

/**
 * Parses an XML string into a document tree.
 *
 * @example Basic usage
 * ```ts
 * import { parse } from "@std/xml/parse";
 * import { assertEquals } from "@std/assert";
 *
 * const xml = `<product id="123"><name>Widget</name></product>`;
 * const doc = parse(xml);
 *
 * assertEquals(doc.root.name.local, "product");
 * assertEquals(doc.root.attributes["id"], "123");
 * ```
 *
 * @example With nested elements
 * ```ts
 * import { parse } from "@std/xml/parse";
 * import { assertEquals } from "@std/assert";
 *
 * const xml = `<root><child>text</child></root>`;
 * const doc = parse(xml);
 *
 * assertEquals(doc.root.children.length, 1);
 * if (doc.root.children[0]?.type === "element") {
 *   assertEquals(doc.root.children[0].name.local, "child");
 * }
 * ```
 *
 * @example Ignoring whitespace
 * ```ts
 * import { parse } from "@std/xml/parse";
 * import { assertEquals } from "@std/assert";
 *
 * const xml = `<root>
 *   <item/>
 * </root>`;
 * const doc = parse(xml, { ignoreWhitespace: true });
 *
 * // Whitespace-only text nodes are removed
 * assertEquals(doc.root.children.length, 1);
 * ```
 *
 * @example Disabling position tracking for performance
 * ```ts
 * import { parse } from "@std/xml/parse";
 * import { assertEquals } from "@std/assert";
 *
 * // Position tracking is enabled by default for better error messages.
 * // Disable it for a performance boost when parsing trusted/valid XML.
 * const xml = `<root><item/></root>`;
 * const doc = parse(xml, { trackPosition: false });
 *
 * assertEquals(doc.root.name.local, "root");
 * ```
 *
 * @param xml The XML string to parse.
 * @param options Options to control parsing behavior.
 * @returns The parsed document.
 * @throws {XmlSyntaxError} If the XML is malformed or has no root element.
 */
export function parse(xml: string, options?: ParseOptions): XmlDocument {
  return parseSync(xml, options);
}
