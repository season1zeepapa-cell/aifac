// 프롬프트 템플릿 관리 API
// GET    /api/prompts               → 전체 목록
// GET    /api/prompts?name=X&category=Y → 특정 템플릿 조회
// POST   /api/prompts { ... }       → 생성/수정 (UPSERT)
// DELETE /api/prompts { id }        → 삭제
const { query } = require('../lib/db');
const { requireAuth } = require('../lib/auth');
const { setCors } = require('../lib/cors');
const { clearCache } = require('../lib/prompt-manager');

// 테이블 자동 생성
async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS prompt_templates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'default',
      stage TEXT NOT NULL DEFAULT 'main',
      template TEXT NOT NULL,
      few_shot_examples JSONB DEFAULT '[]',
      model_params JSONB DEFAULT '{}',
      is_active BOOLEAN DEFAULT true,
      version INTEGER DEFAULT 1,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(name, category)
    )
  `);
}

module.exports = async function handler(req, res) {
  if (setCors(req, res)) return;

  const { error: authError } = requireAuth(req);
  if (authError) return res.status(401).json({ error: authError });

  try {
    await ensureTable();

    // ── GET: 목록 또는 단일 조회 ──
    if (req.method === 'GET') {
      const { name, category } = req.query;

      // 특정 템플릿 조회
      if (name) {
        const cat = category || 'default';
        const result = await query(
          `SELECT * FROM prompt_templates
           WHERE name = $1 AND category IN ($2, 'default') AND is_active = true
           ORDER BY CASE WHEN category = $2 THEN 0 ELSE 1 END
           LIMIT 1`,
          [name, cat]
        );
        if (result.rows.length === 0) {
          return res.json({ template: null });
        }
        return res.json({ template: result.rows[0] });
      }

      // 전체 목록
      const result = await query(
        `SELECT id, name, category, stage, description, is_active, version,
                LENGTH(template) AS template_length,
                COALESCE(jsonb_array_length(few_shot_examples), 0) AS example_count,
                updated_at
         FROM prompt_templates
         ORDER BY name, CASE WHEN category = 'default' THEN 0 ELSE 1 END, category`
      );
      return res.json({ templates: result.rows });
    }

    // ── POST: 생성/수정 (UPSERT) ──
    if (req.method === 'POST') {
      const { id, name, category, stage, template, few_shot_examples, model_params, description, is_active } = req.body;

      if (!name || !template) {
        return res.status(400).json({ error: 'name과 template이 필요합니다.' });
      }

      const cat = category || 'default';
      const stg = stage || 'main';

      if (id) {
        // 기존 템플릿 수정
        await query(
          `UPDATE prompt_templates
           SET template = $2, few_shot_examples = $3, model_params = $4,
               stage = $5, description = $6, is_active = COALESCE($7, is_active),
               version = version + 1, updated_at = NOW()
           WHERE id = $1`,
          [id, template,
           JSON.stringify(few_shot_examples || []),
           JSON.stringify(model_params || {}),
           stg, description || null, is_active]
        );
        clearCache();
        return res.json({ success: true, action: 'updated', id });
      }

      // 새 템플릿 (UPSERT)
      const result = await query(
        `INSERT INTO prompt_templates (name, category, stage, template, few_shot_examples, model_params, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (name, category) DO UPDATE SET
           template = $4, few_shot_examples = $5, model_params = $6,
           stage = $3, description = $7, version = prompt_templates.version + 1, updated_at = NOW()
         RETURNING id`,
        [name, cat, stg, template,
         JSON.stringify(few_shot_examples || []),
         JSON.stringify(model_params || {}),
         description || null]
      );

      clearCache();
      return res.json({ success: true, action: 'upserted', id: result.rows[0].id });
    }

    // ── DELETE: 삭제 ──
    if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) {
        return res.status(400).json({ error: 'id가 필요합니다.' });
      }

      await query('DELETE FROM prompt_templates WHERE id = $1', [id]);
      clearCache();
      return res.json({ success: true, deleted: id });
    }

    return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
  } catch (err) {
    console.error('[Prompts API] 에러:', err);
    return res.status(500).json({ error: err.message });
  }
};
