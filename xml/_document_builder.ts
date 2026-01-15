// Copyright 2018-2026 the Deno authors. MIT license.
// This module is browser compatible.

/**
 * Document builder that constructs an XML tree from callback events.
 *
 * @module
 */

import type {
  ParseOptions,
  XmlAttributeIterator,
  XmlCDataNode,
  XmlCommentNode,
  XmlDeclarationEvent,
  XmlDocument,
  XmlElement,
  XmlEventCallbacks,
  XmlName,
  XmlNode,
  XmlTextNode,
} from "./types.ts";
import { XmlSyntaxError } from "./types.ts";
import { XmlTokenizer } from "./_tokenizer.ts";
import { XmlEventParser } from "./_parser.ts";
import { createCachedNameParser, LINE_ENDING_RE } from "./_common.ts";

/** Internal mutable type for building the tree. */
type MutableElement = {
  type: "element";
  name: XmlName;
  attributes: Record<string, string>;
  children: XmlNode[];
};

/**
 * Builds an XML document tree from callback events.
 *
 * Implements XmlEventCallbacks to receive parsed events and constructs
 * the document tree incrementally. This allows the same optimized
 * tokenizer/parser chain to be used for both streaming and sync parsing.
 */
export class XmlDocumentBuilder implements XmlEventCallbacks {
  #stack: MutableElement[] = [];
  #root: MutableElement | undefined;
  #declaration: XmlDeclarationEvent | undefined;
  #ignoreWhitespace: boolean;
  #ignoreComments: boolean;
  #parseName = createCachedNameParser();
  #lastSelfClosing = false;

  constructor(options?: ParseOptions) {
    this.#ignoreWhitespace = options?.ignoreWhitespace ?? false;
    this.#ignoreComments = options?.ignoreComments ?? false;
  }

  /**
   * Returns the built document.
   * Should only be called after all events have been processed.
   */
  getDocument(): XmlDocument {
    if (!this.#root) {
      throw new XmlSyntaxError(
        "No root element found in XML document",
        { line: 1, column: 1, offset: 0 },
      );
    }

    // Check for unclosed elements
    if (this.#stack.length > 0) {
      const unclosed = this.#stack[this.#stack.length - 1]!;
      const name = unclosed.name.prefix
        ? `${unclosed.name.prefix}:${unclosed.name.local}`
        : unclosed.name.local;
      throw new XmlSyntaxError(
        `Unclosed element <${name}>`,
        { line: 0, column: 0, offset: 0 },
      );
    }

    return {
      ...(this.#declaration !== undefined && { declaration: this.#declaration }),
      root: this.#root as XmlElement,
    };
  }

  onDeclaration(
    version: string,
    encoding: string | undefined,
    standalone: "yes" | "no" | undefined,
    line: number,
    column: number,
    offset: number,
  ): void {
    this.#declaration = {
      type: "declaration",
      version,
      line,
      column,
      offset,
      ...(encoding !== undefined && { encoding }),
      ...(standalone !== undefined && { standalone }),
    };
  }

  onStartElement(
    name: string,
    colonIndex: number,
    attributes: XmlAttributeIterator,
    selfClosing: boolean,
    _line: number,
    _column: number,
    _offset: number,
  ): void {
    // Build name using cached parser
    const xmlName = this.#parseName(name);

    // Build attributes object
    const attrs: Record<string, string> = {};
    for (let i = 0; i < attributes.count; i++) {
      const attrName = attributes.getName(i);
      const attrColonIndex = attributes.getColonIndex(i);
      // Use local name as key (consistent with _parse_sync.ts)
      const localName = attrColonIndex === -1
        ? attrName
        : attrName.slice(attrColonIndex + 1);
      attrs[localName] = attributes.getValue(i);
    }

    // Create element
    const element: MutableElement = {
      type: "element",
      name: xmlName,
      attributes: attrs,
      children: [],
    };

    // Add to parent or set as root
    if (this.#stack.length > 0) {
      this.#stack[this.#stack.length - 1]!.children.push(element as XmlElement);
    } else if (!this.#root) {
      this.#root = element;
    }

    // Push to stack if not self-closing
    if (!selfClosing) {
      this.#stack.push(element);
    }

    // Track for onEndElement
    this.#lastSelfClosing = selfClosing;
  }

  onEndElement(
    name: string,
    colonIndex: number,
    line: number,
    column: number,
    _offset: number,
  ): void {
    // For self-closing elements, the parser calls onEndElement immediately
    // after onStartElement, but we didn't push to stack, so don't pop
    if (this.#lastSelfClosing) {
      this.#lastSelfClosing = false;
      return;
    }

    const expected = this.#stack.pop();
    if (!expected) {
      throw new XmlSyntaxError(
        `Unexpected closing tag </${name}>`,
        { line, column, offset: 0 },
      );
    }

    // Validate tag match
    const expectedLocal = expected.name.local;
    const expectedPrefix = expected.name.prefix;
    const actualLocal = colonIndex === -1 ? name : name.slice(colonIndex + 1);
    const actualPrefix = colonIndex === -1
      ? undefined
      : name.slice(0, colonIndex);

    if (expectedLocal !== actualLocal || expectedPrefix !== actualPrefix) {
      const expectedFull = expectedPrefix
        ? `${expectedPrefix}:${expectedLocal}`
        : expectedLocal;
      throw new XmlSyntaxError(
        `Mismatched closing tag: expected </${expectedFull}> but found </${name}>`,
        { line, column, offset: 0 },
      );
    }
  }

  onText(
    text: string,
    _line: number,
    _column: number,
    _offset: number,
  ): void {
    // ignoreWhitespace is handled by the parser, but double-check
    if (this.#ignoreWhitespace && /^[ \t\r\n]*$/.test(text)) return;

    const node: XmlTextNode = { type: "text", text };
    if (this.#stack.length > 0) {
      this.#stack[this.#stack.length - 1]!.children.push(node);
    }
  }

  onCData(
    text: string,
    _line: number,
    _column: number,
    _offset: number,
  ): void {
    const node: XmlCDataNode = { type: "cdata", text };
    if (this.#stack.length > 0) {
      this.#stack[this.#stack.length - 1]!.children.push(node);
    }
  }

  onComment(
    text: string,
    _line: number,
    _column: number,
    _offset: number,
  ): void {
    if (this.#ignoreComments) return;

    const node: XmlCommentNode = { type: "comment", text };
    if (this.#stack.length > 0) {
      this.#stack[this.#stack.length - 1]!.children.push(node);
    }
  }

  // Processing instructions are ignored for tree building (consistent with _parse_sync.ts)
  onProcessingInstruction(): void {
    // Ignored
  }
}

/**
 * Parses an XML string using the callback-based architecture.
 *
 * This function uses the optimized tokenizer and parser chain to build
 * the document tree, sharing code with the streaming parser.
 *
 * @param xml The XML string to parse.
 * @param options Options to control parsing behavior.
 * @returns The parsed document.
 */
export function parseWithCallbacks(
  xml: string,
  options?: ParseOptions,
): XmlDocument {
  const trackPosition = options?.trackPosition ?? true;

  // Normalize line endings (XML 1.0 §2.11)
  const input = xml.includes("\r") ? xml.replace(LINE_ENDING_RE, "\n") : xml;

  // Create the callback chain
  const builder = new XmlDocumentBuilder(options);
  const tokenizer = new XmlTokenizer({ trackPosition });
  const parser = new XmlEventParser(builder, options);

  // Process entire input at once
  tokenizer.process(input, parser);
  tokenizer.finalize(parser);
  parser.finalize();

  return builder.getDocument();
}
