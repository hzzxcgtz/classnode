export interface DrawingSurfaceProps {
  data: unknown;
  backgroundUrl: string | null;
  disabled: boolean;
  onChange: (data: unknown) => void;
}
