const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

/**
 * Builds a one-page PDF report from a generic structure, so the same
 * generator works for any of the 6 lead-magnet tools (ROI, bottleneck,
 * downtime cost, TCO comparison, supplier checklist, operator quiz) -
 * not just one specific calculator.
 *
 * @param {Object} data
 * @param {string} data.lang         'es' | 'en'
 * @param {string} data.name         visitor's name (may be empty)
 * @param {string} data.eyebrow      small label above the title, e.g.
 *                                   "RETURN ON INVESTMENT — PACKAGING MACHINERY"
 * @param {string} data.title        main report title
 * @param {Array<{label:string, value:string}>} data.inputs
 *                                   the values the visitor entered
 * @param {Array<{label:string, value:string, color?:string}>} data.results
 *                                   the calculated results (2-3 typical).
 *                                   color: 'purple' | 'green' | 'red' | 'amber'
 * @param {string} data.verdict      the plain-language conclusion text
 * @param {string} data.footer       small footer line, e.g.
 *                                   "PROFILL.MX · Bottleneck Detector"
 * @returns {Promise<Buffer>}
 */
async function generateReportPdf(data) {
  const t = data.lang === 'en' ? EN : ES;

  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const { width, height } = page.getSize();
  const margin = 50;
  let y = height - margin;

  const ink = rgb(0.12, 0.14, 0.19);
  const soft = rgb(0.42, 0.45, 0.5);
  const purple = rgb(0.42, 0.36, 0.91);
  const green = rgb(0.12, 0.48, 0.27);
  const red = rgb(0.71, 0.2, 0.13);
  const amber = rgb(0.7, 0.45, 0.04);

  const COLOR_MAP = { purple, green, red, amber };

  function text(str, opts = {}) {
    const { x = margin, size = 11, font = fontRegular, color = ink, gap = 18 } = opts;
    page.drawText(str, { x, y, size, font, color });
    y -= gap;
  }

  function rule() {
    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness: 0.75,
      color: rgb(0.85, 0.83, 0.78),
    });
    y -= 16;
  }

  // Header
  text(data.eyebrow || '', { size: 10, color: purple, font: fontBold, gap: 16 });
  text(data.title || '', { size: 19, font: fontBold, gap: 26 });
  text(data.name ? `${t.preparedFor}: ${data.name}` : t.personalizedReport, { size: 12, color: soft, gap: 26 });
  rule();

  // Inputs section
  if (Array.isArray(data.inputs) && data.inputs.length) {
    text(t.inputsHeading, { size: 13, font: fontBold, gap: 20 });
    data.inputs.forEach(({ label, value }) => {
      page.drawText(String(label), { x: margin, y, size: 11, font: fontRegular, color: soft });
      const valStr = String(value);
      page.drawText(valStr, {
        x: width - margin - fontBold.widthOfTextAtSize(valStr, 11),
        y,
        size: 11,
        font: fontBold,
        color: ink,
      });
      y -= 20;
    });
    y -= 10;
    rule();
  }

  // Results section
  if (Array.isArray(data.results) && data.results.length) {
    text(t.resultsHeading, { size: 13, font: fontBold, gap: 22 });
    data.results.forEach(({ label, value, color }) => {
      const c = COLOR_MAP[color] || purple;
      page.drawText(String(value), { x: margin, y, size: 20, font: fontBold, color: c });
      y -= 18;
      page.drawText(String(label), { x: margin, y, size: 9.5, font: fontRegular, color: soft });
      y -= 24;
    });
    rule();
  }

  // Verdict
  if (data.verdict) {
    text(t.verdictHeading, { size: 12, font: fontBold, gap: 18 });
    y = wrapText(page, data.verdict, margin, y, width - margin * 2, 11, fontRegular, ink, 15);
  }

  // Footer
  page.drawText(data.footer || t.defaultFooter, {
    x: margin,
    y: margin - 10,
    size: 8.5,
    font: fontRegular,
    color: soft,
  });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

function wrapText(page, str, x, y, maxWidth, size, font, color, lineHeight) {
  const words = String(str).split(' ');
  let line = '';
  words.forEach((word) => {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth) {
      page.drawText(line, { x, y, size, font, color });
      y -= lineHeight;
      line = word;
    } else {
      line = test;
    }
  });
  if (line) {
    page.drawText(line, { x, y, size, font, color });
    y -= lineHeight;
  }
  return y;
}

const ES = {
  preparedFor: 'Preparado para',
  personalizedReport: 'Reporte personalizado',
  inputsHeading: 'Datos ingresados',
  resultsHeading: 'Resultados',
  verdictHeading: 'Conclusión',
  defaultFooter: 'PROFILL.MX',
};

const EN = {
  preparedFor: 'Prepared for',
  personalizedReport: 'Personalized report',
  inputsHeading: 'Inputs entered',
  resultsHeading: 'Results',
  verdictHeading: 'Verdict',
  defaultFooter: 'PROFILL.MX',
};

module.exports = { generateReportPdf };
