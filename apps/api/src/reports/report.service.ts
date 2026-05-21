import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { LIABILITY_DISCLAIMER } from '@adas/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Principal } from '../auth/auth.guard.js';

/**
 * Insurer Defense Report generator.
 *
 * Produces a printable PDF that documents, for each detected requirement: the operation, the
 * WHY (grounded in the OEM rule), the confidence band, the OEM source citation, and a
 * retrieval timestamp. Every report carries the liability disclaimer and a traceability
 * footer. This is the artifact a shop hands to an insurer to justify a supplement.
 *
 * Returns the PDF as a Buffer; the controller streams it and/or persists it to object storage.
 */
@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(principal: Principal, estimateId: string): Promise<Buffer> {
    const estimate = await this.prisma.estimate.findFirstOrThrow({
      where: { id: estimateId, organizationId: principal.organizationId },
      include: {
        vinRecord: true,
        shop: true,
        requirements: {
          where: { isSupplementCandidate: true },
          orderBy: { confidenceScore: 'desc' },
          include: { oemReferences: { include: { procedure: true } } },
        },
      },
    });

    const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    const v = estimate.vinRecord;
    const vehicle = v ? `${v.modelYear ?? ''} ${v.make ?? ''} ${v.model ?? ''} ${v.trim ?? ''}`.trim() : 'Unknown vehicle';

    // Header
    doc.fontSize(18).text('OEM Repair Intelligence — Insurer Defense Report', { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#555')
      .text(`Generated: ${new Date().toISOString()}`)
      .text(`Shop: ${estimate.shop?.name ?? 'N/A'}`)
      .text(`Vehicle: ${vehicle}`)
      .text(`VIN: ${v?.vin ?? 'N/A'}`)
      .text(`Estimate source: ${estimate.source}`);
    doc.fillColor('#000').moveDown(1);

    // Advisory banner
    doc.fontSize(9).fillColor('#7a3b00')
      .text('ASSISTIVE OEM INTELLIGENCE — ADVISORY ONLY. OEM verification required.', {
        align: 'left',
      });
    doc.fillColor('#000').moveDown(1);

    if (estimate.requirements.length === 0) {
      doc.fontSize(12).text('No high-confidence supplement-eligible operations were detected.');
    }

    // One block per requirement
    estimate.requirements.forEach((r: (typeof estimate.requirements)[number], i: number) => {
      doc.fontSize(13).fillColor('#0b3d5c').text(`${i + 1}. ${humanizeKind(r.kind)}`);
      doc.fillColor('#000').fontSize(10).moveDown(0.2);
      doc.text(`Confidence: ${r.confidenceBand} (${(r.confidenceScore * 100).toFixed(0)}%)`);
      doc.moveDown(0.2);
      doc.text(`Justification: ${r.explanation}`);

      if (r.oemReferences.length > 0) {
        doc.moveDown(0.2).fillColor('#333').text('OEM references:');
        r.oemReferences.forEach((ref: (typeof r.oemReferences)[number]) => {
          doc.text(`  • ${ref.procedure.title} — ${ref.citation}`, { continued: false });
          doc.fontSize(8).fillColor('#777')
            .text(`     retrieved ${ref.retrievedAt.toISOString()}`)
            .fontSize(10).fillColor('#333');
        });
        doc.fillColor('#000');
      }
      doc.moveDown(0.8);
    });

    // Disclaimer + traceability footer
    doc.moveDown(1);
    doc.fontSize(8).fillColor('#444').text(LIABILITY_DISCLAIMER, { align: 'justify' });
    doc.moveDown(0.5);
    doc.fontSize(7).fillColor('#888')
      .text(`Report ID: ${estimate.id} · Org: ${principal.organizationId} · Traceable via ProcessingStep + AuditLog.`);

    doc.end();
    const buffer = await done;

    // Record the generated report (version increments on regeneration).
    const prior = await this.prisma.insurerReport.count({ where: { estimateId } });
    await this.prisma.insurerReport.create({
      data: { estimateId, version: prior + 1, summary: `${estimate.requirements.length} operations` },
    });

    return buffer;
  }
}

function humanizeKind(kind: string): string {
  return kind
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
