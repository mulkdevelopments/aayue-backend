const svc = require("../../services/sizeNormalizationService");

async function getStatus(req, res) {
  try {
    const data = await svc.getFullStatus();
    res.json({ status: "success", data });
  } catch (err) {
    console.error("sizeNorm.getStatus:", err);
    res.status(500).json({ status: "error", message: err.message });
  }
}

async function getCategoryStatus(req, res) {
  try {
    const data = await svc.getCategoryStatus(req.params.categoryId);
    res.json({ status: "success", data });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

async function listTables(req, res) {
  try {
    const data = await svc.listTables();
    res.json({ status: "success", data });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

async function getTable(req, res) {
  try {
    const data = await svc.getTable(req.params.id);
    if (!data) return res.status(404).json({ status: "error", message: "Table not found" });
    res.json({ status: "success", data });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

async function createTable(req, res) {
  try {
    const { name, description, target_type, rows } = req.body;
    if (!name || !rows?.length) {
      return res.status(400).json({ status: "error", message: "name and rows required" });
    }
    const id = await svc.createTable(name, description, target_type || "alpha", rows);
    res.json({ status: "success", data: { id } });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

async function updateTable(req, res) {
  try {
    const { name, description, target_type, rows } = req.body;
    await svc.updateTable(req.params.id, name, description, target_type, rows);
    res.json({ status: "success" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

async function deleteTable(req, res) {
  try {
    await svc.deleteTable(req.params.id);
    res.json({ status: "success" });
  } catch (err) {
    res.status(400).json({ status: "error", message: err.message });
  }
}

async function getAssignments(req, res) {
  try {
    const data = await svc.getAssignments();
    res.json({ status: "success", data });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

async function upsertAssignment(req, res) {
  try {
    const { category_id, table_id, filter_type } = req.body;
    if (!category_id || !filter_type) {
      return res.status(400).json({ status: "error", message: "category_id and filter_type required" });
    }
    await svc.upsertAssignment(category_id, table_id || null, filter_type);
    res.json({ status: "success" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

async function dryRun(req, res) {
  try {
    const { category_id, table_id } = req.body;
    if (!category_id || !table_id) {
      return res.status(400).json({ status: "error", message: "category_id and table_id required" });
    }
    const data = await svc.dryRunNormalization(category_id, table_id);
    res.json({ status: "success", data });
  } catch (err) {
    console.error("sizeNorm.dryRun:", err);
    res.status(500).json({ status: "error", message: err.message });
  }
}

async function execute(req, res) {
  try {
    const { category_id, table_id } = req.body;
    if (!category_id || !table_id) {
      return res.status(400).json({ status: "error", message: "category_id and table_id required" });
    }
    const adminId = req.admin?.id || null;
    const data = await svc.executeNormalization(category_id, table_id, adminId);
    res.json({ status: "success", data });
  } catch (err) {
    console.error("sizeNorm.execute:", err);
    res.status(500).json({ status: "error", message: err.message });
  }
}

async function getHistory(req, res) {
  try {
    const data = await svc.getHistory(parseInt(req.query.limit) || 50);
    res.json({ status: "success", data });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
}

async function rollback(req, res) {
  try {
    const data = await svc.rollbackRun(req.params.runId);
    res.json({ status: "success", data });
  } catch (err) {
    res.status(400).json({ status: "error", message: err.message });
  }
}

module.exports = {
  getStatus,
  getCategoryStatus,
  listTables,
  getTable,
  createTable,
  updateTable,
  deleteTable,
  getAssignments,
  upsertAssignment,
  dryRun,
  execute,
  getHistory,
  rollback,
};
