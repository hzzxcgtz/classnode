import {
  WORKSHEET_STATUS_ICON_SOURCES,
  type WorksheetStatusIconName,
} from '@/lib/worksheet-status-icons';

/**
 * 学习单全系统共用的状态图标。尺寸由使用场景决定，图形、颜色与语义始终一致。
 */
export function WorksheetStatusIcon({
  name,
  size = 18,
  label,
  className,
}: {
  name: WorksheetStatusIconName;
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <img
      src={WORKSHEET_STATUS_ICON_SOURCES[name]}
      width={size}
      height={size}
      alt={label ?? ''}
      aria-hidden={label ? undefined : true}
      className={className}
      draggable={false}
      style={{ display: 'block', width: size, height: size, flexShrink: 0 }}
    />
  );
}
