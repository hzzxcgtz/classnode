'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import styles from './collection-results.module.css';

type CloudPhrase = { phrase: string; studentIds: string[] };
const palette = [
  '#224e83', '#9b341d', '#116451', '#653585', '#806000',
  '#126783', '#8d3151', '#40631e', '#49449b', '#82502a',
];
const superscriptDigits = '⁰¹²³⁴⁵⁶⁷⁸⁹';

function phraseHash(phrase: string, seed = 0) {
  let hash = 2166136261 ^ seed;
  for (const character of phrase) {
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 16777619);
  }
  return hash >>> 0;
}

export function OpinionCloud({ phrases, presentation, fontScale, showCounts, layoutSeed }: {
  phrases: CloudPhrase[];
  presentation: boolean;
  fontScale: number;
  showCounts: boolean;
  layoutSeed: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const displayedSeed = useRef<number | null>(null);
  const previousPositions = useRef(new Map<string, { x: number; y: number }>());
  const focusedLabel = useRef<string | null>(null);
  const phraseData = JSON.stringify(phrases.map(({ phrase, studentIds }) => ({ phrase, count: studentIds.length })));
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const element = host.current;
    const viewport = element?.parentElement;
    if (!element || !viewport) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;
    async function render(container: HTMLDivElement, viewport: HTMLElement) {
      const echarts = await import('echarts');
      await import('echarts-wordcloud');
      if (disposed) return;

      const chart = echarts.init(container, undefined, { renderer: 'svg' });
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
      let check: number | undefined;
      let offset = { x: 0, y: 0 };
      let limits = { left: 0, right: 0, top: 0, bottom: 0 };
      let drag: { pointerId: number; x: number; y: number; offset: typeof offset } | undefined;
      let dragged = false;

      function moveCloud(x: number, y: number) {
        offset = {
          x: Math.max(limits.left, Math.min(limits.right, x)),
          y: Math.max(limits.top, Math.min(limits.bottom, y)),
        };
        container.style.setProperty('--cloud-pan-x', `${offset.x}px`);
        container.style.setProperty('--cloud-pan-y', `${offset.y}px`);
      }

      function startDrag(event: PointerEvent) {
        if (event.pointerType !== 'mouse' || !event.isPrimary || event.button !== 0) return;
        dragged = false;
        if (!viewport.hasAttribute('data-cloud-pannable') ||
            (event.target instanceof Element && event.target.closest('svg text'))) return;
        drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, offset };
        viewport.setPointerCapture(event.pointerId);
      }

      function dragCloud(event: PointerEvent) {
        if (drag?.pointerId !== event.pointerId) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (!dragged && Math.hypot(dx, dy) < 4) return;
        dragged = true;
        viewport.setAttribute('data-cloud-dragging', '');
        delete container.dataset.cloudHovered;
        moveCloud(drag.offset.x + dx, drag.offset.y + dy);
      }

      function endDrag(event: PointerEvent) {
        if (drag?.pointerId !== event.pointerId) return;
        drag = undefined;
        viewport.removeAttribute('data-cloud-dragging');
      }

      function updateFocus() {
        for (const label of container.querySelectorAll('svg text')) {
          const selected = focusedLabel.current === label.textContent;
          label.setAttribute('aria-pressed', String(selected));
        }
        container.toggleAttribute('data-cloud-focused', focusedLabel.current !== null);
      }

      function focusOpinion(event: MouseEvent | KeyboardEvent) {
        if (event instanceof MouseEvent && event.detail && dragged) return;
        if (event instanceof KeyboardEvent && !['Enter', ' ', 'Escape'].includes(event.key)) return;
        const label = event.target instanceof Element ? event.target.closest('svg text') : null;
        if (event instanceof KeyboardEvent) {
          if (!label) return;
          event.preventDefault();
          event.stopPropagation();
        }
        const name = event instanceof KeyboardEvent && event.key === 'Escape' ? null : label?.textContent;
        focusedLabel.current = name && focusedLabel.current !== name ? name : null;
        updateFocus();
      }

      function hoverOpinion(event: PointerEvent) {
        if (event.pointerType !== 'mouse' || viewport.hasAttribute('data-cloud-dragging')) return;
        const target = event.type === 'pointerout' ? event.relatedTarget : event.target;
        const label = target instanceof Element ? target.closest('svg text') : null;
        container.toggleAttribute('data-cloud-hovered', !!label && container.contains(label));
      }

      viewport.addEventListener('click', focusOpinion);
      viewport.addEventListener('pointerdown', startDrag);
      viewport.addEventListener('pointermove', dragCloud);
      viewport.addEventListener('pointerup', endDrag);
      viewport.addEventListener('pointercancel', endDrag);
      viewport.addEventListener('lostpointercapture', endDrag);
      container.addEventListener('keydown', focusOpinion);
      container.addEventListener('pointerover', hoverOpinion);
      container.addEventListener('pointerout', hoverOpinion);
      const entries: { phrase: string; count: number }[] = JSON.parse(phraseData);
      const labels = entries.sort((a, b) => phraseHash(a.phrase) - phraseHash(b.phrase))
        .map(({ phrase, count }, index) => ({
          name: showCounts ? `${phrase}\u2002${String(count).replace(/\d/g, digit => superscriptDigits[Number(digit)])}` : phrase,
          value: count,
          textStyle: { color: palette[index % palette.length] },
          order: phraseHash(phrase, layoutSeed),
        })).sort((a, b) => a.order - b.order);
      const counts = labels.map(label => label.value);
      const min = Math.min(...counts);
      const max = Math.max(...counts);

      const measure = document.createElement('canvas').getContext('2d');
      const fontFamily = getComputedStyle(container).fontFamily;
      const weights = counts.map(count => max === min ? 1 : .65 + .35 * Math.sqrt((count - min) / (max - min)));
      const sampleSize = 100;
      if (measure) measure.font = `700 ${sampleSize}px ${fontFamily}`;
      const widths = labels.map((label, index) => {
        const textWidth = measure ? measure.measureText(label.name).width / sampleSize : Array.from(label.name).length;
        return textWidth * weights[index];
      });
      const widest = Math.max(...widths);
      const textArea = widths.reduce((area, width, index) => area + width * weights[index], 0);

      function layout(retry = false) {
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (!width || !height) return;
        delete container.dataset.cloudHovered;
        viewport.removeAttribute('data-cloud-pannable');
        container.dataset.cloudLayout = 'pending';
        // Size against both dimensions, with room for packing and hover enlargement.
        const widthShare = labels.length === 1 ? .78 : labels.length <= 4 || width < 560 ? .68 : .56;
        const fittedSize = Math.min(
          width * widthShare / widest,
          Math.sqrt(width * height * .4 / textArea),
          height * (labels.length <= 2 ? .26 : .18),
        );
        const fontSize = fittedSize * fontScale / 100 * (retry ? .8 : 1);
        const data = labels.map((label, index) => ({
          name: label.name,
          value: label.value,
          textStyle: { ...label.textStyle, fontSize: Math.max(13, Math.round(fontSize * weights[index])) },
        }));
        if (chart.getWidth() !== width || chart.getHeight() !== height) {
          chart.clear();
          chart.resize({ width, height });
        }
        const series = {
          type: 'wordCloud' as const,
          // Vary the search contour on demand while keeping it wide and centered.
          shape: (angle: number) => 1 + .16 * Math.cos(3 * angle + layoutSeed * 2.4),
          left: 'center',
          top: 'center',
          width: '92%',
          height: '86%',
          rotationRange: [0, 0],
          gridSize: 18,
          drawOutOfBound: false,
          shrinkToFit: true,
          layoutAnimation: false,
          textStyle: { fontFamily, fontWeight: 700 },
          data,
        };
        chart.setOption({
          animation: false,
          tooltip: {
            show: !showCounts,
            formatter: '{c} 份作答',
            position: (_point: unknown, _params: unknown, _element: unknown, _rect: unknown,
              size: { viewSize: number[]; contentSize: number[] }) => [size.viewSize[0] - size.contentSize[0] - 12, 4],
            confine: true,
          },
          series: [series as unknown as import('echarts').SeriesOption],
        }, { notMerge: true });
        window.clearTimeout(check);
        check = window.setTimeout(() => {
          const rendered = new Set<string | null>();
          const textElements = container.querySelectorAll<SVGTextElement>('svg text');
          for (const label of textElements) {
            rendered.add(label.textContent);
            label.setAttribute('role', 'button');
            label.setAttribute('tabindex', '0');
            // Compose the scale after ECharts' placement matrix so the label stays centered.
            const placement = label.transform.baseVal;
            if (placement.numberOfItems === 1) {
              const { a, b, c, d, e, f } = placement.getItem(0).matrix;
              label.style.setProperty('--cloud-placement', `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`);
            }
          }
          const missing = labels.some(label => !rendered.has(label.name));
          if (missing && !retry) {
            layout(true);
            return;
          }
          if (!rendered.has(focusedLabel.current)) focusedLabel.current = null;
          updateFocus();
          const firstLayout = displayedSeed.current === null;
          const rearranged = displayedSeed.current !== layoutSeed;
          const canvas = container.getBoundingClientRect();
          const bounds = Array.from(textElements, label => label.getBoundingClientRect());
          if (!missing && bounds.length) {
            limits = {
              left: Math.min(0, canvas.left - Math.min(...bounds.map(rect => rect.left)) + 6),
              right: Math.max(0, canvas.right - Math.max(...bounds.map(rect => rect.right)) - 6),
              top: Math.min(0, canvas.top - Math.min(...bounds.map(rect => rect.top)) + 6),
              bottom: Math.max(0, canvas.bottom - Math.max(...bounds.map(rect => rect.bottom)) - 6),
            };
            moveCloud(offset.x, offset.y);
            viewport.setAttribute('data-cloud-pannable', '');
          }
          if (!missing && rearranged && !reducedMotion.matches) {
            if (!firstLayout && previousPositions.current.size) {
              delete container.dataset.cloudLayout;
              textElements.forEach((label, index) => {
                const from = previousPositions.current.get(label.textContent ?? '');
                if (!from) return;
                const rect = bounds[index];
                const dx = from.x - (rect.left + rect.width / 2 - canvas.left);
                const dy = from.y - (rect.top + rect.height / 2 - canvas.top);
                label.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }],
                  { duration: 380, easing: 'cubic-bezier(.22, .61, .36, 1)' });
              });
            } else {
              const textCenterX = (Math.min(...bounds.map(rect => rect.left)) + Math.max(...bounds.map(rect => rect.right))) / 2;
              const textCenterY = (Math.min(...bounds.map(rect => rect.top)) + Math.max(...bounds.map(rect => rect.bottom))) / 2;
              const startScale = .2;
              // Center the visible text at the start even when the packing is asymmetric.
              container.style.setProperty('--cloud-enter-x', `${(canvas.left + canvas.width / 2 - textCenterX) * startScale}px`);
              container.style.setProperty('--cloud-enter-y', `${(canvas.top + canvas.height / 2 - textCenterY) * startScale}px`);
              container.style.setProperty('--cloud-enter-scale', String(startScale));
              container.dataset.cloudLayout = 'enter';
              textElements.forEach((label, index) => {
                label.animate([{ opacity: 0 }, { opacity: 1 }],
                  { duration: 160, delay: index * 24, fill: 'backwards' });
              });
            }
          } else {
            delete container.dataset.cloudLayout;
          }
          displayedSeed.current = layoutSeed;
          setFallback(missing);
        }, 250);
      }

      const observer = new ResizeObserver(() => layout());
      cleanup = () => {
        observer.disconnect();
        window.clearTimeout(check);
        viewport.removeEventListener('click', focusOpinion);
        viewport.removeEventListener('pointerdown', startDrag);
        viewport.removeEventListener('pointermove', dragCloud);
        viewport.removeEventListener('pointerup', endDrag);
        viewport.removeEventListener('pointercancel', endDrag);
        viewport.removeEventListener('lostpointercapture', endDrag);
        if (drag && viewport.hasPointerCapture(drag.pointerId)) viewport.releasePointerCapture(drag.pointerId);
        viewport.removeAttribute('data-cloud-pannable');
        viewport.removeAttribute('data-cloud-dragging');
        container.removeEventListener('keydown', focusOpinion);
        container.removeEventListener('pointerover', hoverOpinion);
        container.removeEventListener('pointerout', hoverOpinion);
        delete container.dataset.cloudHovered;
        if (container.dataset.cloudLayout !== 'pending') {
          const canvas = container.getBoundingClientRect();
          previousPositions.current = new Map(Array.from(container.querySelectorAll('svg text'), label => {
            const rect = label.getBoundingClientRect();
            return [label.textContent ?? '', {
              x: rect.left + rect.width / 2 - canvas.left,
              y: rect.top + rect.height / 2 - canvas.top,
            }];
          }));
        }
        chart.dispose();
        delete container.dataset.cloudLayout;
        container.style.removeProperty('--cloud-pan-x');
        container.style.removeProperty('--cloud-pan-y');
      };
      observer.observe(container);
    }

    void render(element, viewport).catch(() => {
      if (!disposed) setFallback(true);
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [phraseData, presentation, fontScale, showCounts, layoutSeed]);

  return <div className={styles.cloud} role="group" aria-label="共同观点" style={{ '--cloud-font-scale': fontScale / 100 } as CSSProperties}>
    <div ref={host} className={styles.cloudChart} aria-hidden={fallback} style={fallback ? { visibility: 'hidden' } : undefined} />
    <ul className={fallback ? styles.cloudFallback : undefined} hidden={!fallback}>
      {phrases.map(({ phrase, studentIds }) => <li key={phrase}>
        {phrase}{showCounts && ` · ${studentIds.length} 份`}
      </li>)}
    </ul>
  </div>;
}
