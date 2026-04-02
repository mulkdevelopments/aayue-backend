require("dotenv").config();
const { Queue } = require("bullmq");

const connection = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: +(process.env.REDIS_PORT || 6379),
};

const emailQueue = new Queue("emailQueue", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    removeOnComplete: true,
    removeOnFail: false
  }
});

const pdfQueue = new Queue("pdfQueue", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    removeOnComplete: true,
    removeOnFail: false
  }
});

module.exports = { emailQueue, pdfQueue };
