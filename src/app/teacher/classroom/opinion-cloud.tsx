'use client';

import { WordCloud, type ComputedWordData, type Word, type WordRendererData } from '@isoterik/react-word-cloud';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type Ref } from 'react';
import { CLOUD_FONT, ClassroomCloudWord, horizontalCloudWord, useClassroomCloudColors } from './classroom-word-cloud';
import styles from './collection-results.module.css';

type CloudPhrase = { phrase: string; studentIds: string[] };
type Size = { width: number; height: number };
type Point = { x: number; y: number };

const superscriptDigits = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const layoutScales = [1, .82, .67, .55];

function OpinionLayout({ words, size, fontScale, selected, onSelect }: {
  words: Word[];
  size: Size;
  fontScale: number;
  selected: string | null;
  onSelect: (word: string | null) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [placedWords, setPlacedWords] = useState<ComputedWordData[] | null>(null);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    pointerId: number; origin: Point; offset: Point; min: Point; max: Point; moved: boolean;
  } | null>(null);
  const { fill, gradients } = useClassroomCloudColors();
  // The layout engine writes coordinates and sprite data onto its input words.
  const layoutInputs = useMemo(() => layoutScales.map(() => words.map(word => ({ ...word }))), [words]);
  // d3-cloud packs into 32-pixel columns. Leave room for the hover effect around the layout.
  const width = Math.floor(size.width * .94 / 32) * 32;
  // Keep the initial cloud compact inside the larger draggable viewport.
  const height = Math.floor(Math.min(size.height, 480) * .88 / 2) * 2;
  const baseSizes = useMemo(() => {
    const counts = words.map(word => word.value);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    const weights = counts.map(count => max === min ? 1 : .65 + .35 * Math.sqrt((count - min) / (max - min)));
    const measure = document.createElement('canvas').getContext('2d');
    if (measure) measure.font = `600 100px ${CLOUD_FONT}`;
    const widths = words.map(({ text }, index) =>
      (measure ? measure.measureText(text).width / 100 : Array.from(text).length) * weights[index]);
    const textArea = widths.reduce((area, wordWidth, index) => area + wordWidth * weights[index], 0);
    const fit = Math.min(
      Math.min(1700, width * (words.length <= 2 ? .84 : .69)) / Math.max(...widths),
      Math.sqrt(width * height * .41 / textArea),
      height * (words.length <= 2 ? .26 : .2),
    );
    return weights.map(weight => fit * weight * fontScale / 100);
  }, [words, width, height, fontScale]);

  const fontSize = useCallback((_word: Word, index: number) => {
    return Math.max(12, Math.floor(baseSizes[index] * layoutScales[attempt]));
  }, [baseSizes, attempt]);
  const completeLayout = useCallback((computed: ComputedWordData[]) => {
    if (computed.length < words.length && attempt < layoutScales.length - 1) {
      setAttempt(attempt + 1);
    } else {
      setPlacedWords(computed);
    }
  }, [attempt, words.length]);

  const selectWord = useCallback((word: string | null) => {
    onSelect(selected === word ? null : word);
  }, [onSelect, selected]);
  const renderWord = useCallback((data: WordRendererData, ref?: Ref<SVGTextElement>) =>
    <ClassroomCloudWord data={data} ref={ref} selected={selected === data.text} onSelect={selectWord}
      countLabel={`${data.value} 份作答`} />, [selected, selectWord]);

  const fallback = typeof OffscreenCanvas === 'undefined' || width < 32 || (placedWords !== null && placedWords.length < words.length);
  const ready = !fallback && placedWords !== null;

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (!ready || event.pointerType !== 'mouse' || !event.isPrimary || event.button !== 0 ||
        (event.target instanceof Element && event.target.closest('svg text'))) return;
    const viewport = event.currentTarget.getBoundingClientRect();
    // The layout engine measures padded sprites. Use the rendered text to limit dragging.
    const wordBounds = Array.from(event.currentTarget.querySelectorAll('svg text'), word => word.getBoundingClientRect());
    if (!wordBounds.length) return;
    drag.current = {
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      offset,
      min: {
        x: viewport.left + 6 - Math.min(...wordBounds.map(word => word.left)),
        y: viewport.top + 6 - Math.min(...wordBounds.map(word => word.top)),
      },
      max: {
        x: viewport.right - 6 - Math.max(...wordBounds.map(word => word.right)),
        y: viewport.bottom - 6 - Math.max(...wordBounds.map(word => word.bottom)),
      },
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveCloud(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.origin.x;
    const dy = event.clientY - active.origin.y;
    if (!active.moved && Math.hypot(dx, dy) < 4) return;
    active.moved = true;
    setDragging(true);
    setOffset({
      x: active.offset.x + Math.max(active.min.x, Math.min(active.max.x, dx)),
      y: active.offset.y + Math.max(active.min.y, Math.min(active.max.y, dy)),
    });
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    if (!drag.current.moved && event.type === 'pointerup') onSelect(null);
    drag.current = null;
    setDragging(false);
  }

  if (fallback) {
    return <ul className={styles.cloudFallback} style={{ '--cloud-font-scale': fontScale / 100 } as CSSProperties}>
      {words.map(word => <li key={word.text} title={`${word.value} 份作答`}><button type="button" aria-pressed={selected === word.text} onClick={() => selectWord(word.text)}>{word.text}</button></li>)}
    </ul>;
  }

  return <div className={styles.cloudViewport} data-cloud-pannable={ready || undefined}
    data-cloud-dragging={dragging || undefined} onPointerDown={startDrag} onPointerMove={moveCloud}
    onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
    <div className={styles.cloudChart} data-cloud-focused={selected !== null || undefined}
      data-cloud-ready={ready || undefined} aria-hidden={!ready}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}>
      <WordCloud key={attempt} words={layoutInputs[attempt]} width={width} height={height} font={CLOUD_FONT} fontWeight={600}
        fontSize={fontSize} rotate={horizontalCloudWord} padding={5} spiral="archimedean"
        fill={fill} gradients={gradients} renderWord={renderWord} onCompleteComputation={completeLayout}
        svgProps={{ width, height }} />
    </div>
  </div>;
}

export function OpinionCloud({ phrases, presentation, fontScale, showCounts, layoutSeed, selectedPhrase, onSelectPhrase }: {
  phrases: CloudPhrase[];
  presentation: boolean;
  fontScale: number;
  showCounts: boolean;
  layoutSeed: number;
  selectedPhrase?: string | null;
  onSelectPhrase?: (phrase: string | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  // Polling returns new arrays for the same report. Keep the layout inputs stable
  // until the visible words or their counts actually change.
  const wordSnapshot = JSON.stringify(phrases.map(({ phrase, studentIds }) => ({
    text: showCounts ? `${phrase}\u2002${String(studentIds.length).replace(/\d/g, digit => superscriptDigits[Number(digit)])}` : phrase,
    value: studentIds.length,
  })));
  const words = useMemo(() => JSON.parse(wordSnapshot) as Word[], [wordSnapshot]);
  const [highlight, setHighlight] = useState<string | null>(null);
  const selection = onSelectPhrase ? selectedPhrase : highlight;
  const selectedWord = words[phrases.findIndex(item => item.phrase === selection)]?.text ?? null;
  const selectWord = useCallback((word: string | null) => {
    const phrase = phrases[words.findIndex(item => item.text === word)]?.phrase ?? null;
    (onSelectPhrase ?? setHighlight)(phrase);
  }, [onSelectPhrase, phrases, words]);
  const layoutKey = JSON.stringify([size, fontScale, layoutSeed, wordSnapshot]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(([{ contentRect }]) => {
      const width = Math.floor(contentRect.width);
      const height = Math.floor(contentRect.height);
      if (width && height) {
        setSize(previous => previous?.width === width && previous.height === height ? previous : { width, height });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <div ref={host} className={styles.cloud} data-presentation={presentation || undefined}
    role="group" aria-label="共同观点">
    {size && words.length > 0 && <OpinionLayout key={layoutKey} words={words} size={size} fontScale={fontScale} selected={selectedWord} onSelect={selectWord} />}
  </div>;
}
