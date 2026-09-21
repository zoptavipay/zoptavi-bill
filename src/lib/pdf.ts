import { jsPDF } from 'jspdf';
import type { Bill, StoreSettings } from '../types';
import { formatINR, gstSummaryByRate } from './gst';

/** Builds a simple, print-quality PDF of a bill/invoice for sharing (WhatsApp, download, etc). */
export function buildBillPdf(bill: Bill, settings: StoreSettings): Blob {
  const doc = new jsPDF({ unit: 'pt', format: 'a5' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 32;
  let y = 40;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(settings.storeName, pageWidth / 2, y, { align: 'center' });
  y += 18;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  if (settings.address) {
    doc.text(settings.address, pageWidth / 2, y, { align: 'center' });
    y += 12;
  }
  const contactLine = [settings.phone && `Ph: ${settings.phone}`, settings.gstin && `GSTIN: ${settings.gstin}`]
    .filter(Boolean)
    .join('   ');
  if (contactLine) {
    doc.text(contactLine, pageWidth / 2, y, { align: 'center' });
    y += 16;
  }

  doc.setDrawColor(180);
  doc.line(margin, y, pageWidth - margin, y);
  y += 16;

  doc.setFontSize(9.5);
  doc.text(`Bill No: ${bill.billNo}`, margin, y);
  doc.text(new Date(bill.createdAt).toLocaleString('en-IN'), pageWidth - margin, y, { align: 'right' });
  y += 14;

  if (bill.customerName || bill.customerPhone) {
    doc.text([bill.customerName, bill.customerPhone].filter(Boolean).join('  ·  '), margin, y);
    y += 14;
  }
  if (bill.customerGstin) {
    doc.text(`Customer GSTIN: ${bill.customerGstin}`, margin, y);
    y += 14;
  }

  y += 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Item', margin, y);
  doc.text('HSN', margin + 150, y);
  doc.text('Qty', margin + 210, y);
  doc.text('Rate', margin + 250, y);
  doc.text('Amt', pageWidth - margin, y, { align: 'right' });
  y += 6;
  doc.setDrawColor(220);
  doc.line(margin, y, pageWidth - margin, y);
  y += 12;

  doc.setFont('helvetica', 'normal');
  for (const line of bill.lines) {
    doc.text(line.name, margin, y, { maxWidth: 140 });
    doc.text(line.hsn, margin + 150, y);
    doc.text(`${line.qty} ${line.unit}`, margin + 210, y);
    doc.text(line.price.toFixed(2), margin + 250, y);
    doc.text(line.lineTotal.toFixed(2), pageWidth - margin, y, { align: 'right' });
    y += 14;
  }

  y += 4;
  doc.setDrawColor(220);
  doc.line(margin, y, pageWidth - margin, y);
  y += 14;

  const summary = gstSummaryByRate(bill.lines);
  doc.setFont('helvetica', 'bold');
  doc.text('GST%', margin, y);
  doc.text('Taxable', margin + 90, y);
  doc.text('CGST', margin + 190, y);
  doc.text('SGST', margin + 260, y);
  y += 12;
  doc.setFont('helvetica', 'normal');
  for (const s of summary) {
    doc.text(`${s.rate}%`, margin, y);
    doc.text(s.taxable.toFixed(2), margin + 90, y);
    doc.text(s.cgst.toFixed(2), margin + 190, y);
    doc.text(s.sgst.toFixed(2), margin + 260, y);
    y += 13;
  }

  y += 6;
  doc.setDrawColor(180);
  doc.line(margin, y, pageWidth - margin, y);
  y += 16;

  const totalsLine = (label: string, value: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 11 : 9.5);
    doc.text(label, margin, y);
    doc.text(value, pageWidth - margin, y, { align: 'right' });
    y += bold ? 18 : 14;
  };
  totalsLine('Subtotal', formatINR(bill.subtotal));
  totalsLine('CGST', formatINR(bill.totalCgst));
  totalsLine('SGST', formatINR(bill.totalSgst));
  totalsLine('Grand Total', formatINR(bill.grandTotal), true);
  totalsLine('Payment', bill.paymentMode.toUpperCase());

  y += 10;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.text('Thank you, visit again!', pageWidth / 2, y, { align: 'center' });

  return doc.output('blob');
}

export function billPdfFileName(bill: Bill): string {
  return `${bill.billNo}.pdf`;
}
