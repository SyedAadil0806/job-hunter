import PDFDocument from 'pdfkit';
import { Cv } from './cv.schema';

/**
 * One-column, plain-font CV. ATS systems read this layout reliably:
 * no tables, no columns, no images, real text.
 */
export function renderCvPdf(cv: Cv): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 42, bottom: 42, left: 48, right: 48 }, info: { Title: `${cv.name} - CV`, Author: cv.name } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolvePromise(Buffer.concat(chunks)));
    doc.on('error', reject);

    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const dark = '#111111';
    const muted = '#444444';
    const accent = '#1f3a5f';

    const heading = (text: string) => {
      doc.moveDown(0.6);
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(accent).text(text.toUpperCase(), { characterSpacing: 0.6 });
      const y = doc.y + 1;
      doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.margins.left + width, y).lineWidth(0.6).strokeColor(accent).stroke();
      doc.moveDown(0.35);
    };

    const left = doc.page.margins.left;
    const bulletIndent = 11;
    const bulletOpts = { width: width - bulletIndent, lineGap: 0.8 };

    /** Bullets with a hanging indent, so wrapped lines line up under the text. */
    const bullets = (items: string[]) => {
      doc.font('Helvetica').fontSize(9.6).fillColor(dark);
      for (const b of items) {
        const y = doc.y;
        doc.text('•', left + 2, y, { lineBreak: false });
        doc.text(b, left + bulletIndent, y, bulletOpts);
        doc.y += 1.5;
      }
      doc.x = left;
    };

    /** Start a new page if this whole entry would not fit, so it is never split. */
    const keepTogether = (items: string[], extra = 30) => {
      doc.font('Helvetica').fontSize(9.6);
      const h = extra + items.reduce((sum, b) => sum + doc.heightOfString(b, bulletOpts) + 1.5, 0);
      if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
    };

    /** Bold text on the left, grey text on the right; if both don't fit, right goes below. */
    const rowWithRight = (leftText: string, right: string) => {
      const y = doc.y;
      doc.font('Helvetica').fontSize(9.3);
      const rightW = right ? doc.widthOfString(right) : 0;
      doc.font('Helvetica-Bold').fontSize(10);
      const leftW = doc.widthOfString(leftText);
      if (right && leftW + rightW + 16 > width) {
        doc.fillColor(dark).text(leftText, left, y, { width });
        doc.font('Helvetica').fontSize(9.3).fillColor(muted).text(right, left, doc.y, { width });
      } else {
        doc.fillColor(dark).text(leftText, left, y, { width: width - rightW - 16 });
        const afterLeft = doc.y;
        if (right) doc.font('Helvetica').fontSize(9.3).fillColor(muted).text(right, left, y, { width, align: 'right' });
        doc.y = Math.max(afterLeft, doc.y);
      }
      doc.x = left;
    };

    // Header
    doc.font('Helvetica-Bold').fontSize(19).fillColor(dark).text(cv.name);
    doc.font('Helvetica').fontSize(11).fillColor(accent).text(cv.title);
    const c = cv.contact;
    // Two short lines instead of one long one, so links never break in the middle.
    const line1 = [c.location, c.phone, c.email].filter(Boolean).join('  |  ');
    const line2 = [c.linkedin, c.github, c.portfolio].filter(Boolean).join('  |  ');
    doc.moveDown(0.2).fontSize(9).fillColor(muted).text(line1, { width });
    if (line2) doc.text(line2, { width });

    heading('Summary');
    doc.font('Helvetica').fontSize(9.8).fillColor(dark).text(cv.summary, { width, lineGap: 1 });

    heading('Skills');
    for (const [cat, list] of Object.entries(cv.skills)) {
      if (!list.length) continue;
      doc.font('Helvetica-Bold').fontSize(9.6).fillColor(dark).text(`${cat}: `, { continued: true });
      doc.font('Helvetica').text(list.join(', '), { width });
    }

    if (cv.experience.length) {
      heading('Experience');
      cv.experience.forEach((e, i) => {
        if (i) doc.moveDown(0.35);
        keepTogether(e.bullets);
        rowWithRight(`${e.role} — ${e.company}`, [e.start, e.end].filter(Boolean).join(' – '));
        if (e.location) doc.font('Helvetica-Oblique').fontSize(9).fillColor(muted).text(e.location);
        doc.moveDown(0.15);
        bullets(e.bullets);
      });
    }

    if (cv.projects.length) {
      heading('Projects');
      cv.projects.forEach((p, i) => {
        if (i) doc.moveDown(0.35);
        keepTogether(p.bullets);
        rowWithRight(p.name, p.stack.join(', '));
        if (p.link) doc.font('Helvetica').fontSize(9).fillColor(muted).text(p.link);
        doc.moveDown(0.15);
        bullets(p.bullets);
      });
    }

    if (cv.education.length) {
      heading('Education');
      for (const e of cv.education) {
        rowWithRight(`${e.degree} — ${e.school}`, [e.start, e.end].filter(Boolean).join(' – '));
        if (e.details.length) bullets(e.details);
      }
    }

    if (cv.certifications.length) {
      heading('Certifications');
      bullets(cv.certifications);
    }

    doc.end();
  });
}
