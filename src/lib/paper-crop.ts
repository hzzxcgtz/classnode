export type Point = { x: number; y: number };
export type Corners = [Point, Point, Point, Point];

export function validCorners(points: Corners) {
  return points.every((a, i) => {
    const b = points[(i + 1) % 4], c = points[(i + 2) % 4];
    return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) > 0.002;
  });
}

/** Find the largest bright, roughly quadrilateral region on a small preview. */
export function detectPaper({data, width, height}: ImageData): Corners | null {
  const gray = new Uint8Array(width * height);
  const histogram = new Uint32Array(256);
  let sum = 0;
  for (let i = 0; i < gray.length; i++) {
    const j = i * 4;
    const value = Math.round(data[j] * .299 + data[j + 1] * .587 + data[j + 2] * .114);
    gray[i] = value;
    histogram[value]++;
    sum += value;
  }
  let count = 0, lowSum = 0, best = 0, threshold = 0;
  for (let i = 0; i < 255; i++) {
    count += histogram[i];
    lowSum += histogram[i] * i;
    if (!count || count === gray.length) continue;
    const difference = (sum - lowSum) / (gray.length - count) - lowSum / count;
    const score = count * (gray.length - count) * difference ** 2;
    if (score > best && difference >= 24) { best = score; threshold = i; }
  }
  if (!best) return null;
  const queue = new Int32Array(gray.length);
  let largest = 0;
  let result: Corners | null = null;
  for (let i = 0; i < gray.length; i++) {
    if (gray[i] <= threshold) continue;
    let end = 0;
    const add = (index: number) => {
      if (gray[index] <= threshold) return;
      gray[index] = 0;
      queue[end++] = index;
    };
    add(i);
    let touchesEdge = false;
    for (let start = 0; start < end; start++) {
      const index = queue[start], x = index % width, y = Math.floor(index / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true;
      if (x > 0) add(index - 1);
      if (x < width - 1) add(index + 1);
      if (y > 0) add(index - width);
      if (y < height - 1) add(index + width);
    }
    if (touchesEdge || end <= largest || end < gray.length * .15) continue;
    const scores = [-Infinity, -Infinity, -Infinity, -Infinity];
    const points: Corners = [{x:0,y:0},{x:0,y:0},{x:0,y:0},{x:0,y:0}];
    for (let j = 0; j < end; j++) {
      const x = queue[j] % width, y = Math.floor(queue[j] / width);
      [-x-y, x-y, x+y, y-x].forEach((score, k) => {
        if (score > scores[k]) { scores[k] = score; points[k] = {x:x/(width-1), y:y/(height-1)}; }
      });
    }
    const area = points.reduce((sum, a, j) => {
      const b = points[(j + 1) % 4];
      return sum + a.x * b.y - b.x * a.y;
    }, 0) / 2;
    if (!validCorners(points) || end / (area * gray.length) < .75) continue;
    largest = end;
    result = points;
  }
  return result;
}

export function photoCanvas(image: HTMLImageElement, limit: number) {
  const scale = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d')!;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return {canvas, context};
}

/** Project a rectangular output back onto the four corners in the source image. */
export function straightenPaper(image: HTMLImageElement, corners: Corners) {
  if (!validCorners(corners)) throw new Error('请将四个角按顺序放在纸张边缘');
  const {canvas: source, context} = photoCanvas(image, 2000);
  const [a,b,c,d] = corners.map(({x,y}) => ({x:x*(source.width-1),y:y*(source.height-1)}));
  const distance = (p: Point, q: Point) => Math.hypot(p.x-q.x,p.y-q.y);
  const width = Math.max(2, Math.round(Math.max(distance(a,b),distance(d,c))));
  const height = Math.max(2, Math.round(Math.max(distance(a,d),distance(b,c))));
  const dx1 = b.x-c.x, dx2 = d.x-c.x, dx3 = a.x-b.x+c.x-d.x;
  const dy1 = b.y-c.y, dy2 = d.y-c.y, dy3 = a.y-b.y+c.y-d.y;
  const denominator = dx1*dy2-dx2*dy1;
  const g = (dx3*dy2-dx2*dy3)/denominator, h = (dx1*dy3-dx3*dy1)/denominator;
  const input = context.getImageData(0,0,source.width,source.height).data;
  const canvas = document.createElement('canvas');
  canvas.width=width; canvas.height=height;
  const outputContext = canvas.getContext('2d')!;
  const output = outputContext.createImageData(width,height);
  for (let y=0;y<height;y++) {
    const v=y/(height-1);
    for (let x=0;x<width;x++) {
      const u=x/(width-1), z=1+g*u+h*v;
      const sx=(a.x+(b.x*(1+g)-a.x)*u+(d.x*(1+h)-a.x)*v)/z;
      const sy=(a.y+(b.y*(1+g)-a.y)*u+(d.y*(1+h)-a.y)*v)/z;
      const ix=Math.max(0,Math.min(source.width-1,Math.round(sx)));
      const iy=Math.max(0,Math.min(source.height-1,Math.round(sy)));
      const from=(iy*source.width+ix)*4, to=(y*width+x)*4;
      for(let channel=0;channel<4;channel++) output.data[to+channel]=input[from+channel];
    }
  }
  outputContext.putImageData(output,0,0);
  return canvas;
}
