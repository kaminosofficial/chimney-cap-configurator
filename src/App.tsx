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

function applySectionUpdatesPreservingCartUi(sections: Record<string, string>, reason: string) {
  const wasOpen = isCartUiOpen();
  applySectionUpdates(sections);

  if (!wasOpen) return;

  window.requestAnimationFrame(() => {
    forceOpenCartUi();
    window.setTimeout(() => releasePageScrollLockIfCartClosed(reason), 150);
  });
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
    return `This is taking longer than expected, so we couldnâ€™t ${actionLabel}. Please refresh the page and try again. If it keeps happening, please check your connection and try once more.`;
  }

  if (lower.includes('network error') || lower.includes('failed to fetch') || lower.includes('load failed')) {
    return `We hit a network issue while trying to ${actionLabel}. Please refresh the page and try again. If the problem continues, please check your connection and try once more.`;
  }

  if (lower.includes('shopify is still finalizing your price')) {
    return `Your configuration is still syncing with Shopify. Please wait a moment, then refresh the page and try again.`;
  }

  if (lower.includes('http error') || lower.includes('internal server error') || lower.includes('failed to create variant')) {
    return `We couldnâ€™t ${actionLabel} right now. Please refresh the page and try again in a moment.`;
  }

  return `${message || `We couldnâ€™t ${actionLabel} right now.`} Please refresh the page and try again.`;
}

const ADD_TO_CART_API_TIMEOUT_MS = 30000;
const ADD_TO_CART_API_MAX_ATTEMPTS = 3;
const RETRYABLE_ADD_TO_CART_STATUS = new Set([429, 502, 503, 504]);

function getAddToCartApiRetryDelayMs(attempt: number): number {
  const base = Math.min(1800, 450 * (2 ** Math.max(0, attempt - 1)));
  return base + Math.round(Math.random() * 250);
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

      if (timedOut || attempt >= ADD_TO_CART_API_MAX_ATTEMPTS) {
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

      const delayMs = getAddToCartApiRetryDelayMs(attempt);
      console.warn(`[${tag}] /api/add-to-cart retry ${attempt}/${ADD_TO_CART_API_MAX_ATTEMPTS} after network error: ${fetchErr?.message || 'unknown'} (${attemptMs}ms)`);
      emitCartDebug('api-request-retry', {
        tag,
        attempt,
        maxAttempts: ADD_TO_CART_API_MAX_ATTEMPTS,
        reason: 'network',
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
    throw new Error('Request timed out. Please check your connection and try again.');
  }

  DEBUG() && console.warn(`[${tag}] /api/add-to-cart exhausted retries`, lastFetchErr?.message || lastFetchErr);
  throw new Error('Network error. Please check your connection and try again.');
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
  return selectUsableRenderedSections(
    sections,
    { variantId, priceText: expectedPriceText },
    { requireVariant: true },
  ).usableSections;
}

async function fetchCartState(tag: string): Promise<any | null> {
  try {
    const res = await fetch(
      buildShopifyPath('cart.js', { _: Date.now() }),
      { cache: 'no-store' }
    );
    if (!res.ok) {
      console.warn(`[${tag}] Cart JSON fetch failed: HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e: any) {
    console.warn(`[${tag}] Cart JSON fetch error: ${e?.message}`);
    return null;
  }
}

async function fetchRenderedSections(sectionIds: string[], tag: string): Promise<Record<string, string> | null> {
  if (sectionIds.length === 0) return null;

  try {
    const url = new URL(getCurrentPageContextPath(), window.location.origin);
    url.searchParams.set('sections', sectionIds.join(','));
    url.searchParams.set('_', String(Date.now()));

    const requestPath = `${url.pathname}${url.search}`;
    DEBUG() && console.log(`[${tag}] Fetching rendered sections from ${requestPath}`);

    const res = await fetch(requestPath, { cache: 'no-store' });
    if (!res.ok) {
      console.warn(`[${tag}] Section fetch failed: HTTP ${res.status}`);
      return null;
    }

    const data = await res.json().catch(() => null);
    if (!data || typeof data !== 'object') {
      console.warn(`[${tag}] Section fetch returned non-JSON or empty response`);
      return null;
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
      return null;
    }

    DEBUG() && console.log(`[${tag}] Rendered sections fetched: ${Object.keys(rendered).join(', ')}`);
    return rendered;
  } catch (e: any) {
    console.warn(`[${tag}] Section fetch error: ${e?.message}`);
    return null;
  }
}

async function syncCartUiFromStorefront(tag: string) {
  const cartData = await fetchCartState(tag);
  if (cartData) {
    updateCartBadgeCount(cartData.item_count ?? 0);
    dispatchCartSyncEvents(cartData);
  }

  const sectionIds = discoverCartSectionIds();
  if (sectionIds.length === 0) {
    return cartData;
  }

  const renderedSections = await fetchRenderedSections(sectionIds, tag);
  const sectionSelection = selectUsableRenderedSections(renderedSections);
  if (sectionSelection.usableSections) {
    applySectionUpdatesPreservingCartUi(sectionSelection.usableSections, `${tag.toLowerCase()}-sync`);
  }

  return cartData;
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
}> {
  const {
    sectionIds,
    tag,
    expected,
    requirements,
    maxWaitMs,
    delayMs = 1200,
    seedSections = [],
  } = opts;

  let lastRejectedSections: Record<string, any> | null = null;

  for (const seed of seedSections) {
    if (!seed.sections) continue;
    const selection = selectUsableRenderedSections(seed.sections, expected, requirements);
    if (selection.usableSections) {
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

  while (Date.now() - start < maxWaitMs) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }
    attempt++;

    const fetchedSections = await fetchRenderedSections(sectionIds, tag);
    const selection = selectUsableRenderedSections(fetchedSections, expected, requirements);
    if (selection.usableSections) {
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
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
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

// Trim the surrounding white/transparent margin from a captured canvas so the
// PDF hero render is tightly cropped to the model (used by the PDF export only).
function cropWhitespace(canvas: HTMLCanvasElement): HTMLCanvasElement {
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    const width = canvas.width;
    const height = canvas.height;
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let found = false;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];

        if (a > 10 && (r < 250 || g < 250 || b < 250)) {
          found = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (!found) return canvas;

    const padding = 24;
    const cropX = Math.max(0, minX - padding);
    const cropY = Math.max(0, minY - padding);
    const cropW = Math.min(width - cropX, (maxX - minX) + padding * 2);
    const cropH = Math.min(height - cropY, (maxY - minY) + padding * 2);

    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = cropW;
    croppedCanvas.height = cropH;
    const croppedCtx = croppedCanvas.getContext('2d');
    if (!croppedCtx) return canvas;

    croppedCtx.fillStyle = '#ffffff';
    croppedCtx.fillRect(0, 0, cropW, cropH);
    croppedCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    return croppedCanvas;
  } catch (e) {
    console.warn('[CROP] Failed to crop whitespace:', e);
    return canvas;
  }
}

async function captureCanvasScreenshot(
  appLayoutRef: React.RefObject<HTMLDivElement | null>,
  options?: { resetView?: boolean; hideLabels?: boolean; cropToContent?: boolean }
): Promise<string | undefined> {



  try {

    if (options?.resetView) {
      cameraActions.reset();
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
        const out = options?.cropToContent ? cropWhitespace(tmp) : tmp;
        result = out.toDataURL('image/jpeg', 0.85);
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
  }
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
  pendingPhase?: 'adding' | 'confirm' | 'price-wait';
  attempts: number;
  totalMs: number;
}> {
  const { cartPayload, variantId, sectionIds, maxWaitMs, tag, expectedPriceText, onStep } = opts;
  const start = Date.now();
  const MAX_ATTEMPTS = 20;
  const stepPrefix = tag === 'CART' ? 'cart' : 'buy';
  let attempts = 0;
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
          const compactError = errorText.replace(/\s+/g, ' ').trim();

          if (res.status === 422) {
            console.warn(`[${tag}] cart/add.js still propagating: HTTP 422 ${compactError.slice(0, 160)}`);
            onStep?.(`${stepPrefix}:syncing`);
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

        const confirmedCart = await fetchCartState(`${tag}-CONFIRM`);
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
            ? await fetchRenderedSections(sectionIds, `${tag}-SECTIONS-CONFIRM`)
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

    const delay = phase === 'confirm' ? 1200 : 1500;
    await new Promise(r => setTimeout(r, delay));

    const cartData = await fetchCartState(tag);
    if (!cartData) {
      DEBUG() && console.log(`[${tag}] cart.js unavailable while waiting in ${phase} (${elapsed}s)`);
      onStep?.(`${stepPrefix}:syncing`);
      continue;
    }

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
      ? await fetchRenderedSections(sectionIds, `${tag}-SECTIONS-WAIT`)
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
          const compactError = errorText.replace(/\s+/g, ' ').trim();

          if (res.status === 422) {
            console.warn(`[${tag}] Pending add still propagating: HTTP 422 ${compactError.slice(0, 160)}`);
            onStep?.(`${stepPrefix}:syncing`);
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

        const confirmedCart = await fetchCartState(`${tag}-PENDING-CONFIRM`);
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
            ? await fetchRenderedSections(sectionIds, `${tag}-PENDING-SECTIONS`)
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

    await new Promise(r => setTimeout(r, phase === 'confirm' ? 1200 : 1500));

    const cartData = await fetchCartState(tag);
    if (!cartData) {
      onStep?.(`${stepPrefix}:syncing`);
      continue;
    }

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
      ? await fetchRenderedSections(sectionIds, `${tag}-PENDING-SECTIONS-WAIT`)
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
  // Synchronous guard against double-taps â€” React state can be stale across rapid clicks
  const submittingRef = useRef(false);

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
    }
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
      void syncCartUiFromStorefront('PAGESHOW');
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
          onAddToCart={async () => {
            if (isSubmitting || submittingRef.current) return;
            const apiBase = (window as any).__chaseApiBase || '';
            if (!apiBase) {
              alert('Configuration error: API base not found. Are you running this via the Shopify integration?');
              return;
            }

            submittingRef.current = true;
            let shouldResetSubmitting = true;
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

              setSubmittingStep('cart:adding');
              const t1 = performance.now();

              if (data.variantId && !data.variantReused) {
                imageUploadPromise = (async () => {
                  const captureResult = await screenshotBase64Promise;
                  const screenshotBase64 = captureResult.image;
                  const captureMs = captureResult.captureMs;

                  if (!screenshotBase64) {
                    DEBUG() && console.warn('[IMG] Screenshot unavailable before cart open; skipping upload');
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

                  const uploadStartedAt = performance.now();
                  try {
                    const imgRes = await fetch(`${apiBase}/api/variant-image`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        variantId: data.variantId,
                        productId: resolvedShopifyIds.productId,
                        image: screenshotBase64,
                      }),
                    });
                    const uploadMs = Math.round(performance.now() - uploadStartedAt);
                    if (!imgRes.ok) {
                      console.warn(`[IMG] Upload failed before cart open: HTTP ${imgRes.status} (${uploadMs}ms)`);
                      return null;
                    }
                    const imgData = await imgRes.json().catch(() => null);
                    expectedImageUrl = imgData?.imageUrl ?? null;
                    emitCartDebug('image-upload-complete', {
                      variantId: debugVariantId,
                      imageUrl: expectedImageUrl,
                      captureMs,
                      uploadMs,
                      dom: collectCartDomSnapshot(),
                    });
                    return expectedImageUrl;
                  } catch (e: any) {
                    console.warn('[IMG] Upload error before cart open:', e?.message);
                    return null;
                  }
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
                throw new Error('We could not confirm the cart update yet. Please refresh the cart and try again.');
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

              // Check if image upload finished during the retry loop.
              // Give it a short extra window (up to 1s) if it's nearly done.
              const imageReady = await waitForPromiseWithin(imageUploadPromise, 1200);
              const imageUrl: string | null = imageReady.resolved ? imageReady.value : null;
              let seededImageSections: Record<string, string> | null = null;
              if (imageUrl && drawerSectionIds.length > 0) {
                DEBUG() && console.log('[IMG] Image ready before drawer open â€” fetching fresh sections with image...');
                try {
                  const imageSections = await fetchRenderedSections(drawerSectionIds, 'IMG');
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
              const verifiedSections = await fetchRenderedSections(drawerSectionIds, 'CART');
              const sectionReadiness = await waitForUsableRenderedSections({
                sectionIds: drawerSectionIds,
                tag: 'CART-SECTIONS',
                expected: renderExpectation,
                requirements: { requireVariant: true },
                maxWaitMs: drawerSectionIds.length > 0 ? 3500 : 0,
                seedSections: [
                  { source: 'verified-initial', sections: verifiedSections },
                  { source: 'bundled-initial', sections: finalRetryResult.sectionsHtml },
                  { source: 'image-initial', sections: seededImageSections },
                ],
              });

              if (sectionReadiness.usableSections) {
                finalCartData = { ...finalCartData, sections: sectionReadiness.usableSections };
                applySectionUpdates(sectionReadiness.usableSections);
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
                verifiedSections: summarizeSectionsForDebug(verifiedSections, renderExpectation),
                bundledSections: summarizeSectionsForDebug(finalRetryResult.sectionsHtml, renderExpectation),
                imageSections: summarizeSectionsForDebug(seededImageSections, renderExpectation),
                usableSectionSource: sectionReadiness.source,
                sectionMounts: collectSectionMountSnapshot(drawerSectionIds),
                dom: collectCartDomSnapshot(),
              });

              if (!(typeof finalCartData?.item_count === 'number' && finalCartData.item_count > 0)) {
                const confirmedCartData = await fetchCartState('CART-BADGE');
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

              if (drawerSectionIds.length > 0 && !sectionReadiness.usableSections) {
                // Sections still show $0 â€” DON'T redirect to /cart (it would also show $0).
                // Instead, keep the spinner and poll a bit longer for correct sections.
                console.warn('[CART] Sections not ready after initial wait â€” extended retry...');
                const extendedSections = await waitForUsableRenderedSections({
                  sectionIds: drawerSectionIds,
                  tag: 'CART-EXTENDED',
                  expected: renderExpectation,
                  requirements: { requireVariant: true },
                  maxWaitMs: 6000,
                  delayMs: 2000,
                  seedSections: [],
                });

                if (extendedSections.usableSections) {
                  DEBUG() && console.log('[CART] Extended retry got usable sections');
                  applySectionUpdates(extendedSections.usableSections);
                  finalCartData = { ...finalCartData, sections: extendedSections.usableSections };
                } else {
                  // Last resort: open drawer anyway â€” the theme will render whatever it has,
                  // and we dispatch sync events so it can self-correct
                  console.warn('[CART] Extended retry exhausted â€” opening drawer with best-effort sections');
                  emitCartDebug('drawer-open-skipped', {
                    variantId: debugVariantId,
                    reason: 'rendered-sections-not-ready-extended',
                    targetItem: summarizeCartItemForDebug(findTargetCartItem(finalCartData, debugVariantId)),
                    dom: collectCartDomSnapshot(),
                  });
                }
              }

              // Open the cart drawer/notification â€” price is correct by now
              const drawerOpened = tryOpenCartUi();

              if (drawerOpened) {
                DEBUG() && console.log('[CART] Cart drawer opened');
                dispatchCartSyncEvents(finalCartData);
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
                  const latestCartData = await fetchCartState('IMG');
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
                    const fetchedImageSections = await fetchRenderedSections(drawerSectionIds, 'IMG');
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
              const msg = formatCheckoutErrorMessage(err?.message || 'Unknown error', 'cart');
              alert(msg.length > 200 ? msg.slice(0, 200) + '...' : msg);
            } finally {
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

              const { res, data, attempts: buyApiAttempts, totalMs: buyApiMs } = await postAddToCartApi({
                apiBase,
                payload,
                tag: 'BUY',
              });
              if (!res.ok) {
                console.error('Buy Now API error:', res.status, data);
                throw new Error(data?.error || `HTTP error! status: ${res.status}`);
              }
              if (data?._timing) {
                const { authPricingMs, optionNameMs, variantMs, propagationMs, totalMs } = data._timing;
                DEBUG() && console.log(`[BUY] API: ${buyApiMs}ms (${buyApiAttempts} attempt${buyApiAttempts > 1 ? 's' : ''}) | auth+pricing: ${authPricingMs}ms | optionName: ${optionNameMs}ms | variant: ${variantMs}ms | propagation: ${propagationMs ?? 0}ms | server total: ${totalMs}ms`);
              } else {
                DEBUG() && console.log(`[BUY] API: ${buyApiMs}ms (${buyApiAttempts} attempt${buyApiAttempts > 1 ? 's' : ''})`);
              }

              DEBUG() && console.log(`[BUY] Server result: variantId=${data.variantId}, reused=${data.variantReused}, propagated=${data.propagated}, price=${data.price}`);

              // Step 2: Clear cart, add item, then verify price before checkout
              setSubmittingStep('buy:adding');
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
                throw new Error('We could not confirm the cart update yet. Please refresh the cart and try again.');
              }

              // Upload image in background â€” wait for the upload to complete
              // before navigating, so the request isn't cancelled mid-flight.
              const screenshotBase64 = await screenshotBase64Promise;
              if (screenshotBase64 && data.variantId && !data.variantReused) {
                const tImg = performance.now();
                DEBUG() && console.log('[IMG] Buy Now â€” uploading before checkout redirect...');
                try {
                  const imgRes = await fetch(`${apiBase}/api/variant-image`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      variantId: data.variantId,
                      productId: resolvedShopifyIds.productId,
                      image: screenshotBase64,
                    }),
                  });
                  const imgMs = Math.round(performance.now() - tImg);
                  DEBUG() && console.log(`[IMG] Buy Now upload: ${imgRes.ok ? 'ok' : imgRes.status} in ${imgMs}ms`);
                } catch (e: any) {
                  console.warn('[IMG] Buy Now upload failed:', e?.message);
                }
              }

              // Step 4: Go straight to checkout
              DEBUG() && console.log(`[BUY] âœ“ TOTAL: ${Math.round(performance.now() - tBuyTotal)}ms`);
              setSubmittingStep('buy:redirecting');
              saveConfigForRestore();
              shouldResetSubmitting = false;
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
              const msg = formatCheckoutErrorMessage(err?.message || 'Unknown error', 'buy');
              alert(msg.length > 220 ? msg.slice(0, 220) + '...' : msg);
            } finally {
              submittingRef.current = false;
              if (shouldResetSubmitting) {
                setIsSubmitting(false);
                setSubmittingAction(null);
                setSubmittingStep('');
              }
            }
          }}
        />
      </div>

      <RalModal open={ralOpen} onClose={() => setRalOpen(false)} />

      {pdfOpen && (
        <Suspense fallback={null}>
          <PdfPreviewModal
            open={pdfOpen}
            onClose={() => setPdfOpen(false)}
            captureSnapshot={() => captureCanvasScreenshot(appLayoutRef, { resetView: true, hideLabels: true, cropToContent: true })}
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
