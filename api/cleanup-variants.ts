import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchPricingFromPublicSheet } from '../lib/pricing-sheet.js';
import { computeCapPriceBreakdown } from '../src/utils/capPricing.js';

const SHOPIFY_STORE = (process.env.SHOPIFY_STORE || '').trim();
const SHOPIFY_ACCESS_TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || '').trim() || undefined;
const SHOPIFY_CLIENT_ID = (process.env.SHOPIFY_CLIENT_ID || '').trim() || undefined;
const SHOPIFY_CLIENT_SECRET = (process.env.SHOPIFY_CLIENT_SECRET || '').trim() || undefined;
const SHOPIFY_PRODUCT_ID = (process.env.SHOPIFY_PRODUCT_ID || '').trim() || undefined;
const CRON_SECRET = (process.env.CRON_SECRET || 'kaminos').trim();
const GOOGLE_SHEET_ID = (process.env.GOOGLE_SHEET_ID || '').trim();

const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;

// Protected (non-MFC-) variant that pins the product's "from $X" to the true
// lowest configurable price. The non-MFC- option value means cleanup never
// touches it (cleanup only deletes option1 values starting with "MFC-").
const ANCHOR_OPTION_LABEL = 'Starting Price';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function getAccessToken(): Promise<string | null> {
    if (SHOPIFY_ACCESS_TOKEN) return SHOPIFY_ACCESS_TOKEN;
    if (!SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) return null;
    try {
        const tokenRes = await fetch(`https://${SHOPIFY_STORE}/admin/oauth/access_token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: SHOPIFY_CLIENT_ID,
                client_secret: SHOPIFY_CLIENT_SECRET,
            }).toString(),
        });
        if (tokenRes.ok) {
            const data = await tokenRes.json();
            return data.access_token;
        }
    } catch { /* ignore */ }
    return null;
}

async function resolveProductId(accessToken: string): Promise<string | null> {
    if (SHOPIFY_PRODUCT_ID) return SHOPIFY_PRODUCT_ID;
    try {
        const res = await fetch(
            `https://${SHOPIFY_STORE}/admin/api/2025-10/products.json?limit=50&fields=id,title`,
            { headers: { 'X-Shopify-Access-Token': accessToken } }
        );
        if (!res.ok) return null;
        const data = await res.json();
        const products = data?.products || [];
        const chase = products.find((p: any) => p.title?.toLowerCase().includes('chase')) || products[0];
        return chase?.id ? String(chase.id) : null;
    } catch {
        return null;
    }
}

async function listVariants(productId: string, accessToken: string) {
    const listRes = await fetch(
        `https://${SHOPIFY_STORE}/admin/api/2025-10/products/${productId}/variants.json?limit=250`,
        { headers: { 'X-Shopify-Access-Token': accessToken } }
    );
    if (!listRes.ok) throw new Error(`Failed to list variants: ${listRes.status}`);
    const data = await listRes.json();
    return data?.variants || [];
}

async function deleteVariant(productId: string, variantId: string, accessToken: string, imageId?: number): Promise<boolean> {
    const delRes = await fetch(
        `https://${SHOPIFY_STORE}/admin/api/2025-10/products/${productId}/variants/${variantId}.json`,
        { method: 'DELETE', headers: { 'X-Shopify-Access-Token': accessToken } }
    );
    if (!delRes.ok) return false;

    // Also delete the variant's screenshot image so it doesn't clutter product media
    if (imageId) {
        const imgDel = await fetch(
            `https://${SHOPIFY_STORE}/admin/api/2025-10/products/${productId}/images/${imageId}.json`,
            { method: 'DELETE', headers: { 'X-Shopify-Access-Token': accessToken } }
        );
        if (imgDel.ok) {
            console.log('[CLEANUP] Deleted image', imageId, 'for variant', variantId);
        }
    }
    return true;
}

async function uploadProductImage(productId: string, accessToken: string, base64: string): Promise<{ imageUrl: string; imageId: number }> {
    // Detect type from the data-URL prefix (the dashboard now sends a resized JPEG).
    const isJpeg = base64.startsWith('data:image/jpeg');
    const mimeType = isJpeg ? 'image/jpeg' : 'image/png';
    const ext = isJpeg ? 'jpg' : 'png';
    const buffer = Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    const filename = `chimney-cap-default-${Date.now()}.${ext}`;

    // Stage the upload
    const stageRes = await fetch(`https://${SHOPIFY_STORE}/admin/api/2025-10/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
        body: JSON.stringify({ query: `mutation { stagedUploadsCreate(input: [{ resource: PRODUCT_IMAGE filename: "${filename}" mimeType: "${mimeType}" httpMethod: PUT }]) { stagedTargets { url resourceUrl } userErrors { field message } } }` }),
    });
    const stageData = await stageRes.json();
    const target = stageData?.data?.stagedUploadsCreate?.stagedTargets?.[0];
    if (!target?.url) throw new Error('Staged upload init failed');

    // Upload binary
    const putRes = await fetch(target.url, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body: buffer,
    });
    if (!putRes.ok) throw new Error(`Binary upload failed: ${putRes.status}`);

    // Attach as product image (position 1 = featured)
    const imgRes = await fetch(
        `https://${SHOPIFY_STORE}/admin/api/2025-10/products/${productId}/images.json`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
            body: JSON.stringify({ image: { src: target.resourceUrl, position: 1 } }),
        }
    );
    const imgData = await imgRes.json();
    if (!imgData?.image?.id) throw new Error('Product image creation failed');

    // Move to position 1 (featured)
    await fetch(
        `https://${SHOPIFY_STORE}/admin/api/2025-10/products/${productId}/images/${imgData.image.id}.json`,
        {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
            body: JSON.stringify({ image: { id: imgData.image.id, position: 1 } }),
        }
    );

    return { imageUrl: imgData.image.src, imageId: imgData.image.id };
}

/* ------------------------------------------------------------------ */
/*  Anchor variant (pins the "from $X" floor price)                    */
/* ------------------------------------------------------------------ */

// Cheapest configurable cap, computed from the LIVE sheet: smallest dims with no
// surcharges, iterating mount/lid/material to find the lowest valid total. The
// cap has no gauge/holes/skirt-threshold like the chase cover — its price is a
// mount×lid bracket multiplier, so we search the combinations directly.
const CAP_FLOOR_BASE = { width: 10, length: 10, screen_height: 4, lid_pitch: 1, vertical_skirt: 1, powder_coat: false };
const CAP_MOUNTS = ['skirt', 'pitched_skirt', 'top_mount'];
const CAP_LIDS = ['flat', 'hip', 'hip_ridge', 'standing_seam'];

async function computeFloorPrice(): Promise<{ price: string; config: any } | null> {
    const pricing: any = await fetchPricingFromPublicSheet(GOOGLE_SHEET_ID, 'pricing');
    if (!pricing || !pricing.CAP_MULTIPLIERS) return null;
    const materials = Object.keys(pricing.MATERIAL_MULT || { stainless: 1 });
    let best = Infinity;
    let bestConfig: any = null;
    for (const mount of CAP_MOUNTS) {
        for (const lid_type of CAP_LIDS) {
            for (const material of materials) {
                const cfg = { ...CAP_FLOOR_BASE, mount, lid_type, material };
                const bd = computeCapPriceBreakdown(cfg, pricing);
                // Only trust combos backed by a real sheet multiplier — a missing key
                // falls back to ×1 and would yield an absurdly low, fake floor.
                if (!bd.multiplierFromSheet) continue;
                if (!(pricing.MARGIN_RATE > 0)) continue;
                if (bd.total > 0 && bd.total < best) {
                    best = bd.total;
                    bestConfig = { ...cfg, multiplierKey: bd.multiplierKey, total: Number(bd.total.toFixed(2)) };
                }
            }
        }
    }
    if (!Number.isFinite(best) || best <= 0) return null;
    return { price: best.toFixed(2), config: bestConfig };
}

// Create the protected anchor variant via REST (non-MFC- option value, untracked,
// oversell-allowed). Cleanup skips it permanently.
async function createAnchorVariant(
    productId: string,
    accessToken: string,
    price: string
): Promise<{ ok: boolean; variantId?: string; error?: string }> {
    const res = await fetch(
        `https://${SHOPIFY_STORE}/admin/api/2025-10/products/${productId}/variants.json`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
            body: JSON.stringify({
                variant: {
                    option1: ANCHOR_OPTION_LABEL,
                    price,
                    inventory_policy: 'continue',
                    inventory_management: null,
                },
            }),
        }
    );
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.variant?.id) {
        return { ok: false, error: data?.errors ? JSON.stringify(data.errors) : `HTTP ${res.status}` };
    }
    return { ok: true, variantId: String(data.variant.id) };
}

/* ------------------------------------------------------------------ */
/*  HTML Management UI                                                 */
/* ------------------------------------------------------------------ */

function renderManagementUI(variants: any[], productId: string, secret: string): string {
    const now = Date.now();
    const ccVariants = variants.filter((v: any) => String(v.option1 || '').startsWith('MFC-'));
    const nonCcVariants = variants.filter((v: any) => !String(v.option1 || '').startsWith('MFC-'));

    const formatAge = (createdAt: string) => {
        const ageMs = now - new Date(createdAt).getTime();
        const hours = Math.floor(ageMs / (1000 * 60 * 60));
        const days = Math.floor(hours / 24);
        if (days > 0) return `${days}d ${hours % 24}h ago`;
        if (hours > 0) return `${hours}h ago`;
        const mins = Math.floor(ageMs / (1000 * 60));
        return `${mins}m ago`;
    };

    const variantRows = ccVariants.map((v: any) => `
        <tr data-id="${v.id}">
            <td><input type="checkbox" class="var-check" value="${v.id}" /></td>
            <td class="mono">${v.id}</td>
            <td>${v.option1 || '—'}</td>
            <td>$${v.price}</td>
            <td>${formatAge(v.created_at)}</td>
            <td>${new Date(v.created_at).toLocaleString()}</td>
            <td>
                <button class="btn btn-sm btn-danger delete-one" data-id="${v.id}">Delete</button>
            </td>
        </tr>
    `).join('');

    const protectedRows = nonCcVariants.map((v: any) => `
        <tr class="protected">
            <td>🔒</td>
            <td class="mono">${v.id}</td>
            <td>${v.option1 || '—'}</td>
            <td>$${v.price}</td>
            <td>${formatAge(v.created_at)}</td>
            <td>${new Date(v.created_at).toLocaleString()}</td>
            <td><span class="badge">Protected</span></td>
        </tr>
    `).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" type="image/png" href="/kaminos-favicon.png">
<title>Clean Up Variants — Chimney Cap</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; padding: 20px; }
  .container { max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 24px; margin-bottom: 8px; }
  .subtitle { color: #666; margin-bottom: 20px; }
  .stats { display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
  .stat-card { background: white; border-radius: 8px; padding: 16px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); min-width: 150px; }
  .stat-card .num { font-size: 28px; font-weight: 700; }
  .stat-card .label { color: #666; font-size: 13px; }
  .actions { display: flex; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; align-items: center; }
  .btn { padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; transition: opacity 0.2s; }
  .btn:hover { opacity: 0.85; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-danger { background: #e74c3c; color: white; }
  .btn-warning { background: #f39c12; color: white; }
  .btn-primary { background: #3498db; color: white; }
  .btn-sm { padding: 4px 10px; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #eee; font-size: 13px; }
  th { background: #fafafa; font-weight: 600; position: sticky; top: 0; }
  tr:hover { background: #f9f9f9; }
  tr.protected { opacity: 0.6; }
  .mono { font-family: 'SF Mono', Monaco, monospace; font-size: 12px; }
  .badge { background: #27ae60; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
  .status { padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; display: none; }
  .status.success { display: block; background: #d4edda; color: #155724; }
  .status.error { display: block; background: #f8d7da; color: #721c24; }
  .status.info { display: block; background: #d1ecf1; color: #0c5460; }
  .progress-wrap { display: none; background: white; border-radius: 8px; padding: 16px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 16px; }
  .progress-wrap.active { display: block; }
  .progress-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
  .progress-label { font-size: 13px; color: #333; font-weight: 500; }
  .progress-count { font-size: 13px; color: #666; font-family: 'SF Mono', Monaco, monospace; }
  .progress-track { background: #e9ecef; border-radius: 99px; height: 10px; overflow: hidden; }
  .progress-bar { background: linear-gradient(90deg, #3498db, #2ecc71); height: 100%; border-radius: 99px; width: 0%; transition: width 0.25s ease; }
  .progress-bar.error { background: #e74c3c; }
  .progress-items { margin-top: 10px; max-height: 120px; overflow-y: auto; font-size: 12px; color: #555; display: flex; flex-direction: column; gap: 2px; }
  #select-all { margin-right: 4px; }
  .filter-row { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; }
  .filter-row label { font-size: 13px; color: #666; }
  .filter-row select { padding: 6px 10px; border-radius: 4px; border: 1px solid #ddd; font-size: 13px; }
  .upload-card { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 20px; }
  .upload-card h2 { font-size: 16px; margin-bottom: 12px; }
  .upload-card p { font-size: 13px; color: #666; margin-bottom: 12px; }
  .upload-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .upload-preview { max-height: 80px; border-radius: 6px; border: 1px solid #eee; display: none; }
  input[type=file] { font-size: 13px; }
</style>
</head>
<body>
<div class="container">
  <h1>Clean Up Variants</h1>
  <p class="subtitle">Product ID: ${productId} · ${variants.length} total variants · ${ccVariants.length} auto-created (MFC-*) · ${nonCcVariants.length} protected</p>

  <div class="stats">
    <div class="stat-card"><div class="num">${variants.length}</div><div class="label">Total Variants</div></div>
    <div class="stat-card"><div class="num">${ccVariants.length}</div><div class="label">Auto-Created (MFC-*)</div></div>
    <div class="stat-card"><div class="num">${nonCcVariants.length}</div><div class="label">Protected</div></div>
    <div class="stat-card"><div class="num">${100 - variants.length}</div><div class="label">Slots Remaining</div></div>
  </div>

  <div id="status" class="status"></div>

  <div id="progress-wrap" class="progress-wrap">
    <div class="progress-header">
      <span class="progress-label" id="progress-label">Deleting…</span>
      <span class="progress-count" id="progress-count">0 / 0</span>
    </div>
    <div class="progress-track">
      <div class="progress-bar" id="progress-bar"></div>
    </div>
    <div class="progress-items" id="progress-items"></div>
  </div>

  <div class="upload-card">
    <h2>📸 Set Featured Product Image</h2>
    <p>Upload an image to replace the current featured/default product image shown in Shopify (position 1).</p>
    <div class="upload-row">
      <input type="file" id="img-file" accept="image/*" />
      <img id="img-preview" class="upload-preview" alt="preview" />
      <button class="btn btn-primary" id="upload-img-btn" disabled>Upload as Featured Image</button>
    </div>
  </div>

  <div class="actions">
    <button class="btn btn-danger" id="delete-selected" disabled>Delete Selected (0)</button>
    <button class="btn btn-warning" id="delete-all-cc">Delete All MFC-* Variants (${ccVariants.length})</button>
    <button class="btn btn-primary" id="run-cron">Run 10-Day Cleanup</button>
    <span style="flex:1"></span>
    <div class="filter-row">
      <label>Filter:</label>
      <select id="age-filter">
        <option value="all">All</option>
        <option value="1h">Older than 1 hour</option>
        <option value="6h">Older than 6 hours</option>
        <option value="24h">Older than 24 hours</option>
        <option value="10d">Older than 10 days</option>
      </select>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th><input type="checkbox" id="select-all" /></th>
        <th>Variant ID</th>
        <th>Option Value</th>
        <th>Price</th>
        <th>Age</th>
        <th>Created</th>
        <th>Action</th>
      </tr>
    </thead>
    <tbody id="variant-list">
      ${variantRows}
      ${protectedRows}
    </tbody>
  </table>
</div>

<script>
let SECRET = ${JSON.stringify(secret)};
const API_URL = window.location.pathname;

// If no secret was provided in the URL, prompt once before first destructive action
function ensureSecret() {
  if (SECRET) return true;
  const entered = prompt('Enter the admin secret to perform this action:');
  if (!entered) return false;
  SECRET = entered;
  return true;
}

function showStatus(msg, type) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status ' + type;
  if (type === 'success') setTimeout(() => { el.className = 'status'; }, 5000);
}

function updateSelectedCount() {
  const checked = document.querySelectorAll('.var-check:checked');
  const btn = document.getElementById('delete-selected');
  btn.textContent = 'Delete Selected (' + checked.length + ')';
  btn.disabled = checked.length === 0;
}

document.getElementById('select-all').addEventListener('change', (e) => {
  const visible = document.querySelectorAll('.var-check');
  visible.forEach(cb => { if (!cb.closest('tr').classList.contains('filtered-out')) cb.checked = e.target.checked; });
  updateSelectedCount();
});

document.addEventListener('change', (e) => {
  if (e.target.classList.contains('var-check')) updateSelectedCount();
});

document.getElementById('age-filter').addEventListener('change', (e) => {
  const val = e.target.value;
  const now = Date.now();
  const thresholds = { 'all': 0, '1h': 3600000, '6h': 21600000, '24h': 86400000, '10d': 864000000 };
  const minAge = thresholds[val] || 0;

  document.querySelectorAll('#variant-list tr[data-id]').forEach(tr => {
    const created = tr.querySelector('td:nth-child(6)')?.textContent || '';
    const createdMs = new Date(created).getTime();
    const age = now - createdMs;
    if (minAge > 0 && age < minAge) {
      tr.classList.add('filtered-out');
      tr.style.display = 'none';
    } else {
      tr.classList.remove('filtered-out');
      tr.style.display = '';
    }
  });
});

function showProgress(done, total, label) {
  const wrap = document.getElementById('progress-wrap');
  const bar = document.getElementById('progress-bar');
  const countEl = document.getElementById('progress-count');
  const labelEl = document.getElementById('progress-label');
  wrap.classList.add('active');
  labelEl.textContent = label;
  countEl.textContent = done + ' / ' + total;
  bar.style.width = total > 0 ? Math.round((done / total) * 100) + '%' : '0%';
  bar.classList.remove('error');
}

function logProgressItem(msg, isError) {
  const items = document.getElementById('progress-items');
  const el = document.createElement('div');
  el.textContent = (isError ? '✗ ' : '✓ ') + msg;
  el.style.color = isError ? '#e74c3c' : '#27ae60';
  items.appendChild(el);
  items.scrollTop = items.scrollHeight;
}

function hideProgress() {
  const wrap = document.getElementById('progress-wrap');
  wrap.classList.remove('active');
  document.getElementById('progress-items').innerHTML = '';
  document.getElementById('progress-bar').style.width = '0%';
}

async function deleteIds(ids) {
  if (!ensureSecret()) return;
  if (ids.length === 0) return;

  // Disable all action buttons during deletion
  const buttons = document.querySelectorAll('.btn');
  buttons.forEach(b => b.disabled = true);

  let deleted = 0;
  let failed = 0;
  const failedIds = [];

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const optionVal = document.querySelector('tr[data-id="' + id + '"] td:nth-child(3)')?.textContent || id;
    showProgress(i, ids.length, 'Deleting ' + (i + 1) + ' of ' + ids.length + '…');
    try {
      const res = await fetch(API_URL + '?secret=' + encodeURIComponent(SECRET) + '&action=delete&ids=' + id);
      const data = await res.json();
      if (data.deleted > 0) {
        deleted++;
        logProgressItem(optionVal + ' deleted', false);
        const row = document.querySelector('tr[data-id="' + id + '"]');
        if (row) row.remove();
      } else {
        failed++;
        failedIds.push(id);
        logProgressItem(optionVal + ' — ' + (data.errors?.[0] || 'failed'), true);
      }
    } catch (err) {
      failed++;
      failedIds.push(id);
      logProgressItem(id + ' — ' + err.message, true);
    }
  }

  // Final state
  showProgress(ids.length, ids.length, deleted + ' deleted' + (failed > 0 ? ', ' + failed + ' failed' : ' — done!'));
  document.getElementById('progress-bar').classList.toggle('error', deleted === 0 && failed > 0);

  // Re-enable buttons
  buttons.forEach(b => b.disabled = false);
  updateSelectedCount();

  if (deleted > 0) {
    showStatus('Deleted ' + deleted + ' variant(s).' + (failed > 0 ? ' ' + failed + ' failed.' : ''), 'success');
    setTimeout(() => hideProgress(), 3000);
  } else {
    showStatus('No variants deleted.' + (failed > 0 ? ' ' + failed + ' failed.' : ''), 'error');
  }

  // Update stats
  const totalEl = document.querySelector('.stat-card:nth-child(1) .num');
  const ccEl = document.querySelector('.stat-card:nth-child(2) .num');
  const slotsEl = document.querySelector('.stat-card:nth-child(4) .num');
  const remaining = document.querySelectorAll('#variant-list tr[data-id]').length;
  const protectedCount = document.querySelectorAll('#variant-list tr.protected').length;
  if (totalEl) totalEl.textContent = remaining + protectedCount;
  if (ccEl) ccEl.textContent = remaining;
  if (slotsEl) slotsEl.textContent = 100 - (remaining + protectedCount);
}

document.querySelectorAll('.delete-one').forEach(btn => {
  btn.addEventListener('click', () => deleteIds([btn.dataset.id]));
});

document.getElementById('delete-selected').addEventListener('click', () => {
  const ids = [...document.querySelectorAll('.var-check:checked')].map(cb => cb.value);
  if (ids.length === 0) return;
  if (confirm('Delete ' + ids.length + ' selected variant(s)?')) deleteIds(ids);
});

document.getElementById('delete-all-cc').addEventListener('click', () => {
  const ids = [...document.querySelectorAll('.var-check')].map(cb => cb.value);
  if (ids.length === 0) { showStatus('No MFC-* variants to delete.', 'info'); return; }
  if (confirm('Delete ALL ' + ids.length + ' auto-created variant(s)? Protected variants will NOT be touched.')) deleteIds(ids);
});

// Featured image upload
document.getElementById('img-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  const preview = document.getElementById('img-preview');
  const btn = document.getElementById('upload-img-btn');
  if (!file) { preview.style.display = 'none'; btn.disabled = true; return; }
  const reader = new FileReader();
  reader.onload = (ev) => {
    preview.src = ev.target.result;
    preview.style.display = 'block';
    btn.disabled = false;
  };
  reader.readAsDataURL(file);
});

// Downscale on a canvas (white background, max 1600px, JPEG) BEFORE upload so a
// full-resolution photo never exceeds Vercel's ~4.5MB request-body limit.
function resizeToDataUrl(file, maxDim, cb) {
  var img = new Image();
  var objUrl = URL.createObjectURL(file);
  img.onload = function () {
    URL.revokeObjectURL(objUrl);
    var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    var w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    cb(canvas.toDataURL('image/jpeg', 0.9));
  };
  img.onerror = function () { cb(null); };
  img.src = objUrl;
}
document.getElementById('upload-img-btn').addEventListener('click', async () => {
  const file = document.getElementById('img-file').files[0];
  if (!file) return;
  if (!ensureSecret()) return;
  const btn = document.getElementById('upload-img-btn');
  btn.disabled = true;
  showStatus('Resizing & uploading featured image...', 'info');
  resizeToDataUrl(file, 1600, async (dataUrl) => {
    if (!dataUrl) { showStatus('Could not read that image file.', 'error'); btn.disabled = false; return; }
    try {
      const res = await fetch(API_URL + '?secret=' + encodeURIComponent(SECRET) + '&action=upload-product-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });
      const data = await res.json();
      if (data.success) {
        showStatus('Featured image set! View it in Shopify Admin → Products. URL: ' + data.imageUrl, 'success');
      } else {
        showStatus('Upload failed: ' + (data.error || 'Unknown error'), 'error');
      }
    } catch (err) {
      showStatus('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
});

document.getElementById('run-cron').addEventListener('click', async () => {
  if (!ensureSecret()) return;
  const btn = document.getElementById('run-cron');
  btn.disabled = true;
  btn.textContent = 'Running…';
  showStatus('Running 10-day cleanup — this may take a moment…', 'info');
  try {
    const res = await fetch(API_URL + '?secret=' + encodeURIComponent(SECRET) + '&action=cron');
    const data = await res.json();
    showStatus('Cleanup done: ' + data.deleted + ' deleted, ' + data.kept + ' kept.', 'success');
    if (data.deleted > 0) setTimeout(() => location.reload(), 2000);
  } catch (err) {
    showStatus('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run 10-Day Cleanup';
  }
});
</script>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */
/*  Handler                                                            */
/* ------------------------------------------------------------------ */

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method === 'OPTIONS') return res.status(200).end();

    const userAgent = String(req.headers['user-agent'] || '');
    const isVercelCron = userAgent.includes('vercel-cron/1.0');

    // Auth: the management UI is viewable without auth (it's behind a Vercel deployment URL).
    // Destructive actions (delete, cron, upload) require ?secret= or Bearer CRON_SECRET.
    const authHeader = req.headers.authorization || '';
    const querySecret = typeof req.query.secret === 'string' ? req.query.secret : '';
    const requestedAction = typeof req.query.action === 'string' ? req.query.action : '';
    const action = requestedAction || (isVercelCron ? 'cron' : '');
    const isDestructive = action && action !== 'ui';

    if (isDestructive && CRON_SECRET) {
        const validBearer = authHeader === `Bearer ${CRON_SECRET}`;
        const validQuery = querySecret === CRON_SECRET;
        if (!validBearer && !validQuery) {
            return res.status(401).json({ error: 'Unauthorized. Add ?secret=YOUR_CRON_SECRET to the URL.' });
        }
    }

    try {
        const accessToken = await getAccessToken();
        if (!accessToken) {
            return res.status(500).json({ error: 'Shopify auth not configured.' });
        }

        const productId = await resolveProductId(accessToken);
        if (!productId) {
            return res.status(400).json({ error: 'Could not resolve product ID.' });
        }

        const variants = await listVariants(productId, accessToken);

        // Action: show management UI (default for browser GET)
        if (!action || action === 'ui') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.status(200).send(renderManagementUI(variants, productId, querySecret || CRON_SECRET));
        }

        // Action: delete specific variant IDs
        if (action === 'delete') {
            const idsParam = typeof req.query.ids === 'string' ? req.query.ids : '';
            const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean);
            if (ids.length === 0) {
                return res.status(400).json({ error: 'No variant IDs provided. Use &ids=123,456' });
            }

            let deleted = 0;
            const errors: string[] = [];
            for (const id of ids) {
                // Safety: only delete MFC-* variants
                const variant = variants.find((v: any) => String(v.id) === id);
                if (!variant) { errors.push(`${id}: not found`); continue; }
                if (!String(variant.option1 || '').startsWith('MFC-')) {
                    errors.push(`${id}: protected (not MFC-* prefix)`);
                    continue;
                }
                const ok = await deleteVariant(productId, id, accessToken, variant.image_id || undefined);
                if (ok) deleted++;
                else errors.push(`${id}: delete failed`);
            }

            return res.status(200).json({ success: true, deleted, errors: errors.length > 0 ? errors : undefined });
        }

        // Action: cron cleanup (delete MFC-* variants older than 10 days)
        if (action === 'cron' || action === 'cleanup') {
            const cutoff = Date.now() - TEN_DAYS_MS;
            let deleted = 0;
            let kept = 0;
            const errors: string[] = [];

            for (const v of variants) {
                const opt = String(v.option1 || '');
                if (!opt.startsWith('MFC-')) { kept++; continue; }
                const createdAt = new Date(v.created_at).getTime();
                if (createdAt >= cutoff) { kept++; continue; }

                const ok = await deleteVariant(productId, String(v.id), accessToken, v.image_id || undefined);
                if (ok) {
                    deleted++;
                    console.log('[CLEANUP] Deleted variant', v.id, opt, v.image_id ? `+ image ${v.image_id}` : '');
                } else {
                    errors.push(`Failed to delete ${v.id}`);
                }
            }

            console.log('[CLEANUP] Done:', { deleted, kept, errors: errors.length });
            return res.status(200).json({
                success: true, productId, totalVariants: variants.length,
                deleted, kept, errors: errors.length > 0 ? errors : undefined,
            });
        }

        // Action: upload a new default/featured product image
        if (action === 'upload-product-image') {
            if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
            const { image } = req.body || {};
            if (!image) return res.status(400).json({ error: 'Missing image (base64)' });
            // Vercel serverless caps request bodies at ~4.5MB. The dashboard now
            // auto-resizes before sending, so this is just a clear fallback message.
            if (typeof image === 'string' && image.length > 4_000_000) {
                const mb = (image.length * 0.75 / 1024 / 1024).toFixed(1);
                return res.status(413).json({ error: `Image too large (~${mb}MB). The dashboard auto-resizes before upload — re-select the file and try again.` });
            }
            try {
                const result = await uploadProductImage(productId, accessToken, image);
                console.log('[CLEANUP] Default product image uploaded:', result.imageUrl);
                return res.status(200).json({ success: true, imageUrl: result.imageUrl, imageId: result.imageId });
            } catch (err: any) {
                return res.status(500).json({ error: err.message });
            }
        }

        // Action: preview the computed floor price (read-only, creates nothing)
        if (action === 'anchor-preview') {
            const floor = await computeFloorPrice();
            if (!floor) return res.status(500).json({ error: 'Could not compute floor price (check GOOGLE_SHEET_ID / pricing)' });
            const existing = variants.find((v: any) => String(v.option1 || '') === ANCHOR_OPTION_LABEL);
            return res.status(200).json({
                success: true,
                floorPrice: floor.price,
                config: floor.config,
                anchorExists: !!existing,
                anchorVariantId: existing ? String(existing.id) : null,
                anchorCurrentPrice: existing ? existing.price : null,
            });
        }

        // Action: create (or re-price) the protected anchor variant at the floor price
        if (action === 'create-anchor') {
            const floor = await computeFloorPrice();
            if (!floor) return res.status(500).json({ error: 'Could not compute floor price (check GOOGLE_SHEET_ID / pricing)' });

            const existing = variants.find((v: any) => String(v.option1 || '') === ANCHOR_OPTION_LABEL);
            if (existing) {
                const upd = await fetch(
                    `https://${SHOPIFY_STORE}/admin/api/2025-10/products/${productId}/variants/${existing.id}.json`,
                    {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
                        body: JSON.stringify({ variant: { id: existing.id, price: floor.price } }),
                    }
                );
                const updData = await upd.json().catch(() => null);
                return res.status(upd.ok ? 200 : 502).json({
                    success: upd.ok, action: 'repriced', variantId: String(existing.id), floorPrice: floor.price,
                    error: upd.ok ? undefined : JSON.stringify(updData?.errors || `HTTP ${upd.status}`),
                });
            }

            const created = await createAnchorVariant(productId, accessToken, floor.price);
            console.log('[CLEANUP] Anchor variant', created.ok ? `created ${created.variantId}` : `failed: ${created.error}`, 'at', floor.price);
            return res.status(created.ok ? 200 : 502).json({
                success: created.ok, action: 'created', variantId: created.variantId,
                floorPrice: floor.price, optionLabel: ANCHOR_OPTION_LABEL, error: created.error,
            });
        }

        // Action: re-pin the current featured image as a permanent, UNTIED position-1
        // image so cleanup can never delete it (cleanup only removes images that are a
        // deleted MFC- variant's image_id). No-op if the featured image is already
        // untied. Lossless — Shopify copies from the existing CDN URL.
        if (action === 'repin-featured') {
            const prodRes = await fetch(
                `https://${SHOPIFY_STORE}/admin/api/2025-10/products/${productId}.json?fields=id,image,images`,
                { headers: { 'X-Shopify-Access-Token': accessToken } }
            );
            const prod = (await prodRes.json().catch(() => null))?.product;
            const featured = prod?.image;
            if (!featured?.src) {
                return res.status(404).json({ error: 'Product has no featured image to re-pin.' });
            }
            const featuredFull = (prod.images || []).find((i: any) => i.id === featured.id);
            const tied = !!(featuredFull?.variant_ids && featuredFull.variant_ids.length > 0);
            if (!tied) {
                return res.status(200).json({ success: true, action: 'already-protected', imageId: featured.id, src: featured.src });
            }
            // Featured image is a variant screenshot — copy it to a fresh untied slot at position 1.
            const addRes = await fetch(
                `https://${SHOPIFY_STORE}/admin/api/2025-10/products/${productId}/images.json`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
                    body: JSON.stringify({ image: { src: featured.src, position: 1 } }),
                }
            );
            const added = (await addRes.json().catch(() => null))?.image;
            if (!added?.id) return res.status(502).json({ error: 'Failed to re-pin featured image' });
            console.log('[CLEANUP] Re-pinned featured image', added.id, '(was tied to a variant)');
            return res.status(200).json({ success: true, action: 're-pinned', wasTiedToVariant: tied, newImageId: added.id, src: added.src });
        }

        // Unknown action
        return res.status(400).json({ error: `Unknown action: ${action}. Use: ui, delete, cron, upload-product-image, anchor-preview, create-anchor, repin-featured` });

    } catch (err: any) {
        console.error('[CLEANUP] Error:', err?.stack || err);
        return res.status(500).json({ error: err.message || 'Internal server error' });
    }
}
