'use client';
import styles from './image-rotation-controls.module.css';
import type { useImageRotation } from './use-image-rotation';
export function ImageRotationControls({rotation}: {rotation: ReturnType<typeof useImageRotation>}) {
  if (!rotation.supported) return null;
  return <>
    <button type="button" className={styles.button} disabled={!rotation.canRotate} onClick={() => void rotation.rotate(-90)} aria-label="向左旋转90度并保存"><RotationIcon />向左 90°</button>
    <button type="button" className={styles.button} disabled={!rotation.canRotate} onClick={() => void rotation.rotate(90)} aria-label="向右旋转90度并保存"><RotationIcon right />向右 90°</button>
    {(rotation.loading || rotation.message || rotation.error) && <span role={rotation.error ? 'alert' : 'status'} style={{fontSize:12,color:rotation.error?'#d77878':'inherit'}}>
      {rotation.error || (rotation.loading ? '正在读取图片…' : rotation.message)}
    </span>}
  </>;
}

function RotationIcon({right = false}: {right?: boolean}) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={right ? {transform: 'scaleX(-1)'} : undefined}>
    <path d="M3 10a9 9 0 1 1 2.7 8.4M3 4v6h6" />
  </svg>;
}
