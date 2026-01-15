const { v4: uuidv4 } = require("uuid");
const AppError = require("../errorHandling/AppError");

const VendorSyncJobService = {
  /**
   * Create a new sync job
   */
  async createSyncJob(client, { vendorId, startedBy = null, metadata = {} }) {
    const jobId = uuidv4();

    const query = `
      INSERT INTO vendor_sync_jobs (
        id, vendor_id, status, started_by, metadata, started_at
      ) VALUES ($1, $2, 'running', $3, $4, NOW())
      RETURNING *
    `;

    const result = await client.query(query, [
      jobId,
      vendorId,
      startedBy,
      JSON.stringify(metadata),
    ]);

    return result.rows[0];
  },

  /**
   * Get sync job by ID
   */
  async getJobById(client, jobId) {
    const query = `
      SELECT * FROM vendor_sync_jobs
      WHERE id = $1
    `;

    const result = await client.query(query, [jobId]);

    if (result.rowCount === 0) {
      throw new AppError("Sync job not found", 404);
    }

    return result.rows[0];
  },

  /**
   * Get active (running/cancelling) job for a vendor
   */
  async getActiveJobForVendor(client, vendorId) {
    const query = `
      SELECT * FROM vendor_sync_jobs
      WHERE vendor_id = $1
        AND status IN ('running', 'cancelling')
      ORDER BY started_at DESC
      LIMIT 1
    `;

    const result = await client.query(query, [vendorId]);
    return result.rowCount > 0 ? result.rows[0] : null;
  },

  /**
   * Get latest job (any status) for a vendor
   */
  async getLatestJobForVendor(client, vendorId) {
    const query = `
      SELECT * FROM vendor_sync_jobs
      WHERE vendor_id = $1
      ORDER BY started_at DESC
      LIMIT 1
    `;

    const result = await client.query(query, [vendorId]);
    return result.rowCount > 0 ? result.rows[0] : null;
  },

  /**
   * Update sync progress
   */
  async updateSyncProgress(client, jobId, updates) {
    const {
      totalProducts,
      processedProducts,
      successfulProducts,
      failedProducts,
      currentPage,
    } = updates;

    const query = `
      UPDATE vendor_sync_jobs SET
        total_products = COALESCE($2, total_products),
        processed_products = COALESCE($3, processed_products),
        successful_products = COALESCE($4, successful_products),
        failed_products = COALESCE($5, failed_products),
        current_page = COALESCE($6, current_page),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    const result = await client.query(query, [
      jobId,
      totalProducts,
      processedProducts,
      successfulProducts,
      failedProducts,
      currentPage,
    ]);

    return result.rows[0];
  },

  /**
   * Mark job as cancelling (user requested cancel)
   */
  async requestCancellation(client, jobId) {
    // First check if job exists and get its current status
    const checkQuery = `SELECT id, status FROM vendor_sync_jobs WHERE id = $1`;
    const checkResult = await client.query(checkQuery, [jobId]);

    if (checkResult.rowCount === 0) {
      throw new AppError("Sync job not found", 404);
    }

    const currentStatus = checkResult.rows[0].status;

    // If already in a terminal state, don't update
    if (currentStatus === 'completed' || currentStatus === 'failed' || currentStatus === 'cancelled') {
      throw new AppError(`Cannot cancel job - already ${currentStatus}`, 400);
    }

    // If already cancelling, just return the current job
    if (currentStatus === 'cancelling') {
      return checkResult.rows[0];
    }

    // Update to cancelling status
    const query = `
      UPDATE vendor_sync_jobs SET
        status = 'cancelling',
        updated_at = NOW()
      WHERE id = $1 AND status = 'running'
      RETURNING *
    `;

    const result = await client.query(query, [jobId]);

    if (result.rowCount === 0) {
      throw new AppError(`Cannot cancel job - current status is ${currentStatus}`, 400);
    }

    return result.rows[0];
  },

  /**
   * Complete sync job (success, failure, or cancelled)
   */
  async completeSyncJob(client, jobId, status, errorMessage = null, errorDetails = null) {
    if (!['completed', 'failed', 'cancelled'].includes(status)) {
      throw new AppError("Invalid completion status", 400);
    }

    const query = `
      UPDATE vendor_sync_jobs SET
        status = $2,
        completed_at = NOW(),
        error_message = $3,
        error_details = $4,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `;

    const result = await client.query(query, [
      jobId,
      status,
      errorMessage,
      errorDetails ? JSON.stringify(errorDetails) : null,
    ]);

    return result.rows[0];
  },

  /**
   * Check if job should be cancelled
   */
  async shouldCancelJob(client, jobId) {
    const query = `
      SELECT status FROM vendor_sync_jobs
      WHERE id = $1
    `;

    const result = await client.query(query, [jobId]);

    if (result.rowCount === 0) {
      return false;
    }

    return result.rows[0].status === 'cancelling';
  },

  /**
   * Get sync job history for a vendor
   */
  async getJobHistory(client, vendorId, limit = 10) {
    const query = `
      SELECT * FROM vendor_sync_jobs
      WHERE vendor_id = $1
      ORDER BY started_at DESC
      LIMIT $2
    `;

    const result = await client.query(query, [vendorId, limit]);
    return result.rows;
  },

  /**
   * Calculate elapsed time in seconds
   */
  calculateElapsedTime(startedAt, completedAt = null) {
    const start = new Date(startedAt);
    const end = completedAt ? new Date(completedAt) : new Date();
    return Math.floor((end - start) / 1000);
  },

  /**
   * Format job data for API response
   */
  formatJobResponse(job) {
    if (!job) return null;

    const elapsedSeconds = this.calculateElapsedTime(job.started_at, job.completed_at);
    const progressPercent = job.total_products > 0
      ? Math.round((job.processed_products / job.total_products) * 100)
      : 0;

    return {
      id: job.id,
      vendorId: job.vendor_id,
      status: job.status,
      progress: {
        total: job.total_products,
        processed: job.processed_products,
        successful: job.successful_products,
        failed: job.failed_products,
        currentPage: job.current_page,
        percent: progressPercent,
      },
      timing: {
        startedAt: job.started_at,
        completedAt: job.completed_at,
        elapsedSeconds,
        elapsedFormatted: this.formatElapsedTime(elapsedSeconds),
      },
      error: job.error_message ? {
        message: job.error_message,
        details: job.error_details,
      } : null,
      metadata: job.metadata,
    };
  },

  /**
   * Mark stale jobs as cancelled (jobs that haven't updated in X minutes)
   * This handles orphaned jobs when server crashes/restarts
   * Returns array of cleaned up job IDs
   */
  async markStaleJobsAsCancelled(client, vendorId, maxAgeMinutes = 30) {
    const query = `
      UPDATE vendor_sync_jobs
      SET
        status = 'cancelled',
        completed_at = NOW(),
        error_message = 'Sync process stopped - no updates received in ${maxAgeMinutes} minutes',
        updated_at = NOW()
      WHERE
        vendor_id = $1
        AND status IN ('running', 'cancelling')
        AND updated_at < NOW() - INTERVAL '${maxAgeMinutes} minutes'
      RETURNING id, status
    `;

    const result = await client.query(query, [vendorId]);
    return result.rows;
  },

  /**
   * Format elapsed time (e.g., "2m 15s", "1h 5m 30s")
   */
  formatElapsedTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  },
};

module.exports = { VendorSyncJobService };
