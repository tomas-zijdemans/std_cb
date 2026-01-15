// Copyright 2018-2026 the Deno authors. MIT license.
// This module is browser compatible.

/**
 * Internal XML parser module.
 *
 * Transforms raw tokens from the tokenizer into high-level events,
 * handling namespace prefixes, entity decoding, and well-formedness validation.
 *
 * Uses a callback-based API for zero-allocation streaming.
 *
 * @module
 */

import type {
  ParseStreamOptions,
  XmlAttributeIterator,
  XmlEventCallbacks,
  XmlTokenCallbacks,
} from "./types.ts";
import { XmlSyntaxError } from "./types.ts";
import { decodeEntities } from "./_entities.ts";
import { WHITESPACE_ONLY_RE } from "./_common.ts";

/**
 * Normalizes attribute value per XML 1.0 §3.3.3.
 *
 * Per the specification:
 * - Literal whitespace (#x9, #xA) is replaced with space (#x20)
 * - Character references to whitespace (&#9;, &#10;, etc.) are preserved
 *
 * Note: #xD (carriage return) has been converted to #xA by line-ending
 * normalization in the tokenizer (§2.11), so we only need to handle #xA and #x9.
 *
 * @see {@link https://www.w3.org/TR/xml/#AVNormalize | XML 1.0 §3.3.3 Attribute-Value Normalization}
 *
 * @param raw The raw attribute value from the tokenizer.
 * @returns The normalized and entity-decoded attribute value.
 */
function normalizeAttributeValue(raw: string): string {
  // Step 1: Replace literal whitespace with space per §3.3.3
  // This is done BEFORE entity decoding to preserve char refs like &#10;
  // Fast path: skip regex if no whitespace to normalize (common case)
  const normalized = raw.includes("\t") || raw.includes("\n")
    ? raw.replace(/[\t\n]/g, " ")
    : raw;

  // Step 2: Decode entities (&#10; becomes actual \n, preserving char refs)
  return decodeEntities(normalized);
}

/**
 * Reusable attribute iterator implementation.
 *
 * This class reuses internal arrays across elements to avoid allocations.
 * The iterator is valid only until the next element is processed.
 */
class AttributeIteratorImpl implements XmlAttributeIterator {
  #names: string[] = [];
  #values: string[] = [];
  #colonIndices: number[] = [];
  #count = 0;

  get count(): number {
    return this.#count;
  }

  getName(index: number): string {
    return this.#names[index]!;
  }

  getValue(index: number): string {
    return this.#values[index]!;
  }

  getColonIndex(index: number): number {
    return this.#colonIndices[index]!;
  }

  /** @internal Reset the iterator for a new element. */
  _reset(): void {
    this.#count = 0;
  }

  /** @internal Add an attribute (name already decoded, value raw). */
  _add(name: string, value: string): void {
    this.#names[this.#count] = name;
    this.#values[this.#count] = normalizeAttributeValue(value);
    this.#colonIndices[this.#count] = name.indexOf(":");
    this.#count++;
  }
}

/**
 * Stateful XML Event Parser.
 *
 * Implements {@linkcode XmlTokenCallbacks} to receive tokens from the tokenizer,
 * and emits events via {@linkcode XmlEventCallbacks}. This enables zero-allocation
 * streaming from tokenizer through parser to consumer.
 *
 * @example Basic usage
 * ```ts ignore
 * const parser = new XmlEventParser({
 *   onStartElement(name, colonIndex, attrs, selfClosing, line, col, offset) {
 *     console.log(`Element: ${name}`);
 *   },
 * });
 *
 * const tokenizer = new XmlTokenizer();
 * tokenizer.process("<root><item/></root>", parser);
 * tokenizer.finalize(parser);
 * parser.finalize();
 * ```
 */
export class XmlEventParser implements XmlTokenCallbacks {
  #callbacks: XmlEventCallbacks;
  #options: ParseStreamOptions;

  #elementStack: Array<{
    rawName: string;
    colonIndex: number;
    line: number;
    column: number;
    offset: number;
  }> = [];

  /** Pending element state (reused across elements). */
  #pendingName = "";
  #pendingColonIndex = -1;
  #pendingLine = 0;
  #pendingColumn = 0;
  #pendingOffset = 0;
  #hasPendingElement = false;

  /** Reusable attribute iterator. */
  #attrIterator = new AttributeIteratorImpl();

  /**
   * Constructs a new XmlEventParser.
   *
   * @param callbacks Callbacks to invoke for each event.
   * @param options Options for filtering and behavior.
   */
  constructor(callbacks: XmlEventCallbacks, options: ParseStreamOptions = {}) {
    this.#callbacks = callbacks;
    this.#options = options;
  }

  // ==========================================================================
  // XmlTokenCallbacks implementation
  // ==========================================================================

  onStartTagOpen(
    name: string,
    line: number,
    column: number,
    offset: number,
  ): void {
    this.#pendingName = name;
    this.#pendingColonIndex = name.indexOf(":");
    this.#pendingLine = line;
    this.#pendingColumn = column;
    this.#pendingOffset = offset;
    this.#hasPendingElement = true;
    this.#attrIterator._reset();
  }

  onAttribute(name: string, value: string): void {
    if (this.#hasPendingElement) {
      this.#attrIterator._add(name, value);
    }
  }

  onStartTagClose(selfClosing: boolean): void {
    if (this.#hasPendingElement) {
      this.#callbacks.onStartElement?.(
        this.#pendingName,
        this.#pendingColonIndex,
        this.#attrIterator,
        selfClosing,
        this.#pendingLine,
        this.#pendingColumn,
        this.#pendingOffset,
      );

      if (selfClosing) {
        this.#callbacks.onEndElement?.(
          this.#pendingName,
          this.#pendingColonIndex,
          this.#pendingLine,
          this.#pendingColumn,
          this.#pendingOffset,
        );
      } else {
        this.#elementStack.push({
          rawName: this.#pendingName,
          colonIndex: this.#pendingColonIndex,
          line: this.#pendingLine,
          column: this.#pendingColumn,
          offset: this.#pendingOffset,
        });
      }

      this.#hasPendingElement = false;
    }
  }

  onEndTag(
    name: string,
    line: number,
    column: number,
    offset: number,
  ): void {
    const expected = this.#elementStack.pop();
    if (expected === undefined) {
      throw new XmlSyntaxError(
        `Unexpected closing tag </${name}> with no matching opening tag`,
        { line, column, offset },
      );
    }
    if (expected.rawName !== name) {
      throw new XmlSyntaxError(
        `Mismatched closing tag: expected </${expected.rawName}> but found </${name}>`,
        { line, column, offset },
      );
    }

    this.#callbacks.onEndElement?.(
      name,
      expected.colonIndex,
      line,
      column,
      offset,
    );
  }

  onText(
    content: string,
    line: number,
    column: number,
    offset: number,
  ): void {
    const { ignoreWhitespace = false } = this.#options;
    const text = decodeEntities(content);

    if (ignoreWhitespace && WHITESPACE_ONLY_RE.test(text)) {
      return;
    }

    this.#callbacks.onText?.(text, line, column, offset);
  }

  onCData(
    content: string,
    line: number,
    column: number,
    offset: number,
  ): void {
    const { coerceCDataToText = false } = this.#options;

    if (coerceCDataToText) {
      this.#callbacks.onText?.(content, line, column, offset);
    } else {
      this.#callbacks.onCData?.(content, line, column, offset);
    }
  }

  onComment(
    content: string,
    line: number,
    column: number,
    offset: number,
  ): void {
    const { ignoreComments = false } = this.#options;

    if (ignoreComments) {
      return;
    }

    this.#callbacks.onComment?.(content, line, column, offset);
  }

  onProcessingInstruction(
    target: string,
    content: string,
    line: number,
    column: number,
    offset: number,
  ): void {
    const { ignoreProcessingInstructions = false } = this.#options;

    if (ignoreProcessingInstructions) {
      return;
    }

    this.#callbacks.onProcessingInstruction?.(
      target,
      content,
      line,
      column,
      offset,
    );
  }

  onDeclaration(
    version: string,
    encoding: string | undefined,
    standalone: "yes" | "no" | undefined,
    line: number,
    column: number,
    offset: number,
  ): void {
    this.#callbacks.onDeclaration?.(
      version,
      encoding,
      standalone,
      line,
      column,
      offset,
    );
  }

  onDoctype(
    _name: string,
    _publicId: string | undefined,
    _systemId: string | undefined,
    _line: number,
    _column: number,
    _offset: number,
  ): void {
    // DOCTYPE is parsed by tokenizer but not emitted as an event
    // (could add onDoctype to XmlEventCallbacks if needed in future)
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Finalize parsing and validate that all elements are closed.
   *
   * @throws {XmlSyntaxError} If there are unclosed elements.
   */
  finalize(): void {
    if (this.#elementStack.length > 0) {
      const unclosed = this.#elementStack[this.#elementStack.length - 1]!;
      throw new XmlSyntaxError(
        `Unclosed element <${unclosed.rawName}>`,
        unclosed,
      );
    }
  }
}
