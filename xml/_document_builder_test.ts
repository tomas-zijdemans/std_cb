// Copyright 2018-2026 the Deno authors. MIT license.

import { assertEquals } from "@std/assert";
import { parse } from "./parse.ts";
import { parseWithCallbacks } from "./_document_builder.ts";

/**
 * Tests that parseWithCallbacks produces identical output to parse().
 */

Deno.test("parseWithCallbacks() matches parse() for simple document", () => {
  const xml = `<?xml version="1.0"?><root><item id="1">Hello</item></root>`;

  const expected = parse(xml);
  const actual = parseWithCallbacks(xml);

  assertEquals(actual, expected);
});

Deno.test("parseWithCallbacks() matches parse() for nested elements", () => {
  const xml = `<root><a><b><c>deep</c></b></a></root>`;

  const expected = parse(xml);
  const actual = parseWithCallbacks(xml);

  assertEquals(actual, expected);
});

Deno.test("parseWithCallbacks() matches parse() for multiple attributes", () => {
  const xml = `<item id="123" class="test" data-value="foo">content</item>`;

  const expected = parse(xml);
  const actual = parseWithCallbacks(xml);

  assertEquals(actual, expected);
});

Deno.test("parseWithCallbacks() matches parse() for namespaced elements", () => {
  const xml = `<ns:root xmlns:ns="http://example.com"><ns:item ns:id="1"/></ns:root>`;

  const expected = parse(xml);
  const actual = parseWithCallbacks(xml);

  assertEquals(actual, expected);
});

Deno.test("parseWithCallbacks() matches parse() for CDATA", () => {
  const xml = `<root><![CDATA[<not>xml</not>]]></root>`;

  const expected = parse(xml);
  const actual = parseWithCallbacks(xml);

  assertEquals(actual, expected);
});

Deno.test("parseWithCallbacks() matches parse() for comments", () => {
  const xml = `<root><!-- comment --><item/></root>`;

  const expected = parse(xml);
  const actual = parseWithCallbacks(xml);

  assertEquals(actual, expected);
});

Deno.test("parseWithCallbacks() matches parse() with ignoreWhitespace", () => {
  const xml = `<root>
    <item/>
  </root>`;

  const expected = parse(xml, { ignoreWhitespace: true });
  const actual = parseWithCallbacks(xml, { ignoreWhitespace: true });

  assertEquals(actual, expected);
});

Deno.test("parseWithCallbacks() matches parse() with ignoreComments", () => {
  const xml = `<root><!-- comment --><item/></root>`;

  const expected = parse(xml, { ignoreComments: true });
  const actual = parseWithCallbacks(xml, { ignoreComments: true });

  assertEquals(actual, expected);
});

Deno.test("parseWithCallbacks() matches parse() without position tracking", () => {
  const xml = `<root><item>text</item></root>`;

  const expected = parse(xml, { trackPosition: false });
  const actual = parseWithCallbacks(xml, { trackPosition: false });

  assertEquals(actual, expected);
});

Deno.test("parseWithCallbacks() matches parse() for entities", () => {
  const xml = `<root>&lt;tag&gt; &amp; &quot;quoted&quot;</root>`;

  const expected = parse(xml);
  const actual = parseWithCallbacks(xml);

  assertEquals(actual, expected);
});

Deno.test("parseWithCallbacks() matches parse() for self-closing tags", () => {
  const xml = `<root><br/><hr/><input type="text"/></root>`;

  const expected = parse(xml);
  const actual = parseWithCallbacks(xml);

  assertEquals(actual, expected);
});

Deno.test("parseWithCallbacks() matches parse() for RSS feed", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Item 1</title>
      <description><![CDATA[<b>Bold</b> text]]></description>
    </item>
  </channel>
</rss>`;

  const expected = parse(xml, { ignoreWhitespace: true });
  const actual = parseWithCallbacks(xml, { ignoreWhitespace: true });

  assertEquals(actual, expected);
});
