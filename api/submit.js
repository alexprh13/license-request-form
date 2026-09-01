import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function safeText(value) {
  return String(value ?? "")
    .replace(/[^\x20-\x7E]/g, " ")
    .trim();
}

function safeNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    return 0;
  }

  return number;
}

function formatDate(value) {
  if (!value) return "";

  const parts = value.split("-");

  if (parts.length !== 3) return safeText(value);

  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function escapeHtml(value) {
  return safeText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not configured.");
    }

    if (!process.env.LICENSE_REQUEST_TO) {
      throw new Error("LICENSE_REQUEST_TO is not configured.");
    }

    const body = request.body || {};

    const company = safeText(body.company);
    const administrators = safeNumber(body.administrators);
    const teachers = safeNumber(body.teachers);
    const students = safeNumber(body.students);
    const usage = safeNumber(body.usage);
    const concurrency = safeNumber(body.concurrency);

    const startDate = safeText(body.startDate);
    const finishDate = safeText(body.finishDate);

    const selectedOptions = Array.isArray(body.selectedOptions)
      ? body.selectedOptions
          .slice(0, 200)
          .map((item) => ({
            section: safeText(item.section).slice(0, 100),
            label: safeText(item.label).slice(0, 250)
          }))
          .filter((item) => item.section && item.label)
      : [];

    if (!company) {
      return response.status(400).json({
        error: "Company is required."
      });
    }

    if (!startDate || !finishDate) {
      return response.status(400).json({
        error: "Start Date and Finish Date are required."
      });
    }

    if (finishDate < startDate) {
      return response.status(400).json({
        error: "Finish Date must be after Start Date."
      });
    }

    /*
      GROUP SELECTED ITEMS BY SECTION
    */

    const grouped = {};

    for (const item of selectedOptions) {
      if (!grouped[item.section]) {
        grouped[item.section] = [];
      }

      grouped[item.section].push(item.label);
    }

    /*
      CREATE PDF
    */

    const pdfDoc = await PDFDocument.create();

    const regularFont = await pdfDoc.embedFont(
      StandardFonts.Helvetica
    );

    const boldFont = await pdfDoc.embedFont(
      StandardFonts.HelveticaBold
    );

    const pageWidth = 595.28;
    const pageHeight = 841.89;

    const margin = 55;

    let page = pdfDoc.addPage([pageWidth, pageHeight]);

    let y = pageHeight - margin;

    const black = rgb(0.12, 0.12, 0.12);
    const grey = rgb(0.38, 0.38, 0.38);

    function newPage() {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }

    function ensureSpace(heightNeeded = 20) {
      if (y - heightNeeded < margin) {
        newPage();
      }
    }

    function drawText(text, options = {}) {
      const {
        size = 10,
        font = regularFont,
        indent = 0,
        color = black,
        gap = 15
      } = options;

      ensureSpace(gap + 5);

      page.drawText(safeText(text), {
        x: margin + indent,
        y,
        size,
        font,
        color
      });

      y -= gap;
    }

    function drawWrappedText(text, options = {}) {
      const {
        size = 10,
        font = regularFont,
        indent = 0,
        color = black,
        gap = 14
      } = options;

      const cleaned = safeText(text);

      const availableWidth =
        pageWidth - margin * 2 - indent;

      const words = cleaned.split(" ");

      let line = "";

      for (const word of words) {
        const testLine = line
          ? `${line} ${word}`
          : word;

        const width = font.widthOfTextAtSize(
          testLine,
          size
        );

        if (width > availableWidth && line) {
          ensureSpace(gap + 5);

          page.drawText(line, {
            x: margin + indent,
            y,
            size,
            font,
            color
          });

          y -= gap;

          line = word;
        } else {
          line = testLine;
        }
      }

      if (line) {
        ensureSpace(gap + 5);

        page.drawText(line, {
          x: margin + indent,
          y,
          size,
          font,
          color
        });

        y -= gap;
      }
    }

    /*
      TITLE
    */

    drawText("LICENSE REQUEST", {
      size: 19,
      font: boldFont,
      gap: 28
    });

    drawText(`Company: ${company}`, {
      size: 12,
      font: boldFont,
      gap: 25
    });

    /*
      LICENSE DETAILS
    */

    drawText("LICENSE DETAILS", {
      size: 11,
      font: boldFont,
      gap: 19
    });

    drawText(`Administrators: ${administrators}`);
    drawText(`Teachers: ${teachers}`);
    drawText(`Students: ${students}`);
    drawText(`Usage time per user: ${usage} hrs`);
    drawText(`Concurrency: ${concurrency}`);

    y -= 8;

    /*
      SELECTED OPTIONS
    */

    const sectionOrder = [
      "Available modules",
      "Scenarios",
      "Learning module",
      "Features"
    ];

    for (const section of sectionOrder) {
      const entries = grouped[section] || [];

      if (entries.length === 0) {
        continue;
      }

      ensureSpace(45);

      drawText(section.toUpperCase(), {
        size: 11,
        font: boldFont,
        gap: 19
      });

      for (const entry of entries) {
        drawWrappedText(`- ${entry}`, {
          size: 9,
          indent: 8,
          color: grey,
          gap: 13
        });
      }

      y -= 7;
    }

    /*
      DATES
    */

    ensureSpace(70);

    drawText("LICENSE PERIOD", {
      size: 11,
      font: boldFont,
      gap: 19
    });

    drawText(
      `Start Date: ${formatDate(startDate)}`
    );

    drawText(
      `Finish Date: ${formatDate(finishDate)}`
    );

    /*
      FOOTER
    */

    const pages = pdfDoc.getPages();

    pages.forEach((pdfPage, index) => {
      pdfPage.drawText(
        `License request - ${company} - Page ${
          index + 1
        } of ${pages.length}`,
        {
          x: margin,
          y: 25,
          size: 7,
          font: regularFont,
          color: grey
        }
      );
    });

    const pdfBytes = await pdfDoc.save();

    const pdfBase64 =
      Buffer.from(pdfBytes).toString("base64");

    /*
      EMAIL BODY
    */

    const selectedCount = selectedOptions.length;

    const emailHtml = `
      <div style="
        font-family: Arial, sans-serif;
        max-width: 620px;
        color: #222;
      ">

        <h2>New License Request</h2>

        <p>
          A new license request has been submitted.
        </p>

        <table style="
          border-collapse: collapse;
          width: 100%;
          max-width: 520px;
        ">

          <tr>
            <td style="padding:6px;font-weight:bold;">
              Company
            </td>
            <td style="padding:6px;">
              ${escapeHtml(company)}
            </td>
          </tr>

          <tr>
            <td style="padding:6px;font-weight:bold;">
              Administrators
            </td>
            <td style="padding:6px;">
              ${administrators}
            </td>
          </tr>

          <tr>
            <td style="padding:6px;font-weight:bold;">
              Teachers
            </td>
            <td style="padding:6px;">
              ${teachers}
            </td>
          </tr>

          <tr>
            <td style="padding:6px;font-weight:bold;">
              Students
            </td>
            <td style="padding:6px;">
              ${students}
            </td>
          </tr>

          <tr>
            <td style="padding:6px;font-weight:bold;">
              Usage
            </td>
            <td style="padding:6px;">
              ${usage} hrs/user
            </td>
          </tr>

          <tr>
            <td style="padding:6px;font-weight:bold;">
              Concurrency
            </td>
            <td style="padding:6px;">
              ${concurrency}
            </td>
          </tr>

          <tr>
            <td style="padding:6px;font-weight:bold;">
              Start Date
            </td>
            <td style="padding:6px;">
              ${escapeHtml(formatDate(startDate))}
            </td>
          </tr>

          <tr>
            <td style="padding:6px;font-weight:bold;">
              Finish Date
            </td>
            <td style="padding:6px;">
              ${escapeHtml(formatDate(finishDate))}
            </td>
          </tr>

          <tr>
            <td style="padding:6px;font-weight:bold;">
              Selected items
            </td>
            <td style="padding:6px;">
              ${selectedCount}
            </td>
          </tr>

        </table>

        <p>
          The complete request is attached as a PDF.
        </p>

      </div>
    `;

    /*
      SEND EMAIL
    */

    const fromAddress =
      process.env.LICENSE_REQUEST_FROM ||
      "License Requests <onboarding@resend.dev>";

    const { data, error } =
      await resend.emails.send({
        from: fromAddress,

        to: [
          process.env.LICENSE_REQUEST_TO
        ],

        subject:
          `License Request - ${company}`,

        html: emailHtml,

        attachments: [
          {
            filename:
              `license-request-${company
                .replace(/[^a-z0-9]+/gi, "-")
                .replace(/^-|-$/g, "")
                .toLowerCase() || "company"}.pdf`,

            content: pdfBase64
          }
        ]
      });

    if (error) {
      console.error("Resend error:", error);

      return response.status(500).json({
        error: error.message || "Email failed."
      });
    }

    return response.status(200).json({
      success: true,
      emailId: data?.id
    });

  } catch (error) {
    console.error("Submission error:", error);

    return response.status(500).json({
      error:
        error?.message ||
        "Unable to process license request."
    });
  }
}
