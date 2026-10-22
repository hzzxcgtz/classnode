'use client';
import type { ComponentProps } from 'react';
import { useRotatedImageSource } from './use-image-rotation';

/** An image which refreshes when its saved orientation changes locally or remotely. */
export function RotatedImage({ src, alt, ...props }: Omit<ComponentProps<'img'>, 'src'> & { src: string }) {
  const rotated = useRotatedImageSource(src);
  return <img {...props} src={rotated} alt={alt ?? ''} />;
}
