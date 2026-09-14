import { describe, expect, it } from "vitest";

import { buildMimeMessage } from "../../lib/services/gmail-sender";

import { base64Of } from "../../lib/agreement-pdf";

/*
 * The message Gmail is handed.
 *
 * Gmail takes a raw RFC 2822 message, so anything malformed
 * here reaches a renter as a broken email or as no email at
 * all. The parts that can actually go wrong are the ones
 * checked: the boundary, the encodings, and the headers a
 * person's name can end up in.
 */
const attachment = {
  filename: "rental-agreement-RT-900-Riley.pdf",
  base64: btoa("%PDF-1.4 pretend bytes"),
};

function partsOf(mime: string): {
  headers: string;
  boundary: string;
  sections: string[];
} {
  const boundary = /boundary="([^"]+)"/.exec(
    mime,
  )?.[1];

  if (!boundary) {
    throw new Error("no boundary in message");
  }

  const [headers, ...sections] = mime.split(
    `--${boundary}`,
  );

  return { headers, boundary, sections };
}

describe("the message handed to Gmail", () => {
  const mime = buildMimeMessage({
    to: "riley@example.test",
    subject:
      "Rental agreement rent_1 - RT-900",
    body: "RENTAL AGREEMENT\nTOTAL: $360.00",
    attachment,
  });

  it("addresses the renter and carries both parts", () => {
    const { headers, sections } =
      partsOf(mime);

    expect(headers).toContain(
      "To: riley@example.test",
    );

    expect(headers).toContain(
      "Subject: Rental agreement rent_1 - RT-900",
    );

    expect(headers).toContain(
      "Content-Type: multipart/mixed",
    );

    /* A body part, an attachment part, and the closing
       delimiter. */
    expect(sections).toHaveLength(3);
    expect(sections.at(-1)?.trim()).toBe("--");
  });

  it("attaches the agreement as a PDF, named", () => {
    const { sections } = partsOf(mime);
    const part = sections[1];

    expect(part).toContain(
      "Content-Type: application/pdf",
    );

    expect(part).toContain(
      'Content-Disposition: attachment; filename="rental-agreement-RT-900-Riley.pdf"',
    );

    expect(part).toContain(
      "Content-Transfer-Encoding: base64",
    );

    /* The bytes survive the trip. */
    const encoded = part
      .slice(part.indexOf("\r\n\r\n") + 4)
      .trim()
      .replace(/\r\n/g, "");

    expect(atob(encoded)).toBe(
      "%PDF-1.4 pretend bytes",
    );
  });

  it("uses CRLF line endings throughout", () => {
    /* A bare newline ends the message early for some
       servers, dropping the attachment silently. */
    expect(mime.replace(/\r\n/g, "")).not.toContain(
      "\n",
    );
  });

  it("folds base64 at 76 characters", () => {
    const long = buildMimeMessage({
      to: "riley@example.test",
      subject: "Long",
      body: "x",

      attachment: {
        filename: "a.pdf",
        base64: "A".repeat(500),
      },
    });

    const lines = long.split("\r\n");

    for (const line of lines) {
      expect(
        line.length,
      ).toBeLessThanOrEqual(998);
    }

    expect(
      lines.filter(
        (line) => line === "A".repeat(76),
      ).length,
    ).toBe(6);
  });

  it("encodes a body that is not plain ASCII", () => {
    const accented = buildMimeMessage({
      to: "renée@example.test",
      subject: "Agreement — RT-900",
      body: "Gas out: ¼ tank",
      attachment,
    });

    const { headers, sections } =
      partsOf(accented);

    /* An encoded-word, not the raw bytes. */
    expect(headers).toContain("=?UTF-8?B?");
    expect(headers).not.toContain("—");

    const body = sections[0]
      .slice(sections[0].indexOf("\r\n\r\n") + 4)
      .trim()
      .replace(/\r\n/g, "");

    expect(
      new TextDecoder().decode(
        Uint8Array.from(atob(body), (c) =>
          c.charCodeAt(0),
        ),
      ),
    ).toBe("Gas out: ¼ tank");
  });

  /*
   * A newline in a header would end the header block early
   * and let whatever follows be read as more headers — an
   * extra Bcc, say. Renter names reach the subject line, so
   * this is reachable from data a customer supplies.
   */
  it("refuses to let a header break out of its line", () => {
    const injected = buildMimeMessage({
      to: "riley@example.test",
      subject:
        "Agreement\r\nBcc: attacker@example.test",
      body: "x",
      attachment,
    });

    const { headers } = partsOf(injected);

    /* It survives as text on the subject line, which is
       harmless — what matters is that no line of its own
       begins a Bcc header. */
    expect(
      headers
        .split("\r\n")
        .some((line) =>
          line.startsWith("Bcc:"),
        ),
    ).toBe(false);

    expect(headers).toContain(
      "Subject: Agreement Bcc: attacker@example.test",
    );
  });

  it("strips quotes and newlines from the filename", () => {
    const odd = buildMimeMessage({
      to: "riley@example.test",
      subject: "x",
      body: "x",

      attachment: {
        filename: 'a"\r\nb.pdf',
        base64: attachment.base64,
      },
    });

    expect(odd).toContain(
      'filename="ab.pdf"',
    );
  });

  it("gives every message its own boundary", () => {
    const again = buildMimeMessage({
      to: "riley@example.test",
      subject: "x",
      body: "x",
      attachment,
    });

    expect(partsOf(again).boundary).not.toBe(
      partsOf(mime).boundary,
    );
  });
});

describe("encoding the PDF for transport", () => {
  it("round-trips bytes", () => {
    const bytes = Uint8Array.from(
      { length: 1000 },
      (_, i) => i % 256,
    );

    const decoded = Uint8Array.from(
      atob(base64Of(bytes.buffer)),
      (c) => c.charCodeAt(0),
    );

    expect(decoded).toEqual(bytes);
  });

  /*
   * The chunking exists because spreading a whole PDF into
   * String.fromCharCode overflows the call stack. A real
   * agreement is comfortably past the 32 KB chunk size.
   */
  it("survives a buffer far larger than one chunk", () => {
    const bytes = new Uint8Array(300_000);

    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = i % 251;
    }

    const encoded = base64Of(bytes.buffer);

    expect(encoded.length).toBeGreaterThan(
      395_000,
    );

    const decoded = Uint8Array.from(
      atob(encoded),
      (c) => c.charCodeAt(0),
    );

    expect(decoded.length).toBe(bytes.length);
    expect(decoded[299_999]).toBe(
      bytes[299_999],
    );
  });
});
