const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

exports.generateInvoicePDF = async (order_id, invoiceHTML) => {
  try {
    // 1️⃣ Create invoices folder
    const invoicesDir = path.join(__dirname, "../../uploads/invoices");
    if (!fs.existsSync(invoicesDir)) {
      fs.mkdirSync(invoicesDir, { recursive: true });
    }

    // 2️⃣ File paths
    const pdfFileName = `invoice-${order_id}.pdf`;
    const pdfFullPath = path.join(invoicesDir, pdfFileName);
    const pdfRelativePath = `/uploads/invoices/${pdfFileName}`;

    // 3️⃣ Generate PDF using Puppeteer
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    await page.setContent(invoiceHTML, { waitUntil: "networkidle0" });

    await page.pdf({
      path: pdfFullPath,
      format: "A4",
      printBackground: true,
    });

    await browser.close();

    // 4️⃣ Return both paths
    return {
      pdfFullPath,
      pdfRelativePath,
      fileName: pdfFileName,
    };
  } catch (error) {
    console.error("❌ PDF Generation Failed:", error);
    throw new Error("Failed to generate invoice PDF");
  }
};
