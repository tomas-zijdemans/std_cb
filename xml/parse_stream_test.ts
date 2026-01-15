// Copyright 2018-2026 the Deno authors. MIT license.

import { assertEquals, assertRejects } from "@std/assert";
import {
  parseXmlStream,
  parseXmlStreamFromBytes,
  XmlParseStream,
} from "./parse_stream.ts";
import type { XmlEvent } from "./types.ts";
import { XmlSyntaxError } from "./types.ts";

/** Helper to collect all events from a stream (flattens batches). */
async function collectEvents(
  xml: string | string[],
  options?: ConstructorParameters<typeof XmlParseStream>[0],
): Promise<XmlEvent[]> {
  const chunks = typeof xml === "string" ? [xml] : xml;
  const stream = ReadableStream.from(chunks)
    .pipeThrough(new XmlParseStream(options));
  const batches = await Array.fromAsync(stream);
  return batches.flat();
}

// =============================================================================
// Chunked Input (Stream-Specific)
// =============================================================================

Deno.test("XmlParseStream handles multiple chunks", async () => {
  const events = await collectEvents(["<root>", "Hello", "</root>"]);

  assertEquals(events.length, 3);
  assertEquals(events[0]!.type, "start_element");
  assertEquals(events[1]!.type, "text");
  assertEquals(events[2]!.type, "end_element");
});

Deno.test("XmlParseStream handles tag split across chunks", async () => {
  const events = await collectEvents(["<ro", "ot></root>"]);

  assertEquals(events.length, 2);
  if (events[0]!.type === "start_element") {
    assertEquals(events[0]!.name.local, "root");
  }
});

Deno.test("XmlParseStream handles attribute split across chunks", async () => {
  const events = await collectEvents(['<item id="12', '3"/>']);

  assertEquals(events[0]!.type, "start_element");
  if (events[0]!.type === "start_element") {
    assertEquals(events[0]!.attributes[0]!.value, "123");
  }
});

Deno.test("XmlParseStream handles many small chunks", async () => {
  const xml = "<root><item>content</item></root>";
  const chunks = xml.split(""); // One character per chunk
  const events = await collectEvents(chunks);

  assertEquals(events.length, 5);
});

Deno.test("XmlParseStream handles empty chunks", async () => {
  const events = await collectEvents(["", "<root/>", ""]);

  assertEquals(events.length, 2);
});

// =============================================================================
// Error Handling (Stream-Specific)
// =============================================================================

Deno.test("XmlParseStream throws on malformed XML", async () => {
  await assertRejects(
    () => collectEvents("<root attr=value/>"),
    XmlSyntaxError,
  );
});

// =============================================================================
// Complex Documents (Integration)
// =============================================================================

Deno.test("XmlParseStream handles RSS-like feed", async () => {
  const xml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example Feed</title>
    <item>
      <title>Item 1</title>
    </item>
  </channel>
</rss>`;

  const events = await collectEvents(xml, { ignoreWhitespace: true });

  const startElements = events.filter((e) => e.type === "start_element");
  const names = startElements.map((e) =>
    e.type === "start_element" ? e.name.local : ""
  );

  assertEquals(names, ["rss", "channel", "title", "item", "title"]);
});

// =============================================================================
// Direct API Usage (Stream-Specific)
// =============================================================================

Deno.test("XmlParseStream writable can be used directly", async () => {
  const stream = new XmlParseStream();
  const writer = stream.writable.getWriter();
  const events: XmlEvent[] = [];

  // Collect event batches in background
  const reader = stream.readable.getReader();
  const readPromise = (async () => {
    while (true) {
      const { done, value: batch } = await reader.read();
      if (done) break;
      events.push(...batch);
    }
  })();

  // Write XML
  await writer.write("<root>");
  await writer.write("<item/>");
  await writer.write("</root>");
  await writer.close();

  await readPromise;

  assertEquals(events.length, 4); // start root, start item, end item, end root
});

Deno.test("XmlParseStream readable can be iterated", async () => {
  const xml = "<root><a/><b/><c/></root>";
  const stream = ReadableStream.from([xml])
    .pipeThrough(new XmlParseStream());

  const events: XmlEvent[] = [];
  for await (const batch of stream) {
    events.push(...batch);
  }

  assertEquals(events.length, 8); // start/end for root, a, b, c
});

// =============================================================================
// File-based Tests (testdata/)
// =============================================================================

Deno.test({
  name: "XmlParseStream parses simple.xml testdata",
  async fn() {
    const url = new URL("./testdata/simple.xml", import.meta.url);
    const { body } = await fetch(url);
    const stream = body!
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new XmlParseStream({ ignoreWhitespace: true }));

    const events = (await Array.fromAsync(stream)).flat();

    // Check declaration
    assertEquals(events[0]!.type, "declaration");
    if (events[0]!.type === "declaration") {
      assertEquals(events[0]!.version, "1.0");
      assertEquals(events[0]!.encoding, "UTF-8");
    }

    // Count elements
    const startElements = events.filter((e) => e.type === "start_element");
    assertEquals(startElements.length, 7); // catalog, 2x(product, name, price)
  },
});

Deno.test({
  name: "XmlParseStream parses rss.xml testdata",
  async fn() {
    const url = new URL("./testdata/rss.xml", import.meta.url);
    const { body } = await fetch(url);
    const stream = body!
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new XmlParseStream({ ignoreWhitespace: true }));

    const events = (await Array.fromAsync(stream)).flat();

    // Find all item titles
    const titles: string[] = [];
    let inItemTitle = false;
    for (const event of events) {
      if (
        event.type === "start_element" && event.name.local === "title" &&
        events.some((e) =>
          e.type === "start_element" && e.name.local === "item"
        )
      ) {
        inItemTitle = true;
      } else if (event.type === "text" && inItemTitle) {
        titles.push(event.text);
        inItemTitle = false;
      }
    }

    // RSS has 3 items
    const itemStarts = events.filter((e) =>
      e.type === "start_element" && e.name.local === "item"
    );
    assertEquals(itemStarts.length, 3);
  },
});

Deno.test({
  name: "XmlParseStream parses namespaced.xml testdata",
  async fn() {
    const url = new URL("./testdata/namespaced.xml", import.meta.url);
    const { body } = await fetch(url);
    const stream = body!
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new XmlParseStream({ ignoreWhitespace: true }));

    const events = (await Array.fromAsync(stream)).flat();

    // Find namespaced elements
    const gElements = events.filter((e) =>
      e.type === "start_element" && e.name.prefix === "g"
    );

    // 2 entries × 4 g: prefixed elements = 8
    assertEquals(gElements.length, 8);
  },
});

Deno.test({
  name: "XmlParseStream parses cdata.xml testdata",
  async fn() {
    const url = new URL("./testdata/cdata.xml", import.meta.url);
    const { body } = await fetch(url);
    const stream = body!
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new XmlParseStream({ ignoreWhitespace: true }));

    const events = (await Array.fromAsync(stream)).flat();

    // Find CDATA sections
    const cdataEvents = events.filter((e) => e.type === "cdata");
    assertEquals(cdataEvents.length, 3); // script, style, data

    // Verify CDATA content preserved special characters
    const dataContent = cdataEvents.find((e) =>
      e.type === "cdata" && e.text.includes("special")
    );
    assertEquals(
      dataContent?.type === "cdata" ? dataContent.text : "",
      'Raw content with <special> & "characters"',
    );
  },
});

Deno.test({
  name: "XmlParseStream parses entities.xml testdata",
  async fn() {
    const url = new URL("./testdata/entities.xml", import.meta.url);
    const { body } = await fetch(url);
    const stream = body!
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new XmlParseStream({ ignoreWhitespace: true }));

    const events = (await Array.fromAsync(stream)).flat();

    // Find the <mixed> element's text content
    let inMixed = false;
    let mixedText = "";
    for (const event of events) {
      if (event.type === "start_element" && event.name.local === "mixed") {
        inMixed = true;
      } else if (event.type === "text" && inMixed) {
        mixedText = event.text;
        inMixed = false;
      }
    }

    // Entities should be decoded
    assertEquals(mixedText, "Tom & Jerry <3");
  },
});

Deno.test({
  name: "XmlParseStream parses large.xml testdata (performance)",
  async fn() {
    const url = new URL("./testdata/large.xml", import.meta.url);
    const { body } = await fetch(url);
    const stream = body!
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new XmlParseStream({ ignoreWhitespace: true }));

    const events = (await Array.fromAsync(stream)).flat();

    // Count product elements (should be 1000)
    const productStarts = events.filter((e) =>
      e.type === "start_element" && e.name.local === "product"
    );
    assertEquals(productStarts.length, 1000);
  },
});

Deno.test({
  name: "XmlParseStream rejects malformed/unclosed.xml testdata",
  async fn() {
    const url = new URL("./testdata/malformed/unclosed.xml", import.meta.url);
    const { body } = await fetch(url);
    const stream = body!
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new XmlParseStream());

    await assertRejects(
      async () => await Array.fromAsync(stream),
      XmlSyntaxError,
    );
  },
});

Deno.test({
  name: "XmlParseStream rejects malformed/mismatched.xml testdata",
  async fn() {
    const url = new URL("./testdata/malformed/mismatched.xml", import.meta.url);
    const { body } = await fetch(url);
    const stream = body!
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new XmlParseStream());

    await assertRejects(
      async () => await Array.fromAsync(stream),
      XmlSyntaxError,
      "Mismatched closing tag",
    );
  },
});

// =============================================================================
// Coverage: flush() producing events
// =============================================================================

Deno.test("XmlParseStream flush produces remaining tokens as events", async () => {
  // When the last chunk ends mid-text, flush() should produce remaining events
  // Tests lines 127-132 in parse_stream.ts - flush path with events
  const events = await collectEvents(["<root>hello", " world</root>"]);

  assertEquals(events.length, 3);
  assertEquals(events[0]!.type, "start_element");
  assertEquals(events[1]!.type, "text");
  if (events[1]!.type === "text") {
    assertEquals(events[1]!.text, "hello world");
  }
  assertEquals(events[2]!.type, "end_element");
});

Deno.test("XmlParseStream handles text split at chunk boundary", async () => {
  // Text content that spans chunk boundary - finalize will flush remaining text
  const events = await collectEvents(["<r>hel", "lo</r>"]);

  assertEquals(events.length, 3);
  assertEquals(events[0]!.type, "start_element");
  assertEquals(events[1]!.type, "text");
  if (events[1]!.type === "text") {
    assertEquals(events[1]!.text, "hello");
  }
  assertEquals(events[2]!.type, "end_element");
});

// =============================================================================
// Flush produces events tests
// =============================================================================

Deno.test("XmlParseStream flush produces events from buffered text", async () => {
  // Test that flush() produces events when text is buffered at stream end.
  // The key is: trailing text with NO subsequent '<' stays in tokenizer buffer
  // until flush() is called, which then emits it.
  const stream = new XmlParseStream();
  const writer = stream.writable.getWriter();

  const events: XmlEvent[] = [];
  const readPromise = (async () => {
    for await (const batch of stream.readable) {
      events.push(...batch);
    }
  })();

  // Write self-closing element, then trailing text (no '<' after)
  // The trailing text stays buffered until flush() emits it
  await writer.write("<root/>");
  await writer.write("trailing");
  await writer.close();

  await readPromise;

  assertEquals(events.length, 3);
  assertEquals(events[0]!.type, "start_element");
  assertEquals(events[1]!.type, "end_element");
  assertEquals(events[2]!.type, "text");
  if (events[2]!.type === "text") {
    assertEquals(events[2]!.text, "trailing");
  }
});

// =============================================================================
// parseXmlStream (Direct Callback API)
// =============================================================================

Deno.test("parseXmlStream() basic usage", async () => {
  const xml = "<root><item>Hello</item></root>";
  const stream = ReadableStream.from([xml]);

  const elements: string[] = [];
  const texts: string[] = [];

  await parseXmlStream(stream, {
    onStartElement(name) {
      elements.push(name);
    },
    onText(text) {
      texts.push(text);
    },
  });

  assertEquals(elements, ["root", "item"]);
  assertEquals(texts, ["Hello"]);
});

Deno.test("parseXmlStream() handles chunked input", async () => {
  const stream = ReadableStream.from(["<root>", "Hello", "</root>"]);

  const elements: string[] = [];
  const texts: string[] = [];

  await parseXmlStream(stream, {
    onStartElement(name) {
      elements.push(name);
    },
    onEndElement(name) {
      elements.push(`/${name}`);
    },
    onText(text) {
      texts.push(text);
    },
  });

  assertEquals(elements, ["root", "/root"]);
  assertEquals(texts, ["Hello"]);
});

Deno.test("parseXmlStream() handles attributes via iterator", async () => {
  const xml = '<root id="1" class="test"><item name="foo"/></root>';
  const stream = ReadableStream.from([xml]);

  const attrs: Array<{ name: string; value: string }> = [];

  await parseXmlStream(stream, {
    onStartElement(_name, _colonIndex, attributes) {
      for (let i = 0; i < attributes.count; i++) {
        attrs.push({
          name: attributes.getName(i),
          value: attributes.getValue(i),
        });
      }
    },
  });

  assertEquals(attrs, [
    { name: "id", value: "1" },
    { name: "class", value: "test" },
    { name: "name", value: "foo" },
  ]);
});

Deno.test("parseXmlStream() handles namespaced elements", async () => {
  const xml = '<ns:root xmlns:ns="http://example.com"><ns:item/></ns:root>';
  const stream = ReadableStream.from([xml]);

  const elements: Array<{ name: string; prefix?: string }> = [];

  await parseXmlStream(stream, {
    onStartElement(name, colonIndex) {
      if (colonIndex === -1) {
        elements.push({ name });
      } else {
        elements.push({
          name: name.slice(colonIndex + 1),
          prefix: name.slice(0, colonIndex),
        });
      }
    },
  });

  assertEquals(elements, [
    { name: "root", prefix: "ns" },
    { name: "item", prefix: "ns" },
  ]);
});

Deno.test("parseXmlStream() handles position tracking", async () => {
  const xml = "<root><item/></root>";
  const stream = ReadableStream.from([xml]);

  const positions: Array<{ name: string; line: number; column: number }> = [];

  await parseXmlStream(
    stream,
    {
      onStartElement(name, _colonIndex, _attrs, _selfClosing, line, column) {
        positions.push({ name, line, column });
      },
    },
    { trackPosition: true },
  );

  assertEquals(positions, [
    { name: "root", line: 1, column: 1 },
    { name: "item", line: 1, column: 7 },
  ]);
});

Deno.test("parseXmlStream() handles CDATA and comments", async () => {
  const xml = "<root><![CDATA[data]]><!-- comment --></root>";
  const stream = ReadableStream.from([xml]);

  const events: Array<{ type: string; text: string }> = [];

  await parseXmlStream(stream, {
    onCData(text) {
      events.push({ type: "cdata", text });
    },
    onComment(text) {
      events.push({ type: "comment", text });
    },
  });

  assertEquals(events, [
    { type: "cdata", text: "data" },
    { type: "comment", text: " comment " },
  ]);
});

Deno.test("parseXmlStream() handles declaration", async () => {
  const xml = '<?xml version="1.0" encoding="UTF-8"?><root/>';
  const stream = ReadableStream.from([xml]);

  let decl: { version: string; encoding?: string } | undefined;

  await parseXmlStream(stream, {
    onDeclaration(version, encoding) {
      decl = { version, encoding };
    },
  });

  assertEquals(decl, { version: "1.0", encoding: "UTF-8" });
});

Deno.test("parseXmlStream() ignores whitespace when configured", async () => {
  const xml = "<root>\n  <item/>\n</root>";
  const stream = ReadableStream.from([xml]);

  const texts: string[] = [];

  await parseXmlStream(
    stream,
    {
      onText(text) {
        texts.push(text);
      },
    },
    { ignoreWhitespace: true },
  );

  assertEquals(texts, []);
});

Deno.test("parseXmlStream() throws on malformed XML", async () => {
  const xml = "<root attr=value/>";
  const stream = ReadableStream.from([xml]);

  await assertRejects(
    () => parseXmlStream(stream, {}),
    XmlSyntaxError,
  );
});

Deno.test("parseXmlStream() accepts AsyncIterable", async () => {
  async function* generateChunks(): AsyncGenerator<string> {
    yield "<root>";
    yield "<item/>";
    yield "</root>";
  }

  const elements: string[] = [];

  await parseXmlStream(generateChunks(), {
    onStartElement(name) {
      elements.push(name);
    },
  });

  assertEquals(elements, ["root", "item"]);
});

// =============================================================================
// parseXmlStreamFromBytes
// =============================================================================

Deno.test("parseXmlStreamFromBytes() handles byte stream", async () => {
  const xml = "<root><item>Hello</item></root>";
  const bytes = new TextEncoder().encode(xml);
  const stream = ReadableStream.from([bytes]);

  const elements: string[] = [];

  await parseXmlStreamFromBytes(stream, {
    onStartElement(name) {
      elements.push(name);
    },
  });

  assertEquals(elements, ["root", "item"]);
});

Deno.test("parseXmlStreamFromBytes() handles multi-byte characters", async () => {
  const xml = "<root>Hello 世界 🌍</root>";
  const bytes = new TextEncoder().encode(xml);
  // Split bytes to test streaming decode
  const chunk1 = bytes.slice(0, 15);
  const chunk2 = bytes.slice(15);
  const stream = ReadableStream.from([chunk1, chunk2]);

  const texts: string[] = [];

  await parseXmlStreamFromBytes(stream, {
    onText(text) {
      texts.push(text);
    },
  });

  assertEquals(texts.join(""), "Hello 世界 🌍");
});
