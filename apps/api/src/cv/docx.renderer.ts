import { BorderStyle, Document, ExternalHyperlink, LevelFormat, Packer, Paragraph, TextRun } from 'docx';
import { cvBlocks } from './cv.layout';
import { Cv } from './cv.schema';

const FONT = 'Calibri';
/** docx sizes are half-points. */
const pt = (n: number) => n * 2;

/**
 * The same CV as a Word file. Some ATS (older Taleo, iCIMS, many company
 * portals) parse .docx more reliably than PDF. Everything is in the body:
 * no tables, text boxes, columns, headers or footers, which parsers often skip.
 * Bullets are real Word list items, and section headings use Word's Heading 1.
 */
export async function renderCvDocx(cv: Cv, opts: { keywords?: string[] } = {}): Promise<Buffer> {
  const children: Paragraph[] = [];
  const run = (text: string, o: { bold?: boolean; size?: number; color?: string } = {}) =>
    new TextRun({ text, font: FONT, bold: o.bold, size: pt(o.size ?? 10.5), color: o.color ?? '000000' });

  let prevEntry = false;
  for (const b of cvBlocks(cv)) {
    switch (b.kind) {
      case 'name':
        children.push(new Paragraph({ spacing: { after: 0 }, children: [run(b.text, { bold: true, size: 20 })] }));
        break;
      case 'headline':
        children.push(new Paragraph({ spacing: { after: 40 }, children: [run(b.text, { size: 12 })] }));
        break;
      case 'contact':
        children.push(
          new Paragraph({
            spacing: { after: 0 },
            children: b.parts.flatMap((p, i) => {
              const text = run(p.text, { size: 10, color: '333333' });
              const part = p.link ? new ExternalHyperlink({ link: p.link, children: [text] }) : text;
              return i ? [run(' | ', { size: 10, color: '333333' }), part] : [part];
            }),
          }),
        );
        break;
      case 'heading':
        children.push(
          new Paragraph({
            style: 'Heading1',
            spacing: { before: 200, after: 80 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000', space: 1 } },
            children: [run(b.text.toUpperCase(), { bold: true, size: 11.5 })],
          }),
        );
        break;
      case 'paragraph':
        children.push(new Paragraph({ spacing: { after: 40 }, children: [run(b.text)] }));
        break;
      case 'labelled':
        children.push(new Paragraph({ spacing: { after: 20 }, children: [run(`${b.label}: `, { bold: true }), run(b.text)] }));
        break;
      case 'entry':
        children.push(new Paragraph({ spacing: { before: prevEntry ? 120 : 0, after: 0 }, keepNext: true, children: [run(b.title, { bold: true, size: 11 })] }));
        if (b.meta) children.push(new Paragraph({ spacing: { after: 30 }, keepNext: b.bullets.length > 0, children: [run(b.meta, { size: 10, color: '333333' })] }));
        for (const x of b.bullets) {
          children.push(new Paragraph({ numbering: { reference: 'cv-bullets', level: 0 }, spacing: { after: 20 }, children: [run(x)] }));
        }
        break;
    }
    prevEntry = b.kind === 'entry';
  }

  const doc = new Document({
    creator: cv.name,
    title: `${cv.name} - CV`,
    subject: cv.title,
    keywords: (opts.keywords ?? []).join(', '),
    styles: {
      default: { document: { run: { font: FONT, size: pt(10.5) } } },
      paragraphStyles: [{ id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', run: { font: FONT, bold: true, color: '000000' } }],
    },
    numbering: {
      config: [
        {
          reference: 'cv-bullets',
          levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', style: { paragraph: { indent: { left: 360, hanging: 240 } } } }],
        },
      ],
    },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 800, bottom: 800, left: 1000, right: 1000 } } }, children }],
  });
  return Packer.toBuffer(doc);
}
