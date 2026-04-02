require("dotenv").config({ path: "../../.env" });
const { Worker } = require("bullmq");
const {
  sendOrderConfirmation,
  sendNewOrderNotificationEmail,
  sendInvoiceAttachmentEmail,
} = require("../utils/sendMail");

const dbPool = require("../db/dbConnection");
const { generateInvoicePDF } = require("../utils/generateInvociePdf");
const path = require("path");
const connection = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: +(process.env.REDIS_PORT || 6379),
};

const worker = new Worker(
  "emailQueue",
  async (job) => {
    console.log("📩 Processing Email Job:", job.name);

    if (job.name === "sendCustomerEmail") {
      return await sendOrderConfirmation(job.data.to, job.data.orderData);
    }

    if (job.name === "sendAdminEmail") {
      return await sendNewOrderNotificationEmail(
        job.data.toList,
        job.data.orderData
      );
    }

    // if (job.name === "sendInvoiceEmail") {
    //   console.log("Generating PDF for Order #", job.data.orderNo);
    //   let result = await generateInvoicePDF(
    //     job.data.orderNo,
    //     job.data.invoiceHTML
    //   );
    //   console.log("Generated PDF:", result);

    //   await dbPool.query(
    //     "UPDATE orders SET invoice_pdf_path = $1 WHERE id = $2",
    //     [result.pdfRelativePath, job.data.orderId]
    //   );

    //   const absolutePdfPath = path.isAbsolute(result.pdfFullPath)
    //     ? result.pdfFullPath
    //     : path.join(process.cwd(), result.pdfFullPath);
    //   job.data.pdfFullPath = absolutePdfPath;

    //   return await sendInvoiceAttachmentEmail(job.data);
    // }

    return { skipped: true };
  },
  { connection }
);

// Logs
worker.on("completed", (job) => {
  console.log("✔ Job completed:", job.id);
});

worker.on("failed", (job, err) => {
  console.error("❌ Job failed:", job?.id, err);
});
