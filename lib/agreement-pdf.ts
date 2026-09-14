import type { RentalAgreementView } from "@/lib/services/firestore-client";

/*
 * The agreement as a PDF, captured from the sheet that is
 * already on screen.
 *
 * The printed copy is the one the renter signs, so the PDF is
 * taken from the same markup rather than laid out a second
 * time: what is emailed and what comes out of the printer
 * cannot drift, because they are the same thing.
 *
 * Both libraries are pulled in only when a send actually
 * happens. They are large, and most of what the office does
 * never touches them.
 */
export type AgreementPdf = {
  filename: string;
  /** Base64 of the PDF bytes, ready for a MIME attachment. */
  base64: string;
  bytes: number;
};

/** A4 at 72dpi, the unit jsPDF lays pages out in. */
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 18;

export function agreementFilename(
  agreement: RentalAgreementView,
): string {
  const registration =
    agreement.vehicle.registration.replace(
      /[^A-Za-z0-9-]+/g,
      "",
    ) || "vehicle";

  const renter =
    agreement.renter.fullName
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "renter";

  return `rental-agreement-${registration}-${renter}.pdf`;
}

/*
 * Every page of the sheet becomes one page of the PDF. The
 * sheet is rendered at a fixed width so the capture does not
 * depend on the size of the window the operator happens to
 * have open, and at twice the scale so the text survives.
 */
export async function agreementPdf(
  sheet: HTMLElement,
  agreement: RentalAgreementView,
): Promise<AgreementPdf> {
  const [{ default: html2canvas }, { jsPDF }] =
    await Promise.all([
      import("html2canvas-pro"),
      import("jspdf"),
    ]);

  const pages = Array.from(
    sheet.querySelectorAll<HTMLElement>(
      ".sheet-page",
    ),
  );

  if (pages.length === 0) {
    throw new Error(
      "The agreement is still loading. Wait for it to appear and try again.",
    );
  }

  const pdf = new jsPDF({
    unit: "pt",
    format: "a4",
    orientation: "portrait",
    compress: true,
  });

  for (const [index, page] of pages.entries()) {
    const canvas = await html2canvas(page, {
      scale: 2,

      /* The condition photos come from Cloudinary; without
         this they would be dropped from the capture. */
      useCORS: true,

      backgroundColor: "#ffffff",
      logging: false,

      /* Wide enough that the sheet keeps the form's two
         columns rather than collapsing to the narrow
         layout. */
      windowWidth: 1200,
    });

    const usableWidth = PAGE_WIDTH - MARGIN * 2;

    const height =
      (canvas.height / canvas.width) *
      usableWidth;

    if (index > 0) {
      pdf.addPage();
    }

    /*
     * A page taller than the sheet is sliced across as many
     * PDF pages as it needs, so a long terms page is never
     * silently cut off at the bottom.
     */
    const usableHeight =
      PAGE_HEIGHT - MARGIN * 2;

    if (height <= usableHeight) {
      pdf.addImage(
        canvas.toDataURL("image/jpeg", 0.92),
        "JPEG",
        MARGIN,
        MARGIN,
        usableWidth,
        height,
      );

      continue;
    }

    const sliceHeightPx = Math.floor(
      (usableHeight / usableWidth) *
        canvas.width,
    );

    for (
      let top = 0, slice = 0;
      top < canvas.height;
      top += sliceHeightPx, slice += 1
    ) {
      const pixels = Math.min(
        sliceHeightPx,
        canvas.height - top,
      );

      const part =
        document.createElement("canvas");

      part.width = canvas.width;
      part.height = pixels;

      const context = part.getContext("2d");

      if (!context) {
        throw new Error(
          "This browser could not render the agreement to a PDF.",
        );
      }

      context.fillStyle = "#ffffff";

      context.fillRect(
        0,
        0,
        part.width,
        part.height,
      );

      context.drawImage(
        canvas,
        0,
        top,
        canvas.width,
        pixels,
        0,
        0,
        canvas.width,
        pixels,
      );

      if (slice > 0) {
        pdf.addPage();
      }

      pdf.addImage(
        part.toDataURL("image/jpeg", 0.92),
        "JPEG",
        MARGIN,
        MARGIN,
        usableWidth,
        (pixels / canvas.width) * usableWidth,
      );
    }
  }

  const buffer = pdf.output(
    "arraybuffer",
  ) as ArrayBuffer;

  return {
    filename: agreementFilename(agreement),
    base64: base64Of(buffer),
    bytes: buffer.byteLength,
  };
}

/*
 * `btoa` takes a binary string, and building one with spread
 * or `String.fromCharCode(...bytes)` overflows the call stack
 * on a PDF of any size, so the bytes are walked in chunks.
 */
export function base64Of(
  buffer: ArrayBuffer,
): string {
  const bytes = new Uint8Array(buffer);

  let binary = "";

  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, i + 0x8000),
    );
  }

  return btoa(binary);
}
