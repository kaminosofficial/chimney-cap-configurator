import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sidebar } from './components/sidebar/Sidebar';

// Lazy: pulls in PdfReport + the base64 logo + (transitively) jsPDF/html2canvas.
// In the SPA build this whole stack stays out of the main chunk until the user
// actually opens the PDF preview. The Shopify IIFE inlines it (no code split).
const PdfPreviewModal = lazy(() =>
  import('./components/pdf/PdfPreviewModal').then(m => ({ default: m.PdfPreviewModal }))
);
import { CapViewer } from './components/viewer/CapViewer';
import { useConfigStore, saveConfigForRestore, restoreConfigIfNeeded } from './store/configStore';

import { applyConfigState, getConfigState, exportToGLB } from './utils/ar';
import { cameraActions } from './utils/cameraRef';
import { RalModal } from './components/ral/RalModal';
import { formatFrac } from './utils/format';
import { CartProgressOverlay } from './components/CartProgressOverlay';
import QRious from 'qrious';

import { isApiReachable, loadPricingFromAPI } from './config/pricing';

declare global {
  interface Window { __chaseDebug?: boolean; }
}

declare const __LOCAL_IP__: string | undefined;

/** Debug flag â€” set `window.__chaseDebug = true` in console to enable verbose logging. */
const DEBUG = () => !!(window as any).__chaseDebug;

function IconCameraReset() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

function IconCameraTop() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" fill="currentColor" fillOpacity="0.05" />
      <text x="12" y="15.5" fontSize="11" fontWeight="900" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="ui-sans-serif, system-ui, sans-serif">T</text>
    </svg>
  );
}

function IconCameraFront() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" fill="currentColor" fillOpacity="0.05" />
      <text x="12" y="15.5" fontSize="11" fontWeight="900" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="ui-sans-serif, system-ui, sans-serif">F</text>
    </svg>
  );
}

interface AppProps {
  productId?: string;
  variantId?: string;
}

interface ShopifyCart {
  item_count?: number;
  items?: Array<{
    id?: number;
    variant_id?: number;
    quantity?: number;
    properties?: Record<string, string>;
  }>;
}

function normalizeShopifyId(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const normalized = String(value).trim();
  return /^\d+$/.test(normalized) ? normalized : undefined;
}

function readFieldValue(element: Element | null): string | undefined {
  if (!element) return undefined;
  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement) {
    return normalizeShopifyId(element.value);
  }
  return normalizeShopifyId(element.getAttribute('value'));
}

function getConfiguratorHost(appLayout: HTMLDivElement | null): HTMLElement | null {
  const rootNode = appLayout?.getRootNode();
  if (rootNode && 'host' in rootNode && rootNode.host instanceof HTMLElement) {
    return rootNode.host;
  }

  return document.querySelector('chase-cover-configurator, chase-configurator, #chase-cover-configurator-mount, #chase-configurator-mount');
}

function getShopifyMetaProduct(): any {
  const shopifyWindow = window as Window & {
    meta?: { product?: any };
    ShopifyAnalytics?: { meta?: { product?: any; selectedVariantId?: string | number } };
  };

  return shopifyWindow.meta?.product || shopifyWindow.ShopifyAnalytics?.meta?.product;
}

function resolveRuntimeShopifyIds(initialProductId?: string, initialVariantId?: string, appLayout?: HTMLDivElement | null) {
  const host = getConfiguratorHost(appLayout ?? null);
  const params = new URLSearchParams(window.location.search);
  const metaProduct = getShopifyMetaProduct();
  const shopifyWindow = window as Window & {
    ShopifyAnalytics?: { meta?: { selectedVariantId?: string | number } };
  };

  const productSources = [
    { source: 'prop', value: normalizeShopifyId(initialProductId) },
    { source: 'mount-attribute', value: normalizeShopifyId(host?.getAttribute('product-id') || undefined) },
    { source: 'shopify-meta-product', value: normalizeShopifyId(metaProduct?.id) },
  ];

  const variantSources = [
    { source: 'prop', value: normalizeShopifyId(initialVariantId) },
    { source: 'mount-attribute', value: normalizeShopifyId(host?.getAttribute('variant-id') || undefined) },
    { source: 'url-query-variant', value: normalizeShopifyId(params.get('variant') || undefined) },
    { source: 'cart-form', value: readFieldValue(document.querySelector('form[action*="/cart/add"] [name="id"]')) },
    { source: 'product-form', value: readFieldValue(document.querySelector('product-form [name="id"]')) },
    { source: 'data-product-form', value: readFieldValue(document.querySelector('[data-product-form] [name="id"]')) },
    { source: 'hidden-input', value: readFieldValue(document.querySelector('input[name="id"][type="hidden"]')) },
    { source: 'variant-select', value: readFieldValue(document.querySelector('select[name="id"]')) },
    { source: 'shopify-analytics-selected', value: normalizeShopifyId(shopifyWindow.ShopifyAnalytics?.meta?.selectedVariantId) },
    { source: 'shopify-meta-selectedVariantId', value: normalizeShopifyId(metaProduct?.selectedVariantId) },
    { source: 'shopify-meta-selected-or-first', value: normalizeShopifyId(metaProduct?.selected_or_first_available_variant?.id) },
    { source: 'shopify-meta-selected', value: normalizeShopifyId(metaProduct?.selected_variant?.id) },
    { source: 'shopify-meta-first-variant', value: normalizeShopifyId(metaProduct?.variants?.[0]?.id) },
  ];

  const resolvedProduct = productSources.find((entry) => entry.value);
  const resolvedVariant = variantSources.find((entry) => entry.value);

  return {
    productId: resolvedProduct?.value,
    variantId: resolvedVariant?.value,
    debug: {
      hostTag: host?.tagName?.toLowerCase() || null,
      path: window.location.pathname,
      search: window.location.search,
      productSource: resolvedProduct?.source || null,
      variantSource: resolvedVariant?.source || null,
      productSources,
      variantSources,
    },
  };
}


function updateCartBadgeCount(itemCount: number) {
  const selectors = [
    '[data-cart-count]',
    '[data-cart-count-bubble]',
    '.cart-count-bubble',
    '.cart-count',
    '.site-header__cart-count',
    '.header__icon--cart .count-bubble',
  ];

  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      if (!(element instanceof HTMLElement)) continue;
      element.hidden = false;
      element.textContent = String(itemCount);
    }
  }
}

function dispatchCartSyncEvents(cart: ShopifyCart | null) {
  const detail = { cart };
  const eventNames = ['cart:refresh', 'cart:updated', 'cart:update', 'cart:change'];

  for (const eventName of eventNames) {
    const event = new CustomEvent(eventName, { detail });
    document.documentElement.dispatchEvent(event);
    document.dispatchEvent(new CustomEvent(eventName, { detail }));
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

function tryOpenCartUi() {
  const selectors = [
    '[data-cart-toggle]',
    '.cart-icon-bubble',
    '.js-drawer-open-cart',
    '.header__icon--cart button',
    '.site-header__cart',
    'button[aria-controls*="CartDrawer"]',
    '[href="/cart"]',
  ];

  const detailsDrawer = document.querySelector('details[id*="CartDrawer"], details[data-cart-drawer]') as HTMLDetailsElement | null;
  if (detailsDrawer) {
    detailsDrawer.open = true;
    return true;
  }

  const cartDrawer = document.querySelector('cart-drawer, cart-notification, [id*="CartDrawer"]') as (HTMLElement & { open?: () => void; show?: () => void }) | null;
  if (cartDrawer) {
    cartDrawer.setAttribute('open', '');
    cartDrawer.classList.add('active', 'is-open');
    if (typeof cartDrawer.open === 'function') cartDrawer.open();
    if (typeof cartDrawer.show === 'function') cartDrawer.show();
    return true;
  }

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element instanceof HTMLElement) {
      element.click();
      return true;
    }
  }

  return false;
}

function isCartUiOpen(): boolean {
  if (document.querySelector('details[id*="CartDrawer"][open], details[data-cart-drawer][open]')) {
    return true;
  }

  if (document.querySelector('cart-drawer[open], cart-notification[open]')) {
    return true;
  }

  if (document.querySelector('cart-drawer.active, cart-drawer.is-open, cart-notification.active, cart-notification.is-open, [id*="CartDrawer"].active, [id*="CartDrawer"].is-open')) {
    return true;
  }

  return false;
}

function forceOpenCartUi(): boolean {
  const detailsDrawer = document.querySelector('details[id*="CartDrawer"], details[data-cart-drawer]') as HTMLDetailsElement | null;
  if (detailsDrawer) {
    detailsDrawer.open = true;
    return true;
  }

  const cartDrawer = document.querySelector('cart-drawer, cart-notification, [id*="CartDrawer"]') as (HTMLElement & { open?: () => void; show?: () => void }) | null;
  if (cartDrawer) {
    cartDrawer.setAttribute('open', '');
    cartDrawer.classList.add('active', 'is-open');
    if (typeof cartDrawer.open === 'function') cartDrawer.open();
    if (typeof cartDrawer.show === 'function') cartDrawer.show();
    return true;
  }

  return false;
}

function forceCloseCartUi(): boolean {
  let closed = false;

  const detailsDrawer = document.querySelector('details[id*="CartDrawer"][open], details[data-cart-drawer][open]') as HTMLDetailsElement | null;
  if (detailsDrawer) {
    detailsDrawer.open = false;
    closed = true;
  }

  for (const element of document.querySelectorAll('cart-drawer, cart-notification, [id*="CartDrawer"]')) {
    if (!(element instanceof HTMLElement)) continue;
    const isOpen = element.hasAttribute('open')
      || element.classList.contains('active')
      || element.classList.contains('is-open');
    if (!isOpen) continue;

    const drawer = element as HTMLElement & { close?: () => void };
    if (typeof drawer.close === 'function') {
      try { drawer.close(); } catch { /* theme close() may expect an event arg */ }
    }
    element.removeAttribute('open');
    element.classList.remove('active', 'is-open', 'animate');
    closed = true;
  }

  if (closed) {
    window.setTimeout(() => releasePageScrollLockIfCartClosed('premature-open-guard'), 50);
  }
  return closed;
}

/**
 * While an add/buy is in flight, the theme header (and its cart icon) stays
 * clickable above our progress overlay — and the submission-time z-chain
 * raise paints the configurator OVER any drawer that opens early, leaving a
 * half-buried drawer with stale contents (observed live with a slow-
 * propagating copper variant, June 2026). Worse, a drawer that is open
 * during the pre-open section injection re-enters the "innerHTML replaced
 * on an open drawer" failure mode. Until the flow reaches its own
 * drawer-open step, close any cart UI that appears.
 */
function startPrematureCartOpenGuard() {
  let closes = 0;
  const id = window.setInterval(() => {
    if (!isCartUiOpen()) return;
    if (forceCloseCartUi()) {
      closes++;
      DEBUG() && console.log(`[CART] Closed prematurely opened cart UI (x${closes})`);
      if (closes === 1) emitCartDebug('premature-cart-open-closed', {});
    }
  }, 350);
  return { stop: () => window.clearInterval(id) };
}

function releasePageScrollLockIfCartClosed(reason: string) {
  if (isCartUiOpen()) return;

  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
  document.body.classList.remove('overflow-hidden', 'no-scroll');
  document.documentElement.classList.remove('overflow-hidden', 'no-scroll');
  DEBUG() && console.log(`[CART] Released page scroll lock (${reason})`);
}

function getChaseApiBase(): string {
  return (window as any).__chaseApiBase || '';
}

function compactTextSnippet(value: string | null | undefined, maxLen = 220): string {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function buildExpectedPriceTokens(priceText: string | null | undefined): string[] {
  const raw = String(priceText || '').trim();
  if (!raw) return [];

  const normalized = raw.replace(/[$,\s]/g, '');
  const price = Number(normalized);
  if (!Number.isFinite(price)) {
    return Array.from(new Set([raw, `$${raw}`]));
  }

  const formatted = price.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return Array.from(new Set([
    raw,
    normalized,
    `$${raw}`,
    `$${normalized}`,
    formatted,
    `$${formatted}`,
  ]));
}

function buildExpectedImageTokens(imageUrl: string | null | undefined): string[] {
  const raw = String(imageUrl || '').trim();
  if (!raw) return [];

  const filename = raw.split('/').pop()?.split('?')[0] || raw;
  return Array.from(new Set([raw, filename]));
}

function inspectRenderedSectionHtml(
  html: string,
  expected?: { variantId?: number; priceText?: string; imageUrl?: string | null },
) {
  const priceTokens = buildExpectedPriceTokens(expected?.priceText);
  const imageTokens = buildExpectedImageTokens(expected?.imageUrl);
  const hasEmptyStateMarkup = /your cart is empty|drawer__inner-empty|is-empty|cart__warnings/i.test(html);
  const hasCartItemMarkup = /CartDrawer-Item-\d+|class="[^"]*\bcart-item\b|cart-item__media|name="updates\[[^\]]+\]"/i.test(html);
  const hasLoadingState = /Loading\.\.\./i.test(html);

  return {
    length: html.length,
    hasZeroPrice: /\$0(?:\.00)?/.test(html),
    hasExpectedPrice: priceTokens.length > 0 ? priceTokens.some((token) => html.includes(token)) : null,
    hasVariantId: expected?.variantId ? html.includes(String(expected.variantId)) : null,
    hasImageUrl: imageTokens.length > 0 ? imageTokens.some((token) => html.includes(token)) : null,
    hasCartItemMarkup,
    hasLoadingState,
    isEmpty: hasEmptyStateMarkup && !hasCartItemMarkup && !hasLoadingState,
    snippet: compactTextSnippet(html, 260),
  };
}

function isPrimaryCartSectionId(sectionId: string): boolean {
  const normalized = sectionId.toLowerCase();
  return normalized.includes('cart-drawer')
    || normalized.includes('cart-notification')
    || normalized.includes('cart-items')
    || normalized === 'cart';
}

function selectUsableRenderedSections(
  sections: Record<string, string> | null,
  expected?: { variantId?: number; priceText?: string; imageUrl?: string | null },
  requirements?: { requirePrice?: boolean; requireImage?: boolean; requireVariant?: boolean },
) {
  if (!sections) {
    return { usableSections: null as Record<string, string> | null, rejectedSections: null as Record<string, any> | null };
  }

  const usableSections: Record<string, string> = {};
  const rejectedSections: Record<string, any> = {};

  for (const [sectionId, html] of Object.entries(sections)) {
    if (!isPrimaryCartSectionId(sectionId)) {
      usableSections[sectionId] = html;
      continue;
    }

    const summary = inspectRenderedSectionHtml(html, expected);
    // Only reject sections that are empty or show $0.
    // Do NOT require exact price match â€” line totals differ from unit price
    // when quantity > 1 (e.g. 2Ã—$285 = $570, but expectedPriceText is "285.00").
    const shouldReject = summary.isEmpty
      || summary.hasZeroPrice
      || (!!requirements?.requireVariant && !!expected?.variantId && summary.hasVariantId === false)
      || (!!requirements?.requireImage && !!expected?.imageUrl && summary.hasImageUrl === false);

    if (shouldReject) {
      rejectedSections[sectionId] = summary;
      continue;
    }

    usableSections[sectionId] = html;
  }

  return {
    usableSections: Object.keys(usableSections).length > 0 ? usableSections : null,
    rejectedSections: Object.keys(rejectedSections).length > 0 ? rejectedSections : null,
  };
}

function summarizeCartItemForDebug(item: any) {
  if (!item) return null;

  return {
    id: item.id ?? null,
    variantId: item.variant_id ?? null,
    key: item.key ?? null,
    title: item.title ?? null,
    price: item.price ?? null,
    finalLinePrice: item.final_line_price ?? null,
    image: item.image ?? item.featured_image?.url ?? null,
  };
}

function summarizeSectionsForDebug(
  sections: Record<string, string> | null,
  expected?: { variantId?: number; priceText?: string; imageUrl?: string | null },
) {
  if (!sections) return null;

  return Object.fromEntries(
    Object.entries(sections).map(([sectionId, html]) => {
      return [sectionId, inspectRenderedSectionHtml(html, expected)];
    }),
  );
}

function collectCartDomSnapshot() {
  const selectors = [
    'cart-drawer',
    'cart-notification',
    'details[id*="CartDrawer"]',
    '[id="CartDrawer"]',
    '[id*="CartDrawer"]',
  ];

  const seen = new Set<Element>();
  const elements: Element[] = [];
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      if (seen.has(element)) continue;
      seen.add(element);
      elements.push(element);
    }
  }

  return elements.slice(0, 8).map((element, index) => {
    const text = compactTextSnippet(element.textContent || '', 180);
    const moneyMatches = Array.from(new Set((text.match(/\$\s?\d[\d,]*(?:\.\d{2})?/g) || []).slice(0, 6)));
    return {
      index,
      tag: element.tagName.toLowerCase(),
      id: (element as HTMLElement).id || null,
      className: (element as HTMLElement).className || null,
      openAttr: element.hasAttribute('open'),
      hidden: element instanceof HTMLElement ? element.hidden : null,
      moneyTokens: moneyMatches,
      textSnippet: text,
    };
  });
}

function collectSectionMountSnapshot(sectionIds: string[]) {
  return sectionIds.map((sectionId) => {
    const selectorGroups = [
      { kind: 'shopify-section', selector: `[id="shopify-section-${sectionId}"]` },
      { kind: 'data-section', selector: `[data-section="${sectionId}"]` },
      { kind: 'raw-id', selector: `[id="${sectionId}"]` },
    ];

    const matches = selectorGroups.flatMap(({ kind, selector }) =>
      Array.from(document.querySelectorAll(selector)).map((element) => ({
        kind,
        tag: element.tagName.toLowerCase(),
        id: (element as HTMLElement).id || null,
        className: (element as HTMLElement).className || null,
      }))
    );

    return {
      sectionId,
      matchCount: matches.length,
      matches: matches.slice(0, 6),
    };
  });
}

function cartUiContainsExpectedImage(imageUrl: string | null | undefined): boolean {
  const tokens = buildExpectedImageTokens(imageUrl);
  if (tokens.length === 0) return true;

  const selectors = [
    'cart-drawer',
    'cart-notification',
    'details[id*="CartDrawer"]',
    '[id="CartDrawer"]',
    '[id*="CartDrawer"]',
  ];

  const seen = new Set<Element>();
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      if (seen.has(element)) continue;
      seen.add(element);

      const html = element instanceof HTMLElement ? element.innerHTML : '';
      if (tokens.some((token) => html.includes(token))) {
        return true;
      }

      for (const image of element.querySelectorAll('img')) {
        if (tokens.some((token) => image.currentSrc.includes(token) || image.src.includes(token))) {
          return true;
        }
      }
    }
  }

  return false;
}

function emitCartDebug(event: string, payload: Record<string, any>) {
  const apiBase = getChaseApiBase();
  if (!apiBase) return;

  const body = JSON.stringify({
    event,
    at: new Date().toISOString(),
    href: window.location.href,
    routeRoot: getShopifyRouteRoot(),
    ua: navigator.userAgent,
    payload,
  });

  fetch(`${apiBase}/api/cart-debug`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

/* ------------------------------------------------------------------ */
/*  Durable cart-failure telemetry (client side)                       */
/* ------------------------------------------------------------------ */
//
// Terminal Add-to-Cart / Buy-Now failures are buffered in localStorage — the
// network may be down at failure time, so we can't rely on POSTing telemetry
// right then. Buffered records flush to /api/cart-debug (→ Google Sheet) once
// connectivity returns (on mount, on the 'online' event, and right after each
// failure in case the blip already cleared). Everything here is best-effort and
// must never throw into the cart flow. See CLAUDE.md "Cart failure telemetry".

const CART_FAILURE_STORE_KEY = 'cap-cart-failures';
const CART_FAILURE_MAX = 20;

function newRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
      return (crypto as any).randomUUID();
    }
  } catch { /* ignore */ }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function classifyCartError(message?: string): string {
  const m = (message || '').toLowerCase();
  if (m.includes('timed out') || m.includes('timeout')) return 'timeout';
  if (m.includes('failed to fetch') || m.includes('network error') || m.includes('load failed')) return 'network';
  if (m.includes('429') || m.includes('rate limit') || m.includes('throttle') || m.includes('too many')) return 'rate-limit';
  if (m.includes('http error') || m.includes('status')) return 'http';
  return 'other';
}

function getConnectionInfo(): Record<string, any> | null {
  try {
    const c = (navigator as any).connection;
    if (!c) return null;
    return {
      effectiveType: c.effectiveType ?? null,
      downlink: c.downlink ?? null,
      rtt: c.rtt ?? null,
      saveData: c.saveData ?? null,
    };
  } catch { return null; }
}

function summarizeFailedConfig(config: any): Record<string, any> | null {
  if (!config) return null;
  return {
    mount: config.mount, lid: config.lid_type,
    w: config.width, l: config.length,
    vs: config.vertical_skirt, hs: config.horizontal_skirt,
    mat: config.material, pc: config.powder_coat,
    screen: config.screen_height, qty: config.quantity,
  };
}

function readFailureBuffer(): any[] {
  try {
    const raw = localStorage.getItem(CART_FAILURE_STORE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function writeFailureBuffer(records: any[]): void {
  try {
    localStorage.setItem(CART_FAILURE_STORE_KEY, JSON.stringify(records.slice(-CART_FAILURE_MAX)));
  } catch { /* quota / unavailable — drop silently */ }
}

function recordCartFailure(ctx: {
  requestId: string;
  action: 'cart' | 'buy';
  phase: string;
  err: any;
  variantId?: string | number | null;
  variantReused?: boolean | null;
  serverTimingMs?: number | null;
  config: any;
  apiBase: string;
}): void {
  try {
    const record = {
      at: new Date().toISOString(),
      requestId: ctx.requestId,
      action: ctx.action,
      phase: ctx.phase,
      failureKind: ctx.err?.failureKind || classifyCartError(ctx.err?.message),
      errorMessage: String(ctx.err?.message || ctx.err || 'Unknown error').slice(0, 300),
      attemptLog: ctx.err?.attemptLog || null,
      variantId: ctx.variantId ?? null,
      variantIdObtained: ctx.variantId != null,
      variantReused: ctx.variantReused ?? null,
      serverTimingMs: ctx.serverTimingMs ?? null,
      device: {
        ua: navigator.userAgent,
        platform: (navigator as any).platform ?? null,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        iPhoneSafari: isIPhoneSafari(),
      },
      connection: getConnectionInfo(),
      online: navigator.onLine,
      apiReachableAtLoad: isApiReachable(),
      apiBase: ctx.apiBase,
      configSummary: summarizeFailedConfig(ctx.config),
    };
    const buf = readFailureBuffer();
    buf.push(record);
    writeFailureBuffer(buf);
    console.warn('[CART-FAIL]', ctx.action, ctx.phase, record.failureKind, '— buffered for telemetry');
    // The blip may already have cleared; try to flush immediately.
    void flushCartFailureReports(ctx.apiBase);
  } catch (e) {
    DEBUG() && console.warn('[CART-FAIL] could not record failure', e);
  }
}

let _failureFlushInFlight = false;
async function flushCartFailureReports(apiBase: string): Promise<void> {
  if (_failureFlushInFlight || !apiBase) return;
  const pending = readFailureBuffer();
  if (pending.length === 0) return;
  _failureFlushInFlight = true;
  try {
    const res = await fetch(`${apiBase}/api/cart-debug`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'cart-failure-report', reports: pending }),
      keepalive: true,
    });
    if (!res.ok) return;
    const data = await res.json().catch(() => null);
    if (data && data.persisted) {
      const sent = new Set(pending.map(r => `${r.requestId}|${r.at}`));
      const remaining = readFailureBuffer().filter(r => !sent.has(`${r.requestId}|${r.at}`));
      writeFailureBuffer(remaining);
      DEBUG() && console.log('[CART-FAIL] flushed', pending.length, 'record(s) to telemetry sheet');
    }
  } catch { /* keep buffered; retry on next trigger */ } finally {
    _failureFlushInFlight = false;
  }
}

function applySectionUpdatesPreservingCartUi(sections: Record<string, string>, reason: string) {
  const wasOpen = isCartUiOpen();
  applySectionUpdates(sections);

  if (!wasOpen) return;

  window.requestAnimationFrame(() => {
    forceOpenCartUi();
    window.setTimeout(() => releasePageScrollLockIfCartClosed(reason), 150);
  });
}

function cartUiContainsVariant(variantId: number): boolean {
  if (!variantId) return false;
  const token = String(variantId);
  const selectors = [
    'cart-drawer',
    'cart-notification',
    'details[id*="CartDrawer"]',
    '[id="CartDrawer"]',
    '[id*="CartDrawer"]',
  ];

  const seen = new Set<Element>();
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      if (seen.has(element)) continue;
      seen.add(element);
      if (element instanceof HTMLElement && element.innerHTML.includes(token)) {
        return true;
      }
    }
  }

  return false;
}

let drawerCatchUpToken = 0;

/**
 * Post-open drawer self-correction. Shopify's rendered cart sections can lag
 * /cart.js by several seconds for freshly created variants, so the drawer can
 * open before its HTML includes the new line item (badge says 1, drawer looks
 * stale). The theme ignores our custom cart events, so without this the stale
 * drawer never fixes itself. This polls in the background and injects the
 * fresh drawer HTML once Shopify renders it, via the same
 * applySectionUpdatesPreservingCartUi helper that the post-image refresh and
 * pageshow resync already use in production. Touches ONLY the cart drawer
 * section wrapper — nothing else on the page.
 */
function startPostOpenDrawerCatchUp(opts: {
  variantId: number;
  sectionIds: string[];
  expectedPriceText?: string;
  cartDataForEvents?: any;
}) {
  const { variantId, sectionIds, expectedPriceText, cartDataForEvents } = opts;
  if (!variantId || sectionIds.length === 0) return;

  const token = ++drawerCatchUpToken;
  const startedAt = Date.now();
  const MAX_MS = 45000;
  // First check soon after open (happy path costs nothing — the variant check
  // below exits before any fetch); normal cadence afterwards; stretched when
  // the storefront is rate-limiting us so we stop feeding the bot score.
  const FIRST_TICK_MS = 700;
  const INTERVAL_MS = 2500;
  const THROTTLED_INTERVAL_MS = 5000;
  let attempts = 0;
  let nextDelay = INTERVAL_MS;

  const tick = async () => {
    if (token !== drawerCatchUpToken) return; // superseded by a newer add
    if (cartUiContainsVariant(variantId)) {
      DEBUG() && console.log(`[CART] Drawer shows variant ${variantId} — catch-up done after ${attempts} poll(s)`);
      return;
    }
    if (Date.now() - startedAt > MAX_MS) {
      emitCartDebug('post-open-catchup-exhausted', { variantId, attempts });
      return;
    }

    attempts++;
    try {
      const fetched = await fetchRenderedSections(sectionIds, 'CART-CATCHUP');
      if (isThrottleStatus(fetched.status)) {
        nextDelay = THROTTLED_INTERVAL_MS;
        noteStorefrontRateLimited('sections', fetched.status, 'CART-CATCHUP', attempts);
      } else {
        nextDelay = INTERVAL_MS;
      }
      const selection = selectUsableRenderedSections(
        fetched.sections,
        { variantId, priceText: expectedPriceText },
        { requireVariant: true },
      );
      const primaryReady = !!selection.usableSections
        && Object.keys(selection.usableSections).some(isPrimaryCartSectionId);

      if (token !== drawerCatchUpToken) return;
      if (primaryReady && !cartUiContainsVariant(variantId)) {
        applySectionUpdatesPreservingCartUi(selection.usableSections!, 'post-open-catchup');
        dispatchCartSyncEvents(cartDataForEvents ?? null);
        emitCartDebug('post-open-catchup-applied', {
          variantId,
          attempts,
          ms: Date.now() - startedAt,
        });
        return;
      }
    } catch { /* transient — keep polling */ }

    window.setTimeout(tick, nextDelay);
  };

  window.setTimeout(tick, FIRST_TICK_MS);
}

function removeConfigurationOptionRows(root: ParentNode) {
  const removePropertyRow = (element: Element) => {
    const wrapper = element.closest('.product-option') || element.parentElement;
    if (wrapper) {
      wrapper.remove();
      return;
    }

    const next = element.nextElementSibling;
    if (next?.tagName.toLowerCase() === 'dd') next.remove();
    element.remove();
  };

  const setInlinePropertyRow = (element: Element, label: string, value: string) => {
    const labelNode = document.createElement('span');
    labelNode.textContent = `${label}:`;
    labelNode.style.color = 'rgba(18, 18, 18, 0.55)';
    labelNode.style.fontWeight = '400';

    element.replaceChildren(labelNode, document.createTextNode(` ${value}`));
  };

  const normalizeCartPropertyLabel = (raw: string): string => {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text) return text;
    if (/^Holes:?$/i.test(text)) return '';

    const holeMatch = text.match(/^H(\d)(?:\s*)\(([^)]+)\):?$/i) || text.match(/^Hole\s*(\d)(?:\s*)\(([^)]+)\):?$/i);
    if (holeMatch) {
      return `Hole ${holeMatch[1]}(${holeMatch[2]})`;
    }

    const simpleHoleMatch = text.match(/^H(\d):?$/i);
    if (simpleHoleMatch) {
      return `Hole ${simpleHoleMatch[1]}`;
    }

    if (/^(?:H\d|Hole\s*\d)\s+Position:?$/i.test(text)) {
      return 'Position';
    }

    return text;
  };

  for (const dt of root.querySelectorAll('dt')) {
    const text = dt.textContent?.replace(/\s+/g, ' ').trim() || '';
    if (!/^Configuration:?$/i.test(text)) continue;
    removePropertyRow(dt);
  }

  for (const dt of root.querySelectorAll('dt')) {
    const text = dt.textContent?.replace(/\s+/g, ' ').trim() || '';
    const normalized = normalizeCartPropertyLabel(text);
    if (!normalized) {
      removePropertyRow(dt);
      continue;
    }
    if (normalized !== text) {
      dt.textContent = normalized;
    }
  }

  const rowSelectors = ['.product-option', '.cart-item__details > div', '.cart-item__details li', 'li', 'p', 'div'];
  for (const selector of rowSelectors) {
    for (const element of root.querySelectorAll(selector)) {
      const text = element.textContent?.replace(/\s+/g, ' ').trim() || '';
      if (!/^Configuration:\s*MFC-[A-Za-z0-9_-]+/i.test(text)) continue;
      element.remove();
    }
  }

  const flatRowSelectors = ['.cart-item__details > div', '.cart-item__details li', 'li', 'p'];
  for (const selector of flatRowSelectors) {
    for (const element of root.querySelectorAll(selector)) {
      if (element.children.length > 0) continue;

      const text = element.textContent?.replace(/\s+/g, ' ').trim() || '';
      if (!text) continue;

      if (/^Holes:\s*\d+/i.test(text)) {
        element.remove();
        continue;
      }

      const optionsMatch = text.match(/^Options:\s*(.+)$/i);
      if (optionsMatch) {
        const normalizedOptions = optionsMatch[1]
          .replace(/\s*[·•]\s*/g, ' | ')
          .replace(/\s+\.\s+/g, ' | ')
          .replace(/\s{2,}/g, ' ')
          .trim();
        setInlinePropertyRow(element, 'Options', normalizedOptions);
        continue;
      }

      const holeValueMatch = text.match(/^(?:H|Hole\s*)(\d)(?:\s*)\(([^)]+)\):\s*(.+)$/i);
      if (holeValueMatch) {
        setInlinePropertyRow(element, `Hole ${holeValueMatch[1]}(${holeValueMatch[2]})`, holeValueMatch[3]);
        continue;
      }

      const simpleHoleValueMatch = text.match(/^H(\d):\s*(.+)$/i);
      if (simpleHoleValueMatch) {
        setInlinePropertyRow(element, `Hole ${simpleHoleValueMatch[1]}`, simpleHoleValueMatch[2]);
        continue;
      }

      const positionValueMatch = text.match(/^(?:H\d|Hole\s*\d)\s+Position:\s*(.+)$/i);
      if (positionValueMatch) {
        setInlinePropertyRow(element, 'Position', positionValueMatch[1]);
      }
    }
  }
}

function getShopifyRouteRoot(): string {
  const root = (window as Window & { Shopify?: { routes?: { root?: string } } }).Shopify?.routes?.root || '/';
  return root.endsWith('/') ? root : `${root}/`;
}

function buildShopifyPath(path: string, searchParams?: Record<string, string | number | undefined>): string {
  const normalizedPath = path.replace(/^\/+/, '');
  const url = new URL(`${getShopifyRouteRoot()}${normalizedPath}`, window.location.origin);

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value == null) continue;
      url.searchParams.set(key, String(value));
    }
  }

  return `${url.pathname}${url.search}`;
}

function getCurrentPageContextPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function isIPhoneSafari(): boolean {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(ua);
  return isIOS && isSafari;
}

function getForegroundWaitBudgetMs(tag: 'CART' | 'BUY'): number {
  const iPhoneSafari = isIPhoneSafari();
  const ms = iPhoneSafari ? 30000 : 25000;
  DEBUG() && console.log(`[${tag}] Foreground wait budget: ${ms}ms | routeRoot=${getShopifyRouteRoot()} | page=${getCurrentPageContextPath()} | iPhoneSafari=${iPhoneSafari}`);
  return ms;
}

function formatCheckoutErrorMessage(rawMessage: string, action: 'cart' | 'buy'): string {
  const message = (rawMessage || '').trim();
  const lower = message.toLowerCase();
  const actionLabel = action === 'cart' ? 'add this item to the cart' : 'start checkout';

  if (lower.includes('request timed out') || lower.includes('timed out')) {
    return `This is taking longer than expected, so we couldn't ${actionLabel}. Please refresh the page and try again. If it keeps happening, please check your connection and try once more.`;
  }

  if (lower.includes('network error') || lower.includes('failed to fetch') || lower.includes('load failed')) {
    return `We hit a network issue while trying to ${actionLabel}. Please refresh the page and try again. If the problem continues, please check your connection and try once more.`;
  }

  if (lower.includes('already be in the cart')) {
    return `Your item may already be in the cart. The store is busy right now — please open the cart page to check before trying again.`;
  }

  if (lower.includes('too many') || lower.includes('rate limit') || lower.includes('429') || lower.includes('throttle')) {
    return `The store is busy right now, so we couldn't ${actionLabel}. Opening the store's cart page once, then returning here to try again, usually clears this.`;
  }

  if (lower.includes('shopify is still finalizing your price')) {
    return `Your configuration is still syncing with Shopify. Please wait a moment, then refresh the page and try again.`;
  }

  if (lower.includes('http error') || lower.includes('internal server error') || lower.includes('failed to create variant')) {
    return `We couldn't ${actionLabel} right now. Please refresh the page and try again in a moment.`;
  }

  return `${message || `We couldn't ${actionLabel} right now.`} Please refresh the page and try again.`;
}

const ADD_TO_CART_API_TIMEOUT_MS = 30000;
// 5 attempts with the backoff below spans ~12s of wall-clock for fast-rejecting
// network errors (mobile-data blips: tower handoff, weak signal). The old 3
// attempts / ~3s window gave up before a transient drop could recover. Timeouts
// are still capped at 2 attempts (see timeoutRetryExhausted) so a genuinely
// stuck cold start can't run 5×30s.
const ADD_TO_CART_API_MAX_ATTEMPTS = 5;
const RETRYABLE_ADD_TO_CART_STATUS = new Set([429, 502, 503, 504]);

function getAddToCartApiRetryDelayMs(attempt: number): number {
  const base = Math.min(3500, 600 * (2 ** Math.max(0, attempt - 1)));
  return base + Math.round(Math.random() * 350);
}

async function postAddToCartApi(opts: {
  apiBase: string;
  payload: Record<string, any>;
  tag: 'CART' | 'BUY';
}): Promise<{
  res: Response;
  data: any;
  attempts: number;
  totalMs: number;
}> {
  const { apiBase, payload, tag } = opts;
  const requestBody = JSON.stringify(payload);
  const startedAt = performance.now();
  let lastFetchErr: any = null;
  let lastWasTimeout = false;
  // Per-attempt timeline — attached to the thrown error so the failure record
  // (and the telemetry sheet) shows exactly how each attempt died.
  const attemptLog: Array<{ attempt: number; reason: string; status?: number; attemptMs: number; message?: string }> = [];

  for (let attempt = 1; attempt <= ADD_TO_CART_API_MAX_ATTEMPTS; attempt++) {
    const attemptStartedAt = performance.now();
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), ADD_TO_CART_API_TIMEOUT_MS);

    try {
      const res = await fetch(`${apiBase}/api/add-to-cart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody,
        signal: controller.signal,
      });

      const data = await res.json().catch(() => null);
      const attemptMs = Math.round(performance.now() - attemptStartedAt);
      const totalMs = Math.round(performance.now() - startedAt);
      const shouldRetry = !res.ok
        && RETRYABLE_ADD_TO_CART_STATUS.has(res.status)
        && attempt < ADD_TO_CART_API_MAX_ATTEMPTS;

      if (!shouldRetry) {
        if (attempt > 1) {
          emitCartDebug('api-request-recovered', {
            tag,
            attempt,
            status: res.status,
            ok: res.ok,
            attemptMs,
            totalMs,
          });
        }
        return { res, data, attempts: attempt, totalMs };
      }

      const delayMs = getAddToCartApiRetryDelayMs(attempt);
      attemptLog.push({ attempt, reason: 'http', status: res.status, attemptMs });
      console.warn(`[${tag}] /api/add-to-cart retry ${attempt}/${ADD_TO_CART_API_MAX_ATTEMPTS} after HTTP ${res.status} (${attemptMs}ms)`);
      emitCartDebug('api-request-retry', {
        tag,
        attempt,
        maxAttempts: ADD_TO_CART_API_MAX_ATTEMPTS,
        reason: 'http',
        status: res.status,
        attemptMs,
        totalMs,
        delayMs,
        error: data?.error || null,
      });
      await new Promise(resolve => window.setTimeout(resolve, delayMs));
    } catch (fetchErr: any) {
      const attemptMs = Math.round(performance.now() - attemptStartedAt);
      const totalMs = Math.round(performance.now() - startedAt);
      const timedOut = fetchErr?.name === 'AbortError';
      lastFetchErr = fetchErr;
      lastWasTimeout = timedOut;

      // A timeout usually means a cold start or transient stall, not a dead end —
      // give it ONE retry (previously a timeout failed instantly with no retry).
      // Pure network errors retry up to the attempt cap as before.
      const timeoutRetryExhausted = timedOut && attempt >= 2;
      if (timeoutRetryExhausted || attempt >= ADD_TO_CART_API_MAX_ATTEMPTS) {
        attemptLog.push({ attempt, reason: timedOut ? 'timeout' : 'network', attemptMs, message: fetchErr?.message || undefined });
        emitCartDebug('api-request-failed', {
          tag,
          attempt,
          maxAttempts: ADD_TO_CART_API_MAX_ATTEMPTS,
          reason: timedOut ? 'timeout' : 'network',
          attemptMs,
          totalMs,
          message: fetchErr?.message || null,
        });
        break;
      }

      // Force a fresh connection before retrying — a stale/poisoned HTTP/2 pool
      // makes every reuse fail instantly, so back-to-back retries on the same
      // pool all die the same way. A cache-busted GET re-establishes it (same
      // idea as the page-load warm-up, applied mid-flow).
      try {
        void fetch(`${apiBase}/api/pricing?warm=${Date.now()}`, { cache: 'no-store' }).catch(() => { /* ignore */ });
      } catch { /* ignore */ }

      const delayMs = getAddToCartApiRetryDelayMs(attempt);
      attemptLog.push({ attempt, reason: timedOut ? 'timeout' : 'network', attemptMs, message: fetchErr?.message || undefined });
      console.warn(`[${tag}] /api/add-to-cart retry ${attempt}/${ADD_TO_CART_API_MAX_ATTEMPTS} after ${timedOut ? 'timeout' : 'network error'}: ${fetchErr?.message || 'unknown'} (${attemptMs}ms)`);
      emitCartDebug('api-request-retry', {
        tag,
        attempt,
        maxAttempts: ADD_TO_CART_API_MAX_ATTEMPTS,
        reason: timedOut ? 'timeout' : 'network',
        attemptMs,
        totalMs,
        delayMs,
        message: fetchErr?.message || null,
      });
      await new Promise(resolve => window.setTimeout(resolve, delayMs));
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  if (lastWasTimeout) {
    const err: any = new Error('Request timed out. Please check your connection and try again.');
    err.attemptLog = attemptLog;
    err.failureKind = 'timeout';
    throw err;
  }

  DEBUG() && console.warn(`[${tag}] /api/add-to-cart exhausted retries`, lastFetchErr?.message || lastFetchErr);
  const err: any = new Error('Network error. Please check your connection and try again.');
  err.attemptLog = attemptLog;
  err.failureKind = 'network';
  throw err;
}

function findTargetCartItem(cartData: any, variantId: number) {
  return (cartData?.items || []).find(
    (item: any) => item.variant_id === variantId || item.id === variantId
  ) || null;
}

function getCartItemPrice(item: any): number {
  const value = item?.final_line_price ?? item?.price ?? 0;
  return typeof value === 'number' ? value : Number(value) || 0;
}

function extractRenderedSections(payload: any, sectionIds: string[]): Record<string, string> | null {
  if (!payload?.sections || typeof payload.sections !== 'object') return null;

  const rendered: Record<string, string> = {};
  for (const sectionId of sectionIds) {
    const html = payload.sections?.[sectionId];
    if (typeof html === 'string' && html.trim()) {
      rendered[sectionId] = html;
    }
  }

  return Object.keys(rendered).length > 0 ? rendered : null;
}

function selectPendingCartSections(
  sections: Record<string, string> | null,
  variantId: number,
  expectedPriceText?: string,
) {
  const usable = selectUsableRenderedSections(
    sections,
    { variantId, priceText: expectedPriceText },
    { requireVariant: true },
  ).usableSections;
  if (!usable) return null;

  // Only treat the result as "display-ready" when the primary cart section
  // (the drawer itself) is present and valid. Non-primary sections like
  // cart-icon-bubble pass validation unchecked, and a bubble-only result here
  // short-circuited the retry loop before the price was verified — opening a
  // drawer whose contents didn't include the new item.
  return Object.keys(usable).some(isPrimaryCartSectionId) ? usable : null;
}

/** Shopify bot protection answers 429 (rate limit) or 430 (security rejection). */
function isThrottleStatus(status: number): boolean {
  return status === 429 || status === 430;
}

// One telemetry post per add/buy flow (reset at flow entry) — a blocked IP
// would otherwise spam /api/cart-debug with hundreds of events.
let throttleTelemetrySent = false;
function resetThrottleTelemetry() { throttleTelemetrySent = false; }
function noteStorefrontRateLimited(endpoint: 'sections' | 'cart-js' | 'cart-add', status: number, tag: string, hits: number) {
  if (throttleTelemetrySent) return;
  throttleTelemetrySent = true;
  emitCartDebug('storefront-rate-limited', { endpoint, status, tag, hits });
}

async function fetchCartState(tag: string): Promise<{ cart: any | null; status: number }> {
  try {
    const res = await fetch(
      buildShopifyPath('cart.js', { _: Date.now() }),
      { cache: 'no-store' }
    );
    if (!res.ok) {
      console.warn(`[${tag}] Cart JSON fetch failed: HTTP ${res.status}`);
      return { cart: null, status: res.status };
    }
    return { cart: await res.json(), status: res.status };
  } catch (e: any) {
    console.warn(`[${tag}] Cart JSON fetch error: ${e?.message}`);
    return { cart: null, status: 0 };
  }
}

async function fetchRenderedSections(sectionIds: string[], tag: string): Promise<{ sections: Record<string, string> | null; status: number }> {
  if (sectionIds.length === 0) return { sections: null, status: 0 };

  try {
    const url = new URL(getCurrentPageContextPath(), window.location.origin);
    url.searchParams.set('sections', sectionIds.join(','));
    url.searchParams.set('_', String(Date.now()));

    const requestPath = `${url.pathname}${url.search}`;
    DEBUG() && console.log(`[${tag}] Fetching rendered sections from ${requestPath}`);

    const res = await fetch(requestPath, { cache: 'no-store' });
    if (!res.ok) {
      // The status matters to callers: 429/430 means the storefront is
      // rate-limiting us and further polling is pointless AND harmful
      // (failed polls feed the bot score too).
      console.warn(`[${tag}] Section fetch failed: HTTP ${res.status}`);
      return { sections: null, status: res.status };
    }

    const data = await res.json().catch(() => null);
    if (!data || typeof data !== 'object') {
      console.warn(`[${tag}] Section fetch returned non-JSON or empty response`);
      return { sections: null, status: res.status };
    }

    const rendered: Record<string, string> = {};
    for (const sectionId of sectionIds) {
      const html = data[sectionId];
      if (typeof html === 'string' && html.trim()) {
        rendered[sectionId] = html;
      } else if (html == null) {
        console.warn(`[${tag}] Section "${sectionId}" rendered as null`);
      }
    }

    if (Object.keys(rendered).length === 0) {
      console.warn(`[${tag}] No rendered sections returned`);
      return { sections: null, status: res.status };
    }

    DEBUG() && console.log(`[${tag}] Rendered sections fetched: ${Object.keys(rendered).join(', ')}`);
    return { sections: rendered, status: res.status };
  } catch (e: any) {
    console.warn(`[${tag}] Section fetch error: ${e?.message}`);
    return { sections: null, status: 0 };
  }
}

async function syncCartUiFromStorefront(tag: string) {
  const { cart: cartData } = await fetchCartState(tag);
  if (cartData) {
    updateCartBadgeCount(cartData.item_count ?? 0);
    dispatchCartSyncEvents(cartData);
  }

  const sectionIds = discoverCartSectionIds();
  if (sectionIds.length === 0) {
    return cartData;
  }

  const { sections: renderedSections } = await fetchRenderedSections(sectionIds, tag);
  const sectionSelection = selectUsableRenderedSections(renderedSections);
  if (sectionSelection.usableSections) {
    applySectionUpdatesPreservingCartUi(sectionSelection.usableSections, `${tag.toLowerCase()}-sync`);
  }

  return cartData;
}

/* ---- Buy Now cart snapshot & restore ----
 * Buy Now must clear the cart so /checkout contains only the configured item
 * (Shopify's cart checkout always checks out the WHOLE cart) — but native
 * dynamic-checkout buttons never touch the cart, so customers expect their
 * other items to survive. Snapshot the cart lines (variant id, quantity,
 * properties — properties matter: another configured product in the cart
 * keeps its _config_json) to sessionStorage before clearing, and re-add
 * whatever is missing when the customer comes back. Per-tab, one-shot,
 * time-boxed; every failure path degrades to today's behavior (cart stays
 * cleared). Re-adding after a COMPLETED order is correct too — that matches
 * what a native Buy Now would have left in the cart. */
const CART_SNAPSHOT_KEY = 'chimney-cap-cart-snapshot';
const CART_SNAPSHOT_MAX_AGE_MS = 60 * 60 * 1000;

async function saveCartSnapshotBeforeClear(tag: string): Promise<void> {
  try {
    const { cart } = await fetchCartState(`${tag}-SNAPSHOT`);
    const items = (Array.isArray(cart?.items) ? cart.items : [])
      .map((item: any) => ({
        id: Number(item.variant_id ?? item.id),
        quantity: item.quantity || 1,
        properties: item.properties && typeof item.properties === 'object' ? item.properties : undefined,
      }))
      .filter((item: any) => item.id > 0);

    if (items.length === 0) return;
    window.sessionStorage.setItem(CART_SNAPSHOT_KEY, JSON.stringify({ at: Date.now(), items }));
    DEBUG() && console.log(`[${tag}] Cart snapshot saved (${items.length} line(s)) before Buy Now clear`);
  } catch { /* storage/network unavailable — degrade to current behavior */ }
}

async function restoreCartSnapshotIfNeeded(): Promise<boolean> {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(CART_SNAPSHOT_KEY);
    if (raw) window.sessionStorage.removeItem(CART_SNAPSHOT_KEY); // one-shot
  } catch { return false; }
  if (!raw) return false;

  try {
    const snapshot = JSON.parse(raw);
    const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
    if (items.length === 0 || Date.now() - (snapshot?.at || 0) > CART_SNAPSHOT_MAX_AGE_MS) return false;

    const { cart } = await fetchCartState('CART-RESTORE');
    const inCart = new Set((cart?.items || []).map((item: any) => Number(item.variant_id ?? item.id)));
    const missing = items.filter((item: any) => !inCart.has(Number(item.id)));
    if (missing.length === 0) return false;

    DEBUG() && console.log(`[CART-RESTORE] Re-adding ${missing.length} line(s) cleared by Buy Now`);
    const res = await fetch(buildShopifyPath('cart/add.js'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: missing }),
    });

    let restoredCount = res.ok ? missing.length : 0;
    if (!res.ok) {
      // A batch add fails wholesale if one line is bad (e.g. sold out) —
      // retry singly so the rest still come back. Spaced out: zero-gap bursts
      // feed Shopify's per-IP bot score.
      for (const item of missing) {
        await new Promise(r => setTimeout(r, 250));
        const single = await fetch(buildShopifyPath('cart/add.js'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: [item] }),
        }).catch(() => null);
        if (single?.ok) restoredCount++;
      }
    }

    if (restoredCount === 0) {
      // Nothing made it back (e.g. throttle window) — keep the snapshot for
      // the next back-navigation instead of losing the cart.
      try { window.sessionStorage.setItem(CART_SNAPSHOT_KEY, raw); } catch { /* ignore */ }
      return false;
    }

    emitCartDebug('cart-snapshot-restored', { lines: restoredCount, of: missing.length, batchOk: res.ok });
    return true;
  } catch {
    return false;
  }
}

async function waitForUsableRenderedSections(opts: {
  sectionIds: string[];
  tag: string;
  expected?: { variantId?: number; priceText?: string; imageUrl?: string | null };
  requirements?: { requirePrice?: boolean; requireImage?: boolean; requireVariant?: boolean };
  maxWaitMs: number;
  delayMs?: number;
  seedSections?: Array<{ source: string; sections: Record<string, string> | null }>;
}): Promise<{
  usableSections: Record<string, string> | null;
  rejectedSections: Record<string, any> | null;
  source: string | null;
  rateLimited?: boolean;
}> {
  const {
    sectionIds,
    tag,
    expected,
    requirements,
    maxWaitMs,
    delayMs = 1500,
    seedSections = [],
  } = opts;

  // "Ready" must include the primary cart section (the drawer itself).
  // Non-primary sections (e.g. cart-icon-bubble) pass validation unchecked,
  // so without this a bubble-only result would count as success and the
  // drawer would open with stale contents — badge updated, item invisible.
  const wantsPrimarySection = sectionIds.some(isPrimaryCartSectionId);
  const selectionReady = (usable: Record<string, string> | null): boolean =>
    !!usable && (!wantsPrimarySection || Object.keys(usable).some(isPrimaryCartSectionId));

  let lastRejectedSections: Record<string, any> | null = null;

  for (const seed of seedSections) {
    if (!seed.sections) continue;
    const selection = selectUsableRenderedSections(seed.sections, expected, requirements);
    if (selectionReady(selection.usableSections)) {
      return {
        usableSections: selection.usableSections,
        rejectedSections: selection.rejectedSections,
        source: seed.source,
      };
    }
    if (selection.rejectedSections) {
      lastRejectedSections = selection.rejectedSections;
    }
  }

  if (sectionIds.length === 0 || maxWaitMs <= 0) {
    return {
      usableSections: null,
      rejectedSections: lastRejectedSections,
      source: null,
    };
  }

  const start = Date.now();
  let attempt = 0;
  let throttleStreak = 0;

  while (Date.now() - start < maxWaitMs) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }
    attempt++;

    const fetched = await fetchRenderedSections(sectionIds, tag);

    if (isThrottleStatus(fetched.status)) {
      throttleStreak++;
      if (throttleStreak >= 2) {
        // The storefront is rate-limiting our section reads — further polling
        // is pointless (we'd never get usable HTML) and harmful (failed polls
        // feed the bot score). Bail and let the caller decide what to show.
        console.warn(`[${tag}] Section fetches rate limited ${throttleStreak}x — bailing out early`);
        noteStorefrontRateLimited('sections', fetched.status, tag, throttleStreak);
        return {
          usableSections: null,
          rejectedSections: lastRejectedSections,
          source: null,
          rateLimited: true,
        };
      }
    } else {
      throttleStreak = 0;
    }

    const selection = selectUsableRenderedSections(fetched.sections, expected, requirements);
    if (selectionReady(selection.usableSections)) {
      return {
        usableSections: selection.usableSections,
        rejectedSections: selection.rejectedSections,
        source: `${tag.toLowerCase()}-attempt-${attempt}`,
      };
    }

    if (selection.rejectedSections) {
      lastRejectedSections = selection.rejectedSections;
      console.warn(`[${tag}] Rendered cart sections still not ready (attempt ${attempt})`);
    }
  }

  return {
    usableSections: null,
    rejectedSections: lastRejectedSections,
    source: null,
  };
}

/**
 * Capture the 3D viewer canvas as a JPEG with white background.
 * WebGL canvases have transparency â€” compositing onto white prevents black artifacts.
 */
function waitForNextFrame() {
  // Resolve on the next animation frame OR after a short timer, whichever fires
  // first. requestAnimationFrame is throttled/suspended when the tab is
  // backgrounded — without the timer fallback the screenshot capture (which
  // awaits this) would hang indefinitely if the user switches tabs mid-export.
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    window.requestAnimationFrame(finish);
    window.setTimeout(finish, 150);
  });
}

async function waitForPromiseWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<{ resolved: boolean; value: T | null }> {
  let timeoutId = 0;

  try {
    const result = await Promise.race([
      promise.then((value) => ({ resolved: true as const, value })),
      new Promise<{ resolved: false; value: null }>((resolve) => {
        timeoutId = window.setTimeout(() => resolve({ resolved: false, value: null }), timeoutMs);
      }),
    ]);

    return result;
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
}

// Trims the empty white border around the rendered model on a white-composited
// canvas, returning a tightly-cropped canvas so the product fills the frame
// (a flat/wide model otherwise leaves large margins in the square-ish viewport,
// which then show as whitespace in the cart image + PDF hero). Scans for the
// non-white content bounds, pads slightly, and redraws onto a new white canvas.
// Returns the original on any failure or if there's nothing to trim.
function cropCanvasToContent(src: HTMLCanvasElement, padFrac = 0.05): HTMLCanvasElement {
  try {
    const ctx = src.getContext('2d');
    if (!ctx) return src;
    const w = src.width;
    const h = src.height;
    if (!w || !h) return src;
    const { data } = ctx.getImageData(0, 0, w, h);
    const T = 247; // pixels with R,G,B all >= T are treated as background white
    const step = Math.max(1, Math.round(Math.min(w, h) / 600)); // subsample big canvases
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y += step) {
      const row = y * w;
      for (let x = 0; x < w; x += step) {
        const i = (row + x) * 4;
        if (data[i] < T || data[i + 1] < T || data[i + 2] < T) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) return src; // entirely white → nothing to crop
    const padX = Math.round((maxX - minX) * padFrac);
    const padY = Math.round((maxY - minY) * padFrac);
    minX = Math.max(0, minX - padX);
    minY = Math.max(0, minY - padY);
    maxX = Math.min(w - 1, maxX + padX);
    maxY = Math.min(h - 1, maxY + padY);
    const cw = maxX - minX + 1;
    const ch = maxY - minY + 1;
    if (cw >= w && ch >= h) return src; // already tight
    const out = document.createElement('canvas');
    out.width = cw;
    out.height = ch;
    const octx = out.getContext('2d');
    if (!octx) return src;
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, cw, ch);
    octx.drawImage(src, minX, minY, cw, ch, 0, 0, cw, ch);
    return out;
  } catch {
    return src;
  }
}

// Encodes a canvas to a JPEG data URL guaranteed under the variant-image upload
// limit (~525KB / ~700k base64 chars): first downscale very large captures (a
// high-DPR 3D canvas can be 1600px+), then step quality down if still over.
// Without this a big, detailed render (e.g. a 90"x90" model on a Retina screen)
// can 413 at /api/variant-image — which isn't retried — leaving the variant
// imageless (cart falls back to the default product photo).
function canvasToJpegUnderLimit(src: HTMLCanvasElement, maxBase64 = 680000): string {
  let canvas = src;
  const MAX_DIM = 1400;
  const big = Math.max(src.width, src.height);
  if (big > MAX_DIM) {
    try {
      const scale = MAX_DIM / big;
      const sc = document.createElement('canvas');
      sc.width = Math.max(1, Math.round(src.width * scale));
      sc.height = Math.max(1, Math.round(src.height * scale));
      const sctx = sc.getContext('2d');
      if (sctx) {
        sctx.fillStyle = '#ffffff';
        sctx.fillRect(0, 0, sc.width, sc.height);
        sctx.drawImage(src, 0, 0, sc.width, sc.height);
        canvas = sc;
      }
    } catch { /* fall back to the original canvas */ }
  }
  let q = 0.85;
  let data = canvas.toDataURL('image/jpeg', q);
  while (data.length > maxBase64 && q > 0.5) {
    q = Math.round((q - 0.12) * 100) / 100;
    data = canvas.toDataURL('image/jpeg', q);
  }
  return data;
}

async function captureCanvasScreenshot(
  appLayoutRef: React.RefObject<HTMLDivElement | null>,
  options?: { resetView?: boolean; hideLabels?: boolean; framed?: boolean }
): Promise<string | undefined> {
  try {
    if (options?.resetView) {
      if (options?.framed) {
        // PDF only: save the user's camera, frame to the bounding box for a
        // consistent size, and restore the live camera afterwards (in finally).
        cameraActions.snapshot();
        cameraActions.fitView();
      } else {
        // Cart/buy: the light, last-night reset view — no bounding-box math,
        // nothing to restore. Keeps the per-add work minimal on mobile.
        cameraActions.reset();
      }
      // Let OrbitControls and the canvas render settle before grabbing the image.
      await waitForNextFrame();
      await waitForNextFrame();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 60));
    }

    let canvasEl: HTMLCanvasElement | null = null;
    const rootNode = appLayoutRef.current?.getRootNode();
    if (rootNode && rootNode !== document) {
      canvasEl = (rootNode as ShadowRoot).querySelector('canvas');
    }
    if (!canvasEl && appLayoutRef.current) canvasEl = appLayoutRef.current.querySelector('canvas');
    if (!canvasEl) canvasEl = document.querySelector('canvas');
    if (!canvasEl) return undefined;

    let result: string;
    try {
      const tmp = document.createElement('canvas');
      tmp.width = canvasEl.width;
      tmp.height = canvasEl.height;
      const ctx2d = tmp.getContext('2d');
      if (ctx2d) {
        ctx2d.fillStyle = '#ffffff';
        ctx2d.fillRect(0, 0, tmp.width, tmp.height);
        ctx2d.drawImage(canvasEl, 0, 0);
        // PDF only: trim the white border so the hero fills the frame. The cart/buy
        // capture stays LIGHT — no full-canvas getImageData scan — so rapid adds on
        // a phone don't build up memory pressure. The size guard still bounds the
        // upload size (and prevents the 413 that left a variant imageless).
        const outCanvas = options?.framed ? cropCanvasToContent(tmp) : tmp;
        result = canvasToJpegUnderLimit(outCanvas);
      } else {
        result = canvasEl.toDataURL('image/jpeg', 0.85);
      }
    } catch {
      result = canvasEl.toDataURL('image/jpeg', 0.85);
    }
    const kb = Math.round(result.length * 0.75 / 1024);
    DEBUG() && console.log(`[IMG] Screenshot captured: ~${kb}KB (JPEG 85% white-bg)`);
    return result;
  } catch {
    return undefined;
  } finally {
    // Put the live camera back where the user had it (only the PDF path moved it
    // via fitView; the cart/buy reset() path matches last night's behavior).
    if (options?.resetView && options?.framed) cameraActions.restore();
  }
}

/**
 * Upload the 3D screenshot to /api/variant-image with retries. A variant
 * without its image falls back to the default product photo in cart and
 * checkout (confusing for custom configs), so transient failures — Shopify
 * Admin throttling under rapid adds, flaky mobile networks — are retried.
 * 413 (image too large) is NOT retried: the identical payload cannot succeed.
 * Final failure emits telemetry so it's visible in Vercel logs.
 */
async function uploadVariantImageWithRetry(opts: {
  apiBase: string;
  variantId: string | number;
  productId: string | null | undefined;
  image: string;
  tag: string;
  maxAttempts?: number;
}): Promise<string | null> {
  const { apiBase, variantId, productId, image, tag, maxAttempts = 3 } = opts;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = performance.now();
    try {
      const res = await fetch(`${apiBase}/api/variant-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantId, productId, image }),
      });
      const ms = Math.round(performance.now() - startedAt);

      if (res.ok) {
        const data = await res.json().catch(() => null);
        const url = data?.imageUrl ?? null;
        DEBUG() && console.log(`[IMG] [${tag}] Upload ok on attempt ${attempt}/${maxAttempts} (${ms}ms)`);
        return url;
      }

      if (res.status === 413) {
        console.warn(`[IMG] [${tag}] Upload rejected as too large (413) — not retrying`);
        return null;
      }

      console.warn(`[IMG] [${tag}] Upload attempt ${attempt}/${maxAttempts} failed: HTTP ${res.status} (${ms}ms)`);
    } catch (e: any) {
      console.warn(`[IMG] [${tag}] Upload attempt ${attempt}/${maxAttempts} error: ${e?.message}`);
    }

    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, attempt === 1 ? 1500 : 4000));
    }
  }

  emitCartDebug('image-upload-failed', { variantId, attempts: maxAttempts, tag });
  return null;
}

/**
 * Unified add-to-cart with retry: handles both "sold out" (variant not yet
 * visible) AND "$0 price" (variant visible but price not propagated) in a
 * single time-budgeted loop. Propagation is NEVER surfaced as an error.
 *
 * Flow:
 *   1. POST /cart/add.js
 *      - 422 sold-out â†’ backoff, retry (propagation)
 *      - 429 rate limit or other non-propagation error â†’ hard fail
 *   2. 200 OK â†’ check response for $0 price on our specific variant
 *      - $0 â†’ wait 1.5s, poll /cart.js for correct price
 *      - price OK â†’ return success
 *
 * One owner, one timeout budget, one state machine.
 */
async function addToCartWithRetry(opts: {
  cartPayload: Record<string, any>;
  variantId: number;
  sectionIds: string[];
  maxWaitMs: number;
  tag: string;
  expectedPriceText?: string;
  onStep?: (step: string) => void;
}): Promise<{
  ok: boolean;
  cartData: any;
  priceVerified: boolean;
  sectionsHtml: Record<string, string> | null;
  error?: string;
  hardFail?: boolean;
  rateLimited?: boolean;
  pendingPhase?: 'adding' | 'confirm' | 'price-wait';
  attempts: number;
  totalMs: number;
}> {
  const { cartPayload, variantId, sectionIds, maxWaitMs, tag, expectedPriceText, onStep } = opts;
  const start = Date.now();
  const MAX_ATTEMPTS = 20;
  const stepPrefix = tag === 'CART' ? 'cart' : 'buy';
  let attempts = 0;
  let rateLimitHits = 0;
  let readThrottleHits = 0;
  let lastCartData: any = null;
  let lastSectionsHtml: Record<string, string> | null = null;
  let phase: 'adding' | 'confirm' | 'price-wait' = 'adding';

  const payloadWithSections = { ...cartPayload };
  if (sectionIds.length > 0) {
    payloadWithSections.sections = sectionIds.join(',');
    payloadWithSections.sections_url = getCurrentPageContextPath();
  }
  const payloadStr = JSON.stringify(payloadWithSections);

  while (attempts < MAX_ATTEMPTS && Date.now() - start < maxWaitMs) {
    attempts++;
    const elapsed = Math.round((Date.now() - start) / 1000);

    if (phase === 'adding') {
      if (attempts > 1) {
        const base = Math.min(3000, 1500 * (2 ** (attempts - 2)));
        const jitter = Math.round(Math.random() * 400);
        const delay = base + jitter;
        DEBUG() && console.log(`[${tag}] Retry ${attempts} (adding) - ${delay}ms delay (${elapsed}s elapsed)`);
        onStep?.(`${stepPrefix}:syncing`);
        await new Promise(r => setTimeout(r, delay));
      }

      try {
        const res = await fetch(buildShopifyPath('cart/add.js'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payloadStr,
        });

        if (!res.ok) {
          const errorText = await res.text().catch(() => '');
          // Rate-limit/bot-protection responses are full HTML challenge pages —
          // never let that markup become a user-facing error message.
          const looksLikeHtml = /^\s*</.test(errorText);
          const compactError = looksLikeHtml ? '' : errorText.replace(/\s+/g, ' ').trim();

          if (res.status === 422) {
            console.warn(`[${tag}] cart/add.js still propagating: HTTP 422 ${compactError.slice(0, 160)}`);
            onStep?.(`${stepPrefix}:syncing`);
            continue;
          }

          if (res.status === 429) {
            // Shopify per-IP rate limit (reproduced live at ~46 adds/40s).
            // Brief throttles recover with backoff; a SUSTAINED window means
            // every further attempt is wasted — exit early with an honest
            // "store is busy" failure instead of grinding the full budget.
            rateLimitHits++;
            noteStorefrontRateLimited('cart-add', res.status, tag, rateLimitHits);
            if (rateLimitHits >= 3) {
              console.warn(`[${tag}] cart/add.js rate limited ${rateLimitHits}x — giving up early`);
              return {
                ok: false,
                cartData: lastCartData,
                priceVerified: false,
                sectionsHtml: lastSectionsHtml,
                error: 'Rate limited — the store is handling a lot of requests right now.',
                hardFail: true,
                rateLimited: true,
                pendingPhase: phase,
                attempts,
                totalMs: Date.now() - start,
              };
            }
            console.warn(`[${tag}] cart/add.js rate limited (429) — backing off before retry`);
            onStep?.(`${stepPrefix}:syncing`);
            await new Promise(r => setTimeout(r, 3500 + Math.round(Math.random() * 1000)));
            continue;
          }

          return {
            ok: false,
            cartData: lastCartData,
            priceVerified: false,
            sectionsHtml: lastSectionsHtml,
            error: compactError || `Unable to update the cart right now (HTTP ${res.status}).`,
            hardFail: true,
            pendingPhase: phase,
            attempts,
            totalMs: Date.now() - start,
          };
        }

        lastCartData = await res.json().catch(() => null);
        lastSectionsHtml = extractRenderedSections(lastCartData, sectionIds);
        const bundledUsableSections = selectPendingCartSections(lastSectionsHtml, variantId, expectedPriceText);
        if (bundledUsableSections) {
          DEBUG() && console.log(`[${tag}] cart/add.js returned usable rendered sections (${attempts} attempts, ${elapsed}s)`);
          return {
            ok: true,
            cartData: lastCartData,
            priceVerified: false,
            sectionsHtml: bundledUsableSections,
            attempts,
            totalMs: Date.now() - start,
          };
        }

        const { cart: confirmedCart } = await fetchCartState(`${tag}-CONFIRM`);
        if (confirmedCart) {
          lastCartData = confirmedCart;
          const confirmedItem = findTargetCartItem(confirmedCart, variantId);
          const confirmedPrice = getCartItemPrice(confirmedItem);

          if (confirmedItem && confirmedPrice > 0) {
            DEBUG() && console.log(`[${tag}] Cart add confirmed in cart.js, price=${(confirmedPrice / 100).toFixed(2)} (${attempts} attempts, ${elapsed}s)`);
            return {
              ok: true,
              cartData: confirmedCart,
              priceVerified: true,
              sectionsHtml: lastSectionsHtml,
              attempts,
              totalMs: Date.now() - start,
            };
          }

          const confirmedSections = sectionIds.length > 0
            ? (await fetchRenderedSections(sectionIds, `${tag}-SECTIONS-CONFIRM`)).sections
            : null;
          const usableConfirmedSections = selectPendingCartSections(confirmedSections, variantId, expectedPriceText);
          if (usableConfirmedSections) {
            DEBUG() && console.log(`[${tag}] Rendered sections became usable before cart.js price settled (${attempts} attempts, ${elapsed}s)`);
            return {
              ok: true,
              cartData: confirmedCart,
              priceVerified: false,
              sectionsHtml: usableConfirmedSections,
              attempts,
              totalMs: Date.now() - start,
            };
          }

          phase = confirmedItem ? 'price-wait' : 'confirm';
          DEBUG() && console.log(`[${tag}] cart/add.js succeeded; waiting on cart.js (${phase})`);
          onStep?.(`${stepPrefix}:syncing`);
          continue;
        }

        const addedItem = findTargetCartItem(lastCartData, variantId);
        phase = addedItem ? 'price-wait' : 'confirm';
        DEBUG() && console.log(`[${tag}] cart/add.js succeeded but cart.js was unavailable; continuing in ${phase}`);
        onStep?.(`${stepPrefix}:syncing`);
        continue;
      } catch (e: any) {
        console.warn(`[${tag}] cart/add.js network error: ${e?.message}`);
        onStep?.(`${stepPrefix}:syncing`);
        continue;
      }
    }

    const delay = phase === 'confirm' ? 1500 : 2000;
    await new Promise(r => setTimeout(r, delay));

    const cartRead = await fetchCartState(tag);
    const cartData = cartRead.cart;
    if (!cartData) {
      if (isThrottleStatus(cartRead.status)) {
        readThrottleHits++;
        noteStorefrontRateLimited('cart-js', cartRead.status, tag, readThrottleHits);
        if (readThrottleHits >= 3) {
          // The add POST already returned 200 — the item is (very likely) in
          // the cart; only our READS are being rate limited. Grinding the
          // rest of the budget would end in a generic "try again" that
          // invites a duplicate add.
          console.warn(`[${tag}] cart.js reads rate limited ${readThrottleHits}x after successful add — exiting`);
          return {
            ok: false,
            cartData: lastCartData,
            priceVerified: false,
            sectionsHtml: lastSectionsHtml,
            error: 'Rate limited — your item may already be in the cart.',
            hardFail: true,
            rateLimited: true,
            pendingPhase: phase,
            attempts,
            totalMs: Date.now() - start,
          };
        }
      } else {
        readThrottleHits = 0;
      }
      DEBUG() && console.log(`[${tag}] cart.js unavailable while waiting in ${phase} (${elapsed}s)`);
      onStep?.(`${stepPrefix}:syncing`);
      continue;
    }
    readThrottleHits = 0;

    lastCartData = cartData;
    const ourItem = findTargetCartItem(cartData, variantId);
    if (!ourItem) {
      phase = 'confirm';
      DEBUG() && console.log(`[${tag}] Variant ${variantId} not visible in cart.js yet (${elapsed}s)`);
      onStep?.(`${stepPrefix}:syncing`);
      continue;
    }

    const price = getCartItemPrice(ourItem);
    if (price > 0) {
      DEBUG() && console.log(`[${tag}] Cart confirmed in cart.js after ${elapsed}s (${attempts} attempts)`);
      return {
        ok: true,
        cartData,
        priceVerified: true,
        sectionsHtml: lastSectionsHtml,
        attempts,
        totalMs: Date.now() - start,
      };
    }

    const pendingSections = sectionIds.length > 0
      ? (await fetchRenderedSections(sectionIds, `${tag}-SECTIONS-WAIT`)).sections
      : null;
    const usablePendingSections = selectPendingCartSections(pendingSections, variantId, expectedPriceText);
    if (usablePendingSections) {
      DEBUG() && console.log(`[${tag}] Rendered sections became usable while cart.js price was still pending (${elapsed}s)`);
      return {
        ok: true,
        cartData,
        priceVerified: false,
        sectionsHtml: usablePendingSections,
        attempts,
        totalMs: Date.now() - start,
      };
    }

    phase = 'price-wait';
    DEBUG() && console.log(`[${tag}] Variant is in cart, but price is still pending (${elapsed}s)`);
    onStep?.(`${stepPrefix}:syncing`);
  }

  return {
    ok: false,
    cartData: lastCartData,
    priceVerified: false,
    sectionsHtml: lastSectionsHtml,
    hardFail: false,
    rateLimited: rateLimitHits > 0,
    pendingPhase: phase,
    attempts,
    totalMs: Date.now() - start,
  };
}

async function continueCartPreparationUntilVerified(opts: {
  cartPayload: Record<string, any>;
  variantId: number;
  sectionIds: string[];
  pendingPhase: 'adding' | 'confirm' | 'price-wait';
  tag: string;
  expectedPriceText?: string;
  onStep?: (step: string) => void;
}): Promise<{
  ok: boolean;
  cartData: any;
  priceVerified: boolean;
  sectionsHtml: Record<string, string> | null;
  error?: string;
  hardFail?: boolean;
  rateLimited?: boolean;
  pendingPhase?: 'adding' | 'confirm' | 'price-wait';
  attempts: number;
  totalMs: number;
}> {
  const { cartPayload, variantId, sectionIds, pendingPhase, tag, expectedPriceText, onStep } = opts;
  const start = Date.now();
  const MAX_WAIT_MS = 20000;
  const MAX_ATTEMPTS = 20;
  const stepPrefix = tag === 'CART' ? 'cart' : 'buy';
  let attempts = 0;
  let rateLimitHits = 0;
  let readThrottleHits = 0;
  let phase: 'adding' | 'confirm' | 'price-wait' = pendingPhase;
  let lastCartData: any = null;
  let lastSectionsHtml: Record<string, string> | null = null;

  const payloadWithSections = { ...cartPayload };
  if (sectionIds.length > 0) {
    payloadWithSections.sections = sectionIds.join(',');
    payloadWithSections.sections_url = getCurrentPageContextPath();
  }
  const payloadStr = JSON.stringify(payloadWithSections);

  while (attempts < MAX_ATTEMPTS && Date.now() - start < MAX_WAIT_MS) {
    attempts++;
    const elapsed = Math.round((Date.now() - start) / 1000);

    if (phase === 'adding') {
      if (attempts > 1) {
        const delay = 1200 + Math.round(Math.random() * 300);
        await new Promise(r => setTimeout(r, delay));
      }

      try {
        const res = await fetch(buildShopifyPath('cart/add.js'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payloadStr,
        });

        if (!res.ok) {
          const errorText = await res.text().catch(() => '');
          // Rate-limit/bot-protection responses are full HTML challenge pages —
          // never let that markup become a user-facing error message.
          const looksLikeHtml = /^\s*</.test(errorText);
          const compactError = looksLikeHtml ? '' : errorText.replace(/\s+/g, ' ').trim();

          if (res.status === 422) {
            console.warn(`[${tag}] Pending add still propagating: HTTP 422 ${compactError.slice(0, 160)}`);
            onStep?.(`${stepPrefix}:syncing`);
            continue;
          }

          if (res.status === 429) {
            // This is the second-chance loop — the foreground budget already
            // tolerated throttling, so give up after 2 hits here.
            rateLimitHits++;
            noteStorefrontRateLimited('cart-add', res.status, tag, rateLimitHits);
            if (rateLimitHits >= 2) {
              console.warn(`[${tag}] Pending add rate limited ${rateLimitHits}x — giving up early`);
              return {
                ok: false,
                cartData: lastCartData,
                priceVerified: false,
                sectionsHtml: lastSectionsHtml,
                error: 'Rate limited — the store is handling a lot of requests right now.',
                hardFail: true,
                rateLimited: true,
                pendingPhase: phase,
                attempts,
                totalMs: Date.now() - start,
              };
            }
            console.warn(`[${tag}] Pending add rate limited (429) — backing off before retry`);
            onStep?.(`${stepPrefix}:syncing`);
            await new Promise(r => setTimeout(r, 3500 + Math.round(Math.random() * 1000)));
            continue;
          }

          return {
            ok: false,
            cartData: lastCartData,
            priceVerified: false,
            sectionsHtml: lastSectionsHtml,
            error: compactError || `Unable to update the cart right now (HTTP ${res.status}).`,
            hardFail: true,
            pendingPhase: phase,
            attempts,
            totalMs: Date.now() - start,
          };
        }

        lastCartData = await res.json().catch(() => null);
        lastSectionsHtml = extractRenderedSections(lastCartData, sectionIds);
        const bundledUsableSections = selectPendingCartSections(lastSectionsHtml, variantId, expectedPriceText);
        if (bundledUsableSections) {
          DEBUG() && console.log(`[${tag}] Pending add returned usable rendered sections after ${elapsed}s`);
          return {
            ok: true,
            cartData: lastCartData,
            priceVerified: false,
            sectionsHtml: bundledUsableSections,
            attempts,
            totalMs: Date.now() - start,
          };
        }

        const { cart: confirmedCart } = await fetchCartState(`${tag}-PENDING-CONFIRM`);
        if (confirmedCart) {
          lastCartData = confirmedCart;
          const confirmedItem = findTargetCartItem(confirmedCart, variantId);
          const confirmedPrice = getCartItemPrice(confirmedItem);

          if (confirmedItem && confirmedPrice > 0) {
            DEBUG() && console.log(`[${tag}] Pending add confirmed in cart.js after ${elapsed}s`);
            return {
              ok: true,
              cartData: confirmedCart,
              priceVerified: true,
              sectionsHtml: lastSectionsHtml,
              attempts,
              totalMs: Date.now() - start,
            };
          }

          const confirmedSections = sectionIds.length > 0
            ? (await fetchRenderedSections(sectionIds, `${tag}-PENDING-SECTIONS`)).sections
            : null;
          const usableConfirmedSections = selectPendingCartSections(confirmedSections, variantId, expectedPriceText);
          if (usableConfirmedSections) {
            DEBUG() && console.log(`[${tag}] Pending add got usable rendered sections before cart.js price settled (${elapsed}s)`);
            return {
              ok: true,
              cartData: confirmedCart,
              priceVerified: false,
              sectionsHtml: usableConfirmedSections,
              attempts,
              totalMs: Date.now() - start,
            };
          }

          phase = confirmedItem ? 'price-wait' : 'confirm';
          onStep?.(`${stepPrefix}:syncing`);
          continue;
        }

        const addedItem = findTargetCartItem(lastCartData, variantId);
        phase = addedItem ? 'price-wait' : 'confirm';
        onStep?.(`${stepPrefix}:syncing`);
        continue;
      } catch (e: any) {
        console.warn(`[${tag}] Pending add error: ${e?.message}`);
        onStep?.(`${stepPrefix}:syncing`);
        continue;
      }
    }

    await new Promise(r => setTimeout(r, phase === 'confirm' ? 1500 : 2000));

    const cartRead = await fetchCartState(tag);
    const cartData = cartRead.cart;
    if (!cartData) {
      if (isThrottleStatus(cartRead.status)) {
        readThrottleHits++;
        noteStorefrontRateLimited('cart-js', cartRead.status, tag, readThrottleHits);
        if (readThrottleHits >= 3) {
          console.warn(`[${tag}] cart.js reads rate limited ${readThrottleHits}x after successful add — exiting`);
          return {
            ok: false,
            cartData: lastCartData,
            priceVerified: false,
            sectionsHtml: lastSectionsHtml,
            error: 'Rate limited — your item may already be in the cart.',
            hardFail: true,
            rateLimited: true,
            pendingPhase: phase,
            attempts,
            totalMs: Date.now() - start,
          };
        }
      } else {
        readThrottleHits = 0;
      }
      onStep?.(`${stepPrefix}:syncing`);
      continue;
    }
    readThrottleHits = 0;

    lastCartData = cartData;
    const ourItem = findTargetCartItem(cartData, variantId);
    if (!ourItem) {
      phase = 'confirm';
      DEBUG() && console.log(`[${tag}] Pending poll still cannot find variant ${variantId} in cart.js after ${elapsed}s`);
      onStep?.(`${stepPrefix}:syncing`);
      continue;
    }

    const price = getCartItemPrice(ourItem);
    if (price > 0) {
      DEBUG() && console.log(`[${tag}] Pending poll verified price after ${elapsed}s`);
      return {
        ok: true,
        cartData,
        priceVerified: true,
        sectionsHtml: lastSectionsHtml,
        attempts,
        totalMs: Date.now() - start,
      };
    }

    const pendingSections = sectionIds.length > 0
      ? (await fetchRenderedSections(sectionIds, `${tag}-PENDING-SECTIONS-WAIT`)).sections
      : null;
    const usablePendingSections = selectPendingCartSections(pendingSections, variantId, expectedPriceText);
    if (usablePendingSections) {
      DEBUG() && console.log(`[${tag}] Pending poll got usable rendered sections while cart.js price was still pending (${elapsed}s)`);
      return {
        ok: true,
        cartData,
        priceVerified: false,
        sectionsHtml: usablePendingSections,
        attempts,
        totalMs: Date.now() - start,
      };
    }

    phase = 'price-wait';
    DEBUG() && console.log(`[${tag}] Pending poll found variant but price is still pending (${elapsed}s)`);
    onStep?.(`${stepPrefix}:syncing`);
  }

  return {
    ok: false,
    cartData: lastCartData,
    priceVerified: false,
    sectionsHtml: lastSectionsHtml,
    hardFail: false,
    rateLimited: rateLimitHits > 0,
    pendingPhase: phase,
    attempts,
    totalMs: Date.now() - start,
  };
}
function discoverCartSectionIds(): string[] {
  const ids = new Set<string>();

  // Look for elements with section IDs (Dawn theme pattern)
  const candidates = document.querySelectorAll(
    '[id^="shopify-section-"][id*="cart"], cart-drawer, cart-notification'
  );
  for (const el of candidates) {
    // Extract section ID: "shopify-section-cart-drawer" â†’ "cart-drawer"
    const fullId = el.id || '';
    const sectionId = fullId.replace('shopify-section-', '') || el.getAttribute('data-section');
    if (sectionId) ids.add(sectionId);
  }

  // Also check data-section attributes
  const dataSections = document.querySelectorAll('[data-section]');
  for (const el of dataSections) {
    const sid = el.getAttribute('data-section');
    if (sid && (sid.includes('cart') || sid.includes('Cart'))) ids.add(sid);
  }

  // Common Dawn/Shopify 2.0 theme section IDs as fallbacks
  if (ids.size === 0) {
    ids.add('cart-drawer');
    ids.add('cart-icon-bubble');
  }

  DEBUG() && console.log('[CART] Discovered cart section IDs:', [...ids]);
  return [...ids];
}

/** Apply section HTML updates returned from /cart/add.js to the DOM. */
function applySectionUpdates(sections: Record<string, string>) {
  for (const [sectionId, html] of Object.entries(sections)) {
    if (!html) continue;

    // Try to find the section wrapper: "shopify-section-{id}" or data-section="{id}"
    const target = document.getElementById(`shopify-section-${sectionId}`)
      || document.querySelector(`[data-section="${sectionId}"]`)
      || document.getElementById(sectionId);

    if (target) {
      // Parse the returned HTML and extract inner content
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const newContent = doc.querySelector(`#shopify-section-${sectionId}`)
        || doc.querySelector(`[data-section="${sectionId}"]`)
        || doc.body;
      if (newContent) {
        removeConfigurationOptionRows(newContent);
        target.innerHTML = newContent.innerHTML;
        DEBUG() && console.log('[CART] Updated section DOM:', sectionId);
      }
    } else {
      DEBUG() && console.log('[CART] Section target not found for:', sectionId);
    }
  }
}

export default function App({ productId, variantId }: AppProps = {}) {
  const config = useConfigStore(s => s);
  const setConfig = useConfigStore(s => s.set);

  const [showMobilePrompt, setShowMobilePrompt] = useState(false);
  const [arActive, setArActive] = useState(false);
  const [qrActive, setQrActive] = useState(false);
  const [arLoading, setArLoading] = useState(false);
  const [ralOpen, setRalOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittingAction, setSubmittingAction] = useState<'cart' | 'buy' | null>(null);
  const [submittingStep, setSubmittingStep] = useState<string>('');
  // Terminal add/buy failure (e.g. a connection drop) → drives the "tap to retry"
  // banner in CartRow instead of a dead-end alert. The server is idempotent, so
  // retrying re-sends the same config and reuses any variant already created.
  const [submitError, setSubmitError] = useState<{ action: 'cart' | 'buy'; message: string } | null>(null);
  // Synchronous guard against double-taps â€” React state can be stale across rapid clicks
  const submittingRef = useRef(false);

  // Clear the retry banner the moment a new add/buy starts (manual tap or "Try
  // again"), so a stale error never lingers over a fresh attempt or a success.
  useEffect(() => {
    if (isSubmitting) setSubmitError(null);
  }, [isSubmitting]);

  const arViewerRef = useRef<any>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  const qrUrlRef = useRef<HTMLDivElement>(null);
  const appLayoutRef = useRef<HTMLDivElement>(null);

  const resetSubmittingUi = () => {
    submittingRef.current = false;
    setIsSubmitting(false);
    setSubmittingAction(null);
    setSubmittingStep('');
  };

  // While the cart progress overlay is up on Shopify, temporarily raise the
  // z-index of the shadow host's whole ancestor chain. On mobile the overlay is
  // position:fixed (viewport-anchored), and inside the shadow root its z-index
  // can't escape theme stacking contexts — without this, sticky headers / later
  // sections can paint over it. Original inline styles are restored on hide.
  const cartOverlayActive = isSubmitting && submittingAction !== null;
  useEffect(() => {
    if (!cartOverlayActive) return;
    const rootNode = appLayoutRef.current?.getRootNode();
    const host = rootNode instanceof ShadowRoot ? (rootNode.host as HTMLElement) : null;
    if (!host) return; // standalone SPA — no shadow root, nothing to fix
    const touched: Array<{ el: HTMLElement; zIndex: string; position: string }> = [];
    let el: HTMLElement | null = host;
    while (el && el !== document.body && el !== document.documentElement) {
      touched.push({ el, zIndex: el.style.zIndex, position: el.style.position });
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      el.style.zIndex = '2147483000';
      el = el.parentElement;
    }
    return () => {
      touched.forEach(({ el: t, zIndex, position }) => {
        t.style.zIndex = zIndex;
        t.style.position = position;
      });
    };
  }, [cartOverlayActive]);

  // Lock the page (light-DOM theme document) scroll while the PDF preview or
  // RAL color picker is open, so wheel/touch over the backdrop — or an inner
  // scroll area hitting its end — can't scroll the store page behind the modal.
  // overscroll-behavior on the scroll containers handles chaining; this stops
  // the backdrop case and is restored exactly on close. Scoped to these two
  // modals only — the cart overlay/drawer manages its own scroll lock.
  useEffect(() => {
    if (!(pdfOpen || ralOpen)) return;
    const docEl = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = docEl.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    docEl.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      docEl.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
    };
  }, [pdfOpen, ralOpen]);

  useEffect(() => {
    DEBUG() && console.log('Configurator app boot props:', {
      productId: productId || null,
      variantId: variantId || null,
      path: window.location.pathname,
      search: window.location.search,
    });

    const hash = window.location.hash;
    if (hash.startsWith('#ar=')) {
      // AR config takes priority â€” don't restore from cart
      const restored = applyConfigState(hash.slice(4));
      setConfig(restored as any);
      setShowMobilePrompt(true);
      history.replaceState(null, '', window.location.pathname + window.location.search);
    } else {
      // Restore config only when navigating back from cart (not on fresh refresh)
      restoreConfigIfNeeded();
      // Back-from-checkout can be a full reload instead of bfcache — restore
      // any Buy Now cart snapshot here too (one-shot key makes this safe to
      // attempt from both this mount path and the pageshow handler).
      void (async () => {
        const restored = await restoreCartSnapshotIfNeeded();
        if (restored) await syncCartUiFromStorefront('CART-RESTORE');
      })();
    }
  }, []);

  // Flush any cart failures buffered while offline (this session or a prior one
  // on this device) once we have an API base — and again whenever the browser
  // reports it's back online. See "Cart failure telemetry" in CLAUDE.md.
  useEffect(() => {
    const apiBase = (window as any).__chaseApiBase || '';
    if (!apiBase) return;
    void flushCartFailureReports(apiBase);
    const onOnline = () => { void flushCartFailureReports(apiBase); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setArActive(false);
        setQrActive(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      const navigationEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const isBackForward = event.persisted || navigationEntry?.type === 'back_forward';
      if (!isBackForward) return;

      DEBUG() && console.log('[CART] pageshow back/forward restore â€” resyncing UI');
      resetSubmittingUi();
      restoreConfigIfNeeded();
      releasePageScrollLockIfCartClosed('pageshow');
      void (async () => {
        const restored = await restoreCartSnapshotIfNeeded();
        await syncCartUiFromStorefront(restored ? 'CART-RESTORE' : 'PAGESHOW');
      })();
    };

    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  const [mobilePreviewSize, setMobilePreviewSize] = useState(35);
  const [dragPreviewSize, setDragPreviewSize] = useState<number | null>(null);
  const isDraggingRef = useRef(false);
  const dragPointerOffsetRef = useRef(0);

  const getPreviewSizeFromPointer = (clientY: number) => {
    const layoutRect = appLayoutRef.current?.getBoundingClientRect();
    if (!layoutRect || layoutRect.height <= 0) return null;

    const dividerY = clientY - dragPointerOffsetRef.current;
    const relativeY = dividerY - layoutRect.top;
    const nextSize = (relativeY / layoutRect.height) * 100;
    return Math.max(30, Math.min(70, nextSize));
  };

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (!isDraggingRef.current) return;
      e.preventDefault();

      const nextSize = getPreviewSizeFromPointer(e.clientY);
      if (nextSize !== null) {
        setDragPreviewSize(nextSize);
      }
    };

    const handlePointerUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        setDragPreviewSize(prev => {
          if (prev !== null) setMobilePreviewSize(prev);
          return null;
        });
        dragPointerOffsetRef.current = 0;
        document.body.style.userSelect = '';
        document.body.style.touchAction = '';
      }
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, []);

  const isMobile = () =>
    window.innerWidth <= 767 ||
    /Mobi|Android|iPhone/i.test(navigator.userAgent);

  async function launchAR(direct = false) {
    if (!direct && !isMobile()) {
      const stateStr = getConfigState(config);

      let baseUrl = window.location.origin;
      if ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && typeof __LOCAL_IP__ !== 'undefined' && __LOCAL_IP__) {
        baseUrl = `http://${__LOCAL_IP__}:${window.location.port}`;
      }

      const canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
      const pagePath = canonical ? canonical.href : baseUrl + window.location.pathname;
      const pageUrl = pagePath.split('?')[0];
      const url = pageUrl + '#ar=' + stateStr;

      if (qrCanvasRef.current) {
        new QRious({ element: qrCanvasRef.current, value: url, size: 200, background: 'white', foreground: 'black', level: 'M' });
      }
      if (qrUrlRef.current) qrUrlRef.current.textContent = pageUrl;
      setQrActive(true);
      return;
    }

    setArActive(true);
    setArLoading(true);
    try {
      if (!customElements.get('model-viewer')) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.type = 'module';
          script.src = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js';
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load model-viewer'));
          document.head.appendChild(script);
        });
        await new Promise(r => setTimeout(r, 500));
      }

      await new Promise(r => setTimeout(r, 50));
      const sceneGroup = (window as any).__chaseGroup;
      if (!sceneGroup) throw new Error('Scene not ready');
      const url = await exportToGLB(sceneGroup);
      const viewer = arViewerRef.current;
      if (viewer) {
        viewer.setAttribute('src', url);
        viewer.style.display = 'block';
      }
    } catch (e: any) {
      console.error('AR launch failed:', e);
      alert('Could not launch AR: ' + (e?.message || 'Unknown error'));
      setArActive(false);
    } finally {
      setArLoading(false);
    }
  }

  const displayDimLines = (() => {
    const lines = [`${formatFrac(config.width)}" W x ${formatFrac(config.length)}" L`];
    if (config.mount === 'top_mount') {
      lines.push(`Flange: ${formatFrac(config.flange_width)}"`);
    } else {
      lines.push(`V-Skirt: ${formatFrac(config.vertical_skirt)}"`);
    }
    lines.push(`Screen: ${formatFrac(config.screen_height)}"`);
    return lines;
  })();

  return (
    <>
      <div
        ref={appLayoutRef}
        className="app-layout"
        style={{ '--mobile-preview-size': `${mobilePreviewSize}%` } as any}
      >
        <div className="viewport">
          {/* Inner non-sticky background layer. The parent .viewport is white
              so iOS Safari (which samples element backgrounds near the top of
              the page for the address-bar tint) sees white. This layer holds
              the visible grey behind the transparent 3D canvas. */}
          <div className="viewport-bg" aria-hidden="true" />
          <CapViewer />

          <div className="viewport-controls">
            <button className="vp-btn" title="Reset" onClick={() => cameraActions.reset()} aria-label="Reset Camera">
              <IconCameraReset />
            </button>
            <button className="vp-btn" title="Top" onClick={() => cameraActions.top()} aria-label="Top View">
              <IconCameraTop />
            </button>
            <button className="vp-btn" title="Front" onClick={() => cameraActions.front()} aria-label="Front View">
              <IconCameraFront />
            </button>
            <button className="vp-btn desktop-ar" title="View in AR" aria-label="View in AR" onClick={() => launchAR()}>
              {/* AR cube — same glyph as the mobile AR button */}
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 8 8 4.5h12L16 8z"/>
                <path d="M16 8 20 4.5v11L16 19z"/>
                <rect x="4" y="8" width="12" height="11" rx="1"/>
                <text x="10" y="16.3" fontSize="7.5" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="ui-sans-serif, system-ui, sans-serif">AR</text>
              </svg>
            </button>
          </div>

          <div className="mobile-only-controls" style={{ position: 'absolute', bottom: 14, left: 14, display: 'flex', gap: 8, zIndex: 5 }}>
            <button
              className="viewport-primary-btn ar-btn-mobile"
              style={{ position: 'relative', bottom: 'auto', left: 'auto', transform: 'none', margin: 0 }}
              onClick={() => launchAR(true)}
              title="View in AR"
              aria-label="View in AR"
            >
              {/* AR cube — 3D box with "AR" on the front face. ~80% of the 44px button. */}
              <svg viewBox="0 0 24 24" width="35" height="35" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 8 8 4.5h12L16 8z"/>
                <path d="M16 8 20 4.5v11L16 19z"/>
                <rect x="4" y="8" width="12" height="11" rx="1"/>
                <text x="10" y="16.3" fontSize="7.5" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="ui-sans-serif, system-ui, sans-serif">AR</text>
              </svg>
            </button>
          </div>

          <div className={`dim-overlay${config.showDimensions ? ' dim-open' : ''}`}>
            {config.showDimensions ? (
              <>
                <button
                  className="dim-close"
                  onClick={(e) => { e.stopPropagation(); setConfig({ showDimensions: false, showDimLabels: false }); }}
                  title="Close dimensions"
                  aria-label="Close dimensions"
                >
                  &times;
                </button>
                {displayDimLines.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
                <label className="dim-show-labels-toggle">
                  <input
                    type="checkbox"
                    checked={config.showDimLabels}
                    onChange={(e) => setConfig({ showDimLabels: e.target.checked })}
                  />
                  <span>Show Labels</span>
                </label>
              </>
            ) : (
              <button
                type="button"
                className="dim-icon"
                title="Show dimensions"
                aria-label="Show dimensions"
                onClick={() => setConfig({ showDimensions: true })}
              >
                <svg viewBox="0 0 28 10" aria-hidden="true" focusable="false">
                  <rect x="0.8" y="0.8" width="26.4" height="8.4" rx="1" />
                  <line x1="5.5"  y1="0.8" x2="5.5"  y2="5.8" />
                  <line x1="9"    y1="0.8" x2="9"    y2="4" />
                  <line x1="12.5" y1="0.8" x2="12.5" y2="5.8" />
                  <line x1="16"   y1="0.8" x2="16"   y2="4" />
                  <line x1="19.5" y1="0.8" x2="19.5" y2="5.8" />
                  <line x1="23"   y1="0.8" x2="23"   y2="4" />
                </svg>
              </button>
            )}
          </div>

          <div className="viewport-badge">Drag to orbit Â· Scroll to zoom Â· Right-drag to pan</div>
        </div>

        {dragPreviewSize !== null && (
          <div
            style={{
              position: 'absolute',
              top: `${dragPreviewSize}%`,
              left: 0,
              right: 0,
              height: '2px',
              background: 'var(--accent)',
              zIndex: 9999,
              pointerEvents: 'none',
            }}
          />
        )}

        <div
          className="mobile-divider"
          onPointerDown={(e) => {
            e.preventDefault();

            const handleRect = e.currentTarget.getBoundingClientRect();
            const dividerY = handleRect.top + (handleRect.height / 2);
            dragPointerOffsetRef.current = e.clientY - dividerY;

            isDraggingRef.current = true;
            const nextSize = getPreviewSizeFromPointer(e.clientY);
            if (nextSize !== null) {
              setDragPreviewSize(nextSize);
            }
            document.body.style.userSelect = 'none';
            document.body.style.touchAction = 'none';
          }}
        >
          <div className="mobile-divider-handle" />
        </div>

        <Sidebar
          onOpenRal={() => setRalOpen(true)}
          onExportPdf={() => setPdfOpen(true)}
          isSubmitting={isSubmitting}
          submittingAction={submittingAction}
          submittingStep={submittingStep}
          submitError={submitError}
          onDismissError={() => setSubmitError(null)}
          onAddToCart={async () => {
            if (isSubmitting || submittingRef.current) return;
            const apiBase = (window as any).__chaseApiBase || '';
            if (!apiBase) {
              alert('Configuration error: API base not found. Are you running this via the Shopify integration?');
              return;
            }

            submittingRef.current = true;
            let shouldResetSubmitting = true;
            const prematureCartGuard = startPrematureCartOpenGuard();
            resetThrottleTelemetry();
            const requestId = newRequestId();
            let failPhase = 'cart:building';
            let failVariantId: string | number | null = null;
            let failVariantReused: boolean | null = null;
            let failServerMs: number | null = null;
            try {
              // Save BEFORE any async work — if the user navigates to /cart fast we still need
              // the config in sessionStorage when they come back. The duplicate call later in
              // the success path is a no-op overwrite with the same data, harmless.
              saveConfigForRestore();

              setIsSubmitting(true);
              setSubmittingAction('cart');
              setSubmittingStep('cart:building');
              const t0 = performance.now();

              const resolvedShopifyIds = resolveRuntimeShopifyIds(productId, variantId, appLayoutRef.current);
              const screenshotCaptureStartedAt = performance.now();
              const screenshotBase64Promise = captureCanvasScreenshot(appLayoutRef, { resetView: true, hideLabels: true })
                .then((image) => ({
                  image,
                  captureMs: Math.round(performance.now() - screenshotCaptureStartedAt),
                }));

              const payload = {
                requestId,
                width: config.width, length: config.length, vertical_skirt: config.vertical_skirt,
                horizontal_skirt: config.horizontal_skirt, drip_edge: config.drip_edge,
                material: config.material, mount: config.mount, lid_type: config.lid_type,
                powder_coat: config.powder_coat, powder_coat_color: config.powder_coat_color, screen_height: config.screen_height, lid_overhang: config.lid_overhang, lid_pitch: config.lid_pitch, seam_count: config.seam_count, flange_width: config.flange_width,
                
                
                
                
                
                

                quantity: config.quantity,
                notes: config.notes,
                shopifyProductId: resolvedShopifyIds.productId,
                shopifyVariantId: resolvedShopifyIds.variantId,
                // NO image here â€” uploaded in background after cart is updated
              };

              // Diagnostic: log key config fields to verify different configs produce different payloads
              DEBUG() && console.log('[CART] â‘  Payload fingerprint:', JSON.stringify({
                powder_coat: payload.powder_coat, powder_coat_color: payload.powder_coat_color, material: payload.material,
                
                
              }));

              // Warm up the API connection if the initial pricing load failed.
              // A failed pricing fetch on page load can leave the browser's HTTP/2
              // connection pool to Vercel in a broken state, causing instant
              // “Failed to fetch” errors on subsequent requests to the same origin.
              if (!isApiReachable()) {
                DEBUG() && console.log('[CART] API not reached during page load — warming up connection');
                await loadPricingFromAPI(apiBase);
              }

              // Step 1: Create variant (fast â€” no image in payload)
              failPhase = 'cart:api';
              const { res, data, attempts: apiAttempts, totalMs: apiMs } = await postAddToCartApi({
                apiBase,
                payload,
                tag: 'CART',
              });
              if (data?._timing) {
                const { authPricingMs, optionNameMs, variantMs, propagationMs, totalMs } = data._timing;
                DEBUG() && console.log(`[CART] â‘¡ API: ${apiMs}ms total | server breakdown â†’ auth+pricing: ${authPricingMs}ms | optionName: ${optionNameMs}ms | variant: ${variantMs}ms | propagation: ${propagationMs ?? 0}ms | server total: ${totalMs}ms`);
              } else {
                DEBUG() && console.log(`[CART] â‘¡ API: ${apiMs}ms`);
              }
              DEBUG() && apiAttempts > 1 && console.log(`[CART] API recovered after ${apiAttempts} attempts`);
              if (!res.ok) {
                console.error('Add-to-cart API error:', res.status, data);
                throw new Error(data?.error || `HTTP error! status: ${res.status}`);
              }

              // Carry server result into the catch scope so a later-phase failure
              // can record whether a variant was created (orphan detection).
              failVariantId = data?.variantId ?? null;
              failVariantReused = data?.variantReused ?? null;
              failServerMs = data?._timing?.totalMs ?? null;

              DEBUG() && console.log(`[CART] â‘¡b Server result: variantId=${data.variantId}, reused=${data.variantReused}, propagated=${data.propagated}, price=${data.price}`);

              // Step 2: Add to Shopify cart IMMEDIATELY (no pre-wait)
              const cartProperties: Record<string, string> = {};
              for (const prop of (data.properties || [])) {
                cartProperties[prop.key] = prop.value;
              }

              const drawerSectionIds = discoverCartSectionIds();
              const debugVariantId = Number(data.variantId);
              const expectedPriceText = String(data.price || '');
              let expectedImageUrl: string | null = null;
              let imageUploadPromise: Promise<string | null> = Promise.resolve(null);
              const cartBody: Record<string, any> = {
                items: [{
                  id: Number(data.variantId),
                  quantity: data.quantity,
                  properties: cartProperties,
                }],
              };
              if (drawerSectionIds.length > 0) {
                cartBody.sections = drawerSectionIds.join(',');
              }
              emitCartDebug('api-result', {
                variantId: debugVariantId,
                propagated: data.propagated,
                variantReused: data.variantReused,
                serverPrice: expectedPriceText,
                requestAttempts: apiAttempts,
                clientMs: apiMs,
                timing: data._timing || null,
                sectionIds: drawerSectionIds,
                sectionMounts: collectSectionMountSnapshot(drawerSectionIds),
                dom: collectCartDomSnapshot(),
              });

              failPhase = 'cart:syncing';
              setSubmittingStep('cart:adding');
              const t1 = performance.now();

              // Upload for new variants AND for reused ones that have no image
              // (a variant born from a failed flow — e.g. a Buy Now that died
              // before its upload step — would otherwise stay imageless forever).
              if (data.variantId && (!data.variantReused || data.variantHasImage === false)) {
                imageUploadPromise = (async () => {
                  const captureResult = await screenshotBase64Promise;
                  let screenshotBase64 = captureResult.image;
                  const captureMs = captureResult.captureMs;

                  if (!screenshotBase64) {
                    // Capture can fail on phones (WebGL context dropped under
                    // memory pressure). One fresh attempt — the canvas has
                    // usually recovered by now.
                    DEBUG() && console.warn('[IMG] First capture failed — retrying once');
                    screenshotBase64 = await captureCanvasScreenshot(appLayoutRef, { resetView: true, hideLabels: true });
                  }

                  if (!screenshotBase64) {
                    console.warn('[IMG] Screenshot unavailable after retry; skipping upload');
                    emitCartDebug('image-capture-complete', {
                      variantId: debugVariantId,
                      captureMs,
                      captured: false,
                      dom: collectCartDomSnapshot(),
                    });
                    return null;
                  }

                  emitCartDebug('image-capture-complete', {
                    variantId: debugVariantId,
                    captureMs,
                    captured: true,
                    dom: collectCartDomSnapshot(),
                  });

                  const uploadedUrl = await uploadVariantImageWithRetry({
                    apiBase,
                    variantId: data.variantId,
                    productId: resolvedShopifyIds.productId,
                    image: screenshotBase64,
                    tag: 'CART',
                  });
                  if (uploadedUrl) {
                    expectedImageUrl = uploadedUrl;
                    emitCartDebug('image-upload-complete', {
                      variantId: debugVariantId,
                      imageUrl: expectedImageUrl,
                      captureMs,
                      dom: collectCartDomSnapshot(),
                    });
                  }
                  return uploadedUrl;
                })();
              }

              // Unified retry: cart add + price verification in one loop, one timeout budget
              const cartMaxWaitMs = getForegroundWaitBudgetMs('CART');
              const retryResult = await addToCartWithRetry({
                cartPayload: cartBody,
                variantId: Number(data.variantId),
                sectionIds: drawerSectionIds,
                maxWaitMs: cartMaxWaitMs,
                tag: 'CART',
                expectedPriceText,
                onStep: setSubmittingStep,
              });

              const cartAddMs = Math.round(performance.now() - t1);
              DEBUG() && console.log(`[CART] â‘¢ Cart retry: ${cartAddMs}ms (${retryResult.attempts} attempt${retryResult.attempts > 1 ? 's' : ''}, ok=${retryResult.ok})`);

              let finalRetryResult = retryResult;
              if (!finalRetryResult.ok) {
                if (finalRetryResult.hardFail) {
                  throw new Error(retryResult.error || 'Something went wrong â€” please try again in a moment.');
                }
                // Propagation timeout â€” not a hard error, but price isn't verified
                finalRetryResult = await continueCartPreparationUntilVerified({
                  cartPayload: cartBody,
                  variantId: Number(data.variantId),
                  sectionIds: drawerSectionIds,
                  pendingPhase: finalRetryResult.pendingPhase || 'adding',
                  tag: 'CART',
                  expectedPriceText,
                  onStep: setSubmittingStep,
                });
              }
              if (!finalRetryResult.ok) {
                throw new Error(finalRetryResult.rateLimited
                  ? 'Rate limited — the store is handling a lot of requests right now.'
                  : 'We could not confirm the cart update yet. Please refresh the cart and try again.');
              }

              let finalCartData = finalRetryResult.cartData;
              emitCartDebug('cart-json-before-open', {
                variantId: debugVariantId,
                retry: {
                  ok: finalRetryResult.ok,
                  attempts: finalRetryResult.attempts,
                  totalMs: finalRetryResult.totalMs,
                  priceVerified: finalRetryResult.priceVerified,
                  pendingPhase: finalRetryResult.pendingPhase || null,
                },
                targetItem: summarizeCartItemForDebug(findTargetCartItem(finalCartData, debugVariantId)),
                bundledSections: summarizeSectionsForDebug(finalRetryResult.sectionsHtml, {
                  variantId: debugVariantId,
                  priceText: expectedPriceText,
                }),
                sectionMounts: collectSectionMountSnapshot(drawerSectionIds),
                dom: collectCartDomSnapshot(),
              });

              // Check if image upload finished during the retry loop, and give
              // it a longer pre-open window (up to 3s) so the drawer is more
              // likely to open WITH the exact config screenshot already in place.
              // For reused variants that already have an image, imageUploadPromise
              // is an already-resolved Promise.resolve(null), so this resolves
              // instantly — the 3s ceiling only applies to genuine new-variant /
              // reuse-heal uploads. A permanent featured product image (set via
              // the cleanup dashboard) still covers the gap if the upload outruns
              // this window: the cart line shows that default image, not a blank.
              const imageReady = await waitForPromiseWithin(imageUploadPromise, 3000);
              const imageUrl: string | null = imageReady.resolved ? imageReady.value : null;
              let seededImageSections: Record<string, string> | null = null;
              if (imageUrl && drawerSectionIds.length > 0) {
                DEBUG() && console.log('[IMG] Image ready before drawer open â€” fetching fresh sections with image...');
                try {
                  const { sections: imageSections } = await fetchRenderedSections(drawerSectionIds, 'IMG');
                  if (imageSections) {
                    seededImageSections = imageSections;
                    if (imageSections) {
                      DEBUG() && console.log('[IMG] Fresh sections applied before drawer open');
                      DEBUG() && console.log('[IMG] Fresh sections applied â€” image should appear in drawer');
                    }
                  }
                } catch { /* ignore */ }
              } else if (!imageUrl) {
                DEBUG() && console.log('[IMG] Upload still in progress before drawer open â€” will refresh after if needed');
              }

              DEBUG() && console.log(`[CART] âœ“ TOTAL: ${Math.round(performance.now() - t0)}ms`);

              // Apply section updates BEFORE opening the drawer (still closed â€” safe)
              const renderExpectation = {
                variantId: debugVariantId,
                priceText: expectedPriceText,
                imageUrl: expectedImageUrl,
              };
              // 30s budget: the drawer must open WITH the item already in it —
              // opening fast-but-empty and letting the catch-up loop pop it in
              // a few seconds later is exactly what the client called out as
              // confusing. For a brand-NEW variant, Shopify's server-rendered
              // cart-drawer shows the line at $0 until the variant price
              // propagates to the render layer, which (measured live) can take
              // up to ~26s. The overlay stays up ("Opening your cart") for the
              // whole wait, so this reads as finalizing, not a hang. A throttled
              // IP bails out after 2 throttled fetches (rateLimited: true)
              // instead of burning the ceiling, so the big budget is only ever
              // spent on genuine propagation lag, which always resolves. No
              // separate pre-fetch: the wait's first iteration fetches now.
              failPhase = 'cart:opening';
              setSubmittingStep('cart:opening');
              const sectionReadiness = await waitForUsableRenderedSections({
                sectionIds: drawerSectionIds,
                tag: 'CART-SECTIONS',
                expected: renderExpectation,
                requirements: { requireVariant: true },
                maxWaitMs: drawerSectionIds.length > 0 ? 30000 : 0,
                seedSections: [
                  { source: 'bundled-initial', sections: finalRetryResult.sectionsHtml },
                  { source: 'image-initial', sections: seededImageSections },
                ],
              });

              if (sectionReadiness.usableSections) {
                finalCartData = { ...finalCartData, sections: sectionReadiness.usableSections };
                // The guard keeps the drawer closed during this phase, but if
                // one slipped open inside the guard's 350ms window, use the
                // open-safe replace (raw innerHTML on an open drawer wipes the
                // theme's drawer state — June 2026 incident class).
                if (isCartUiOpen()) {
                  applySectionUpdatesPreservingCartUi(sectionReadiness.usableSections, 'pre-open-already-open');
                } else {
                  applySectionUpdates(sectionReadiness.usableSections);
                }
              }

              if (sectionReadiness.rejectedSections) {
                emitCartDebug('skip-rendered-sections', {
                  reason: 'pre-open',
                  variantId: debugVariantId,
                  rejectedVerifiedSections: sectionReadiness.rejectedSections,
                  rejectedBundledSections: null,
                  dom: collectCartDomSnapshot(),
                });
              }
              emitCartDebug('pre-open-sections', {
                variantId: debugVariantId,
                targetItem: summarizeCartItemForDebug(findTargetCartItem(finalCartData, debugVariantId)),
                verifiedSections: null,
                bundledSections: summarizeSectionsForDebug(finalRetryResult.sectionsHtml, renderExpectation),
                imageSections: summarizeSectionsForDebug(seededImageSections, renderExpectation),
                usableSectionSource: sectionReadiness.source,
                sectionMounts: collectSectionMountSnapshot(drawerSectionIds),
                dom: collectCartDomSnapshot(),
              });

              if (!(typeof finalCartData?.item_count === 'number' && finalCartData.item_count > 0)) {
                const { cart: confirmedCartData } = await fetchCartState('CART-BADGE');
                if (confirmedCartData) {
                  finalCartData = confirmedCartData;
                }
              }

              const cartItemCount = finalCartData?.item_count ?? 0;
              if (cartItemCount > 0) {
                updateCartBadgeCount(cartItemCount);
              }

              emitCartDebug('cart-latency-breakdown', {
                variantId: debugVariantId,
                totalMs: Math.round(performance.now() - t0),
                apiMs,
                cartRetryMs: cartAddMs,
                retryAttempts: finalRetryResult.attempts,
                priceVerified: finalRetryResult.priceVerified,
                usableSectionSource: sectionReadiness.source,
                cartItemCount,
              });

              // Save config so navigating away and coming back restores it
              saveConfigForRestore();

              if (drawerSectionIds.length > 0 && !sectionReadiness.usableSections && sectionReadiness.rateLimited) {
                // Storefront reads are rate limited: the drawer can't be
                // filled now, and the catch-up loop uses the same blocked
                // fetches. The add itself SUCCEEDED (price verified) — say so
                // honestly instead of opening an empty drawer.
                console.warn('[CART] Rendered sections rate limited — not opening the drawer');
                emitCartDebug('drawer-open-skipped', {
                  variantId: debugVariantId,
                  reason: 'storefront-rate-limited',
                  dom: collectCartDomSnapshot(),
                });
                prematureCartGuard.stop();
                alert("Your item was added to the cart. The store is busy right now, so the cart preview can't open — use the cart icon or the cart page to view it.");
                return;
              }

              if (drawerSectionIds.length > 0 && !sectionReadiness.usableSections) {
                // Drawer HTML still stale ($0 / item missing) but fetches are
                // healthy — open now and let the post-open catch-up loop inject
                // the fresh drawer HTML the moment Shopify renders it.
                console.warn('[CART] Sections not ready pre-open — relying on post-open catch-up');
                emitCartDebug('pre-open-sections-not-ready', {
                  variantId: debugVariantId,
                  targetItem: summarizeCartItemForDebug(findTargetCartItem(finalCartData, debugVariantId)),
                  dom: collectCartDomSnapshot(),
                });
              }

              // Open the cart drawer/notification â€” price is correct by now.
              // Stop the premature-open guard first: from here on, an open
              // drawer is OUR open.
              prematureCartGuard.stop();
              const drawerOpened = tryOpenCartUi();

              if (drawerOpened) {
                DEBUG() && console.log('[CART] Cart drawer opened');
                dispatchCartSyncEvents(finalCartData);
                // Background self-correction: if the drawer DOM doesn't show the
                // new item yet (rendered sections lagged behind cart.js), poll
                // quietly and fill it in once Shopify renders it. No-op when the
                // drawer is already correct.
                startPostOpenDrawerCatchUp({
                  variantId: debugVariantId,
                  sectionIds: drawerSectionIds,
                  expectedPriceText,
                  cartDataForEvents: finalCartData,
                });
              } else {
                dispatchCartSyncEvents(finalCartData);
                window.location.assign(buildShopifyPath('cart'));
              }
              emitCartDebug('drawer-open', {
                variantId: debugVariantId,
                drawerOpened,
                redirectedToCartPage: !drawerOpened,
                targetItem: summarizeCartItemForDebug(findTargetCartItem(finalCartData, debugVariantId)),
                sectionMounts: collectSectionMountSnapshot(drawerSectionIds),
                dom: collectCartDomSnapshot(),
              });

              // 3d: If image upload was still pending when the drawer opened,
              // dispatch refresh events once it completes so the theme can update.
              if (!imageUrl && drawerOpened) {
                imageUploadPromise.then(async (url) => {
                  if (!url) return;
                  DEBUG() && console.log('[IMG] Upload finished after drawer opened â€” checking whether drawer needs image catch-up');
                  expectedImageUrl = url;
                  const { cart: latestCartData } = await fetchCartState('IMG');
                  if (latestCartData) {
                    const latestItem = findTargetCartItem(latestCartData, debugVariantId);
                    if (getCartItemPrice(latestItem) > 0) {
                      finalCartData = latestCartData;
                    } else {
                      emitCartDebug('skip-cart-json-downgrade', {
                        variantId: debugVariantId,
                        latestItem: summarizeCartItemForDebug(latestItem),
                        dom: collectCartDomSnapshot(),
                      });
                    }
                  }

                  const drawerHasExpectedImage = cartUiContainsExpectedImage(expectedImageUrl);
                  emitCartDebug('post-image-upload-status', {
                    variantId: debugVariantId,
                    imageUrl: expectedImageUrl,
                    drawerHasExpectedImage,
                    targetItem: summarizeCartItemForDebug(findTargetCartItem(finalCartData, debugVariantId)),
                    dom: collectCartDomSnapshot(),
                  });

                  if (!drawerHasExpectedImage && drawerSectionIds.length > 0) {
                    const { sections: fetchedImageSections } = await fetchRenderedSections(drawerSectionIds, 'IMG');
                    const imageSectionSelection = selectUsableRenderedSections(
                      fetchedImageSections,
                      {
                        variantId: debugVariantId,
                        priceText: expectedPriceText,
                        imageUrl: expectedImageUrl,
                      },
                      { requireVariant: true, requireImage: true },
                    );

                    if (imageSectionSelection.usableSections) {
                      finalCartData = { ...finalCartData, sections: imageSectionSelection.usableSections };
                      applySectionUpdatesPreservingCartUi(imageSectionSelection.usableSections, 'post-image-refresh');
                    } else if (imageSectionSelection.rejectedSections) {
                      emitCartDebug('skip-rendered-sections', {
                        reason: 'post-image-upload',
                        variantId: debugVariantId,
                        rejectedVerifiedSections: imageSectionSelection.rejectedSections,
                        rejectedBundledSections: null,
                        dom: collectCartDomSnapshot(),
                      });
                    }
                  }

                  dispatchCartSyncEvents(finalCartData);
                  window.setTimeout(() => releasePageScrollLockIfCartClosed('post-image-refresh'), 150);
                });
              }
              return;

            } catch (err: any) {
              console.error('[CART] Add to cart failed:', err?.message, err?.stack);
              // Clean up any scroll lock the theme may have applied during a failed drawer open
              document.body.style.overflow = '';
              document.documentElement.style.overflow = '';
              document.body.classList.remove('overflow-hidden', 'no-scroll');
              document.documentElement.classList.remove('overflow-hidden', 'no-scroll');
              recordCartFailure({
                requestId, action: 'cart', phase: failPhase, err,
                variantId: failVariantId, variantReused: failVariantReused,
                serverTimingMs: failServerMs, config, apiBase,
              });
              const msg = formatCheckoutErrorMessage(err?.message || 'Unknown error', 'cart');
              // Not a dead-end: show the "tap to retry" banner (server is idempotent).
              setSubmitError({ action: 'cart', message: msg.length > 200 ? msg.slice(0, 200) + '...' : msg });
            } finally {
              prematureCartGuard.stop();
              submittingRef.current = false;
              if (shouldResetSubmitting) {
                setIsSubmitting(false);
                setSubmittingAction(null);
                setSubmittingStep('');
              }
            }
          }}
          onBuyNow={async () => {
            if (isSubmitting || submittingRef.current) return;
            const apiBase = (window as any).__chaseApiBase || '';
            if (!apiBase) {
              alert('Configuration error: API base not found. Are you running this via the Shopify integration?');
              return;
            }

            submittingRef.current = true;
            let shouldResetSubmitting = true;
            const prematureCartGuard = startPrematureCartOpenGuard();
            resetThrottleTelemetry();
            const requestId = newRequestId();
            let failPhase = 'buy:building';
            let failVariantId: string | number | null = null;
            let failVariantReused: boolean | null = null;
            let failServerMs: number | null = null;
            try {
              // Save BEFORE any async work — Buy Now redirects to /checkout once cart is set;
              // if the user comes back, the configurator should still be on the same config.
              saveConfigForRestore();

              setIsSubmitting(true);
              setSubmittingAction('buy');
              setSubmittingStep('buy:building');
              const tBuyTotal = performance.now();

              const resolvedShopifyIds = resolveRuntimeShopifyIds(productId, variantId, appLayoutRef.current);
              DEBUG() && console.log('Resolved Shopify IDs for Buy Now:', resolvedShopifyIds);

              const screenshotBase64Promise = captureCanvasScreenshot(appLayoutRef, { resetView: true, hideLabels: true });

              const payload = {
                requestId,
                width: config.width, length: config.length, vertical_skirt: config.vertical_skirt,
                horizontal_skirt: config.horizontal_skirt, drip_edge: config.drip_edge,
                material: config.material, mount: config.mount, lid_type: config.lid_type,
                powder_coat: config.powder_coat, powder_coat_color: config.powder_coat_color, screen_height: config.screen_height, lid_overhang: config.lid_overhang, lid_pitch: config.lid_pitch, seam_count: config.seam_count, flange_width: config.flange_width,
                
                
                
                
                
                

                quantity: config.quantity,
                notes: config.notes,
                shopifyProductId: resolvedShopifyIds.productId,
                shopifyVariantId: resolvedShopifyIds.variantId,
              };

              if (!isApiReachable()) {
                DEBUG() && console.log('[BUY] API not reached during page load — warming up connection');
                await loadPricingFromAPI(apiBase);
              }

              failPhase = 'buy:api';
              const { res, data, attempts: buyApiAttempts, totalMs: buyApiMs } = await postAddToCartApi({
                apiBase,
                payload,
                tag: 'BUY',
              });
              if (!res.ok) {
                console.error('Buy Now API error:', res.status, data);
                throw new Error(data?.error || `HTTP error! status: ${res.status}`);
              }

              // Carry server result into the catch scope (orphan detection).
              failVariantId = data?.variantId ?? null;
              failVariantReused = data?.variantReused ?? null;
              failServerMs = data?._timing?.totalMs ?? null;
              if (data?._timing) {
                const { authPricingMs, optionNameMs, variantMs, propagationMs, totalMs } = data._timing;
                DEBUG() && console.log(`[BUY] API: ${buyApiMs}ms (${buyApiAttempts} attempt${buyApiAttempts > 1 ? 's' : ''}) | auth+pricing: ${authPricingMs}ms | optionName: ${optionNameMs}ms | variant: ${variantMs}ms | propagation: ${propagationMs ?? 0}ms | server total: ${totalMs}ms`);
              } else {
                DEBUG() && console.log(`[BUY] API: ${buyApiMs}ms (${buyApiAttempts} attempt${buyApiAttempts > 1 ? 's' : ''})`);
              }

              DEBUG() && console.log(`[BUY] Server result: variantId=${data.variantId}, reused=${data.variantReused}, propagated=${data.propagated}, price=${data.price}`);

              // Step 2: Clear cart, add item, then verify price before checkout
              failPhase = 'buy:syncing';
              setSubmittingStep('buy:adding');
              // Snapshot the customer's existing cart lines before the clear —
              // restored by restoreCartSnapshotIfNeeded() when they come back.
              await saveCartSnapshotBeforeClear('BUY');
              await fetch(buildShopifyPath('cart/clear.js'), { method: 'POST' });
              // Brief pause after cart clear to avoid Shopify 429 rate limiting
              await new Promise(r => setTimeout(r, 300));

              const cartProperties: Record<string, string> = {};
              for (const prop of (data.properties || [])) {
                cartProperties[prop.key] = prop.value;
              }

              const buyCartBody = {
                items: [{
                  id: Number(data.variantId),
                  quantity: data.quantity,
                  properties: cartProperties,
                }],
              };

              // Unified retry: cart add + price verification in one loop
              const buyMaxWaitMs = getForegroundWaitBudgetMs('BUY');
              const buyResult = await addToCartWithRetry({
                cartPayload: buyCartBody,
                variantId: Number(data.variantId),
                sectionIds: [],
                maxWaitMs: buyMaxWaitMs,
                tag: 'BUY',
                onStep: setSubmittingStep,
              });

              DEBUG() && console.log(`[BUY] Cart retry: ${buyResult.totalMs}ms (${buyResult.attempts} attempts, ok=${buyResult.ok})`);

              let finalBuyResult = buyResult;
              if (!finalBuyResult.ok) {
                if (finalBuyResult.hardFail) {
                  throw new Error(buyResult.error || 'Something went wrong â€” please try again in a moment.');
                }
                finalBuyResult = await continueCartPreparationUntilVerified({
                  cartPayload: buyCartBody,
                  variantId: Number(data.variantId),
                  sectionIds: [],
                  pendingPhase: finalBuyResult.pendingPhase || 'adding',
                  tag: 'BUY',
                  onStep: setSubmittingStep,
                });
              }
              if (!finalBuyResult.ok) {
                throw new Error(finalBuyResult.rateLimited
                  ? 'Rate limited — the store is handling a lot of requests right now.'
                  : 'We could not confirm the cart update yet. Please refresh the cart and try again.');
              }

              // Upload image in background â€” wait for the upload to complete
              // before navigating, so the request isn't cancelled mid-flight.
              const screenshotBase64 = await screenshotBase64Promise;
              if (screenshotBase64 && data.variantId && (!data.variantReused || data.variantHasImage === false)) {
                const tImg = performance.now();
                DEBUG() && console.log('[IMG] Buy Now â€” uploading before checkout redirect...');
                // 2 attempts max: the image matters at checkout, but we won't
                // hold the redirect through a third long retry.
                const buyImageUrl = await uploadVariantImageWithRetry({
                  apiBase,
                  variantId: data.variantId,
                  productId: resolvedShopifyIds.productId,
                  image: screenshotBase64,
                  tag: 'BUY',
                  maxAttempts: 2,
                });
                DEBUG() && console.log(`[IMG] Buy Now upload: ${buyImageUrl ? 'ok' : 'failed'} in ${Math.round(performance.now() - tImg)}ms`);
              }

              // Step 4: Go straight to checkout
              DEBUG() && console.log(`[BUY] âœ“ TOTAL: ${Math.round(performance.now() - tBuyTotal)}ms`);
              failPhase = 'buy:redirecting';
              setSubmittingStep('buy:redirecting');
              saveConfigForRestore();
              shouldResetSubmitting = false;
              prematureCartGuard.stop();
              window.location.href = buildShopifyPath('checkout');
              // Safety: if navigation doesn't complete in 15s (slow mobile), unlock the UI
              setTimeout(() => {
                submittingRef.current = false;
                setIsSubmitting(false);
                setSubmittingAction(null);
                setSubmittingStep('');
              }, 15000);
              return;

            } catch (err: any) {
              console.error('Buy now error:', err);
              recordCartFailure({
                requestId, action: 'buy', phase: failPhase, err,
                variantId: failVariantId, variantReused: failVariantReused,
                serverTimingMs: failServerMs, config, apiBase,
              });
              const msg = formatCheckoutErrorMessage(err?.message || 'Unknown error', 'buy');
              // Not a dead-end: show the "tap to retry" banner (server is idempotent).
              setSubmitError({ action: 'buy', message: msg.length > 220 ? msg.slice(0, 220) + '...' : msg });
            } finally {
              prematureCartGuard.stop();
              submittingRef.current = false;
              if (shouldResetSubmitting) {
                setIsSubmitting(false);
                setSubmittingAction(null);
                setSubmittingStep('');
              }
            }
          }}
        />

        {isSubmitting && submittingAction && (
          <CartProgressOverlay action={submittingAction} step={submittingStep} />
        )}
      </div>

      <RalModal open={ralOpen} onClose={() => setRalOpen(false)} />

      {pdfOpen && (
        <Suspense fallback={null}>
          <PdfPreviewModal
            open={pdfOpen}
            onClose={() => setPdfOpen(false)}
            captureSnapshot={() => captureCanvasScreenshot(appLayoutRef, { resetView: true, hideLabels: true, framed: true })}
          />
        </Suspense>
      )}

      {(() => {
        const portalTarget = (window as any).__chasePortalContainer as HTMLElement | undefined;
        const overlays = (
          <>
            <div className={`ar-overlay${arActive ? ' active' : ''}`}>
              <button className="ar-close" onClick={() => setArActive(false)}>&times;</button>
              <model-viewer
                ref={arViewerRef}
                ar
                ar-modes="webxr scene-viewer quick-look"
                camera-controls
                touch-action="pan-y"
                auto-rotate
                shadow-intensity="1"
                environment-image="neutral"
                exposure="1.2"
                alt="Chase Cover 3D Preview"
                style={{ '--poster-color': '#222', display: arLoading ? 'none' : 'block' } as any}
              >
                <button slot="ar-button" style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', padding: '10px 24px', background: '#c9873b', color: '#fff', border: 'none', borderRadius: 8, fontFamily: 'DM Sans, sans-serif', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                  Place in your space
                </button>
              </model-viewer>
              {arLoading && <div className="ar-loading">Preparing 3D model...</div>}
            </div>

            <div className={`qr-overlay${qrActive ? ' active' : ''}`}>
              <div className="qr-card">
                <button className="qr-close" onClick={() => setQrActive(false)}>&times;</button>
                <div className="qr-title">View in Your Space</div>
                <div className="qr-desc">Scan this QR code with your phone's camera to place the chase cover in your environment.</div>
                <div className="qr-canvas-container">
                  <canvas ref={qrCanvasRef} />
                </div>
                <div ref={qrUrlRef} style={{ marginTop: 10, fontSize: 11, color: '#888', wordBreak: 'break-all', maxWidth: 220, textAlign: 'center' }} />
              </div>
            </div>

            <div className={`ar-mobile-prompt${showMobilePrompt ? ' active' : ''}`}>
              <h2>Configuration Loaded</h2>
              <p>Your custom chase cover is ready to be placed in AR.</p>
              <button className="launch-ar-big-btn" onClick={() => { setShowMobilePrompt(false); launchAR(); }}>
                Launch AR Experience
              </button>
            </div>
          </>
        );
        return portalTarget ? createPortal(overlays, portalTarget) : overlays;
      })()}
    </>
  );
}
