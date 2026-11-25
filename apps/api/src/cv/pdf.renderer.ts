import PDFDocument from 'pdfkit';
import { Block, cvBlocks } from './cv.layout';
import { Cv } from './cv.schema';

/**
 * One-column, real-text PDF built from `cvBlocks`, so its reading order is the
 * order on screen. No tables, columns, images, text boxes, headers or footers,
 * and no letter-spacing (spaced-out headings can come out as "S U M M A R Y").
 */
export function renderCvPdf(cv: Cv, opts: { keywords?: string[] } = {}): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 40, bottom: 40, left: 50, right: 50 },
      info: {
        Title: `${cv.name} - CV`,
        Author: cv.name,
        Subject: cv.title,
        Keywords: (opts.keywords ?? []).join(', '),
      },
      lang: 'en',
      displayTitle: true,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolvePromise(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom;
    const black = '#000000';
    const grey = '#333333';
    const body = 9.8;
    const bulletIndent = 12;
    const bulletOpts = { width: width - bulletIndent, lineGap: 1 };

    const at = (x = left) => {
      doc.x = x;
    };

    const heading = (text: string) => {
      // Keep a heading with at least two lines of what follows it.
      if (doc.y + 50 > bottom()) doc.addPage();
      doc.moveDown(0.7);
      doc.font('Helvetica-Bold').fontSize(11).fillColor(black).text(text.toUpperCase(), left, doc.y, { width });
      const y = doc.y + 1;
      doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.6).strokeColor(black).stroke();
      doc.y = y + 4;
    };

    const entryHeight = (b: Extract<Block, { kind: 'entry' }>) => {
      doc.font('Helvetica').fontSize(body);
      return 28 + b.bullets.reduce((sum, x) => sum + doc.heightOfString(x, bulletOpts) + 2, 0);
    };

    const entry = (b: Extract<Block, { kind: 'entry' }>, first: boolean) => {
      // Start a new page rather than split a short entry across two.
      const h = entryHeight(b);
      if (doc.y + h > bottom() && h < bottom() - doc.page.margins.top) doc.addPage();
      if (!first) doc.moveDown(0.45);
      doc.font('Helvetica-Bold').fontSize(10.2).fillColor(black).text(b.title, left, doc.y, { width });
      if (b.meta) doc.font('Helvetica').fontSize(9.4).fillColor(grey).text(b.meta, left, doc.y, { width });
      if (b.bullets.length) doc.moveDown(0.15);
      doc.font('Helvetica').fontSize(body).fillColor(black);
      for (const x of b.bullets) {
        const y = doc.y;
        // The bullet and its text are one line of text to a parser: "• Built ...".
        doc.text('•', left + 2, y, { lineBreak: false, continued: false });
        doc.text(x, left + bulletIndent, y, bulletOpts);
        doc.y += 2;
      }
      at();
    };

    let prev: Block['kind'] | undefined;
    for (const b of cvBlocks(cv)) {
      switch (b.kind) {
        case 'name':
          doc.font('Helvetica-Bold').fontSize(20).fillColor(black).text(b.text, left, doc.y, { width });
          break;
        case 'headline':
          doc.font('Helvetica').fontSize(11.5).fillColor(black).text(b.text, { width });
          doc.moveDown(0.15);
          break;
        case 'contact':
          doc.font('Helvetica').fontSize(9.4).fillColor(grey);
          b.parts.forEach((p, i) => {
            const last = i === b.parts.length - 1;
            doc.text(p.text, { link: p.link, underline: false, continued: !last });
            if (!last) doc.text(' | ', { link: undefined, continued: true });
          });
          at();
          break;
        case 'heading':
          heading(b.text);
          break;
        case 'paragraph':
          doc.font('Helvetica').fontSize(body).fillColor(black).text(b.text, left, doc.y, { width, lineGap: 1.2 });
          break;
        case 'labelled':
          doc.font('Helvetica-Bold').fontSize(body).fillColor(black).text(`${b.label}: `, left, doc.y, { continued: true });
          doc.font('Helvetica').text(b.text, { width, lineGap: 1 });
          doc.y += 1;
          break;
        case 'entry':
          entry(b, prev !== 'entry');
          break;
      }
      prev = b.kind;
    }

    doc.end();
  });
}
