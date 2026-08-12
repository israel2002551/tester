import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { optionalAuth, requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler, HttpError } from '../../utils/http.js';

export const upcomingRouter = Router();

const schema = z.object({
  title: z.string().min(2),
  description: z.string().optional().nullable(),
  image_url: z.string().optional().nullable(),
  video_url: z.string().optional().nullable(),
  images: z.array(z.string()).optional().default([]),
  videos: z.array(z.string()).optional().default([]),
  launch_date: z.string().optional().nullable(),
  priority: z.number().int().optional().default(1),
  status: z.enum(['draft','active','hidden','archived']).optional().default('active'),
});

upcomingRouter.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const canModerate = req.user?.roles?.includes('admin');
  const includeAll = canModerate && String(req.query.all || '') === '1';
  const { rows } = await query(`
    SELECT * FROM upcoming_products
    ${includeAll ? '' : "WHERE status='active'"}
    ORDER BY priority DESC, COALESCE(launch_date, created_at) ASC, created_at DESC
    LIMIT 100
  `);
  res.json({ items: rows });
}));

upcomingRouter.post('/', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const d = schema.parse(req.body);
  const { rows } = await query(`
    INSERT INTO upcoming_products(title,description,image_url,video_url,images,videos,launch_date,priority,status,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *
  `, [d.title,d.description||null,d.image_url||d.images[0]||null,d.video_url||d.videos[0]||null,JSON.stringify(d.images),JSON.stringify(d.videos),d.launch_date||null,d.priority,d.status,req.user.id]);
  res.status(201).json(rows[0]);
}));

upcomingRouter.patch('/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const allowed = ['title','description','image_url','video_url','images','videos','launch_date','priority','status'];
  const entries = Object.entries(req.body).filter(([key]) => allowed.includes(key));
  if (!entries.length) throw new HttpError(400, 'No supported fields supplied');
  const values = entries.map(([,value]) => Array.isArray(value) ? JSON.stringify(value) : value);
  values.push(req.params.id);
  const set = entries.map(([key],index) => `"${key}"=$${index+1}`).join(',');
  const { rows } = await query(`UPDATE upcoming_products SET ${set},updated_at=now() WHERE id=$${values.length} RETURNING *`, values);
  if (!rows[0]) throw new HttpError(404, 'Upcoming product not found');
  res.json(rows[0]);
}));

upcomingRouter.delete('/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  await query('DELETE FROM upcoming_products WHERE id=$1', [req.params.id]);
  res.status(204).end();
}));
