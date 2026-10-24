const fs = require('fs');
const path = require('path');
const config = require('./config');

class DatabaseManager {
  constructor(dbPath = config.paths.dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this.engine = null;
    this.init();
  }

  init() {
    // Ensure parent directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Try better-sqlite3 first, fallback to native node:sqlite (Node 22+)
    try {
      const BetterSqlite3 = require('better-sqlite3');
      this.db = new BetterSqlite3(this.dbPath);
      this.engine = 'better-sqlite3';
    } catch {
      try {
        const { DatabaseSync } = require('node:sqlite');
        this.db = new DatabaseSync(this.dbPath);
        this.engine = 'node:sqlite';
      } catch (err2) {
        throw new Error(`Failed to initialize SQLite engine: ${err2.message}`);
      }
    }

    this.initSchema();
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS processed_items (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        item_type TEXT NOT NULL,
        author_name TEXT,
        content TEXT,
        post_url TEXT,
        tags TEXT,
        content_hash TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_group ON processed_items (group_id);
      CREATE INDEX IF NOT EXISTS idx_created_at ON processed_items (created_at);
    `);

    // Migration: ensure content_hash column exists on older databases
    try {
      this.db.exec('ALTER TABLE processed_items ADD COLUMN content_hash TEXT;');
    } catch {}

    // Create index on content_hash
    try {
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_content_hash ON processed_items (content_hash);');
    } catch {}

    // Backfill content_hash for older rows to prevent re-alerting legacy entries
    try {
      const crypto = require('crypto');
      const unhashed = this.db.prepare("SELECT id, group_id, item_type, author_name, content FROM processed_items WHERE content_hash IS NULL OR content_hash = '' LIMIT 500").all();
      if (unhashed && unhashed.length > 0) {
        const updateStmt = this.db.prepare('UPDATE processed_items SET content_hash = ? WHERE id = ?');
        for (const row of unhashed) {
          const normAuthor = (row.author_name || 'unknown').toLowerCase().replace(/\s+/g, ' ').trim();
          const normText = (row.content || '')
            .toLowerCase()
            .replace(/[\u0300-\u036f\u200b-\u200f\ufeff]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 160);
          const hash = crypto.createHash('sha256').update(`${row.group_id}_${row.item_type}_${normAuthor}_${normText}`).digest('hex');
          updateStmt.run(`fp_${hash}`, row.id);
        }
      }
    } catch {}
  }

  isExists(id, contentHash = null) {
    if (id) {
      const stmt = this.db.prepare('SELECT id FROM processed_items WHERE id = ? LIMIT 1');
      if (stmt.get(String(id))) return true;
    }
    if (contentHash) {
      const stmt = this.db.prepare('SELECT id FROM processed_items WHERE content_hash = ? LIMIT 1');
      if (stmt.get(String(contentHash))) return true;
    }
    return false;
  }

  insertItem({ id, group_id, item_type = 'POST', author_name = 'Unknown', content = '', post_url = '', tags = '', content_hash = '' }) {
    if (!id) throw new Error('Item ID is required for deduplication');
    const tagsStr = Array.isArray(tags) ? tags.join(', ') : String(tags || '');
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO processed_items (id, group_id, item_type, author_name, content, post_url, tags, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      String(id),
      String(group_id || ''),
      String(item_type || 'POST'),
      String(author_name || 'Unknown'),
      String(content || ''),
      String(post_url || ''),
      tagsStr,
      String(content_hash || '')
    );
  }

  getStats() {
    const totalStmt = this.db.prepare('SELECT COUNT(*) as count FROM processed_items');
    const postsStmt = this.db.prepare("SELECT COUNT(*) as count FROM processed_items WHERE item_type = 'POST'");
    const commentsStmt = this.db.prepare("SELECT COUNT(*) as count FROM processed_items WHERE item_type = 'COMMENT'");
    const latestStmt = this.db.prepare('SELECT id, group_id, item_type, author_name, tags, created_at FROM processed_items ORDER BY created_at DESC LIMIT 5');

    const total = totalStmt.get()?.count || 0;
    const posts = postsStmt.get()?.count || 0;
    const comments = commentsStmt.get()?.count || 0;
    const latest = latestStmt.all() || [];

    return {
      engine: this.engine,
      total,
      posts,
      comments,
      latest
    };
  }

  cleanupOldItems(days = 30) {
    const stmt = this.db.prepare(`
      DELETE FROM processed_items 
      WHERE created_at < datetime('now', '-' || ? || ' days')
    `);
    return stmt.run(days);
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Singleton instance
const dbInstance = new DatabaseManager();

module.exports = dbInstance;
module.exports.DatabaseManager = DatabaseManager;
