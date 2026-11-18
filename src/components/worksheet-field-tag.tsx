import styles from './worksheet-field-tag.module.css';

/** Shared required/optional markers for worksheet forms and student tasks. */
export function WorksheetFieldTag({ optional = false }: { optional?: boolean }) {
  return <span className={styles.tag} data-optional={optional || undefined}>{optional ? '选填' : '必填'}</span>;
}
